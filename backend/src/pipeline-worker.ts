/**
 * Pipeline orchestration worker entry point.
 *
 * Cloud-only — sibling process to `orchestrator.ts`, started by the
 * Dockerfile's start.sh in the same container. Idle exits cleanly on
 * non-Cloud editions so the same image works for self-hosted builds.
 *
 * The actual worker lives in `ee/workers/pipeline-worker.ts`; we dynamic
 * `import()` it after the edition gate so the EE module isn't pulled into
 * memory in non-Cloud editions. (Dynamic import is invisible to the
 * static `core -> ee` import checker.)
 *
 * Usage: node dist/pipeline-worker.js
 */

import { hasCredits } from "./lib/config.js"

process.on("unhandledRejection", (err) => {
  console.error("[pipeline-worker] Unhandled rejection:", err)
})
process.on("uncaughtException", (err) => {
  console.error("[pipeline-worker] Uncaught exception:", err)
  process.exit(1)
})

async function main() {
  if (!hasCredits()) {
    console.log("[pipeline-worker] EDITION is not cloud — pipeline worker not started")
    return
  }

  const { startPipelineWorker } = await import("./ee/workers/pipeline-worker.js")
  const worker = startPipelineWorker()

  console.log("[pipeline-worker] started, waiting for pipeline orchestration jobs...")

  const shutdown = async () => {
    console.log("[pipeline-worker] shutting down...")
    await worker.close()
    process.exit(0)
  }

  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)
}

main().catch((err) => {
  console.error("[pipeline-worker] fatal:", err)
  process.exit(1)
})
