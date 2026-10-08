/**
 * Who may start a download: the account's slots, shared across processes
 * (decided 2026-10-08).
 *
 * An account may have `cap` video downloads running at once. Every download —
 * the route's (the editor's pasted link, the app runner's card, Recast, Studio),
 * and a run's pre-run fetch in the orchestrator process — takes a SLOT first and
 * gives it back when it ends. The slots are leases in the Redis ledger
 * (`download-slot-ledger.ts`), so the cap is ONE number across the API process,
 * the orchestrator process and every replica: a card download and a run's
 * download of the same account count against each other.
 *
 *  - a slot is a LEASE kept alive by a heartbeat while it is held, deleted on
 *    release, expiring on its own if its process dies;
 *  - a slot held longer than `maxHoldMs` is dropped by its holder, so a stuck
 *    download can never keep an account's slot alive for ever;
 *  - WHEN REDIS IS UNAVAILABLE (error, dead connection, no answer in time) the
 *    cap is counted LOCALLY — this process's own slots — which can never exceed
 *    the cap in one process, and is exactly what the cap was before the ledger
 *    (per process). It logs once per outage and probes again after
 *    `outageProbeMs`, so a down Redis costs one bounded call per probe. Slots
 *    taken during the outage are put into the ledger once Redis answers — by the
 *    next acquire, before it asks what fits, or by the heartbeat — so the other
 *    process sees them from then on. The process's own count is a floor on the
 *    cap in either mode.
 *
 * The local count is taken and the slot held with no `await` in between, so
 * concurrent callers cannot jointly pass the cap on the local path.
 */
import { randomUUID } from "node:crypto"
import { DOWNLOAD_LEASE_HEARTBEAT_MS, type RedisDownloadLedger } from "./download-slot-ledger.js"

/** A slot; `release` gives it back (idempotent, never throws). */
export interface DownloadSlot {
  release(): void
}

/** How long a slot may be held before its holder drops it: past the longest download a run waits for (40 min), with room. */
export const DOWNLOAD_SLOT_MAX_HOLD_MS = 60 * 60 * 1000
/** How long after a failed ledger call the next one waits (the breaker). */
export const DOWNLOAD_LEDGER_OUTAGE_PROBE_MS = 5_000

export interface DownloadSlotsOptions {
  /** The ledger, built on first use. Absent: the cap is counted in this process only. A rejection is an outage. */
  readonly ledger?: () => Promise<RedisDownloadLedger>
  readonly now?: () => number
  readonly log?: (message: string) => void
  readonly heartbeatMs?: number
  readonly outageProbeMs?: number
  readonly maxHoldMs?: number
}

interface Held {
  readonly userId: string
  readonly since: number
  /** Whether Redis knows this lease (false: taken during an outage, or with no ledger). */
  inLedger: boolean
}

export class DownloadSlots {
  private readonly held = new Map<string, Held>()
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private ledgerRef: RedisDownloadLedger | undefined
  private downUntil = 0
  private down = false
  private readonly now: () => number
  private readonly log: (message: string) => void
  private readonly heartbeatMs: number
  private readonly outageProbeMs: number
  private readonly maxHoldMs: number

  constructor(private readonly options: DownloadSlotsOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.log = options.log ?? ((m) => console.warn(m))
    this.heartbeatMs = options.heartbeatMs ?? DOWNLOAD_LEASE_HEARTBEAT_MS
    this.outageProbeMs = options.outageProbeMs ?? DOWNLOAD_LEDGER_OUTAGE_PROBE_MS
    this.maxHoldMs = options.maxHoldMs ?? DOWNLOAD_SLOT_MAX_HOLD_MS
  }

  /** How many slots THIS process holds for the account, in Redis or not. */
  heldBy(userId: string): number {
    let count = 0
    for (const lease of this.held.values()) if (lease.userId === userId) count++
    return count
  }

  /** Whether the shared ledger is currently considered down. */
  get ledgerDown(): boolean {
    return this.down
  }

