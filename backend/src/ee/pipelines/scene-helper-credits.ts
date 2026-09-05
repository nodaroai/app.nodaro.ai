import type { SupabaseClient } from "@supabase/supabase-js"
import type { BillingContext } from "../../lib/billing-context.js"
import { mapReserveError, type MappedReserveError } from "../../lib/reserve-errors.js"
// Track A: the step-8 enforcement flip (see pipelines/credits.ts).
import { allowanceEnforcementActive } from "../../lib/deployment-payer.js"
import { attemptAutoRecharge } from "../billing/auto-recharge.js"
import { creditsToUsd } from "@nodaro/shared"
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
  /** The requesting lane's resolved payer (P14). Absent = personal. */
  billingContext?: BillingContext
}

export type ReserveHelperResult =
  | { ok: true; usageLogId: string }
  | {
      ok: false
      reason: "insufficient_credits" | "rpc_error" | "price_not_configured" | MappedReserveError["code"]
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
  // P14/W4e: the resolved payer rides p_workspace_id — conditional spread, a
  // personal call's wire shape stays byte-identical to pre-P14.
  const ws = args.billingContext?.payer === "workspace" ? args.billingContext : undefined
  // Deployment payer (item 9): debit the payer account through the RPC's
  // personal branch (the CreditsService.reserveCredits mirror).
  const dep = args.billingContext?.payer === "deployment" ? args.billingContext : undefined
  const { data: usageLogId, error } = await args.supabase.rpc("reserve_credits", {
    p_user_id: dep ? dep.payerId : args.userId,
    p_credits: credits,
    p_job_id: null,
    p_model_identifier: modelIdentifier,
    ...(ws ? { p_workspace_id: ws.workspaceId } : {}),
    p_provider_cost_usd: 0, // helpers aggregate to provider cost on the parent pipeline
    p_display_cost_usd: creditsToUsd(credits),
    p_is_app_run: false,
    // Track A / D3, identical to the pipeline lane: attribution and
    // enforcement, conditional so the personal wire shape is untouched, and
    // neither for the payer's own run (D13).
    ...(dep && args.userId !== dep.payerId
      ? { p_on_behalf_of: args.userId, p_enforce_allowance: allowanceEnforcementActive() }
      : {}),
  })
  if (error) {
    // This substring test runs BEFORE mapReserveError — a refusal prefix
    // containing "insufficient" or "not enough" would be downgraded here to
    // the generic wallet-empty answer (D9).
    const msg = error.message ?? ""
    if (msg.toLowerCase().includes("insufficient") || msg.toLowerCase().includes("not enough")) {
      return { ok: false, reason: "insufficient_credits" }
    }
    // P14.3 (dormant until W4e): stable code over generic rpc_error.
    const refusal = mapReserveError(new Error(msg))
    if (refusal) {
      return { ok: false, reason: refusal.code, detail: refusal.message }
    }
    return { ok: false, reason: "rpc_error", detail: msg }
  }
  if (!usageLogId) {
    return { ok: false, reason: "insufficient_credits" }
  }
  // Reserve succeeded — balance dropped; auto-recharge check (fire-and-
  // forget, never blocks the pipeline). Covers the direct-RPC reserve lane
  // the CreditsService hook can't see (audit F2.2). NEVER for a workspace
  // payer — class work must not pump a member's saved card. NEVER for a
  // deployment payer — prepaid-only, no card to pump.
  if (!ws && !dep) void attemptAutoRecharge(args.userId)
  // The post-hoc `on_behalf_of` UPDATE that used to live here is GONE (D5) —
  // migration 382's reserve writes the column in its own INSERT.
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
