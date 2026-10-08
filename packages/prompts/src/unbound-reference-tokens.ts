/**
 * The unwired half of the editor reference-token contract — what a
 * `{image:N:label}` / `{video:N:label}` / `{audio:N:label}` token becomes when
 * no reference of its kind sits at its position. ONE rule for every surface:
 * the video resolver (`resolveReferenceTokens`) and the image prompt builder
 * (`buildImagePrompt`) both render an unwired token through these two
 * functions, so the image and video paths cannot drift apart on it.
 *
 * Each caller keeps its own token grammar and its own WIRED rendering (video:
 * `the person from @image_1`; image: `Image 1 (person)` /
 * `the person from reference image A`); only the unwired outcome is shared.
 */

/**
 * The text an unwired token renders to: its label as written, or nothing for a
 * label-less token. Text a resolver does not rewrite keeps its tokens as typed
 * — on image prompts a wired token in a hybrid `Avoid:` line and the native
 * negative prompt, both on purpose (see `dropUnwiredImageTokens`).
 */
export function unboundReferenceTokenText(label: string | undefined): string {
  return label ?? ""
}

/**
 * Tidy the gap a dropped token leaves: collapse every run of 2+ HORIZONTAL
 * whitespace to one space, then trim. The class is `[^\S\r\n]` (NOT `\s`) so
 * the `\n` / `\n\n` separators between assembled blocks survive — a `\s{2,}`
 * collapse would merge paragraphs.
 */
export function tidyReferenceTokenGaps(prompt: string): string {
  return prompt.replace(/[^\S\r\n]{2,}/g, " ").trim()
}
