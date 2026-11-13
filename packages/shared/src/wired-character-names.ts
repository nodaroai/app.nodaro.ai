import { characterMentionSlug } from "./character-mention-slug.js"
import { resolveEffectiveSourceType } from "./entity-image-handle.js"

/**
 * The label a new Character node is created with (its node definition's
 * `label` and `defaultData.label` read this constant). It is the node's TYPE
 * name, not a character's name: a node still carrying it is unnamed.
 */
export const CHARACTER_NODE_DEFAULT_LABEL = "Character Asset"

/**
 * Earlier defaults a Character node was created with, also read as "unnamed".
 * "Character" was the default label from 2026-02-03 until 2026-06-21, so the
 * graphs saved in that window carry it on every node nobody named.
 */
export const CHARACTER_NODE_RETIRED_DEFAULT_LABELS: readonly string[] = ["Character"]

/** An unnamed wired character is called this, then its number: "Character 1". */
export const UNNAMED_CHARACTER_NAME_PREFIX = "Character"

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

/**
 * The name a Character node was GIVEN: its `characterName`, else a label
 * someone typed, trimmed. A label equal to the default (or a retired default)
 * is no name, and neither is a value of only spaces, so an unnamed node
 * returns "". Never use it alone to name a WIRED character: two unnamed nodes
 * would both be "" — read {@link wiredCharacterNames} instead.
 */
export function characterOwnName(data: unknown): string {
  const d = (data ?? {}) as { readonly characterName?: unknown; readonly label?: unknown }
  const name = text(d.characterName)
  if (name) return name
  const label = text(d.label)
  if (!label || label === CHARACTER_NODE_DEFAULT_LABEL || CHARACTER_NODE_RETIRED_DEFAULT_LABELS.includes(label)) return ""
  return label
}

/** One wire into the consuming node, as {@link wiredCharacterNames} reads it. */
export interface WiredCharacterSource {
  /** The source node's id (the key of the returned map). */
  readonly key: string
  readonly type: string | null | undefined
  readonly sourceHandle?: string | null
  readonly data: unknown
}

/** What a wired Character node is called by the node it feeds. */
export interface WiredCharacterName {
  /** The name the model reads (the identity bullet, the subject's name). */
  readonly name: string
  /**
   * Its @-mention slug, never empty: the name slugified, or `character-N` for
   * a node numbered in the unnamed sequence (an unnamed node, or a typed name
   * with no Latin letter or digit such as "マヤ").
   */
  readonly slug: string
  /** True when the node had no name of its own (its name is "Character N"). */
  readonly unnamed: boolean
}

/**
 * The name and slug of every Character node wired into ONE consuming node, by
 * source key — the one rule the editor's Run, the workflow run and the editor's
 * panels all read, so they name the same characters the same way.
 *
 * - Only a wire that delivers a character counts (a Character node wired by
 *   its plain `image` pip is an image, not a character); a node wired twice
 *   counts once, at its first wire.
 * - A node with a name of its own ({@link characterOwnName}) keeps it. Two
 *   nodes with the same typed name are the same character, as before.
 * - Each unnamed node is its OWN character, numbered in wire order among the
 *   unnamed ones: "Character 1", "Character 2", …, skipping a number whose
 *   name (by slug) another wired character already has. Unnamed nodes are
 *   never merged.
 * - A typed name with a letter of another script ("マヤ", "מאיה", "마야",
 *   and a mixed one such as "マヤ1" or "マヤ A") is a real name: the model
 *   reads it as typed. Which character it is goes by the WHOLE name
 *   ({@link scriptNameKey}), never by the Latin part the slug can spell, so
 *   "マヤ1" and "レオ1" are two characters and "マヤ A" is not "A" (decided
 *   2026-11-13). Two nodes with the same such name are ONE character, as two
 *   "Maya" nodes are (decided 2026-11-12).
 * - Its mention key: the name's own slug when the name has one and no other
 *   wired character claims it ("マヤ A" alone stays `@a`); else — no slug
 *   ("マヤ"), or a slug another character also claims — the next number of
 *   the unnamed sequence (`character-N`), taken once per character, so it is
 *   included on every path and no two keys collide.
 * - A name whose letters are all Latin is keyed by its slug, exactly as before
 *   ("Maya", "maya" and "MAYA" are one character).
 *
 * `sources` are the consuming node's incoming wires in edge-array order.
 */
