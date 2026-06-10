import cron from "node-cron"
import {
  cleanupFreeUserMedia,
  cleanupCanceledUserMedia,
  expireSubscriptions,
  renewSubscriptionCredits,
  sendStorageWarnings,
  sweepSoftDeletedLocationAssets,
} from "./cleanup-service.js"
import { recordKieCreditSnapshot } from "../routes/admin-kie-credits.js"

/**
 * Start all billing cleanup cron jobs.
 *
 * Schedule:
 * - expireSubscriptions:        every hour at :00
 * - renewSubscriptionCredits:   every hour at :30
 * - recordKieCreditSnapshot:    every hour at :15
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

  // suno-voice sweep migrated to unified reconcile cron:
  //   kie-suno-voice-create   → sync-sweep refunds at 2h
  //   kie-suno-voice-validate → sync-sweep marks failed at 24h
  // See lib/reconcile/types.ts STALE_THRESHOLD_MS.

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

  // NOTE: the external-call reconciliation sweep (reconcileInflightJobs) is
  // deliberately NOT here anymore. It is a core correctness mechanism, not
  // billing — scheduling it behind hasCredits() left Community/Business with
  // no reconcile at all (audit B2). It now starts unconditionally from
  // server.ts via lib/reconcile/start.ts.

  console.log("[cron] Billing cleanup cron jobs started (7 schedules)")
}
