import type { SupabaseClient } from "@supabase/supabase-js"
import { CHAT_STAGES, CHAT_TURN_CAPS, TIER_MAX_PIPELINE_COST_CREDITS, ShowrunnerPlanSchema, buildVideoCreditModelIdentifier, type PipelineFormat, type PipelineMode, type VideoCriticFrameMode } from "@nodaro/shared"
// ee-to-ee static import — allowed (only core/backend/src/lib/** is barred from
// statically importing ee/**). Direct precedent: scene-helper-credits.ts
// (same directory) statically imports this same module for the same reason —
// per-model credit lookup by identifier.
import { getModelCreditCostFromDB } from "../billing/credits.js"
// Type-only — erased at compile time, so this can't form a runtime import
// cycle with seed-pipeline.ts's own (dynamic, function-body) import of this
// file's `estimateUpfrontCredits`/`reservePipelineCredits`.
import type { SeededPipelineInput } from "./seed-pipeline.js"

const PER_TURN_ESTIMATE_CREDITS = 2 // cached Sonnet 4.6 turn /
const STORYBOARD_COHESION_CREDITS = 5 // Sonnet vision call with N images × markup /

/**
 * Phase 1D.2c-b-ii (G1): per-shot Video Critic budget by frame extraction mode.
 *
 * Cost scales with how many frames the critic ingests:
 *   - first_last         (2 frames): ~$0.02 → 2 credits/shot
 *   - first_middle_last  (3 frames): ~$0.03 → 3 credits/shot
 *   - five_evenly        (5 frames): ~$0.05 → 4 credits/shot
 *
 * Reservations are upfront and worst-case. Unused credits refund on pipeline
 * completion via the normal credit reconciliation path.
 */
const VIDEO_CRITIC_PER_SHOT_CREDITS: Record<VideoCriticFrameMode, number> = {
  first_last: 2,
  first_middle_last: 3,
  five_evenly: 4,
}

/**
 * Floor on `estimatedShots` so very short reels still budget for a few
 * shots' worth of video-critic calls. ceil(5/4) = 2 alone would be too
 * tight — 5 is the conservative minimum we've seen in practice for
 * <20s clips.
 */
const VIDEO_CRITIC_SHOT_FLOOR = 5

/**
 * Shot-count derivation for the upfront credit estimate. No pre-existing
 * scene/shot inventory exists at pipeline-creation time (the showrunner
 * runs in Stage 1), so we approximate from `target_duration_seconds`
 * assuming ~4s/shot. The floor keeps reservations safe for short reels.
 *
 * Exported for testability of the formula across frame-mode budgets.
 */
export function estimateShotCount(targetDurationSeconds: number): number {
  return Math.max(VIDEO_CRITIC_SHOT_FLOOR, Math.ceil(targetDurationSeconds / 4))
}

export interface EstimateUpfrontArgs {
  targetDurationSeconds: number
  format: PipelineFormat
  mode: PipelineMode
  musicEnabled: boolean
  narrationEnabled: boolean
  lipsyncEnabled: boolean
  /**
   * Phase 1D.2c-b-ii (G1): per-shot Video Critic frame extraction mode.
   * Defaults to "first_last" when absent so callers from older code paths
   * still get a correct (worst-case-cheap) reservation.
   */
  videoCriticFrameCount?: VideoCriticFrameMode
}

