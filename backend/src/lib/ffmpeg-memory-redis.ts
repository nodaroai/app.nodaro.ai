/**
 * The Redis client and ledger the ffmpeg memory gate shares across a
 * container's processes (`providers/video/ffmpeg-memory-gate.ts`, decided
 * 2026-10-05).
 *
 * The client is a DUPLICATE of the BullMQ connection with its failure mode
 * changed: that connection retries forever and queues every command while it is
 * down (right for a queue worker), which would leave an ffmpeg launch waiting
 * on a dead Redis. This one answers a dead connection at once — no offline
 * queue — and gives up on an unanswered command after `commandTimeout`; the
 * gate then spends its local share instead. It reconnects on its own.
 *
 * Loaded lazily by `providers/video/ffmpeg-admission-instance.ts`, only when
 * the ledger is on, so importing the ffmpeg runtime never opens a connection.
 */
import { hostname } from "node:os"
import { redis } from "./queue.js"
import { FFMPEG_LEDGER_COMMAND_TIMEOUT_MS, RedisMemoryLedger } from "../providers/video/ffmpeg-memory-ledger.js"
import { ffmpegContainerId } from "../providers/video/ffmpeg-memory.js"

/** The ledger of THIS container, and how its identity was found. Resolves once
 *  the connection is ready — or after `FFMPEG_LEDGER_COMMAND_TIMEOUT_MS` when
 *  Redis does not answer: a client with no offline queue refuses every command
 *  while it is still connecting, so a gate handed a client that is not ready yet
 *  would log a false outage on the first launch after every boot. A Redis that is
 *  really down is then reported by the first reserve, as an outage. */
export async function createFfmpegMemoryLedger(): Promise<{
  readonly ledger: RedisMemoryLedger
  readonly containerId: string
  readonly containerIdSource: "RAILWAY_REPLICA_ID" | "hostname"
}> {
  const client = redis.duplicate({
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: FFMPEG_LEDGER_COMMAND_TIMEOUT_MS,
  })
  // Connection errors are the gate's business (a failed call), not an
  // unhandled event.
  client.on("error", () => undefined)
  await connectedOrTimedOut(client)
  const { id, source } = ffmpegContainerId(process.env, hostname())
  return {
    ledger: new RedisMemoryLedger({ client: () => client, containerId: id }),
    containerId: id,
    containerIdSource: source,
  }
}

/** Resolves when `client` is ready, or after the command timeout. */
function connectedOrTimedOut(client: ReturnType<typeof redis.duplicate>): Promise<void> {
  if (client.status === "ready") return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      client.off("ready", done)
      resolve()
    }
    const timer = setTimeout(done, FFMPEG_LEDGER_COMMAND_TIMEOUT_MS)
    timer.unref?.()
    client.once("ready", done)
  })
}
