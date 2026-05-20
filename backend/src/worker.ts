import { createVideoWorker } from "./workers/video-worker.js"

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err)
})
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err)
  process.exit(1)
})

const worker = createVideoWorker()

console.log("Worker started, waiting for jobs...")

// Railway's SIGTERM grace window before SIGKILL is ~30s. We drain for at
// most 25s so logs flush and we exit cleanly before the kill lands. Jobs
// that don't finish in that window become BullMQ "stalled" on the new
// worker, which fires the stall-retry inline-reconcile path (see
// `workers/inline-reconcile.ts`). Short jobs (image gen, etc.) finish here
// and never need to stall-retry — that's the win this drain buys us.
const SHUTDOWN_DRAIN_MS = 25_000

let shuttingDown = false
const shutdown = async (signal: NodeJS.Signals) => {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[worker] ${signal} received — draining (≤${SHUTDOWN_DRAIN_MS}ms before forced exit)`)
  const hardExit = setTimeout(() => {
    console.error("[worker] Drain timed out, forcing exit")
    process.exit(1)
  }, SHUTDOWN_DRAIN_MS)
  try {
    // worker.close() with default `force=false` stops accepting new jobs
    // and waits for active jobs to settle. Combined with the hardExit
    // setTimeout above, this means: short jobs win the drain, long polls
    // hit the timeout and stall-retry recovers them on the new worker.
    await worker.close()
    console.log("[worker] Drain complete.")
  } catch (err) {
    console.error("[worker] Error during drain:", err)
  } finally {
    clearTimeout(hardExit)
    process.exit(0)
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"))
process.on("SIGINT", () => void shutdown("SIGINT"))
