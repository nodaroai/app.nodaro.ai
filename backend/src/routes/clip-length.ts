import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE, speakerViewVideoModeLive } from "@nodaro/render-rules"
import { createClipMeasureJob, defaultClipJobDeps, type ClipJobState, type ClipMeasureJob } from "../lib/clip-measure-job.js"
import { formatZodError } from "../lib/zod-error.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { clipMeasureStartLimiter } from "../lib/clip-measure-limit.js"
import { getSizeLimit } from "../utils/file-validation.js"

/**
 * POST /v1/media/clip-length — how long a video really runs, its pixels, and
 * whether it shows a face. A background measurement the caller starts and
 * polls (decided 2026-10-12, R3 + R4).
 *
 * Speaker View's Video input (decided 2026-10-11) is cut by a length measured
 * ONCE, on the server, and handed to both engines (D16): the editor's run asks
 * here, the server's run calls the same function, so they build the same
 * one-clip edit. The length is the picture track's real end (download behind
 * the SSRF guard, then a demux), never a declared duration; a clip whose end
 * cannot be measured is refused with a sentence.
 *
 *   - Callable only while Speaker View is priced, Cloud and self-host alike:
 *     `503 not_priced` before anything is read, after the sign-in check.
 *   - The same POST starts and polls: a cached answer is `200` at once; a
 *     measurement under way is `202`; a new one is started (rate-limited per
 *     user, STARTS only — a poll costs nothing) and answers `202`.
 *   - The download is capped to the upload size limit for video.
 *   - Cached per address, so a second run is instant.
 *   - Not in the public docs until go-live.
 *
 * Body:      { videoUrl: string }   (http(s); safeUrlSchema + safeFetch gates)
 * Response:  200 { data: { status: "ready", durationMs, width?, height?, faces? } }
 *            202 { data: { status: "running", retryAfterMs } }
 * Errors:    400 validation_error, 401 unauthorized, 422 video_unreadable | video_too_large,
 *            429 rate_limit_exceeded, 503 video_mode_not_live (until Speaker View AND
 *            Speaker Frames are priced, R15).
 */
export const clipLengthBody = z.object({ videoUrl: safeUrlSchema })

/** When a poller should ask again. */
const RETRY_AFTER_MS = 2000

export interface ClipLengthRouteDeps {
  /** Whether Speaker View's video mode may run (`speakerViewVideoModeLive`, R15). */
  readonly videoModeLive: () => boolean
  readonly job: Pick<ClipMeasureJob, "poll" | "start">
  /** The per-user limit on starting a measurement; replies itself when over. */
  readonly startLimit: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>
}

function defaultDeps(): ClipLengthRouteDeps {
  return {
    videoModeLive: () => speakerViewVideoModeLive(),
    job: createClipMeasureJob(defaultClipJobDeps(getSizeLimit("video"))),
    startLimit: clipMeasureStartLimiter(),
  }
}

export function clipLengthRoutes(deps: ClipLengthRouteDeps = defaultDeps()) {
  return async function register(app: FastifyInstance): Promise<void> {
    const answer = (reply: FastifyReply, state: ClipJobState) => {
      if (state.status === "ready") return reply.status(200).send({ data: { status: "ready", ...state.clip } })
      if (state.status === "failed") {
        const code = state.code === "too-large" ? "video_too_large" : "video_unreadable"
        return reply.status(422).send({ error: { code, message: state.message } })
      }
      return reply.status(202).send({ data: { status: "running", retryAfterMs: RETRY_AFTER_MS } })
    }

    app.post("/v1/media/clip-length", async (req, reply) => {
      if (!req.userId) {
        return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      }
      if (!deps.videoModeLive()) {
        return reply.status(503).send({ error: { code: "video_mode_not_live", message: SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE } })
      }
      const parsed = clipLengthBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
      }
      const url = parsed.data.videoUrl
      const known = await deps.job.poll(url)
      if (known.status !== "none") return answer(reply, known)
      await deps.startLimit(req, reply)
      if (reply.sent) return reply
      return answer(reply, await deps.job.start(url))
    })
  }
}

export default clipLengthRoutes()
