/**
 * How long a job has been STALLED on the ffmpeg slot queue (podcast Track 0.13,
 * decided 2026-10-04).
 *
 * `FFMPEG_CONCURRENCY` slots (default 4) are shared by up to
 * `VIDEO_WORKER_CONCURRENCY` jobs (default 50), so a short job can sit behind
 * hours of apply-edl chunk renders. That wait is not a hang, so the two clocks
 * that decide "hung" leave it out: the pre-task heartbeat pauses its cap while
 * the job waits (`workers/pre-task-heartbeat.ts`), and writes the total to
 * `jobs.slot_wait_ms`, which the workflow engine takes off the node's clocks.
 *
 * Per JOB, carried by AsyncLocalStorage: the heartbeat wrapper opens a ledger
 * around the handler, and the slot queue (`providers/video/ffmpeg-utils.ts`)
 * records into whichever ledger the waiting call belongs to. A job counts as
 * stalled only while it waits for a slot AND holds none — a job that is
 * already running ffmpeg while a second call queues is making progress.
 * Outside a ledger (tests, the API process) nothing is recorded.
 */
import { AsyncLocalStorage } from "node:async_hooks"

export class SlotWaitLedger {
  private waiting = 0
  private holding = 0
  private stalledSince: number | null = null
  private banked = 0

  constructor(private readonly now: () => number = Date.now) {}

  /** A call joined the queue (no free slot). */
  queued(): void { this.waiting++; this.settle() }
  /** A call got a slot — `fromQueue` when it had queued first. */
  granted(fromQueue: boolean): void { if (fromQueue) this.waiting--; this.holding++; this.settle() }
  /** A queued call gave up (its signal aborted) without a slot. */
  abandoned(): void { this.waiting--; this.settle() }
  /** A slot this job held was released. */
  released(): void { this.holding--; this.settle() }

  /** Total stalled time so far, including a stall in progress. */
  waitedMs(): number {
    return this.banked + (this.stalledSince === null ? 0 : this.now() - this.stalledSince)
  }

  private settle(): void {
    const stalled = this.waiting > 0 && this.holding === 0
    if (stalled && this.stalledSince === null) this.stalledSince = this.now()
    else if (!stalled && this.stalledSince !== null) {
      this.banked += this.now() - this.stalledSince
      this.stalledSince = null
    }
  }
}

const ledgers = new AsyncLocalStorage<SlotWaitLedger>()

/** Run `fn` with `ledger` as the current job's ledger. */
export function runWithSlotWaitLedger<T>(ledger: SlotWaitLedger, fn: () => Promise<T>): Promise<T> {
  return ledgers.run(ledger, fn)
}

/** The ledger of the job this async call belongs to, if any. */
export function currentSlotWaitLedger(): SlotWaitLedger | undefined {
  return ledgers.getStore()
}
