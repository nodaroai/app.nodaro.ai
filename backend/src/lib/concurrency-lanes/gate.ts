// backend/src/lib/concurrency-lanes/gate.ts — the concurrency gate: leases,
// waiters and reserved grants per (user, payer, lane) line, platform provider
// ceilings with fairness between users, and the server-share waiters. Every
// decision is one Lua script (gate-scripts.ts), atomic across processes; this
// class only serialises requests, decodes replies and publishes wakes.
//
// Reserved grants, not polling: a freed slot is RESERVED for the next eligible
// waiter, and the script returns that waiter as a wake target, which this class
// publishes on LANE_WAKE_CHANNEL (a subscriber in every process promotes the
// parked job). The publish follows the script, so a process that dies between
// the two loses that one wake — the waiter's post-park re-check and its
// backstop delay still bring it back, and the reservation waits for it.
//
// Enforcement off (`cl:v1:enforced` not "1"): the same verdict is computed and
// every acquire is granted; one that would have waited is an over-limit lease
// that counts as running, so the measurements are what enforcement would see.
//
// Bounded: every Redis call (the script, each wake publish) waits at most
// `callTimeoutMs`. The client may be the BullMQ connection, which queues
// commands for as long as Redis is unreachable; without a bound a gate call
// would hang through an outage. See ConcurrencyGate for what a timeout means.
import type { Redis } from "ioredis"
import { LANE_GATE_SCRIPTS } from "./gate-scripts.js"
import type { ConcurrencyLane, LaneEntryMeta, LaneQueueName, LaneSnapshot, PayerKey, WaitInfo, WaitReason } from "./types.js"
import { randomUUID } from "node:crypto"

/** The slice of an ioredis client the gate uses. */
export type LaneClient = Pick<Redis, "eval" | "publish">

/** A lease lives this long without a renewal; its holder renews every LANE_LEASE_RENEW_MS. */
export const LANE_LEASE_TTL_MS = 120_000
export const LANE_LEASE_RENEW_MS = 30_000
/** A slot reserved for a waiter is kept this long, then passed to the next (= the park backstop). */
export const LANE_RESERVATION_TTL_MS = 600_000
/** A waiter not seen (re-checked) for this long is dropped (2.5 × the park backstop). */
export const LANE_WAITER_TTL_MS = 1_500_000
/** A released lease's tombstone: a later renew of it answers "released" and re-creates nothing. */
export const LANE_RELEASED_TTL_MS = 600_000
export const LANE_KEY_PREFIX = "cl:v1:"
export const LANE_WAKE_CHANNEL = `${LANE_KEY_PREFIX}wake`

/** The provider's platform ceiling is not part of a request: the gate owns it (setProviderCeilings). */
export interface AcquireRequest {
  meta: LaneEntryMeta
  size: number
  mode: "fresh" | "front" | "readmit"
  leaseTtlMs: number
}

export type AcquireResult =
  | { granted: true; leaseId: string; overLimit: boolean; wouldWait: WaitInfo | null }
  | { granted: false; wait: WaitInfo }

export interface WakeTarget { jobId: string; queue: LaneQueueName; bullJobId: string | null }

export type ReleaseOutcome = "completed" | "failed" | "cancelled" | "requeued" | "handoff"

/** How long one gate call waits for Redis by default before it rejects with LaneGateTimeoutError. */
export const LANE_GATE_CALL_TIMEOUT_MS = 5_000

export interface ConcurrencyGateOptions {
  /** The client, read on every call (a connection may be replaced). */
  client: () => LaneClient
  now?: () => number
  /** Key prefix; the wake channel is `<prefix>wake`. Tests isolate on it. Default `cl:v1:`. */
  prefix?: string
  /** How long one Redis call may take before the gate call rejects (> 0). Default LANE_GATE_CALL_TIMEOUT_MS. */
  callTimeoutMs?: number
}

/**
 * A gate call whose Redis command did not answer within `callTimeoutMs`. The
 * outcome is UNKNOWN, not failed: a client with an offline queue may still run
 * the command once Redis is back.
 */
export class LaneGateTimeoutError extends Error {
  constructor(readonly call: string, readonly timeoutMs: number) {
    super(`concurrency gate call "${call}" got no answer from Redis within ${timeoutMs} ms`)
    this.name = "LaneGateTimeoutError"
  }
}

