// backend/src/lib/concurrency-lanes/server-share.ts — the per-process share
// of a server's background pools one user and coordinator-class jobs may hold
// (decided 2026-10-30).
//
//   - Per user, every job class: no user — all their payer lines together —
//     holds more than LANE_SERVER_USER_SHARE (25 %) of a pool's workers,
//     minimum 1: 12 of 50 video workers, 1 of 2 render workers, 5 of 20
//     orchestrator, 1 of 5 pipeline, 1 of 2 director.
//   - Coordinator class, the video pool only: coordinator-class jobs together
//     hold at most LANE_SERVER_COORDINATOR_SHARE (40 %) of it (20 of 50).
//   - An exempt job — re-admitted, or a child of a running parent — is counted
//     but never refused: a user whose parents fill their share would otherwise
//     wait forever on their own children.
//
// Counts are PER PROCESS: one Worker's pool per process, and each replica of a
// worker service is its own server. With N replicas of the video worker one
// user may hold up to a quarter of EACH replica's pool — N quarters of the
// service — and a job refused on one replica may be picked up and admitted on
// another. That is the design (a server's workers are what the share
// protects); the lane sizes, not the share, bound a user across the platform.
// A pool's size is
// registered by the process that runs it (serverShare(pool, size), at worker
// creation); a pool nobody sized only counts. Admission (worker-admit.ts)
// checks the share first, then the lane, and asks for a refusal only while
// lanes are enforced — with enforcement off every job enters, over-cap entries
// counted. A job refused by its lane leaves the share again, so nothing waits
// on the share while holding a lane slot.
//
// A job refused here is parked with reason `server_busy` (the caller records
// the wait in the gate and parks it), and noted as this process's waiter, with
// its class. Leaving the share wakes the oldest waiter of the same user that
// would enter now (a coordinator held back by the coordinator share never
// stands in front of the user's leaves); a coordinator leaving the video pool
// also wakes the oldest coordinator waiter, of any user, that would enter now.
// A wake that moved nothing (the job was no longer parked) falls through to
// the next. The park backstop brings back the rest.
import { config } from "../config.js"
import type { WakeTarget } from "./gate.js"
import { warnLaneRateLimited } from "./hold.js"
import type { LaneQueueName } from "./types.js"

/** A server's background worker pool. */
export type ServerPool = "video" | "render" | "orchestrator" | "pipeline" | "director"

/**
 * The pool each worker queue runs on; `live` and `inline` run on none. The
 * gate's Lua carries the same table (POOL_OF in gate-scripts.ts — a held
 * waiter blocks only later waiters of its pool); a test holds the two equal.
 */
export const SERVER_POOL_OF: Readonly<Partial<Record<LaneQueueName, ServerPool>>> = {
  "video-generation": "video",
  "video-render": "render",
  "workflow-orchestration": "orchestrator",
  "pipeline-orchestration": "pipeline",
  "video-director": "director",
}

export interface ServerShareKey {
  userId: string
  jobId: string
  /** The class the job runs as: a coordinator also counts in the pool's coordinator share. */
  coordinator: boolean
  /** Never refused (re-admitted, or a child of a running parent); counted all the same. */
  exempt: boolean
}

export type ServerShareEntry = { entered: true; leave(): void } | { entered: false }

export interface ServerShareOccupancy {
  /** The pool's size as registered in this process; null when nobody sized it (it only counts). */
  poolSize: number | null
  held: number
  byUser: Record<string, number>
  coordinators: number
  /** The most one user may hold; null when the pool is not sized. */
  userCap: number | null
  /** The most coordinators may hold together; null when not capped (every pool but video, or not sized). */
  coordinatorCap: number | null
}

export interface ServerShare {
  /** Enter the share, or be refused (an exempt key never is). An entry leaves exactly once: later calls of `leave` do nothing. */
  tryEnter(key: ServerShareKey): ServerShareEntry
  occupancy(): ServerShareOccupancy
}

const DEFAULT_USER_SHARE = 0.25
const DEFAULT_COORDINATOR_SHARE = 0.4
/** Float slack, so 0.29 × 100 floors to 29 and 0.7 × 10 ceils to 7. */
const EPSILON = 1e-9

const fraction = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback)

/** What one pool holds in this process. */
class PoolShare implements ServerShare {
  size: number | null = null
  /** userId → jobId → how many entries of it are in. */
  private readonly users = new Map<string, Map<string, number>>()
  private readonly coords = new Map<string, number>()

  constructor(private readonly pool: ServerPool) {}

  get userCap(): number | null {
    if (this.size === null) return null
    return Math.max(1, Math.floor(fraction(config.LANE_SERVER_USER_SHARE, DEFAULT_USER_SHARE) * this.size + EPSILON))
  }

