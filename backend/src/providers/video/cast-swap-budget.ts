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

/** The face-masking mode when it is "always" or "auto", else `undefined`:
 *  from `faceMasking`, or `__faceMasking` when `faceMasking` is absent. */
function faceMaskingMode(data: object): "always" | "auto" | undefined {
  const { faceMasking, __faceMasking } = data as { faceMasking?: unknown; __faceMasking?: unknown }
  const masking = faceMasking !== undefined ? faceMasking : __faceMasking
  if (!masking || typeof masking !== "object") return undefined
  const mode = (masking as { mode?: unknown }).mode
  return mode === "always" || mode === "auto" ? mode : undefined
}

/** The budget of one cast-swap job: the masking bound when face masking is
 *  "always" or "auto"; otherwise the preview bound only when
 *  `data.preview === true`, else the full-clip bound. */
export function castSwapJobBudgetMs(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return CAST_SWAP_FULL_BUDGET_MS
  const mode = faceMaskingMode(data)
  if (mode === "always") return CAST_SWAP_MASK_ALWAYS_BUDGET_MS
  if (mode === "auto") return CAST_SWAP_MASK_AUTO_BUDGET_MS
  return (data as { preview?: unknown }).preview === true ? CAST_SWAP_PREVIEW_BUDGET_MS : CAST_SWAP_FULL_BUDGET_MS
}
