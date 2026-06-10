import cron from "node-cron"
import { reconcileInflightJobs } from "./cron.js"

/**
 * Start the external-call reconciliation sweep — every 5 minutes.
 *
 * CORE, deliberately not `ee/` (audit Blocker B2, decision D1): reconcile is
 * a correctness mechanism — it recovers stuck jobs from persisted provider
 * task ids, fail+refunds dead ones, and sweeps orphaned rows. It was
 * previously scheduled inside `ee/billing/cleanup-cron.ts`, which
 * `server.ts` starts only when `hasCredits()` — so Community/Business
 * editions had NO reconcile tick at all and any row left `processing` for
 * recovery (worker stall, inline-reconcile swallow) stranded forever there.
 * Credit operations inside the sweep already no-op or route through the
 * edition-gated shims, so running it in every edition is safe.
 *
 * Env gating mirrors the billing cleanup cron (production, or
 * ENABLE_CLEANUP_CRON=true for local testing) so dev behavior is unchanged.
 */
export function startReconcileCron(): void {
  const env = process.env.NODE_ENV ?? "development"
  const forceEnable = process.env.ENABLE_CLEANUP_CRON === "true"

  if (env !== "production" && !forceEnable) {
    console.log("[cron] Reconcile cron disabled (not production, ENABLE_CLEANUP_CRON not set)")
    return
  }

  // Every 5 minutes — sync-sweep + async recovery (kie-*, replicate-*
  // including replicate-training, elevenlabs-async, suno-voice-*).
  cron.schedule("*/5 * * * *", async () => {
    const start = Date.now()
    try {
      const result = await reconcileInflightJobs()
      if (result.scanned > 0 || result.errors > 0) {
        console.log(
          `[cron] reconcile: scanned=${result.scanned} recovered=${result.recovered} swept=${result.swept} notStale=${result.notStale} errors=${result.errors} (${Date.now() - start}ms)`,
        )
      }
    } catch (err) {
      console.error("[cron] reconcile failed:", err)
    }
  })

  console.log("[cron] Reconcile cron started (every 5 minutes, all editions)")
}
