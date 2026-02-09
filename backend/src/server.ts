import { config, hasCredits } from "./lib/config.js"
import { buildApp } from "./app.js"
import { startCleanupCron } from "./billing/cleanup-cron.js"

async function main() {
  const app = await buildApp()

  await app.listen({ port: config.PORT, host: config.HOST })

  // Start billing cleanup cron jobs (cloud edition only)
  if (hasCredits()) {
    startCleanupCron()
  }
}

main().catch((err) => {
  console.error("Failed to start server:", err)
  process.exit(1)
})
