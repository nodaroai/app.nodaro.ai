/**
 * LTX 2.3 Pro Retake pricing — a per-second price row times the seconds of
 * the replaced window.
 *
 * `ltxRetakeDurationSec` is the one reading of the window's length, and the
 * value it returns is the one SENT to the model: the route, the workflow run
 * and the worker all pass it on. The window is at least 2 seconds (the
 * route's own floor) and may be fractional — the editor's range picker sets
 * it to the frame.
 *
 * The per-second amount lives in the `model_pricing` row, never here; a run
 * is the row × these seconds, rounded up to a whole credit.
 */

export const LTX_RETAKE_PER_SECOND_CREDIT_ID = "ltx-2.3-pro-retake:per-second"

/** The shortest window a retake replaces, in seconds. */
export const LTX_RETAKE_MIN_DURATION_SEC = 2

/**
 * The seconds a retake replaces: the requested window, never below 2; 2 when
 * none (or nothing readable) was given. Accepts a numeric string, which a
 * workflow field mapping can deliver.
 */
export function ltxRetakeDurationSec(raw: unknown): number {
  const n =
    typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN
  if (!Number.isFinite(n) || n <= 0) return LTX_RETAKE_MIN_DURATION_SEC
  return Math.max(LTX_RETAKE_MIN_DURATION_SEC, n)
}
