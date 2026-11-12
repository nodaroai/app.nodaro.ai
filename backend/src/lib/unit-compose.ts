// backend/src/lib/unit-compose.ts — the pure functions every server registry
// composes its node units with (§5.8 B, decided 2026-10-16;
// tools/units/README.md): `registry = legacy ∪ units`, a type in exactly one
// of the two. Pure and aggregate-free — each composer passes its legacy table
// and the unit collection in — so lib/__tests__/unit-compose.test.ts proves
// every seam on an in-memory fixture unit, and an EMPTY unit collection
// returns every legacy table unchanged.
import type { UnitDescriptor, UnitOutputHandle, UnitPrice } from "../nodes/kit.js"

/** Throws when a unit key is also a legacy key: a node type lives in exactly one place (G1). */
function assertDisjoint(what: string, legacy: Iterable<string>, units: Iterable<string>): void {
  const seen = new Set(legacy)
  const both = [...units].filter((t) => seen.has(t))
  if (both.length) throw new Error(`${what}: ${both.join(", ")} is both a legacy entry and a node unit — a type lives in exactly one place`)
}

/**
 * `legacy` with `additions` merged in after it. With nothing to add it returns
 * `legacy` itself (the same object); otherwise a new one — `legacy` is never
 * mutated (it may be a generated module's constant). A mutable table
 * (STATIC_CREDIT_COSTS, which plugins register into) is only ever reached
 * through the composed export, so the new object is the one they mutate.
 */
export function composeRecord<V>(what: string, legacy: Record<string, V>, additions: Readonly<Record<string, V>>): Record<string, V> {
  const keys = Object.keys(additions)
  if (keys.length === 0) return legacy
  assertDisjoint(what, Object.keys(legacy), keys)
  return { ...legacy, ...additions }
}

/**
 * A record whose legacy keys are in `compare` order (the gen:skills handle
 * table, sorted by type with localeCompare): every unit row inserted at its
 * place in that order — before the first legacy key that sorts after it — so
 * the composed record is in the same order a table holding the unit too would
 * be. Legacy keys keep their own order. With nothing to add it returns
 * `legacy` itself.
 */
export function composeRecordSorted<V>(
  what: string,
  legacy: Record<string, V>,
  additions: Readonly<Record<string, V>>,
  compare: (a: string, b: string) => number = (a, b) => a.localeCompare(b),
): Record<string, V> {
  const added = Object.keys(additions).sort(compare)
  if (added.length === 0) return legacy
  assertDisjoint(what, Object.keys(legacy), added)
  const out: Record<string, V> = {}
  let i = 0
  for (const k of Object.keys(legacy)) {
    while (i < added.length && compare(added[i], k) < 0) { out[added[i]] = additions[added[i]]; i++ }
    out[k] = legacy[k]
  }
  for (; i < added.length; i++) out[added[i]] = additions[added[i]]
  return out
}

/** `legacy` plus `additions`, legacy order first. With nothing to add it returns `legacy` itself. */
export function composeSet(what: string, legacy: ReadonlySet<string>, additions: Iterable<string>): ReadonlySet<string> {
  const extra = [...additions]
  if (extra.length === 0) return legacy
  assertDisjoint(what, legacy, extra)
  return new Set([...legacy, ...extra])
}

/** Unit type → `make(unit)`, for every unit `make` answers (undefined = not a member). */
export function unitRecord<V>(units: ReadonlyArray<UnitDescriptor>, make: (u: UnitDescriptor) => V | undefined): Record<string, V> {
  const out: Record<string, V> = {}
  for (const u of units) {
    const v = make(u)
    if (v !== undefined) out[u.type] = v
  }
  return out
}

/** The units that declare `capability` (tools/units/capabilities.mjs). */
export const unitsWith = (units: ReadonlyArray<UnitDescriptor>, capability: string): string[] =>
  units.filter((u) => u.capabilities.includes(capability)).map((u) => u.type)

/**
 * `legacy` (in its order) with each unit placed right after the type its
 * `after` names — a legacy entry or another unit, so a unit may follow a unit
 * — or, when that name is not in this collection but is one of `elsewhere`
 * (a registry that lists fewer nodes than NODE_DEFINITIONS: the node exists,
 * this list just does not carry it), at the end. An `after` that names
 * nothing — not in this collection and not in `elsewhere` — throws: a typo or
 * a renamed anchor must never silently move a unit to the end. Units naming
 * the same place keep type order. A cycle among units throws.
 */
