// backend/src/lib/queue-connection.ts — the one BullMQ Redis connection of the
// process, shared by every queue (lib/queue.ts re-exports it as `redis`) and
// by the concurrency gate (concurrency-lanes/instance.ts). A leaf: it imports
// only the config, so the gate reaches the connection without importing the
// queue module, whose removal funnel itself reaches the gate.
import IORedis from "ioredis"
import { config } from "./config.js"

export const redis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null })
