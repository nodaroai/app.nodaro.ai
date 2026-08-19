import { resolveSeedance2Inputs } from "@nodaro/prompts"
import { normalizeMinimaxH3Resolution } from "@nodaro/shared"
import { STATIC_CREDIT_COSTS, PriceNotConfiguredError } from "./credits.js"
import { probeMediaDuration } from "../../providers/video/ffmpeg-utils.js"

/**
 * KIE caps a MiniMax Hailuo 3 reference-video run's total input at ≤15s, so a
 * probe we cannot trust (rejected ffprobe, NaN/≤0 duration) is treated as the
 * full 15s worst case for that single URL — we must NEVER under-reserve,
 * because `commit_credits` only refunds a surplus and can never collect an
 * upward delta. Mirrors seedance2-ref-video-credits.ts.
 */
const REF_VIDEO_WORST_CASE_SEC = 15

/** KIE r2v reference-video cap for minimax-h3 (max 3 URLs — the route Zod cap). */
const MAX_REF_VIDEOS = 3

/**
 * KIE bills minimax-h3 input images beyond the FIRST FIVE at 11 KIE cr each
 * (docs.kie.ai/market/minimax-h3 pricing; reference audio is free).
 */
export const MINIMAX_H3_FREE_INPUT_IMAGES = 5

/**
 * BASE credits per chargeable input image: 11 KIE cr × 2.5
 * credits-per-KIE-credit — the same credit conversion the per-second
 * composites use (Nodaro = ceil(KIE / 4) × 10 ≈ KIE × 2.5).
 */
const EXTRA_IMAGE_BASE_CREDITS = 27.5

/**
 * The number of input images a minimax-h3 run will actually send to KIE, for
 * the extra-image surcharge (first 5 free). Derived through the SAME shared
 * input resolver the KIE provider layer uses (`resolveSeedance2Inputs` — H3
 * reuses it verbatim, identical 9/3/3 caps + frames-fold-into-references
 * semantics), so the billed count can never drift from the sent count:
 *   - reference mode (any image/video/audio ref present): the resolved
 *     `reference_image_urls` length — INCLUDING first/last frames the
 *     resolver folds into the pool.
 *   - strict frame modes (i2v endpoint): 0 — at most 2 frame images, always
 *     under the 5-free threshold, so they can never surcharge.
 *
 * Callers must pass the ASSEMBLED reference list (after connectedReferences
 * assembly), i.e. exactly what the handler/worker will forward.
 */
export function minimaxH3BillableRefImageCount(args: {
  referenceImageUrls?: readonly unknown[]
  firstFrameUrl?: unknown
  lastFrameUrl?: unknown
  referenceVideoUrls?: readonly unknown[]
  referenceAudioUrls?: readonly unknown[]
}): number {
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined)
  const strList = (xs?: readonly unknown[]) =>
    (xs ?? []).filter((x): x is string => typeof x === "string" && x.length > 0)
  const resolved = resolveSeedance2Inputs({
    firstFrameUrl: str(args.firstFrameUrl),
    lastFrameUrl: str(args.lastFrameUrl),
    refImageUrls: strList(args.referenceImageUrls),
    refVideoUrls: strList(args.referenceVideoUrls),
    refAudioUrls: strList(args.referenceAudioUrls),
  })
  return resolved.mode === "reference" ? resolved.referenceImageUrls.length : 0
}

/**
 * BASE (0%-markup) credit total for a MiniMax Hailuo 3 run that the seeded
 * duration composites cannot express: reference-video input (KIE bills
 * `unit × (input_video_duration + output_duration)` at the SELECTED
 * resolution's rate) and/or more than 5 input images (11 KIE cr each beyond
 * the first 5 — resolution-independent).
 *
 * The per-second base rate is derived EXACTLY from the seeded 8s composite of
 * the selected resolution tier — `STATIC_CREDIT_COSTS["minimax-h3:8s"] / 8`
 * (= 91.25) for 2K, `STATIC_CREDIT_COSTS["minimax-h3:8s:768p"] / 8` (= 56.25)
 * for 768P — the same derivation seedance2RefVideoBaseCredits uses, so
 * DB/table repricing flows through automatically. `resolution` collapses via
 * normalizeMinimaxH3Resolution (anything not exactly 768P bills at 2K —
 * matching what KIE renders for omitted/unknown values); the r2v rate equals
 * the base rate of the tier.
 *
 * Hard-fail policy: throws `PriceNotConfiguredError` when the anchor
 * composite is missing (matches getModelCreditBaseCost's policy — never
 * silently under-reserve).
 */
export function minimaxH3BaseCredits(args: {
  outputDurationSec: number
  inputVideoDurationSec: number
  referenceImageCount: number
  resolution?: unknown
}): number {
  const res = normalizeMinimaxH3Resolution(typeof args.resolution === "string" ? args.resolution : undefined)
  const anchorId = res === "768P" ? "minimax-h3:8s:768p" : "minimax-h3:8s"
  const composite8s = STATIC_CREDIT_COSTS[anchorId]
  if (composite8s === undefined) {
    throw new PriceNotConfiguredError(anchorId)
  }
  const perSecBase = composite8s / 8
  const extraImages = Math.max(0, args.referenceImageCount - MINIMAX_H3_FREE_INPUT_IMAGES)
  return Math.ceil(
    perSecBase * (args.inputVideoDurationSec + args.outputDurationSec) +
      EXTRA_IMAGE_BASE_CREDITS * extraImages,
  )
}

/**
 * ffprobe the connected reference videos, sum their durations, and return the
 * BASE (0%-markup) credit total for the full `unit × (input + output)` +
 * extra-image MiniMax Hailuo 3 run. SINGLE shared entry point for the route
 * `computeCredits` hooks and the orchestrator reservation — mirrors
 * seedance2RefVideoBaseCreditsFromUrls:
 *
 * - At most 3 URLs are probed (the route's Zod cap), never an unbounded list.
 * - Probes run via `Promise.allSettled`; a rejected probe (or a NaN/≤0
 *   duration) counts as the 15s worst case for that URL so we can only ever
 *   OVER-reserve, never under-reserve (the refund-only `commit_credits`
 *   constraint).
 * - Non-string / empty entries are ignored (they contribute 0s).
 */
export async function minimaxH3BaseCreditsFromUrls(args: {
  outputDurationSec: number
  referenceVideoUrls: readonly unknown[]
  referenceImageCount: number
  resolution?: unknown
}): Promise<number> {
  const candidates = args.referenceVideoUrls
    .slice(0, MAX_REF_VIDEOS)
    .filter((u): u is string => typeof u === "string" && u.length > 0)

  const settled = await Promise.allSettled(candidates.map((u) => probeMediaDuration(u)))
  const inputVideoDurationSec = settled.reduce((sum, r) => {
    if (r.status === "fulfilled" && Number.isFinite(r.value) && r.value > 0) return sum + r.value
    // Rejected probe OR an unusable duration → assume the full 15s worst case.
    return sum + REF_VIDEO_WORST_CASE_SEC
  }, 0)

  return minimaxH3BaseCredits({
    outputDurationSec: args.outputDurationSec,
    inputVideoDurationSec,
    referenceImageCount: args.referenceImageCount,
    resolution: args.resolution,
  })
}
