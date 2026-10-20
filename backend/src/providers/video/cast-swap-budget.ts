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
 */

const MINUTE_MS = 60_000

/** A full clip. */
export const CAST_SWAP_FULL_BUDGET_MS = 120 * MINUTE_MS

/** A preview run (`preview: true`). */
export const CAST_SWAP_PREVIEW_BUDGET_MS = 30 * MINUTE_MS

/** The budget of one cast-swap job: the preview bound only when
 *  `data.preview === true`, otherwise the full-clip bound. */
export function castSwapJobBudgetMs(data: unknown): number | undefined {
  const preview = !!data && typeof data === "object" && (data as { preview?: unknown }).preview === true
  return preview ? CAST_SWAP_PREVIEW_BUDGET_MS : CAST_SWAP_FULL_BUDGET_MS
}
