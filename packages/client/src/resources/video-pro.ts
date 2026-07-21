import type { NodaroClient } from "../client.js"

/**
 * Generate Video Pro control surface (Cloud edition) — the checkpointed
 * long-video engine's stop/continue operations. The generation itself is
 * dispatched like any other node (`POST /v1/generate-video-pro`); these
 * endpoints act on an EXISTING run:
 *
 * - `stop(jobId)` — graceful stop: the engine abandons the in-flight segment
 *   generation (that segment is still billed — the provider keeps rendering
 *   it), skips all remaining segments, stitches everything completed so far
 *   into the job's FINAL video, and refunds the untouched remainder of the
 *   reserve. A job that hasn't started yet is cancelled with a full refund
 *   instead. Poll the job as usual: it completes with `output_data.pro
 *   .stopped === true` and `stoppedAtSegment`.
 *
 * - `continueRun(jobId, opts?)` — a NEW job that resumes from
 *   `opts.fromSegment` (1-based; omitted → the first not-yet-delivered
 *   segment). Segments before it are reused from the parent; everything from
 *   it on is regenerated (overriding the parent's takes). Charged only for
 *   the regenerated segments plus the flat pro fee. Works on stopped, failed
 *   (with ≥1 delivered segment), and fully completed runs (tail re-roll via
 *   an explicit `fromSegment`).
 */
export interface StopVideoProResult {
  jobId: string
  /** Present when the run was processing — the engine finalizes within
   *  seconds; keep polling the job. */
  stopping?: boolean
  /** Present when the job had not started — the generic cancel ran instead
   *  (full refund). */
  success?: boolean
  cancelled?: number
}

export interface ContinueVideoProResult {
  /** The NEW job to poll — the continuation run. */
  jobId: string
  continuedFromJobId?: string
  /** 1-based first regenerated segment. */
  fromSegment?: number
  segmentCount?: number
  /** Present when an idempotency key matched an existing continuation. */
  deduped?: boolean
}

export class VideoProResource {
  constructor(private client: NodaroClient) {}

  /** Gracefully stop a running generate-video-pro job (keep + deliver the
   *  completed segments; refund the rest). */
  stop(jobId: string): Promise<StopVideoProResult> {
    return this.client.request(
      "POST",
      `/v1/generate-video-pro/${encodeURIComponent(jobId)}/stop`,
    )
  }

  /** Continue a stopped/failed/completed run from a segment (a NEW job).
   *  Named `continueRun` because `continue` is a reserved word. */
  continueRun(
    jobId: string,
    opts?: { fromSegment?: number },
  ): Promise<ContinueVideoProResult> {
    return this.client.request("POST", "/v1/generate-video-pro/continue", {
      body: {
        fromJobId: jobId,
        ...(opts?.fromSegment !== undefined ? { fromSegment: opts.fromSegment } : {}),
      },
    })
  }
}
