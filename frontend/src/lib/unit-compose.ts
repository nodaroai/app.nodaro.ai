// frontend/src/lib/unit-compose.ts — the pure functions every editor registry
// composes its node units with (§5.8 B, decided 2026-10-16;
// tools/units/README.md): `registry = legacy ∪ units`, a type in exactly one
// of the two. Pure and aggregate-free — each composer passes its legacy table
// and the unit collection in — so frontend/src/lib/__tests__/unit-compose.test.ts
// proves every seam on an in-memory fixture unit, and an EMPTY unit
// collection returns every legacy table unchanged.
import { unitBatchSideOutputs, type UnitSideOutputsRow } from "@nodaro/render-rules"
import type { NodeOption } from "@/lib/node-compatibility"
import type { NodeTypeDefinition, SceneNodeData, SceneNodeType } from "@/types/nodes"
import type { UnitDefinition, UnitHandleKind, UnitLabels, UnitOutputHandle, UnitProducerKind } from "@/nodes/kit"

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

/** The units whose output is `kind` (`contract.producer` of unit.json); a "dynamic" unit is never one of a single medium. */
export const unitProducers = (units: ReadonlyArray<UnitDefinition>, kind: UnitProducerKind): string[] =>
  units.filter((u) => u.producer === kind).map((u) => u.type)

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

/** The output a wire leaving pip `sourceHandle` reads: the one named, else the first (an edge naming no pip, or one the unit lacks). */
export function unitOutputPip(u: UnitDefinition, sourceHandle: string | null | undefined): UnitOutputHandle | undefined {
  const outputs = u.handles.outputs
  return (sourceHandle ? outputs.find((o) => o.id === sourceHandle) : undefined) ?? outputs[0]
}

const MEDIA_KINDS: ReadonlySet<string> = new Set(["video", "image", "audio"])
const isPlainMedia = (h: UnitOutputHandle | undefined): boolean => h !== undefined && MEDIA_KINDS.has(h.kind) && h.list !== true

/**
 * A unit's SIDE outputs (decided 2026-11-11; tools/units/json-output-rules.mjs):
 * the list outputs (`list: true`) and JSON (look) outputs that stand beside its
 * media take, which is its first output, a plain media output. A run lands the
 * take, then these beside it — on the node and on the take — so each take keeps
 * the side outputs it was made with. Empty for every other unit: a JSON-only
 * worker, a media-only one, a use case.
 */
export function unitSideOutputs(u: UnitDefinition): UnitOutputHandle[] {
  if (u.execution.kind === "use-case") return []
  const outputs = u.handles.outputs
  if (!isPlainMedia(outputs[0])) return []
  return outputs.filter((h) => h.from !== undefined && (h.list === true || h.kind === "look"))
}

const isSideOutput = (u: UnitDefinition, h: UnitOutputHandle): boolean => unitSideOutputs(u).some((s) => s.id === h.id)

/**
 * Whose side outputs a read takes: a wire's (`"wire"`, the default) — after a
 * run once per upstream item, the batch's, every row's — or the active take's
 * (`"take"`: what the node shows beside the take it shows, its own row's).
 */
export type UnitSideRead = "wire" | "take"

/** Whether the node holds the batch of a run once per upstream item: its take pip's list (`__listResults`). */
const holdsBatch = (data: Readonly<Record<string, unknown>>): boolean => unitListItems(data.__listResults).length > 0

/**
 * The value of output `h` in node data: a side output reads the ACTIVE take's
 * own field when that take carries the key (`Object.hasOwn` — a take whose run
 * made none carries it as null, which is no value and survives a save), else the node's
 * field; every other output reads the node's field. The active take is
 * `generatedResults[activeResultIndex ?? 0]`, as the media read takes it. A
 * wire's read of a node holding a batch (`holdsBatch`) takes the node's field:
 * after a run once per upstream item it holds every row's, row-aligned
 * (unitBatchSideOutputs, decided 2026-11-11), whichever take is active — as
 * the take pip lists the batch whichever take is active. The server's twin is
 * backend/src/lib/unit-compose.ts `unitSavedOutput`.
 */
