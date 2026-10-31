import { createRenderWorker } from "./workers/render-worker.js"
import { loadOverlay } from "./lib/overlay/load.js"
import { initializeExternalWallet } from "./lib/external-wallet.js"
import { registerMainlinePromptPolicies } from "./lib/prompt-policies/index.js"
import { beginWorkerDrain, SHUTDOWN_DRAIN_MS } from "./lib/worker-drain.js"
import { startLaneParking } from "./lib/concurrency-lanes/park.js"
import { startServerOccupancyPublisher } from "./lib/concurrency-lanes/server-occupancy.js"

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err)
})
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err)
  process.exit(1)
})

// Load any deployment-supplied overlay (e.g. egress decorator) before the
// render worker starts consuming jobs. No-op when NODARO_OVERLAY_PACKAGE unset.
await loadOverlay()
await initializeExternalWallet(true)

// Mainline prompt policies run AFTER the overlay's (registration order):
// the minor-age floor is a platform safety invariant, not deployment content.
registerMainlinePromptPolicies()

// Concurrency lanes: promote this queue's parked jobs when a slot is reserved
// for them, and wake every parked job when enforcement goes off. Started before the worker,
// so no wake arrives before the subscriber is up. Stopped on shutdown.
const stopLaneParking = await startLaneParking(["video-render"])

const worker = createRenderWorker()
// This process's share of the render pool, published every 5 s for the Live usage page. Stopped on shutdown.
const stopServerOccupancy = startServerOccupancyPublisher()

console.log("Render worker started, waiting for jobs...")

const shutdown = async () => {
  stopLaneParking()
  stopServerOccupancy()
  beginWorkerDrain()
  const timeout = setTimeout(() => {
    console.error("Render worker shutdown timed out, forcing exit")
    process.exit(1)
  }, SHUTDOWN_DRAIN_MS)
  try {
    await worker.close()
  } finally {
    clearTimeout(timeout)
  }
  process.exit(0)
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
