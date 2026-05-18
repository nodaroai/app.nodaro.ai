import type { SupabaseClient } from "@supabase/supabase-js"
import { runScriptStage } from "./stages/script.js"
import { pipelineEvents } from "./events.js"
import { refundPipelineCredits } from "./credits.js"
import { incrementCriticRetry } from "./stage-utils.js"

export interface DriveArgs {
  supabase: SupabaseClient
  pipelineId: string
}

/**
 * Engine entry. Reads the pipeline row, runs the current stage (Phase 1A: only Stage 1),
 * persists outcome, sets status, and emits SSE events. Phase 1B+ extends the switch
 * with Stages 2–8.
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

  // Phase 1A: only stage 1.
  const userTier = await resolveUserTier(supabase, pipeline.user_id)

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
 * Phase 1A: after Script approval, the pipeline jumps to status='completed' since
 * Stages 2-8 are not implemented yet. Phase 1B will replace this with advanceToStage(2).
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

  // Phase 1A: mark pipeline completed.
  await supabase
    .from("pipelines")
    .update({ status: "completed" })
    .eq("id", pipelineId)
  pipelineEvents.publish({ type: "pipeline:status", pipelineId, status: "completed" })
  pipelineEvents.publish({ type: "stage:status", pipelineId, stageName: "script", status: "approved" })
  pipelineEvents.publish({ type: "pipeline:done", pipelineId })
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
