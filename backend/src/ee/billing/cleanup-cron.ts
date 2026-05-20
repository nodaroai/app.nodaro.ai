import cron from "node-cron"
import {
  cleanupFreeUserMedia,
  cleanupCanceledUserMedia,
  expireSubscriptions,
  renewSubscriptionCredits,
  sendStorageWarnings,
  sweepStaleVoiceJobs,
  sweepSoftDeletedLocationAssets,
} from "./cleanup-service.js"
import { recordKieCreditSnapshot } from "../routes/admin-kie-credits.js"
import { reconcileInflightJobs } from "../../lib/reconcile/cron.js"

/**
 * Start all billing cleanup cron jobs.
 *
 * Schedule:
 * - expireSubscriptions:        every hour at :00
 * - renewSubscriptionCredits:   every hour at :30
 * - sweepStaleVoiceJobs:        every hour at :45 (refund abandoned suno-voice-create)
 * - recordKieCreditSnapshot:    every hour at :15
 * - reconcileInflightJobs:      every 5 minutes (sync-sweep + async recovery
 *                                including replicate-training)
 * - cleanupFreeUserMedia:       daily at 03:00 UTC
 * - cleanupCanceledUserMedia:   daily at 03:30 UTC
 * - sweepSoftDeletedLocationAssets: daily at 04:00 UTC (Phase 2 #8)
 * - sendStorageWarnings:        daily at 09:00 UTC
 *
 * All jobs are idempotent and wrapped in try/catch to prevent server crashes.
 * Only runs in production or when ENABLE_CLEANUP_CRON=true.
 */
export function startCleanupCron(): void {
  const env = process.env.NODE_ENV ?? "development"
  const forceEnable = process.env.ENABLE_CLEANUP_CRON === "true"

  if (env !== "production" && !forceEnable) {
    console.log("[cron] Cleanup cron disabled (not production, ENABLE_CLEANUP_CRON not set)")
    return
  }

  // Expire subscriptions -- every hour
  cron.schedule("0 * * * *", async () => {
    console.log("[cron] Starting subscription expiry check...")
    const start = Date.now()
    try {
      const result = await expireSubscriptions()
      console.log(
        `[cron] Subscription expiry done: ${result.usersDowngraded} downgraded (${Date.now() - start}ms)`
      )
    } catch (err) {
      console.error("[cron] Subscription expiry failed:", err)
    }
  })

  // Renew subscription credits (safety net) -- every hour at :30
  cron.schedule("30 * * * *", async () => {
    console.log("[cron] Starting subscription credit renewal check...")
    const start = Date.now()
    try {
      const result = await renewSubscriptionCredits()
      console.log(
        `[cron] Credit renewal done: ${result.usersRenewed} renewed (${Date.now() - start}ms)`
      )
    } catch (err) {
      console.error("[cron] Credit renewal failed:", err)
    }
  })

  // Sweep stale suno-voice jobs -- every hour at :45
  cron.schedule("45 * * * *", async () => {
    console.log("[cron] Starting suno-voice sweep...")
    const start = Date.now()
    try {
      const result = await sweepStaleVoiceJobs()
      console.log(
        `[cron] Voice sweep done: ` +
        `create.refunded=${result.created.refunded} create.failed=${result.created.markedFailed} ` +
        `validate.failed=${result.validate.markedFailed} errors=${result.errors} ` +
        `(${Date.now() - start}ms)`
      )
    } catch (err) {
      console.error("[cron] Voice sweep failed:", err)
    }
  })

  // Free user media cleanup -- daily at 03:00 UTC
  cron.schedule("0 3 * * *", async () => {
    console.log("[cron] Starting free user media cleanup...")
    const start = Date.now()
    try {
      const result = await cleanupFreeUserMedia()
      console.log(
        `[cron] Free cleanup done: ${result.filesDeleted} files, ${result.bytesFreed} bytes (${Date.now() - start}ms)`
      )
    } catch (err) {
      console.error("[cron] Free cleanup failed:", err)
    }
  })

  // Canceled user media cleanup -- daily at 03:30 UTC
  cron.schedule("30 3 * * *", async () => {
    console.log("[cron] Starting canceled user media cleanup...")
    const start = Date.now()
    try {
      const result = await cleanupCanceledUserMedia()
      console.log(
        `[cron] Canceled cleanup done: ${result.filesDeleted} files, ${result.bytesFreed} bytes (${Date.now() - start}ms)`
      )
    } catch (err) {
      console.error("[cron] Canceled cleanup failed:", err)
    }
  })

  // Soft-deleted location asset purge (Phase 2 #8) -- daily at 04:00 UTC.
  // 30-day grace period from `deleted_at`; sweep makes the R2 keys 404 from
  // direct CDN URLs without touching the DB row (so the location can still
  // be inspected post-purge, just without working images).
  cron.schedule("0 4 * * *", async () => {
    console.log("[cron] Starting soft-deleted location asset sweep...")
    const start = Date.now()
    try {
      const result = await sweepSoftDeletedLocationAssets()
      console.log(
        `[cron] Location quarantine sweep done: ` +
        `rowsScanned=${result.rowsScanned} rowsPurged=${result.rowsPurged} ` +
        `r2KeysDeleted=${result.r2KeysDeleted} errors=${result.errors} ` +
        `(${Date.now() - start}ms)`,
      )
    } catch (err) {
      console.error("[cron] Location quarantine sweep failed:", err)
    }
  })

  // Storage warnings -- daily at 09:00 UTC
  cron.schedule("0 9 * * *", async () => {
    console.log("[cron] Starting storage warning check...")
    const start = Date.now()
    try {
      const result = await sendStorageWarnings()
      console.log(
        `[cron] Storage warnings done: ${result.warnings80} at 80%, ${result.warnings95} at 95%, ${result.warningsFull} full (${Date.now() - start}ms)`
      )
    } catch (err) {
      console.error("[cron] Storage warnings failed:", err)
    }
  })

  // KIE.ai credit balance snapshot -- every hour at :15
  cron.schedule("15 * * * *", async () => {
    console.log("[cron] Recording KIE credit snapshot...")
    const start = Date.now()
    try {
      const result = await recordKieCreditSnapshot()
      if (result) {
        console.log(`[cron] KIE credit snapshot: ${result.credits} credits (${Date.now() - start}ms)`)
      } else {
        console.log(`[cron] KIE credit snapshot skipped (no API key or fetch failed)`)
      }
    } catch (err) {
      console.error("[cron] KIE credit snapshot failed:", err)
    }
  })

  // External-call reconciliation sweep — every 5 minutes.
  // Replaces the standalone Character LoRA training cron: replicate-training
  // rows are now dispatched through reconcileReplicateJob.
  cron.schedule("*/5 * * * *", async () => {
    const start = Date.now()
    try {
      const result = await reconcileInflightJobs()
      if (result.scanned > 0 || result.errors > 0) {
        console.log(
          `[cron] reconcile: scanned=${result.scanned} recovered=${result.recovered} swept=${result.swept} skippedAsync=${result.skippedAsync} notStale=${result.notStale} errors=${result.errors} (${Date.now() - start}ms)`,
        )
      }
    } catch (err) {
      console.error("[cron] reconcile failed:", err)
    }
  })

  console.log("[cron] Billing cleanup cron jobs started (9 schedules)")
}
