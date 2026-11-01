// backend/src/lib/concurrency-lanes/queued-clock.ts — the arithmetic every
// clock that leaves queued time out shares (decided 2026-10-30: nothing fails
// for waiting; only the queue timeout ends a wait). No imports, so a poll loop
// anywhere (the cloud client, the job waiter, the pre-task heartbeat) can use
// it without pulling in the database or the workflow engine.
//
//   - the bound on any credit for waiting: the longest queue timeout an admin
//     can set plus slack. The queued sweep ends every wait by then, so a wait it
//     missed can never extend a clock without end;
//   - a merged list of wait intervals, so waits that overlap count once;
//   - QueuedPollClock: a poll loop's credit for the time the awaited job was
//     seen `queued` — the time between two reads that found it waiting, the
//     way the orchestrator's poll counts it. A job never seen `queued` is
//     credited nothing, so every clock that uses it is exactly what it was.

const MINUTE_MS = 60_000
/** The longest queue timeout an admin can set (`LANE_QUEUE_TIMEOUT_MINUTES` max, the Admin range's max). */
export const MAX_QUEUE_TIMEOUT_MS = 1440 * MINUTE_MS
/** The most queued time any one clock may credit: the longest queue timeout + 30 min of slack for the sweep's own cadence. */
export const MAX_QUEUED_CREDIT_MS = MAX_QUEUE_TIMEOUT_MS + 30 * MINUTE_MS

/** `ms` as a credit for waiting: never negative, never past MAX_QUEUED_CREDIT_MS; anything not a finite number is 0. */
export function cappedQueuedMs(ms: unknown): number {
  const n = typeof ms === "number" ? ms : typeof ms === "string" ? Number(ms) : NaN
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(MAX_QUEUED_CREDIT_MS, n)
}

/** The most separate wait intervals a list keeps; past it the two oldest are merged (the gap between them then counts — the safe side). */
export const MAX_LANE_WAIT_INTERVALS = 256

export type WaitInterval = [number, number]

/**
 * `intervals` with `[fromMs, toMs]` merged in: sorted, non-overlapping, at
 * most MAX_LANE_WAIT_INTERVALS long. An empty or invalid interval answers
 * null (nothing to add). Never mutates its input.
 */
export function mergeWaitInterval(intervals: readonly WaitInterval[] | undefined, fromMs: number, toMs: number): WaitInterval[] | null {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return null
  const merged: WaitInterval[] = []
  let from = fromMs
  let to = toMs
  let placed = false
  for (const [a, b] of intervals ?? []) {
    if (b < from) merged.push([a, b])
    else if (a > to) {
      if (!placed) { merged.push([from, to]); placed = true }
      merged.push([a, b])
    } else {
      from = Math.min(from, a)
      to = Math.max(to, b)
    }
  }
  if (!placed) merged.push([from, to])
  while (merged.length > MAX_LANE_WAIT_INTERVALS) {
    const [first, second] = merged as [WaitInterval, WaitInterval]
    merged.splice(0, 2, [first[0], second[1]])
  }
  return merged
}

/** The total length the (merged) intervals cover. */
export function coveredMs(intervals: readonly WaitInterval[] | undefined): number {
  return (intervals ?? []).reduce((sum, [a, b]) => sum + (b - a), 0)
}

/**
 * A poll loop's credit for queued time. Call `observe(status)` after every
 * read of the awaited job: a read that finds it `queued` credits the time
 * since the previous read (or since the clock started), up to
 * MAX_QUEUED_CREDIT_MS in all. The loop then gives up at
 * `start + timeout + queuedMs`, so its timeout counts from when the job
 * stopped waiting — from its start, as far as the reads can tell.
 *
 * `onCredit(fromMs, toMs)` hears each credited stretch, for the caller's own
 * books (the coordinator's in-handler wait).
 */
export class QueuedPollClock {
  private last: number
  private credited = 0

  constructor(
    private readonly onCredit?: (fromMs: number, toMs: number) => void,
    private readonly now: () => number = Date.now,
  ) {
    this.last = now()
  }

  /** Report what a read found. Returns true when it found the job waiting. */
  observe(status: string | null | undefined): boolean {
    const at = this.now()
    const from = this.last
    this.last = at
    if (status !== "queued") return false
    const add = Math.min(at - from, MAX_QUEUED_CREDIT_MS - this.credited)
    if (add > 0) {
      this.credited += add
      try {
        this.onCredit?.(at - add, at)
      } catch {
        // The caller's books never fail its wait.
      }
    }
    return true
  }

  /** The queued time credited so far. */
  get queuedMs(): number {
    return this.credited
  }
}
