// backend/src/lib/concurrency-lanes/wake-subscriber.ts — the per-process
// subscriber of the gate's wake channel. When any script reserves a slot it
// publishes the waiter as a WakeTarget; each process subscribes once, for the
// queues it runs (the workers: video, render, pipeline; the API process:
// orchestrator, director and its live waiters), and hands the targets that are
// its own to `onWake`, which promotes the parked job. A subscribed connection
// can issue no other command, so it is a dedicated duplicate of the BullMQ one.
import { redis } from "../queue.js"
import { LANE_WAKE_CHANNEL, type WakeTarget } from "./gate.js"
import type { LaneQueueName } from "./types.js"

function parseWakeTarget(message: string): WakeTarget | null {
  try {
    const v = JSON.parse(message) as Partial<WakeTarget>
    if (typeof v.jobId !== "string" || typeof v.queue !== "string") return null
    return { jobId: v.jobId, queue: v.queue, bullJobId: typeof v.bullJobId === "string" ? v.bullJobId : null }
  } catch {
    return null
  }
}

/** Subscribe to wakes for `queues`; the returned function unsubscribes and closes the connection. */
export function startLaneWakeSubscriber(queues: LaneQueueName[], onWake: (targets: WakeTarget[]) => Promise<void>): () => void {
  const wanted = new Set<string>(queues)
  const sub = redis.duplicate()
  sub.on("error", (err: Error) => {
    console.warn(`[concurrency-lanes] wake subscriber: ${err.message}`)
  })
  sub.on("message", (channel: string, message: string) => {
    if (channel !== LANE_WAKE_CHANNEL) return
    const target = parseWakeTarget(message)
    if (!target || !wanted.has(target.queue)) return
    onWake([target]).catch((err: unknown) => {
      // The reservation stands; the waiter's backstop brings it back.
      console.warn(`[concurrency-lanes] could not wake job ${target.jobId}: ${(err as Error).message}`)
    })
  })
  let stopped = false
  const subscribe = () => {
    if (stopped) return
    sub.subscribe(LANE_WAKE_CHANNEL).catch((err: unknown) => {
      console.warn(`[concurrency-lanes] wake subscriber could not subscribe: ${(err as Error).message}`)
    })
  }
  // Every (re)connection subscribes again, so a reconnect never leaves the process deaf to wakes.
  sub.on("ready", subscribe)
  subscribe()
  return () => {
    if (stopped) return
    stopped = true
    sub.unsubscribe(LANE_WAKE_CHANNEL).catch(() => undefined).finally(() => {
      sub.quit().catch(() => sub.disconnect())
    })
  }
}
