import { createRenderWorker } from "./workers/render-worker.js"
import { loadOverlay } from "./lib/overlay/load.js"
import { registerMainlinePromptPolicies } from "./lib/prompt-policies/index.js"

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

// Mainline prompt policies run AFTER the overlay's (registration order):
// the minor-age floor is a platform safety invariant, not deployment content.
registerMainlinePromptPolicies()

const worker = createRenderWorker()

console.log("Render worker started, waiting for jobs...")

const shutdown = async () => {
  const timeout = setTimeout(() => {
    console.error("Render worker shutdown timed out, forcing exit")
    process.exit(1)
  }, 30_000)
  try {
    await worker.close()
  } finally {
    clearTimeout(timeout)
  }
  process.exit(0)
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
