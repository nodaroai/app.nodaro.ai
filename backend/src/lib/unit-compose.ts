// backend/src/lib/unit-compose.ts — the pure functions every server registry
// composes its node units with (§5.8 B, decided 2026-10-16;
// tools/units/README.md): `registry = legacy ∪ units`, a type in exactly one
// of the two. Pure and aggregate-free — each composer passes its legacy table
// and the unit collection in — so lib/__tests__/unit-compose.test.ts proves
// every seam on an in-memory fixture unit, and an EMPTY unit collection
// returns every legacy table unchanged (the composed-baseline test proves that
// on the real registries).
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
 * `after` names — or, when that type is not in this collection (a registry
 * that lists fewer nodes than NODE_DEFINITIONS), at the end. Units naming the
 * same place keep type order.
 */
export function placeAfter<T>(legacy: ReadonlyArray<T>, typeOf: (t: T) => string, units: ReadonlyArray<{ readonly type: string; readonly after: string | null; readonly entry: T }>): T[] {
  if (units.length === 0) return [...legacy]
  assertDisjoint("placeAfter", legacy.map(typeOf), units.map((u) => u.type))
  const sorted = [...units].sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))
  const known = new Set([...legacy.map(typeOf), ...units.map((u) => u.type)])
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
 * A unit's saved output, read the way every media node's is: per output
 * handle whose `from` names the node-data field, `<kind>Url` (videoUrl,
 * audioUrl, imageUrl) from the ACTIVE generated result's url, else the field;
 * `text` for a text output. Undefined when nothing is saved yet.
 */
export function unitSavedOutput(u: UnitDescriptor, data: Readonly<Record<string, unknown>>): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  const results = Array.isArray(data.generatedResults) ? (data.generatedResults as ReadonlyArray<{ url?: unknown }>) : []
  const active = typeof data.activeResultIndex === "number" ? data.activeResultIndex : 0
  const activeUrl = typeof results[active]?.url === "string" && results[active]?.url ? (results[active]?.url as string) : undefined
  for (const h of u.handles.outputs) {
    if (!h.from) continue
    const field = typeof data[h.from] === "string" && data[h.from] ? (data[h.from] as string) : undefined
    if (h.kind === "video" || h.kind === "audio" || h.kind === "image") {
      const url = activeUrl ?? field
      if (url && out[`${h.kind}Url`] === undefined) out[`${h.kind}Url`] = url
    } else if (h.kind === "text" && field && out.text === undefined) out.text = field
  }
  return Object.keys(out).length ? out : undefined
}
