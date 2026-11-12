/**
 * Orchestrator worker entry point.
 * Run as a separate process alongside the server, video-worker, and render-worker.
 *
 * Usage: npx tsx src/orchestrator.ts
 */

import { createOrchestratorWorker } from "./workers/orchestrator-worker.js"
import { loadOverlay } from "./lib/overlay/load.js"
import { loadContentGuard } from "./lib/content-guard-load.js"
import { initializeExternalWallet } from "./lib/external-wallet.js"
import { loadAvailabilityOverrides } from "./lib/availability-override.js"
import { loadSwitchedOffModels } from "./lib/model-switch.js"
import { registerMainlinePromptPolicies } from "./lib/prompt-policies/index.js"
import { useProviderSafetySettings } from "./lib/provider-safety.js"
import { beginWorkerDrain, SHUTDOWN_DRAIN_MS } from "./lib/worker-drain.js"
import { setEditPlanPerMinuteSource } from "./lib/private-plugins/edit-plan-per-minute.js"
import { askApiEditPlanPerMinute } from "./services/workflow-engine/edit-plan-per-minute-loopback.js"
import { setPluginNodeVoicesSource } from "./lib/private-plugins/plugin-node-voices.js"
import { askApiPluginNodeVoices } from "./services/workflow-engine/plugin-node-voices-loopback.js"
import { setHouseModelsServedSource } from "./lib/house-models-served.js"
import { askApiHouseModelsServed } from "./services/workflow-engine/house-models-served-loopback.js"
import { startLaneParking } from "./lib/concurrency-lanes/park.js"
import { startServerOccupancyPublisher } from "./lib/concurrency-lanes/server-occupancy.js"
import { logStorageDeletesAtBoot } from "./lib/storage-deletes-setting.js"

process.on("unhandledRejection", (err) => {
  console.error("[orchestrator] Unhandled rejection:", err)
})
process.on("uncaughtException", (err) => {
  console.error("[orchestrator] Uncaught exception:", err)
  process.exit(1)
})

// This standalone process runs the workflow DAG, whose payload-builder applies
// the registered prompt policies — so it must load any deployment-supplied
// overlay before the worker starts consuming executions. The in-process
// orchestrator worker in server.ts is already covered by buildApp's loadOverlay.
// No-op + byte-identical when NODARO_OVERLAY_PACKAGE is unset.
await loadOverlay()
await loadContentGuard()
await initializeExternalWallet(true)

// Mainline prompt policies run AFTER the overlay's (registration order):
// the minor-age floor is a platform safety invariant, not deployment content.
registerMainlinePromptPolicies()
useProviderSafetySettings()

// The DAG's run-time availability check (executeNode → isNodeDenied) reads the
// admin's stored override. app.ts loads it for the API process; this process
// never builds the app, so it loads it here — otherwise the admin switch does
// not exist for any execution this worker picks up.
await loadAvailabilityOverrides()
// The admin's model switch (model_pricing.is_enabled) — read by the same
// predicate (isModelDenied) on the same lane, loaded here for the same reason.
await loadSwitchedOffModels()

// Edit Plan per started minute (decided 2026-10-07): this process loads no
// plugin, so it asks this container's API whether the plugin charges per
// started minute before it reserves an edit-plan job (fails closed to steps).
setEditPlanPerMinuteSource(() => askApiEditPlanPerMinute())

// The voice lock on a plugin-served speech node (Voice Changer Pro): this
// process loads no plugin, so under a lock it asks this container's API to read
// the node's voices with the reader its plugin declares, then judges them
// before the node's job exists. With no lock it never asks; when the API can't
// answer, the node fails (never an allow).
setPluginNodeVoicesSource((type, data, inputs) => askApiPluginNodeVoices(type, data, inputs))

// House models (docs/design/house-models.md): this process loads no plugin, so
// it asks this container's API which house models the deployment serves — the
// availability rule the payload build applies before a reservation reads it
// (while the API cannot be asked the answer is unknown, and a run on a house
// model is handed back, never refused). Nothing is asked at boot: the engine
// asks before the build of a node that names a house model, so a run of every
// other model never asks or waits (source-size-build.ts).
setHouseModelsServedSource(() => askApiHouseModelsServed())

// Concurrency lanes: promote this queue's parked runs when a slot is reserved
// for them (a release in any process publishes the wake), and wake every
// parked run when enforcement goes off. Started before the worker, so no wake
// arrives before the subscriber is up. Stopped on shutdown.
const stopLaneParking = await startLaneParking(["workflow-orchestration"])

const worker = createOrchestratorWorker()
// This process's share of the orchestrator pool, published every 5 s for the Live usage page. Stopped on shutdown.
const stopServerOccupancy = startServerOccupancyPublisher()

console.warn("[orchestrator] Worker started, waiting for workflow executions...")
// On a deployment that deletes nothing from storage (STORAGE_DELETES=skip), one line saying so, naming this process.
logStorageDeletesAtBoot("orchestrator")

// SHUTDOWN_DRAIN_MS (lib/worker-drain.ts) is the shared Railway grace-window
// deadline. Mirrors backend/src/worker.ts:31-72 — including the note that this
// handler only runs because start.sh (Dockerfile:560-575) forwards TERM to its
// children.
//
// Why the drain matters here (incident class: the six 2026-08-23..09-01
// "Execution orphaned" rows): without it, `worker.close()` waits for the
// active orchestration job, which is sitting in a 3-second job poll loop for
// up to 90 minutes per node. The container was SIGKILLed mid-execution, the
// BullMQ job stayed `active` under its lock, the executions cron skipped it
// (it skips `active`), and the run was eventually marked orphaned.

let shuttingDown = false
const shutdown = async (signal: NodeJS.Signals) => {
  if (shuttingDown) return
  shuttingDown = true
  stopLaneParking()
  stopServerOccupancy()
  console.warn(`[orchestrator] ${signal} received — draining (≤${SHUTDOWN_DRAIN_MS}ms before forced exit)`)
  const hardExit = setTimeout(() => {
    console.error("[orchestrator] Drain timed out, forcing exit")
    process.exit(1)
  }, SHUTDOWN_DRAIN_MS)
  // Deliberately NOT unref'd (mirrors worker.ts): while `worker.close()` is
  // pending on an active job the ioredis sockets hold the loop open anyway, so
  // the timer fires regardless — and a ref'd timer GUARANTEES the
  // "timed out → exit 1" diagnostic instead of a silent exit 0.
  try {
    // Abort in-flight waits: the node-executor job poll loop and every KIE
    // poll sleep check this flag. Handlers throw DrainAbortError, which the
    // orchestrator's drain-safe catches propagate WITHOUT writing `failed`,
    // and the worker wrapper moves the job back to the queue.
    beginWorkerDrain()
    await worker.close()
    console.warn("[orchestrator] Drain complete.")
  } catch (err) {
    console.error("[orchestrator] Error during drain:", err)
  } finally {
    clearTimeout(hardExit)
    process.exit(0)
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"))
process.on("SIGINT", () => void shutdown("SIGINT"))
