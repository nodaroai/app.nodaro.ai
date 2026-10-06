/**
 * apply-edl — the ONE effective-EDL + pricing helper shared by the route, the
 * DAG payload-builder, and the worker executor, so all three agree on the
 * SAME normalized EDL, the SAME rendered duration, and the SAME reserve.
 *
 * The pure EDL contract (`@nodaro/shared`) is structural vocabulary. The render
 * rule — the effective EDL every ingress builds (`buildEffectiveEdl`), what
 * this renderer can draw (`validateEffectiveEdl`) and its 180-minute output
 * cap — lives in the private workspace package `@nodaro/render-rules`, so the
 * editor judges a render with the same code the ingresses refuse with
 * (decided 2026-10-04: it is not a public `@nodaro/shared` export). It is
 * re-exported here, so every ingress keeps importing it from this one module.
 * What stays here is the backend's own: the per-minute pricing and the DAG
 * reserve.
 */
import { type Edl, edlDurationMs, applyEdlCreditId } from "@nodaro/shared"

export {
  APPLY_EDL_MAX_OUTPUT_MS,
  buildEffectiveEdl,
  effectiveRenderBasis,
  validateEffectiveEdl,
  type ApplyEdlValidation,
  type EffectiveEdlOptions,
} from "@nodaro/render-rules"

/** Base credits per MINUTE of RENDERED output for a FINAL render — the
 *  `apply-edl` row (`applyEdlCreditId`). Single source of truth for the
 *  per-minute rate: `STATIC_CREDIT_COSTS['apply-edl']` (ee/billing/credits.ts)
 *  and the `model_pricing` migration row both mirror this value.
 *
 *  Decided 2026-10-04: the final stays at 10. Same order of magnitude as the
 *  flat ffmpeg render nodes (combine-videos = 30 flat). apply-edl is priced
 *  per output minute because a tightened episode's cut can be minutes long. */
export const APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE = 10

/** Base credits per MINUTE of RENDERED output for a PREVIEW (`quality:
 *  "proxy"`, a video or an audio output) — the `apply-edl:proxy` row
 *  (`applyEdlCreditId`). The ONE value behind
 *  `STATIC_CREDIT_COSTS['apply-edl:proxy']`, the `model_pricing` row
 *  (migrations 454 and 455), the editor's cold-cache fallback and the docs'
 *  worked examples; tests pin each of those copies to this constant.
 *
 *  Decided 2026-10-05: 1 per output minute (was 2). A retune moves this constant, the `model_pricing` row,
 *  the editor fallback and the docs together, and keeps the preview below the
 *  final. */
export const APPLY_EDL_PROXY_CREDITS_PER_OUTPUT_MINUTE = 1

/** The per-minute rate of each id `applyEdlCreditId` can name. Keyed by its
 *  return type, so an id it gains cannot compile here without a rate. */
const APPLY_EDL_RATE_BY_CREDIT_ID: Readonly<Record<ReturnType<typeof applyEdlCreditId>, number>> = {
  "apply-edl": APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE,
  "apply-edl:proxy": APPLY_EDL_PROXY_CREDITS_PER_OUTPUT_MINUTE,
}

/** Minutes of RENDERED output to reserve for — `ceil(edlDurationMs/60000)`,
 *  minimum 1. Runs on the EFFECTIVE EDL so the D17 overlap compression is
 *  already accounted for (a crossfade-heavy cut reserves less). */
export function applyEdlReserveMinutes(edl: Edl): number {
  return Math.max(1, Math.ceil(edlDurationMs(edl) / 60_000))
}

/** BASE credits (pre-markup) for rendering `edl` at `quality` — the rate of the
 *  row `applyEdlCreditId(quality)` names × the rendered minutes — at the
 *  code's own rates. The route (`creditGuard.computeCredits`) and the DAG
 *  (`applyEdlCreditOverride`) reserve the same product with the rate read from
 *  `model_pricing`, which an admin row can override; `creditGuard` applies the
 *  service markup so check and reserve see the same final number. */
export function applyEdlBaseCredits(edl: Edl, quality?: unknown): number {
  return APPLY_EDL_RATE_BY_CREDIT_ID[applyEdlCreditId(quality)] * applyEdlReserveMinutes(edl)
}

/**
 * DAG-side reserve override (probe-at-reserve, but the duration is KNOWN from
 * the effective EDL carried on the payload — no ffprobe needed). Mirrors
 * `lib/dubbing-pricing.ts::projectDubbingCreditOverride`: the workflow dispatch
 * bypasses the HTTP route's `computeCredits`, so it reserves the same
 * per-minute base × minutes (with markup) that a single-node Run would — on
 * the row of the payload's `quality` (`applyEdlCreditId`), the same id the
 * payload builder names as the node's reserve id. The job itself is always
 * `apply-edl`. Returns `undefined` for any other job so the `??` chain in
 * node-executor falls through.
 */
export async function applyEdlCreditOverride(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<number | undefined> {
  if (jobName !== "apply-edl") return undefined
  const edl = payload.edl as Edl | undefined
  if (!edl || !Array.isArray(edl.segments)) return undefined
  const minutes = applyEdlReserveMinutes(edl)
  const creditId = applyEdlCreditId(payload.quality)
  const { getModelCreditBaseCost } = await import("../ee/billing/credits.js")
  const { creditCost } = await getModelCreditBaseCost(creditId)
  const { applyServiceMarkup } = await import("../ee/billing/service-margin.js")
  const { getAppSettings } = await import("./app-settings.js")
  return applyServiceMarkup(creditCost * minutes, await getAppSettings(), creditId)
}
