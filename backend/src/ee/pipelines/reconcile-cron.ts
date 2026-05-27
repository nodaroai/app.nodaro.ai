/**
 * Periodic reconciler for stuck Film Director pipelines.
 *
 * `resume.ts::resumeActiveOrchestrators` runs on pipeline-worker boot and
 * catches pipelines whose BullMQ orchestration job is `state='active'`
 * (orchestrator died mid-drive, lock not yet released). That's a subset.
 *
 * This cron catches the complementary case: pipelines at status='running'
 * whose BullMQ orchestration job is GONE entirely. Root causes:
 *   1. Lost wake-up race — `enqueuePipelineRun()` dedupes on a deterministic
 *      jobId. A re-drive request that arrives while the previous drive is
 *      still `active` no-ops. The active drive finishes (BullMQ removes
 *      the job via `removeOnComplete`), the pipeline is in a state that
 *      would advance on next drive, but no drive is scheduled.
 *   2. Railway rolling restart between drives.
 *   3. Manual queue purge.
 *
 * Recovery: re-enqueue via `enqueuePipelineRun({ reason: 'resume' })`.
 * Mirrors the per-stage resume_count accounting in `resume.ts` so we
 * respect the same cap (`MAX_RESUME = 3`).
 *
 * See `specs/stuck-execution-prevention-plan.md` for the broader design.
 */
import { supabase } from "../../lib/supabase.js"
import { pipelineOrchestrationQueue, enqueuePipelineRun } from "./queue.js"
import { refundPipelineCredits } from "./credits.js"
import { MAX_RESUME } from "./resume.js"

const TICK_INTERVAL_MS = 90_000
const BACKOFF_FROM_START_MS = 120_000
/** Absolute abandon: 6 hours. Pipelines can legitimately run 1–2 hours
 *  (story-to-video has 4 stages × multi-minute critic loops), so this is
 *  longer than the workflow-executions threshold. */
const PIPELINE_STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000
const BATCH_LIMIT = 200

let intervalId: ReturnType<typeof setInterval> | null = null

export function startPipelinesReconcileCron(): void {
  if (intervalId) return
  console.log("[reconcile/pipelines] Started, every 90 seconds")
  intervalId = setInterval(async () => {
    try {
      await reconcilePipelinesTick()
    } catch (err) {
      console.error("[reconcile/pipelines] tick failed:", err)
    }
  }, TICK_INTERVAL_MS)
}

export function stopPipelinesReconcileCron(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}

type Outcome = "skipped" | "reenqueued" | "cap_failed" | "abandoned"

/** Exported for unit tests. Run-once equivalent of the cron tick. */
export async function reconcilePipelinesTick(): Promise<void> {
  const start = Date.now()
  const now = Date.now()
  const backoffCutoff = new Date(now - BACKOFF_FROM_START_MS).toISOString()

  // Note: `awaiting_approval` is intentionally NOT in the filter. That's a
  // pause state — the orchestrator is correctly not running. The user has
  // to click approve/reject to advance. Re-enqueuing those would clobber
  // the pause semantics.
  // `pipelines` table has `created_at` (not `started_at` — that's on
  // `pipeline_stages`). Use created_at for the backoff + abandon threshold.
  const { data: rows, error } = await supabase
    .from("pipelines")
    .select("id, user_id, status, created_at")
    .in("status", ["running", "stopping"])
    .lt("created_at", backoffCutoff)
    .limit(BATCH_LIMIT)

  if (error) {
    console.error("[reconcile/pipelines] query failed:", error.message)
    return
  }
  if (!rows || rows.length === 0) return

  let scanned = 0
  let reenqueued = 0
  let capFailed = 0
  let abandoned = 0
  let skipped = 0

  for (const row of rows) {
    scanned++
    try {
      const outcome = await reconcileOne(row, now)
      if (outcome === "reenqueued") reenqueued++
      else if (outcome === "cap_failed") capFailed++
      else if (outcome === "abandoned") abandoned++
      else skipped++
    } catch (err) {
      console.error(`[reconcile/pipelines] pipeline ${row.id} failed:`, err)
    }
  }

  if (reenqueued > 0 || capFailed > 0 || abandoned > 0) {
    console.log(
      `[reconcile/pipelines] tick: scanned=${scanned} re-enqueued=${reenqueued} max-resume-failed=${capFailed} abandoned=${abandoned} skipped=${skipped} (${Date.now() - start}ms)`,
    )
  }
}

interface PipelineRow {
  id: string
  user_id: string
  status: string
  created_at: string | null
}

