/**
 * LTX 2.3 Pro Extend pricing — a per-second price row times the seconds added.
 *
 * `ltxExtendDurationSec` is the one reading of the requested length, and the
 * value it returns is the one SENT to the model: the route, the workflow run
 * and the worker all pass it on, so the seconds priced are the seconds
 * rendered. An absent length is the model's own default (6 seconds).
 *
 * The per-second amount lives in the `model_pricing` row, never here. Worked
 * examples at the row's listed price of 40 (repeated in
 * docs/nodes/ai-video/extend-video.md):
 *   2 s → 80,  6 s (or no length) → 240,  20 s → 800.
 */

export const LTX_EXTEND_PER_SECOND_CREDIT_ID = "ltx-2.3-pro-extend:per-second"

export const LTX_EXTEND_DURATION = {
  MIN_SEC: 1,
  MAX_SEC: 20,
  DEFAULT_SEC: 6,
} as const

/**
 * The seconds an LTX extend adds: a whole number from 1 to 20, the default
 * when none (or nothing readable) was given. Accepts a numeric string, which a
 * workflow field mapping can deliver.
 */
export function ltxExtendDurationSec(raw: unknown): number {
  const n =
    typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN
  if (!Number.isFinite(n)) return LTX_EXTEND_DURATION.DEFAULT_SEC
  return Math.min(LTX_EXTEND_DURATION.MAX_SEC, Math.max(LTX_EXTEND_DURATION.MIN_SEC, Math.round(n)))
}
