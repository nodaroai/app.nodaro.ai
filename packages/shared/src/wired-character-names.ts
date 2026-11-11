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
 * - A typed name the slug cannot spell ("マヤ", "מאיה", "마야" — no Latin
 *   letter or digit) is a real name: the model reads it as typed, and the node
 *   takes the next number of the same sequence as its key (`character-N`), so
 *   it is included on every path and no two keys collide.
 *
 * `sources` are the consuming node's incoming wires in edge-array order.
 */
export function wiredCharacterNames(sources: readonly WiredCharacterSource[]): Map<string, WiredCharacterName> {
  const order: Array<{ key: string; own: string }> = []
  const seen = new Set<string>()
  for (const s of sources) {
    if (seen.has(s.key) || resolveEffectiveSourceType(s.type, s.sourceHandle) !== "character") continue
    seen.add(s.key)
    order.push({ key: s.key, own: characterOwnName(s.data) })
  }
  const taken = new Set<string>()
  for (const { own } of order) {
    const slug = characterMentionSlug(own)
    if (slug) taken.add(slug)
  }
  const out = new Map<string, WiredCharacterName>()
  let next = 1
  for (const { key, own } of order) {
    const ownSlug = characterMentionSlug(own)
    if (ownSlug) {
      out.set(key, { name: own, slug: ownSlug, unnamed: false })
      continue
    }
    while (taken.has(numberedSlug(next))) next++
    const slug = numberedSlug(next)
    taken.add(slug)
    out.set(key, own ? { name: own, slug, unnamed: false } : { name: `${UNNAMED_CHARACTER_NAME_PREFIX} ${next}`, slug, unnamed: true })
    next++
  }
  return out
}

const numberedSlug = (n: number): string => characterMentionSlug(`${UNNAMED_CHARACTER_NAME_PREFIX} ${n}`)

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
 * The key a Character node's OWN elements (held prop, styling, …) are filed
 * under for the node it feeds, so they land on that character's identity
 * bullet: its slug in `names`; else — a node wired only by its plain `image`
 * pip, which `names` leaves out — its own name's slug (the same typed name is
 * the same character); else a key of its own that no character carries, so an
 * unnamed node's elements are never merged into another character's.
 */
export function wiredCharacterKey(
  names: ReadonlyMap<string, WiredCharacterName>,
  nodeId: string,
  data: unknown,
): string {
  return names.get(nodeId)?.slug || characterMentionSlug(characterOwnName(data)) || `node:${nodeId}`
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
