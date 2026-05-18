import type { SupabaseClient } from "@supabase/supabase-js"
import { runScriptStage } from "./stages/script.js"
import { pipelineEvents } from "./events.js"
import { refundPipelineCredits } from "./credits.js"
import { incrementCriticRetry } from "./stage-utils.js"

export interface DriveArgs {
  supabase: SupabaseClient
  pipelineId: string
}

// Canonical ordering used to pick the next pending stage when no in-flight row
// exists. Phase 1B.2 covers Stages 1–5; Stages 6–8 land in Phase 1B.3+.
const STAGE_ORDER = ["script", "characters", "objects", "locations", "shot_list"] as const
type StageOrderName = (typeof STAGE_ORDER)[number]

/**
 * Engine entry. Reads the pipeline row, picks the next stage to run based on
 * `pipeline_stages` state, dispatches the corresponding stage orchestrator, and
 * advances through Stages 1–5 → `completed`. Returns early when a stage is
 * `awaiting_approval` (user must drive) or when the pipeline is in a terminal
 * state.
 */
export async function drivePipeline(args: DriveArgs): Promise<void> {
  const { supabase, pipelineId } = args
  const { data: pipeline, error } = await supabase
    .from("pipelines")
    .select("*")
    .eq("id", pipelineId)
    .single()
  if (error || !pipeline) throw new Error(`Pipeline ${pipelineId} not found`)

  if (pipeline.status === "cancelled" || pipeline.status === "failed" || pipeline.status === "completed" || pipeline.status === "forked") {
    return // nothing to do
  }

  await supabase.from("pipelines").update({ status: "running" }).eq("id", pipelineId)
  pipelineEvents.publish({ type: "pipeline:status", pipelineId, status: "running" })

  // Determine current stage by reading pipeline_stages.
  const { data: stages } = await supabase
    .from("pipeline_stages")
    .select("stage_name, status, stage_order")
    .eq("pipeline_id", pipelineId)
    .order("stage_order", { ascending: true })

  const stageRows = (stages ?? []) as Array<{
    stage_name: string
    status: string
    stage_order: number
  }>

  // First non-terminal stage row, in stage_order. Status counts as "in flight"
  // unless it's approved/cancelled/failed.
  const nextStage = stageRows.find(
    (s) => s.status !== "approved" && s.status !== "cancelled" && s.status !== "failed",
  )

  // If no in-flight stage, find the next pending stage to insert.
  let stageToRun: StageOrderName
  if (nextStage) {
    if (nextStage.status === "awaiting_approval") return // wait for user
    stageToRun = nextStage.stage_name as StageOrderName
  } else {
    // All current rows approved — advance to next pending stage in sequence.
    const approvedRows = stageRows.filter((s) => s.status === "approved")
    const lastApproved = approvedRows[approvedRows.length - 1]
    const lastIdx = lastApproved
      ? STAGE_ORDER.indexOf(lastApproved.stage_name as StageOrderName)
      : -1
    if (lastIdx < 0 || lastIdx + 1 >= STAGE_ORDER.length) {
      // Phase 1B.2: after Shot List stage, mark completed (Stages 6–8 land in 1B.3+).
      await supabase.from("pipelines").update({ status: "completed" }).eq("id", pipelineId)
      pipelineEvents.publish({ type: "pipeline:status", pipelineId, status: "completed" })
      pipelineEvents.publish({ type: "pipeline:done", pipelineId })
      return
    }
    stageToRun = STAGE_ORDER[lastIdx + 1]!
  }

  // Dispatch.
  const userTier = await resolveUserTier(supabase, pipeline.user_id)

  if (stageToRun === "script") {
    await runScriptAndPersist(args, pipeline, userTier)
    return
  }
  if (stageToRun === "characters") {
    const { runCharactersStage } = await import("./stages/characters.js")
    await runCharactersStage({ supabase, pipelineId, userId: pipeline.user_id, userTier })
    return
  }
  if (stageToRun === "objects") {
    const { runObjectsStage } = await import("./stages/objects.js")
    await runObjectsStage({ supabase, pipelineId, userId: pipeline.user_id, userTier })
    return
  }
  if (stageToRun === "locations") {
    const { runLocationsStage } = await import("./stages/locations.js")
    await runLocationsStage({ supabase, pipelineId, userId: pipeline.user_id, userTier })
    return
  }
  if (stageToRun === "shot_list") {
    const { runShotListStage } = await import("./stages/shot-list.js")
    await runShotListStage({ supabase, pipelineId, userId: pipeline.user_id, userTier })
    return
  }
  // Exhaustive switch — should never reach.
  throw new Error(`Unknown stage to run: ${stageToRun as string}`)
}

/**
 * Stage 1 (Script) dispatch + outcome persistence. Extracted so `drivePipeline`'s
 * switch stays tight. `pipeline` carries the loose shape `select("*").single()`
 * returns from the un-typed supabase client; we trust the schema since the row
 * was already loaded by `drivePipeline`.
 */
