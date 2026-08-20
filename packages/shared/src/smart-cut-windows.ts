/**
 * Smart-cut SEARCH WINDOWS — the shared bound + clamp for
 * generate-video-pro's `smartCutFramesPrev` / `smartCutFramesNext`.
 *
 * They bound how much of each side of a boundary the engine considers when
 * it places the cut: N frames from the end of a segment and M from the start
 * of the next. Absent → the engine's own default, byte-identical to the
 * behavior before they were exposed. A boundary the engine cannot resolve
 * inside the window falls back to the fixed freeze-trims; recast pins 24/24.
 *
 * Why a shared clamp: the canvas node (single-node Run) and the orchestrator
 * (workflow Run) are two independent send paths into the same engine route,
 * whose Zod schema rejects out-of-range values. Deriving both from this one
 * function means a stale or hand-edited node value degrades to a legal
 * request instead of 400-ing an entire multi-segment run at finalize time —
 * and the two paths cannot drift apart.
 */

/** Widest window the UI offers (the engine route itself accepts up to 48).
 *  Past this, added frames only cost search time and invite a false match. */
export const SMART_CUT_WINDOW_MAX = 24
/** Narrowest meaningful window — one frame each side. */
export const SMART_CUT_WINDOW_MIN = 1
/** The engine's default when the field is absent. Documented here so the UI
 *  can show it as the placeholder without hardcoding a second copy. */
export const SMART_CUT_WINDOW_DEFAULT = 8

/**
 * Narrow an arbitrary node value to a legal window, or `undefined` to mean
 * "let the engine use its default". Non-numbers, NaN, and non-integers all
 * collapse to `undefined` rather than to a guessed number: a malformed value
 * should fall back to the proven default, not silently pick a different
 * search width than the user asked for.
 */
export function clampSmartCutWindow(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  const n = Math.round(value)
  if (n < SMART_CUT_WINDOW_MIN) return SMART_CUT_WINDOW_MIN
  if (n > SMART_CUT_WINDOW_MAX) return SMART_CUT_WINDOW_MAX
  return n
}