  get coordinatorCap(): number | null {
    if (this.size === null || this.pool !== "video") return null
    return Math.max(1, Math.ceil(fraction(config.LANE_SERVER_COORDINATOR_SHARE, DEFAULT_COORDINATOR_SHARE) * this.size - EPSILON))
  }

  /** Whether a (non-exempt) job of `userId` would enter now. */
  hasRoom(userId: string, coordinator: boolean): boolean {
    const userCap = this.userCap
    if (userCap !== null && (this.users.get(userId)?.size ?? 0) >= userCap) return false
    const coordinatorCap = this.coordinatorCap
    return !(coordinator && coordinatorCap !== null && this.coords.size >= coordinatorCap)
  }

  tryEnter(key: ServerShareKey): ServerShareEntry {
    // Check and count in one synchronous step: no other pickup of this process runs in between.
    const held = this.users.get(key.userId)
    if (!key.exempt && !held?.has(key.jobId) && !this.hasRoom(key.userId, key.coordinator)) return { entered: false }
    let jobs = held
    if (!jobs) {
      jobs = new Map()
      this.users.set(key.userId, jobs)
    }
    jobs.set(key.jobId, (jobs.get(key.jobId) ?? 0) + 1)
    if (key.coordinator) this.coords.set(key.jobId, (this.coords.get(key.jobId) ?? 0) + 1)
    forgetWaiter(this.pool, key.userId, key.jobId)
    let left = false
    return {
      entered: true,
      leave: () => {
        if (left) return
        left = true
        this.leave(key)
        wakeAfterLeave(this.pool, key.userId, key.coordinator)
      },
    }
  }

  private leave(key: ServerShareKey): void {
    const jobs = this.users.get(key.userId)
    if (jobs) {
      decrement(jobs, key.jobId)
      if (jobs.size === 0) this.users.delete(key.userId)
    }
    if (key.coordinator) decrement(this.coords, key.jobId)
  }

  occupancy(): ServerShareOccupancy {
    const byUser = Object.fromEntries([...this.users].map(([u, jobs]) => [u, jobs.size]))
    return {
      poolSize: this.size,
      held: Object.values(byUser).reduce((a, b) => a + b, 0),
      byUser,
      coordinators: this.coords.size,
      userCap: this.userCap,
      coordinatorCap: this.coordinatorCap,
    }
  }
}

function decrement(map: Map<string, number>, id: string): void {
  const n = (map.get(id) ?? 0) - 1
  if (n > 0) map.set(id, n)
  else map.delete(id)
}

const pools = new Map<ServerPool, PoolShare>()

/** A pool's share in this process, created (not sized) on first use. */
export function serverShareOf(pool: ServerPool): ServerShare {
  let share = pools.get(pool)
  if (!share) {
    share = new PoolShare(pool)
    pools.set(pool, share)
  }
  return share
}

/**
 * Size a pool's share in this process — its worker's concurrency — and return
 * it. Called by the process that runs the pool, when it creates its worker. A
 * size that is not a positive number leaves the pool unsized: it only counts.
 */
export function serverShare(pool: ServerPool, poolSize: number): ServerShare {
  const share = serverShareOf(pool) as PoolShare
  share.size = Number.isFinite(poolSize) && poolSize >= 1 ? Math.floor(poolSize) : null
  return share
}

/** The pools this process sized; the occupancy publisher publishes these. */
export function sizedServerPools(): ServerPool[] {
  return [...pools].filter(([, s]) => s.size !== null).map(([p]) => p)
}

/** What this process holds of each pool it sized or counted in. */
export function serverShareOccupancy(): Partial<Record<ServerPool, ServerShareOccupancy>> {
  return Object.fromEntries([...pools].map(([pool, share]) => [pool, share.occupancy()]))
}

// ----------------------------------------------------------------- waiters

/** A waiter not parked again for this long is forgotten (= the gate's waiter TTL). */
const WAITER_FORGET_MS = 1_500_000
/** At most this many waiters kept per (pool, user); the oldest go first. */
const MAX_WAITERS_PER_USER = 500
/** At most this many waiters a leave tries before the backstop has the rest. */
const MAX_WAKE_TRIES = 5

interface Waiter { userId: string; coordinator: boolean; target: WakeTarget; notedAt: number; woken: boolean }

/** `${pool}\0${userId}` → jobId → waiter, in the order first parked. */
const waiters = new Map<string, Map<string, Waiter>>()
/** pool → jobId → its coordinator waiter (the same object), in the order first parked. */
const coordinatorWaiters = new Map<ServerPool, Map<string, Waiter>>()
const waiterKey = (pool: ServerPool, userId: string) => `${pool}\0${userId}`

/** Promotes parked jobs; the number it moved off the delayed set (void: assume all). */
type ServerShareWaker = (targets: WakeTarget[]) => Promise<number | void>
let waker: ServerShareWaker = async () => {}