/**
 * Pipeline-level upfront credit estimate.
 *
 * Phase 1A baseline: 30 credits covers the Stage 1 LLM chain (Detection +
 * Showrunner + Script Critic + Cast Coverage Critic) with retry headroom.
 *
 * Phase 1C.2 adds the Stage 7 sub-step costs that run once per pipeline
 * (NOT per scene) and are reserved against pipeline-level identifiers in
 * `model_pricing` (migration 135):
 *
 *   - 7f music timeline   (`pipeline-music-timeline`)      4 credits
 *   - 7g beat-grid extract (`pipeline-beat-grid-extract`)  0 credits
 *   - 7h Editor LLM        (`pipeline-editor-llm`)          3 credits
 *   - 7j final merge       (`pipeline-final-merge`)         3 credits
 *
 * FreeCut export (`pipeline-freecut-export`) is 0 credits so the estimate
 * doesn't change when `freecut_export_enabled = true` — we always include
 * the 3 cr final-merge cost as the worst-case estimate so the user
 * reserves enough upfront, and the actual consumed identifier depends on
 * the runtime branch (mp4 vs freecut).
 *
 * Music can be disabled via `config.music_enabled = false`, in which case
 * the 4 cr music allocation is skipped. The estimate intentionally
 * doesn't model narration/lipsync at the pipeline level — those are
 * per-shot costs reserved separately by the worker jobs they invoke.
 *
 * Phase 1D.2c-b-i adds the Storyboard Cohesion critic budget (5 credits)
 * to the baseline. It runs once during Stage 6 (scene_images) in ALL 3
 * modes (manual / auto / guided) — warn-only, never blocks — so it's
 * added unconditionally outside the `mode === "guided"` branch.
 *
 * Phase 1D.2c-b-ii (G1) adds the per-shot Video Critic budget. Cost scales
 * with both the frame extraction mode (2/3/4 cr per shot for
 * first_last/first_middle_last/five_evenly) and the estimated shot count
 * `max(5, ceil(targetDuration/4))`. The shot-count formula is upfront
 * worst-case; the Showrunner's actual `shots` arrays only land after
 * Stage 5, by which point the reservation already needs to be in place.
 * Unused credits refund on completion via normal reconciliation.
 *
 * Phase 1D.2c (post-merge chat) widens the guided-mode chat budget to ALL
 * wired chat stages (loops over `CHAT_STAGES[stage].wired`). With Script
 * (20 turns × 2cr = 40cr) AND Post-merge (8 turns × 2cr = 16cr) wired in
 * 1D.2c, guided mode now reserves 56cr of chat budget upfront — was 40cr
 * pre-fix, exposing post-merge chat spend as mid-conversation unreserved
 * usage. Unused turns refund automatically via the pipeline's normal credit
 * reconciliation at completion.
 *
 * 1 credit = $0.02.
 */
export function estimateUpfrontCredits(args: EstimateUpfrontArgs): number {
  let credits = 30 // Stage 1 baseline (Phase 1A)
  if (args.musicEnabled) credits += 4 // 7f music timeline
  credits += 3 // 7h Editor LLM
  credits += 3 // 7j final merge (or FreeCut export — 0 cr, but reserve for worst case)
  credits += STORYBOARD_COHESION_CREDITS // Phase 1D.2c-b-i: Storyboard Cohesion critic (all modes)
  // Phase 1D.2c-b-ii (G1): per-shot Video Critic budget. Default frame mode
  // is "first_last" so older call-sites that don't thread the field through
  // still reserve a sensible worst-case amount.
  const frameMode: VideoCriticFrameMode = args.videoCriticFrameCount ?? "first_last"
  const estimatedShots = estimateShotCount(args.targetDurationSeconds)
  credits += VIDEO_CRITIC_PER_SHOT_CREDITS[frameMode] * estimatedShots
  if (args.mode === "guided") {
    // Reserve chat-refine budget for ALL stages whose chat code paths are
    // actually wired (CHAT_STAGES[stage].wired === true). 1D.2b wired Script
    // (20 turns); 1D.2c wired Post-merge (8 turns). Worst-case at 2cr/turn:
    //   script (20) × 2 + post_merge (8) × 2 = 40 + 16 = 56 credits.
    // Unwired stages (shot_list pre-declared for 1D.2d) reserve 0.
    let chatBudget = 0
    for (const stage of Object.keys(CHAT_STAGES) as Array<keyof typeof CHAT_STAGES>) {
      if (CHAT_STAGES[stage].wired) {
        chatBudget += CHAT_TURN_CAPS[stage] * PER_TURN_ESTIMATE_CREDITS
      }
    }
    credits += chatBudget
  }
  return credits
}