async function reconcileOne(row: PipelineRow, now: number): Promise<Outcome> {
  // Is there a live BullMQ job? If yes, the orchestrator is still in
  // control (or will be — `waiting`/`delayed` mean BullMQ has it scheduled).
  // Leave alone.
  const existing = await pipelineOrchestrationQueue.getJob(`pipeline-${row.id}`)
  if (existing) {
    const state = await existing.getState()
    if (state === "active" || state === "waiting" || state === "delayed") {
      return "skipped"
    }
  }

  // Guard against the manual-mode false positive. A manual/guided pipeline
  // paused at a per-entity approval gate (character description, main image,
  // or the variant batch) sits at pipelines.status='running' — the pause is
  // recorded on the entity/stage rows, NOT the pipeline row (only the script
  // stage flips the pipeline itself to 'awaiting_approval'). Between drives it
  // has no BullMQ job, so it looks identical to a real stall. Re-enqueuing it
  // is pointless (drivePipeline just re-pauses) and, repeated every tick,
  // trips MAX_RESUME and FAILS a healthy run that was only ever waiting for
  // the user. So skip any pipeline with a pending user action. A genuinely
  // stuck pipeline (lost wake-up) has NONE — every entity already 'approved'
  // with no open gate — so it still gets re-enqueued below.
  if (await hasPendingUserAction(row.id)) {
    return "skipped"
  }

  // Absolute abandon: pipeline has been "running" for absurd time with no
  // orchestrator presence. Fail + refund. Refund-only-on-failed is idempotent
  // via the `reservation_usage_log_id` CAS inside `refundPipelineCredits`.
  const createdAt = row.created_at ? new Date(row.created_at).getTime() : 0
  if (createdAt > 0 && now - createdAt > PIPELINE_STALE_THRESHOLD_MS) {
    await supabase
      .from("pipelines")
      .update({ status: "failed", failure_reason: "stale_abandoned_by_cron" })
      .eq("id", row.id)
    await refundPipelineCredits({
      supabase,
      userId: row.user_id,
      pipelineId: row.id,
      reason: "stale_abandoned_by_cron",
    })
    return "abandoned"
  }

  // Mirror `resume.ts::resumeOneJob` accounting: locate the most-recent
  // running stage, check the cap, increment + audit, then re-enqueue.
  const { data: stage } = await supabase
    .from("pipeline_stages")
    .select("id, resume_count")
    .eq("pipeline_id", row.id)
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (stage) {
    const currentCount = (stage.resume_count as number | null) ?? 0
    const nextCount = currentCount + 1
    if (nextCount > MAX_RESUME) {
      await supabase
        .from("pipelines")
        .update({ status: "failed", failure_reason: "resume_limit_exceeded_cron" })
        .eq("id", row.id)
      await refundPipelineCredits({
        supabase,
        userId: row.user_id,
        pipelineId: row.id,
        reason: "resume_limit_exceeded_cron",
      })
      return "cap_failed"
    }
    await supabase
      .from("pipeline_stages")
      .update({ resume_count: nextCount })
      .eq("id", stage.id)
    await supabase.from("pipeline_stage_attempts").insert({
      pipeline_stage_id: stage.id as string,
      attempt_n: nextCount,
      trigger: "cron_reconcile",
      output: {},
    })
  }
  // If no running stage exists, we still re-enqueue (the pipeline may be
  // between stages — `drivePipeline` will figure out the next step). The
  // 6-hour abandon threshold above is the safety net against infinite
  // re-enqueue loops in that case.

  await enqueuePipelineRun({
    pipelineId: row.id,
    userId: row.user_id,
    reason: "resume",
  })
  return "reenqueued"
}

/**
 * True when the pipeline is legitimately paused for user input rather than
 * stalled. Covers the per-entity gates (a character entity at
 * `awaiting_approval` = main image waiting for approval, or
 * `pending_description` = Step-A description waiting for the user's click) and
 * the stage-level batch gate (`pipeline_stages.status='awaiting_approval'`).
 *
 * Deliberately does NOT treat `pending` / `generating` / `rejected` as a user
 * wait — those are orchestrator-work states, so a pipeline stuck on one of
 * them with no live job SHOULD be re-enqueued. This check is the line between
 * "waiting for a human" (leave alone) and "waiting for nobody" (rescue).
 */
async function hasPendingUserAction(pipelineId: string): Promise<boolean> {
  const { data: entity } = await supabase
    .from("pipeline_entities")
    .select("id")
    .eq("pipeline_id", pipelineId)
    .in("status", ["awaiting_approval", "pending_description"])
    .limit(1)
    .maybeSingle()
  if (entity) return true

  const { data: stage } = await supabase
    .from("pipeline_stages")
    .select("id")
    .eq("pipeline_id", pipelineId)
    .eq("status", "awaiting_approval")
    .limit(1)
    .maybeSingle()
  return Boolean(stage)
}
