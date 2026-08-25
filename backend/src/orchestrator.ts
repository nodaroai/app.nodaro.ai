/**
 * Orchestrator worker entry point.
 * Run as a separate process alongside the server, video-worker, and render-worker.
 *
 * Usage: npx tsx src/orchestrator.ts
 */

import { createOrchestratorWorker } from "./workers/orchestrator-worker.js"
import { loadOverlay } from "./lib/overlay/load.js"

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

const worker = createOrchestratorWorker()

console.log("[orchestrator] Worker started, waiting for workflow executions...")

// Graceful shutdown
const shutdown = async () => {
  console.log("[orchestrator] Shutting down...")
  await worker.close()
  process.exit(0)
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
