/**
 * Backend error codes that represent a USER-FIXABLE INPUT problem (the source is
 * too long, too large, …) rather than a system failure. The run flow surfaces
 * these as an ORANGE warning — toast + node state — instead of a red error, so a
 * "trim your clip and retry" reads like guidance, not a crash.
 *
 * Keep in sync with the route 400 codes that mean "adjust your input and retry".
 * Currently the SwitchX preflight (`backend/src/routes/switchx.ts`); the route's
 * own test pins these exact code strings.
 */
export const INPUT_WARNING_CODES: ReadonlySet<string> = new Set([
  "VIDEO_TOO_MANY_FRAMES", // SwitchX: source over the auto-trim cap (> 270 frames)
  "SOURCE_TOO_LARGE",      // SwitchX: source resolution over 2.77 Mpx
])

/** True when an API error code is a user-fixable input warning (→ orange, not red). */
export function isInputWarningCode(code: unknown): code is string {
  return typeof code === "string" && INPUT_WARNING_CODES.has(code)
}
