import { MODEL_CATALOG } from "@nodaro/shared"
import { STATIC_CREDIT_COSTS, PriceNotConfiguredError } from "./credits.js"
import { probeVideoSource } from "../../providers/video/ffmpeg-utils.js"

/**
 * Money-authoritative reserve formula for the `edit-video-pro` node (spec §7,
 * rev4). Reserve PROBES the source server-side (platform precedent:
 * `seedance2RefVideoBaseCreditsFromUrls`) — on success the resolution tier,
 * the tail edge, and both MIN_REF floors are all knowable, so reserve ==
 * commit exactly; on failure it worst-cases (TOP catalog tier, tail + refIn
 * assumed) and the engine's commit refunds the difference. The engine commits
 * from the payload-embedded copy of this object (rates re-used verbatim).
 */
export interface EditVideoProPricing {
  mode: "replace"
  spanStartSec: number
  spanEndSec: number
  clampedSpanSec: number
  maxSpanSec: number
  segmentCount: number
  segmentDurations: number[]
  totalRawSec: number
  refsSecReserve: number
  outerSeamLossReserve: number
  feeBase: number
  refPerSecByResolution: Record<string, number>
  reserveResolution: string
  reserveBase: number
  probe: { width: number; height: number; durationSec: number } | null
  spanExceedsSource: boolean
}

// Module-local transcription of the shared split closed-form (same twin the
// gvp helper carries — ee/ cannot import plugin code). Keep IN SYNC.
const SPLIT = { minSeg: 4, maxSeg: 15, lossSec: 0.3 } as const
interface SplitResult { mode: "single" | "multi"; clampedD: number; n: number; s: number; durations: number[] }
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
    if (durations[i] > SPLIT.maxSeg) { durations[i + 1] += durations[i] - SPLIT.maxSeg; durations[i] = SPLIT.maxSeg }
  }
  return { mode: "multi" as const, clampedD: d, n, s, durations }
}

const MIN_REF = 1
const OUTER_SEAM_LOSS_PER_EDGE = 0.3
const SPAN_TOLERANCE_SEC = 0.05
const TIER_HEIGHT: Record<string, number> = { "480p": 480, "720p": 720, "1080p": 1080, "4k": 2160 }
const heightOf = (tier: string) => TIER_HEIGHT[tier] ?? 480

function catalogTiers(provider: string): string[] {
  const supported = MODEL_CATALOG[provider]?.resolutions ?? ["480p", "720p", "1080p"]
  return [...supported].sort((a, b) => heightOf(a) - heightOf(b))
}

/** Largest tier whose pixel height ≤ min(W,H); floor at the smallest tier. */
export function deriveBridgeResolution(provider: string, width: number, height: number): string {
  const tiers = catalogTiers(provider)
  const minDim = Math.min(width, height)
  let pick = tiers[0]
  for (const t of tiers) if (heightOf(t) <= minDim) pick = t
  return pick
}

function refRates(provider: string): Record<string, number> {
  const rates: Record<string, number> = {}
  for (const tier of catalogTiers(provider)) {
    const identifier = `${provider}:8s:${tier}-ref`
    const composite = STATIC_CREDIT_COSTS[identifier]
    if (composite === undefined) throw new PriceNotConfiguredError(identifier)
    rates[tier] = composite / 8
  }
  return rates
}

export async function computeEditVideoProPricing(args: {
  provider: string
  sourceUrl?: string
  spanStart: number
  spanEnd: number
}): Promise<EditVideoProPricing> {
  const { provider } = args
  const maxSpanSec = Number(process.env.EDIT_VIDEO_PRO_MAX_SPAN || 120)
  const feeBase = STATIC_CREDIT_COSTS["edit-video-pro"]
  if (feeBase === undefined) throw new PriceNotConfiguredError("edit-video-pro")
  const refPerSecByResolution = refRates(provider)
  const tiers = catalogTiers(provider)

  const spanStartSec = Math.max(0, args.spanStart)
  // Money-side span clamp ([4, maxSpan] window from spanStart) — the DAG
  // override stamps these clamped values back onto the payload; the route's
  // Zod refines reject out-of-range spans before ever reaching here.
  let spanEndSec = Math.max(spanStartSec + SPLIT.minSeg, Math.min(args.spanEnd, spanStartSec + maxSpanSec))

  let probe: EditVideoProPricing["probe"] = null
  if (args.sourceUrl) {
    try {
      const p = await probeVideoSource(args.sourceUrl)
      if (p.width > 0 && p.height > 0 && Number.isFinite(p.durationSeconds) && p.durationSeconds > 0) {
        probe = { width: p.width, height: p.height, durationSec: p.durationSeconds }
      }
    } catch {
      // Worst-case fallback below — a failed probe can only ever OVER-reserve.
    }
  }
  let spanExceedsSource = false
  if (probe) {
    if (spanEndSec > probe.durationSec + SPAN_TOLERANCE_SEC) spanExceedsSource = true
    spanEndSec = Math.min(spanEndSec, probe.durationSec)
  }
  const clampedSpanSec = Math.max(SPLIT.minSeg, spanEndSec - spanStartSec)

  const headExists = spanStartSec > 0
  const tailExists = probe ? probe.durationSec - spanEndSec > SPAN_TOLERANCE_SEC : true
  const outerSeamLossReserve = OUTER_SEAM_LOSS_PER_EDGE * ((headExists ? 1 : 0) + (tailExists ? 1 : 0))
  const split = computeSplit(clampedSpanSec + outerSeamLossReserve, maxSpanSec)
  const refOut = spanStartSec >= MIN_REF ? 1 : 0
  const refIn = probe ? (tailExists && probe.durationSec - spanEndSec >= MIN_REF ? 1 : 0) : 1
  const refsSecReserve = refOut + (split.n - 1) + refIn
  const reserveResolution = probe
    ? deriveBridgeResolution(provider, probe.width, probe.height)
    : tiers[tiers.length - 1] // probe failed → TOP tier (over-reserve only)
  const reserveBase = feeBase + Math.ceil(refPerSecByResolution[reserveResolution]! * (split.s + refsSecReserve))

  return {
    mode: "replace", spanStartSec, spanEndSec, clampedSpanSec, maxSpanSec,
    segmentCount: split.n, segmentDurations: split.durations, totalRawSec: split.s,
    refsSecReserve, outerSeamLossReserve, feeBase, refPerSecByResolution,
    reserveResolution, reserveBase, probe, spanExceedsSource,
  }
}
