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
}): Promise<GenerateVideoProPricing> {
  const { provider, durationSec } = args
  const tailSec = clampContextTailSec(args.tailSec)
  const resolution = clampResolution(provider, args.resolution)

  const cap = Number(process.env.GENERATE_VIDEO_PRO_MAX_DURATION || 120)
  const split = computeSplit(durationSec, cap)

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

  // First segment billed at the no-ref rate (fresh generation, capped at
  // maxSeg); every subsequent segment + its tail overlap billed at the
  // video-ref rate (re-seeds off the previous segment's tail frames).
  const reserveBase =
    feeBase +
    Math.ceil(noRefPerSec * SPLIT.maxSeg) +
    Math.ceil(refPerSec * ((split.n - 1) * tailSec + (split.s - SPLIT.maxSeg)))

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
