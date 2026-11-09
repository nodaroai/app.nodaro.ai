import { createVideoWorker } from "./workers/video-worker.js"
import { logFfmpegVersion } from "./providers/video/ffmpeg-utils.js"
import { beginWorkerDrain, inFlightDrainDeadlineMs } from "./lib/worker-drain.js"
import { createWorkerShutdown } from "./lib/worker-shutdown.js"
import { loadOverlay } from "./lib/overlay/load.js"
import { loadContentGuard } from "./lib/content-guard-load.js"
import { initializeExternalWallet } from "./lib/external-wallet.js"
import { registerMainlinePromptPolicies } from "./lib/prompt-policies/index.js"
import { startLaneParking } from "./lib/concurrency-lanes/park.js"
import { startServerOccupancyPublisher } from "./lib/concurrency-lanes/server-occupancy.js"

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err)
})
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err)
  process.exit(1)
})

// Load any deployment-supplied overlay (egress decorator / prompt policies /
// packs) before the worker starts consuming jobs — the seams are per-process
// singletons. No-op + byte-identical when NODARO_OVERLAY_PACKAGE is unset.
await loadOverlay()
await loadContentGuard()
await initializeExternalWallet(true)

// Mainline prompt policies run AFTER the overlay's (registration order):
// the minor-age floor is a platform safety invariant, not deployment content.
registerMainlinePromptPolicies()

// Concurrency lanes: promote this queue's parked jobs when a slot is reserved
// for them (a release in any process publishes the wake), and wake every
// parked job when enforcement goes off. Started before the worker,
// so no wake arrives before the subscriber is up. Stopped on shutdown.
const stopLaneParking = await startLaneParking(["video-generation"])

const worker = createVideoWorker()
// This process's share of the video pool, published every 5 s for the Live usage page. Stopped on shutdown.
const stopServerOccupancy = startServerOccupancyPublisher()

console.log("Worker started, waiting for jobs...")
// One line, on boot: which ffmpeg is this worker rendering with? Output is
// version-dependent (see the Dockerfile FFMPEG_VERSION pin).
logFfmpegVersion("worker")

// NOTE (incident 2026-07-15): this handler only runs if the signal actually
// REACHES this process — start.sh must forward SIGTERM to its background
// children (it previously exec'd Caddy as PID 1, so node processes were
// SIGKILLed without ever draining and their BullMQ locks dangled for the
// full lockDuration). Keep worker.ts + start.sh in sync when touching either.
//
// The drain (lib/worker-shutdown.ts) flips the process drain BEFORE
// `worker.close()`:
//  - every in-flight provider POLL aborts at its next wait point (the shared
//    poll sleep in providers/kie/client.ts throws DrainAbortError), the
//    video-worker catch moves the job back to the queue at zero cost, and the
//    replacement container re-picks it seconds after boot;
//  - a private plugin's in-flight PAID stage (a Scene3D planner or critic
//    call) is NOT aborted — its response exists only in this process — so it
//    finishes and persists, and the plugin hands the job back at its next
//    stage boundary (the journal's `handOffOnDrain` claim option).
//
// The deadline is therefore the PLATFORM's window, not a fixed literal:
// `inFlightDrainDeadlineMs()` reads RAILWAY_DEPLOYMENT_DRAINING_SECONDS (minus
// a log-flush margin) and falls back to SHUTDOWN_DRAIN_MS when it is unset.
// Evidence 2026-09-15 (jobs 351f0270, 35bd1f1f): with the variable unset the
// container was killed ~11 s after SIGTERM while a planner call was 16–42 s
// into its up-to-360 s budget, and the successor failed and refunded the run.
const shutdown = createWorkerShutdown({
  label: "worker",
  worker,
  deadlineMs: inFlightDrainDeadlineMs(),
  beginDrain: beginWorkerDrain,
  exit: (code) => process.exit(code),
})
process.on("SIGTERM", () => { stopLaneParking(); stopServerOccupancy(); void shutdown("SIGTERM") })
process.on("SIGINT", () => { stopLaneParking(); stopServerOccupancy(); void shutdown("SIGINT") })