function unitOutputField(u: UnitDefinition, data: Readonly<Record<string, unknown>>, h: UnitOutputHandle, read: UnitSideRead = "wire"): unknown {
  if (!h.from) return undefined
  if (!isSideOutput(u, h)) return data[h.from]
  if (read === "wire" && holdsBatch(data)) return data[h.from]
  const results = data.generatedResults
  const take = Array.isArray(results) ? (results as unknown[])[(data.activeResultIndex as number | undefined) ?? 0] : undefined
  if (typeof take === "object" && take !== null && Object.hasOwn(take, h.from)) return (take as Record<string, unknown>)[h.from]
  return data[h.from]
}

/** A list output's items: the array's non-empty strings, in order; nothing for any other value. */
export function unitListItems(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((e): e is string => typeof e === "string" && e !== "") : []
}

/**
 * A unit's output, read the way every media node's is: an output handle
 * (the one named, else the first) whose `from` names the node-data field; a
 * media output prefers the ACTIVE generated result's url (the take the node
 * shows), as the legacy video nodes do; a list output (`list: true`) its first
 * item — never the take's own url; a JSON (look) output the field as the JSON
 * string a wire carries (`unitJsonString`). A side output (`unitSideOutputs`)
 * reads the active take's own field when the take carries it. Undefined when
 * it has no such output.
 */
export function unitOutputValue(u: UnitDefinition, data: Readonly<Record<string, unknown>>, sourceHandle?: string): string | undefined {
  const h = unitOutputPip(u, sourceHandle)
  if (!h?.from) return undefined
  if (h.list === true) return unitListItems(unitOutputField(u, data, h))[0]
  const field = unitOutputField(u, data, h)
  if (h.kind === "video" || h.kind === "image" || h.kind === "audio") {
    // Exactly the legacy media read (execution-graph.ts extractNodeOutput):
    // `activeResultIndex ?? 0`, the active result's url when it is not nullish
    // (an empty one included), else the field as stored.
    const results = (data.generatedResults as ReadonlyArray<{ url?: string }> | undefined) ?? []
    const active = (data.activeResultIndex as number | undefined) ?? 0
    return results[active]?.url ?? (field as string | undefined)
  }
  if (h.kind === "look") return unitJsonString(field)
  return typeof field === "string" && field ? field : undefined
}

/**
 * A JSON output's value as a wire carries it: a string as stored, any other
 * value serialised; null, undefined and "" are no value. The server's twin is
 * backend/src/lib/unit-compose.ts `unitJsonString`.
 */
export function unitJsonString(v: unknown): string | undefined {
  if (typeof v === "string") return v === "" ? undefined : v
  return v === undefined || v === null ? undefined : JSON.stringify(v)
}

/** A JSON output's value: a string holding a JSON object or array is that object or array; anything else as it is. */
function unitJsonValue(v: unknown): unknown {
  if (typeof v !== "string") return v
  try {
    const parsed: unknown = JSON.parse(v)
    return typeof parsed === "object" && parsed !== null ? parsed : v
  } catch {
    return v
  }
}

const lookOutputs = (u: UnitDefinition) => u.handles.outputs.filter((h) => h.kind === "look")

/**
 * What a wire from a unit's look pip hands a consumer that reads structured
 * JSON (Extract Field, JSON Process, the list operators): that output's value
 * — its field, a JSON string parsed — wrapped, `value` undefined when it holds
 * none. Undefined when the pip the wire reads (the one named, else the first)
 * is not a look output, or the unit is a use case. A look output beside a
 * media take reads the active take's own field when the take carries it — on
 * a wire's read of a node holding a batch, the node's (every row's entries,
 * each with its row); `read: "take"` always the active take's. The server's
 * twin is backend/src/lib/unit-compose.ts `unitPipJson`.
 */
