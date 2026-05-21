import type { SupabaseClient } from "@supabase/supabase-js"
import {
  PIPELINE_STAGE_NAMES,
  type JsonPatch,
  type PipelineStageName,
} from "@nodaro/shared"
import { runScriptStage } from "./stages/script.js"
import { pipelineEvents } from "./events.js"
import { refundPipelineCredits } from "./credits.js"
import { incrementCriticRetry } from "./stage-utils.js"
import { validateCanvasAgainstPlan, getStageExpectedEntityIds } from "./drift.js"
import { applyStageEdit } from "./chat/apply-stage-edit.js"

export interface DriveArgs {
  supabase: SupabaseClient
  pipelineId: string
}

// Canonical ordering used to pick the next pending stage when no in-flight row
// exists. `PIPELINE_STAGE_NAMES` in @nodaro/shared is the single source of
// truth for stage names + ordering — backing PipelineStageNameSchema (consumed
// by SSE event validators) AND this engine's ordered walk.
const STAGE_ORDER = PIPELINE_STAGE_NAMES
type StageOrderName = PipelineStageName

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
    if (lastIdx + 1 >= STAGE_ORDER.length) {
      // Phase 1C.1: after Stage 8 (post_merge) the pipeline is completed.
      // Stage 8's own handler also flips `pipelines.status` and publishes
      // `pipeline:completed`; this branch is a defensive fallback for the
      // theoretical case where every stage row is approved but the pipeline
      // row didn't move yet.
      await supabase.from("pipelines").update({ status: "completed" }).eq("id", pipelineId)
      pipelineEvents.publish({ type: "pipeline:status", pipelineId, status: "completed" })
      pipelineEvents.publish({ type: "pipeline:done", pipelineId })
      return
    }
    // For a freshly-queued pipeline (no stage rows yet), lastIdx is -1 and
    // STAGE_ORDER[-1 + 1] = STAGE_ORDER[0] = "script". The script handler
    // calls `ensureStageRow` to insert the script `pipeline_stages` row at
    // dispatch time. Removing the `lastIdx < 0` short-circuit (which used to
    // wrap into this branch) is critical — otherwise fresh pipelines mark
    // `completed` before Stage 1 ever runs (caught by Phase 1D.2a L1 review).
    stageToRun = STAGE_ORDER[lastIdx + 1]!
  }

  // Phase 1B.4 drift detection — only meaningful Stage 2 onwards, since
  // Stage 1 is the script generator and there are no prior entities to
  // diverge from. When drift is detected, pause the stage at
  // awaiting_approval with `awaiting_reason='canvas_drift'`; the panel
  // renders the DriftBanner and the user picks resolution
  // (regenerate / fork / abandon).
  if (stageToRun !== "script") {
    const expectedIds = await getStageExpectedEntityIds(supabase, pipelineId)
    const drift = await validateCanvasAgainstPlan(
      supabase,
      pipelineId,
      expectedIds,
      stageToRun,
    )
    if (!drift.ok) {
      // Find the pipeline_stages row for this stage (may not exist yet — only
      // pause if it does; the engine inserts the row at stage-start otherwise).
      const { data: stageRow } = await supabase
        .from("pipeline_stages")
        .select("id")
        .eq("pipeline_id", pipelineId)
        .eq("stage_name", stageToRun)
        .maybeSingle()
      if (stageRow?.id) {
        await supabase
          .from("pipeline_stages")
          .update({
            status: "awaiting_approval",
            awaiting_reason: "canvas_drift",
          })
          .eq("id", stageRow.id)
      }
      await supabase
        .from("pipelines")
        .update({ status: "awaiting_approval" })
        .eq("id", pipelineId)
      pipelineEvents.publish({
        type: "pipeline:status",
        pipelineId,
        status: "awaiting_approval",
      })
      return
    }
  }

  // Dispatch.
  const userTier = await resolveUserTier(supabase, pipeline.user_id)

  if (stageToRun === "script") {
    await runScriptAndPersist(args, pipeline, userTier)
    return
  }
  // Phase 1D.2a §4.1 (G1/G2/G3): pass the pipeline's mode through to the
  // entity stages so they can short-circuit the approval gates under
  // `mode === "auto"`. Manual/guided modes preserve the prior pause-for-user
  // behavior.
  const pipelineMode = ((pipeline as { mode?: string }).mode ?? "manual") as
    | "manual"
    | "auto"
    | "guided"
  if (stageToRun === "characters") {
    const { runCharactersStage } = await import("./stages/characters.js")
    await runCharactersStage({
      supabase,
      pipelineId,
      userId: pipeline.user_id,
      userTier,
      mode: pipelineMode,
    })
    return
  }
  if (stageToRun === "objects") {
    const { runObjectsStage } = await import("./stages/objects.js")
    await runObjectsStage({
      supabase,
      pipelineId,
      userId: pipeline.user_id,
      userTier,
      mode: pipelineMode,
    })
    return
  }
  if (stageToRun === "locations") {
    const { runLocationsStage } = await import("./stages/locations.js")
    await runLocationsStage({
      supabase,
      pipelineId,
      userId: pipeline.user_id,
      userTier,
      mode: pipelineMode,
    })
    return
  }
  if (stageToRun === "shot_list") {
    const { runShotListStage } = await import("./stages/shot-list.js")
    await runShotListStage({
      supabase,
      pipelineId,
      userId: pipeline.user_id,
      userTier,
      mode: pipelineMode,
    })
    return
  }
  if (stageToRun === "scene_images") {
    const { runSceneImagesStage } = await import("./stages/scene-images.js")
    await runSceneImagesStage({
      supabase,
      pipelineId,
      userId: pipeline.user_id,
      userTier,
      mode: pipelineMode,
    })
    return
  }
  if (stageToRun === "animate_audio_edit") {
    const { runAnimateAudioEditStage } = await import("./stages/animate-audio-edit.js")
    await runAnimateAudioEditStage({ supabase, pipelineId, userId: pipeline.user_id, userTier })
    return
  }
  if (stageToRun === "post_merge") {
    const { runPostMergeStage } = await import("./stages/post-merge.js")
    await runPostMergeStage({ supabase, pipelineId, userId: pipeline.user_id, userTier })
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
      .update({
        status: "failed",
        critic_feedback: {
          failure_detail: outcome.failure_detail,
        } as unknown as Record<string, unknown>,
        completed_at: new Date().toISOString(),
      })
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

  // outcome.status === 'approved' (auto-mode) or 'awaiting_approval' (manual-mode).
  // Both arms share the same payload — write the same pipeline_stages.output and
  // critic_feedback regardless of which arm fired.
  const stageStatus = outcome.status // 'approved' | 'awaiting_approval'
  const criticFeedback = {
    script: outcome.scriptCritic,
    cast_coverage: outcome.castCoverageCritic,
    locations_coverage: outcome.locationsCoverageCritic,
    objects_validation: outcome.objectsValidation,
  } as unknown as Record<string, unknown>

  await supabase
    .from("pipeline_stages")
    .update({
      status: stageStatus,
      output: { plan: outcome.plan } as unknown as Record<string, unknown>,
      critic_feedback: criticFeedback,
      completed_at: new Date().toISOString(),
    })
    .eq("pipeline_id", pipelineId)
    .eq("stage_name", "script")

  if (stageStatus === "approved") {
    // Auto-mode: don't pause the pipeline. The engine re-enqueue happens via
    // `approveScriptStage` -> queue; mirror that here so the next stage starts.
    pipelineEvents.publish({
      type: "stage:status",
      pipelineId,
      stageName: "script",
      status: "approved",
      output: outcome.plan,
      criticFeedback,
    })
    const { enqueuePipelineRun } = await import("./queue.js")
    await enqueuePipelineRun({
      pipelineId,
      userId: pipeline.user_id,
      reason: "stage_advance",
    })
    return
  }

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
    criticFeedback,
  })
  pipelineEvents.publish({ type: "pipeline:status", pipelineId, status: "awaiting_approval" })
}

