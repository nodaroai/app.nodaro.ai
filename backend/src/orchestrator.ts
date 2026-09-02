/**
 * Orchestrator worker entry point.
 * Run as a separate process alongside the server, video-worker, and render-worker.
 *
 * Usage: npx tsx src/orchestrator.ts
 */

import { createOrchestratorWorker } from "./workers/orchestrator-worker.js"
import { loadOverlay } from "./lib/overlay/load.js"
import { registerMainlinePromptPolicies } from "./lib/prompt-policies/index.js"
import { beginWorkerDrain, SHUTDOWN_DRAIN_MS } from "./lib/worker-drain.js"

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

// Mainline prompt policies run AFTER the overlay's (registration order):
// the minor-age floor is a platform safety invariant, not deployment content.
registerMainlinePromptPolicies()

const worker = createOrchestratorWorker()

console.warn("[orchestrator] Worker started, waiting for workflow executions...")

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
