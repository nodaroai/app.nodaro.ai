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
 * turn; none present = at the end). An anchor must name something: a key
 * here, or one of `elsewhere` (a node type this record carries no row for).
 * One that names nothing throws — a typo or a renamed anchor must never
 * silently move a unit to the end. Units placed at the same key keep type
 * order. A cycle among units throws. With nothing to add it returns `legacy`
 * itself.
 */
export function composeRecordAfter<V>(
  what: string,
  legacy: Record<string, V>,
  units: ReadonlyArray<{ readonly type: string; readonly anchors: ReadonlyArray<string | null | undefined>; readonly value: V }>,
  elsewhere: ReadonlySet<string> = new Set(),
): Record<string, V> {
  if (units.length === 0) return legacy
  assertDisjoint(what, Object.keys(legacy), units.map((u) => u.type))
  const unitTypes = new Set(units.map((u) => u.type))
  const nowhere = units.flatMap((u) => u.anchors
    .filter((a): a is string => typeof a === "string" && !Object.hasOwn(legacy, a) && !unitTypes.has(a) && !elsewhere.has(a))
    .map((a) => `${u.type}'s anchor "${a}"`))
  if (nowhere.length) throw new Error(`${what}: ${nowhere.join(", ")} names nothing — not a key here, nor a known name outside it`)
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
 * option of its `picker.after`. A unit first in its family (picker.after null)
 * is placed after its `position.after`, as TARGET_HANDLE_ACCEPTS places it —
 * never first in the whole list. `optionOf` builds a unit's entry (its
 * option.tsx icon + unit.json picker); a unit with no picker entry
 * (`picker: null`) is not offered. A place that names no option (nor a picker
 * unit) throws at load rather than moving the unit silently ("has no add-node
 * option" — gen:units refuses it before that).
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
  // The validator refuses this first (tools/units/manifest.mjs); this is the backstop.
  for (const u of picked) {
    const anchor = u.position.after
    if (u.picker?.after === null && anchor !== null && !byType.has(anchor)) {
      throw new Error(`${u.type}: picker.after is null (first in its family), so the add-node list places it after position.after "${anchor}" — which has no add-node option`)
    }
  }
  const order = insertAtPositions(legacy.map((o) => o.type), picked.map((u) => ({ type: u.type, after: u.picker?.after ?? u.position.after })))
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

/**
 * The editor's price mirror rows of every unit (its `priceRows`, every
 * staticCosts row of its price.ee.ts), merged — a credit id priced by two
 * units is refused. The editor twin of unitStaticCosts (backend/src/lib/unit-compose.ts).
 */
export function unitPriceRows(units: ReadonlyArray<UnitDefinition>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const u of units) {
    for (const [id, credits] of Object.entries(u.priceRows)) {
      if (Object.hasOwn(out, id)) throw new Error(`${u.type}: credit id "${id}" is priced by another unit too`)
      out[id] = credits
    }
  }
  return out
}

/** The units that declare `capability` (tools/units/capabilities.mjs). */
export const unitsWith = (units: ReadonlyArray<UnitDefinition>, capability: string): string[] =>
  units.filter((u) => u.capabilities.includes(capability)).map((u) => u.type)

/** HANDLE_OUTPUT_TYPES rows: each output pip → what it carries; a runtime-typed pip (its medium decided per run) has none. */
export const unitOutputTypes = (u: UnitDefinition): Partial<Record<string, UnitHandleKind>> =>
  Object.fromEntries(u.handles.outputs.filter((h) => !h.runtimeTyped).map((h) => [h.id, h.kind]))

/** Units whose primary output (the first — what an edge naming no pip reads) is text. */
export const unitTextSources = (units: ReadonlyArray<UnitDefinition>): string[] =>
  units.filter((u) => u.handles.outputs[0]?.kind === "text").map((u) => u.type)

/** Units with a JSON (look) output. */
export const unitJsonProducers = (units: ReadonlyArray<UnitDefinition>): string[] =>
  units.filter((u) => u.handles.outputs.some((h) => h.kind === "look")).map((u) => u.type)

/** Gallery units (a Generate or Run button) whose outputs carry no medium. */
export const unitNoMediumResults = (units: ReadonlyArray<UnitDefinition>): string[] => units
  .filter((u) => (u.capabilities.includes("panel:generate-button") || u.capabilities.includes("panel:run-button"))
    && !u.handles.outputs.some((h) => h.kind === "video" || h.kind === "audio" || h.kind === "image"))
  .map((u) => u.type)

/** `types` with the members of `order` re-sorted into that order in the slots they hold; any other type keeps its slot. */
function sortMembersInPlace(types: ReadonlyArray<string>, order: ReadonlyArray<string>): string[] {
  const rank = new Map(order.map((t, i) => [t, i]))
  const slots = types.flatMap((t, i) => (rank.has(t) ? [i] : []))
  const members = slots.map((i) => types[i] as string).sort((a, b) => (rank.get(a) as number) - (rank.get(b) as number))
  const out = [...types]
  slots.forEach((slot, k) => { out[slot] = members[k] as string })
  return out
}

/** TAB_SUPERSET rows: tab → family → its units shown there too (picker.alsoOnTabs), in family order. */
export function unitTabSuperset(units: ReadonlyArray<UnitDefinition>, familyTypes: (familyId: string) => ReadonlyArray<string>): Record<string, Record<string, string[]>> {
  const out: Record<string, Record<string, string[]>> = {}
  for (const u of [...units].sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))) {
    const family = u.picker?.family
    if (family === undefined) continue
    for (const tab of u.picker?.alsoOnTabs ?? []) {
      const row = (out[tab] ??= {})
      row[family] = [...(row[family] ?? []), u.type]
    }
  }
  for (const [tab, row] of Object.entries(out)) {
    for (const [family, types] of Object.entries(row)) out[tab]![family] = sortMembersInPlace(types, familyTypes(family))
  }
  return out
}

/**
 * TAB_SUPERSET: the legacy table with each unit row merged in. A unit list for
 * a [tab][family] the legacy table also has is appended after the legacy
 * members, then the family's own members are put in family order — a type the
 * table shows from ANOTHER family (Text beside the uploads) keeps its slot.
 * So in a row that holds another family's type at its end (a "Text closes the
 * family" row), a unit lands after that type: members re-sort only within the
 * slots they already hold, and the unit's is the new last one.
 * With no unit row it returns `legacy` itself; a type listed by both is refused.
 */
export function composeTabSuperset<T extends string>(
  legacy: Readonly<Record<string, Readonly<Record<string, ReadonlyArray<T>>>>>,
  unitRows: Readonly<Record<string, Readonly<Record<string, ReadonlyArray<string>>>>>,
  familyTypes: (familyId: string) => ReadonlyArray<string>,
): Readonly<Record<string, Readonly<Record<string, ReadonlyArray<T>>>>> {
  if (Object.keys(unitRows).length === 0) return legacy
  const out: Record<string, Record<string, ReadonlyArray<T>>> = Object.fromEntries(Object.entries(legacy).map(([tab, row]) => [tab, { ...row }]))
  for (const [tab, row] of Object.entries(unitRows)) {
    const merged = (out[tab] ??= {})
    for (const [family, types] of Object.entries(row)) {
      const own = merged[family] ?? []
      assertDisjoint(`TAB_SUPERSET.${tab}.${family}`, own, types)
      // A unit's type is a UnitNodeType, a member of the table's type union (SceneNodeType).
      merged[family] = sortMembersInPlace([...own, ...types], familyTypes(family)) as T[]
    }
  }
  return out
}

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
