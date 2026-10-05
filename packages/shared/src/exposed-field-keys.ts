/**
 * Exposed-field keys that were renamed to the node's real data field.
 *
 * A published app stores which fields it exposes as `{ type: "field", nodeId, field }` items in its
 * immutable snapshot settings, and external callers send `inputOverrides[nodeId][field]` with that same
 * string — it is part of the public wire contract (docs/embed-app-guide.md). Renaming a descriptor's key
 * must not strand the apps already published with the old spelling: they keep that string forever, so every
 * place that turns a stored key into a node-data key — or compares it with a descriptor key — goes through
 * `canonicalExposedFieldKey`.
 *
 * CLOSED LIST. A row needs a spelling that was published (a card that existed in apps) and a target the
 * node's descriptor now declares (the frontend guard `exposable-field-keys.test.ts` checks both). Only list a
 * field whose card cannot carry `allowedValues` (slider / toggle / text / color): the server validates
 * `allowedValues` against the stored key (backend routes/app-runner.ts `validateRestrictedFields`). Never list
 * a field of an outbound node type: the run-request override lock (backend lib/input-override-lock.ts) reads
 * the stored key, before this table renames it.
 */
export const LEGACY_EXPOSED_FIELD_KEYS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // Published as the Text to Speech slider's key. The node's data field, and every runner, route and config
  // panel, has always been `similarityBoost` — so the slider moved nothing.
  "text-to-speech": { similarity: "similarityBoost" },
}

/** The node-data key an exposed field's stored key stands for. Unknown node types and keys pass through. */
export function canonicalExposedFieldKey(nodeType: string | undefined, key: string): string {
  if (typeof nodeType !== "string" || !Object.hasOwn(LEGACY_EXPOSED_FIELD_KEYS, nodeType)) return key
  const renames = LEGACY_EXPOSED_FIELD_KEYS[nodeType]!
  return Object.hasOwn(renames, key) ? renames[key]! : key
}

/**
 * The override map with every legacy spelling replaced by its current key. When the caller sent both
 * spellings the current one wins (it is their current intent) and the legacy key is dropped — a dead key
 * is never written to node data. Returns the same object when nothing renames; never mutates.
 */
export function canonicalizeOverrideKeys(
  nodeType: string | undefined,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  let out: Record<string, unknown> | undefined
  for (const key of Object.keys(overrides)) {
    const current = canonicalExposedFieldKey(nodeType, key)
    if (current === key) continue
    out ??= { ...overrides }
    delete out[key]
    if (!Object.hasOwn(overrides, current)) out[current] = overrides[key]
  }
  return out ?? overrides
}
