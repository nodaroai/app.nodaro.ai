import { createRenderWorker } from "./workers/render-worker.js"
import { loadOverlay } from "./lib/overlay/load.js"
import { loadContentGuard } from "./lib/content-guard-load.js"
import { initializeExternalWallet } from "./lib/external-wallet.js"
import { registerMainlinePromptPolicies } from "./lib/prompt-policies/index.js"
import { useProviderSafetySettings } from "./lib/provider-safety.js"
import { beginWorkerDrain, SHUTDOWN_DRAIN_MS } from "./lib/worker-drain.js"
import { startLaneParking } from "./lib/concurrency-lanes/park.js"
import { startServerOccupancyPublisher } from "./lib/concurrency-lanes/server-occupancy.js"
import { logStorageDeletesAtBoot } from "./lib/storage-deletes-setting.js"
import { startProcessShortageWatch } from "./lib/process-shortage.js"
import { isRendererEncoderDeath, renderWatch } from "./workers/render-shortage.js"

process.on("unhandledRejection", (err) => {
  // The renderer says that a render's encoder quit only this way: it rejects a
  // promise nobody awaits and keeps drawing frames. The render that stops
  // making progress after it is stopped by the watch (render-shortage.ts).
  if (isRendererEncoderDeath(err)) renderWatch().noteEncoderDeath(err)
  console.error("Unhandled rejection:", err)
})
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err)
  process.exit(1)
})

// Load any deployment-supplied overlay (e.g. egress decorator) before the
// render worker starts consuming jobs. No-op when NODARO_OVERLAY_PACKAGE unset.
await loadOverlay()
await loadContentGuard()
await initializeExternalWallet(true)

// Mainline prompt policies run AFTER the overlay's (registration order):
// the minor-age floor is a platform safety invariant, not deployment content.
registerMainlinePromptPolicies()
useProviderSafetySettings()

// Concurrency lanes: promote this queue's parked jobs when a slot is reserved
// for them, and wake every parked job when enforcement goes off. Started before the worker,
// so no wake arrives before the subscriber is up. Stopped on shutdown.
const stopLaneParking = await startLaneParking(["video-render"])

const worker = createRenderWorker()
// This process's share of the render pool, published every 5 s for the Live usage page. Stopped on shutdown.
const stopServerOccupancy = startServerOccupancyPublisher()

console.log("Render worker started, waiting for jobs...")
// The process limit this container really has, then one line whenever the kernel refuses a process or thread. Stopped on shutdown.
const stopShortageWatch = startProcessShortageWatch("render-worker")
// On a deployment that deletes nothing from storage (STORAGE_DELETES=skip), one line saying so, naming this process.
logStorageDeletesAtBoot("render-worker")

const shutdown = async () => {
  stopLaneParking()
  stopServerOccupancy()
  stopShortageWatch()
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