export interface ResolveMaxCostArgs {
  requested?: number
  tier: string
}

export function resolveMaxCostCredits({ requested, tier }: ResolveMaxCostArgs): number {
  const tierCap = TIER_MAX_PIPELINE_COST_CREDITS[tier] ?? 300
  if (requested === undefined || requested === null) return tierCap
  return Math.min(requested, tierCap)
}

export interface ReservePipelineCreditsArgs {
  supabase: SupabaseClient
  userId: string
  pipelineId: string
  credits: number
}

export type ReservePipelineResult =
  | { ok: true; usageLogId: string }
  | { ok: false; reason: "insufficient_credits" | "rpc_error"; detail?: string }

/**
 * Reserves `credits` for a pipeline run via the shared `reserve_credits` RPC.
 * Passes `p_job_id: null` because `usage_logs.job_id` is FK-constrained to `jobs(id)`
 * and pipeline runs don't create a `jobs` row. The link from a usage_log back to
 * its pipeline is stored on `pipelines.reservation_usage_log_id` (migration 122),
 * which is sufficient for refund lookup.
 *
 * If the RPC returns `null`/error → insufficient credits.
 */
export async function reservePipelineCredits(
  args: ReservePipelineCreditsArgs,
): Promise<ReservePipelineResult> {
  const { data: usageLogId, error } = await args.supabase.rpc("reserve_credits", {
    p_user_id: args.userId,
    p_credits: args.credits,
    p_job_id: null,
    p_model_identifier: "pipeline-orchestration",
    p_provider_cost_usd: 0, // pipelines aggregate many provider calls; tracked separately
    p_display_cost_usd: args.credits * 0.02,
    p_is_app_run: false,
  })
  if (error) {
    // Distinguish "insufficient credits" (RPC raises) from other DB errors.
    const msg = error.message ?? ""
    if (msg.toLowerCase().includes("insufficient") || msg.toLowerCase().includes("not enough")) {
      return { ok: false, reason: "insufficient_credits" }
    }
    return { ok: false, reason: "rpc_error", detail: msg }
  }
  if (!usageLogId) {
    return { ok: false, reason: "insufficient_credits" }
  }
  // Persist for later refund.
  const { error: updateError } = await args.supabase
    .from("pipelines")
    .update({ reservation_usage_log_id: usageLogId as string })
    .eq("id", args.pipelineId)
  if (updateError) {
    // The reservation succeeded; logging is non-fatal but we can't refund without the link.
    console.error("[pipelines/credits] Failed to persist reservation_usage_log_id:", updateError.message)
  }
  return { ok: true, usageLogId: usageLogId as string }
}

export interface RefundPipelineCreditsArgs {
  supabase: SupabaseClient
  userId: string
  pipelineId: string
  credits?: number // ignored — refund_credits refunds the full reserved amount
  reason: string
}

/**
 * Refunds the pipeline's prior reservation. Looks up the usage_log_id from
 * `pipelines.reservation_usage_log_id` and calls `refund_credits(p_usage_log_id)`.
 * Idempotent — safe to call multiple times; the RPC won't double-refund.
 */
export async function refundPipelineCredits(args: RefundPipelineCreditsArgs): Promise<void> {
  const { data: pipeline, error: fetchError } = await args.supabase
    .from("pipelines")
    .select("reservation_usage_log_id")
    .eq("id", args.pipelineId)
    .maybeSingle()
  if (fetchError || !pipeline?.reservation_usage_log_id) {
    // No reservation to refund — pipeline either never reserved or already refunded.
    return
  }
  const usageLogId = pipeline.reservation_usage_log_id
  const { error } = await args.supabase.rpc("refund_credits", { p_usage_log_id: usageLogId })
  if (error) {
    console.error(`[pipelines/credits] refund_credits failed (${args.reason}):`, error.message)
    return
  }
  // Clear the link so a future refund call is a fast no-op.
  const { error: clearError } = await args.supabase
    .from("pipelines")
    .update({ reservation_usage_log_id: null })
    .eq("id", args.pipelineId)
  if (clearError) {
    console.error(
      `[pipelines/credits] Failed to clear reservation_usage_log_id after refund:`,
      clearError.message,
    )
  }
}

