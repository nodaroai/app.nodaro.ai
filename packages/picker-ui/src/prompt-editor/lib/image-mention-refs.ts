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
 */
export function imageMentionSlugForItem(item: RefImageItem): string | null {
  if (item.source !== "uploaded" && item.source !== "wired") return null
  if (item.isExtraRef === true) return null
  if (!item.url || !item.label) return null
  const slug = imageMentionSlug(item.label)
  return parseImageMentionToken(`@${slug}:1`) ? slug : null
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
  const out = new Set<string>()
  for (const item of items) {
    const slug = imageMentionSlugForItem(item)
    if (slug) out.add(slug)
  }
  return out
}

/**
 * First item whose derived mention slug matches — how a pill resolves its
 * thumbnail + display name from editor storage (the name-addressed analog of
 * the positional `imageRef` view's `list[imageIndex - 1]` lookup).
 */
export function findItemByImageMentionSlug(
  items: readonly RefImageItem[],
  slug: string,
): RefImageItem | undefined {
  for (const item of items) {
    if (imageMentionSlugForItem(item) === slug) return item
  }
  return undefined
}