/** `promise`, or a rejection with LaneGateTimeoutError after `ms`. The timer never outlives the call. */
function withinTimeout<T>(promise: Promise<T>, ms: number, call: string): Promise<T> {
  // The losing promise may still settle (or reject) much later: never leave that unhandled.
  promise.catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LaneGateTimeoutError(call, ms)), ms)
    timer.unref?.()
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

type Reply = Record<string, unknown> & { wake: WakeTarget[] }

/** cjson encodes an empty Lua table as `{}`: read any list through this. */
const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

const toWake = (v: { jobId: string; queue: LaneQueueName; bullJobId?: string | null }): WakeTarget =>
  ({ jobId: v.jobId, queue: v.queue, bullJobId: v.bullJobId ?? null })

const toWait = (v: Record<string, unknown>): WaitInfo => ({
  lane: v.lane as ConcurrencyLane,
  position: Number(v.position),
  limit: Number(v.limit),
  running: Number(v.running),
  reason: v.reason as WaitReason,
  waitedMs: Number(v.waitedMs),
  enqueuedAtMs: Number(v.enqueuedAtMs),
})

/** The Lua null of a JSON reply (`cjson.null`) arrives as null; a missing key as undefined. */
const present = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v)

/**
 * The concurrency gate. Every method makes one bounded Redis call: when Redis
 * does not answer within `callTimeoutMs` the method rejects with
 * LaneGateTimeoutError instead of waiting (any other Redis error rejects too).
 * A caller on a hot path (a worker's pickup, a renew, a live call) catches the
 * rejection and applies its own fail-open rule — e.g. lanesEnforced() reads it
 * as "not enforced" — so a Redis outage never stalls the work it gates.
 *
 * A timeout is an unknown outcome: the command may still run later. That is
 * safe by construction — an acquire is idempotent per job id, a lease nobody
 * renews expires after its TTL, a waiter nobody re-checks is dropped after
 * LANE_WAITER_TTL_MS, and withdraw(jobId) clears a job's line entry.
 *
 * A wake publish that times out or fails is logged, never thrown: the script's
 * state change is already committed, and the waiter's backstop brings it back.
 */
export class ConcurrencyGate {
  private readonly now: () => number
  private readonly prefix: string
  private readonly channel: string
  private readonly callTimeoutMs: number

  constructor(private readonly opts: ConcurrencyGateOptions) {
    this.now = opts.now ?? Date.now
    this.prefix = opts.prefix ?? LANE_KEY_PREFIX
    this.channel = `${this.prefix}wake`
    this.callTimeoutMs = opts.callTimeoutMs ?? LANE_GATE_CALL_TIMEOUT_MS
    if (!(this.callTimeoutMs > 0) || !Number.isFinite(this.callTimeoutMs)) {
      throw new RangeError(`ConcurrencyGate: callTimeoutMs must be a positive number of milliseconds, got ${this.callTimeoutMs}`)
    }
  }

  /** Take a slot, or enter (or stay in) the line. Idempotent per job id. */
  async acquire(req: AcquireRequest): Promise<AcquireResult> {
    const r = await this.run("acquire", { meta: req.meta, size: req.size, mode: req.mode, leaseId: randomUUID(), leaseTtl: req.leaseTtlMs })
    if (r.granted === true) {
      return { granted: true, leaseId: String(r.leaseId), overLimit: r.overLimit === true, wouldWait: present(r.wait) ? toWait(r.wait) : null }
    }
    return { granted: false, wait: toWait(r.wait as Record<string, unknown>) }
  }

  /**
   * Extend a lease. One Redis no longer has (a restart, a stall past its TTL)
   * is re-created from `meta` — a running job never runs uncounted; one that
   * was released stays released.
   */
  async renew(leaseId: string, ttlMs: number, meta: LaneEntryMeta): Promise<"renewed" | "readopted" | "released"> {
    const r = await this.run("renew", { leaseId, ttl: ttlMs, meta })
    return r.status as "renewed" | "readopted" | "released"
  }

  /** Free a lease, count its outcome, and wake whoever its slot was reserved for. */
  async release(leaseId: string, outcome: ReleaseOutcome): Promise<WakeTarget[]> {
    return (await this.run("release", { leaseId, outcome })).wake
  }

  /** The parent's leaf lease, which its child runs under (never renewed or released by the child). */
  async borrow(parentJobId: string): Promise<string | null> {
    const r = await this.run("borrow", { jobId: parentJobId })
    return typeof r.leaseId === "string" ? r.leaseId : null
  }

