import type { SupabaseClient } from "@supabase/supabase-js"
import type { SceneHelperName } from "@nodaro/shared"
import {
  CreditsService,
  PriceNotConfiguredError,
  getModelCreditBaseCost,
} from "../billing/credits.js"

/**
 * Per-helper credit cost (admin-overridable via the `model_pricing` row
 * `scene-helper:<name>`). Falls back to `STATIC_CREDIT_COSTS` in `credits.ts`
 * when the DB row isn't present (e.g. an environment that hasn't applied
 * migration 130). `getModelCreditBaseCost` throws `PriceNotConfiguredError`
 * if neither source has the identifier; we treat that as a configuration
 * error and surface it via the {@link ReserveHelperResult} reason so the
 * route can reply 503 (rather than silently charging 0 or 1 credit).
 */
async function helperCreditCost(name: SceneHelperName): Promise<number> {
  const result = await getModelCreditBaseCost(`scene-helper:${name}`)
  return result.creditCost
}

export interface ReserveHelperCreditsArgs {
  supabase: SupabaseClient
  userId: string
  helperName: SceneHelperName
}

export type ReserveHelperResult =
  | { ok: true; usageLogId: string }
  | {
      ok: false
      reason: "insufficient_credits" | "rpc_error" | "price_not_configured"
      detail?: string
    }

/**
 * Reserves credits for a single Scene-Context helper invocation.
 *
 * Calls the shared `reserve_credits` RPC directly with the helper's per-call
 * `model_identifier` (`scene-helper:<name>`) and `p_job_id: null` — helpers
 * don't produce a `jobs` row.
 *
 * **Important:** does NOT write to `pipelines.reservation_usage_log_id`. That
 * column tracks the pipeline-level upfront reservation (see
 * `reservePipelineCredits` in `./credits.ts`); overwriting it from a helper
 * would lose the link to the original reservation. The caller is responsible
 * for storing the returned `usageLogId` (typically on the SceneNode data /
 * tool-call record) for later refund.
 *
 * Pattern matches `reservePipelineCredits` for "insufficient credits"
 * detection (RPC raises with "insufficient"/"not enough" in the message; a
 * null return also indicates the user can't afford the reservation).
 */
export async function reserveHelperCredits(
  args: ReserveHelperCreditsArgs,
): Promise<ReserveHelperResult> {
  let credits: number
  try {
    credits = await helperCreditCost(args.helperName)
  } catch (err) {
    if (err instanceof PriceNotConfiguredError) {
      return { ok: false, reason: "price_not_configured", detail: err.message }
    }
    throw err
  }
  const modelIdentifier = `scene-helper:${args.helperName}`
  const { data: usageLogId, error } = await args.supabase.rpc("reserve_credits", {
    p_user_id: args.userId,
    p_credits: credits,
    p_job_id: null,
    p_model_identifier: modelIdentifier,
    p_provider_cost_usd: 0, // helpers aggregate to provider cost on the parent pipeline
    p_display_cost_usd: credits * 0.02,
    p_is_app_run: false,
  })
  if (error) {
    const msg = error.message ?? ""
    if (msg.toLowerCase().includes("insufficient") || msg.toLowerCase().includes("not enough")) {
      return { ok: false, reason: "insufficient_credits" }
    }
    return { ok: false, reason: "rpc_error", detail: msg }
  }
  if (!usageLogId) {
    return { ok: false, reason: "insufficient_credits" }
  }
  return { ok: true, usageLogId: usageLogId as string }
}

/**
 * Refunds a prior helper reservation via the canonical
 * {@link CreditsService.refundCredits} path (which prefers the
 * `refund_credits` RPC and falls back to the atomic claim-then-restore
 * sequence). Idempotent at the RPC level — safe to call multiple times.
 *
 * The `supabase` arg is accepted for backwards compatibility with the route
 * call sites but is unused; `CreditsService.refundCredits` uses the module
 * singleton.
 */
export async function refundHelperCredits(
  _supabase: SupabaseClient,
  usageLogId: string,
): Promise<void> {
  await CreditsService.refundCredits(usageLogId)
}
