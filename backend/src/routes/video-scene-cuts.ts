// @reads-none reads only the clip it downloads into its own work dir
/**
 * Video Scene Cuts Route — INTERNAL ONLY.
 *
 *   POST /v1/video-scene-cuts  { videoUrl }
 *   200 { cutsSec: number[], durationSec: number }
 *
 * Where each new shot of a clip starts, measured from the file: `cutsSec` are
 * seconds from the clip's first frame (ascending, each once, never 0; `[]` for
 * one shot), by the platform's own scene-cut rule (`detectCutTimes`, the rule
 * Video Mask's per-shot masking cuts at), and `durationSec` is the clip's
 * length. The Cast Swap engine's shot list asks for it on the clip it
 * describes, so its LLM step only has to describe each shot (advertised to
 * plugins as `tk.capabilities.videoSceneCuts`).
 *
 * Free and synchronous: one download and one decode, no job, no provider, no
 * credits. Reached ONLY as a CHILD of the platform's own jobs
 * (`tk.http.workerRequest` with a parent job) — a browser, an API key, an app
 * token, MCP and every other internal hop are refused 403 before anything is
 * downloaded (`createsChildJob`, as Mask Outline and Mask Erase).
 *
 * Bounded: the URL is SSRF-checked (`safeUrlSchema`, then `safeFetch` inside
 * `downloadFile`), the download is capped at `SCENE_CUTS_MAX_BYTES`, a clip
 * longer than `SCENE_CUTS_MAX_DURATION_SEC` is refused before it is decoded,
 * the probe and the decode read the local copy only (`-protocol_whitelist
 * file`, a fixed list of demuxers: no playlist, external reference or second
 * download), and the decode runs through the ffmpeg admission with its
 * predicted peak memory and a kill budget that grows with the clip (Video
 * Mask's own). A busy worker never stalls the run that asked: a decode that
 * waits longer than `SCENE_CUTS_SLOT_WAIT_MS` for its slot answers 503
 * `scene_cuts_busy`, which the engine reads as "no cut times".
 */

import { join } from "node:path"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { createsChildJob } from "../lib/job-submission-context.js"
import { cleanupWorkDir, createWorkDir, downloadFile, runFfprobe } from "../providers/video/ffmpeg-utils.js"
import { maskGeometryPeakMemoryMiB, videoMaskFfmpegTimeoutMs } from "../providers/video/video-mask.js"
import { detectCutTimes } from "../services/scene-cut-frames.js"

/** The largest clip downloaded, bytes (a recast clip is far smaller). */
export const SCENE_CUTS_MAX_BYTES = 500 * 1024 * 1024
/** The longest clip measured, seconds (Video Mask's longest clip). */
export const SCENE_CUTS_MAX_DURATION_SEC = 300
/** The longest the decode waits for an ffmpeg slot before answering busy (the run goes on without cut times). */
export const SCENE_CUTS_SLOT_WAIT_MS = 60_000

/** ffprobe / ffmpeg input options: the local file only, through the containers a recast clip comes in. */
export const SCENE_CUTS_INPUT_ARGS: readonly string[] = ["-protocol_whitelist", "file", "-format_whitelist", "mov,mp4,m4a,matroska,webm"]

/** The clip's first video stream: its size and length (the stream's, else the container's). Throws when it has none. */
export async function probeSceneCutsClip(localPath: string): Promise<{ width: number; height: number; durationSec: number }> {
  const out = await runFfprobe([
    "-v", "error", ...SCENE_CUTS_INPUT_ARGS,
    "-select_streams", "v:0", "-show_entries", "stream=width,height,duration:format=duration", "-of", "json", localPath,
  ])
  const parsed = JSON.parse(out) as { streams?: Array<{ width?: unknown; height?: unknown; duration?: unknown }>; format?: { duration?: unknown } }
  const stream = parsed.streams?.[0]
  const width = Number(stream?.width)
  const height = Number(stream?.height)
  if (!stream || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error("not a video")
  const streamSec = Number(stream.duration)
  const durationSec = Number.isFinite(streamSec) && streamSec > 0 ? streamSec : Number(parsed.format?.duration)
  return { width, height, durationSec }
}

export const videoSceneCutsBody = z.strictObject({ videoUrl: safeUrlSchema })

const INTERNAL_ONLY = { error: { code: "forbidden", message: "Video Scene Cuts is an internal step of the platform's own jobs." } }

/** The door: only a worker-side child request. First, so a refused caller costs nothing. */
async function internalChildOnly(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!createsChildJob(req)) return void reply.code(403).send(INTERNAL_ONLY)
}

/** Whether a decode's failure came from ffmpeg itself (it ran), not from giving up on its slot. */
function isLaunched(err: unknown): boolean {
  return !(err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError"))
}

/** Seconds to the millisecond. */
const ms = (s: number) => Math.round(s * 1000) / 1000

export async function videoSceneCutsRoutes(app: FastifyInstance) {
  app.post("/v1/video-scene-cuts", { preHandler: [internalChildOnly] }, async (req, reply) => {
    const parsed = videoSceneCutsBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    if (!req.userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })

    const workDir = await createWorkDir("video-scene-cuts")
    try {
      const localPath = join(workDir, "source")
      try {
        await downloadFile(parsed.data.videoUrl, localPath, { maxBytes: SCENE_CUTS_MAX_BYTES })
      } catch (err) {
        req.log.warn({ err: err instanceof Error ? err.message : String(err) }, "video-scene-cuts: the clip could not be downloaded")
        return reply.status(400).send({ error: { code: "video_unreadable", message: "The video could not be downloaded." } })
      }
      let durationSec: number
      let geometry: { width: number; height: number }
      try {
        const probe = await probeSceneCutsClip(localPath)
        durationSec = probe.durationSec
        geometry = { width: probe.width, height: probe.height }
      } catch {
        return reply.status(400).send({ error: { code: "video_unreadable", message: "The file is not a video that can be read." } })
      }
      if (!Number.isFinite(durationSec) || durationSec <= 0) {
        return reply.status(400).send({ error: { code: "invalid_video_duration", message: "Could not read the video's length." } })
      }
      if (durationSec > SCENE_CUTS_MAX_DURATION_SEC) {
        return reply.status(400).send({
          error: {
            code: "video_duration_exceeds_limit",
            message: `The video is ${Math.ceil(durationSec)} seconds. Scene cuts are measured on clips up to ${SCENE_CUTS_MAX_DURATION_SEC} seconds.`,
          },
        })
      }
      const slotWait = AbortSignal.timeout(SCENE_CUTS_SLOT_WAIT_MS)
      let cutsSec: number[]
      try {
        ;({ cutsSec } = await detectCutTimes(localPath, {
          timeoutMs: videoMaskFfmpegTimeoutMs(durationSec),
          peakMemoryMiB: maskGeometryPeakMemoryMiB(geometry),
          inputArgs: SCENE_CUTS_INPUT_ARGS,
          slotSignal: slotWait,
        }))
      } catch (err) {
        // Still waiting for a slot when the wait ran out: busy, never a stalled run.
        if (slotWait.aborted && !isLaunched(err)) {
          return reply.status(503).send({ error: { code: "scene_cuts_busy", message: "The scene cuts could not be measured now: the server is busy." } })
        }
        throw err
      }
      const end = ms(durationSec)
      return reply.send({ cutsSec: cutsSec.filter((t) => t > 0 && t < end), durationSec: end })
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to measure the video's scene cuts")
    } finally {
      await cleanupWorkDir(workDir)
    }
  })
}
