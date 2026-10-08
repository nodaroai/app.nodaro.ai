/**
 * This process's view of the account's download slots (decided 2026-10-08): the
 * one `DownloadSlots` the route's downloads, the app runner's card and a run's
 * pre-run fetch all take their slot from, so they count against each other.
 *
 * `DOWNLOAD_SLOT_LEDGER=redis` (default) shares the cap across processes
 * through Redis; `local` counts this process's downloads only (a deployment with
 * one backend process, tests). The Redis client is built on the first download
 * and re-tried after a failure, never at import.
 */
import { config } from "./config.js"
import { DownloadSlots } from "./download-slots.js"
import type { RedisDownloadLedger } from "./download-slot-ledger.js"

let ledgerPromise: Promise<RedisDownloadLedger> | undefined

/** The ledger, built on first use; a failed build is not cached (the next probe tries again). */
function sharedLedger(): Promise<RedisDownloadLedger> {
  ledgerPromise ??= import("./download-slots-redis.js")
    .then((m) => m.createDownloadLedger())
    .catch((error: unknown) => {
      ledgerPromise = undefined
      throw error
    })
  return ledgerPromise
}

let instance: DownloadSlots | undefined

export function downloadSlots(): DownloadSlots {
  // Anything but an explicit "redis" (a config stub, a test) counts locally.
  instance ??= new DownloadSlots(config.DOWNLOAD_SLOT_LEDGER === "redis" ? { ledger: sharedLedger } : {})
  return instance
}

/** Replace (or, with no argument, forget) this process's slots. For tests. */
export function setDownloadSlotsForTests(slots?: DownloadSlots): void {
  instance = slots
}
