/**
 * Surround continuation — shared single source of truth.
 *
 * The Location 360° "look-around" builds each ring view (45°, 90°, …) as an
 * image-to-image continuation of the previous view. The platform forces
 * geometric continuity by handing the model a half-done frame: one edge holds
 * the previous view's carried pixels, the rest is flat gray, and the model is
 * asked to paint the gray region.
 *
 * This module owns the bits that are pure and reused across the route Zod
 * schema, the SDK input type, and the worker: the direction enum, the carried
 * fraction defaults, and the fill prompt. The geometry math + sharp compositing
 * + color harmonization live backend-side (they need `sharp`).
 */

/**
 * The carry/paint axis for a continuation.
 *
 * PAN (horizontal — half-carry continuation):
 * - `right` — turning right: the new frame's LEFT edge continues the previous
 *   view's RIGHT edge, so the carried band sits on the LEFT, painted on the RIGHT.
 * - `left` — turning left: the new frame's RIGHT edge continues the previous
 *   view's LEFT edge, so the carried band sits on the RIGHT, painted on the LEFT.
 *   (Mirror of `right`. Lets studio chain BOTH ways from a keyframe, capping
 *   chain depth so quality doesn't compound down a long one-way chain.)
 *
 * TILT (vertical — thin-strip, subject-driven re-render):
 * - `up` — tilting straight up: render the open SKY overhead. A thin strip of
 *   the establishing shot's TOP edge is carried into the new frame's BOTTOM for
 *   a soft horizon transition; the rest is painted as sky (NOT a mirrored
 *   landscape).
 * - `down` — tilting straight down: render the GROUND below. A thin strip of the
 *   BOTTOM edge is carried into the new frame's TOP.
 */
export const SURROUND_DIRECTIONS = ["right", "left", "up", "down"] as const
export type SurroundDirection = (typeof SURROUND_DIRECTIONS)[number]

/** Half the frame is carried for a horizontal pan (matches studio's composite). */
export const DEFAULT_CARRIED_FRACTION = 0.5
/**
 * Tilts carry only a thin horizon strip. Carrying half of a horizontal frame is
 * exactly what makes the model echo/mirror the landscape vertically instead of
 * rendering what's actually overhead/underfoot — so tilts keep the carry small
 * and let the tilt prompt drive the subject.
 */
export const TILT_CARRIED_FRACTION = 0.12

/** True for the vertical tilt directions (up/down), false for the pans. */
export function isTiltDirection(direction: SurroundDirection): boolean {
  return direction === "up" || direction === "down"
}

/** The carried fraction the platform uses when the caller doesn't pin one. */
export function defaultCarriedFraction(direction: SurroundDirection): number {
  return isTiltDirection(direction) ? TILT_CARRIED_FRACTION : DEFAULT_CARRIED_FRACTION
}

/** Which edge of the NEW frame holds the carried pixels vs the painted region. */
const EDGE: Record<SurroundDirection, { carried: string; painted: string }> = {
  right: { carried: "left", painted: "right" },
  left: { carried: "right", painted: "left" },
  up: { carried: "bottom", painted: "top" },
  down: { carried: "top", painted: "bottom" },
}

/** What a tilt must actually render (NOT a continuation of the landscape). */
const TILT_SUBJECT: Record<"up" | "down", { word: string; subject: string; where: string }> = {
  up: {
    word: "up",
    subject: "the open sky directly overhead — sky, clouds, or (for an interior) the canopy or ceiling",
    where: "overhead",
  },
  down: {
    word: "down",
    subject: "the ground directly below — terrain, floor, or water surface",
    where: "below",
  },
}

/**
 * Build the fill prompt the model receives alongside the half-carry composite.
 *
 * `userPrompt` (an optional scene hint from the caller) is woven in front. PAN
 * directions get the seamless-continuation prompt (with the anti-golden-hour
 * negative that fights the documented warm-regrade drift). TILT directions get a
 * subject-forcing prompt — render the sky / ground overhead / below, explicitly
 * NOT a mirrored landscape — which is what stops the vertical echo.
 */
export function buildSurroundFillPrompt(direction: SurroundDirection, userPrompt?: string): string {
  const scene = userPrompt && userPrompt.trim() ? `${userPrompt.trim()}. ` : ""
  const { carried, painted } = EDGE[direction]

  if (direction === "up" || direction === "down") {
    const t = TILT_SUBJECT[direction]
    return (
      `${scene}` +
      `This is a camera tilted straight ${t.word} from the same scene. The ${carried} strip holds real, finished pixels from the edge of the horizon view; the ${painted} region is flat gray and MUST be painted as ${t.subject}. ` +
      `Render what is genuinely ${t.where} — do NOT repeat, mirror, or continue the landscape, and do NOT draw a horizon line or distant scenery in the painted region. ` +
      `CRITICAL: keep the ${carried} strip unchanged and match the scene's EXACT lighting, time of day, white balance, and color grade — the same light as the ${carried} strip; no golden hour, no sunset, no warm relight, no cinematic regrade. ` +
      `Blend smoothly into the ${carried} strip with no visible seam. No people, no text, no labels, no watermarks.`
    )
  }

  // pan (right / left)
  return (
    `${scene}` +
    `This is a partial frame: the ${carried} portion contains real, finished pixels and the ${painted} portion is flat gray that MUST be painted in. ` +
    `Paint ONLY the ${painted} gray region as a natural, seamless continuation of the ${carried} portion — same scene, same perspective, continuing the horizon, geometry, and content across the boundary with no break. ` +
    `Keep the ${carried} portion completely unchanged. ` +
    `CRITICAL: do NOT change the lighting, exposure, white balance, or time of day. Match the ${carried} portion's EXACT light, color temperature, and contrast across the whole frame — if it is flat overcast daylight, keep flat overcast daylight. No golden hour, no sunset, no warm relight, no cinematic regrade. ` +
    `The seam between the ${carried} and ${painted} portions must be invisible. No people, no text, no labels, no watermarks.`
  )
}
