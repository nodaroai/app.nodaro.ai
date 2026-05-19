import type { SupabaseClient } from "@supabase/supabase-js"
import { TIER_MAX_PIPELINE_COST_CREDITS, type PipelineFormat, type PipelineMode } from "@nodaro/shared"

export interface EstimateUpfrontArgs {
  targetDurationSeconds: number
  format: PipelineFormat
  mode: PipelineMode
  musicEnabled: boolean
  narrationEnabled: boolean
  lipsyncEnabled: boolean
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
 * 1 credit = $0.02.
 */
export function estimateUpfrontCredits(args: EstimateUpfrontArgs): number {
  let credits = 30 // Stage 1 baseline (Phase 1A)
  if (args.musicEnabled) credits += 4 // 7f music timeline
  credits += 3 // 7h Editor LLM
  credits += 3 // 7j final merge (or FreeCut export — 0 cr, but reserve for worst case)
  if (args.mode !== "manual") credits += 0 // future: auto/guided pass premiums
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
