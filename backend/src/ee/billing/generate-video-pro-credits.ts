import { MODEL_CATALOG, buildVideoCreditModelIdentifier, SEEDANCE_2_CONTINUATION_REF_SEC } from "@nodaro/shared"
import { STATIC_CREDIT_COSTS, PriceNotConfiguredError, getModelCreditBaseCost } from "./credits.js"

/**
 * Money-authoritative closed-form for the `generate-video-pro` node.
 *
 * The pro node stitches multiple KIE Seedance-2-family segments into one
 * long clip when the requested duration exceeds a single segment's max
 * (15s). Below that threshold it behaves exactly like a normal single-shot
 * t2v run (mode "single"); above it, it splits into N segments (mode
 * "multi") and reserves a fee-base PLUS the per-second cost of the segments
 * (the first segment billed at the no-video-ref rate, every subsequent
 * segment billed at the video-ref rate since it re-seeds off the previous
 * segment's tail frames).
 */
export interface GenerateVideoProPricing {
  mode: "single" | "multi"
  clampedDurationSec: number
  segmentCount: number
  totalRawSec: number
  segmentDurations: number[]
  feeBase: number // 0 when single
  noRefPerSec: number
  refPerSec: number
  tailSec: number
  reserveBase: number // pre-markup
  creditIdentifier?: string // single mode only
  /** CONTINUATION billing floor (2026-07-21): 1-based segment the CHILD job
   *  starts paying from — segments below it were delivered and billed by the
   *  parent. Set only by `computeGenerateVideoProContinuationPricing`; the
   *  plugin's `commitBase` twin bills feeBase + segments ≥ this index (all at
   *  the ref rate + one continuation tail each). Absent/1 → classic. */
  billFromSegment?: number
}

// ---------------------------------------------------------------------------
// Segment-split closed-form. Module-local transcription of the Task 2
// function body (verbatim) — plugin/frontend code is not importable from
// ee/, so this copy is the single implementation this file depends on. Keep
// it IN SYNC with the twin if the split algorithm ever changes.
// ---------------------------------------------------------------------------

const SPLIT = { minSeg: 4, maxSeg: 15, lossSec: 0.3 } as const

interface SplitResult {
  mode: "single" | "multi"
  clampedD: number
  n: number
  s: number
  durations: number[]
}

function computeSplit(requestedSec: number, capSec: number): SplitResult {
  const d = Math.min(Math.max(Math.round(requestedSec), SPLIT.minSeg), capSec)
  if (d <= SPLIT.maxSeg) return { mode: "single" as const, clampedD: d, n: 1, s: d, durations: [d] }
  let n = 2
  while (n * SPLIT.maxSeg < d + SPLIT.lossSec * (n - 1)) n++
  const s = Math.ceil(d + SPLIT.lossSec * (n - 1))
  const base = Math.floor(s / n)
  const durations = new Array<number>(n).fill(base)
  durations[0] += s - base * n
  for (let i = 0; i < n - 1; i++) {
    if (durations[i] > SPLIT.maxSeg) {
      durations[i + 1] += durations[i] - SPLIT.maxSeg
      durations[i] = SPLIT.maxSeg
    }
  }
  return { mode: "multi" as const, clampedD: d, n, s, durations }
}

/**
 * PREFERRED-POINT SPLIT (user lever, 2026-07-21) — TWIN of the plugin's
 * `computePreferredSplit` (engine/split.ts); keep in lock-step. Even
 * segments near a RECOMMENDED length instead of pack-to-cap: n ≈
 * round(total/preferred), adjusted until the even base sits inside
 * [minSeg, maxSeg]; durations are base/base+1 with the remainder on the
 * EARLIEST segments. Can turn a ≤15s request into a MULTI split — that is
 * the point of the lever (more, shorter generations). The classic
 * `computeSplit` above stays byte-identical for lever-less runs.
 */
function computePreferredSplit(requestedSec: number, preferredSec: number, capSec: number): SplitResult {
  const d = Math.min(Math.max(Math.round(requestedSec), SPLIT.minSeg), capSec)
  const pref = Math.min(Math.max(Math.round(preferredSec), SPLIT.minSeg), SPLIT.maxSeg)
  let n = Math.max(1, Math.round(d / pref))
  const sOf = (k: number): number => Math.ceil(d + SPLIT.lossSec * (k - 1))
  while (n > 1 && Math.floor(sOf(n) / n) < SPLIT.minSeg) n--
  while (Math.ceil(sOf(n) / n) > SPLIT.maxSeg) n++
  if (n === 1) return { mode: "single" as const, clampedD: d, n: 1, s: d, durations: [d] }
  const s = sOf(n)
  const base = Math.floor(s / n)
  const r = s - base * n
  const durations = new Array<number>(n).fill(base)
  for (let i = 0; i < r; i++) durations[i] += 1
  return { mode: "multi" as const, clampedD: d, n, s, durations }
}

