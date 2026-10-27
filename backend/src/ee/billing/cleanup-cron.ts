import cron from "node-cron"
import { reconcileExternalWallet } from "./external-wallet.js"
import {
  purgeSignupAddresses,
  cleanupFreeUserMedia,
  cleanupCanceledUserMedia,
  expireSubscriptions,
  renewSubscriptionCredits,
  sendStorageWarnings,
  sweepSoftDeletedLocationAssets,
  sweepVideoAnalysisTmp,
  sweepEditPlanTmp,
  expireTopupCredits,
} from "./cleanup-service.js"
import { grantYearlyPlanMonthlyCredits } from "./yearly-plan-monthly-credits.js"
import { recordKieCreditSnapshot, fetchKieCreditSnapshotsSince } from "../routes/admin-kie-credits.js"
import { kieRunwayAlert } from "./kie-low-balance-alert.js"
import { sweepStaleDcrRegistrations } from "../../lib/oauth-dcr-sweep.js"
import { sweepAbandonedCopilotWorkflows } from "../copilot/abandoned-sweep.js"
import { sweepUnsyncedConsents } from "../lib/consent-loops-sync.js"
import { runFounderNotifyTick } from "../notifications/founder-notify.js"
import { maybeSendMonthlyStatements } from "../notifications/monthly-statement.js"
import { getNotifyConfig } from "../notifications/notify-config.js"

