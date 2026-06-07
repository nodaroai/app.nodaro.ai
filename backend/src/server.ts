import { config, hasCredits, isMultiUser } from "./lib/config.js"
import { buildApp } from "./app.js"
import { startCommunityReaperCron } from "./ee/services/community/reaper.js"
import { startCleanupCron } from "./ee/billing/cleanup-cron.js"
import { startScheduleCron, stopScheduleCron } from "./lib/schedule-cron.js"
import {
  startWorkflowExecutionsReconcileCron,
  stopWorkflowExecutionsReconcileCron,
} from "./lib/reconcile/workflow-executions-cron.js"
import {
  startPipelinesReconcileCron,
  stopPipelinesReconcileCron,
} from "./ee/pipelines/reconcile-cron.js"
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

  // Backstop reaper for orphaned community-listing blobs (multi-user editions)
  if (isMultiUser()) startCommunityReaperCron()

  // Periodic reconciler for stuck workflow_executions — catches executions
  // that the orchestrator failed to advance (lost wake-ups, DB write
  // failures, mid-flight crashes). Boot-time `cleanupStaleExecutions`
  // handles the at-boot case; this fills the gap while the process stays
  // alive. Worst-case stuck window is ~90s.
  startWorkflowExecutionsReconcileCron()

  // Same pattern for Film Director pipelines (Cloud only — pipelines are
  // an EE feature). Catches pipelines whose BullMQ orchestration job was
  // lost (see `ee/pipelines/reconcile-cron.ts` for root-cause taxonomy).
  //
  // DISABLED BY DEFAULT — opt in via PIPELINE_RECONCILE_CRON_ENABLED=true.
  // This cron previously failed healthy manual-mode pipelines paused waiting
  // for user approval (they sit at status='running', which it mistook for a
  // stall, re-enqueued to MAX_RESUME, then marked failed). The false-positive
  // guard now lives in reconcile-cron.ts (hasPendingUserAction); this env flag
  // is the kill-switch so the cron can be toggled off without a code rollback
  // if it ever regresses again.
  if (hasCredits() && process.env.PIPELINE_RECONCILE_CRON_ENABLED === "true") {
    startPipelinesReconcileCron()
  } else if (hasCredits()) {
    console.log(
      "[reconcile/pipelines] disabled (set PIPELINE_RECONCILE_CRON_ENABLED=true to enable)",
    )
  }

  // Start orchestrator worker (workflow execution engine) in-process
  const orchestratorWorker = createOrchestratorWorker()
  console.log("[orchestrator] Worker started in-process")

  // Start the Story→Video pipeline worker in-process too — opt-in via
  // PIPELINE_WORKER_INPROCESS=true. The workflow orchestrator above already
  // runs in-process; enabling this lets `npm run dev` alone drive the pipeline
  // end-to-end in dev / self-host, with no separate `pipeline-worker` process
  // (the #1 "my film is stuck at queued" footgun). Leave it OFF in production,
  // where the worker runs as its own container process — running both would
  // double-consume the queue (the documented "locked by another worker" stall).
  // Dynamic import keeps the EE module out of the core bundle on other editions.
  let pipelineWorker: { close: () => Promise<unknown> } | null = null
  if (hasCredits() && process.env.PIPELINE_WORKER_INPROCESS === "true") {
    try {
      const { startPipelineWorker } = await import("./ee/workers/pipeline-worker.js")
      pipelineWorker = startPipelineWorker()
      console.log("[pipeline-worker] started in-process (PIPELINE_WORKER_INPROCESS=true)")
    } catch (err) {
      console.error("[pipeline-worker] in-process start failed:", err)
    }
  }

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
    stopWorkflowExecutionsReconcileCron()
    stopPipelinesReconcileCron()
    await orchestratorWorker.close()
    if (pipelineWorker) await pipelineWorker.close()
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
