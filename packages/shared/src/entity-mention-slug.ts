/**
 * Wired-entity `@-mention` parser — `@<name-slug>:<index>[:<role>][~lock|~nolock]`
 * for `wired-creature` and `wired-object` references.
 *
 * THE BUG THIS KILLS. Before this leg, creatures and objects were the only wired
 * sources with NO mention grammar. A user writing "Nessie rises from the lake"
 * with a creature node wired in got the creature's NAME as plain prose while its
 * binding dangled as a trailing "the creature from reference image D" line after
 * the style hints — two disconnected halves of one intent, which is exactly the
 * failure mode mentions exist to remove. With a mention, the binding renders
 * INLINE at the typed position and the trailing canonical fallback for that ref
 * is suppressed.
 *
 *   @nessie:4                — bare mention; the source-default role phrase
 *                              ("the creature from reference image D")
 *   @nessie:4:markings       — role phrase ("the markings from reference image D")
 *   @chair:2:material        — objects use the `wired-object` presets
 *   @nessie:4:my-custom-role — custom roles pass through verbatim
 *   @nessie:4~lock           — additive identity-lock sentinel (also `~nolock`)
 *   @nessie:4:a:b            — NULL. A 4-part token is never an entity mention.
 *
 * GRAMMAR CORE. Identical grammar to the named-image mention, so the slug shape,
 * the parser and the finder (with BOTH collision guards — the 4-part trailing
 * reject and the location slash guard) are the SHARED `mention-token-grammar.ts`,
 * not a second hand-copied edition. This module is the ENTITY view of that core:
 * the field names, and the part that genuinely differs — WHICH refs contribute a
 * slug.
 *
 * PRECEDENCE, across all five kinds:
 *
 *     character → location → image → creature → object
 *
 * Enforced by RESOLUTION ORDER in `buildImagePrompt`'s Phase 0, not by anything
 * in this file: each pass splices its matched tokens out of the prompt before the
 * next pass runs its finder, so a slug claimed by an earlier kind never reaches a
 * later pass. A name shared by a character and a creature resolves as the
 * CHARACTER, and the creature token never fires. The creature-before-object half
 * of the tail is enforced inside the single entity pass, whose slug → ref map is
 * built creature-first (see `resolveEntityMentionsHybrid`).
 *
 * NO WIRE FIELD, matching the image grammar and unlike `characterSlug` /
 * `locationSlug`: the slug is DERIVED from `defaultName` at resolve time
 * (`knownEntitySlugsFromRefs`), so a client cannot drift from the grammar and the
 * reference schema is untouched.
 *
 * NO LEGACY RESOLVER — the image-grammar precedent. Only the hybrid reference
 * format resolves these tokens; under the legacy format an `@name:N` token stays
 * literal text and the entity auto-attaches with its trailing canonical phrase
 * exactly as it does today. Legacy assembly has no inline role-phrase machinery
 * at all (its object/creature rendering is the numbered-directive block), so
 * there is no clean seam to add one and no consumer asking for it.
 */

import type { ConnectedReference } from "./types.js"
import {
  MENTION_SLUG_PATTERN,
  findMentionTokens,
  mentionNameSlug,
  parseMentionToken,
} from "./mention-token-grammar.js"

/**
 * Slugify a wired entity's display name for `@`-mention tokens. Byte-identical
 * algorithm to `characterMentionSlug` / `imageMentionSlug`; kept as a separate
 * export to make the call site's intent explicit.
 */
export function entityMentionSlug(name: string): string {
  return mentionNameSlug(name)
}

export interface EntityMentionTokenInfo {
  /** The matched token text, verbatim — spliced out of the prompt at resolve time. */
  readonly token: string
  readonly entitySlug: string
  /**
   * 1-based correlation index assigned at insertion by the autocomplete
   * (`nextMentionIndex` = max(existing N) + 1, unified across every mention
   * kind). The hybrid resolver binds by its own numbering walk, so the index is
   * CORRELATION ONLY — it is never echoed into the prompt.
   */
  readonly entityIndex: number
  /**
   * Per-mention ROLE from the 3rd segment (`@nessie:4:markings`) — curated
   * (`REFERENCE_ROLE_PRESETS["wired-creature"]` / `["wired-object"]`) or custom,
   * stored VERBATIM. Both preset lists are entirely single-word, so this never
   * needs `normalizeRoleSlug` (the location-only remapping for multi-word
   * presets). OMITTED (undefined, never null) for 2-part tokens.
   */
  readonly role?: string
  /**
   * Additive `~lock` / `~nolock` sentinel. Tri-state: `true` (force ON) |
   * `false` (force OFF, suppressing a ref-level `identityLock.enabled`) |
   * ABSENT/undefined (inherit the ref default). Honored only by the hybrid
   * resolver — there is no legacy entity resolver to make it inert on.
   */
  readonly lock?: boolean
  /** Byte offset into the source prompt — used to splice the token out. */
  readonly offset: number
}