async function runScriptAndPersist(
  args: DriveArgs,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline: any,
  userTier: string,
): Promise<void> {
  const { supabase, pipelineId } = args
  const outcome = await runScriptStage({
    supabase,
    pipelineId,
    userId: pipeline.user_id,
    storyPrompt: pipeline.input_prompt,
    targetDurationSeconds: pipeline.target_duration_seconds,
    format: pipeline.format,
    outputResolution: pipeline.output_resolution,
    language: pipeline.language,
    mode: pipeline.mode,
    activationMode: pipeline.activation_mode,
    userTier,
    styleDirectives: pipeline.style_directives ?? undefined,
  })

  if (outcome.status === "failed") {
    await supabase
      .from("pipeline_stages")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("pipeline_id", pipelineId)
      .eq("stage_name", "script")
    await supabase
      .from("pipelines")
      .update({ status: "failed", failure_reason: outcome.reason })
      .eq("id", pipelineId)
    pipelineEvents.publish({ type: "pipeline:status", pipelineId, status: "failed" })
    pipelineEvents.publish({
      type: "stage:status", pipelineId, stageName: "script", status: "failed",
    })
    pipelineEvents.publish({
      type: "pipeline:warning", pipelineId, code: outcome.reason, message: outcome.reason,
    })
    // Refund the upfront reservation.
    if (pipeline.reserved_credits > pipeline.spent_credits) {
      await refundPipelineCredits({
        supabase, userId: pipeline.user_id, pipelineId,
        credits: pipeline.reserved_credits - pipeline.spent_credits,
        reason: `pipeline_failed:${outcome.reason}`,
      })
    }
    return
  }

  // outcome.status === 'awaiting_approval'
  await supabase
    .from("pipeline_stages")
    .update({
      status: "awaiting_approval",
      output: { plan: outcome.plan } as unknown as Record<string, unknown>,
      critic_feedback: {
        script: outcome.scriptCritic,
        cast_coverage: outcome.castCoverageCritic,
      } as unknown as Record<string, unknown>,
      completed_at: new Date().toISOString(),
    })
    .eq("pipeline_id", pipelineId)
    .eq("stage_name", "script")

  await supabase
    .from("pipelines")
    .update({ status: "awaiting_approval" })
    .eq("id", pipelineId)

  pipelineEvents.publish({
    type: "stage:status",
    pipelineId,
    stageName: "script",
    status: "awaiting_approval",
    output: outcome.plan,
    criticFeedback: { script: outcome.scriptCritic, cast_coverage: outcome.castCoverageCritic },
  })
  pipelineEvents.publish({ type: "pipeline:status", pipelineId, status: "awaiting_approval" })
}

/**
 * Phase 1B.1: after Script approval, re-enqueue the orchestrator to drive
 * Stage 2 (Characters). The pipeline is marked `completed` only once
 * `drivePipeline` reaches the end of the canonical stage sequence.
 */
export async function approveScriptStage(
  supabase: SupabaseClient,
  pipelineId: string,
  edits?: unknown,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Optimistic concurrency: only flip from awaiting_approval to approved.
  const { data, error } = await supabase
    .from("pipeline_stages")
    .update({
      status: "approved",
      user_edits: edits as Record<string, unknown> | undefined,
    })
    .eq("pipeline_id", pipelineId)
    .eq("stage_name", "script")
    .eq("status", "awaiting_approval")
    .select("id")
  if (error) return { ok: false, reason: error.message }
  if (!data || data.length === 0) return { ok: false, reason: "stage_already_advanced" }

  // Phase 1B.1: after Script approval, advance to Characters stage.
  pipelineEvents.publish({ type: "stage:status", pipelineId, stageName: "script", status: "approved" })

  // Re-enqueue the orchestrator to drive Stage 2. Lazy-loaded to avoid circular
  // module imports (queue.ts imports config which can pull in supabase setup).
  const { enqueuePipelineRun } = await import("./queue.js")
  await enqueuePipelineRun({
    pipelineId,
    userId: await resolveUserId(supabase, pipelineId),
    reason: "stage_advance",
  })
  return { ok: true }
}

export async function rejectScriptStage(
  supabase: SupabaseClient,
  pipelineId: string,
  feedback: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Look up the stage_id first.
  const { data: stage } = await supabase
    .from("pipeline_stages")
    .select("id")
    .eq("pipeline_id", pipelineId)
    .eq("stage_name", "script")
    .maybeSingle()
  if (!stage) return { ok: false, reason: "stage_not_found" }

  // Cap-check + increment.
  const next = await incrementCriticRetry(supabase, stage.id)
  if (next === null) return { ok: false, reason: "critic_retry_cap_reached" }

  // Now flip status from awaiting_approval back to running.
  const { data, error } = await supabase
    .from("pipeline_stages")
    .update({
      status: "running",
      critic_feedback: { user_feedback: feedback } as Record<string, unknown>,
    })
    .eq("pipeline_id", pipelineId)
    .eq("stage_name", "script")
    .eq("status", "awaiting_approval")
    .select("id")
  if (error) return { ok: false, reason: error.message }
  if (!data || data.length === 0) return { ok: false, reason: "stage_already_advanced" }
  return { ok: true }
}

async function resolveUserTier(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data } = await supabase.from("profiles").select("tier").eq("id", userId).single()
  return data?.tier ?? "free"
}

async function resolveUserId(supabase: SupabaseClient, pipelineId: string): Promise<string> {
  const { data } = await supabase
    .from("pipelines")
    .select("user_id")
    .eq("id", pipelineId)
    .single()
  return data?.user_id ?? ""
}