export function placeAfter<T>(
  legacy: ReadonlyArray<T>,
  typeOf: (t: T) => string,
  units: ReadonlyArray<{ readonly type: string; readonly after: string | null; readonly entry: T }>,
  elsewhere: ReadonlySet<string> = new Set(),
): T[] {
  if (units.length === 0) return [...legacy]
  assertDisjoint("placeAfter", legacy.map(typeOf), units.map((u) => u.type))
  const sorted = [...units].sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))
  const known = new Set([...legacy.map(typeOf), ...units.map((u) => u.type)])
  const nowhere = sorted.filter((u) => u.after !== null && !known.has(u.after) && !elsewhere.has(u.after))
  if (nowhere.length) throw new Error(`placeAfter: ${nowhere.map((u) => `${u.type}'s anchor "${u.after}"`).join(", ")} names nothing — not in this collection, nor a known name outside it`)
  const byAnchor = new Map<string | null, typeof sorted>()
  for (const u of sorted) {
    const anchor = u.after !== null && !known.has(u.after) ? "\0end" : u.after
    byAnchor.set(anchor, [...(byAnchor.get(anchor) ?? []), u])
  }
  const out: T[] = []
  const place = (entry: T, type: string) => {
    out.push(entry)
    for (const u of byAnchor.get(type) ?? []) place(u.entry, u.type)
  }
  for (const u of byAnchor.get(null) ?? []) place(u.entry, u.type)
  for (const t of legacy) place(t, typeOf(t))
  for (const u of byAnchor.get("\0end") ?? []) place(u.entry, u.type)
  const placed = new Set(out.map(typeOf))
  const unplaced = sorted.map((u) => u.type).filter((t) => !placed.has(t))
  if (unplaced.length) throw new Error(`placeAfter: the units' anchors form a cycle: ${unplaced.join(", ")}`)
  return out
}

/** Every unit's static credit rows, merged — a row named by two units is refused. */
export function unitStaticCosts(prices: Readonly<Record<string, UnitPrice>>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [type, p] of Object.entries(prices)) {
    for (const [id, credits] of Object.entries(p.staticCosts)) {
      if (Object.hasOwn(out, id)) throw new Error(`${type}: credit id "${id}" is priced by another unit too`)
      out[id] = credits
    }
  }
  return out
}

/**
 * The /v1/nodes category of a unit: its `registryCategory` (unit.json
 * registry.category, one of `serverCategories` — every category /v1/nodes
 * lists) when it states one, else the manifest's own category when the server
 * shares that name (`shared`, tools/units/vocabulary.mjs REGISTRY_CATEGORIES).
 */
export function registryCategoryOf<C extends string, S extends string = C>(
  u: UnitDescriptor,
  shared: ReadonlyArray<C>,
  serverCategories: ReadonlyArray<S> = shared as unknown as ReadonlyArray<S>,
): C | S {
  if (u.registryCategory !== undefined) {
    const s = serverCategories.find((x) => x === u.registryCategory)
    if (!s) throw new Error(`${u.type}: registry.category "${u.registryCategory}" is no /v1/nodes category (${serverCategories.join(", ")})`)
    return s
  }
  const c = shared.find((x) => x === u.category)
  if (!c) throw new Error(`${u.type}: category "${u.category}" has no /v1/nodes category (${shared.join(", ")})`)
  return c
}

/** The node units whose `contract.producer` is `kind` (UnitDescriptor.producer), in collection order. */
export const unitProducers = (units: ReadonlyArray<UnitDescriptor>, kind: NonNullable<UnitDescriptor["producer"]>): string[] =>
  units.filter((u) => u.producer === kind).map((u) => u.type)

const PROVIDER_CAPABILITY = "provider:"

/**
 * The provider a unit's worker job counts against — the one its `provider:*`
 * capability names (tools/units/capabilities.mjs; the validator requires exactly
 * one on every provider-lane worker and refuses it anywhere else) — or
 * undefined (no unit, or a unit with none).
 */
export function unitProviderOf(u: UnitDescriptor | undefined): string | undefined {
  const cap = u?.capabilities.find((c) => c.startsWith(PROVIDER_CAPABILITY))
  const provider = cap?.slice(PROVIDER_CAPABILITY.length)
  return provider ? provider : undefined
}

/**
 * A JSON output's value as a wire carries it: a string as stored, any other
 * value serialised; null, undefined and "" are no value. The editor's twin is
 * frontend/src/lib/unit-compose.ts `unitJsonString`.
 */
export function unitJsonString(v: unknown): string | undefined {
  if (typeof v === "string") return v === "" ? undefined : v
  return v === undefined || v === null ? undefined : JSON.stringify(v)
}