// ============================================================
// Seeded-run credit estimator (Task A2)
// ============================================================

export type SeededPipelineEstimateInput = Pick<SeededPipelineInput, "plan" | "scenes" | "config">

export interface SeededPipelineCreditEstimate {
  totalCredits: number
  breakdown: Record<string, number>
}

/**
 * Keyframe image-gen default when `config.image_model` is unset. Matches
 * `pipelineGenerateImage`'s own fallback (services/pipeline-generate-image.ts)
 * so the estimate agrees with what an un-pinned seeded run actually reserves.
 */
const DEFAULT_KEYFRAME_IMAGE_MODEL = "nano-banana"

/**
 * Per-shot video-gen default when `config.video_model` is unset. No
 * pipeline-wide default exists elsewhere — an un-pinned run normally lets the
 * Scene Director pick per shot, which doesn't exist yet at estimate time (the
 * Director runs after Stage 1, seeded runs only carry the plan). "kling-turbo"
 * is the cheapest well-supported i2v model and is called out as the go-to
 * cheap default elsewhere in the catalog (see `OBJECT_MOTION_PROVIDERS` in
 * model-constants.ts). Picking it here keeps the pre-Director estimate a
 * concrete number instead of an unpriced "TBD".
 */
const DEFAULT_SHOT_VIDEO_MODEL = "kling-turbo"

/**
 * Per-dialogue-line speech credit identifier. Matches the default `provider`
 * `pipelineGenerateSpeech` uses (services/pipeline-generate-speech.ts).
 * `PipelineConfigSchema` has no `speech_model`/`tts_model` override field, so
 * every seeded run's dialogue synthesis reserves against this exact identifier.
 */
const DIALOGUE_TTS_CREDIT_IDENTIFIER = "elevenlabs-turbo"

/**
 * Pipeline-level music credit identifier. `runMusicTimeline` (music-timeline.ts)
 * always calls `pipelineGenerateMusic({ provider: "suno" })` without a
 * `modelVersion`, which defaults to Suno V5.5 → credit id "suno-v5_5"
 * (services/pipeline-generate-music.ts). `config.music_model` is accepted by
 * `PipelineConfigSchema` but isn't wired into that call path today — honoring
 * it here would overstate precision the runtime doesn't have, so this
 * constant matches what actually gets reserved.
 */
const PIPELINE_MUSIC_CREDIT_IDENTIFIER = "suno-v5_5"

/**
 * One scene's contribution to the `animation` breakdown line: one video-gen
 * credit per anticipated shot, priced at that shot's approximate duration
 * (`duration_seconds / shot_count_hint`, snapped to the model's nearest
 * priced tier by `buildVideoCreditModelIdentifier` — see the `animation`
 * bullet on `estimateSeededPipelineCredits` below for the full rationale,
 * including the unpinned-`video_model` FLOOR caveat).
 *
 * `shot_count_hint` is `z.number().int().min(1).max(8)` on `SceneSpecSchema`
 * (packages/shared/src/pipeline-types.ts) today, so a scene with 0 shouldn't
 * reach here via the validated `plan` path in `estimateSeededPipelineCredits`
 * (`ShowrunnerPlanSchema.parse` rejects it first). The guard below is
 * unconditional defense-in-depth regardless of what the schema allows —
 * dividing by a 0 shot count is `Infinity`, and `buildVideoCreditModelIdentifier`'s
 * duration-tier lookup doesn't throw on that: it silently falls back to the
 * model's MOST EXPENSIVE priced tier (`tiers.find(...) ?? tiers[last]`),
 * which would silently overcharge a scene that should cost 0 rather than
 * fail loudly. Confirmed empirically while fixing this: removing the guard
 * makes a 0-shot scene price as `kling-turbo`'s `:10s` tier, not throw and
 * not 0.
 *
 * Exported for direct testability of that guard, independent of
 * `ShowrunnerPlanSchema`'s current validation — mirrors `estimateShotCount`'s
 * own "exported for testability" precedent above.
 */