/**
 * Parse a single `@<name-slug>:<index>[:<role>]` token. Returns null when the
 * token doesn't match a supported shape (the caller falls back to literal text).
 *
 * Segment count is 2 or 3 — NOT 2–4 like the character/location parsers. A wired
 * creature or object has no variant/bucket slot, so there is nothing for a 4th
 * segment to mean, and claiming one would let this parser swallow a character
 * token.
 */
export function parseEntityMentionToken(text: string): {
  entitySlug: string
  entityIndex: number
  /** Present ONLY for a 3-part token; omitted otherwise (shape rule). */
  role?: string
  /** Present ONLY when a sentinel was found; omitted otherwise (shape rule). */
  lock?: boolean
} | null {
  const parsed = parseMentionToken(text)
  if (!parsed) return null
  return {
    entitySlug: parsed.slug,
    entityIndex: parsed.index,
    ...(parsed.role !== undefined ? { role: parsed.role } : {}),
    ...(parsed.lock !== undefined ? { lock: parsed.lock } : {}),
  }
}

/**
 * Find every entity `@-mention` in a prompt whose slug is a known entity slug.
 *
 * `knownEntitySlugs` (from `knownEntitySlugsFromRefs`) is what keeps this parser
 * off the other grammars' tokens — every finder matches the same `@slug:N…`
 * surface and only the known-slug set separates them. Cross-kind precedence is
 * additionally enforced by pass ORDER at the resolver (see the module header).
 */
export function findEntityMentionTokens(
  prompt: string,
  knownEntitySlugs: readonly string[],
): EntityMentionTokenInfo[] {
  return findMentionTokens(prompt, knownEntitySlugs).map((t) => ({
    token: t.token,
    entitySlug: t.slug,
    entityIndex: t.index,
    ...(t.role !== undefined ? { role: t.role } : {}),
    ...(t.lock !== undefined ? { lock: t.lock } : {}),
    offset: t.offset,
  }))
}

/**
 * The mention slug a single reference contributes, or `null` when the ref cannot
 * carry an entity mention at all — the SINGLE gate, so every view of "which refs
 * are entity-mentionable" is the same view.
 *
 * Shared by `knownEntitySlugsFromRefs` (the finder's known-slug set) and the
 * prompt-builder's hybrid resolver (its slug → ref lookup map). Those two must
 * admit exactly the same refs: a slug the finder accepts but the resolver drops
 * would splice a token with nothing to bind, and a ref the resolver keys under a
 * slug no token can match is dead weight. Emptiness is NOT the gate (see
 * `MENTION_SLUG_PATTERN`) — a creature named "3-Eyed Raven" slugs to the truthy
 * but unparseable `"3-eyed-raven"`.
 *
 * `isExtraRef` refs are EXCLUDED, mirroring `imageMentionSlugForRef`: an extra
 * renders through the extras path with its own body line, so letting a mention
 * also bind one would double-emit prose.
 */
export function entityMentionSlugForRef(r: ConnectedReference): string | null {
  if (r.source !== "wired-creature" && r.source !== "wired-object") return null
  if (r.isExtraRef === true) return null
  if (!r.url || !r.defaultName) return null
  const slug = entityMentionSlug(r.defaultName)
  return MENTION_SLUG_PATTERN.test(slug) ? slug : null
}

/**
 * The known-entity-slug set for a reference list — the SINGLE source of truth for
 * the derivation, shared by `buildImagePrompt`'s Phase 0 and the backend
 * orchestrator's structured-branch gate so the two can never disagree about
 * whether a prompt carries a resolvable entity mention.
 *
 * UNFILTERED, exactly like `knownImageSlugsFromRefs` and the character/location
 * slug sets: every mentionable creature/object contributes its slug regardless of
 * what any OTHER kind may also claim. Cross-kind precedence is a property of the
 * resolver's pass order (character → location → image → creature → object), NOT
 * of this set — subtracting the earlier kinds' slugs here would put the
 * precedence rule in two places and let them drift.
 *
 * Creature and object share ONE set (and one resolver pass): the grammar, the
 * gate and the rendering are identical, and `defaultRoleForSource(r.source)`
 * already tells the two apart at phrase time. Their relative precedence is
 * settled where a tie can actually occur — the resolver's slug → ref map, built
 * creature-first.
 */
export function knownEntitySlugsFromRefs(
  refs: readonly ConnectedReference[],
): string[] {
  const out = new Set<string>()
  for (const r of refs) {
    const slug = entityMentionSlugForRef(r)
    if (slug) out.add(slug)
  }
  return [...out]
}
