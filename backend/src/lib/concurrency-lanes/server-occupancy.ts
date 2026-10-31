// backend/src/lib/concurrency-lanes/server-occupancy.ts — each process
// publishes what it holds of its pools (server-share.ts), so the Live usage
// page and the history sample can read every server's occupancy: the video,
// render and pipeline workers run in their own processes, the orchestrator and
// the director in the API's. Admission itself stays in-process; this is only
// a picture of it.
//
// Every SERVER_OCCUPANCY_INTERVAL_MS each pool the process sized is written to
// `cl:v1:servers:<env>:<pool>:<processId>` with a SERVER_OCCUPANCY_TTL_MS
// expiry, so a process that stops drops out within 15 s. The same tick writes
// the process's counters of work that ran outside the gate (hold.ts
// laneCounters: ungated calls by job type, not-limited scopes by reason, gate
// failures by class, all since the process started, which `startedAt` says) to
// `cl:v1:counters:<env>:<processId>`, with the same expiry, so the Live usage
// page can sum them over every process of the environment. Every key written is
// also listed in the environment's index (`cl:v1:published:<env>`, a sorted set
// scored by the key's expiry, itself expiring), so the page reads O(processes)
// keys instead of walking the whole Redis. Bounded and quiet:
// a tick is skipped while the client is not connected (the BullMQ connection
// queues commands during an outage; stale SETs would pile up behind it), every
// write waits at most one gate-call timeout, a tick still in flight skips the
// next, a failure is logged at most once a minute, and the timer never keeps a
// process alive. The Redis client (the BullMQ connection) is
// imported lazily, so importing this module never connects.
import type { Redis } from "ioredis"
import { hostname } from "node:os"
import { getRuntimeEnv } from "../runtime-env.js"
import { LANE_GATE_CALL_TIMEOUT_MS, LANE_KEY_PREFIX } from "./gate.js"
import { laneCounters, warnLaneRateLimited } from "./hold.js"
import { serverShareOf, sizedServerPools } from "./server-share.js"

export const SERVER_OCCUPANCY_INTERVAL_MS = 5_000
export const SERVER_OCCUPANCY_TTL_MS = 15_000

/**
 * The slice of an ioredis client the publisher uses; `status` other than
 * "ready" skips the tick. Without the sorted-set commands the keys are written
 * but not indexed (the page then finds them by SCAN).
 */
export type OccupancyClient = Pick<Redis, "set"> & Partial<Pick<Redis, "zadd" | "zremrangebyscore" | "pexpire">> & { readonly status?: string }

/** The index of every key the processes of `env` published: member = key, score = its expiry (ms). */
export function publishedIndexKey(prefix: string, env: string): string {
  return `${prefix}published:${env}`
}

/** List `keys` in the environment's index until `expiresAt`, dropping members already expired. Throws on a Redis error. */
async function indexPublished(client: OccupancyClient, prefix: string, env: string, keys: string[], at: number, timeoutMs: number): Promise<void> {
  if (keys.length === 0 || !client.zadd || !client.zremrangebyscore || !client.pexpire) return
  const index = publishedIndexKey(prefix, env)
  const args = keys.flatMap((k) => [at + SERVER_OCCUPANCY_TTL_MS, k] as const)
  await bounded(client.zremrangebyscore(index, "-inf", at), timeoutMs)
  await bounded(client.zadd(index, ...args), timeoutMs)
  await bounded(client.pexpire(index, SERVER_OCCUPANCY_TTL_MS * 4), timeoutMs)
}

const PROCESS_ID = `${hostname()}-${process.pid}`
/** When this process started: its lane counters count from here. */
const PROCESS_STARTED_AT = Math.round(Date.now() - process.uptime() * 1000)

/** This process, as it names itself in its occupancy keys. */
export function serverProcessId(): string {
  return PROCESS_ID
}

export interface PublishOptions {
  /** Default: the BullMQ connection (lib/queue.ts). */
  client?: OccupancyClient
  /** Default: the gate's `cl:v1:`. */
  prefix?: string
  /** How long one write may take. Default: the gate's call timeout. */
  timeoutMs?: number
}

async function defaultClient(): Promise<OccupancyClient> {
  return (await import("../queue.js")).redis
}

function bounded<T>(p: Promise<T>, ms: number): Promise<T> {
  p.catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer from Redis within ${ms} ms`)), ms)
    timer.unref?.()
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

/** Write this process's occupancy of every pool it sized, once. Never throws. */
export async function publishServerOccupancy(opts: PublishOptions = {}): Promise<void> {
  const pools = sizedServerPools()
  if (pools.length === 0) return
  const prefix = opts.prefix ?? LANE_KEY_PREFIX
  const timeoutMs = opts.timeoutMs ?? LANE_GATE_CALL_TIMEOUT_MS
  try {
    const client = opts.client ?? (await defaultClient())
    if (typeof client.status === "string" && client.status !== "ready") return
    const env = getRuntimeEnv()
    const at = Date.now()
    const written: string[] = []
    await Promise.all(pools.map(async (pool) => {
      const value = JSON.stringify({ pool, processId: PROCESS_ID, env, at, ...serverShareOf(pool).occupancy() })
      const key = `${prefix}servers:${env}:${pool}:${PROCESS_ID}`
      try {
        await bounded(client.set(key, value, "PX", SERVER_OCCUPANCY_TTL_MS), timeoutMs)
        written.push(key)
      } catch (err) {
        warnLaneRateLimited("could not publish a server pool's occupancy", err)
      }
    }))
    await indexPublished(client, prefix, env, written, at, timeoutMs)
  } catch (err) {
    warnLaneRateLimited("could not publish a server pool's occupancy", err)
  }
}

/** Write this process's lane counters (work that ran outside the gate), once. Never throws. */
export async function publishLaneCounters(opts: PublishOptions = {}): Promise<void> {
  const prefix = opts.prefix ?? LANE_KEY_PREFIX
  const timeoutMs = opts.timeoutMs ?? LANE_GATE_CALL_TIMEOUT_MS
  try {
    const client = opts.client ?? (await defaultClient())
    if (typeof client.status === "string" && client.status !== "ready") return
    const env = getRuntimeEnv()
    const at = Date.now()
    const key = `${prefix}counters:${env}:${PROCESS_ID}`
    const value = JSON.stringify({ processId: PROCESS_ID, env, at, startedAt: PROCESS_STARTED_AT, ...laneCounters() })
    await bounded(client.set(key, value, "PX", SERVER_OCCUPANCY_TTL_MS), timeoutMs)
    await indexPublished(client, prefix, env, [key], at, timeoutMs)
  } catch (err) {
    warnLaneRateLimited("could not publish this process's lane counters", err)
  }
}

/**
 * For a process entrypoint: publish the pools' occupancy and the lane
 * counters now and every SERVER_OCCUPANCY_INTERVAL_MS.
 * Returns the stop function (idempotent), called on shutdown.
 */
export function startServerOccupancyPublisher(opts: PublishOptions = {}): () => void {
  let inFlight = false
  const tick = (): void => {
    if (inFlight) return
    inFlight = true
    void Promise.all([publishServerOccupancy(opts), publishLaneCounters(opts)]).finally(() => { inFlight = false })
  }
  const timer = setInterval(tick, SERVER_OCCUPANCY_INTERVAL_MS)
  timer.unref?.()
  tick()
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    clearInterval(timer)
  }
}
