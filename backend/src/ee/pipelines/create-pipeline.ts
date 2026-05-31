import type { SupabaseClient } from "@supabase/supabase-js"
import {
  type PipelineInput,
  validateDurationForFormat,
  validateModeActivation,
} from "@nodaro/shared"

/**
 * Phase 2 — shared "create + reserve + enqueue a pipeline" service.
 *
 * Extracted from `POST /v1/pipelines` so both the HTTP route and the MCP
 * `start_pipeline` tool drive the engine through ONE path — same tier guard,
 * credit reservation, and BullMQ enqueue. Returns a discriminated result the
 * caller maps onto its transport (HTTP status / MCP error).
 *
 * `input` must already be schema-valid (callers parse via `PipelineInputSchema`).
 * Activation is always "interactive" — pure-programmatic activation (no user)
 * is a future internal path; every current caller has a `userId`.
 */
export type CreatePipelineResult =
  | { ok: true; pipelineId: string }
  | {
      ok: false
      status: number
      code: string
      message?: string
      detail?: string
      model?: string
    }

export interface CreatePipelineArgs {
  supabase: SupabaseClient
  userId: string
  input: PipelineInput
}

export async function createPipeline(
  args: CreatePipelineArgs,
): Promise<CreatePipelineResult> {
  const { supabase, userId, input } = args

  const mode = input.mode ?? (input.auto_mode ? "auto" : "manual")
  const activation = "interactive"

  const dv = validateDurationForFormat(input.format, input.target_duration_seconds)
  if (!dv.ok) {
    return {
      ok: false,
      status: 400,
      code: "duration_out_of_bounds",
      message: dv.reason,
    }
  }
  const mv = validateModeActivation(mode, activation)
  if (!mv.ok) {
    return {
      ok: false,
      status: 400,
      code: "mode_incompatible_with_activation",
      message: mv.reason,
    }
  }

  const { estimateUpfrontCredits, reservePipelineCredits, resolveMaxCostCredits } =
    await import("./credits.js")
  const { enqueuePipelineRun } = await import("./queue.js")

  const { data: profileRow } = await supabase
    .from("profiles")
    .select(
      "tier, subscription_tier, subscription_credits, topup_credits, " +
        "daily_spent_credits, last_daily_reset, app_credits_allowance",
    )
    .eq("id", userId)
    .single()
    .then((r) => ({
      data: r.data as {
        tier?: string | null
        subscription_tier?: string | null
        subscription_credits?: number | null
        topup_credits?: number | null
        daily_spent_credits?: number | null
        last_daily_reset?: string | null
        app_credits_allowance?: number | null
      } | null,
    }))
  const userTier = profileRow?.tier ?? "free"

  const config = input.config ?? {}

  // Tier-restriction guard for user-pinned model picks (image/video/script/
  // per-stage). The Zod schema constrains values to the pinnable allowlists,
  // but tier-gated models (e.g. veo3 blocked for free) still need a runtime
  // check. Reject BEFORE creating the pipeline row so the caller gets a fast
  // 403 instead of a stuck `failed` row + refund cycle.
  const pinnedRaw: ReadonlyArray<string | undefined> = [
    config.image_model,
    config.video_model,
    config.script_llm,
    ...(config.stage_models ? Object.values(config.stage_models) : []),
  ]
  const pinnedModels = Array.from(
    new Set(pinnedRaw.filter((m): m is string => typeof m === "string" && m.length > 0)),
  )
  if (pinnedModels.length > 0) {
    const { CreditsService } = await import("../billing/credits.js")
    const profile = (profileRow ?? { tier: userTier }) as Parameters<
      typeof CreditsService.checkCreditsWithProfile
    >[1]
    for (const modelId of pinnedModels) {
      const check = await CreditsService.checkCreditsWithProfile(userId, profile, modelId)
      if (!check.allowed) {
        return {
          ok: false,
          status: 403,
          code: "model_pin_forbidden",
          model: modelId,
          message:
            check.error ??
            `You can't pin '${modelId}' on this plan. Upgrade your subscription or pick a different model.`,
        }
      }
    }
  }

  const upfront = estimateUpfrontCredits({
    targetDurationSeconds: input.target_duration_seconds,
    format: input.format,
    mode,
    musicEnabled: config.music_enabled ?? true,
    narrationEnabled: config.narration_enabled ?? true,
    lipsyncEnabled: config.lipsync_enabled ?? true,
    videoCriticFrameCount: input.video_critic_frame_count,
  })
  const maxCost = resolveMaxCostCredits({
    requested: input.max_cost_credits,
    tier: userTier,
  })

  // 1. Insert pipeline row.
  const { data: pipeline, error: insertErr } = await supabase
    .from("pipelines")
    .insert({
      user_id: userId,
      workflow_id: input.workflow_id ?? null,
      root_node_id: input.root_node_id,
      pipeline_type: input.pipeline_type,
      activation_mode: activation,
      mode,
      input_prompt: input.story_prompt,
      target_duration_seconds: input.target_duration_seconds,
      format: input.format,
      output_resolution: input.output_resolution,
      language: input.language,
      style_directives: input.style_directives ?? null,
      config,
      upfront_credit_estimate: upfront,
      reserved_credits: upfront,
      max_cost_credits: maxCost,
    })
    .select("id")
    .single()
  if (insertErr || !pipeline) {
    return { ok: false, status: 500, code: "db_error", detail: insertErr?.message }
  }

  // 2. Reserve credits.
  const reservation = await reservePipelineCredits({
    supabase,
    userId,
    pipelineId: pipeline.id,
    credits: upfront,
  })
  if (!reservation.ok) {
    // Roll back the pipeline row — cheaper than carrying a dead 'queued' row.
    await supabase.from("pipelines").delete().eq("id", pipeline.id)
    return { ok: false, status: 402, code: reservation.reason }
  }

  // 3. Enqueue.
  await enqueuePipelineRun({ pipelineId: pipeline.id, userId, reason: "initial" })

  return { ok: true, pipelineId: pipeline.id }
}
