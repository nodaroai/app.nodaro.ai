/**
 * The Redis client and ledger the account's download slots share across
 * processes (`download-slots.ts`, decided 2026-10-08).
 *
 * Same shape as the ffmpeg memory ledger's client (`ffmpeg-memory-redis.ts`): a
 * DUPLICATE of the BullMQ connection with its failure mode changed — that
 * connection retries forever and queues every command while it is down (right
 * for a queue worker), which would leave a download waiting on a dead Redis.
 * This one answers a dead connection at once (no offline queue), gives up on an
 * unanswered command after `commandTimeout`, and reconnects on its own; the
 * slots then count this process's downloads only.
 *
 * Loaded lazily by `download-slots-instance.ts`, only when the ledger is on, so
 * importing the downloader never opens a connection.
 */
import { redis } from "./queue.js"
import { DOWNLOAD_LEDGER_COMMAND_TIMEOUT_MS, RedisDownloadLedger } from "./download-slot-ledger.js"

/** The ledger on its own connection. Resolves once the connection is ready — or
 *  after the command timeout when Redis does not answer: a client with no
 *  offline queue refuses every command while it is still connecting, so a first
 *  acquire handed a client that is not ready yet would log a false outage after
 *  every boot. A Redis that is really down is then reported by that acquire. */
export async function createDownloadLedger(): Promise<RedisDownloadLedger> {
  const client = redis.duplicate({
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: DOWNLOAD_LEDGER_COMMAND_TIMEOUT_MS,
  })
  // Connection errors are the slots' business (a failed call), not an unhandled event.
  client.on("error", () => undefined)
  await connectedOrTimedOut(client)
  return new RedisDownloadLedger({ client: () => client })
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
    const timer = setTimeout(done, DOWNLOAD_LEDGER_COMMAND_TIMEOUT_MS)
    timer.unref?.()
    client.once("ready", done)
  })
}
