/**
 * Video-analysis provider-cost formula — CORE (not ee/): the MCP tool
 * description builder (`lib/mcp/tools/verbs-video.ts`) needs the real
 * bucket-credit numbers regardless of edition, and `ee/billing/credits.ts`
 * needs it to seed the static credit-cost table. The duration buckets,
 * window-batching constants, and credit-id builder stay in `@nodaro/shared`
 * (`video-analysis-pricing.ts`) — this file holds only the measured-rate
 * constants and the $-derived credit formula.
 *
 * Moved out of `packages/shared` (published Apache-2.0 on npm — an
 * irrevocable grant) per the 2026-07-06 public-flip IP audit, S5 (measured
 * [econ-intel comment removed]
 * (`estimateNodeCredits` in workflow-editor/types.ts) no longer calls this
 * formula directly — it looks up the precomputed
 * `VIDEO_ANALYSIS_BUCKET_CREDITS` table in `@nodaro/shared`, which this
 * file's cross-check test guards against drift (mirrors the pattern already
 * used for `VIDEO_CLIP_CREDITS` in `film-pricing.ts`).
 *
 * Single source of truth for the video-analysis node's credit math: the route
 * (charge at generate-time) and the worker (re-check + settle) both derive
 * from these functions. NEVER hand-write bucket credit values — the
 * structural formula below is the only source, cross-checked against
 * [econ-intel comment removed]
 */
import { VIDEO_ANALYSIS_WINDOW, videoAnalysisNumWindows } from "@nodaro/shared"
import { calculateLlmCost } from "./llm-cost.js"

const WINDOW_OVERLAP = VIDEO_ANALYSIS_WINDOW.OVERLAP

/** [econ-intel comment removed]
 *  KIE = 3,151 prompt tokens (was a 5,500 pre-measurement placeholder). */
export const VIDEO_ANALYSIS_SYSTEM_PROMPT_TOKENS = 3_151
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
const SAFETY = 2

/** Structural formula (spec Pricing): never hand-write bucket values. */
export function videoAnalysisBucketCredits(modelId: string, bucketSec: number): number {
  const n = videoAnalysisNumWindows(bucketSec)
  const inputTokens = Math.ceil((bucketSec + (n - 1) * WINDOW_OVERLAP) * TOKENS_PER_SEC) + n * VIDEO_ANALYSIS_SYSTEM_PROMPT_TOKENS
  const outputTokens = n * OUTPUT_TOKENS_PER_WINDOW
  const usd = calculateLlmCost(modelId, { inputTokens, outputTokens })
  return Math.max(1, Math.ceil((usd * SAFETY) / USD_PER_CREDIT))
}
