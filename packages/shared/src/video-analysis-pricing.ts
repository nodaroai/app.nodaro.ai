/**
 * Video-analysis pricing — shared duration-bucket credit model.
 *
 * Single source of truth for the video-analysis node's NON-monetary credit
 * math: duration bucketing, the window-batching constants (also consumed by
 * the backend workers for real chunking, not just pricing), and the
 * composite credit-id builder. The route (charge at generate-time), the
 * worker (re-check + settle), and the frontend node UI (via
 * `buildVideoAnalysisCreditId` + `/v1/credits/model-cost`) all derive from
 * these.
 *
 * The measured-rate constants and the $-derived `videoAnalysisBucketCredits`
 * formula that GENERATE these numbers live PRIVATELY in the
 * `@nodaroai/cloud-plugins` package (`src/plugins/video-analysis/cost.ts`) —
 * never in this public repo. They were first moved out of this package
 * (published Apache-2.0 on npm) per the 2026-07-06 public-flip IP audit S5,
 * then out of the app repo entirely alongside the rest of the video-analysis
 * node. A cross-check test in that private package guards this table so the
 * public numbers can't silently drift from the formula.
 *
 * `VIDEO_ANALYSIS_BUCKET_CREDITS` below is the precomputed OUTPUT of that
 * private formula for every (model × bucket) combination — a plain credit
 * lookup table, not a formula, mirroring the same wire-contract pattern
 * `VIDEO_CLIP_CREDITS` uses in `film-pricing.ts`. It is what the frontend's
 * client-side cost preview (`estimateNodeCredits` in
 * workflow-editor/types.ts) reads instead of calling the formula directly.
 * A backend test (`video-analysis-cost.test.ts`) cross-checks this table
 * against the live formula so it can't silently drift.
 */

export const VIDEO_ANALYSIS_DURATION_BUCKETS = [60, 180, 360, 600] as const
/** Worker re-check grace: route metadata is integer-rounded, provider durations nominal;
 *  ffprobe floats run 0.05–2 s over. Zero tolerance fails legit videos at 1:00/3:00/6:00/10:00. */
export const VIDEO_ANALYSIS_DURATION_TOLERANCE_SEC = 3
export const VIDEO_ANALYSIS_MAX_DURATION_SEC = 600
const WINDOW_LEN = 150, WINDOW_STRIDE = 145, WINDOW_OVERLAP = 5
export const VIDEO_ANALYSIS_WINDOW = { LEN: WINDOW_LEN, STRIDE: WINDOW_STRIDE, OVERLAP: WINDOW_OVERLAP, SINGLE_MAX: 180 } as const

/**
 * Precomputed credit cost per (model, bucket) — the OUTPUT of the private
 * `videoAnalysisBucketCredits` formula (in `@nodaroai/cloud-plugins`), not a
 * formula itself. Regenerate by running that function for every
 * `VIDEO_ANALYSIS_LLM_MODELS` × duration bucket combination whenever the
 * underlying rate/token constants change (the plugin's cost test guards drift).
 * Keep in sync with
 * `docs/nodes/processing-video/video-analysis.md`.
 */
export const VIDEO_ANALYSIS_BUCKET_CREDITS: Record<string, number> = {
  "video-analysis:gemini-3-flash:60s": 1,
  "video-analysis:gemini-3-flash:180s": 1,
  "video-analysis:gemini-3-flash:360s": 2,
  "video-analysis:gemini-3-flash:600s": 3,
  "video-analysis:gemini-3.1-pro:60s": 2,
  "video-analysis:gemini-3.1-pro:180s": 3,
  "video-analysis:gemini-3.1-pro:360s": 7,
  "video-analysis:gemini-3.1-pro:600s": 11,
}

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
