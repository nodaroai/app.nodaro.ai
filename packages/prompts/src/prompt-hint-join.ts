/**
 * The measured hint join, shared by the image (`composePromptText`) and video
 * (`composeVideoPromptText`) composers so the two can never drift.
 *
 * EXACT NO-OP: zero hints → the user's prompt back VERBATIM AND UNTRIMMED (the
 * platform-caller byte-parity contract — the old platform path passed the
 * prompt straight to `buildImagePrompt`, which never trims, so trimming here
 * would change the assembled prompt and the recorded `jobs.input_data`
 * byte-for-byte). With hints → trim the body so the join reads cleanly
 * ("prompt. hint", not "prompt . hint"), and drop a blank body so the result
 * never starts with ". ".
 *
 * WHAT THIS JOIN COVERS NOW: the prompt BODY only. A LOOK clause no longer
 * reaches this function from either composer — it lifts into the trailing
 * `[style]` section (`prompt-style-section.ts`), which is `". "`-joined WITHIN a
 * line but hung off the body by a blank line. So "every folded clause is one
 * `". "` further along the same string" stopped being true for a look-carrying
 * call, deliberately; `composeSectionedPrompt` is the whole-prompt shape and
 * this is the piece of it that assembles the body. The zero-hint no-op branch is
 * untouched and still the thing the routes' `composed !== prompt` guard reads.
 *
 * Never mutates its inputs.
 */

/** The measured separator between the user's prompt and each folded hint. */
export const PROMPT_HINT_SEPARATOR = ". "

/**
 * Join a user prompt with its folded hint clauses.
 *
 * The trailing `.filter((p) => p.length > 0)` on the join array is
 * parity-critical — do NOT remove it as "redundant": `hints` arrives
 * pre-filtered but `userPrompt` does not, so a blank user prompt would
 * otherwise make the result start with ". ".
 */
export function joinPromptHints(userPrompt: string, hints: readonly string[]): string {
  if (hints.length === 0) return userPrompt
  return [userPrompt.trim(), ...hints].filter((p) => p.length > 0).join(PROMPT_HINT_SEPARATOR)
}
