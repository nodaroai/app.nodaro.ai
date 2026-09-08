import IORedis from "ioredis"
import { config } from "../config.js"
import { createStageJournal } from "./stage-journal.js"
import { authorizeScene3DJob } from "./scene3d-artifact-toolkit.js"
import type { PluginStageToolkit } from "./scene3d-contract.js"

/** Paid-stage receipts require synchronous append-only persistence and no eviction. */
export function assertScene3DJournalPersistence(raw: unknown): void {
  if (!Array.isArray(raw) || raw.length % 2 !== 0) throw new Error("Scene journal persistence could not be verified")
  const settings = new Map<string, string>()
  for (let i = 0; i < raw.length; i += 2) settings.set(String(raw[i]), String(raw[i + 1]))
  if (settings.get("appendonly") !== "yes" || settings.get("appendfsync") !== "always" ||
      settings.get("maxmemory-policy") !== "noeviction" || settings.get("no-appendfsync-on-rewrite") !== "no") {
    throw new Error("Scene journal requires append-only persistence with synchronous writes and no eviction")
  }
}

let client: IORedis | undefined
let connecting: Promise<void> | undefined

/** Never silently use the shared queue's snapshot-only or evictable storage. */
export function createDurableScene3DStageJournal(): PluginStageToolkit | undefined {
  const url = config.SCENE3D_STAGE_REDIS_URL
  if (!url) return undefined
  const redis = client ??= new IORedis(url, {
    lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false,
    connectTimeout: 5000,
  })
  // Callers receive a sanitized storage failure below; connection errors must
  // never log a connection URL containing credentials.
  if (redis.listenerCount("error") === 0) redis.on("error", () => {})
  return createStageJournal({
    async eval(...args) {
      try {
        if (!connecting && (redis.status === "wait" || redis.status === "end")) {
          connecting = redis.connect().finally(() => { connecting = undefined })
        }
        await connecting
        assertScene3DJournalPersistence(await redis.call("CONFIG", "GET", "appendonly", "appendfsync",
          "maxmemory-policy", "no-appendfsync-on-rewrite"))
        return await redis.eval(...args)
      } catch {
        throw new Error("Durable scene journal is unavailable; this stage was not accepted")
      }
    },
  }, async (scope) => { await authorizeScene3DJob(scope) })
}
