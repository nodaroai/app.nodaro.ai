/**
 * Pipeline orchestration worker entry point.
 *
 * Cloud-only — sibling process to `orchestrator.ts`, started by the
 * Dockerfile's start.sh in the same container. Idle exits cleanly on
 * non-Cloud editions so the same image works for self-hosted builds.
 *
 * The actual worker lives in `ee/workers/pipeline-worker.ts`; we dynamic
 * `import()` it after the edition gate so the EE module isn't pulled into
 * memory in non-Cloud editions. (Dynamic import is invisible to the
 * static `core -> ee` import checker.)
 *
 * Usage: node dist/pipeline-worker.js
 */

import { hasCredits } from "./lib/config.js"
import { loadOverlay } from "./lib/overlay/load.js"
import { loadContentGuard } from "./lib/content-guard-load.js"
import { initializeExternalWallet } from "./lib/external-wallet.js"
import { registerMainlinePromptPolicies } from "./lib/prompt-policies/index.js"
import { useProviderSafetySettings } from "./lib/provider-safety.js"
import { startLaneParking } from "./lib/concurrency-lanes/park.js"
import { startServerOccupancyPublisher } from "./lib/concurrency-lanes/server-occupancy.js"
import { logStorageDeletesAtBoot } from "./lib/storage-deletes-setting.js"

process.on("unhandledRejection", (err) => {
  console.error("[pipeline-worker] Unhandled rejection:", err)
})
process.on("uncaughtException", (err) => {
  console.error("[pipeline-worker] Uncaught exception:", err)
  process.exit(1)
})

async function main() {
  // Load any deployment-supplied overlay before the pipeline worker starts —
  // ahead of the hasCredits() gate so a cloud pipeline process still loads it.
  // No-op + byte-identical when NODARO_OVERLAY_PACKAGE is unset.
  await loadOverlay()
  await loadContentGuard()
  await initializeExternalWallet(true)

  // Mainline prompt policies run AFTER the overlay's (registration order):
  // the minor-age floor is a platform safety invariant, not deployment content.
  registerMainlinePromptPolicies()
  useProviderSafetySettings()

  if (!hasCredits()) {
    console.log("[pipeline-worker] EDITION is not cloud — pipeline worker not started")
    return
  }

  // Concurrency lanes: promote this queue's parked pipelines when a slot is
  // reserved for them, and wake every parked one when enforcement goes off.
  // Started before the worker, so no wake arrives before the subscriber is up.
  const stopLaneParking = await startLaneParking(["pipeline-orchestration"])

  const { startPipelineWorker } = await import("./ee/workers/pipeline-worker.js")
  const worker = startPipelineWorker()
  // This process's share of the pipeline pool, published every 5 s for the Live usage page.
  const stopServerOccupancy = startServerOccupancyPublisher()

  console.log("[pipeline-worker] started, waiting for pipeline orchestration jobs...")
  // On a deployment that deletes nothing from storage (STORAGE_DELETES=skip), one line saying so, naming this process.
  logStorageDeletesAtBoot("pipeline-worker")

  const shutdown = async () => {
    console.log("[pipeline-worker] shutting down...")
    stopLaneParking()
    stopServerOccupancy()
    await worker.close()
    process.exit(0)
  }

  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)
}

main().catch((err) => {
  console.error("[pipeline-worker] fatal:", err)
  process.exit(1)
})
