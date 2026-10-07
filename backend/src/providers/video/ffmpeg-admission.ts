/**
 * Who may start an ffmpeg now: memory-weighted admission under the slot count
 * (decided 2026-10-05, fixing the 4K OOM).
 *
 * Every launch reserves its PREDICTED peak memory from the container's budget
 * (`ffmpeg-memory.ts`) before it starts and gives it back when it ends; the
 * slot count (`FFMPEG_CONCURRENCY`) stays as a second limit. The memory
 * decision belongs to a GATE (`ffmpeg-memory-gate.ts`): in production the
 * container's processes spend ONE budget through a Redis ledger, so this queue
 * is only the LOCAL order — and the slot count is per process. A caller that
 * knows its peak passes it (an Apply EDL picture slice: `ffmpeg-memory-model.ts`);
 * every other launch reserves the default estimate, scaled by its threads.
 *
 *  - A launch that does not fit WAITS — it never fails for memory.
 *  - A launch bigger than the whole budget runs ALONE: it starts once nothing
 *    else holds memory, and nothing else starts while it runs. It is never
 *    refused (the box may still hold it; a refusal would fail a job that could
 *    have run).
 *  - FIFO, with bounded overtaking: a waiter that fits may start ahead of
 *    earlier ones that do not fit for MEMORY (so light launches keep running
 *    while a 4K chunk waits for another to finish), but each waiter is passed
 *    at most `FFMPEG_ADMISSION_MAX_OVERTAKES` times; after that nothing passes
 *    it until it starts. Without the bound a stream of small launches could
 *    keep an oversized one waiting forever, since the box would never drain.
 *    A waiter blocked only by the slot count is never passed — when no slot is
 *    free nobody starts.
 *  - FAIRNESS ACROSS PROCESSES is weaker: the queue above orders one process's
 *    launches; two processes poll one ledger and whoever asks first after a
 *    release wins. The overtaking bound holds per process, not per container —
 *    small launches from a sibling can keep a waiter that is bigger than the
 *    whole budget (so it needs the ledger EMPTY) waiting past it. With the
 *    production budget a 4K chunk of 30 segments is nowhere near that size; it
 *    bites a small box (the 7.6 GiB CI runner) only.
 *
 * A waiter that is aborted leaves the queue at once and the queue is re-read:
 * removing a memory-blocked head can let the launches behind it start.
 *
 * Pure of config and ffmpeg — the limits are read through a function on every
 * decision, the gate is passed in, and the slot-wait ledger
 * (`lib/ffmpeg-slot-wait.ts`) is passed in as an observer, so a job's wait for memory counts exactly like its wait for a
 * slot (the heartbeat and the workflow engine leave both out of "hung").
 */

import { LocalMemoryGate, memoryFits, type MemoryGate, type MemoryReservation, type ReserveOutcome } from "./ffmpeg-memory-gate.js"

/** How many times a waiter may be passed by later launches before strict FIFO
 *  holds behind it. Eight light launches is seconds to a few minutes of
 *  delay for an oversized render, while a 4K chunk waiting for another chunk's
 *  memory is never delayed by them at all (the lights fit beside it). */
export const FFMPEG_ADMISSION_MAX_OVERTAKES = 8

export interface AdmissionLimits {
  /** At most this many launches run at once in this process (`FFMPEG_CONCURRENCY`). */
  readonly slots: number
  /** What the container's running launches may reserve together, in MiB. */
  readonly budgetMiB: number
  /** What a launch with no (valid) prediction reserves, in MiB — read only
   *  when a launch has none, so it may be computed (from the launch's threads). */
  readonly defaultPeakMiB: number | (() => number)
}

/** Told about one launch's wait — the job's `SlotWaitLedger` fits it. */
export interface AdmissionWaitObserver {
  /** The launch joined the queue (it could not start at once). */
  queued(): void
  /** The launch started — `fromQueue` when it had queued first. */
  granted(fromQueue: boolean): void
  /** A queued launch gave up (its signal aborted) before starting. */
  abandoned(): void
  /** A started launch ended and gave its reservation back. */
  released(): void
}

export interface AdmissionRequest {
  /** The launch's predicted peak memory in MiB; the default estimate when
   *  absent, zero, negative or not finite. */
  readonly peakMemoryMiB?: number
  readonly signal?: AbortSignal
  readonly observer?: AdmissionWaitObserver
}

export interface AdmissionOptions {
  /** Decides whether memory fits; one process's own budget when omitted. */
  readonly gate?: MemoryGate
  readonly maxOvertakes?: number
  /** How often a memory-blocked queue asks again — a sibling process's release
   *  or a dead holder's expiry reaches this process only that way. */
  readonly pollMs?: number
}

/** How often a queue held back for memory asks the gate again. */
export const FFMPEG_ADMISSION_POLL_MS = 500

interface Waiter {
  readonly peakMiB: number
  overtaken: number
  queued: boolean
  aborted: boolean
  readonly observer?: AdmissionWaitObserver
  readonly start: (reservation: MemoryReservation) => void
}

