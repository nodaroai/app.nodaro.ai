// frontend/src/lib/unit-compose.ts — the pure functions every editor registry
// composes its node units with (§5.8 B, decided 2026-10-16;
// tools/units/README.md): `registry = legacy ∪ units`, a type in exactly one
// of the two. Pure and aggregate-free — each composer passes its legacy table
// and the unit collection in — so frontend/src/lib/__tests__/unit-compose.test.ts
// proves every seam on an in-memory fixture unit, and an EMPTY unit
// collection returns every legacy table unchanged.
import type { NodeOption } from "@/lib/node-compatibility"
import type { NodeTypeDefinition, SceneNodeData, SceneNodeType } from "@/types/nodes"
import type { UnitDefinition, UnitHandleKind, UnitLabels } from "@/nodes/kit"

/**
 * `base` (the legacy order) with each unit inserted right after the type its
 * `after` names (null = first). Units naming the same place keep type order;
 * a unit may follow another unit. The TypeScript twin of `insertAtPositions`
 * in tools/units/manifest.mjs (gen:skills orders the catalog with that one) —
 * unit-compose.test.ts holds the two to the same answers.
 */
export function insertAtPositions(base: ReadonlyArray<string>, units: ReadonlyArray<{ readonly type: string; readonly after: string | null }>): string[] {
  const known = new Set([...base, ...units.map((u) => u.type)])
  const byAnchor = new Map<string | null, string[]>()
  for (const u of [...units].sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))) {
    const anchor = u.after ?? null
    if (anchor !== null && !known.has(anchor)) throw new Error(`${u.type}: position.after "${anchor}" is not a node type`)
    byAnchor.set(anchor, [...(byAnchor.get(anchor) ?? []), u.type])
  }
  const out: string[] = []
  const placed = new Set<string>()
  const place = (type: string) => {
    out.push(type)
    placed.add(type)
    for (const t of byAnchor.get(type) ?? []) place(t)
  }
  for (const t of byAnchor.get(null) ?? []) place(t)
  for (const t of base) place(t)
  const unplaced = units.map((u) => u.type).filter((t) => !placed.has(t))
  if (unplaced.length) throw new Error(`position.after forms a cycle among units: ${unplaced.join(", ")}`)
  return out
}

/** Throws when a unit type is also a legacy key: a node type lives in exactly one place (G1). */
function assertDisjoint(what: string, legacy: Iterable<string>, units: Iterable<string>): void {
  const seen = new Set(legacy)
  const both = [...units].filter((t) => seen.has(t))
  if (both.length) throw new Error(`${what}: ${both.join(", ")} is both a legacy entry and a node unit — a type lives in exactly one place`)
}

/**
 * `legacy` with `additions` merged in after it. With nothing to add it returns
 * `legacy` itself — the same object, so a mutable table (one a plugin
 * registers into) keeps its identity.
 */
export function composeRecord<V>(what: string, legacy: Record<string, V>, additions: Readonly<Record<string, V>>): Record<string, V> {
  const keys = Object.keys(additions)
  if (keys.length === 0) return legacy
  assertDisjoint(what, Object.keys(legacy), keys)
  return { ...legacy, ...additions }
}

/**
 * An ORDERED record (one whose key order a user sees — the handle popover's
 * candidates): `legacy` in its order with each unit's row placed right after
 * the first of its `anchors` that is a key here — a legacy key or another
 * unit of this composition, so a unit may follow a unit (anchors are tried in
 * turn; none present = at the end). Units placed at the same key keep type
 * order. A cycle among units throws. With nothing to add it returns `legacy`
 * itself.
 */
