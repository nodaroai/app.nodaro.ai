/** The five UGC node types (Cloud only; served by a private plugin). */
export const UGC_NODE_TYPES: ReadonlySet<string> = new Set(["ugc-creator", "ugc-script", "ugc-clips", "ugc-clip", "ugc-cards"])

/** UGC Creator: the node-data key that holds a round's passing candidates until the person picks one (run state). */
export const UGC_CREATOR_CANDIDATES_KEY = "candidates"

/** A run that would execute a UGC Creator whose options wait for the person's pick. */
export const UGC_PICK_FIRST_MESSAGE = "Pick a creator first."

/**
 * Per UGC type, the node-data keys that are a RUN's state, never a choice. A
 * published app's snapshot is readable by every runner, so publishing strips
 * them (the last plan, the clip tickets, the publisher's kept creator).
 *
 * UGC Creator's image (`generatedImageUrl`) goes from every creator, whatever its
 * source: after a My photo run it IS the author's photo, and a creator switched
 * to another source after such a run, or whose photo was removed, still holds it.
 * UGC Clip's takes and UGC Cards' Notes (`generatedText`, and `text`, the Notes
 * as a run hands them on) are the author's renders: a published node starts empty.
 *
 * A published snapshot is stripped through `stripUgcPublishState`
 * (@nodaro/render-rules), which also empties every run result a lane writes under
 * a generic name, every node made from the UGC video, and every node on a path
 * into a UGC Creator's photo input.
 */
export const UGC_NODE_RUN_STATE_KEYS: Readonly<Record<string, readonly string[]>> = {
  "ugc-creator": ["result", "keepResult", "ugcOutputs", UGC_CREATOR_CANDIDATES_KEY, "optionFailed", "generatedImageUrl"],
  // `exampleLines`: a template's example run, shown until the node's own first script (display only).
  "ugc-script": ["result", "keepResult", "ugcOutputs", "exampleLines"],
  "ugc-clips": ["result", "quote", "__listResults", "ugcOutputs"],
  "ugc-clip": [
    "warnings", "rerender", "rerenderPending", "__listResults", "__listResultMeta", "clipWarnings", "durationSec", "ugcOutputs",
    "generatedVideoUrl", "generatedResults", "activeResultIndex",
  ],
  "ugc-cards": ["result", "ugcOutputs", "generatedText", "text"],
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

/** UGC Creator holds options for the person to pick: the ones a run drew, or the ones a credits stop kept. */
export function ugcPickPending(data: unknown): boolean {
  const candidates = data && typeof data === "object" ? (data as Record<string, unknown>)[UGC_CREATOR_CANDIDATES_KEY] : undefined
  return Array.isArray(candidates) && candidates.length > 0
}

/**
 * A run that would execute a UGC Creator whose options wait is refused ("Pick a creator first."),
 * except that creator's own re-draw. One rule for the editor's check before a run and the
 * orchestrator's.
 */
export function ugcRunWaitsForPick(
  runNodes: ReadonlyArray<{ readonly id: string; readonly type?: string | null; readonly data?: unknown }>,
  opts: { readonly redrawId?: string } = {},
): boolean {
  return runNodes.some((n) => n.type === "ugc-creator" && n.id !== opts.redrawId && ugcPickPending(n.data))
}

/**
 * Per UGC type, the author's own content a published snapshot never carries: UGC Creator's photo
 * of a person (`photoUrl`). A choice, not run state — so it stays on the author's own workflow —
 * but a runner gives their own photo (or the run is refused for want of one) and a template's
 * cloner adds theirs.
 */
export const UGC_PUBLISH_PRIVATE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  "ugc-creator": ["photoUrl"],
}

/**
 * The UGC types' own strip: a copy of `nodes` with every UGC node's run state and the author's own
 * photo removed (and `keepResult: false`). Other nodes are returned as they are. Publishing, a
 * share link's view and a viewer's run go through `stripUgcPublishState` (@nodaro/render-rules),
 * which starts here.
 */
export function stripUgcRunState<T extends { type?: unknown; data?: unknown }>(nodes: readonly T[]): T[] {
  return nodes.map((node) => {
    const type = typeof node.type === "string" ? node.type : ""
    if (!UGC_NODE_TYPES.has(type) || !node.data || typeof node.data !== "object") return node
    const data: Record<string, unknown> = { ...(node.data as Record<string, unknown>) }
    for (const key of UGC_NODE_RUN_STATE_KEYS[type] ?? []) delete data[key]
    for (const key of UGC_PUBLISH_PRIVATE_FIELDS[type] ?? []) delete data[key]
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
