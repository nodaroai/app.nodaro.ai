import { config, hasCredits } from "./lib/config.js"
import { buildApp } from "./app.js"
import { startCleanupCron } from "./ee/billing/cleanup-cron.js"
import { startScheduleCron, stopScheduleCron } from "./lib/schedule-cron.js"
import { createOrchestratorWorker } from "./workers/orchestrator-worker.js"
import { initTelegramRoutingTable } from "./lib/telegram-router.js"
import { pipelineEvents } from "./ee/pipelines/events.js"

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err)
})
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err)
  process.exit(1)
})

async function main() {
  const app = await buildApp()

  // Load Telegram routing table before accepting traffic
  try {
    await initTelegramRoutingTable()
  } catch (err) {
    console.error("[telegram] Failed to load routing table:", err)
  }

  await app.listen({ port: config.PORT, host: config.HOST })

  // Start billing cleanup cron jobs (cloud edition only)
  if (hasCredits()) {
    startCleanupCron()
  }

  // Start schedule cron for workflow triggers
  startScheduleCron()

  // Start orchestrator worker (workflow execution engine) in-process
  const orchestratorWorker = createOrchestratorWorker()
  console.log("[orchestrator] Worker started in-process")

  // Boot the cross-process pipeline event bridge so events published by
  // the pipeline-worker (separate process) reach SSE subscribers here.
  // Without this, every pipelineEvents.publish() from the worker hits a
  // dead local EventEmitter and the browser never sees real-time updates
  // (stage:progress, entity:status, stage:status, etc. — they all go
  // through this broker). 3s React Query polling masks the gap for most
  // events but transient sub-second events like stage:progress are
  // completely lost without the bridge.
  if (hasCredits()) {
    try {
      await pipelineEvents.startCrossProcessBridge()
    } catch (err) {
      console.error("[pipelineEvents] Failed to start cross-process bridge:", err)
    }
  }

  // Graceful shutdown
  const shutdown = async () => {
    stopScheduleCron()
    await orchestratorWorker.close()
    await app.close()
    process.exit(0)
  }
  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)
}

main().catch((err) => {
  console.error("Failed to start server:", err)
  process.exit(1)
})