export function unitPipJson(u: UnitDefinition, data: Readonly<Record<string, unknown>>, sourceHandle: string | null | undefined, read: UnitSideRead = "wire"): { readonly value: unknown } | undefined {
  if (u.execution.kind === "use-case") return undefined
  const h = unitOutputPip(u, sourceHandle)
  if (h?.kind !== "look") return undefined
  const s = unitJsonString(unitOutputField(u, data, h, read))
  return { value: s === undefined ? undefined : unitJsonValue(s) }
}

/**
 * What an Each wire from a unit's media pip fans out over, for a unit whose
 * media take carries side outputs (`unitSideOutputs`): its list pip's items
 * (the active take's list when the take carries one, else the node's — on a
 * wire's read of a node holding a batch, the node's: every row's, row by row;
 * `read: "take"` always the active take's), and on its media take's pip the
 * last batch of a run once per upstream item, never its take history.
 * Undefined for every other pip and unit (a JSON pip is read by `unitPipJson`;
 * a unit without side outputs keeps the generic list read).
 */
export function unitPipList(u: UnitDefinition, data: Readonly<Record<string, unknown>>, sourceHandle: string | null | undefined, read: UnitSideRead = "wire"): { readonly items: readonly string[] } | undefined {
  if (unitSideOutputs(u).length === 0) return undefined
  const h = unitOutputPip(u, sourceHandle)
  if (h?.list === true) return { items: unitListItems(unitOutputField(u, data, h, read)) }
  // The media take's pip lists the last batch of a run once per upstream item
  // (`__listResults`, as a per-item node's each pip does) — never the take history.
  return isPlainMedia(h) ? { items: unitListItems(data.__listResults) } : undefined
}

/** Whether a wire leaving pip `sourceHandle` (none = the first output) of unit `u` carries an image — routed as one by every input it reaches. */
export function unitPipIsImage(u: UnitDefinition, sourceHandle: string | null | undefined): boolean {
  const h = unitOutputPip(u, sourceHandle)
  return u.execution.kind !== "use-case" && h?.kind === "image" && h.runtimeTyped !== true
}

/**
 * A JSON value as list items, as the server's list collector makes them
 * (inline-executor.ts collectItemsForEdge): an array's elements (a string as
 * it is, anything else serialised; null and undefined skipped), an object one
 * serialised item, any other value its text, nothing for null or undefined.
 */
export function jsonListItems(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (Array.isArray(value)) return value.filter((e) => e !== undefined && e !== null).map((e) => (typeof e === "string" ? e : JSON.stringify(e)))
  return [typeof value === "object" ? JSON.stringify(value) : String(value)]
}

/**
 * Worker units whose job's result is JSON: every output is a look output. The
 * ones the shared JSON mapping (json-run-result.ts) lands, and whose pips the
 * add-node popup offers to typed JSON consumers (node-compatibility.ts). A
 * worker whose JSON stands beside a media take (decided 2026-11-11) is not one:
 * its run lands the media take, and its JSON beside it (`unitSideLanding`).
 */
export const unitJsonWorkers = (units: ReadonlyArray<UnitDefinition>): UnitDefinition[] =>
  units.filter((u) => u.execution.kind === "worker" && lookOutputs(u).length > 0 && u.handles.outputs.every((h) => h.kind === "look"))

/**
 * A worker unit's finished job, as node data (decided 2026-10-18): each look
 * output's `values[<output id>]` on its `from` field — a string holding a JSON
 * object or array as that value — and a look output with no value written as
 * undefined, so a field an earlier run filled is emptied, never left beside
 * this run's result. A key that names no output is dropped. `values` is the
 * job's output_data, or a server run's per-pip carrier (`unitOutputs`, each a
 * JSON string), so every lane lands the same patch. The server's reader of
 * the same row is backend/src/lib/unit-compose.ts `unitJobOutput`.
 */
export function unitJobLanding(u: UnitDefinition, values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const h of lookOutputs(u)) {
    if (!h.from) continue
    const value = Object.hasOwn(values, h.id) && unitJsonString(values[h.id]) !== undefined ? unitJsonValue(values[h.id]) : undefined
    out[h.from] = value
  }
  return out
}

const landsSomething = (patch: Readonly<Record<string, unknown>>) => Object.values(patch).some((v) => v !== undefined)

