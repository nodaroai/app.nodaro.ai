/**
 * The editor's side of the background clip measurement (decided 2026-10-12,
 * R4): `POST /v1/media/clip-length` starts the measurement and answers `202`
 * while it runs; the same request is the poll. The loop here asks again after
 * the pause the server names until the clip is measured, so a file of any size
 * is never one long request, and the second run of an address (cached
 * server-side) is answered on the first ask.
 */

export interface MeasuredClipAnswer {
  readonly durationMs: number
  readonly width?: number
  readonly height?: number
  readonly faces?: "present" | "none" | "unknown"
}

export type ClipMeasureAnswer = {
  readonly data:
    | ({ readonly status: "ready" } & MeasuredClipAnswer)
    | { readonly status: "running"; readonly retryAfterMs?: number }
}

/** The longest the editor waits for one measurement before it says so and lets the person run again. */
export const CLIP_MEASURE_MAX_WAIT_MS = 15 * 60 * 1000

const DEFAULT_PAUSE_MS = 2000
const MIN_PAUSE_MS = 500
const MAX_PAUSE_MS = 5000

const pauseOf = (retryAfterMs: unknown): number =>
  typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs)
    ? Math.min(MAX_PAUSE_MS, Math.max(MIN_PAUSE_MS, retryAfterMs))
    : DEFAULT_PAUSE_MS

/**
 * The wait ended because the person stopped the run (`aborted`) or the run was
 * replaced by a newer one (`stale`), not because the clip could not be
 * measured. A caller tells the two apart: Stop ends the node quietly, a stale
 * run unwinds as every other stale wait does, and neither is an error toast.
 */
export class ClipMeasureStopped extends Error {
  readonly reason: "aborted" | "stale"
  constructor(reason: "aborted" | "stale") {
    super("The check of this video was stopped.")
    this.name = "ClipMeasureStopped"
    this.reason = reason
  }
}

export interface PollClipMeasureOptions {
  /** One request to the route (it starts the measurement the first time). */
  readonly ask: () => Promise<ClipMeasureAnswer>
  readonly sleep?: (ms: number) => Promise<void>
  readonly now?: () => number
  /** Called once, the first time the answer is "still measuring". */
  readonly onWaiting?: () => void
  /** Stop pressed: ends the wait at once, in the pause or between asks. */
  readonly signal?: AbortSignal
  /** True once a newer run has replaced this one (`ExecutionContext.isWorkflowStale`). */
  readonly isStale?: () => boolean
}

/** A pause that ends the moment `signal` aborts (the caller then sees the abort). */
const realSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve() }
    const timer = setTimeout(done, ms)
    signal?.addEventListener("abort", done, { once: true })
  })

export async function pollClipMeasure(opts: PollClipMeasureOptions): Promise<MeasuredClipAnswer> {
  const sleep = opts.sleep ?? ((ms: number) => realSleep(ms, opts.signal))
  const stopIfStopped = (): void => {
    if (opts.signal?.aborted) throw new ClipMeasureStopped("aborted")
    if (opts.isStale?.()) throw new ClipMeasureStopped("stale")
  }
  const now = opts.now ?? Date.now
  const startedAt = now()
  let announced = false
  for (;;) {
    stopIfStopped()
    const answer = await opts.ask()
    const data = answer?.data
    if (data?.status === "ready") {
      const { status: _status, ...clip } = data
      return clip
    }
    if (data?.status !== "running") throw new Error("The server answered the video check with something unexpected. Try again.")
    if (!announced) {
      announced = true
      opts.onWaiting?.()
    }
    if (now() - startedAt >= CLIP_MEASURE_MAX_WAIT_MS) {
      throw new Error("Checking this video is taking longer than expected. It keeps going in the background, so run again in a minute and it will be quick.")
    }
    await sleep(pauseOf(data.retryAfterMs))
    stopIfStopped()
  }
}
