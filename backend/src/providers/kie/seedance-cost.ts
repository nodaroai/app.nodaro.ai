import { KIE_CREDIT_USD } from "./models.js"

/**
 * What KIE bills for a Seedance 2.5 render, recorded as the job's provider
 * cost (`jobs.provider_cost`). Recorded only: it reaches the commit as
 * `result.cost`, and the charge — the reserved tier, or the measured count of
 * a run settled from its delivered clip — never reads it.
 *
 * A render's real length is known only once it is delivered, so the worker
 * computes this from the seconds it measures for the charge (the same seconds),
 * not the adapter, which reports the model entry's nominal figure.
 */

/**
 * Seedance 2.5's per-second rate, in KIE credits (each `KIE_CREDIT_USD`), by
 * the resolution it renders at: `plain` without a reference video (billed on
 * the output seconds), `ref` with one (billed on input + output seconds). The
 * figures the `seedance-2-5` model entry (models.ts) carries.
 */
export const SEEDANCE_25_KIE_CREDITS_PER_SEC: Readonly<Record<"480p" | "720p" | "1080p", { plain: number; ref: number }>> = {
  "480p": { plain: 28, ref: 17 },
  "720p": { plain: 63, ref: 38 },
  "1080p": { plain: 158, ref: 95 },
}

type Seedance25Resolution = keyof typeof SEEDANCE_25_KIE_CREDITS_PER_SEC

const isSeedance25Resolution = (resolution: string | undefined): resolution is Seedance25Resolution =>
  resolution === "480p" || resolution === "720p" || resolution === "1080p"

/**
 * The USD KIE bills for a Seedance 2.5 render: a draft renders (and bills) at
 * 480p, whatever resolution it was sent with; an unknown resolution renders at
 * the model's default, 720p. With a reference video the `ref` rate covers
 * `inputSec + outputSec`; without one the `plain` rate covers `outputSec`.
 */
export function seedance25CostUsd(o: {
  resolution: string | undefined
  draft: boolean
  hasVideoRef: boolean
  outputSec: number
  inputSec: number
}): number {
  const tier: Seedance25Resolution = o.draft ? "480p" : isSeedance25Resolution(o.resolution) ? o.resolution : "720p"
  const rate = SEEDANCE_25_KIE_CREDITS_PER_SEC[tier]
  const kieCredits = o.hasVideoRef ? rate.ref * (o.inputSec + o.outputSec) : rate.plain * o.outputSec
  return kieCredits * KIE_CREDIT_USD
}

/**
 * The 1080p HD finalize of a Seedance 2.5 draft (`bytedance/seedance-2-5-draft`):
 * its own per-second rate, in KIE credits — `plain` for a draft made without a
 * reference video (billed on the draft's output seconds), `ref` for one made
 * with one (billed on input + output seconds). The figures the
 * `seedance-2-5-hd` credit rows (ee/billing/credits.ts) carry.
 */
export const SEEDANCE_DRAFT_FINALIZE_KIE_CREDITS_PER_SEC = { plain: 158, ref: 95 } as const

/**
 * The USD KIE bills for a draft's finalize: the rate × the seconds the
 * finalize's charge bills (`billedSec`, computed where the finalize is priced).
 * Recorded as the finalize job's provider cost only.
 */
export function seedanceDraftFinalizeCostUsd(billedSec: number, hasRefVideo: boolean): number {
  const rate = hasRefVideo ? SEEDANCE_DRAFT_FINALIZE_KIE_CREDITS_PER_SEC.ref : SEEDANCE_DRAFT_FINALIZE_KIE_CREDITS_PER_SEC.plain
  return rate * billedSec * KIE_CREDIT_USD
}
