// tools/units/composed-baseline.mjs
// The composed-registry baseline of the node units (§5.8 B PR1b, decided
// 2026-10-16). Every central registry became `legacy ∪ units`; the baseline
// is each composed collection as it was BEFORE that composition, so
// frontend/src/__tests__/units-composed-baseline.test.ts and
// backend/src/__tests__/units-composed-baseline.test.ts prove the composition
// changed nothing (and, from PR2 on, that migrating a node into a unit keeps
// every collection — membership, price, handles, and the order where order
// is observable — exactly as it was).
//
// Each section declares how it is compared (decided 2026-10-16):
//   ordered(x)     — the members in order, compared as one string: an array or
//                    a record whose iteration order a user or an agent can see
//                    (NODE_DEFINITIONS, NODE_OPTIONS, the families, NODE_REGISTRY,
//                    the target-handle candidates, the Copilot's known types)
//   membership(x)  — the members as a set: every Set, every lookup record
//                    (compared as [key, value] entries — each value exact),
//                    every derived list nothing iterates for a user or agent
//
// Refresh after a deliberate change to a legacy registry (a node added, a
// reprice, a relabel): `npm run units:baseline` (tools/units/dump-composed.mjs),
// then review the JSON diff — it must show exactly the change you made.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

export const BASELINE_DIR = "tools/units/__fixtures__"
export const baselineFile = (tree) => `${BASELINE_DIR}/composed-baseline.${tree}.json`

/** The name a function or component is known by (React.memo / forwardRef / lazy wrappers unwrapped). */
function nameOf(v) {
  if (typeof v === "function") return v.displayName || v.name || "(anonymous)"
  if (v && typeof v === "object") return v.displayName || nameOf(v.type) || nameOf(v.render) || "(object)"
  return "(anonymous)"
}

const isReactElement = (v) => v !== null && typeof v === "object" && typeof v.$$typeof === "symbol" && "props" in v

/**
 * A JSON-safe, ORDER-PRESERVING picture of `value`: object keys keep their
 * insertion order (that order is user-visible for most registries), a Set
 * becomes its members in insertion order, a Map its [key, value] entries, a
 * function or component `"ƒ <name>"`, a React element `"<Type>"`.
 */
export function canonical(value, seen = new Set()) {
  if (value === undefined) return "(undefined)"
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  if (typeof value === "bigint") return `${value}n`
  if (typeof value === "symbol") return String(value)
  if (typeof value === "function") return `ƒ ${nameOf(value)}`
  if (isReactElement(value)) return `<${nameOf(value.type)}>`
  if (value instanceof RegExp) return String(value)
  if (seen.has(value)) return "(cycle)"
  seen.add(value)
  try {
    if (value instanceof Set) return [...value].map((v) => canonical(v, seen))
    if (value instanceof Map) return [...value].map(([k, v]) => [canonical(k, seen), canonical(v, seen)])
    if (Array.isArray(value)) return value.map((v) => canonical(v, seen))
    if (typeof value.$$typeof === "symbol") return `ƒ ${nameOf(value)}` // memo / forwardRef / lazy component
    return Object.fromEntries(Object.keys(value).map((k) => [k, canonical(value[k], seen)]))
  } finally {
    seen.delete(value)
  }
}

/** A section compared member for member, IN ORDER (see the header). */
export const ordered = (value) => ({ mode: "ordered", value })
/** A section compared as a SET of members, order ignored (see the header). */
export const membership = (value) => ({ mode: "membership", value })

/** A collection's members: a Map's or a record's [key, value] entries, a Set's or an array's values. */
function membersOf(value) {
  if (value instanceof Map) return [...value]
  if (value instanceof Set || Array.isArray(value)) return [...value]
  if (value && typeof value === "object") return Object.entries(value)
  throw new Error(`a baseline section must be a collection (got ${typeof value})`)
}

/** The baseline shape of a snapshot: name → { mode, members } with every member canonical. */
export function sectionsOf(snapshot) {
  return Object.fromEntries(Object.entries(snapshot).map(([name, s]) => {
    if (!s || (s.mode !== "ordered" && s.mode !== "membership")) throw new Error(`${name}: wrap the section in ordered() or membership()`)
    return [name, { mode: s.mode, members: membersOf(s.value).map((m) => canonical(m)) }]
  }))
}

/**
 * The baseline text: one section per top-level key, one line per member (a
 * node definition, a [credit id, price] entry, a set member), so a deliberate
 * change reads as a one-line diff. Deeper values stay compact.
 */
export function serialize(snapshot) {
  const sections = Object.entries(sectionsOf(snapshot))
  const lines = ["{"]
  sections.forEach(([name, { mode, members }], i) => {
    const comma = i < sections.length - 1 ? "," : ""
    lines.push(`  ${JSON.stringify(name)}: { "mode": ${JSON.stringify(mode)}, "members": [`)
    members.forEach((m, j) => lines.push(`    ${JSON.stringify(m)}${j < members.length - 1 ? "," : ""}`))
    lines.push(`  ] }${comma}`)
  })
  lines.push("}")
  return `${lines.join("\n")}\n`
}

/**
 * What differs between a section's baseline and its current value, by its
 * mode: ordered → the first position whose member differs (or the length);
 * membership → the members missing and the members added (order ignored).
 * Empty = equal.
 */
export function sectionDiff(expected, actual) {
  if (!expected) return ["the section is missing from the baseline"]
  if (expected.mode !== actual.mode) return [`mode is ${actual.mode}, the baseline says ${expected.mode}`]
  const e = expected.members.map((m) => JSON.stringify(m))
  const a = actual.members.map((m) => JSON.stringify(m))
  if (actual.mode === "ordered") {
    if (e.join("\n") === a.join("\n")) return []
    const at = e.findIndex((m, i) => m !== a[i])
    const i = at < 0 ? Math.min(e.length, a.length) : at
    return [`member ${i} differs (in order): baseline ${e[i] ?? "(none)"} — now ${a[i] ?? "(none)"}${e.length !== a.length ? ` (${e.length} → ${a.length} members)` : ""}`]
  }
  const count = (list) => list.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map())
  const ce = count(e)
  const ca = count(a)
  const missing = [...ce].filter(([m, n]) => (ca.get(m) ?? 0) < n).map(([m]) => `- ${m}`)
  const added = [...ca].filter(([m, n]) => (ce.get(m) ?? 0) < n).map(([m]) => `+ ${m}`)
  return [...missing, ...added]
}

/**
 * The baseline at `file` (repo-relative, under `root`) and the snapshot's
 * sections, each { mode, members } — when `write`, the snapshot is written
 * there first.
 */
export function baselineFor(root, file, snapshot, write = false) {
  const abs = path.join(root, file)
  const text = serialize(snapshot)
  if (write) {
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, text)
  }
  if (!existsSync(abs)) throw new Error(`${file} is missing — run npm run units:baseline`)
  return { expected: JSON.parse(readFileSync(abs, "utf8")), actual: JSON.parse(text) }
}
