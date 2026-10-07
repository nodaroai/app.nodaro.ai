/**
 * Who says whether a launch's memory fits (decided 2026-10-05): the gate the
 * admission queue (`ffmpeg-admission.ts`) asks.
 *
 *  - `LocalMemoryGate` — one process, one budget. The semantics every gate
 *    shares: a launch that fits reserves; one bigger than the whole budget
 *    reserves only when nothing else holds memory (and then nothing else
 *    reserves while it holds).
 *  - `ContainerMemoryGate` — the container's processes share ONE budget through
 *    the Redis ledger (`ffmpeg-memory-ledger.ts`). Each reservation is a lease:
 *    kept alive by a heartbeat while ffmpeg runs, deleted on release, expiring
 *    on its own if its process dies.
 *
 * WHEN REDIS IS UNAVAILABLE the gate never blocks ffmpeg and never runs it
 * unbounded: it spends a LOCAL budget — `FFMPEG_MEMORY_LOCAL_SHARE` of the
 * container's — for as long as the outage lasts, logging once per outage. A
 * failed call opens a short breaker (`OUTAGE_PROBE_MS`) so a down Redis costs
 * one bounded call per probe, not one per launch. What this process already
 * holds is counted against the local budget whether or not Redis knew about it.
 * Leases taken during an outage are put into Redis once it answers again —
 * by the next reserve (before it asks what fits, so this process's own new
 * reservations count them) or by the heartbeat, whichever comes first — so
 * siblings see them from then on. Until then siblings cannot, which is the
 * residual of running without the shared ledger.
 *
 * No leaked lease: a lease is released by its holder's `release()` (idempotent),
 * by the admission when the waiter it was reserved for was aborted meanwhile,
 * and — if its process is killed — by its TTL.
 */
import { randomUUID } from "node:crypto"
import type { RedisMemoryLedger } from "./ffmpeg-memory-ledger.js"
import { FFMPEG_LEASE_HEARTBEAT_MS } from "./ffmpeg-memory-ledger.js"

/** A reservation of memory; `release` gives it back (idempotent, never throws). */
export interface MemoryReservation {
  release(): void
}

/** Reserved — or not now. A refusal may carry the container's live total, which
 *  tells the caller what else cannot fit before the next release. */
export interface ReserveOutcome {
  readonly reservation?: MemoryReservation
  readonly containerTotalMiB?: number
}

export interface MemoryGate {
  /** Reserve `peakMiB` from `budgetMiB` if it fits now. Never rejects, never
   *  waits for memory: a launch that does not fit gets no reservation. */
  tryReserve(peakMiB: number, budgetMiB: number): Promise<ReserveOutcome>
}

/** Whether `peakMiB` fits beside `totalMiB` already reserved: bigger than the
 *  whole budget runs alone, anything else must sum within it. */
export function memoryFits(totalMiB: number, peakMiB: number, budgetMiB: number): boolean {
  return peakMiB > budgetMiB ? totalMiB === 0 : totalMiB + peakMiB <= budgetMiB
}

export class LocalMemoryGate implements MemoryGate {
  private reservedMiB = 0

  get heldMiB(): number {
    return this.reservedMiB
  }

  async tryReserve(peakMiB: number, budgetMiB: number): Promise<ReserveOutcome> {
    if (!memoryFits(this.reservedMiB, peakMiB, budgetMiB)) return { containerTotalMiB: this.reservedMiB }
    this.reservedMiB += peakMiB
    let released = false
    return {
      reservation: {
        release: () => {
          if (released) return
          released = true
          this.reservedMiB -= peakMiB
        },
      },
    }
  }
}

/** How long after a failed ledger call the next one waits (the breaker). */
export const FFMPEG_LEDGER_OUTAGE_PROBE_MS = 5_000

export interface ContainerGateOptions {
  readonly ledger: RedisMemoryLedger
  /** The share of the budget this process may spend while the ledger is down. */
  readonly localShare: () => number
  readonly now?: () => number
  readonly log?: (message: string) => void
  readonly heartbeatMs?: number
  readonly outageProbeMs?: number
}

interface Held {
  readonly peakMiB: number
  /** Whether Redis knows this lease (false: taken during an outage). */
  inLedger: boolean
}

export class ContainerMemoryGate implements MemoryGate {
  private readonly held = new Map<string, Held>()
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private downUntil = 0
  private down = false
  private readonly now: () => number
  private readonly log: (message: string) => void
  private readonly heartbeatMs: number
  private readonly outageProbeMs: number

