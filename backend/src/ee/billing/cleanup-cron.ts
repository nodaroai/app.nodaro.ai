import cron from "node-cron"
import {
  cleanupFreeUserMedia,
  cleanupCanceledUserMedia,
  expireSubscriptions,
  renewSubscriptionCredits,
  sendStorageWarnings,
  sweepSoftDeletedLocationAssets,
  sweepVideoAnalysisTmp,
  expireTopupCredits,
} from "./cleanup-service.js"
import { recordKieCreditSnapshot } from "../routes/admin-kie-credits.js"
import { sweepStaleDcrRegistrations } from "../../lib/oauth-dcr-sweep.js"

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
 * - sweepVideoAnalysisTmp:      daily at 04:30 UTC (double-stall orphan reaper)
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
  // Stale dynamic-client registrations (MCP clients + community instances
  // that started a connection and never consented) — every hour at :15. See
  // lib/oauth-dcr-sweep.ts (#708).
  cron.schedule("15 * * * *", async () => {
    try {
      const { deleted, keptAuthorized } = await sweepStaleDcrRegistrations()
      if (deleted > 0 || keptAuthorized > 0) {
        console.log(`[cron] stale DCR registrations swept: ${deleted} deleted, ${keptAuthorized} kept (consented but unclaimed — see migration 323)`)
      }
    } catch (err) {
      console.error("[cron] stale DCR sweep failed:", err)
    }
  })

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

  // Video-analysis tmp orphan reaper -- daily at 04:30 UTC.
  // The video-analysis worker best-effort deletes its jobId-scoped
  // `video-analysis-tmp/<jobId>/` intermediates in its `finally`; a
  // double-stall / crash skips that teardown and NO DB-driven reaper covers
  // these (they're referenced by nothing in the DB). This sweep reaps whatever
  // is older than 24h — prefix-scoped so it can never touch real outputs.
  cron.schedule("30 4 * * *", async () => {
    console.log("[cron] Starting video-analysis tmp orphan sweep...")
    const start = Date.now()
    try {
      const result = await sweepVideoAnalysisTmp()
      console.log(
        `[cron] video-analysis tmp sweep done: ` +
        `listed=${result.objectsListed} deleted=${result.deleted} ` +
        `failed=${result.failed} skippedOutOfPrefix=${result.skippedOutOfPrefix} ` +
        `(${Date.now() - start}ms)`,
      )
    } catch (err) {
      console.error("[cron] video-analysis tmp sweep failed:", err)
    }
  })

  // Top-up credit expiry (12-month validity) -- daily at 04:45 UTC.
  // Expires the unconsumed remainder of topup_grants past expires_at, FIFO,
  // via the expire_topup_credits RPC (migration 314). Logs each expiry to
  // credit_transactions (source 'expiry') and invalidates the balance cache.
  cron.schedule("45 4 * * *", async () => {
    console.log("[cron] Starting topup credit expiry sweep...")
    const start = Date.now()
    try {
      const result = await expireTopupCredits()
      console.log(
        `[cron] Topup expiry sweep done: users=${result.usersSwept} ` +
        `expired=${result.creditsExpired} errors=${result.errors} ` +
        `(${Date.now() - start}ms)`,
      )
    } catch (err) {
      console.error("[cron] Topup expiry sweep failed:", err)
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

  console.log("[cron] Billing cleanup cron jobs started (8 schedules)")
}
