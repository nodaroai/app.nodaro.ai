import { config, hasCredits } from "./lib/config.js"
import { buildApp } from "./app.js"
import { startCleanupCron } from "./billing/cleanup-cron.js"

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err)
})
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err)
  process.exit(1)
})

async function main() {
  const app = await buildApp()

  await app.listen({ port: config.PORT, host: config.HOST })

  // Start billing cleanup cron jobs (cloud edition only)
  if (hasCredits()) {
    startCleanupCron()
  }

  // Graceful shutdown
  const shutdown = async () => {
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
