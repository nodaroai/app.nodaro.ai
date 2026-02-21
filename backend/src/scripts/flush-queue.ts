import { Queue, type ConnectionOptions } from "bullmq"
import IORedis from "ioredis"
import { config } from "../lib/config.js"

async function flushQueues() {
  const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null })

  const videoQueue = new Queue("video-generation", { connection: connection as unknown as ConnectionOptions })
  const webhookQueue = new Queue("webhooks", { connection: connection as unknown as ConnectionOptions })

  const videoCounts = await videoQueue.getJobCounts()
  const webhookCounts = await webhookQueue.getJobCounts()

  console.log("video-generation queue:", videoCounts)
  console.log("webhooks queue:", webhookCounts)

  await videoQueue.obliterate({ force: true })
  await webhookQueue.obliterate({ force: true })

  console.log("All queues flushed.")

  await connection.quit()
  process.exit(0)
}

flushQueues().catch((err) => {
  console.error("Failed to flush queues:", err)
  process.exit(1)
})