/** A JSON output's value: a string holding a JSON object or array is that object or array; anything else as it is. */
export function unitJsonValue(v: unknown): unknown {
  if (typeof v !== "string") return v
  try {
    const parsed: unknown = JSON.parse(v)
    return typeof parsed === "object" && parsed !== null ? parsed : v
  } catch {
    return v
  }
}

const MEDIA_KINDS: ReadonlyArray<string> = ["image", "video", "audio"]
const isMediaOutput = (h: UnitOutputHandle | undefined): boolean => h !== undefined && MEDIA_KINDS.includes(h.kind)
/** An output that rides on the media take: a JSON (look) output, or a list of files. */
const isSideOutput = (h: UnitOutputHandle): boolean => h.kind === "look" || h.list === true

/**
 * A worker unit whose job's result is JSON: every output is a look output (the
 * validator, tools/units/json-output-rules.mjs, lets a look output stand only
 * beside look or media outputs; a unit with media is a media unit whose JSON
 * rides beside its take — `unitHasSideOutputs`). Its job writes each output's
 * value under the output's id.
 */
export function isUnitJsonWorker(u: UnitDescriptor): boolean {
  const outputs = u.handles.outputs
  return u.execution.kind === "worker" && outputs.length > 0 && outputs.every((h) => h.kind === "look")
}

/**
 * A unit whose media take carries SIDE outputs (decided 2026-11-11): its first
 * output is a plain media output (the take, what an edge naming no pip reads)
 * and beside it a list output and/or a JSON (look) output. Never a use case
 * (the use-case reader reads those).
 */
export function unitHasSideOutputs(u: UnitDescriptor): boolean {
  const [first, ...rest] = u.handles.outputs
  return u.execution.kind !== "use-case" && isMediaOutput(first) && first!.list !== true && rest.some(isSideOutput)
}

/** What a unit's side outputs put on the node output (NodeOutput's `unitOutputs`, `unitLists` and `json`). */
export interface UnitJsonOutput {
  /** By look output id: its value as the JSON string a wire carries. */
  readonly unitOutputs?: Readonly<Record<string, string>>
  /** By list output id: the files one run made on that pip, in order (never empty). */
  readonly unitLists?: Readonly<Record<string, readonly string[]>>
  /** By list output id: how many items the run made on that pip but could not store (the job's `<id>NotSaved`, a whole number; 0 when it stored every one). */
  readonly unitListsNotSaved?: Readonly<Record<string, number>>
  /** The first output's JSON value when the first output is a look output (a JSON-only worker), for the readers that read `output.json`. */
  readonly json?: unknown
}

/** A list output's value as its items: the non-empty strings of an array, in order; undefined when none (an empty list is no value). */
export function unitListItems(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const items = v.filter((x): x is string => typeof x === "string" && x !== "")
  return items.length > 0 ? items : undefined
}

/**
 * The side outputs' values — every look output on `unitOutputs`, every list
 * output on `unitLists` — each read by `read(output)`. `json` is the first
 * output's value only when that output is a look output (a JSON-only worker):
 * never for a media unit. Empty when none has a value.
 */
function sideOutputValues(u: UnitDescriptor, read: (h: UnitOutputHandle) => unknown): UnitJsonOutput {
  const unitOutputs: Record<string, string> = {}
  const unitLists: Record<string, readonly string[]> = {}
  let json: unknown
  const first = u.handles.outputs[0]
  for (const h of u.handles.outputs) {
    if (h.kind === "look") {
      const raw = read(h)
      const value = unitJsonString(raw)
      if (value === undefined) continue
      unitOutputs[h.id] = value
      if (h === first) json = unitJsonValue(raw)
    } else if (h.list === true) {
      const items = unitListItems(read(h))
      if (items) unitLists[h.id] = items
    }
  }
  return {
    ...(Object.keys(unitOutputs).length > 0 ? { unitOutputs } : {}),
    ...(Object.keys(unitLists).length > 0 ? { unitLists } : {}),
    ...(json !== undefined ? { json } : {}),
  }
}

/**
 * A unit's finished job's side outputs: each look or list output's
 * `output_data[<output id>]` (decided 2026-10-18 for JSON, 2026-11-11 for
 * lists and JSON beside media); a key that names no output is dropped. For a
 * JSON-only worker that is its whole node output — `{}` when the job wrote
 * none, and the poll then fails the node; a media unit's take is read the way
 * every media node's is, these beside it.
 */
