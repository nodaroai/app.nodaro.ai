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
 * GRAMMAR CORE. The slug shape, the parser and the finder (including BOTH
 * collision guards) live in `mention-token-grammar.ts` and are shared verbatim
 * with `entity-mention-slug.ts` (creatures/objects), which speaks the identical
 * 2-or-3-segment grammar. This module is the MEDIA view of that core: the
 * per-kind field names, and the part that genuinely differs — WHICH refs
 * contribute a slug.
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
import {
  MENTION_SLUG_PATTERN,
  findMentionTokens,
  mentionNameSlug,
  parseMentionToken,
} from "./mention-token-grammar.js"

/**
 * Slugify an image reference's display name for `@`-mention tokens. Byte-
 * identical algorithm to `characterMentionSlug` / `locationMentionSlug`; kept as
 * a separate export to make the call site's intent explicit.
 */
export function imageMentionSlug(name: string): string {
  return mentionNameSlug(name)
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
 *
 * Delegates to the shared `parseMentionToken` and renames its kind-neutral
 * `slug` / `index` to this module's `imageSlug` / `imageIndex`. The optional
 * `role` / `lock` keys are re-emitted CONDITIONALLY so the documented shape rule
 * survives the rename: a 2-part token has no `role` key at all.
 */
export function parseImageMentionToken(text: string): {
  imageSlug: string
  imageIndex: number
  /** Present ONLY for a 3-part token; omitted otherwise (shape rule). */
  role?: string
  /** Present ONLY when a sentinel was found; omitted otherwise (shape rule). */
  lock?: boolean
} | null {
  const parsed = parseMentionToken(text)
  if (!parsed) return null
  return {
    imageSlug: parsed.slug,
    imageIndex: parsed.index,
    ...(parsed.role !== undefined ? { role: parsed.role } : {}),
    ...(parsed.lock !== undefined ? { lock: parsed.lock } : {}),
  }
}

/**
 * Find every image `@-mention` in a prompt whose slug is a known image slug.
 *
 * `knownImageSlugs` (from `knownImageSlugsFromRefs`) is what keeps this parser
 * off the other grammars' tokens — every finder matches the same `@slug:N…`
 * surface and only the known-slug set separates them.
 */
export function findImageMentionTokens(
  prompt: string,
  knownImageSlugs: readonly string[],
): ImageMentionTokenInfo[] {
  return findMentionTokens(prompt, knownImageSlugs).map((t) => ({
    token: t.token,
    imageSlug: t.slug,
    imageIndex: t.index,
    ...(t.role !== undefined ? { role: t.role } : {}),
    ...(t.lock !== undefined ? { lock: t.lock } : {}),
    offset: t.offset,
  }))
}

/**
 * The mention slug a single reference contributes, or `null` when the ref
 * cannot carry a mention at all — the SINGLE gate, so every view of "which
 * refs are mentionable" is the same view.
 *
 * Shared by `knownImageSlugsFromRefs` (the finder's known-slug set) and the
 * prompt-builder's hybrid resolver (its slug → ref lookup map). Those two must
 * admit exactly the same refs: a slug the finder accepts but the resolver drops
 * would splice a token with nothing to bind, and a ref the resolver keys under
 * a slug no token can match is dead weight. Emptiness is NOT the gate (see
 * `MENTION_SLUG_PATTERN`).
 */
export function imageMentionSlugForRef(r: ConnectedReference): string | null {
  if (r.source !== "wired-image" && r.source !== "manual") return null
  if (r.isExtraRef === true) return null
  if (!r.url || !r.defaultName) return null
  const slug = imageMentionSlug(r.defaultName)
  return MENTION_SLUG_PATTERN.test(slug) ? slug : null
}

/**
 * The known-image-slug set for a reference list — the SINGLE source of truth for
 * the derivation, shared by `buildImagePrompt`'s Phase 0 and the backend
 * orchestrator's structured-branch gate so the two can never disagree about
 * whether a prompt carries a resolvable image mention.
 *
 * Only MEDIA refs (`wired-image` / `manual`) with a URL participate — the other
 * sources have their own mention grammars: characters, locations, and — since the
 * creature/object leg — wired entities via `knownEntitySlugsFromRefs`.
 *
 * `isExtraRef` refs are EXCLUDED: an extra renders through the extras path with
 * its own body line, so letting a mention also bind one would double-emit prose.
 *
 * Grammar-invalid slugs are DROPPED (see `MENTION_SLUG_PATTERN`) — a ref named
 * "3D Render" slugs to the non-empty but unparseable `"3d-render"`, and admitting
 * it would put a slug in the set that no token can ever match.
 *
 * All four of those gates live in `imageMentionSlugForRef`, which the hybrid
 * resolver's own lookup map uses too — one predicate, so the two views cannot
 * drift apart.
 */
export function knownImageSlugsFromRefs(
  refs: readonly ConnectedReference[],
): string[] {
  const out = new Set<string>()
  for (const r of refs) {
    const slug = imageMentionSlugForRef(r)
    if (slug) out.add(slug)
  }
  return [...out]
}
