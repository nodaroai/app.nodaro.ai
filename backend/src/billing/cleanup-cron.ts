import cron from "node-cron"
import {
  cleanupFreeUserMedia,
  cleanupCanceledUserMedia,
  expireSubscriptions,
  renewSubscriptionCredits,
  sendStorageWarnings,
} from "./cleanup-service.js"
import { recordKieCreditSnapshot } from "../routes/admin-kie-credits.js"

/**
 * Start all billing cleanup cron jobs.
 *
 * Schedule:
 * - expireSubscriptions:       every hour at :00
 * - renewSubscriptionCredits:  every hour at :30
 * - cleanupFreeUserMedia:      daily at 03:00 UTC
 * - cleanupCanceledUserMedia:  daily at 03:30 UTC
 * - sendStorageWarnings:       daily at 09:00 UTC
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

  console.log("[cron] Billing cleanup cron jobs started (6 schedules)")
}
