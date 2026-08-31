import { imageMentionSlug, parseImageMentionToken } from "@nodaro/shared"
import type { RefImageItem } from "../editor-types"

/**
 * Editor-side mirror of the shared `imageMentionSlugForRef` gate, for the
 * `RefImageItem` shape the `@` autocomplete consumes.
 *
 * The gates are the SAME four the shared predicate applies to a
 * `ConnectedReference` — media source, not an extra ref, has a URL and a name,
 * and a GRAMMAR-VALID slug. What differs is only the input type: the editor's
 * item carries `label` (mapped from `ConnectedReference.defaultName`) and the
 * "uploaded" / "wired" display sources (mapped from "manual" / "wired-image").
 *
 * Both derivations are SHARED-OWNED, never re-implemented here:
 *   - the slug comes from `imageMentionSlug` (the one slugify);
 *   - grammar validity is decided by round-tripping the derived slug through
 *     `parseImageMentionToken`, so the editor admits EXACTLY the slugs the
 *     grammar can produce. (A ref named "3D Render" slugs to the non-empty but
 *     unparseable "3d-render"; the round-trip drops it, matching the shared
 *     `IMAGE_SLUG_PATTERN` gate without duplicating that pattern here.)
 *
 * A slug the editor offered but the resolver dropped would leave a literal
 * `@name:N` in the prompt, so the two views must not drift.
 *
 * This is the PER-ITEM half of the predicate. The list-level half — which of
 * those slugs is actually mentionable in a given ref list — is
 * `imageMentionSlugOwners`, and it is the one the pills and rows go through.
 */
export function imageMentionSlugForItem(item: RefImageItem): string | null {
  if (item.source !== "uploaded" && item.source !== "wired") return null
  if (item.isExtraRef === true) return null
  if (!item.url || !item.label) return null
  const slug = imageMentionSlug(item.label)
  return parseImageMentionToken(`@${slug}:1`) ? slug : null
}

/**
 * The CHARACTER and LOCATION slug namespaces present in a ref list — the two
 * sibling `@<slug>:N` grammars an image name has to yield to.
 *
 * One derivation, used by `buildKnownSlugSets` (which promotion + `valueToDoc`
 * read) and by `imageMentionSlugOwners` (the subtraction below), so "which
 * slugs belong to a character/location" can't be answered two ways.
 */
export function mentionNamespaceSlugs(items: readonly RefImageItem[]): {
  characters: Set<string>
  locations: Set<string>
} {
  const characters = new Set<string>()
  const locations = new Set<string>()
  for (const item of items) {
    if (item.source === "character" && item.characterSlug) characters.add(item.characterSlug)
    else if (item.source === "location" && item.locationSlug) locations.add(item.locationSlug)
  }
  return { characters, locations }
}

/**
 * The media ref that OWNS each mentionable name-slug in a list. The single
 * list-level answer to "is `@<slug>:N` an image mention here, and which image
 * does it bind?", shared by the promotion gates (input/paste rules via editor
 * storage, `valueToDoc` via `KnownSlugSets`), the autocomplete rows, and the
 * pill's own thumbnail lookup — so all four agree by construction.
 *
 * Two list-level rules the per-item predicate can't express:
 *
 *   1. NAMESPACE PRECEDENCE. All three grammars share the `@<slug>:N` surface,
 *      and the prompt-builder resolves character → location → image, so a slug
 *      that is ALSO a wired character's or location's binds THAT entity at
 *      build time. Offering it as an image mention would show an image
 *      thumbnail on a pill the server binds to the character, and `collectTokens`
 *      would re-pill it as a `characterRef` on the next reload. So a contested
 *      slug is not mentionable as an image at all.
 *   2. FIRST WINS. Two refs can share a display name. The shared resolver keeps
 *      the first (`if (!bySlug.has(slug)) bySlug.set(slug, r)`), so only the
 *      first ref may offer the row — otherwise the list shows N indistinguishable
 *      choices that all bind the same image.
 */
export function imageMentionSlugOwners(
  items: readonly RefImageItem[],
): Map<string, RefImageItem> {
  const { characters, locations } = mentionNamespaceSlugs(items)
  const owners = new Map<string, RefImageItem>()
  for (const item of items) {
    const slug = imageMentionSlugForItem(item)
    if (!slug) continue
    if (characters.has(slug) || locations.has(slug)) continue
    if (!owners.has(slug)) owners.set(slug, item)
  }
  return owners
}

/**
 * The known-image-mention-slug set for a reference list — the editor's analog
 * of `knownImageSlugsFromRefs`. Drives BOTH the promotion gates (input/paste
 * rules via editor storage, `valueToDoc` via `KnownSlugSets`) and the
 * autocomplete rows, so a typed token and a picked row promote on exactly the
 * same condition.
 */
export function knownImageMentionSlugs(
  items: readonly RefImageItem[],
): Set<string> {
  return new Set(imageMentionSlugOwners(items).keys())
}

/**
 * The item a mention slug binds — how a pill resolves its thumbnail + display
 * name from editor storage (the name-addressed analog of the positional
 * `imageRef` view's `list[imageIndex - 1]` lookup). Goes through the owners map
 * so an unmentionable slug (contested with a character/location) resolves to
 * nothing rather than to an image the prompt never binds.
 */
export function findItemByImageMentionSlug(
  items: readonly RefImageItem[],
  slug: string,
): RefImageItem | undefined {
  return imageMentionSlugOwners(items).get(slug)
}