/** Who promotes a parked waiter a leave woke (the park module, by its stored BullMQ id). */
export function registerServerShareWaker(fn: ServerShareWaker): void {
  waker = fn
}

function forget(pool: ServerPool, w: Waiter): void {
  const key = waiterKey(pool, w.userId)
  const list = waiters.get(key)
  list?.delete(w.target.jobId)
  if (list?.size === 0) waiters.delete(key)
  const coords = coordinatorWaiters.get(pool)
  if (coords?.get(w.target.jobId) === w) coords.delete(w.target.jobId)
  if (coords?.size === 0) coordinatorWaiters.delete(pool)
}

function prune(pool: ServerPool, list: Iterable<Waiter>, now: number): void {
  for (const w of [...list]) if (now - w.notedAt > WAITER_FORGET_MS) forget(pool, w)
}

/**
 * Note a job this process parked because its share was full (`coordinator`:
 * its class). A job parked again keeps its place and can be woken again. When
 * there is room for it already (a job left while this one was being parked,
 * with no waiter yet to wake), the oldest waiter that fits is woken at once.
 */
export function noteServerWaiter(pool: ServerPool, userId: string, target: WakeTarget, coordinator = false): void {
  const key = waiterKey(pool, userId)
  let list = waiters.get(key)
  if (!list) {
    list = new Map()
    waiters.set(key, list)
  }
  const now = Date.now()
  let w = list.get(target.jobId)
  if (w) {
    w.notedAt = now
    w.woken = false
    w.target = target
    w.coordinator = coordinator
  } else {
    w = { userId, coordinator, target, notedAt: now, woken: false }
    list.set(target.jobId, w)
  }
  const coords = coordinatorWaiters.get(pool) ?? new Map<string, Waiter>()
  if (coordinator && !coords.has(target.jobId)) coords.set(target.jobId, w)
  if (!coordinator) coords.delete(target.jobId)
  if (coords.size > 0) coordinatorWaiters.set(pool, coords)
  prune(pool, list.values(), now)
  while (list.size > MAX_WAITERS_PER_USER) forget(pool, list.values().next().value as Waiter)
  if (pools.get(pool)?.hasRoom(userId, coordinator)) wakeAfterLeave(pool, userId, false)
}

function forgetWaiter(pool: ServerPool, userId: string, jobId: string): void {
  const w = waiters.get(waiterKey(pool, userId))?.get(jobId)
  if (w) forget(pool, w)
}

/** The oldest not-yet-woken waiter of `candidates` that would enter now. */
function firstFitting(pool: ServerPool, candidates: Iterable<Waiter>): Waiter | undefined {
  const share = pools.get(pool)
  const list = [...candidates]
  prune(pool, list, Date.now())
  for (const w of list) {
    if (!w.woken && waiters.get(waiterKey(pool, w.userId))?.get(w.target.jobId) === w && (share?.hasRoom(w.userId, w.coordinator) ?? true)) return w
  }
  return undefined
}

/**
 * Wake the waiter `pick` names; when the wake moved nothing (the job was no
 * longer parked), forget it and wake the next one, at most MAX_WAKE_TRIES
 * times. Never throws.
 */
async function wakeChain(pool: ServerPool, pick: () => Waiter | undefined): Promise<Waiter | undefined> {
  for (let i = 0; i < MAX_WAKE_TRIES; i++) {
    const w = pick()
    if (!w) return undefined
    w.woken = true
    let moved: number | void
    try {
      moved = await waker([w.target])
    } catch (err) {
      // Its park backstop brings it back.
      warnLaneRateLimited("could not wake a job waiting for its server share", err)
      return w
    }
    if (moved !== 0) return w
    forget(pool, w)
  }
  return undefined
}

/**
 * After a job of `userId` (`coordinator`: of that class) left `pool`: wake the
 * oldest waiter of that user that would enter now; when a coordinator left and
 * no coordinator was woken for its user, also the oldest coordinator waiter of
 * any user that would. Fire-and-forget; never throws.
 */
function wakeAfterLeave(pool: ServerPool, userId: string, coordinator: boolean): void {
  void (async () => {
    const own = await wakeChain(pool, () => firstFitting(pool, waiters.get(waiterKey(pool, userId))?.values() ?? []))
    if (!coordinator || own?.coordinator || pools.get(pool)?.coordinatorCap == null) return
    await wakeChain(pool, () => firstFitting(pool, coordinatorWaiters.get(pool)?.values() ?? []))
  })().catch((err: unknown) => warnLaneRateLimited("could not wake a job waiting for its server share", err))
}

/** For tests: no pools, no waiters, no waker. */
export function resetServerShareForTests(): void {
  pools.clear()
  waiters.clear()
  coordinatorWaiters.clear()
  waker = async () => {}
}
