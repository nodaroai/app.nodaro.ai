/**
 * The layout-reference SCOPING LINE, and where it came from.
 *
 * The 2026-09-10 greybox experiment's finding was that a blockout reference
 * without a scoping instruction gives a blockout OUT: the model treats the
 * clay look as part of what it is being asked to reproduce. The fix is one
 * sentence that says what the reference IS for (layout, camera motion,
 * trajectory, timing, occlusion) and what it is NOT for (the clay look, flat
 * colours, materials, lighting).
 *
 * That sentence belongs in the doctrine package, so every surface says the
 * same thing. Until it is published there this holds a default — and the
 * receipt always records WHICH source was used, because an A/B whose only
 * variable is a sentence is worthless if nobody can tell which sentence ran.
 */

/** The name the doctrine export is expected to take in `@nodaro/prompts`. */
export const SCOPING_EXPORT_NAMES = Object.freeze([
  "SCENE3D_LAYOUT_REFERENCE_SCOPING_LINE",
  "SCENE3D_LAYOUT_SCOPING_LINE",
])

/**
 * The fallback.
 *
 * The first clause is the pilot's own "only added wording", kept verbatim so a
 * rerun is comparable with the published A/B; the second clause is the
 * greybox experiment's finding, which the pilot did not have.
 */
export const DEFAULT_SCOPING_LINE =
  "Use Video 1 as the exact layout, camera-motion, suitcase-trajectory, timing and occlusion guide; " +
  "transform its plain blockout into the photorealistic scene described above. " +
  "Do not copy the guide's clay look, flat colours, materials or lighting — those come from the description and Image 1."

/**
 * Resolve the scoping line, preferring the doctrine package.
 *
 * The import is dynamic and its failure is not an error: this harness runs
 * from a checkout where `@nodaro/prompts` may not be built, and refusing to
 * run the A/B over a missing dev dependency would be the wrong trade for a
 * paid run that is otherwise ready.
 */
export async function resolveScopingLine({ cli } = {}) {
  if (typeof cli === "string" && cli.trim() !== "") {
    return { line: cli.trim(), source: "cli", exportName: null }
  }
  try {
    const prompts = await import("@nodaro/prompts")
    for (const name of SCOPING_EXPORT_NAMES) {
      const value = prompts?.[name]
      if (typeof value === "string" && value.trim() !== "") {
        return { line: value.trim(), source: "prompts-package", exportName: name }
      }
    }
    return { line: DEFAULT_SCOPING_LINE, source: "default", exportName: null,
      note: `@nodaro/prompts loaded but exports none of ${SCOPING_EXPORT_NAMES.join(", ")}` }
  } catch (error) {
    return { line: DEFAULT_SCOPING_LINE, source: "default", exportName: null,
      note: `@nodaro/prompts not importable here (${String(error?.message ?? error).slice(0, 120)})` }
  }
}
