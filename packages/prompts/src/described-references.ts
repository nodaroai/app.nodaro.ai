/**
 * Described references + per-reference description overrides + rail captions —
 * the ONE place either lane phrases "what this reference IS".
 *
 * Three shapes, one grammar (`<subject> — <description>.`) plus the caption's
 * `<binding>: <caption>.`:
 *
 *   - a DESCRIBED reference (`DescribedReference`, no media) → `Natalie — a
 *     tall woman in a red coat.` The subject is the NAME, because a described
 *     reference has no seat to bind to: correlation with the prose is by name,
 *     which is why the caller leaves the name in the prompt rather than an
 *     indexed `@slug:N` mention (that grammar is url-gated).
 *   - a per-use `descriptionOverride` on a reference the HYBRID format gives no
 *     description slot (a mention / canonical-fallback / location / object role
 *     phrase carries none) → `reference image A — a tall woman in a red coat.`
 *     Same grammar, the BINDING as the subject. Where a description slot DOES
 *     exist (every legacy bullet, and the hybrid extras' `, <desc>` clause) the
 *     override fills THAT slot instead, so the model is never told twice.
 *   - a rail CAPTION for a video / audio reference → `@video_1: the establishing
 *     drone shot.` Index-aligned with the caller's url array.
 *
 * Rendering is separate from JOINING on purpose: the lines are format-agnostic
 * text, and each lane already owns where a trailing directive goes (the image
 * hybrid's `trailingLines`, the video core's `trailingLines` /
 * `allFallbackLines`). `appendReferenceLines` is the joiner for the call sites
 * that have no such array to push into — it bullets the lines into the legacy
 * "Use these characters:" block or lands them ahead of the `[style]` section in
 * hybrid, matching what each lane's own assembly does.
 */

import type { DescribedReference } from "@nodaro/shared"
import { insertBeforeStyleSection } from "./prompt-style-section.js"

/** Which reference-prompt format the lines are being rendered for. */
export type ReferenceLineFormat = "legacy" | "hybrid"

/** The legacy directive block every lane consolidates its bullets into. */
const CHARACTER_BLOCK_HEADER = "Use these characters:"

/**
 * The ONE phrasing for "this subject is described as …":
 * `<subject> — <description>.`
 *
 * `subject` is the name for a described reference and the reference's binding
 * (`reference image A` / `@image_2`) for a per-use description override. Both
 * halves are trimmed; an empty half yields `""` (the caller drops the line).
 */
export function referenceDescriptionLine(
  subject: string,
  description: string | null | undefined,
): string {
  const s = subject.trim()
  const d = description?.trim()
  if (!s || !d) return ""
  return `${s} — ${d}.`
}

/**
 * Render the described references (name + description, no media) as trailing
 * lines. Entries missing either half contribute nothing; entries repeating a
 * name (case-insensitively) render once — a description a caller sent twice
 * says nothing new to the model, and every sibling renderer in both lanes
 * dedups the same way.
 */
export function renderDescribedReferenceLines(
  refs: readonly DescribedReference[] | undefined,
): string[] {
  if (!refs || refs.length === 0) return []
  const lines: string[] = []
  const seen = new Set<string>()
  for (const r of refs) {
    const key = r.name?.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    const line = referenceDescriptionLine(r.name, r.description)
    if (!line) continue
    seen.add(key)
    lines.push(line)
  }
  return lines
}

/**
 * Render the video / audio rail captions as `@video_N: <caption>.` /
 * `@audio_N: <caption>.` lines, index-aligned with the caller's url arrays.
 *
 * Each list is bounded by the count of references of that kind that actually
 * ship, so a caption for a url the provider cap dropped never binds a phantom
 * `@video_N`. Blank captions are holes in an aligned array, not lines.
 */
export function renderReferenceCaptionLines(
  videoCaptions: readonly string[] | undefined,
  audioCaptions: readonly string[] | undefined,
  counts: { readonly video: number; readonly audio: number },
): string[] {
  const lines: string[] = []
  const render = (captions: readonly string[] | undefined, kind: "video" | "audio", cap: number) => {
    if (!captions) return
    for (let i = 0; i < captions.length && i < cap; i++) {
      const text = captions[i]?.trim()
      if (!text) continue
      lines.push(`@${kind}_${i + 1}: ${text}.`)
    }
  }
  render(videoCaptions, "video", counts.video)
  render(audioCaptions, "audio", counts.audio)
  return lines
}

/**
 * Append reference lines to an assembled prompt the way the surrounding lane
 * would have.
 *
 *   - hybrid → trailing scene directives ahead of the `[style]` section (the
 *     section has no terminator, so a flat append would read as one more look
 *     clause).
 *   - legacy → `- ` bullets consolidated into the existing
 *     "Use these characters:" block, or a new block prepended ahead of the
 *     body — the same splice-or-create both lanes already do for their
 *     canonical-fallback and extra-ref bullets.
 *
 * No lines → the prompt is returned unchanged, byte-for-byte.
 */
export function appendReferenceLines(
  prompt: string,
  lines: readonly string[],
  format: ReferenceLineFormat,
): string {
  if (lines.length === 0) return prompt
  if (format === "hybrid") return insertBeforeStyleSection(prompt, lines)
  const bullets = lines.map((l) => `- ${l}`).join("\n")
  if (prompt.startsWith(`${CHARACTER_BLOCK_HEADER}\n`)) {
    const splitIdx = prompt.indexOf("\n\n")
    if (splitIdx === -1) return `${prompt}\n${bullets}`
    return `${prompt.slice(0, splitIdx)}\n${bullets}${prompt.slice(splitIdx)}`
  }
  const block = `${CHARACTER_BLOCK_HEADER}\n${bullets}`
  return prompt ? `${block}\n\n${prompt}` : block
}