/** User-selectable context-tail bounds (seconds). Floor = the default 2s
 *  (clears KIE's 1.8s r2v minimum); ceiling 5s keeps the reference short
 *  enough to stay a continuation cue rather than replay material, and keeps
 *  the per-join surcharge bounded. The engine cuts EXACTLY what this bills —
 *  transport and formula read the same clamped value. */
export const CONTEXT_TAIL_MIN_SEC = SEEDANCE_2_CONTINUATION_REF_SEC
export const CONTEXT_TAIL_MAX_SEC = 5
export function clampContextTailSec(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : CONTEXT_TAIL_MIN_SEC
  return Math.min(CONTEXT_TAIL_MAX_SEC, Math.max(CONTEXT_TAIL_MIN_SEC, n))
}

/**
 * Clamp a requested resolution to the provider's catalog resolutions (single
 * source of truth) — an unsupported tier (e.g. a stale 1080p on
 * seedance-2-mini, which only exposes 480p/720p) snaps to the model's top
 * priced tier so every downstream composite lookup is always seeded.
 * Mirrors `seedance2-ref-video-credits.ts` / `packages/shared/src/credit-identifiers.ts`.
 */
function clampResolution(provider: string, resolution: string): string {
  const supported = MODEL_CATALOG[provider]?.resolutions ?? ["480p", "720p", "1080p"]
  const want = resolution === "4k" ? "4k" : resolution === "1080p" ? "1080p" : resolution === "720p" ? "720p" : "480p"
  return supported.includes(want) ? want : (supported[supported.length - 1] ?? "480p")
}

/**
 * Per-second BASE rate for a (provider, resolution, ref) combination, derived
 * from the seeded 8s composite (the family's per-second rate is linear, so
 * the 8s tier is used as the canonical anchor regardless of the actual
 * segment duration — mirrors `seedance2RefVideoBaseCredits`).
 *
 * Hard-fail policy: throws `PriceNotConfiguredError` when the composite is
 * missing — never silently falls back to a wrong (under-)reservation.
 */
function perSecRate(provider: string, resolution: string, ref: boolean): number {
  const identifier = `${provider}:8s:${resolution}${ref ? "-ref" : ""}`
  const composite = STATIC_CREDIT_COSTS[identifier]
  if (composite === undefined) {
    throw new PriceNotConfiguredError(identifier)
  }
  return composite / 8
}

export async function computeGenerateVideoProPricing(args: {
  provider: string
  resolution: string
  durationSec: number
  /** Continuation-tail length per join (seconds), clamped to
   *  [CONTEXT_TAIL_MIN_SEC, CONTEXT_TAIL_MAX_SEC]; omitted → default 2s. */
  tailSec?: number
  /** Recommended segment length (seconds), clamped to [4,15] — even segments
   *  near this point instead of pack-to-cap. Omitted → the classic split,
   *  byte-identical. Money-authoritative: the plugin plans against THIS
   *  split's segmentDurations. */
  preferredSegmentSec?: number
}): Promise<GenerateVideoProPricing> {
  const { provider, durationSec } = args
  const tailSec = clampContextTailSec(args.tailSec)
  const resolution = clampResolution(provider, args.resolution)

  const cap = Number(process.env.GENERATE_VIDEO_PRO_MAX_DURATION || 120)
  const usePreferred = typeof args.preferredSegmentSec === "number" && Number.isFinite(args.preferredSegmentSec)
  const split = usePreferred
    ? computePreferredSplit(durationSec, args.preferredSegmentSec as number, cap)
    : computeSplit(durationSec, cap)

  // Per-second transparency fields — always derived from STATIC_CREDIT_COSTS
  // directly (never the DB-aware getter: there is no per-duration DB row for
  // a synthetic multi-segment run, only the discrete 8s composite). Computed
  // for BOTH modes: multi mode needs them for the reserve formula; single
  // mode surfaces them for display/transparency (e.g. "priced at N cr/sec").
  const noRefPerSec = perSecRate(provider, resolution, false)
  const refPerSec = perSecRate(provider, resolution, true)

  if (split.mode === "single") {
    // Single-segment run behaves exactly like a normal t2v run — same
    // identifier + BASE cost path every other video node uses, so it stays
    // DB-override-aware (an admin can reprice the underlying composite and
    // the pro node's single-segment cost follows automatically).
    const creditIdentifier = buildVideoCreditModelIdentifier(
      provider,
      split.clampedD,
      false,
      "text-to-video",
      undefined,
      resolution,
      false,
    )
    const { creditCost } = await getModelCreditBaseCost(creditIdentifier)
    return {
      mode: "single",
      clampedDurationSec: split.clampedD,
      segmentCount: split.n,
      totalRawSec: split.s,
      segmentDurations: split.durations,
      feeBase: 0,
      noRefPerSec,
      refPerSec,
      tailSec,
      reserveBase: creditCost,
      creditIdentifier,
    }
  }

  const feeBase = STATIC_CREDIT_COSTS["generate-video-pro"]
  if (feeBase === undefined) {
    throw new PriceNotConfiguredError("generate-video-pro")
  }

  // First segment billed at the no-ref rate; every subsequent segment + its
  // tail overlap billed at the video-ref rate (re-seeds off the previous
  // segment's tail frames). The DEFAULT path bills the first segment at the
  // maxSeg constant (worst-case padding — pinned by the golden tests); the
  // PREFERRED-split path bills durations[0] instead: segments can be far
  // shorter than the cap there, the constant would over-pad AND go negative
  // in the ref term (e.g. 10s @ preferred 4 → s−15 < 0), and the engine's
  // commitBase settles on durations[0] — reserve and commit stay aligned.
  const firstSegBillSec = usePreferred ? split.durations[0]! : SPLIT.maxSeg
  const reserveBase =
    feeBase +
    Math.ceil(noRefPerSec * firstSegBillSec) +
    Math.ceil(refPerSec * ((split.n - 1) * tailSec + (split.s - firstSegBillSec)))

  return {
    mode: "multi",
    clampedDurationSec: split.clampedD,
    segmentCount: split.n,
    totalRawSec: split.s,
    segmentDurations: split.durations,
    feeBase,
    noRefPerSec,
    refPerSec,
    tailSec,
    reserveBase,
  }
}