export function unitJobOutput(u: UnitDescriptor, outputData: Readonly<Record<string, unknown>>): UnitJsonOutput {
  const values = sideOutputValues(u, (h) => (Object.hasOwn(outputData, h.id) ? outputData[h.id] : undefined))
  const notSaved = unitListsNotSavedOf(u, outputData)
  return notSaved ? { ...values, unitListsNotSaved: notSaved } : values
}

/** The output_data key a list output reports its unstored items on: `<id>NotSaved`. */
export function unitListNotSavedKey(listId: string): string {
  return `${listId}NotSaved`
}

/**
 * How many items each list output's run made but could not store — the job's
 * `output_data["<id>NotSaved"]` when it is a whole number (0 included: a run
 * that stored every item says so); undefined when no list output reports one.
 */
export function unitListsNotSavedOf(u: UnitDescriptor, outputData: Readonly<Record<string, unknown>>): Readonly<Record<string, number>> | undefined {
  if (u.execution.kind === "use-case") return undefined
  const out: Record<string, number> = {}
  for (const h of u.handles.outputs) {
    if (h.list !== true) continue
    const key = unitListNotSavedKey(h.id)
    const v = Object.hasOwn(outputData, key) ? outputData[key] : undefined
    if (typeof v === "number" && Number.isInteger(v) && v >= 0) out[h.id] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * The list output a wire from `sourceHandle` reads — only the one it names (an
 * edge naming no pip reads the first output, which is never a list:
 * tools/units/json-output-rules.mjs); undefined when that output is not a list
 * or the unit is a use case.
 */
export function unitListPipOf(u: UnitDescriptor, sourceHandle: string | null | undefined): string | undefined {
  if (u.execution.kind === "use-case" || !sourceHandle) return undefined
  const h = u.handles.outputs.find((o) => o.id === sourceHandle)
  return h?.list === true ? h.id : undefined
}

/** The items a wire from a unit's list pip hands on (`unitLists`); undefined when the pip has none, or is not a list pip. */
export function unitListPipItems(
  u: UnitDescriptor,
  output: { readonly unitLists?: Readonly<Record<string, readonly string[]>> },
  sourceHandle: string | null | undefined,
): readonly string[] | undefined {
  const pip = unitListPipOf(u, sourceHandle)
  return pip === undefined ? undefined : output.unitLists?.[pip]
}

/**
 * Whether a wire from `sourceHandle` reads the media TAKE of a unit whose take
 * carries side outputs (`unitHasSideOutputs`): the pip it names when that is
 * neither a list nor a look output, or (naming none or an unknown one) the
 * first output. Such a pip lists only what this run made — its takes carry
 * their own side outputs, so its saved take history is never a list (the
 * unit-list-outputs fixture, decided 2026-11-11).
 */
export function unitTakePipOf(u: UnitDescriptor, sourceHandle: string | null | undefined): boolean {
  return unitHasSideOutputs(u) && unitLookPipOf(u, sourceHandle) === undefined && unitListPipOf(u, sourceHandle) === undefined
}

/**
 * The kind of the output a wire from `sourceHandle` leaves — the one it names,
 * else the first (what an edge naming no pip reads) — when it is a declared
 * medium; undefined for a use case (routed by its type), and for a pip whose
 * medium is decided at run time (`runtimeTyped`).
 */
export function unitPipKindOf(u: UnitDescriptor, sourceHandle: string | null | undefined): UnitOutputHandle["kind"] | undefined {
  if (u.execution.kind === "use-case") return undefined
  const outputs = u.handles.outputs
  const h = (sourceHandle ? outputs.find((o) => o.id === sourceHandle) : undefined) ?? outputs[0]
  return h === undefined || h.runtimeTyped ? undefined : h.kind
}

/**
 * The look output a wire from `sourceHandle` reads — the one it names, else
 * the first (what an edge naming no pip reads); undefined when that output is
 * not JSON or the unit is a use case (the use-case reader reads those).
 */
export function unitLookPipOf(u: UnitDescriptor, sourceHandle: string | null | undefined): string | undefined {
  if (u.execution.kind === "use-case") return undefined
  const outputs = u.handles.outputs
  const h = (sourceHandle ? outputs.find((o) => o.id === sourceHandle) : undefined) ?? outputs[0]
  return h?.kind === "look" ? h.id : undefined
}

/**
 * What a plain wire from a unit's side pip carries: a look pip's JSON string
 * off the node output (`unitOutputs`), a list pip's FIRST item (`unitLists`).
 * Undefined for any other pip (its media and text take the generic reads).
 */
export function unitPipValue(
  u: UnitDescriptor,
  output: { readonly unitOutputs?: Readonly<Record<string, string>>; readonly unitLists?: Readonly<Record<string, readonly string[]>> },
  sourceHandle: string | null | undefined,
): string | undefined {
  const pip = unitLookPipOf(u, sourceHandle)
  if (pip !== undefined) return output.unitOutputs?.[pip]
  return unitListPipItems(u, output, sourceHandle)?.[0]
}

/**
 * The structured JSON a wire from a unit's look pip hands a consumer that reads
 * JSON (Extract Field, JSON Process, the list operators): that output's value
 * (`unitJsonValue` of its string). Undefined when the pip has none, or is not a look pip.
 */
export function unitPipJson(
  u: UnitDescriptor,
  output: { readonly unitOutputs?: Readonly<Record<string, string>> },
  sourceHandle: string | null | undefined,
): unknown {
  const pip = unitLookPipOf(u, sourceHandle)
  const value = pip === undefined ? undefined : output.unitOutputs?.[pip]
  return value === undefined ? undefined : unitJsonValue(value)
}

/** A unit's saved output: its media and text, and its JSON outputs (`unitSavedOutput`). */
export interface UnitSavedOutput extends UnitJsonOutput {
  readonly videoUrl?: string
  readonly audioUrl?: string
  readonly imageUrl?: string
  readonly text?: string
  /** A unit with side outputs that ran once per upstream item: its last batch of takes (`__listResults`), what its take pip lists. */
  readonly listResults?: string[]
}

/**
 * A unit's saved output, read the way every media node's is: per output
 * handle whose `from` names the node-data field, `<kind>Url` (videoUrl,
 * audioUrl, imageUrl) from the ACTIVE generated result's url, else the field
 * (a list output never — it is a side output); `text` for a text output; its
 * side outputs as a finished job's are (`unitJobOutput`): a JSON (look)
 * output's field on `unitOutputs` (and, for a JSON-only worker, the first
 * one's value on `json`), a list output's on `unitLists`. A media unit's side
 * output reads the ACTIVE take's own field when that take carries it (a take
 * holds the side fields it was made with), else the node's field — except
 * after a run once per upstream item (the node holds a batch on
 * `__listResults`): then the node's field, which holds every row's,
 * row-aligned (unitBatchSideOutputs, decided 2026-11-11), whichever take is
 * active — as its take pip lists the batch whichever take is active. The
 * editor's twin is frontend/src/lib/unit-compose.ts `unitOutputField`.
 * Undefined when nothing is saved yet.
 */
export function unitSavedOutput(u: UnitDescriptor, data: Readonly<Record<string, unknown>>): UnitSavedOutput | undefined {
  const out: Record<string, string> = {}
  // Exactly the legacy media read (output-extractor.ts getActiveResultUrl, then
  // the field): `activeResultIndex ?? 0`, the active result's url when it is not
  // nullish — an empty one included, which then saves nothing — else the field.
  const results = (data.generatedResults as ReadonlyArray<{ url?: string }> | undefined) ?? []
  const active = (data.activeResultIndex as number | undefined) ?? 0
  const activeTake: unknown = results[active]
  const activeUrl = results[active]?.url
  for (const h of u.handles.outputs) {
    if (!h.from || h.list === true) continue
    const value = data[h.from] as string | undefined
    if (h.kind === "video" || h.kind === "audio" || h.kind === "image") {
      const url = activeUrl ?? value
      if (url && out[`${h.kind}Url`] === undefined) out[`${h.kind}Url`] = url
    } else if (h.kind === "text" && typeof value === "string" && value && out.text === undefined) out.text = value
  }
  // Its take pip lists the last batch of a run once per upstream item (as a
  // per-item node's each pip does, savedListFor) — never its take history.
  const batch = unitHasSideOutputs(u) ? unitListItems(data.__listResults) : undefined
  // A media unit's take carries its side fields; a JSON-only worker reads its
  // node's fields as it always has, and so does a batch (its node's fields hold every row's).
  const take = unitHasSideOutputs(u) && !batch && typeof activeTake === "object" && activeTake !== null ? (activeTake as Readonly<Record<string, unknown>>) : undefined
  const side = sideOutputValues(u, (h) => {
    if (!h.from) return undefined
    return take && Object.hasOwn(take, h.from) ? take[h.from] : data[h.from]
  })
  const saved: UnitSavedOutput = { ...out, ...side, ...(batch ? { listResults: batch } : {}) }
  return Object.keys(saved).length ? saved : undefined
}
