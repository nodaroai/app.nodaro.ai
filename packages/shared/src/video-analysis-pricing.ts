/**
 * Video-analysis pricing — shared duration-bucket credit model.
 *
 * Single source of truth for the video-analysis node's credit math: the route
 * (charge at generate-time), the worker (re-check + settle), the admin surface,
 * and the docs table all derive from these functions. NEVER hand-write bucket
 * credit values — the structural formula below is the only source, cross-checked
 * [econ-intel comment removed]
 */
import { calculateLlmCost } from "./llm-models.js"

export const VIDEO_ANALYSIS_DURATION_BUCKETS = [60, 180, 360, 600] as const
/** Worker re-check grace: route metadata is integer-rounded, provider durations nominal;
 *  ffprobe floats run 0.05–2 s over. Zero tolerance fails legit videos at 1:00/3:00/6:00/10:00. */
export const VIDEO_ANALYSIS_DURATION_TOLERANCE_SEC = 3
/** [econ-intel comment removed]
 *  KIE = 3,151 prompt tokens (was a 5,500 pre-measurement placeholder). */
export const VIDEO_ANALYSIS_SYSTEM_PROMPT_TOKENS = 3_151
export const VIDEO_ANALYSIS_MAX_DURATION_SEC = 600
const WINDOW_LEN = 150, WINDOW_STRIDE = 145, WINDOW_OVERLAP = 5
export const VIDEO_ANALYSIS_WINDOW = { LEN: WINDOW_LEN, STRIDE: WINDOW_STRIDE, OVERLAP: WINDOW_OVERLAP, SINGLE_MAX: 180 } as const
const SAFETY = 2
/** [econ-intel comment removed]
 *  [econ-intel comment removed]
 *  live KIE bill matched those usage tokens at the standard text rate — no video
 *  premium. If KIE ever flips to default-res sampling (258 tok/frame → ~290 tok/s),
 *  the credit-audit skill will surface the margin squeeze; re-measure and bump. */
const TOKENS_PER_SEC = 91
/** Pricing assumption ABOVE the measured real-workload mean (~2.4k tok/window on the
 *  46-min benchmark; worst single window ~8k) — the headroom is deliberate. */
const OUTPUT_TOKENS_PER_WINDOW = 4_000
const USD_PER_CREDIT = 0.02

export function pickVideoAnalysisBucket(durationSec: number): number {
  for (const b of VIDEO_ANALYSIS_DURATION_BUCKETS) if (durationSec <= b) return b
  return VIDEO_ANALYSIS_MAX_DURATION_SEC
}

export function buildVideoAnalysisCreditId(model: string, durationSec?: number): string {
  const bucket = durationSec !== undefined && durationSec > 0
    ? pickVideoAnalysisBucket(Math.min(durationSec, VIDEO_ANALYSIS_MAX_DURATION_SEC))
    : VIDEO_ANALYSIS_MAX_DURATION_SEC // unknown → ceiling composite (the ONLY silent-ceiling path)
  return `video-analysis:${model}:${bucket}s`
}

export function bucketSecondsFromCreditId(creditId: string): number | null {
  const m = /^video-analysis:.+:(\d+)s$/.exec(creditId)
  return m ? Number(m[1]) : null
}

export function videoAnalysisNumWindows(bucketSec: number): number {
  return bucketSec <= VIDEO_ANALYSIS_WINDOW.SINGLE_MAX ? 1 : 1 + Math.ceil((bucketSec - WINDOW_LEN) / WINDOW_STRIDE)
}

/** Structural formula (spec Pricing): never hand-write bucket values. */
export function videoAnalysisBucketCredits(modelId: string, bucketSec: number): number {
  const n = videoAnalysisNumWindows(bucketSec)
  const inputTokens = Math.ceil((bucketSec + (n - 1) * WINDOW_OVERLAP) * TOKENS_PER_SEC) + n * VIDEO_ANALYSIS_SYSTEM_PROMPT_TOKENS
  const outputTokens = n * OUTPUT_TOKENS_PER_WINDOW
  const usd = calculateLlmCost(modelId, { inputTokens, outputTokens })
  return Math.max(1, Math.ceil((usd * SAFETY) / USD_PER_CREDIT))
}