export function wiredCharacterNames(sources: readonly WiredCharacterSource[]): Map<string, WiredCharacterName> {
  const order: Array<{ key: string; own: string; identity: string; ownSlug: string }> = []
  const seen = new Set<string>()
  for (const s of sources) {
    if (seen.has(s.key) || resolveEffectiveSourceType(s.type, s.sourceHandle) !== "character") continue
    seen.add(s.key)
    const own = characterOwnName(s.data)
    order.push({ key: s.key, own, identity: characterIdentity(own) ?? `node:${s.key}`, ownSlug: characterMentionSlug(own) })
  }
  // Every character that would go by each slug: a Latin name always keeps its
  // own; another name keeps it only when it is the one character claiming it.
  const claims = new Map<string, Set<string>>()
  for (const { identity, ownSlug } of order) {
    if (!ownSlug) continue
    const set = claims.get(ownSlug) ?? new Set<string>()
    set.add(identity)
    claims.set(ownSlug, set)
  }
  const keepsOwnSlug = (identity: string, ownSlug: string): boolean =>
    !!ownSlug && (identity.startsWith(LATIN_IDENTITY) || claims.get(ownSlug)?.size === 1)
  const taken = new Set<string>()
  for (const { identity, ownSlug } of order) if (keepsOwnSlug(identity, ownSlug)) taken.add(ownSlug)
  const out = new Map<string, WiredCharacterName>()
  /** A character (by identity) → the `character-N` its first node took. */
  const numberedOf = new Map<string, string>()
  let next = 1
  for (const { key, own, identity, ownSlug } of order) {
    if (keepsOwnSlug(identity, ownSlug)) {
      out.set(key, { name: own, slug: ownSlug, unnamed: false })
      continue
    }
    const same = numberedOf.get(identity)
    if (same) {
      out.set(key, { name: own, slug: same, unnamed: false })
      continue
    }
    while (taken.has(numberedSlug(next))) next++
    const slug = numberedSlug(next)
    taken.add(slug)
    numberedOf.set(identity, slug)
    out.set(key, own ? { name: own, slug, unnamed: false } : { name: `${UNNAMED_CHARACTER_NAME_PREFIX} ${next}`, slug, unnamed: true })
    next++
  }
  return out
}

const LATIN_IDENTITY = "latin:"

/** A letter of a script other than Latin (accented Latin letters are Latin). */
const OTHER_SCRIPT_LETTER = /(?=\p{L})\P{Script=Latin}/u

/**
 * Which character a typed name is — two names with the same identity are one
 * character. A name whose letters are all Latin: its slug, exactly as before.
 * Any other name with a letter or digit: the whole name ({@link scriptNameKey}).
 * Undefined for no name, or one with no letter or digit at all ("!!!"): such a
 * node is a character of its own.
 */
function characterIdentity(name: string): string | undefined {
  const slug = characterMentionSlug(name)
  if (slug && !OTHER_SCRIPT_LETTER.test(name)) return `${LATIN_IDENTITY}${slug}`
  const key = scriptNameKey(name)
  return key ? `script:${key}` : undefined
}

const numberedSlug = (n: number): string => characterMentionSlug(`${UNNAMED_CHARACTER_NAME_PREFIX} ${n}`)

/**
 * When two typed names the slug cannot spell are the same name: the rule
 * {@link characterMentionSlug} applies to a Latin name ("Maya", "maya" and
 * "MAYA" are one; so are "Maya Lee" and "maya-lee"), over every script.
 * Unicode NFKC (half-width "ﾏﾔ" is "マヤ", a decomposed Hangul syllable is the
 * composed one), then case folded (Cyrillic "Мая" is "мая"), then every run of
 * characters that are no letter, digit or combining mark is one separator.
 * Marks stay: "ガ" is not "カ". "" for a name with no letter or digit at all
 * ("!!!"), which never matches another.
 */
