import { createVideoWorker } from "./workers/video-worker.js"
import { logFfmpegVersion } from "./providers/video/ffmpeg-utils.js"
import { beginWorkerDrain } from "./lib/worker-drain.js"

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err)
})
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err)
  process.exit(1)
})

const worker = createVideoWorker()

console.log("Worker started, waiting for jobs...")
// One line, on boot: which ffmpeg is this worker rendering with? Output is
// version-dependent (see the Dockerfile FFMPEG_VERSION pin).
logFfmpegVersion("worker")

// Railway's SIGTERM grace window before SIGKILL is ~30s. We drain for at
// most 25s so logs flush and we exit cleanly before the kill lands.
//
// NOTE (incident 2026-07-15): this handler only runs if the signal actually
// REACHES this process — start.sh must forward SIGTERM to its background
// children (it previously exec'd Caddy as PID 1, so node processes were
// SIGKILLed without ever draining and their BullMQ locks dangled for the
// full lockDuration). Keep worker.ts + start.sh in sync when touching either.
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
    // Abort every in-flight provider wait (the shared poll sleep in
    // providers/kie/client.ts throws DrainAbortError once this flips).
    // Handlers exit fast, the video-worker catch rethrows, and BullMQ
    // requeues each active job WITH ITS LOCK RELEASED — so the replacement
    // process re-picks them seconds after boot instead of waiting out
    // lockDuration. Without this, worker.close() would sit on active poll
    // loops (75s+) until the hardExit timeout and the locks died held.
    beginWorkerDrain()
    // worker.close() with default `force=false` stops accepting new jobs
    // and waits for active jobs to settle — which is now fast, because the
    // drain flag above aborts their provider waits at the next wait point.
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
