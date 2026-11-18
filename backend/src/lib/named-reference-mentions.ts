/**
 * Named mentions on the video path — pure, no I/O.
 *
 * A client that names its references writes `@<name-slug>:<index>[:<role>]` in
 * the prompt (`@town:2`, `@town:2:background`). The video resolver binds
 * characters by that grammar itself; every other reference (an image, a
 * location, a creature, an object) it seats and addresses by id only
 * (`{ref:<id>}`), so the named token used to reach the model as typed. Here each
 * named token of such a reference becomes its `{ref:<id>[:<role>]}`, which the
 * resolver then turns into the seat's binding, or into the reference's name when
 * it takes no seat.
 */
import type { ConnectedReference } from "@nodaro/shared/types"
import { findImageMentionTokens, imageMentionSlug } from "@nodaro/shared/entities"

/** A slug the mention grammar can match (`mention-token-grammar.ts`). */
const SLUG = /^[a-z][a-z0-9-]*$/

/**
 * The slug → id map of the references a named token may address: every
 * non-character reference with an id and a name. A name a wired character
 * also answers to stays the character's; of two references with one name the
 * first wins, as on the image path.
 */
function addressableBySlug(refs: readonly ConnectedReference[]): Map<string, string> {
  const characterSlugs = new Set(
    refs.filter((r) => r.source === "wired-character" && r.characterSlug).map((r) => r.characterSlug as string),
  )
  const bySlug = new Map<string, string>()
  for (const r of refs) {
    if (r.source === "wired-character") continue
    // An id with a brace would end the `{ref:…}` token early.
    if (!r.id || /[{}]/.test(r.id) || !r.defaultName) continue
    const slug = imageMentionSlug(r.defaultName)
    if (!SLUG.test(slug) || characterSlugs.has(slug) || bySlug.has(slug)) continue
    bySlug.set(slug, r.id)
  }
  return bySlug
}

/** Rewrite every named mention of a non-character reference to its `{ref:<id>}` token. */
export function namedMentionsToRefIdTokens(
  prompt: string | undefined,
  refs: readonly ConnectedReference[],
): string | undefined {
  if (!prompt || !prompt.includes("@")) return prompt
  const bySlug = addressableBySlug(refs)
  if (bySlug.size === 0) return prompt
  const tokens = findImageMentionTokens(prompt, [...bySlug.keys()])
  let out = prompt
  // Last first, so an earlier token's offset still holds.
  for (const t of [...tokens].sort((a, b) => b.offset - a.offset)) {
    const id = bySlug.get(t.imageSlug) as string
    const token = `{ref:${id}${t.role ? `:${t.role}` : ""}}`
    out = out.slice(0, t.offset) + token + out.slice(t.offset + t.token.length)
  }
  return out
}
