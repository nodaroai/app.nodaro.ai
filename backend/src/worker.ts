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

const shutdown = async () => {
  const timeout = setTimeout(() => {
    console.error("Worker shutdown timed out, forcing exit")
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
