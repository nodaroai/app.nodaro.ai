import { Queue } from "bullmq"
import IORedis from "ioredis"
import { config } from "./config.js"

export const redis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null })

export const videoQueue = new Queue("video-generation", { connection: redis })
export const webhookQueue = new Queue("webhooks", { connection: redis })
