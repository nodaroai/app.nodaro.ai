// P14 — one payer per pipeline.
//
// A deliberately LIGHT module (supabase types + the core billing-context
// seam only): the worker-lane reserve services dynamic-import it beside the
// heavy CreditsService, and hermetic tests of those services must not drag
// the whole pipeline-credits import graph in through it.
import type { SupabaseClient } from "@supabase/supabase-js"
import { isBillingContext, isDeploymentBillingContext, personalPayer, type BillingContext } from "../../lib/billing-context.js"

/** Small in-process cache: a pipeline's payer is immutable once stamped. */
const pipelineCtxCache = new Map<string, BillingContext>()
const PIPELINE_CTX_CACHE_MAX = 500

/**
 * The pipeline's resolved payer (P14/W4e), read from the durable stamp
 * `pipelines.config.billingContext` written at creation.
 *
 * The pipeline lane is re-enqueued from ~23 sites — stage advances, chat
 * edits, the reconcile cron (req-less!) — so carrying the context on the
 * drive-job payload would either fan out to every one of them or let a
 * resume request re-resolve mid-pipeline and split one pipeline across two
 * payers. The ROW is the pipeline's state everywhere else; the payer lives
 * with it. Absent or malformed (a pre-P14 pipeline, a forged value) reads
 * as the creator's personal payer — the normative absent rule.
 */
export async function getPipelineBillingContext(
  supabase: SupabaseClient,
  pipelineId: string,
  fallbackUserId: string,
): Promise<BillingContext> {
  const hit = pipelineCtxCache.get(pipelineId)
  if (hit) return hit
  // Worker-lane, service-role read of the pipeline's own stamped payer —
  // pipelineId comes from the drive job / an ownership-checked route, never
  // raw user input.
  const { data, error } = await supabase
    .from("pipelines")
    .select("user_id, config")
    .eq("id", pipelineId)
    .maybeSingle()
  if (error) {
    // A transient read failure must NOT silently and durably re-point a
    // workspace-paid pipeline at a personal pocket: log it, answer the
    // DEGRADED personal fallback (a spend site may refuse it), and cache
    // nothing — the next read retries.
    console.error(
      `[pipeline-payer] failed to read the payer stamp for pipeline ${pipelineId} — degraded personal:`,
      error.message,
    )
    return { payer: "user", userId: fallbackUserId, degraded: true }
  }
  const raw = (data?.config as Record<string, unknown> | null)?.billingContext
  // The personal fallback prefers the ROW's user_id (the pipeline's owner —
  // who an unstamped pre-P14 pipeline has always billed) over the caller's
  // id; the two can differ on worker lanes.
  // Two guards on purpose: isBillingContext admits the PLUGIN shapes only
  // (user/workspace), and a DEPLOYMENT stamp (SAI item 9) written at
  // creation would degrade to the owner's personal payer here — billing the
  // pocket the deployment promised to cover, on every req-less pipeline
  // lane. isDeploymentBillingContext admits that third shape with the same
  // literal-checking rigor.
  const ctx =
    isBillingContext(raw) || isDeploymentBillingContext(raw)
      ? raw
      : personalPayer((data?.user_id as string | undefined) ?? fallbackUserId)
  if (pipelineCtxCache.size >= PIPELINE_CTX_CACHE_MAX) pipelineCtxCache.clear()
  pipelineCtxCache.set(pipelineId, ctx)
  return ctx
}

/** @internal Exported only for tests: reset the per-process payer cache. */
export function clearPipelineBillingContextCache(): void {
  pipelineCtxCache.clear()
}

/**
 * The ONE stamping rule for `pipelines.config` (create, seed, and — via its
 * null-mapping wrapper — branch): strip any caller-supplied
 * `billingContext` first (a forged payer riding user config must not
 * survive into the durable stamp), then stamp the RESOLVED one.
 */
export function stampPipelineConfig(
  rawConfig: Record<string, unknown> | null | undefined,
  billingContext: BillingContext | undefined,
): Record<string, unknown> {
  const { billingContext: _forged, ...userConfig } = rawConfig ?? {}
  return billingContext ? { ...userConfig, billingContext } : userConfig
}
