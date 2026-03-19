import { config, hasCredits } from "./lib/config.js"
import { buildApp } from "./app.js"
import { startCleanupCron } from "./billing/cleanup-cron.js"
import { startScheduleCron, stopScheduleCron } from "./lib/schedule-cron.js"
import { createOrchestratorWorker } from "./workers/orchestrator-worker.js"
import { initTelegramRoutingTable } from "./lib/telegram-router.js"

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