export async function estimateSceneAnimationCredits(
  scene: { duration_seconds: number; shot_count_hint: number },
  videoModel: string,
): Promise<number> {
  if (scene.shot_count_hint <= 0) return 0
  // Rounding mirrors pipelineAnimateShot.ts's own `Math.max(1, Math.round(duration))`
  // before it builds the same composite identifier for the real reservation.
  const perShotSeconds = Math.max(1, Math.round(scene.duration_seconds / scene.shot_count_hint))
  const identifier = buildVideoCreditModelIdentifier(
    videoModel,
    perShotSeconds,
    /* sound */ undefined,
    "image-to-video",
  )
  const pricing = await getModelCreditCostFromDB(identifier)
  return pricing.creditCost * scene.shot_count_hint
}

/**
 * Upfront credit ESTIMATE for a seeded pipeline run — the server-side number
 * shown to a caller BEFORE it calls `createSeededPipeline` (seed-pipeline.ts)
 * with the same `plan`/`scenes`/`config` triple. A3 exposes this as
 * `tk.pipelines.estimateSeeded`.
 *
 * Breakdown keys:
 *   - `pipelineUpfront` — the same pipeline-level reservation
 *     `createSeededPipeline` computes via `estimateUpfrontCredits`, with
 *     `mode` hardcoded to `"auto"` (seeded runs always run unattended — see
 *     `createSeededPipeline` in seed-pipeline.ts).
 *   - `keyframes` — one image-gen credit per anticipated shot
 *     (`plan.scenes[].shot_count_hint` summed), priced by `config.image_model`
 *     (default "nano-banana").
 *   - `animation` — one video-gen credit per anticipated shot, priced by
 *     `config.video_model` (default "kling-turbo") at that shot's
 *     approximate duration (`scene.duration_seconds / scene.shot_count_hint`
 *     — real per-shot durations don't exist until the Scene Director runs).
 *     `buildVideoCreditModelIdentifier` snaps that duration to the model's
 *     nearest priced tier, exactly like the real per-shot animate call does
 *     (services/pipeline-animate-shot.ts).
 *   - `speech` — one TTS credit (`elevenlabs-turbo`) per planned dialogue
 *     line (`plan.scenes[].dialogue.length` summed).
 *   - `music` — one Suno credit (`suno-v5_5`) when `config.music_enabled` is
 *     not `false`, else 0.
 *
 * Every per-item cost is resolved via `getModelCreditCostFromDB` — the SAME
 * post-markup resolver `CreditsService.reserveCredits` calls for every real
 * child job (services/_run-worker-job.ts) — so a `model_pricing` row edit OR
 * an admin markup change flows through automatically. Nothing here is a
 * hand-written credit number.
 *
 * **This is an ESTIMATE, not a quote.** With BOTH `config.image_model` AND
 * `config.video_model` pinned, it's accurate to roughly ±20% — real per-shot
 * durations and dialogue counts are the only things left to finalize once
 * the Scene Director and each per-shot job actually run.
 *
 * When `config.video_model` is left unpinned, `animation` is NOT a ±20%
 * point estimate — it's a FLOOR, not a midpoint. The real (unpinned) Scene
 * Director picks freely from the eligible video-model set per shot once it
 * actually runs (Stage 5+), which this function has no visibility into at
 * estimate time; every anticipated shot is priced at
 * `DEFAULT_SHOT_VIDEO_MODEL`, the cheapest well-supported eligible model. A
 * pricier eligible model can cost roughly 6-8x that floor per shot, so an
 * unpinned run's real `animation` spend can land well above this number —
 * pin `video_model` in `config` for a tighter upfront number.
 *
 * Either way, every child job re-reserves its OWN real cost at run time (this
 * function never reserves or spends anything itself — it's a pure read).
 *
 * `input.scenes` (pre-built SceneNodeData, when the caller already has a full
 * shot list) is accepted for type parity with `SeededPipelineInput` /
 * `createSeededPipeline` but not yet consulted here — today's estimate is
 * derived entirely from `plan` + `config`. A future refinement could prefer
 * real per-shot durations/dialogue/model picks from `scenes` when present for
 * a tighter number.
 *
 * @param _supabase Accepted for signature parity with `reservePipelineCredits`/
 *   `refundPipelineCredits` and so A3 can wire every `tk.pipelines.*` method
 *   the same way. Currently unused — `getModelCreditCostFromDB` resolves
 *   pricing through `ee/billing/credits.ts`'s own `supabase` singleton, and
 *   this function makes no other DB calls.
 */
