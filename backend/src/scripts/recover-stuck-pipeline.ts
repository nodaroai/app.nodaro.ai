/**
 * One-shot recovery — re-enqueues a pipeline whose BullMQ orchestration job
 * was lost (driver killed mid-drive while a re-drive coalesced into a no-op
 * and was dropped; Railway rolling restart; manual kill; etc.).
 *
 * Mechanism: `enqueuePipelineRun({ reason: "resume", ... })`. BullMQ's
 * per-pipeline dedup key (`pipeline-${id}`) accepts the add iff there's no
 * live job for that pipeline — exactly the state we're recovering from.
 * On the next pipeline-worker tick, `drivePipeline` re-attaches to the DB
 * state (idempotent at the entity-key level — see UNIQUE constraint on
 * `pipeline_entities (pipeline_id, entity_key)`) and advances from wherever
 * the previous driver died.
 *
 * Refuses to act if the pipeline is NOT in a runnable state (already
 * completed/failed/cancelled), or if a live BullMQ job already exists.
 *
 * Usage:
 *   cd backend && npx tsx src/scripts/recover-stuck-pipeline.ts <pipeline-id>
 *   cd backend && npx tsx src/scripts/recover-stuck-pipeline.ts <pipeline-id> --dry
 *
 * Hard-requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `REDIS_URL`
 * in backend/.env.
 */
import { config } from "../lib/config.js"
import { createClient } from "@supabase/supabase-js"
import { pipelineOrchestrationQueue, enqueuePipelineRun } from "../ee/pipelines/queue.js"

const pipelineId = process.argv[2]
const dryRun = process.argv.includes("--dry") || process.argv.includes("--dry-run")

if (!pipelineId) {
  console.error("Usage: tsx src/scripts/recover-stuck-pipeline.ts <pipeline-id> [--dry]")
  process.exit(1)
}

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)

const { data: pipeline, error } = await supabase
  .from("pipelines")
  .select("id, user_id, status, current_progress_message, failure_reason, created_at")
  .eq("id", pipelineId)
  .single()

if (error || !pipeline) {
  console.error(`Could not find pipeline ${pipelineId}:`, error?.message ?? "not found")
  process.exit(1)
}

console.log(`Found pipeline ${pipelineId}:`)
console.log(`  status:          ${pipeline.status}`)
console.log(`  user_id:         ${pipeline.user_id}`)
console.log(`  created_at:      ${pipeline.created_at}`)
console.log(`  progress:        ${pipeline.current_progress_message ?? "(null)"}`)
console.log(`  failure_reason:  ${pipeline.failure_reason ?? "(null)"}`)

const runnableStatuses = new Set(["running", "stopping", "awaiting_approval"])
if (!runnableStatuses.has(pipeline.status as string)) {
  console.error(
    `Pipeline status is '${pipeline.status}' — refusing to re-enqueue (only ${Array.from(runnableStatuses).join(", ")} are runnable).`,
  )
  process.exit(1)
}

const existing = await pipelineOrchestrationQueue.getJob(`pipeline-${pipelineId}`)
if (existing) {
  const state = await existing.getState()
  console.log(`  bullmq job:      exists, state=${state}, id=${existing.id}`)
  if (state === "active" || state === "waiting" || state === "delayed") {
    console.error(
      `BullMQ already has a live job (state=${state}) — refusing to re-enqueue. The orchestrator should pick it up; if it doesn't, remove the job first.`,
    )
    process.exit(1)
  }
  // Completed/failed jobs in the BullMQ history would block the add via
  // the deterministic jobId, but `enqueuePipelineRun` sets
  // `removeOnComplete: true` + `removeOnFail: true`, so this branch should
  // be unreachable in practice. Keep the diagnostic for safety.
  console.log(`  (existing job in state ${state} — will let removeOn* handle it)`)
} else {
  console.log(`  bullmq job:      none`)
}

if (dryRun) {
  console.log(`[dry-run] Would enqueue { pipelineId: '${pipelineId}', userId: '${pipeline.user_id}', reason: 'resume' }.`)
  process.exit(0)
}

await enqueuePipelineRun({
  pipelineId: pipeline.id as string,
  userId: pipeline.user_id as string,
  reason: "resume",
})

console.log(
  `✓ Re-enqueued pipeline ${pipelineId} (reason='resume'). The pipeline-worker will pick it up within ~1s and drivePipeline() will resume from current DB state.`,
)
process.exit(0)
