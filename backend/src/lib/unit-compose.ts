// backend/src/lib/unit-compose.ts — the pure functions every server registry
// composes its node units with (§5.8 B, decided 2026-10-16;
// tools/units/README.md): `registry = legacy ∪ units`, a type in exactly one
// of the two. Pure and aggregate-free — each composer passes its legacy table
// and the unit collection in — so lib/__tests__/unit-compose.test.ts proves
// every seam on an in-memory fixture unit, and an EMPTY unit collection
// returns every legacy table unchanged.
import type { UnitDescriptor, UnitPrice } from "../nodes/kit.js"

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

/** The /v1/nodes category of a unit: the manifest's when the server shares that name (tools/units/vocabulary.mjs REGISTRY_CATEGORIES). */
export function registryCategoryOf<C extends string>(u: UnitDescriptor, categories: ReadonlyArray<C>): C {
  const c = categories.find((x) => x === u.category)
  if (!c) throw new Error(`${u.type}: category "${u.category}" has no /v1/nodes category (${categories.join(", ")})`)
  return c
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

const lookOutputs = (u: UnitDescriptor) => u.handles.outputs.filter((h) => h.kind === "look")

/**
 * A worker unit whose job's result is JSON: it has look outputs, and (the
 * validator, tools/units/json-output-rules.mjs) nothing but look outputs. Its
 * job writes each output's value under the output's id.
 */
export function isUnitJsonWorker(u: UnitDescriptor): boolean {
  return u.execution.kind === "worker" && lookOutputs(u).length > 0
}

/** What a unit's JSON outputs put on the node output (NodeOutput's `unitOutputs` and `json`). */
export interface UnitJsonOutput {
  /** By look output id: its value as the JSON string a wire carries. */
  readonly unitOutputs?: Readonly<Record<string, string>>
  /** The primary (first) look output's JSON value, for the readers that read `output.json`. */
  readonly json?: unknown
}

/** The look outputs' values, each read by `read(output)`. Empty when none has a value. */
function lookOutputValues(u: UnitDescriptor, read: (h: { readonly id: string; readonly from?: string }) => unknown): UnitJsonOutput {
  const unitOutputs: Record<string, string> = {}
  let json: unknown
  const looks = lookOutputs(u)
  for (const h of looks) {
    const raw = read(h)
    const value = unitJsonString(raw)
    if (value === undefined) continue
    unitOutputs[h.id] = value
    if (h === looks[0]) json = unitJsonValue(raw)
  }
  if (Object.keys(unitOutputs).length === 0) return {}
  return json === undefined ? { unitOutputs } : { unitOutputs, json }
}

/**
 * A JSON worker unit's finished job as its node output: each look output's
 * `output_data[<output id>]` (decided 2026-10-18); a key that names no output
 * is dropped. `{}` when the job wrote none — the poll then fails the node.
 */
export function unitJobOutput(u: UnitDescriptor, outputData: Readonly<Record<string, unknown>>): UnitJsonOutput {
  return lookOutputValues(u, (h) => (Object.hasOwn(outputData, h.id) ? outputData[h.id] : undefined))
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

/** What a wire from a unit's look pip carries: that output's JSON string off the node output (`unitOutputs`). */
export function unitPipValue(
  u: UnitDescriptor,
  output: { readonly unitOutputs?: Readonly<Record<string, string>> },
  sourceHandle: string | null | undefined,
): string | undefined {
  const pip = unitLookPipOf(u, sourceHandle)
  return pip === undefined ? undefined : output.unitOutputs?.[pip]
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
  const value = unitPipValue(u, output, sourceHandle)
  return value === undefined ? undefined : unitJsonValue(value)
}

/** A unit's saved output: its media and text, and its JSON outputs (`unitSavedOutput`). */
export interface UnitSavedOutput extends UnitJsonOutput {
  readonly videoUrl?: string
  readonly audioUrl?: string
  readonly imageUrl?: string
  readonly text?: string
}

/**
 * A unit's saved output, read the way every media node's is: per output
 * handle whose `from` names the node-data field, `<kind>Url` (videoUrl,
 * audioUrl, imageUrl) from the ACTIVE generated result's url, else the field;
 * `text` for a text output; a JSON (look) output's field on `unitOutputs` (and
 * the first one's value on `json`), as a finished job's are (`unitJobOutput`).
 * Undefined when nothing is saved yet.
 */
export function unitSavedOutput(u: UnitDescriptor, data: Readonly<Record<string, unknown>>): UnitSavedOutput | undefined {
  const out: Record<string, string> = {}
  // Exactly the legacy media read (output-extractor.ts getActiveResultUrl, then
  // the field): `activeResultIndex ?? 0`, the active result's url when it is not
  // nullish — an empty one included, which then saves nothing — else the field.
  const results = (data.generatedResults as ReadonlyArray<{ url?: string }> | undefined) ?? []
  const active = (data.activeResultIndex as number | undefined) ?? 0
  const activeUrl = results[active]?.url
  for (const h of u.handles.outputs) {
    if (!h.from) continue
    const value = data[h.from] as string | undefined
    if (h.kind === "video" || h.kind === "audio" || h.kind === "image") {
      const url = activeUrl ?? value
      if (url && out[`${h.kind}Url`] === undefined) out[`${h.kind}Url`] = url
    } else if (h.kind === "text" && typeof value === "string" && value && out.text === undefined) out.text = value
  }
  const json = lookOutputValues(u, (h) => (h.from ? data[h.from] : undefined))
  const saved: UnitSavedOutput = { ...out, ...json }
  return Object.keys(saved).length ? saved : undefined
}
