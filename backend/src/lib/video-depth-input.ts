import { checkVideoDepthLength, resolveVideoDepthProvider, videoDepthCreditId } from "@nodaro/shared"
import { probeVideoSource } from "../providers/video/ffmpeg-utils.js"
import { safeUrlSchema } from "./url-validator.js"

/**
 * Video Depth input gate: measures the input clip, refuses one the provider
 * cannot take, and picks the price row the run reserves.
 *
 * CORE, deliberately not `ee/` — input validation runs in every edition. One
 * rule for both places a run starts: the route's preHandler (ahead of the
 * credit guard, so a refusal is a 400, never a 402) and the workflow run's
 * stamp hook (before input_data is written or anything is reserved).
 *
 * Mirrors `lib/video-sfx-duration.ts`, except an unmeasurable clip is REFUSED
 * rather than priced at a fallback: here the length both gates the run (fal's
 * frame cap, Replicate's seconds cap) and prices it, and a guessed length could
 * under-reserve — commit_credits can only refund, never charge above the
 * reservation. `probeVideoSource` throws for every unmeasurable source (missing
 * or non-positive duration, the SSRF guard, an unreachable URL), so a throw is
 * the whole `video_unreadable` path.
 */
export type VideoDepthMeasure =
  | { readonly ok: true; readonly durationSec: number; readonly creditId: string }
  | { readonly ok: false; readonly code: "video_too_long" | "video_unreadable"; readonly message: string }

const UNREADABLE_MESSAGE = "Could not read the video. Check that the link is a reachable video file."

export async function measureVideoDepthInput(
  provider: string,
  videoUrl: string,
  onProbeFailure: (err: unknown) => void = () => {},
): Promise<VideoDepthMeasure> {
  let probe: { durationSeconds: number; fps?: number }
  try {
    probe = await probeVideoSource(videoUrl)
  } catch (err) {
    onProbeFailure(err)
    return { ok: false, code: "video_unreadable", message: UNREADABLE_MESSAGE }
  }
  const length = checkVideoDepthLength(provider, { durationSec: probe.durationSeconds, fps: probe.fps })
  if (!length.ok) return { ok: false, code: "video_too_long", message: length.message }
  const durationSec = Math.ceil(probe.durationSeconds)
  return { ok: true, durationSec, creditId: videoDepthCreditId(provider, durationSec) }
}

/**
 * The workflow run's twin of the route's preHandler: resolves the provider
 * onto the payload (absent or unknown → the default; raw workflow JSON can
 * carry any string, and an unknown id must never reach the credit row) and
 * stamps the two fields the route writes into input_data — `duration_seconds`
 * and `bucketKey` (the price row the run reserves, see `videoDepthReserveId`).
 * The reconcile cron later reads the resolved provider from input_data. The
 * caller must run it BEFORE writing input_data, because the worker reads the
 * jobs row, never the queue payload.
 *
 * The videoUrl must pass the route's own `safeUrlSchema` (http(s), no literal
 * local/private host) before anything is probed: raw workflow JSON reaches
 * here without the route's Zod, and `probeVideoSource`'s SSRF guard only
 * inspects strings with a scheme, so a bare local path would otherwise be
 * probed. Anything else is the route's `video_unreadable` refusal.
 *
 * Returns the route's refusal for a clip it would refuse (too long,
 * unreadable); undefined otherwise, and for any job that is not a video-depth
 * run, whose payload is left untouched.
 */
export async function stampVideoDepthInput(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<{ readonly code: string; readonly message: string } | undefined> {
  if (jobName !== "video-depth") return undefined
  const provider = resolveVideoDepthProvider(payload.provider)
  payload.provider = provider
  const videoUrl = typeof payload.videoUrl === "string" ? payload.videoUrl : ""
  if (!safeUrlSchema.safeParse(videoUrl).success) return { code: "video_unreadable", message: UNREADABLE_MESSAGE }
  const measured = await measureVideoDepthInput(provider, videoUrl, (err) => {
    console.warn("[node-executor] video-depth: ffprobe failed; refusing the run as video_unreadable:", err)
  })
  if (!measured.ok) return { code: measured.code, message: measured.message }
  payload.duration_seconds = measured.durationSec
  payload.bucketKey = measured.creditId
  return undefined
}

/** The price row a stamped video-depth payload reserves; undefined for any other job. */
export function videoDepthReserveId(jobName: string, payload: Record<string, unknown>): string | undefined {
  return jobName === "video-depth" && typeof payload.bucketKey === "string" ? payload.bucketKey : undefined
}