export function composeRecordAfter<V>(
  what: string,
  legacy: Record<string, V>,
  units: ReadonlyArray<{ readonly type: string; readonly anchors: ReadonlyArray<string | null | undefined>; readonly value: V }>,
): Record<string, V> {
  if (units.length === 0) return legacy
  assertDisjoint(what, Object.keys(legacy), units.map((u) => u.type))
  const unitTypes = new Set(units.map((u) => u.type))
  const isKey = (k: string, self: string) => k !== self && (Object.hasOwn(legacy, k) || unitTypes.has(k))
  const at = new Map<string, Array<{ type: string; value: V }>>()
  const end: Array<{ type: string; value: V }> = []
  for (const u of [...units].sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))) {
    const anchor = u.anchors.find((a): a is string => typeof a === "string" && isKey(a, u.type))
    if (anchor === undefined) end.push(u)
    else at.set(anchor, [...(at.get(anchor) ?? []), u])
  }
  const out: Record<string, V> = {}
  const place = (key: string, value: V) => {
    out[key] = value
    for (const u of at.get(key) ?? []) place(u.type, u.value)
  }
  for (const k of Object.keys(legacy)) place(k, legacy[k] as V)
  for (const u of end) place(u.type, u.value)
  const unplaced = units.map((u) => u.type).filter((t) => !Object.hasOwn(out, t))
  if (unplaced.length) throw new Error(`${what}: the units' anchors form a cycle: ${unplaced.join(", ")}`)
  return out
}

/** `legacy` plus `additions`, legacy order first. With nothing to add it returns `legacy` itself. */
export function composeSet<T extends string>(what: string, legacy: ReadonlySet<T>, additions: Iterable<T>): Set<T> & ReadonlySet<T> {
  const extra = [...additions]
  if (extra.length === 0) return legacy as Set<T>
  assertDisjoint(what, legacy, extra)
  return new Set([...legacy, ...extra])
}

/** A unit's definition as NODE_DEFINITIONS carries it. */
export function toNodeTypeDefinition(u: UnitDefinition): NodeTypeDefinition {
  return {
    // G1 guarantees the type is a UnitNodeType (the aggregate's own union).
    type: u.type as SceneNodeType,
    label: u.label,
    category: u.category,
    inputs: u.inputs,
    outputs: u.outputs,
    // A unit's types.ts interface is in SceneNodeData through UnitNodeData.
    defaultData: u.defaultData as unknown as SceneNodeData,
  }
}

/** NODE_DEFINITIONS: the legacy literal with each unit at its `position.after`. */
export function composeNodeDefinitions(legacy: ReadonlyArray<NodeTypeDefinition>, units: ReadonlyArray<UnitDefinition>): ReadonlyArray<NodeTypeDefinition> {
  if (units.length === 0) return legacy
  assertDisjoint("NODE_DEFINITIONS", legacy.map((d) => d.type), units.map((u) => u.type))
  const byType = new Map<string, NodeTypeDefinition>([...legacy.map((d) => [d.type, d] as const), ...units.map((u) => [u.type, toNodeTypeDefinition(u)] as const)])
  const order = insertAtPositions(legacy.map((d) => d.type), units.map((u) => ({ type: u.type, after: u.position.after })))
  return order.map((t) => byType.get(t) as NodeTypeDefinition)
}

/**
 * NODE_OPTIONS: the legacy options with each picker unit right after the
 * option of its `picker.after` (null = first). `optionOf` builds a unit's
 * entry (its option.tsx icon + unit.json picker); a unit with no picker entry
 * (`picker: null`) is not offered.
 */
export function composeNodeOptions(
  legacy: ReadonlyArray<NodeOption>,
  units: ReadonlyArray<UnitDefinition>,
  optionOf: (u: UnitDefinition) => NodeOption,
): ReadonlyArray<NodeOption> {
  const picked = units.filter((u) => u.picker !== null)
  if (picked.length === 0) return legacy
  assertDisjoint("NODE_OPTIONS", legacy.map((o) => o.type), picked.map((u) => u.type))
  const byType = new Map<string, NodeOption>([...legacy.map((o) => [o.type, o] as const), ...picked.map((u) => [u.type, optionOf(u)] as const)])
  const order = insertAtPositions(legacy.map((o) => o.type), picked.map((u) => ({ type: u.type, after: u.picker?.after ?? null })))
  return order.map((t) => byType.get(t) as NodeOption)
}

