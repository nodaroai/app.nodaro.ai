import { createVideoWorker } from "./workers/video-worker.js"

const worker = createVideoWorker()

console.log("Worker started, waiting for jobs...")

process.on("SIGINT", async () => {
  await worker.close()
  process.exit(0)
})