/**
 * A server run's node output for a JSON worker unit, as the node-data patch
 * (`unitJobLanding`): over its per-pip carrier `unitOutputs`, or — an output
 * carrying `json` alone — over the primary output's value. Undefined when it
 * lands nothing.
 */
export function unitJsonRunPatch(u: UnitDefinition, output: { readonly unitOutputs?: unknown; readonly json?: unknown }): Record<string, unknown> | undefined {
  const primary = lookOutputs(u)[0]
  const carrier = output.unitOutputs
  const values = typeof carrier === "object" && carrier !== null && !Array.isArray(carrier)
    ? (carrier as Readonly<Record<string, unknown>>)
    : primary && output.json !== undefined ? { [primary.id]: output.json } : undefined
  if (!values) return undefined
  const patch = unitJobLanding(u, values)
  return landsSomething(patch) ? patch : undefined
}

/** How a canvas run lands a JSON worker unit's job (the poll's JSON landing, poll-job.ts). */
export interface UnitJsonLanding {
  /** The node fields the run empties at its start: each JSON output's field. */
  readonly fields: readonly string[]
  /** The finished job's patch, and what the run resolves (the primary output as a wire carries it, "" when it has none); undefined when the job wrote no result (the node fails). */
  land(outputData: Readonly<Record<string, unknown>>): { readonly patch: Readonly<Record<string, unknown>>; readonly result: string } | undefined
}

/** A JSON worker unit's canvas-run landing (`runJsonNode`): every lane's patch (`unitJobLanding`) over the job row. */
export function unitJsonJobLanding(u: UnitDefinition): UnitJsonLanding {
  const looks = lookOutputs(u)
  return {
    fields: looks.flatMap((h) => (h.from ? [h.from] : [])),
    land(outputData) {
      const patch = unitJobLanding(u, outputData)
      if (!landsSomething(patch)) return undefined
      const primary = looks[0]
      return { patch, result: (primary && Object.hasOwn(outputData, primary.id) ? unitJsonString(outputData[primary.id]) : undefined) ?? "" }
    },
  }
}

/**
 * The field that holds how many items of list output `h` its run made but could
 * not store (each is retried; one that still fails is dropped and the run
 * completes with the rest): `<output id>NotSaved` — the same name on the job
 * row's output_data, on the node and on the take ("layersNotSaved" for a
 * `layers` pip). A server run's node output carries the counts on
 * `unitListsNotSaved`, by output id.
 */
export const unitListNotSavedField = (h: Pick<UnitOutputHandle, "id">): string => `${h.id}NotSaved`

/** A not-saved count as it lands: a whole number from 0, else null (the run reported none). */
function notSavedCount(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null
}

/**
 * A finished run's side outputs (`unitSideOutputs`), as node data — what every
 * lane writes beside the media take, on the node and on the take: each JSON
 * (look) output's `looks[<output id>]` on its `from` field as `unitJobLanding`
 * lands it, and each list output's `lists[<output id>]` as its non-empty
 * strings, with `notSaved[<output id>]` — how many of its items the run could
 * not store — on `unitListNotSavedField` (0 when every one was stored). A side
 * output with no value (a list with no item, a JSON output the run did not
 * write, a count the run did not report) is written as null — no value to every
 * reader — so a field an earlier run filled is emptied, and a take keeps saying
 * so after a save (an undefined key is dropped by the save, and the reader would
 * then fall back to the node's field: another run's layers). A key that names
 * no side output is dropped. The canvas run reads all three off the job row's
 * output_data (each value under its output's id, each count under its field); a
 * server run's node output carries them on `unitOutputs` (JSON strings),
 * `unitLists` and `unitListsNotSaved`. Empty for a unit without side outputs.
 */
