/**
 * Cast Swap's job budget — a PURE leaf (imports nothing), like
 * `silence-detect-budget.ts`.
 *
 * Its handler is a PRIVATE PLUGIN handler, which cannot carry
 * `livenessBudgetMs` (core-only), so the video worker's dispatch falls back to
 * `declaredJobBudgetMs("cast-swap", job.data)` (`lib/job-budget.ts`) for the
 * pre-task heartbeat. A full clip runs a provider video edit that can approach
 * the 90-minute default on its own, so it declares a fixed, larger bound; a
 * preview (`preview: true`, a few seconds of the clip) declares a short one.
 *
 * The payload does not carry the clip's length, so both bounds are fixed per
 * run shape. A payload that is not an object, or whose `preview` is anything
 * but `true`, reads as a full run — the larger bound is the safe side.
 *
 * Face masking (`faceMasking.mode`, absent = "off") adds child jobs: "always"
 * masks the clip first (mask, optional depth, composite), "auto" may also run a
 * second provider edit after a refusal. A masked run — preview or not — takes
 * the masking bound, which matches the plugin's extended heartbeat. A
 * `faceMasking` or `mode` that is not one of the known values reads as "off".
 * The mode is read from `faceMasking` (the queue payload) or, when that key is
 * absent, `__faceMasking` (a trend run's saved `input_data`, which the row
 * readers — `lib/execution-budget.ts`, `cancel-inflight-jobs.ts` — pass in).
 *
 * A run that may be a depth reference — a direct Motion run (`style:
 * "motion"`) or a trend run whose clip is prepared as full depth
 * (`faceMasking.source: "full-depth"`, read like the mode) — takes the "auto"
 * bound: the SAFE UPPER BOUND, not always the plugin's own. Which one the
 * plugin uses is decided from settings this row does not carry: a direct
 * Motion run left on its Precise masking is no depth reference at all; a
 * depth reference with one video (a description or no scene) keeps itself
 * live for the "always" bound; only one that sends the original as a second
 * video (which may retry once after a refusal: mask, then edit again) for the
 * "auto" one (the plugin's handler.ts, `maskedHeartbeatMaxMs(twoVideos ?
 * "auto" : "always")`). Any other `style` reads as Precise, and any other
 * `source` as its mode: unchanged.
 *
 * The masked bounds must match the cast-swap plugin's `maskedHeartbeatMaxMs`
 * (handler.ts: 90 + 60 min for "always", + 90 more for "auto").
 */

const MINUTE_MS = 60_000

/** A full clip. */
export const CAST_SWAP_FULL_BUDGET_MS = 120 * MINUTE_MS

/** A preview run (`preview: true`). */
export const CAST_SWAP_PREVIEW_BUDGET_MS = 30 * MINUTE_MS

/** A run with face masking "always": the edit plus the mask jobs. */
export const CAST_SWAP_MASK_ALWAYS_BUDGET_MS = 150 * MINUTE_MS

/** A run with face masking "auto": the mask jobs and a possible second edit. */
export const CAST_SWAP_MASK_AUTO_BUDGET_MS = 240 * MINUTE_MS

/** The face masking setting: `faceMasking`, or `__faceMasking` when `faceMasking` is absent; null when not an object. */
function faceMaskingOf(data: object): Record<string, unknown> | null {
  const { faceMasking, __faceMasking } = data as { faceMasking?: unknown; __faceMasking?: unknown }
  const masking = faceMasking !== undefined ? faceMasking : __faceMasking
  return masking && typeof masking === "object" ? (masking as Record<string, unknown>) : null
}

/** The face-masking mode when it is "always" or "auto", else `undefined`. */
function faceMaskingMode(data: object): "always" | "auto" | undefined {
  const mode = faceMaskingOf(data)?.mode
  return mode === "always" || mode === "auto" ? mode : undefined
}

/** A run that may be a depth reference: a direct Motion run, or a trend run whose clip is full depth (the "auto" bound covers either). */
function depthReference(data: object): boolean {
  return (data as { style?: unknown }).style === "motion" || faceMaskingOf(data)?.source === "full-depth"
}

/** The budget of one cast-swap job: the "auto" bound when face masking is
 *  "auto" or the run is a depth reference, then "always"; otherwise the
 *  preview bound only when `data.preview === true`, else the full-clip bound. */
export function castSwapJobBudgetMs(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return CAST_SWAP_FULL_BUDGET_MS
  const mode = faceMaskingMode(data)
  if (mode === "auto" || depthReference(data)) return CAST_SWAP_MASK_AUTO_BUDGET_MS
  if (mode === "always") return CAST_SWAP_MASK_ALWAYS_BUDGET_MS
  return (data as { preview?: unknown }).preview === true ? CAST_SWAP_PREVIEW_BUDGET_MS : CAST_SWAP_FULL_BUDGET_MS
}