/**
 * Start all billing cleanup cron jobs.
 *
 * Schedule:
 * - expireSubscriptions:        every hour at :00
 * - renewSubscriptionCredits:   every hour at :30
 * - grantYearlyPlanMonthlyCredits: every hour at :40 (monthly credits on yearly plans)
 * - recordKieCreditSnapshot:    every hour at :15 (also runs kieRunwayAlert)
 * - cleanupFreeUserMedia:       daily at 03:00 UTC
 * - cleanupCanceledUserMedia:   daily at 03:30 UTC
 * - sweepSoftDeletedLocationAssets: daily at 04:00 UTC (Phase 2 #8)
 * - sweepVideoAnalysisTmp:      daily at 04:30 UTC (double-stall orphan reaper)
 * - sweepAbandonedCopilotWorkflows: every hour at :45 (#904)
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
  cron.schedule("* * * * *", () => { void reconcileExternalWallet() })
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

  // Loops contact backfill -- reconcile any consent rows whose Loops state is
  // stale (a failed immediate push, or a change made while Loops was down).
  // Every hour at :50. No-ops when LOOPS_API_KEY is unset.
  cron.schedule("50 * * * *", async () => {
    try {
      const synced = await sweepUnsyncedConsents()
      if (synced > 0) console.log(`[cron] consent->Loops backfill: ${synced} contact(s) reconciled`)
    } catch (err) {
      console.error("[cron] consent->Loops backfill failed:", err)
    }
  })

  // Internal founder notifications (Cloud, internal-only) -- every 5 minutes.
  // Drives the every-signup + first-generation polls and the once-a-day digest
  // (which self-gates on the configured Israel hour). Fully dormant until an
  // admin sets notify_slack_webhook_url; runFounderNotifyTick never throws.
  cron.schedule("*/5 * * * *", async () => {
    try {
      await runFounderNotifyTick()
    } catch (err) {
      console.error("[cron] founder notify tick failed:", err)
    }
    // The monthly credit statement to each person who opted in: from the digest
    // hour of the 1st (Israel time) until the month is closed. Dormant without
    // LOOPS_MONTHLY_STATEMENT_ID, and on the standby sender; never throws.
    try {
      await maybeSendMonthlyStatements(new Date(), (await getNotifyConfig()).digestHour)
    } catch (err) {
      console.error("[cron] monthly statement tick failed:", err)
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

  // Monthly credits on yearly plans -- every hour at :40 (decided 2026-10-15).
  // A yearly price moves its billing period once a year, so the renewal above
  // fires once a year; this step SETs the plan's monthly credits at each
  // monthly anchor in between. Idempotent per anchor in the database
  // (migration 527), so replicas, and staging sharing production's database,
  // can all run it.
  cron.schedule("40 * * * *", async () => {
    const start = Date.now()
    try {
      const result = await grantYearlyPlanMonthlyCredits()
      if (result.granted > 0 || result.refused > 0 || result.errors > 0) {
        console.log(
          `[cron] Yearly-plan monthly credits: ${result.granted} granted, ${result.refused} refused, ${result.errors} errors (${Date.now() - start}ms)`,
        )
      }
    } catch (err) {
      console.error("[cron] Yearly-plan monthly credits failed:", err)
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

  // Signup addresses (migration 507) are kept 60 days for measuring the
  // free-grant gate's network rules, then dropped -- daily at 04:15 UTC.
  cron.schedule("15 4 * * *", async () => {
    try {
      const purged = await purgeSignupAddresses()
      if (purged > 0) console.log(`[cron] Signup addresses purged: ${purged}`)
    } catch (err) {
      console.error("[cron] Signup address purge failed:", err)
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
      // Both cloud-plugin JSON producers key transient intermediates under their
      // own `*-tmp/` prefix and self-delete in `finally`; a double-stall skips
      // that, and no DB reaper covers them. Sweep both, each prefix-scoped.
      const result = await sweepVideoAnalysisTmp()
      const editPlan = await sweepEditPlanTmp()
      console.log(
        `[cron] tmp orphan sweep done: ` +
        `video-analysis(listed=${result.objectsListed} deleted=${result.deleted} failed=${result.failed}) ` +
        `edit-plan(listed=${editPlan.objectsListed} deleted=${editPlan.deleted} failed=${editPlan.failed}) ` +
        `(${Date.now() - start}ms)`,
      )
    } catch (err) {
      console.error("[cron] tmp orphan sweep failed:", err)
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

    // Low-balance runway alert, ahead of the account actually hitting zero
    // (2026-08-31 20:31Z: the first signal was four user jobs failing with
    // "[ALERT] KIE.ai account balance exhausted" mid-generation). Runs
    // hourly right alongside the snapshot it reads, so "once per hour" dedup
    // is free -- no extra state. Own try/catch: a failure here must never be
    // reported as the snapshot itself failing, and must never take the cron
    // down.
    try {
      const snapshots = await fetchKieCreditSnapshotsSince(36)
      const alert = kieRunwayAlert(snapshots, new Date())
      if (alert) {
        console.error(alert)
      }
    } catch (err) {
      console.error("[cron] KIE low-balance check failed:", err)
    }
  })

  // Empty workflows a failed home-page copilot handoff left behind (#904) --
  // every hour at :45. See ee/copilot/abandoned-sweep.ts; a no-op until
  // migration 346 reaches the database.
  cron.schedule("45 * * * *", async () => {
    try {
      const result = await sweepAbandonedCopilotWorkflows()
      // Saturation means the pass deleted nothing because it could not PROVE
      // the batch was unspoken — the one outcome that must never read as a
      // quiet "nothing to do".
      if (result.saturated) {
        console.warn("[cron] abandoned copilot seed sweep deferred: the turn probe came back at its ceiling")
      } else if (result.deleted > 0 || result.kept > 0) {
        console.log(
          `[cron] abandoned copilot seeds swept: ${result.deleted} deleted, ` +
          `${result.kept} kept (canvas in use, or touched recently)`,
        )
      }
    } catch (err) {
      console.error("[cron] abandoned copilot workflow sweep failed:", err)
    }
  })

  // NOTE: the external-call reconciliation sweep (reconcileInflightJobs) is
  // deliberately NOT here anymore. It is a core correctness mechanism, not
  // billing — scheduling it behind hasCredits() left Community/Business with
  // no reconcile at all (audit B2). It now starts unconditionally from
  // server.ts via lib/reconcile/start.ts.

  console.log("[cron] Billing cleanup cron jobs started (10 schedules)")
}
