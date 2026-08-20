/**
 * Surround continuation — the fill prompt.
 *
 * Prompt engineering, so it lives here and not in `@nodaro/shared`: that
 * package is published to npm under Apache-2.0, where every release is an
 * irrevocable grant. This package is never published (`"private": true`).
 * `@nodaro/shared` keeps only the wire contract — the direction enum and the
 * carried-fraction defaults the route Zod schema and the SDK input type need.
 */
import type { SurroundDirection } from "@nodaro/shared"

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
