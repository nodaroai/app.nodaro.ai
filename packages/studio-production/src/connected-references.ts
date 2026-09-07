import type { ConnectedReference } from "@nodaro/shared"

/**
 * Reading a persisted `references` blob back into bound `@`-entity chips.
 *
 * A LEAF (its only import is a type): the same blob is read from a still
 * result, a clip result, a shot's beats and a scene's PLAN — and the plan's
 * reader (`lib/scene-plan`) must load under node, so the rule cannot live in
 * `shot-graph` beside its other narrowers.
 */

/** Narrow an unknown field to a non-empty string, else undefined. */
const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined

/**
 * Read a persisted `references` blob → {@link ConnectedReference}[]: the bound
 * `@`-entity chips (characters / locations / props) of a prompt. Serializing
 * them (Nodaro ignores the extra field) lets the chips REBUILD on a project
 * reload instead of degrading to flat text. Each entry must carry the core
 * identity fields (id / defaultName / source); the rich optional fields
 * (canonical descriptions, slugs, `url`) ride along verbatim so a re-generate
 * still folds them server-side. Untrusted blob — entries missing a core field
 * are dropped; `undefined` when none survive so a chip-less result stays
 * byte-identical (the round-trip invariant).
 */
export function readReferences(value: unknown): ConnectedReference[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: ConnectedReference[] = []
  for (const r of value) {
    if (typeof r !== "object" || r === null) continue
    const rec = r as Record<string, unknown>
    const id = readString(rec.id)
    const defaultName = readString(rec.defaultName)
    const source = readString(rec.source)
    if (!id || !defaultName || !source) continue
    // Preserve the rich fields verbatim, with the core identity re-pinned + a string
    // `url` (ConnectedReference requires it; default "" keeps a portrait-less chip).
    out.push({
      ...rec,
      id,
      defaultName,
      source,
      url: typeof rec.url === "string" ? rec.url : "",
    } as ConnectedReference)
  }
  return out.length ? out : undefined
}