export async function estimateSeededPipelineCredits(
  _supabase: SupabaseClient,
  input: SeededPipelineEstimateInput,
): Promise<SeededPipelineCreditEstimate> {
  const plan = ShowrunnerPlanSchema.parse(input.plan)
  const config = (input.config ?? {}) as Record<string, unknown>
  const musicEnabled = (config.music_enabled as boolean | undefined) ?? true

  const shotCount = plan.scenes.reduce((sum, scene) => sum + scene.shot_count_hint, 0)
  const dialogueLineCount = plan.scenes.reduce((sum, scene) => sum + scene.dialogue.length, 0)

  const pipelineUpfront = estimateUpfrontCredits({
    targetDurationSeconds: plan.target_duration_seconds,
    format: plan.format,
    mode: "auto", // seeded pipelines always run auto (seed-pipeline.ts hardcodes this)
    musicEnabled,
    narrationEnabled: (config.narration_enabled as boolean | undefined) ?? true,
    lipsyncEnabled: (config.lipsync_enabled as boolean | undefined) ?? true,
    videoCriticFrameCount: config.video_critic_frame_count as VideoCriticFrameMode | undefined,
  })

  const imageModel = (config.image_model as string | undefined) ?? DEFAULT_KEYFRAME_IMAGE_MODEL
  const videoModel = (config.video_model as string | undefined) ?? DEFAULT_SHOT_VIDEO_MODEL

  const imagePricing = await getModelCreditCostFromDB(imageModel)
  const keyframes = shotCount * imagePricing.creditCost

  // One video-credit lookup per scene (shots within a scene share the same
  // approximate duration), summed by that scene's shot count.
  const perSceneAnimationCredits = await Promise.all(
    plan.scenes.map((scene) => estimateSceneAnimationCredits(scene, videoModel)),
  )
  const animation = perSceneAnimationCredits.reduce((sum, credits) => sum + credits, 0)

  let speech = 0
  if (dialogueLineCount > 0) {
    const speechPricing = await getModelCreditCostFromDB(DIALOGUE_TTS_CREDIT_IDENTIFIER)
    speech = dialogueLineCount * speechPricing.creditCost
  }

  let music = 0
  if (musicEnabled) {
    const musicPricing = await getModelCreditCostFromDB(PIPELINE_MUSIC_CREDIT_IDENTIFIER)
    music = musicPricing.creditCost
  }

  const breakdown: Record<string, number> = { pipelineUpfront, keyframes, animation, speech, music }
  const totalCredits = Object.values(breakdown).reduce((sum, credits) => sum + credits, 0)
  return { totalCredits, breakdown }
}
