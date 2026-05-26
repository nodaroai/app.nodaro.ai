import type { Queue, Job } from "bullmq"
import type { SupabaseClient } from "@supabase/supabase-js"
import { refundPipelineCredits } from "./credits.js"
import { settledWithLimit } from "../../lib/settled-with-limit.js"

/**
 * Phase 1B.4 — orchestrator resume after backend restart.
 *
 * Called from the pipeline-worker boot path. Scans BullMQ for `active`
 * orchestration jobs whose driver was killed mid-run (deploy / crash /
 * Railway rolling restart), and for each one either re-attaches the
 * orchestrator's view of stage state or escalates to terminal failure
 * if the pipeline has already been resumed too many times.
 *
 * Hard cap (`MAX_RESUME = 3`) lives on `pipelines.resume_count` (CHECK
 * constraint in migration 131). When the cap is hit we:
 *   - set `pipelines.status = 'failed'` + `failure_reason = 'resume_limit_exceeded'`
 *   - refund the unspent reservation via `CreditsService.refundCredits`
 *   - remove the BullMQ job so it can't reach the worker again
 *
 * Under the cap we:
 *   - increment `pipeline_stages.resume_count` on the most-recent running stage
 *   - write a `pipeline_stage_attempts` row with `trigger='resume'`
 *   - leave the BullMQ job in place — when the worker picks it up next, the
 *     engine reads stage state and resumes from wherever it left off
 *     (stages are idempotent at the entity-key level — UNIQUE constraint on
 *     `pipeline_entities (pipeline_id, entity_key)` prevents duplicate inserts)
 */
export const MAX_RESUME = 3

/**
 * Concurrency cap for the per-job resume fan-out. Resume happens at worker
 * boot; in practice the queue has 1-3 stuck jobs, but we cap fan-out at 10
 * so a long backlog doesn't slam Supabase with 50+ concurrent queries.
 */
const RESUME_CONCURRENCY = 10

export interface ResumeSummary {
  resumed: number
  failed: number
}

type JobOutcome = "resumed" | "failed" | "skipped"

/**
 * Reattach (or terminate) a single stuck orchestrator job. Returns the
 * outcome so the caller can aggregate counts without sharing mutable state
 * across concurrent workers. All errors are logged inside the helper —
 * callers see a status, not an exception.
 */
async function resumeOneJob(
  supabase: SupabaseClient,
  job: Job,
): Promise<JobOutcome> {
  const pipelineId = (job.data as { pipelineId?: string }).pipelineId
  if (!pipelineId) return "skipped"

  // Find the stage that was in flight when the worker died. The orchestrator
  // marks a stage 'running' the moment it starts (see drivePipeline) and
  // only flips to 'approved'/'failed'/'awaiting_approval' at the boundary.
  // If no row matches, the pipeline finished cleanly (or never started a
  // stage) — nothing to resume.
  const { data: stage } = await supabase
    .from("pipeline_stages")
    .select("id, stage_name, resume_count")
    .eq("pipeline_id", pipelineId)
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!stage) return "skipped"

  const nextCount = (stage.resume_count as number | null ?? 0) + 1
  if (nextCount > MAX_RESUME) {
    // Cap hit — fail the pipeline + refund the reservation + drop the queued job.
    // The canonical helper looks up `reservation_usage_log_id` and clears it
    // on success, so a re-run after a hot-reload is idempotent.
    await supabase
      .from("pipelines")
      .update({ status: "failed", failure_reason: "resume_limit_exceeded" })
      .eq("id", pipelineId)
    await refundPipelineCredits({
      supabase,
      userId: "",
      pipelineId,
      reason: "resume_limit_exceeded",
    })
    try {
      await job.remove()
    } catch (err) {
      console.error(
        `[pipelines/resume] failed to remove job for pipeline ${pipelineId}:`,
        err instanceof Error ? err.message : err,
      )
    }
    return "failed"
  }

  // Under the cap — increment + audit row, then leave the job in place.
  await supabase
    .from("pipeline_stages")
    .update({ resume_count: nextCount })
    .eq("id", stage.id)

  await supabase.from("pipeline_stage_attempts").insert({
    pipeline_stage_id: stage.id,
    attempt_n: nextCount,
    trigger: "resume",
    output: {},
  })

  return "resumed"
}

export async function resumeActiveOrchestrators(
  supabase: SupabaseClient,
  queue: Queue,
): Promise<ResumeSummary> {
  const activeJobs = await queue.getJobs(["active"], 0, -1, false)
  if (activeJobs.length === 0) return { resumed: 0, failed: 0 }

  // Fan out per-job processing with bounded concurrency. failFast=false so
  // one bad pipeline doesn't block the rest of the resume sweep.
  const results = await settledWithLimit(
    activeJobs.map((job) => () => resumeOneJob(supabase, job)),
    RESUME_CONCURRENCY,
    undefined,
    false,
  )
  let resumed = 0
  let failed = 0
  for (const r of results) {
    if (r.status !== "fulfilled") continue
    if (r.value === "resumed") resumed++
    else if (r.value === "failed") failed++
  }
  return { resumed, failed }
}
