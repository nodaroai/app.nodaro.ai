// backend/src/lib/concurrency-lanes/server-occupancy.ts — each process
// publishes what it holds of its pools (server-share.ts), so the Live usage
// page and the history sample can read every server's occupancy: the video,
// render and pipeline workers run in their own processes, the orchestrator and
// the director in the API's. Admission itself stays in-process; this is only
// a picture of it.
//
// Every SERVER_OCCUPANCY_INTERVAL_MS each pool the process sized is written to
// `cl:v1:servers:<env>:<pool>:<processId>` with a SERVER_OCCUPANCY_TTL_MS
// expiry, so a process that stops drops out within 15 s. Bounded and quiet:
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
import { warnLaneRateLimited } from "./hold.js"
import { serverShareOf, sizedServerPools } from "./server-share.js"

export const SERVER_OCCUPANCY_INTERVAL_MS = 5_000
export const SERVER_OCCUPANCY_TTL_MS = 15_000

/** The slice of an ioredis client the publisher uses; `status` other than "ready" skips the tick. */
export type OccupancyClient = Pick<Redis, "set"> & { readonly status?: string }

const PROCESS_ID = `${hostname()}-${process.pid}`

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
    await Promise.all(pools.map(async (pool) => {
      const value = JSON.stringify({ pool, processId: PROCESS_ID, env, at, ...serverShareOf(pool).occupancy() })
      try {
        await bounded(client.set(`${prefix}servers:${env}:${pool}:${PROCESS_ID}`, value, "PX", SERVER_OCCUPANCY_TTL_MS), timeoutMs)
      } catch (err) {
        warnLaneRateLimited("could not publish a server pool's occupancy", err)
      }
    }))
  } catch (err) {
    warnLaneRateLimited("could not publish a server pool's occupancy", err)
  }
}

/**
 * For a process entrypoint: publish now and every SERVER_OCCUPANCY_INTERVAL_MS.
 * Returns the stop function (idempotent), called on shutdown.
 */
export function startServerOccupancyPublisher(opts: PublishOptions = {}): () => void {
  let inFlight = false
  const tick = (): void => {
    if (inFlight) return
    inFlight = true
    void publishServerOccupancy(opts).finally(() => { inFlight = false })
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
