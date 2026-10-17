// tools/units/templates.mjs
// The string emitters of gen:units. Pure and deterministic: units arrive
// sorted by type, keys sort by code unit, output is LF with no timestamps.
//
// Every aggregate line that exists because of one unit ends `// unit:<type>`.
// The test-select engine reads that: a diff to an aggregate made only of such
// lines is a member added or removed, and it is narrowed like a unit change
// (tools/test-select/registry.mjs). Anything else in an aggregate (the
// template itself) is fixed text, so a template change is a plain change.
import path from "node:path"
import { GENERATED_HEADER } from "./seams.mjs"
import { dataInterfaceName, unitBinding } from "./manifest.mjs"

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const tag = (type) => `// unit:${type}`
const json = (value) => JSON.stringify(value, null, 2)

/** The specifier an aggregate at `from` uses for the unit file `to` (repo paths). */
export function importSpecifier(from, to) {
  let rel = path.posix.relative(path.posix.dirname(from), to)
  if (!rel.startsWith(".")) rel = `./${rel}`
  // Backend modules are Node ESM: every relative import ends in `.js`.
  if (to.startsWith("backend/")) return rel.replace(/\.tsx?$/, ".js")
  return rel.replace(/\.tsx?$/, "")
}

/** The aggregate module of one seam over its members (units that have `agg.member`). */
export function aggregateSource(agg, members) {
  const lines = [
    GENERATED_HEADER,
    `// @registry ${agg.tree === "frontend" ? "frontend/src/nodes" : "backend/src/nodes"}/*/${agg.member}`,
    `// @registry-exports ${agg.id}: ${agg.exportName}${agg.id === "definitions" ? " UnitNodeType UnitNodeData" : ""}`,
  ]
  const dir = (u) => u.dirs[agg.tree]
  // The unit kit types the collection, so a member that does not fit fails typecheck at its line.
  lines.push(`import type { ${agg.kitType} } from "${importSpecifier(agg.out, `${agg.tree === "frontend" ? "frontend/src/nodes" : "backend/src/nodes"}/${agg.kitFile ?? "kit.ts"}`)}"`)
  for (const u of members) lines.push(`import { ${agg.binding} as ${unitBinding(u.type)} } from "${importSpecifier(agg.out, `${dir(u)}/${agg.member}`)}" ${tag(u.type)}`)
  const typed = agg.id === "definitions" ? members.filter((u) => u.typesSource !== null) : []
  for (const u of typed) {
    lines.push(`import type { ${dataInterfaceName(u.type)} as ${unitBinding(u.type)}_data } from "${importSpecifier(agg.out, `${u.dirs.frontend}/types.ts`)}" ${tag(u.type)}`)
  }
  lines.push("")
  if (agg.id === "definitions") {
    // An array: the composer inserts each one at its position.after.
    lines.push(`export const ${agg.exportName}: ReadonlyArray<${agg.kitType}> = [`)
    for (const u of members) lines.push(`  ${unitBinding(u.type)}, ${tag(u.type)}`)
    lines.push("]", "", "export type UnitNodeType =", "  | never")
    for (const u of members) lines.push(`  | ${JSON.stringify(u.type)} ${tag(u.type)}`)
    lines.push("", "export type UnitNodeData =", "  | never")
    for (const u of typed) lines.push(`  | ${unitBinding(u.type)}_data ${tag(u.type)}`)
  } else {
    // Null-prototype: composers look a unit up by any node.type a workflow
    // carries, and on a plain object "constructor" / "toString" / "__proto__"
    // would answer with Object's own members instead of undefined.
    lines.push(`export const ${agg.exportName}: Readonly<Record<string, ${agg.kitType}>> = Object.assign(Object.create(null), {`)
    for (const u of members) lines.push(`  ${JSON.stringify(u.type)}: ${unitBinding(u.type)}, ${tag(u.type)}`)
    lines.push("})")
  }
  return `${lines.join("\n")}\n`
}

const handleIds = (list) => (Array.isArray(list) ? list.map((h) => h.id) : [])

/** frontend/src/nodes/<type>/definition.generated.ts — the manifest as the editor reads it. */
export function definitionSource(unit, priceFallback) {
  const m = unit.manifest
  const def = {
    type: m.type,
    label: m.label,
    category: m.category,
    inputs: handleIds(m.handles?.inputs),
    outputs: handleIds(m.handles?.outputs),
    defaultData: m.defaultData,
    position: m.position,
    picker: m.picker,
    handles: m.handles,
    execution: m.execution,
    capabilities: m.capabilities,
    docs: m.docs,
    // The editor's price mirror (estimates before the server answers),
    // projected from price.ee.ts — never written by hand, never in unit.json.
    priceFallback: priceFallback ?? null,
  }
  return [GENERATED_HEADER, "// The projection of unit.json the editor reads: edit unit.json, then run npm run gen:units.", "", `export const definition = ${json(def)} as const`, ""].join("\n")
}

/** frontend/src/nodes/<type>/labels.generated.ts — the node-label translations of strings.json. */
export function labelsSource(unit) {
  const labels = unit.strings?.labels ?? {}
  const sorted = Object.fromEntries(Object.keys(labels).sort(byCodeUnit).map((k) => [k, labels[k]]))
  return [GENERATED_HEADER, "", `export const labels = ${json(sorted)} as const`, ""].join("\n")
}

