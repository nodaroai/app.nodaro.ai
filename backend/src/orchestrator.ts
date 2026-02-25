/**
 * Orchestrator worker entry point.
 * Run as a separate process alongside the server, video-worker, and render-worker.
 *
 * Usage: npx tsx src/orchestrator.ts
 */

import { createOrchestratorWorker } from "./workers/orchestrator-worker.js"

process.on("unhandledRejection", (err) => {
  console.error("[orchestrator] Unhandled rejection:", err)
})
process.on("uncaughtException", (err) => {
  console.error("[orchestrator] Uncaught exception:", err)
  process.exit(1)
})

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