  /** A slot for the account if it is below `cap` now (across processes), else null. Never waits, never rejects. */
  async tryAcquire(userId: string, cap: number): Promise<DownloadSlot | null> {
    // A slot this process holds is a slot of the account's, in whichever mode.
    if (this.heldBy(userId) >= cap) return null
    const leaseId = randomUUID()
    const build = this.options.ledger
    if (build && this.now() >= this.downUntil) {
      let ledger: RedisDownloadLedger | undefined
      try {
        ledger = await build()
        this.ledgerRef = ledger
        // Slots taken during an outage are unknown to Redis, so this acquire would be
        // admitted on top of them: register them first.
        await this.registerLocalLeases(ledger)
        const result = await ledger.acquire(userId, leaseId, cap)
        this.recovered()
        if (!result.acquired) return null
        return this.hold(leaseId, userId, true)
      } catch (error) {
        this.failed(error)
        // An acquire that timed out may still land later (a queued command): take its lease back.
        void ledger?.release(userId, leaseId).catch(() => undefined)
      }
    }
    // The fail-safe: this process's own count, checked and taken with no await between.
    if (this.heldBy(userId) >= cap) return null
    return this.hold(leaseId, userId, false)
  }

  private hold(leaseId: string, userId: string, inLedger: boolean): DownloadSlot {
    this.held.set(leaseId, { userId, since: this.now(), inLedger })
    this.startHeartbeat()
    return { release: () => this.drop(leaseId, true) }
  }

  private drop(leaseId: string, tellLedger: boolean): void {
    const lease = this.held.get(leaseId)
    if (!lease) return
    this.held.delete(leaseId)
    if (this.held.size === 0) this.stopHeartbeat()
    // Best effort: the TTL is the backstop.
    if (tellLedger && lease.inLedger) void this.ledgerRef?.release(lease.userId, leaseId).catch(() => undefined)
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

  /** Put the slots taken without Redis into the ledger. Throws when it does not answer. */
  private async registerLocalLeases(ledger: RedisDownloadLedger): Promise<void> {
    for (const [leaseId, lease] of [...this.held]) {
      if (lease.inLedger || !this.held.has(leaseId)) continue
      await ledger.renew(lease.userId, leaseId)
      lease.inLedger = true
      // Released while its registration was in flight: delete what it wrote.
      if (!this.held.has(leaseId)) void ledger.release(lease.userId, leaseId).catch(() => undefined)
    }
  }

  /** Renew every slot this process holds (and register the ones taken without Redis), and drop the ones past the hold ceiling. */
  private async beat(): Promise<void> {
    const now = this.now()
    for (const [leaseId, lease] of [...this.held]) {
      if (now - lease.since > this.maxHoldMs) {
        this.log(`[download-slots] dropping a slot held for ${Math.round((now - lease.since) / 60_000)} min (account ${lease.userId})`)
        this.drop(leaseId, true)
      }
    }
    const build = this.options.ledger
    if (!build || this.held.size === 0 || now < this.downUntil) return
    try {
      const ledger = await build()
      this.ledgerRef = ledger
      for (const [leaseId, lease] of [...this.held]) {
        if (!this.held.has(leaseId)) continue
        await ledger.renew(lease.userId, leaseId)
        lease.inLedger = true
        if (!this.held.has(leaseId)) void ledger.release(lease.userId, leaseId).catch(() => undefined)
      }
      this.recovered()
    } catch (error) {
      this.failed(error)
    }
  }

  private failed(error: unknown): void {
    this.downUntil = this.now() + this.outageProbeMs
    if (this.down) return
    this.down = true
    const reason = error instanceof Error ? error.message : String(error)
    this.log(`[download-slots] shared ledger unavailable (${reason}); counting this process's downloads only until it answers`)
  }

  private recovered(): void {
    this.downUntil = 0
    if (!this.down) return
    this.down = false
    this.log("[download-slots] shared ledger is back")
  }
}
