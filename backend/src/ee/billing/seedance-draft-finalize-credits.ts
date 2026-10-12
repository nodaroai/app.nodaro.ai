import {
  SEEDANCE_DRAFT_FINALIZE_MAX_SEC,
  SEEDANCE_DRAFT_FINALIZE_MIN_SEC,
  SEEDANCE_DRAFT_MODELS,
  VIDEO_REF_VIDEO_DURATION_LIMITS,
  seedanceDraftFinalizeCreditId,
} from "@nodaro/shared"
import { getAppSettings } from "../../lib/app-settings.js"
import { seedanceDraftFinalizeBaseCredits, type SeedanceDraftFinalizePlan } from "../../lib/seedance-draft-finalize.js"
import { getModelCreditCostFromDB } from "./credits.js"
import { applyServiceMarkup } from "./service-margin.js"

/** What prices a finalize: the resolver's plan, or a hypothetical draft. */
export type SeedanceDraftFinalizePricedPlan = Pick<
  SeedanceDraftFinalizePlan,
  "creditId" | "hasRefVideo" | "outputSec" | "refVideoDurationsSec"
>

/**
 * The credits a Seedance 2.5 draft finalize RESERVES — the user-facing price,
 * marked up — for a plan `resolveSeedanceDraftFinalize` returned.
 *
 * It is the reservation's own two lanes, step for step, so an estimate can
 * never quote a different number than the run then holds:
 *  - a draft with a reference video: `/v1/video-upscale`'s `refDraftGuard` and
 *    the workflow run (node-executor) both mark up
 *    `seedanceDraftFinalizeBaseCredits(plan)` ONCE at `plan.creditId` — the
 *    credit guard's `computeCredits` rule;
 *  - any other draft: `reserveCredits` reads `getModelCreditCostFromDB(creditId)`
 *    — the `model_pricing` row (admin-editable) over STATIC, marked up once.
 *
 * Guarded against the real guard + reservation by
 * `ee/routes/__tests__/seedance-hd-estimate-parity.test.ts`.
 */
export async function seedanceDraftFinalizeChargedCredits(plan: SeedanceDraftFinalizePricedPlan): Promise<number> {
  const refBase = await seedanceDraftFinalizeBaseCredits(plan)
  if (refBase !== undefined) return applyServiceMarkup(refBase, await getAppSettings(), plan.creditId)
  return (await getModelCreditCostFromDB(plan.creditId)).creditCost
}

/**
 * The shortest reference clip a draft can carry, in seconds: the draft model's
 * declared per-clip minimum, which every lane that starts a reference-video
 * run enforces before reserving (`probeAndCheckRefVideoDurations` — the
 * generate-video / text-to-video routes and the workflow run). With no
 * declared bound, a clip as short as the finalize's whole-second rounding
 * allows (1 s) — the lowest it can bill.
 */
function shortestReferenceClipSec(): number {
  return VIDEO_REF_VIDEO_DURATION_LIMITS[SEEDANCE_DRAFT_MODELS[0]]?.minSec ?? 1
}

/**
 * Every shape of draft the floor has to consider: each billable length, with
 * no reference video and with the shortest reference clip. A longer clip or a
 * second one only adds input seconds, so it never prices lower.
 */
function floorCandidates(): SeedanceDraftFinalizePricedPlan[] {
  const refSec = shortestReferenceClipSec()
  const plans: SeedanceDraftFinalizePricedPlan[] = []
  for (let n = SEEDANCE_DRAFT_FINALIZE_MIN_SEC; n <= SEEDANCE_DRAFT_FINALIZE_MAX_SEC; n++) {
    plans.push({ creditId: seedanceDraftFinalizeCreditId(n, false), hasRefVideo: false, outputSec: n, refVideoDurationsSec: [] })
    plans.push({ creditId: seedanceDraftFinalizeCreditId(n, true), hasRefVideo: true, outputSec: n, refVideoDurationsSec: [refSec] })
  }
  return plans
}

/**
 * The lowest price ANY draft can finalize for — what "from N" quotes before a
 * draft is wired. Every candidate is priced by
 * {@link seedanceDraftFinalizeChargedCredits}, so the floor follows an admin
 * edit of a `model_pricing` row and the markup exactly as a run would; every
 * length is priced (not just the shortest) so a row edited out of order still
 * cannot leave a cheaper draft below the floor.
 */
export async function seedanceDraftFinalizeMinimumCredits(): Promise<number> {
  const prices = await Promise.all(floorCandidates().map(seedanceDraftFinalizeChargedCredits))
  return Math.min(...prices)
}
