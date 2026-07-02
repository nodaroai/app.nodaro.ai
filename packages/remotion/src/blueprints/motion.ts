/**
 * Shared blueprint motion helpers — the small set of timing/layout formulas
 * that more than one blueprint component uses. Mirrors the precedent of
 * `./color.ts` (readableTextColor) and `./types.ts` (BlueprintProps): shared
 * blueprint concerns live in small colocated modules.
 *
 * All helpers are pure — safe to unit-test without a render.
 */

/** Quadratic ease-out: fast start, smooth deceleration, no bounce. */
export function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

/** Quadratic ease-in: slow start, accelerating — the mirror of easeOutQuad. */
export function easeInQuad(t: number): number {
  return t * t
}

/**
 * Angle (radians) for item `index` of `count` evenly spaced on a circle,
 * starting at 12 o'clock and proceeding clockwise.
 */
export function ringAngle(index: number, count: number): number {
  return -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(1, count)
}

/** The spring-pop overshoot curve peaks at this scale before settling to 1. */
export const POP_OVERSHOOT = 1.12

/**
 * Spring-pop entrance curve over normalized progress `e` (0→1): eases out to
 * a gentle POP_OVERSHOOT by 70% of the window, then settles linearly back to
 * a resting scale of 1. Clamped — returns 0 before the window and 1 after.
 */
export function popWithSettle(e: number): number {
  if (e <= 0) return 0
  if (e >= 1) return 1
  if (e < 0.7) {
    return easeOutQuad(e / 0.7) * POP_OVERSHOOT
  }
  return POP_OVERSHOOT - (POP_OVERSHOOT - 1) * ((e - 0.7) / 0.3)
}