/**
 * A family's `types` with every unit of that family inserted at its
 * `picker.after`, which must be a member of the same family (or null = first):
 * the family header renders its types in this order.
 */
export function composeFamilyTypes<T extends string>(familyId: string, legacy: ReadonlyArray<T>, units: ReadonlyArray<UnitDefinition>): ReadonlyArray<T> {
  const own = units.filter((u) => u.picker?.family === familyId)
  if (own.length === 0) return legacy
  assertDisjoint(`family ${familyId}`, legacy, own.map((u) => u.type))
  const members = new Set([...legacy, ...own.map((u) => u.type)])
  for (const u of own) {
    const after = u.picker?.after ?? null
    if (after !== null && !members.has(after)) throw new Error(`${u.type}: picker.after "${after}" is not in family ${familyId} — a unit follows a type of its own family (or null for first)`)
  }
  // A unit's type is a UnitNodeType, a member of the family's type union (SceneNodeType).
  return insertAtPositions(legacy, own.map((u) => ({ type: u.type, after: u.picker?.after ?? null }))) as T[]
}

/** Unit type → `make(unit)`, for every unit `make` answers (undefined = not a member). */
export function unitRecord<V>(units: ReadonlyArray<UnitDefinition>, make: (u: UnitDefinition) => V | undefined): Record<string, V> {
  const out: Record<string, V> = {}
  for (const u of units) {
    const v = make(u)
    if (v !== undefined) out[u.type] = v
  }
  return out
}

/** The units that declare `capability` (tools/units/capabilities.mjs). */
export const unitsWith = (units: ReadonlyArray<UnitDefinition>, capability: string): string[] =>
  units.filter((u) => u.capabilities.includes(capability)).map((u) => u.type)

/** HANDLE_OUTPUT_TYPES rows: each output handle id → what it carries. */
export const unitOutputTypes = (u: UnitDefinition): Partial<Record<string, UnitHandleKind>> =>
  Object.fromEntries(u.handles.outputs.map((h) => [h.id, h.kind]))

/**
 * A unit's output, read the way every media node's is: an output handle
 * (the one named, else the first) whose `from` names the node-data field; a
 * media output prefers the ACTIVE generated result's url (the take the node
 * shows), as the legacy video nodes do. Undefined when it has no such output.
 */
export function unitOutputValue(u: UnitDefinition, data: Readonly<Record<string, unknown>>, sourceHandle?: string): string | undefined {
  const outputs = u.handles.outputs
  const h = (sourceHandle ? outputs.find((o) => o.id === sourceHandle) : undefined) ?? outputs[0]
  if (!h?.from) return undefined
  const field = data[h.from]
  if (h.kind === "video" || h.kind === "image" || h.kind === "audio") {
    // Exactly the legacy media read (execution-graph.ts extractNodeOutput):
    // `activeResultIndex ?? 0`, the active result's url when it is not nullish
    // (an empty one included), else the field as stored.
    const results = (data.generatedResults as ReadonlyArray<{ url?: string }> | undefined) ?? []
    const active = (data.activeResultIndex as number | undefined) ?? 0
    return results[active]?.url ?? (field as string | undefined)
  }
  return typeof field === "string" && field ? field : undefined
}

/** The node-label tables' unit rows, by app locale ("pt-br" in strings.json is "pt-BR"). */
export function unitNodeLabels(labels: ReadonlyArray<UnitLabels>): Partial<Record<"he" | "ja" | "ko" | "pt-BR", Record<string, string>>> {
  const out: Partial<Record<"he" | "ja" | "ko" | "pt-BR", Record<string, string>>> = {}
  for (const table of labels) {
    for (const [label, byLocale] of Object.entries(table)) {
      for (const [locale, text] of Object.entries(byLocale)) {
        if (!text) continue
        const id = locale === "pt-br" ? "pt-BR" : (locale as "he" | "ja" | "ko")
        out[id] = { ...(out[id] ?? {}), [label]: text }
      }
    }
  }
  return out
}
