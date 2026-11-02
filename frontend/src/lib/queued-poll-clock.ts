/**
 * The editor's clocks and waiting for a free slot (decided 2026-10-30: nothing
 * fails for waiting; only the server's queue timeout ends a wait).
 *
 * A poll loop that gives up after some time or some number of reads starts
 * that clock exactly as it always has, and extends it ONLY by the time it saw
 * the job `queued` — waiting for a free concurrency slot: each read that finds
 * the job queued credits the stretch since the previous read. Time in
 * `pending`, `processing` or anything else counts exactly as before, so a job
 * never seen `queued` is credited nothing and every clock that uses this is
 * what it was. The SDK's `nodes.runAndWait` counts the same way.
 */

const MINUTE_MS = 60_000

/**
 * The most queued time any one clock credits: the longest queue timeout an
 * admin can set (24 h) plus 30 min of slack. The platform ends every wait for
 * a slot before then, so this only bounds a wait the platform somehow left
 * open. The server's `MAX_QUEUED_CREDIT_MS` (concurrency-lanes/queued-clock.ts)
 * and the SDK's copy hold the same value; a change there is made here too.
 */
export const MAX_QUEUED_CREDIT_MS = (24 * 60 + 30) * MINUTE_MS

/** A poll loop's credit for the time it saw its job waiting for a slot. */
export class QueuedPollClock {
  private queuedMs = 0
  private lastReadAt: number

  /** `startedAt`: when the clock it extends started (the first read's stretch is counted from it). */
  constructor(startedAt: number = Date.now()) {
    this.lastReadAt = startedAt
  }

  /**
   * Note one read of the job at `readAt`: its status, or undefined for a read
   * that failed. A `queued` read credits the time since the previous read, up
   * to MAX_QUEUED_CREDIT_MS in all. Answers whether this read was credited — a
   * loop that counts reads rather than time leaves such a read uncounted.
   */
  observe(status: string | undefined, readAt: number = Date.now()): boolean {
    const credited = status === "queued" && this.queuedMs < MAX_QUEUED_CREDIT_MS
    if (credited) this.queuedMs = Math.min(MAX_QUEUED_CREDIT_MS, this.queuedMs + Math.max(0, readAt - this.lastReadAt))
    this.lastReadAt = readAt
    return credited
  }

  /** The time credited so far: how far the clock's limit has moved. */
  get creditMs(): number {
    return this.queuedMs
  }

  /** The time since `startedAt` that counts against the clock's limit. */
  countedMs(startedAt: number, now: number = Date.now()): number {
    return now - startedAt - this.queuedMs
  }
}