/**
 * CONTINUE reserve (2026-07-21, gvp stop/continue) — money-authoritative for
 * a child job that resumes a parent run from `fromSegment` (1-based). The
 * parent plan's durations are KNOWN (embedded in its checkpoint's pricing at
 * the original reservation), so the reserve is exact — no worst-case padding:
 *
 *   fromSegment k > 1:  feeBase + ceil(refPerSec × ((N−k+1)·tailSec + Σ d[k..N]))
 *   fromSegment k = 1:  the fresh-run formula over the same fixed durations
 *                       (segment 1 no-ref; every later one ref + tail)
 *
 * Every NEW segment — including the first — bills at the ref rate + one
 * continuation tail: it re-seeds off the previous footage (the parent prefix
 * for segment k). The returned pricing carries `billFromSegment` so the
 * plugin's `commitBase` twin settles only the new segments; reserve == commit
 * when the run completes fully (refund 0), and every partial path refunds
 * the untouched remainder through the same metered commit.
 *
 * TWIN of the plugin engine's continuation-aware `commitBase`
 * (engine/finalize.ts) — keep in lock-step.
 */
export async function computeGenerateVideoProContinuationPricing(args: {
  provider: string
  resolution: string
  /** The PARENT plan's per-segment durations (from its checkpoint's embedded
   *  pricing — money-authoritative; never recomputed from a split). */
  segmentDurations: number[]
  /** 1-based first segment the child regenerates (and pays for). */
  fromSegment: number
  tailSec?: number
}): Promise<GenerateVideoProPricing> {
  const { provider } = args
  const tailSec = clampContextTailSec(args.tailSec)
  const resolution = clampResolution(provider, args.resolution)
  // Wire-path sanitation: the durations arrive from a checkpoint blob — round
  // and bound them to the split's own invariants before money math.
  const durations = args.segmentDurations.map((d) => Math.round(d))
  const n = durations.length
  if (n < 1 || durations.some((d) => !Number.isFinite(d) || d < 1 || d > SPLIT.maxSeg)) {
    throw new Error("continuation pricing: invalid parent segment durations")
  }
  const k = Math.round(args.fromSegment)
  if (!Number.isFinite(k) || k < 1 || k > n) {
    throw new Error(`continuation pricing: fromSegment ${args.fromSegment} outside 1..${n}`)
  }
  const noRefPerSec = perSecRate(provider, resolution, false)
  const refPerSec = perSecRate(provider, resolution, true)
  const feeBase = STATIC_CREDIT_COSTS["generate-video-pro"]
  if (feeBase === undefined) {
    throw new PriceNotConfiguredError("generate-video-pro")
  }
  const total = durations.reduce((a, b) => a + b, 0)
  const reserveBase = k > 1
    ? feeBase + Math.ceil(refPerSec * ((n - k + 1) * tailSec + durations.slice(k - 1).reduce((a, b) => a + b, 0)))
    : feeBase +
      Math.ceil(noRefPerSec * durations[0]!) +
      (n > 1 ? Math.ceil(refPerSec * ((n - 1) * tailSec + (total - durations[0]!))) : 0)
  return {
    mode: "multi",
    clampedDurationSec: total,
    segmentCount: n,
    totalRawSec: total,
    segmentDurations: durations,
    feeBase,
    noRefPerSec,
    refPerSec,
    tailSec,
    reserveBase,
    billFromSegment: k,
  }
}
