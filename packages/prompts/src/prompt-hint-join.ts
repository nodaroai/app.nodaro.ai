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
