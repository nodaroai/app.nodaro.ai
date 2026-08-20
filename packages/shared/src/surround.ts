/**
 * Surround continuation — the shared WIRE CONTRACT.
 *
 * The Location 360° "look-around" builds each ring view (45°, 90°, …) as an
 * image-to-image continuation of the previous one.
 *
 * This module owns only what the route Zod schema, the SDK input type, and the
 * worker all need to agree on: the direction enum and the carried-fraction
 * defaults. The fill prompt lives in `@nodaro/prompts` (never published) and
 * the compositing/harmonization engine is private.
 */

/**
 * The camera move a continuation represents: `right` / `left` pan the view
 * horizontally, `up` / `down` tilt it vertically.
 */
export const SURROUND_DIRECTIONS = ["right", "left", "up", "down"] as const
export type SurroundDirection = (typeof SURROUND_DIRECTIONS)[number]

/** Default carried fraction for a horizontal pan. */
export const DEFAULT_CARRIED_FRACTION = 0.5
/** Default carried fraction for a vertical tilt. */
export const TILT_CARRIED_FRACTION = 0.12

/** True for the vertical tilt directions (up/down), false for the pans. */
export function isTiltDirection(direction: SurroundDirection): boolean {
  return direction === "up" || direction === "down"
}

/** The carried fraction the platform uses when the caller doesn't pin one. */
export function defaultCarriedFraction(direction: SurroundDirection): number {
  return isTiltDirection(direction) ? TILT_CARRIED_FRACTION : DEFAULT_CARRIED_FRACTION
}
