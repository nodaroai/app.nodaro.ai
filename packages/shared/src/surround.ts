/**
 * Surround continuation — shared single source of truth.
 *
 * The Location 360° "look-around" builds each ring view (45°, 90°, …) as an
 * image-to-image continuation of the previous view. The platform forces
 * geometric continuity by handing the model a half-done frame: one edge holds
 * the previous view's carried pixels, the rest is flat gray, and the model is
 * asked to paint ONLY the gray region as a seamless continuation.
 *
 * This module owns the bits that are pure and reused across the route Zod
 * schema, the SDK input type, and the worker: the direction enum, the default
 * carried fraction, and the hardened fill prompt (with the anti-golden-hour
 * negative that fights the documented Nano-Banana-Pro warm-regrade drift).
 *
 * The geometry math + sharp compositing + color harmonization live backend-side
 * (they need `sharp`); only the model-agnostic constants + prompt live here.
 */

/**
 * The carry/paint axis for a continuation.
 *
 * - `right` — turning right: the new frame's LEFT edge continues the previous
 *   view's RIGHT edge, so the carried band sits on the LEFT and the painted
 *   (newly revealed) content fills the RIGHT. Vertical seam at the center.
 * - `up` — tilting up: the new frame's BOTTOM continues the previous view's
 *   TOP, so the carried band sits on the BOTTOM and the painted content fills
 *   the TOP. Horizontal seam.
 * - `down` — tilting down: the new frame's TOP continues the previous view's
 *   BOTTOM, so the carried band sits on the TOP and the painted content fills
 *   the BOTTOM. Horizontal seam.
 */
export const SURROUND_DIRECTIONS = ["right", "up", "down"] as const
export type SurroundDirection = (typeof SURROUND_DIRECTIONS)[number]

/** Half the frame is carried by default — matches studio's surround composite. */
export const DEFAULT_CARRIED_FRACTION = 0.5

/** Which edge of the NEW frame holds the carried pixels vs the painted region. */
const EDGE: Record<SurroundDirection, { carried: string; painted: string }> = {
  right: { carried: "left", painted: "right" },
  up: { carried: "bottom", painted: "top" },
  down: { carried: "top", painted: "bottom" },
}

/**
 * Build the fill prompt the model receives alongside the half-carry composite.
 *
 * The `userPrompt` (an optional scene hint from the caller — e.g. "a coastal
 * cliff at the edge of a fishing village") is woven in front of the geometric
 * instruction. The trailing block is the hardened anti-drift negative: the
 * documented failure mode is the model repainting the gray region in a warmer /
 * golden-hour grade, producing a hard tonal seam down the frame's center. The
 * runtime color-harmonization step is the real fix (model-agnostic), but this
 * prompt makes the model's first attempt closer to correct.
 */
export function buildSurroundFillPrompt(direction: SurroundDirection, userPrompt?: string): string {
  const { carried, painted } = EDGE[direction]
  const scene = userPrompt && userPrompt.trim() ? `${userPrompt.trim()}. ` : ""
  return (
    `${scene}` +
    `This is a partial frame: the ${carried} portion contains real, finished pixels and the ${painted} portion is flat gray that MUST be painted in. ` +
    `Paint ONLY the ${painted} gray region as a natural, seamless continuation of the ${carried} portion — same scene, same perspective, continuing the horizon, geometry, and content across the boundary with no break. ` +
    `Keep the ${carried} portion completely unchanged. ` +
    `CRITICAL: do NOT change the lighting, exposure, white balance, or time of day. Match the ${carried} portion's EXACT light, color temperature, and contrast across the whole frame — if it is flat overcast daylight, keep flat overcast daylight. No golden hour, no sunset, no warm relight, no cinematic regrade. ` +
    `The seam between the ${carried} and ${painted} portions must be invisible. No people, no text, no labels, no watermarks.`
  )
}