function scriptNameKey(name: string): string {
  return name
    .normalize("NFKC")
    .toUpperCase()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * The slugs an unnamed character's mentions were written with before it was
 * numbered: its default label's ("Character Asset") and the retired default's
 * ("Character").
 */
export const RETIRED_CHARACTER_MENTION_SLUGS: readonly string[] = [
  characterMentionSlug(CHARACTER_NODE_DEFAULT_LABEL),
  ...CHARACTER_NODE_RETIRED_DEFAULT_LABELS.map(characterMentionSlug),
]

/**
 * A mention saved before unnamed characters were numbered — `@character-asset:1`,
 * `@character:2:smile`, any index, variant, mode or lock — read as the ONE
 * unnamed character wired into the node: its slug replaces the old one. With
 * no unnamed character, or two or more, the text is left as it is (it stays
 * plain text, as nothing resolves it), and so is a retired slug a wired
 * character really goes by. Both run paths apply it to the prompt before they
 * resolve its mentions.
 */
export function aliasRetiredCharacterMentions<T extends string | undefined>(
  text: T,
  names: ReadonlyMap<string, WiredCharacterName>,
): T {
  if (!text || !text.includes("@")) return text
  let lone: WiredCharacterName | undefined
  for (const n of names.values()) {
    if (!n.unnamed) continue
    if (lone) return text
    lone = n
  }
  if (!lone) return text
  const slugs = new Set([...names.values()].map((n) => n.slug))
  let out: string = text
  for (const retired of RETIRED_CHARACTER_MENTION_SLUGS) {
    if (slugs.has(retired)) continue
    // The mention grammar (findCharacterMentionTokens): `@` at the start or
    // after a non-alphanumeric, the slug, then the required `:<index>`.
    out = out.replace(new RegExp(`(^|[^a-zA-Z0-9])@${retired}(?=:\\d)`, "g"), `$1@${lone.slug}`)
  }
  return out as T
}

/**
 * {@link wiredCharacterNames} over a graph: the Character nodes wired into
 * `consumerId`, keyed by node id. Pass the edges the run reads (a wire leaving
 * a Teleport already re-pointed at its origin, as both run paths do).
 */
export function wiredCharacterNamesOf(
  consumerId: string,
  nodes: ReadonlyArray<{ readonly id: string; readonly type?: string | null; readonly data?: unknown }>,
  edges: ReadonlyArray<{ readonly source: string; readonly target: string; readonly sourceHandle?: string | null }>,
): Map<string, WiredCharacterName> {
  const byId = new Map(nodes.map((n) => [n.id, n] as const))
  const sources: WiredCharacterSource[] = []
  for (const e of edges) {
    if (e.target !== consumerId) continue
    const n = byId.get(e.source)
    if (!n) continue
    sources.push({ key: n.id, type: n.type, sourceHandle: e.sourceHandle, data: n.data })
  }
  return wiredCharacterNames(sources)
}

/**
 * The slug a Character node goes by for the node it feeds: its slug in
 * `names`; else — a node wired only by its plain `image` pip, which `names`
 * leaves out — the slug of the wired character that is the same name (the
 * same whole name is the same character, in any script); else a Latin name's
 * own slug, when no wired character of another identity goes by it; else "".
 */
export function wiredCharacterSlug(
  names: ReadonlyMap<string, WiredCharacterName>,
  nodeId: string,
  data: unknown,
): string {
  const wired = names.get(nodeId)?.slug
  if (wired) return wired
  const own = characterOwnName(data)
  const identity = characterIdentity(own)
  if (!identity) return ""
  // The wired character that IS this name (the same identity, in any script).
  for (const n of names.values()) {
    if (!n.unnamed && characterIdentity(n.name) === identity) return n.slug
  }
  // None: a Latin name still goes by its own slug — unless a wired character
  // of ANOTHER identity goes by it ("A" beside a wired "マヤ A", decided
  // 2026-11-13), which it must never be filed under.
  if (!identity.startsWith(LATIN_IDENTITY)) return ""
  const slug = characterMentionSlug(own)
  for (const n of names.values()) if (n.slug === slug) return ""
  return slug
}

/**
 * The key a Character node's OWN elements (held prop, styling, …) are filed
 * under for the node it feeds, so they land on that character's identity
 * bullet: the slug it goes by ({@link wiredCharacterSlug}); else a key of its
 * own that no character carries, so an unnamed node's elements are never
 * merged into another character's.
 */
export function wiredCharacterKey(
  names: ReadonlyMap<string, WiredCharacterName>,
  nodeId: string,
  data: unknown,
): string {
  return wiredCharacterSlug(names, nodeId, data) || `node:${nodeId}`
}

/** The wired character whose slug is `slug`, if any (first in wire order). */
export function wiredCharacterBySlug(
  names: ReadonlyMap<string, WiredCharacterName>,
  slug: string,
): { readonly key: string; readonly named: WiredCharacterName } | undefined {
  if (!slug) return undefined
  for (const [key, named] of names) if (named.slug === slug) return { key, named }
  return undefined
}

/**
 * The clip each Character node wired into `consumerId` carries as its VIDEO
 * subject (its `subjectVideoUrl`, a short single-shot clip of the character),
 * by the slug the node goes by ({@link wiredCharacterNamesOf}) — the key
 * `characterReferencesFromWired` groups a character by. Two nodes that are one
 * character (the same typed name) take the first node's clip, in wire order. A
 * node wired only by its plain `image` pip is no character and gives none.
 * Read it only for a model that takes video subjects.
 */
export function wiredCharacterVideoUrls(
  consumerId: string,
  nodes: ReadonlyArray<{ readonly id: string; readonly type?: string | null; readonly data?: unknown }>,
  edges: ReadonlyArray<{ readonly source: string; readonly target: string; readonly sourceHandle?: string | null }>,
): Map<string, string> {
  const byId = new Map(nodes.map((n) => [n.id, n] as const))
  const out = new Map<string, string>()
  for (const [id, named] of wiredCharacterNamesOf(consumerId, nodes, edges)) {
    const clip = (byId.get(id)?.data as { subjectVideoUrl?: unknown } | undefined)?.subjectVideoUrl
    if (typeof clip === "string" && clip.trim() && !out.has(named.slug)) out.set(named.slug, clip.trim())
  }
  return out
}