/**
 * Phase 1D.2b E1 — generalized stage approval.
 *
 * Approve a stage. If `edits` is a non-empty JSON Patch, routes through
 * `applyStageEdit` (which patches the artifact, inserts an attempt row,
 * CAS-flips status, and writes back to pipeline_stages.output). Otherwise
 * the no-edits path runs (CAS-flip status='approved' from 'awaiting_approval',
 * enqueue stage_advance).
 *
 * Generalized from the original Phase 1A `approveScriptStage`; the old name
 * remains as a deprecation shim so call sites can migrate incrementally.
 */
export async function approveStage(
  supabase: SupabaseClient,
  pipelineId: string,
  stageName: PipelineStageName,
  userId: string,
  edits?: JsonPatch,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data: stage } = await supabase
    .from("pipeline_stages")
    .select("id, status")
    .eq("pipeline_id", pipelineId)
    .eq("stage_name", stageName)
    .maybeSingle()
  if (!stage) return { ok: false, reason: "stage_not_found" }

  if (edits && edits.length > 0) {
    const result = await applyStageEdit({
      supabase,
      pipelineId,
      stageName,
      stageId: stage.id as string,
      userId,
      jsonPatch: edits,
      source: "approve_edits",
    })
    return result.ok ? { ok: true } : { ok: false, reason: result.reason }
  }

  // No-edits path — extracted from the original approveScriptStage body.
  return approveStageNoEdits(supabase, pipelineId, stageName, userId)
}

/**
 * No-edits approval path: CAS-flip status='approved' from 'awaiting_approval',
 * publish stage:status SSE, and enqueue the next pipeline drive.
 */
async function approveStageNoEdits(
  supabase: SupabaseClient,
  pipelineId: string,
  stageName: PipelineStageName,
  userId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Optimistic concurrency: only flip from awaiting_approval to approved.
  const { data, error } = await supabase
    .from("pipeline_stages")
    .update({
      status: "approved",
      completed_at: new Date().toISOString(),
    })
    .eq("pipeline_id", pipelineId)
    .eq("stage_name", stageName)
    .eq("status", "awaiting_approval")
    .select("id")
  if (error) return { ok: false, reason: error.message }
  if (!data || data.length === 0) return { ok: false, reason: "stage_already_advanced" }

  pipelineEvents.publish({ type: "stage:status", pipelineId, stageName, status: "approved" })

  // Re-enqueue the orchestrator to drive the next stage. Lazy-loaded to avoid
  // circular module imports (queue.ts imports config which can pull in
  // supabase setup).
  const { enqueuePipelineRun } = await import("./queue.js")
  await enqueuePipelineRun({
    pipelineId,
    userId,
    reason: "stage_advance",
  })
  return { ok: true }
}

/**
 * @deprecated — call `approveStage(supabase, pipelineId, 'script', userId, edits)` instead.
 *
 * Preserves the original 3-arg signature for call sites that haven't migrated
 * yet. Internally resolves `userId` via `resolveUserId(supabase, pipelineId)`
 * — matching the original behavior — and delegates to the new helper.
 */
export async function approveScriptStage(
  supabase: SupabaseClient,
  pipelineId: string,
  edits?: unknown,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const userId = await resolveUserId(supabase, pipelineId)
  return approveStage(
    supabase,
    pipelineId,
    "script",
    userId,
    edits as JsonPatch | undefined,
  )
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
