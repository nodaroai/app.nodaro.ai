/** The five UGC node types (Cloud only; served by a private plugin). */
export const UGC_NODE_TYPES: ReadonlySet<string> = new Set(["ugc-creator", "ugc-script", "ugc-clips", "ugc-clip", "ugc-cards"])

/**
 * Per UGC type, the node-data keys that are a RUN's state, never a choice. A
 * published app's snapshot is readable by every runner, so publishing strips
 * them (the last plan, the clip tickets, the publisher's kept creator).
 */
export const UGC_NODE_RUN_STATE_KEYS: Readonly<Record<string, readonly string[]>> = {
  "ugc-creator": ["result", "keepResult", "ugcOutputs"],
  "ugc-script": ["result", "keepResult", "ugcOutputs"],
  "ugc-clips": ["result", "quote", "__listResults", "ugcOutputs"],
  "ugc-clip": ["warnings", "rerender", "__listResults", "__listResultMeta", "clipWarnings", "durationSec", "ugcOutputs"],
  "ugc-cards": ["result", "ugcOutputs"],
}

/**
 * The ONLY UGC keys a run request's `inputOverrides` may set — an allow-list,
 * so a run-state field added later is locked without anyone listing it.
 *
 * No UGC type may gain a `LEGACY_EXPOSED_FIELD_KEYS` row: the lock reads the
 * stored key, before that table renames it.
 */
export const UGC_OVERRIDABLE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  "ugc-creator": ["source", "gender", "photoUrl"],
  "ugc-script": ["targetDurationSec"],
  "ugc-clips": [],
  "ugc-clip": [],
  "ugc-cards": [],
}

const KEEP_RESULT_TYPES: ReadonlySet<string> = new Set(["ugc-creator", "ugc-script"])

/** A copy of `nodes` with every UGC node's run state removed (and `keepResult: false`). Other nodes are returned as they are. */
export function stripUgcRunState<T extends { type?: unknown; data?: unknown }>(nodes: readonly T[]): T[] {
  return nodes.map((node) => {
    const type = typeof node.type === "string" ? node.type : ""
    if (!UGC_NODE_TYPES.has(type) || !node.data || typeof node.data !== "object") return node
    const data: Record<string, unknown> = { ...(node.data as Record<string, unknown>) }
    for (const key of UGC_NODE_RUN_STATE_KEYS[type] ?? []) delete data[key]
    if (KEEP_RESULT_TYPES.has(type)) data.keepResult = false
    return { ...node, data }
  })
}

/** Every override entry that would set a non-overridable key on a UGC node, in node then key order. Pure. */
export function findUgcLockedFields(
  nodes: ReadonlyArray<{ id: string; type?: string }> | null | undefined,
  inputOverrides: Record<string, Record<string, unknown>> | null | undefined,
): Array<{ nodeId: string; nodeType: string; field: string }> {
  if (!nodes || !inputOverrides) return []
  const found: Array<{ nodeId: string; nodeType: string; field: string }> = []
  for (const node of nodes) {
    const type = node?.type
    if (typeof type !== "string" || !UGC_NODE_TYPES.has(type)) continue
    const allowed = UGC_OVERRIDABLE_FIELDS[type] ?? []
    const fields = inputOverrides[node.id]
    if (!fields || typeof fields !== "object") continue
    for (const field of Object.keys(fields)) {
      if (!allowed.includes(field)) found.push({ nodeId: String(node.id), nodeType: type, field })
    }
  }
  return found
}