  constructor(private readonly options: ContainerGateOptions) {
    this.now = options.now ?? Date.now
    this.log = options.log ?? ((m) => console.warn(m))
    this.heartbeatMs = options.heartbeatMs ?? FFMPEG_LEASE_HEARTBEAT_MS
    this.outageProbeMs = options.outageProbeMs ?? FFMPEG_LEDGER_OUTAGE_PROBE_MS
  }

  /** What this process holds now, in MiB — in Redis or not. */
  get heldMiB(): number {
    let total = 0
    for (const h of this.held.values()) total += h.peakMiB
    return total
  }

  /** Whether the shared ledger is currently considered down. */
  get ledgerDown(): boolean {
    return this.down
  }

  async tryReserve(peakMiB: number, budgetMiB: number): Promise<ReserveOutcome> {
    const leaseId = randomUUID()
    if (this.now() >= this.downUntil) {
      try {
        // Leases taken during an outage are unknown to Redis, so this reserve
        // would be admitted against the whole budget on top of them: register
        // them first (the ledger's total then includes this process's own).
        await this.registerLocalLeases()
        const result = await this.options.ledger.reserve(leaseId, peakMiB, budgetMiB)
        this.recovered()
        if (!result.reserved) return { containerTotalMiB: result.totalMiB }
        return { reservation: this.hold(leaseId, peakMiB, true) }
      } catch (error) {
        this.failed(error)
        // A reserve that timed out may still run later (a queued command): take
        // its lease back so it cannot sit in the ledger until its TTL.
        void this.options.ledger.release(leaseId).catch(() => undefined)
      }
    }
    return this.tryReserveLocally(leaseId, peakMiB, budgetMiB)
  }

  private tryReserveLocally(leaseId: string, peakMiB: number, budgetMiB: number): ReserveOutcome {
    const share = this.options.localShare()
    const localBudgetMiB = Math.floor(budgetMiB * share)
    const held = this.heldMiB
    if (!memoryFits(held, peakMiB, localBudgetMiB)) return { containerTotalMiB: held }
    return { reservation: this.hold(leaseId, peakMiB, false) }
  }

  private hold(leaseId: string, peakMiB: number, inLedger: boolean): MemoryReservation {
    this.held.set(leaseId, { peakMiB, inLedger })
    this.startHeartbeat()
    return {
      release: () => {
        const lease = this.held.get(leaseId)
        if (!lease) return
        this.held.delete(leaseId)
        if (this.held.size === 0) this.stopHeartbeat()
        // Sent before the caller's next reserve, on the same connection, so the
        // freed memory is visible to it. Best effort: the TTL is the backstop.
        if (lease.inLedger) void this.options.ledger.release(leaseId).catch(() => undefined)
      },
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeat) return
    this.heartbeat = setInterval(() => void this.beat(), this.heartbeatMs)
    this.heartbeat.unref?.()
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = undefined
  }

  /** Put the leases taken without Redis into the ledger, before a reserve
   *  asks it what fits. Throws when the ledger does not answer. */
  private async registerLocalLeases(): Promise<void> {
    for (const [leaseId, lease] of [...this.held]) {
      if (lease.inLedger || !this.held.has(leaseId)) continue
      await this.options.ledger.renew(leaseId, lease.peakMiB)
      lease.inLedger = true
      // Released while its registration was in flight: delete what it wrote.
      if (!this.held.has(leaseId)) void this.options.ledger.release(leaseId).catch(() => undefined)
    }
  }

  /** Renew every lease this process holds — and, after an outage, register the
   *  ones taken without Redis. A failure here only opens the breaker: ffmpeg
   *  keeps running. */
  private async beat(): Promise<void> {
    if (this.now() < this.downUntil) return
    for (const [leaseId, lease] of [...this.held]) {
      if (!this.held.has(leaseId)) continue
      try {
        await this.options.ledger.renew(leaseId, lease.peakMiB)
        lease.inLedger = true
        this.recovered()
      } catch (error) {
        this.failed(error)
        return
      }
      // Released while its renewal was in flight: delete what the renewal wrote.
      if (!this.held.has(leaseId)) void this.options.ledger.release(leaseId).catch(() => undefined)
    }
  }

  private failed(error: unknown): void {
    this.downUntil = this.now() + this.outageProbeMs
    if (this.down) return
    this.down = true
    const reason = error instanceof Error ? error.message : String(error)
    this.log(
      `[ffmpeg-memory] the shared memory ledger is unavailable (${reason}); this process spends its local share ` +
        `of the budget until it answers again`,
    )
  }

  private recovered(): void {
    if (!this.down) return
    this.down = false
    this.downUntil = 0
    this.log("[ffmpeg-memory] the shared memory ledger is back; reservations are shared again")
  }
}
