/**
 * Named-image `@-mention` parser — `@<name-slug>:<index>[:<role>]`.
 *
 * The media analog of `character-mention-slug.ts` / `location-mention-slug.ts`,
 * for a wired image (`wired-image` / `manual` reference) addressed by the slug of
 * its NAME: an upload node's label on the canvas, or the name a thin client puts
 * on the reference. The grammar is the SIMPLEST of the three — 2 or 3 segments,
 * no buckets, no variants, no usage-mode enum — because a media reference has no
 * variant array to select from and no identity mode to override. Every valid 3rd
 * segment is a ROLE.
 *
 *   @town:3                  — bare mention; renders the reference's binding
 *                              ("reference image C") at the typed position
 *   @town:3:background       — role phrase ("the background from reference image C")
 *   @town:3:my-custom-role   — custom roles pass through verbatim
 *   @town:3~lock             — additive identity-lock sentinel (also `~nolock`)
 *   @town:1:a:b              — NULL. A 4-part token is never an image mention.
 *
 * NO WIRE FIELD. Unlike `characterSlug` / `locationSlug`, there is no `imageSlug`
 * on `ConnectedReference`: the slug is DERIVED from `defaultName` at resolve time
 * (`knownImageSlugsFromRefs`), so a client cannot drift from the grammar and the
 * reference schema is untouched.
 *
 * NO LEGACY RESOLVER. Only the hybrid reference format resolves these tokens;
 * under the legacy format an `@name:N` token stays literal text and the
 * reference auto-attaches exactly as it does today.
 */

import type { ConnectedReference } from "./types.js"

/**
 * Grammar-valid slug shape — the exact shape `findImageMentionTokens`' regex can
 * produce, and therefore the gate on BOTH sides of the match.
 *
 * Emptiness is NOT the gate: `imageMentionSlug("3D Render")` → `"3d-render"` is
 * non-empty yet UNPARSEABLE (a leading digit), so a ref named "3D Render" must be
 * dropped from the known-slug set even though its slug is truthy. This pattern is
 * what drops it.
 */
const IMAGE_SLUG_PATTERN = /^[a-z][a-z0-9-]*$/

/**
 * Slugify an image reference's display name for `@`-mention tokens. Byte-
 * identical algorithm to `characterMentionSlug` / `locationMentionSlug`; kept as
 * a separate export to make the call site's intent explicit and to allow future
 * divergence.
 */
export function imageMentionSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

export interface ImageMentionTokenInfo {
  /** The matched token text, verbatim — spliced out of the prompt at resolve time. */
  readonly token: string
  readonly imageSlug: string
  /**
   * 1-based correlation index assigned at insertion by the autocomplete
   * (`nextMentionIndex` = max(existing N) + 1, unified across characters,
   * locations and images). The hybrid resolver binds by its own numbering walk,
   * so the index is CORRELATION ONLY — it is never echoed into the prompt.
   */
  readonly imageIndex: number
  /**
   * Per-mention ROLE from the 3rd segment (`@town:3:background`) — curated
   * (`REFERENCE_ROLE_PRESETS["wired-image"]`) or custom, stored VERBATIM. Media
   * role presets are all single-word, so this never needs `normalizeRoleSlug`
   * (the location-only remapping for multi-word presets). OMITTED (undefined,
   * never null) for 2-part tokens, so those stay shape-identical to a parser
   * with no role support.
   */
  readonly role?: string
  /**
   * Additive `~lock` / `~nolock` sentinel. Tri-state: `true` (force ON) |
   * `false` (force OFF, suppressing a ref-level `identityLock.enabled`) |
   * ABSENT/undefined (inherit the ref default). Honored only by the hybrid
   * resolver — there is no legacy image resolver to make it inert on.
   */
  readonly lock?: boolean
  /** Byte offset into the source prompt — used to splice the token out. */
  readonly offset: number
}

/**
 * Parse a single `@<name-slug>:<index>[:<role>]` token. Returns null when the
 * token doesn't match a supported shape (the caller falls back to literal text).
 *
 * Segment count is 2 or 3 — NOT 2–4 like the character/location parsers. A media
 * reference has no variant/bucket slot, so there is nothing for a 4th segment to
 * mean, and claiming one would let this parser swallow a character token.
 */