/** backend/src/nodes/<type>/descriptor.generated.ts — what /v1/nodes and the engine read. No price. */
export function descriptorSource(unit) {
  const m = unit.manifest
  const desc = {
    type: m.type,
    label: m.label,
    category: m.category,
    description: m.registry.description,
    outputType: m.registry.outputType,
    position: m.position,
    // Its place in /v1/nodes, when the manifest states one apart from position.after.
    ...("after" in m.registry ? { registryPosition: { after: m.registry.after } } : {}),
    inputs: handleIds(m.handles?.inputs),
    outputs: handleIds(m.handles?.outputs),
    handles: m.handles,
    execution: m.execution,
    capabilities: m.capabilities,
  }
  return [GENERATED_HEADER, "// The projection of frontend/src/nodes/" + m.type + "/unit.json the server reads.", "", `export const descriptor = ${json(desc)} as const`, ""].join("\n")
}

/** The `"key": value,` lines of every unit's strings.json for one dict locale. */
export function i18nLines(units, locale) {
  const out = []
  for (const u of units) {
    const keys = u.strings?.keys ?? {}
    for (const k of Object.keys(keys).sort(byCodeUnit)) out.push(`  ${JSON.stringify(k)}: ${JSON.stringify(keys[k][locale])},`)
  }
  return out
}

const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ")
/**
 * The docs/nodes/README.md region: a table of every unit that has a docs page
 * (except a docs.index "hand-written" one, whose row stays where it is),
 * WITH its own header row — in GitHub-flavoured Markdown the region's comment
 * line ends any table above it, so bare rows would render as a paragraph.
 * Nothing at all when no unit has a page.
 */
export function docsRows(units) {
  // A unit with docs.index "hand-written" keeps its hand-placed row (a migrated node).
  const rows = units.filter((u) => u.manifest.docs?.page && u.manifest.docs.index !== "hand-written").map((u) => {
    const m = u.manifest
    return `| [${cell(m.label)}](./${path.posix.relative("docs/nodes", m.docs.page)}) | ${cell(m.registry.description)} | ${cell(m.docs.useCase)} |`
  })
  return rows.length ? ["| Node | Description | When to Use |", "|------|-------------|-------------|", ...rows] : []
}

/** packages/shared/src/generated/unit-contracts.ts — type id + producer kind, nothing else. */
export function contractsSource(units) {
  const rows = units.filter((u) => u.manifest.contract?.producer)
  return [
    GENERATED_HEADER,
    "// The unit contract published in @nodaro/shared (decided 2026-10-16): a node type id and its",
    "// producer kind — never a price, credit id, prompt or doctrine string. producer-types.ts",
    "// composes these rows into the producer sets. Every row is an irrevocable Apache grant.",
    "",
    "export const UNIT_CONTRACTS: ReadonlyArray<readonly [type: string, producer: \"audio\" | \"video\" | \"image\" | \"dynamic\"]> = [",
    ...rows.map((u) => `  [${JSON.stringify(u.type)}, ${JSON.stringify(u.manifest.contract.producer)}], ${tag(u.type)}`),
    "]",
    "",
  ].join("\n")
}

/** packages/render-rules/src/unit-kept-lengths.generated.ts — the units that hand on their video input's length. */
export function keptLengthsSource(units) {
  const mode = (u) => (u.manifest.capabilities?.includes("length:exact-video") ? "exact" : u.manifest.capabilities?.includes("length:pass-video") ? "bound" : null)
  const rows = units.filter((u) => mode(u) !== null)
  return [
    GENERATED_HEADER,
    "// The node units whose output keeps their video input's length (the \"length:*\" capabilities,",
    "// tools/units/capabilities.mjs): \"bound\" keeps at most it, \"exact\" exactly it. kept-length.ts",
    "// composes these rows into LENGTH_KEEPING_VIDEO_TYPES / EXACT_LENGTH_VIDEO_TYPES.",
    "",
    "export const UNIT_KEPT_LENGTHS: ReadonlyArray<readonly [type: string, mode: \"bound\" | \"exact\"]> = [",
    ...rows.map((u) => `  [${JSON.stringify(u.type)}, ${JSON.stringify(mode(u))}], ${tag(u.type)}`),
    "]",
    "",
  ].join("\n")
}

/**
 * `source` with the lines between the `start` and `end` marker lines replaced
 * by `lines`. Each marker must be one whole line, present exactly once, start
 * before end. CRLF files keep their line endings.
 */
export function spliceRegion(source, start, end, lines, where = "file") {
  const eol = source.includes("\r\n") ? "\r\n" : "\n"
  const all = source.split(/\r?\n/)
  const at = (marker) => all.reduce((acc, l, i) => (l.trimEnd() === marker ? [...acc, i] : acc), [])
  const s = at(start)
  const e = at(end)
  if (s.length !== 1 || e.length !== 1 || s[0] > e[0]) {
    throw new Error(`${where}: needs exactly one "${start.trim()}" line followed by one "${end.trim()}" line (found ${s.length} and ${e.length})`)
  }
  return [...all.slice(0, s[0] + 1), ...lines, ...all.slice(e[0])].join(eol)
}