  /** Record a waiter of a server pool's share (no lane position; ordered among the pool's waiters). */
  async markServerWait(meta: LaneEntryMeta & { pool: string }): Promise<WaitInfo> {
    const { pool, ...rest } = meta
    const r = await this.run("serverWait", { meta: rest, pool })
    return toWait(r.wait as Record<string, unknown>)
  }

  /** Remove a job from its line and from any server wait; wakes whoever gets its reserved slot. */
  async withdraw(jobId: string): Promise<WakeTarget[]> {
    return (await this.run("withdraw", { jobId })).wake
  }

  /** Where a waiting job stands; null when it is not waiting. */
  async describeWait(jobId: string): Promise<WaitInfo | null> {
    const r = await this.run("describe", { jobId })
    return present(r.wait) ? toWait(r.wait) : null
  }

  async hasReservation(jobId: string): Promise<boolean> {
    return (await this.run("hasReservation", { jobId })).reserved === true
  }

  /** Every waiter — lane waiters and server_busy ones — for the off-transition to promote. */
  async allWaiters(): Promise<WakeTarget[]> {
    return asArray<WakeTarget>((await this.run("allWaiters", {})).waiters).map(toWake)
  }

  /** The first waiter of every line, for the reconcile pass. A head whose record is gone reads as never seen (0). */
  async heads(): Promise<Array<{ jobId: string; queue: LaneQueueName; lastSeenMs: number }>> {
    return asArray<{ jobId: string; queue: LaneQueueName; lastSeenMs: number | null }>((await this.run("heads", {})).heads)
      .map((h) => ({ jobId: h.jobId, queue: h.queue, lastSeenMs: h.lastSeenMs ?? 0 }))
  }

  async setEnforced(on: boolean): Promise<void> {
    await this.run("setEnforced", { on })
  }

  /**
   * The providers' platform ceilings, as a whole: a provider absent from the
   * map has none. Slots freed by a ceiling that rose or went are passed on to
   * the heads waiting for them. Acquires never change a ceiling.
   */
  async setProviderCeilings(ceilings: Record<string, number>): Promise<void> {
    await this.run("setProviderCeilings", { ceilings })
  }

  async isEnforced(): Promise<boolean> {
    return (await this.run("isEnforced", {})).enforced === true
  }

  /** Every line's lanes and every provider's counts. `ungated` / `notLimited` are filled by in-process counters, not here. */
  async snapshot(): Promise<LaneSnapshot> {
    const r = await this.run("snapshot", {})
    type RawLine = Omit<LaneSnapshot["lines"][number], "payer"> & { payer: string }
    return {
      lines: asArray<RawLine>(r.lines).map((l) => ({ ...l, payer: l.payer as PayerKey, sources: present(l.sources) ? (l.sources as Record<string, number>) : {} })),
      providers: asArray<LaneSnapshot["providers"][number]>(r.providers).map((p) => ({ ...p, byUser: present(p.byUser) ? p.byUser : {} })),
      ungated: {},
      notLimited: {},
      enforced: r.enforced === true,
    }
  }

  private async run(name: keyof typeof LANE_GATE_SCRIPTS, req: Record<string, unknown>): Promise<Reply> {
    // Redis EVAL of the constant scripts in gate-scripts.ts — nothing user-supplied is evaluated.
    const raw = await withinTimeout(this.opts.client().eval(
      LANE_GATE_SCRIPTS[name], 0, this.prefix, this.now(), LANE_RESERVATION_TTL_MS, LANE_WAITER_TTL_MS, LANE_RELEASED_TTL_MS, JSON.stringify(req),
    ), this.callTimeoutMs, name)
    const reply = JSON.parse(String(raw)) as Record<string, unknown>
    const wake = asArray<{ jobId: string; queue: LaneQueueName; bullJobId?: string | null }>(reply.wake).map(toWake)
    if (wake.length > 0) await this.publish(wake)
    return { ...reply, wake }
  }

  private async publish(targets: WakeTarget[]): Promise<void> {
    const client = this.opts.client()
    await Promise.all(targets.map((t) =>
      withinTimeout(client.publish(this.channel, JSON.stringify(t)), this.callTimeoutMs, "publish").catch((err: unknown) => {
        // The reservation stands; the waiter's backstop brings it back.
        console.warn(`[concurrency-lanes] could not publish the wake of job ${t.jobId}: ${(err as Error).message}`)
      }),
    ))
  }
}