export class FfmpegAdmission {
  private running = 0
  private reservedMiB = 0
  private readonly queue: Waiter[] = []
  private readonly gate: MemoryGate
  private readonly maxOvertakes: number
  private readonly pollMs: number
  private pumping = false
  private pumpAgain = false
  private poll: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly limits: () => AdmissionLimits,
    options: AdmissionOptions = {},
  ) {
    this.gate = options.gate ?? new LocalMemoryGate()
    this.maxOvertakes = options.maxOvertakes ?? FFMPEG_ADMISSION_MAX_OVERTAKES
    this.pollMs = options.pollMs ?? FFMPEG_ADMISSION_POLL_MS
  }

  /** What is running, reserved (by this process) and waiting now. */
  get state(): { running: number; reservedMiB: number; waiting: number } {
    return { running: this.running, reservedMiB: this.reservedMiB, waiting: this.queue.length }
  }

  private defaultPeakMiB(): number {
    const { defaultPeakMiB } = this.limits()
    return typeof defaultPeakMiB === "function" ? defaultPeakMiB() : defaultPeakMiB
  }

  /** Wait until the launch may start; resolves with its release (idempotent). */
  acquire(request: AdmissionRequest = {}): Promise<() => void> {
    const { signal, observer } = request
    const peak = request.peakMemoryMiB
    const peakMiB = typeof peak === "number" && Number.isFinite(peak) && peak > 0 ? Math.ceil(peak) : this.defaultPeakMiB()
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason ?? new Error("FFmpeg wait cancelled"))
        return
      }
      const abort = () => {
        waiter.aborted = true
        const index = this.queue.indexOf(waiter)
        if (index < 0) return
        this.queue.splice(index, 1)
        if (waiter.queued) waiter.observer?.abandoned()
        reject(signal?.reason ?? new Error("FFmpeg wait cancelled"))
        void this.pump()
      }
      const waiter: Waiter = {
        peakMiB,
        overtaken: 0,
        queued: false,
        aborted: false,
        observer,
        start: (reservation) => {
          signal?.removeEventListener("abort", abort)
          this.running++
          this.reservedMiB += peakMiB
          observer?.granted(waiter.queued)
          let released = false
          resolve(() => {
            if (released) return
            released = true
            this.running--
            this.reservedMiB -= peakMiB
            // The memory goes back BEFORE the queue is re-read, so the launch
            // that was waiting for it sees it.
            reservation.release()
            observer?.released()
            void this.pump()
          })
        },
      }
      signal?.addEventListener("abort", abort, { once: true })
      this.queue.push(waiter)
      // Counted as queued from the start, so a launch that has to wait for the
      // gate (a ledger round trip) is observed as waiting, not running.
      waiter.queued = true
      observer?.queued()
      void this.pump()
    })
  }

  /** Re-read the queue; one pass at a time, and a request that arrives during a
   *  pass runs another straight after it. */
  private async pump(): Promise<void> {
    if (this.pumping) {
      this.pumpAgain = true
      return
    }
    this.pumping = true
    try {
      do {
        this.pumpAgain = false
        await this.pass()
      } while (this.pumpAgain)
    } finally {
      this.pumping = false
    }
  }

  /** Start every waiter that may start now, in queue order. */
  private async pass(): Promise<void> {
    const passed: Waiter[] = []
    // What a refusal told us the container holds: a later waiter that cannot fit
    // beside it is not asked about.
    let knownTotalMiB: number | undefined
    let heldBackForMemory = false
    let i = 0
    while (i < this.queue.length && this.running < this.limits().slots) {
      const waiter = this.queue[i]!
      // Starting it would pass every earlier waiter that did not fit — unless
      // one of them has been passed enough already.
      if (passed.some((w) => w.overtaken >= this.maxOvertakes)) break
      const { budgetMiB } = this.limits()
      const known = knownTotalMiB
      const outcome =
        known !== undefined && !memoryFits(known, waiter.peakMiB, budgetMiB)
          ? ({} as ReserveOutcome)
          : await this.gate.tryReserve(waiter.peakMiB, budgetMiB)
      // The queue may have changed while the gate answered.
      if (waiter.aborted || !this.queue.includes(waiter)) {
        outcome.reservation?.release()
        passed.length = 0
        knownTotalMiB = undefined
        i = 0
        continue
      }
      if (outcome.reservation) {
        for (const w of passed) w.overtaken++
        this.queue.splice(this.queue.indexOf(waiter), 1)
        waiter.start(outcome.reservation)
        // The queue shrank in front of `i`: re-read from the first waiter that
        // has not been passed yet.
        i = passed.length
        continue
      }
      heldBackForMemory = true
      if (outcome.containerTotalMiB !== undefined) knownTotalMiB = outcome.containerTotalMiB
      if (waiter.overtaken >= this.maxOvertakes) break
      passed.push(waiter)
      i++
    }
    this.schedulePoll(heldBackForMemory && this.queue.length > 0)
  }

  /** While a waiter is held back for memory, ask again shortly: a release in a
   *  sibling process, or a dead holder's lease expiring, reaches us no other way. */
  private schedulePoll(needed: boolean): void {
    if (this.poll) clearTimeout(this.poll)
    this.poll = undefined
    if (!needed) return
    this.poll = setTimeout(() => {
      this.poll = undefined
      void this.pump()
    }, this.pollMs)
    this.poll.unref?.()
  }
}