export function unitSideLanding(
  u: UnitDefinition,
  looks: Readonly<Record<string, unknown>>,
  lists: Readonly<Record<string, unknown>>,
  notSaved: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const h of unitSideOutputs(u)) {
    if (!h.from) continue
    if (h.list === true) {
      const items = Object.hasOwn(lists, h.id) ? unitListItems(lists[h.id]) : []
      out[h.from] = items.length > 0 ? items : null
      out[unitListNotSavedField(h)] = Object.hasOwn(notSaved, h.id) ? notSavedCount(notSaved[h.id]) : null
    } else {
      out[h.from] = Object.hasOwn(looks, h.id) && unitJsonString(looks[h.id]) !== undefined ? unitJsonValue(looks[h.id]) : null
    }
  }
  return out
}

const carrier = (v: unknown): Readonly<Record<string, unknown>> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Readonly<Record<string, unknown>>) : {}

/** A server run's node output (`unitOutputs` for the JSON pips, `unitLists` for the list pips, `unitListsNotSaved` for their counts) as the side patch; undefined for a unit without side outputs. */
export function unitSideRunPatch(
  u: UnitDefinition,
  output: { readonly unitOutputs?: unknown; readonly unitLists?: unknown; readonly unitListsNotSaved?: unknown } | null | undefined,
): Record<string, unknown> | undefined {
  if (unitSideOutputs(u).length === 0) return undefined
  return unitSideLanding(u, carrier(output?.unitOutputs), carrier(output?.unitLists), carrier(output?.unitListsNotSaved))
}

/** A job row's output_data (each side output's value under its id, each list's count under `unitListNotSavedField`) as the side patch; undefined for a unit without side outputs. */
export function unitSideJobPatch(u: UnitDefinition, outputData: unknown): Record<string, unknown> | undefined {
  const side = unitSideOutputs(u)
  if (side.length === 0) return undefined
  const o = carrier(outputData)
  const notSaved: Record<string, unknown> = {}
  for (const h of side) if (h.list === true && Object.hasOwn(o, unitListNotSavedField(h))) notSaved[h.id] = o[unitListNotSavedField(h)]
  return unitSideLanding(u, o, o, notSaved)
}

/** The node fields a canvas run of a unit with side outputs empties at its start: each side output's field, and each list output's not-saved count. */
export const unitSideFields = (u: UnitDefinition): string[] =>
  unitSideOutputs(u).flatMap((h) => (h.from ? (h.list === true ? [h.from, unitListNotSavedField(h)] : [h.from]) : []))

/** A take's side fields (the side outputs one run made, as every lane lands them) in the carrier a server node output uses, by output id. */
function unitSideRowOf(side: ReadonlyArray<UnitOutputHandle>, row: object): UnitSideOutputsRow {
  const take = row as Readonly<Record<string, unknown>>
  const unitLists: Record<string, unknown> = {}
  const unitOutputs: Record<string, unknown> = {}
  const unitListsNotSaved: Record<string, unknown> = {}
  for (const h of side) {
    if (!h.from) continue
    if (h.list === true) {
      if (Object.hasOwn(take, h.from)) unitLists[h.id] = take[h.from]
      if (Object.hasOwn(take, unitListNotSavedField(h))) unitListsNotSaved[h.id] = take[unitListNotSavedField(h)]
    } else if (Object.hasOwn(take, h.from)) unitOutputs[h.id] = take[h.from]
  }
  return { unitLists, unitOutputs, unitListsNotSaved }
}

/**
 * The node's side fields after a canvas run once per upstream item (decided
 * 2026-11-11, row-aligned): every row's side outputs, from each row's take
 * (`takes[i]` is row i's; null or undefined for a row that made none) —
 * `unitBatchSideOutputs` (@nodaro/render-rules), the rule the server's fan-out
 * output applies, landed as `unitSideLanding` lands it. Each take keeps its
 * own. Undefined for a unit without side outputs.
 */
export function unitSideBatchPatch(
  u: UnitDefinition,
  takes: ReadonlyArray<object | null | undefined>,
): Record<string, unknown> | undefined {
  const side = unitSideOutputs(u)
  if (side.length === 0) return undefined
  return unitSideRunPatch(u, unitBatchSideOutputs(u.handles.outputs, takes.map((t) => (t ? unitSideRowOf(side, t) : null))))
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