export function parseImageMentionToken(text: string): {
  imageSlug: string
  imageIndex: number
  /** Present ONLY for a 3-part token; omitted otherwise (shape rule). */
  role?: string
  /** Present ONLY when a sentinel was found; omitted otherwise (shape rule). */
  lock?: boolean
} | null {
  if (!text.startsWith("@")) return null
  let rest = text.slice(1)
  if (rest.length === 0 || !/^[a-z]/.test(rest)) return null

  // Strip a trailing `~nolock` (force OFF) or `~lock` (force ON) BEFORE splitting
  // so the segment grammar is untouched (a `~` never appears inside a segment).
  // Check `~nolock` FIRST — `~lock` is its suffix. A token with NEITHER sentinel
  // gains NO `lock` key.
  let lockField: { lock?: boolean } = {}
  if (rest.endsWith("~nolock")) {
    rest = rest.slice(0, -"~nolock".length)
    lockField = { lock: false }
  } else if (rest.endsWith("~lock")) {
    rest = rest.slice(0, -"~lock".length)
    lockField = { lock: true }
  }

  const parts = rest.split(":")
  if (parts.length < 2 || parts.length > 3) return null

  const [imageSlug, indexStr, third] = parts
  if (!IMAGE_SLUG_PATTERN.test(imageSlug)) return null
  if (!/^\d+$/.test(indexStr)) return null
  const imageIndex = parseInt(indexStr, 10)
  if (!Number.isInteger(imageIndex) || imageIndex < 1) return null

  if (parts.length === 2) return { imageSlug, imageIndex, ...lockField }
  if (!IMAGE_SLUG_PATTERN.test(third)) return null
  return { imageSlug, imageIndex, role: third, ...lockField }
}

/**
 * Find every image `@-mention` in a prompt whose slug is a known image slug.
 *
 * `knownImageSlugs` (from `knownImageSlugsFromRefs`) is what keeps this parser
 * off the other two grammars' tokens — all three finders match the same
 * `@slug:N…` surface and only the known-slug set separates them.
 */
export function findImageMentionTokens(
  prompt: string,
  knownImageSlugs: readonly string[],
): ImageMentionTokenInfo[] {
  const tokens: ImageMentionTokenInfo[] = []
  // ONE optional segment (the role) — images have no variant/bucket slot.
  //
  // The trailing `(?![:a-z0-9-])` is the DELIBERATE divergence from the character
  // and location finders. Without it, a 4-part CHARACTER token that the character
  // pass failed to resolve (`@kira:1:smile:face`) would be captured here as the
  // 3-part `@kira:1:smile`, leaving `:face` dangling in the prompt. The lookahead
  // makes the regex backtrack and match nothing, so a 4-part token is NEVER an
  // image mention. `~lock` still matches (`~` is outside the class), and its own
  // `(?![a-z0-9-])` keeps `~locked` / `~nolockx` literal.
  //
  // Linear-scan shape (a fixed prefix then bounded optional groups, no nested
  // quantifiers) — matching the sibling finders, and ReDoS-free.
  const regex =
    /(?:^|[^a-zA-Z0-9])(@[a-z][a-z0-9-]*:\d+(?::[a-z][a-z0-9-]*)?(?:~(?:no)?lock(?![a-z0-9-]))?)(?![:a-z0-9-])/g
  const knownSet = new Set(knownImageSlugs)
  for (const match of prompt.matchAll(regex)) {
    const token = match[1]
    const offset = (match.index ?? 0) + (match[0].length - token.length)
    const parsed = parseImageMentionToken(token)
    if (parsed && knownSet.has(parsed.imageSlug)) {
      tokens.push({ token, ...parsed, offset })
    }
  }
  return tokens
}

/**
 * The known-image-slug set for a reference list — the SINGLE source of truth for
 * the derivation, shared by `buildImagePrompt`'s Phase 0 and the backend
 * orchestrator's structured-branch gate so the two can never disagree about
 * whether a prompt carries a resolvable image mention.
 *
 * Only MEDIA refs (`wired-image` / `manual`) with a URL participate — the other
 * sources have their own mention grammars (characters, locations) or no mention
 * path at all (objects, creatures).
 *
 * `isExtraRef` refs are EXCLUDED: an extra renders through the extras path with
 * its own body line, so letting a mention also bind one would double-emit prose.
 *
 * Grammar-invalid slugs are DROPPED (see `IMAGE_SLUG_PATTERN`) — a ref named
 * "3D Render" slugs to the non-empty but unparseable `"3d-render"`, and admitting
 * it would put a slug in the set that no token can ever match.
 */
export function knownImageSlugsFromRefs(
  refs: readonly ConnectedReference[],
): string[] {
  const out = new Set<string>()
  for (const r of refs) {
    if (r.source !== "wired-image" && r.source !== "manual") continue
    if (r.isExtraRef === true) continue
    if (!r.url || !r.defaultName) continue
    const slug = imageMentionSlug(r.defaultName)
    if (IMAGE_SLUG_PATTERN.test(slug)) out.add(slug)
  }
  return [...out]
}
