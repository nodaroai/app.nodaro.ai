/**
 * The generated parts of the MCP docs, rendered from the captured tool
 * surfaces (tool-surface.ts):
 *
 * - the Scopes table in docs/mcp/tools.md (an AUTO-GEN block);
 * - docs/mcp/tool-parameters.md, every tool and every parameter it takes.
 *
 * Both used to be written by hand and drifted: tools listed under the wrong
 * scope, 80 tools under none, parameters that had been renamed.
 */
import type { ToolGate, ToolSurface } from "./tool-surface.js"

type Json = Record<string, unknown>

/** How deep a parameter's own fields are listed (`a`, `a.b`, `a.b.c`). */
const MAX_FIELD_DEPTH = 2
const CLOUD_ONLY_MARK = "†"

/** A table cell: one line, pipes escaped, `<` escaped outside code spans. */
function cell(text: string): string {
  return text
    .replace(/\s*\n\s*/g, " ")
    .replace(/\|/g, "\\|")
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/</g, "&lt;")))
    .join("")
    .trim()
}

function code(value: unknown): string {
  return typeof value === "string" ? `\`${value}\`` : `\`${JSON.stringify(value)}\``
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function valueType(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number"
  return typeof value
}

function unionOf(s: Json): Json[] | undefined {
  return (s.anyOf ?? s.oneOf) as Json[] | undefined
}

function typeOf(s: Json): string {
  const union = unionOf(s)
  if (union) return unique(union.map(typeOf)).join(" or ")
  if (Array.isArray(s.enum)) return unique(s.enum.map(valueType)).join(" or ")
  if ("const" in s) return valueType(s.const)
  if (s.type === "array") {
    const item = typeOf((s.items ?? {}) as Json)
    return item.includes(" or ") ? `(${item})[]` : `${item}[]`
  }
  if (s.type === "object" && s.additionalProperties && typeof s.additionalProperties === "object" && !s.properties) {
    return `object (map of ${typeOf(s.additionalProperties as Json)})`
  }
  if (Array.isArray(s.type)) return (s.type as string[]).join(" or ")
  if (s.type === "string" && s.format === "uri") return "string (URL)"
  return typeof s.type === "string" ? s.type : "any"
}

/** "From 2 to 64." and the like; zod's safe-integer bounds say nothing. */
function bound(min: unknown, max: unknown, unit: (n: number) => string): string | undefined {
  const lo = typeof min === "number" && Math.abs(min) < Number.MAX_SAFE_INTEGER ? min : undefined
  const hi = typeof max === "number" && Math.abs(max) < Number.MAX_SAFE_INTEGER ? max : undefined
  if (lo !== undefined && hi !== undefined) return lo === hi ? `Exactly ${unit(lo)}.` : `From ${lo} to ${unit(hi)}.`
  if (lo !== undefined) return `At least ${unit(lo)}.`
  if (hi !== undefined) return `At most ${unit(hi)}.`
  return undefined
}

function constraints(s: Json): string[] {
  const out: string[] = []
  if (Array.isArray(s.enum)) out.push(`One of ${s.enum.map(code).join(", ")}.`)
  if ("const" in s) out.push(`Always ${code(s.const)}.`)
  const plain = (n: number) => String(n)
  out.push(
    ...[
      bound(s.minimum, s.maximum, plain),
      typeof s.exclusiveMinimum === "number" ? `Above ${s.exclusiveMinimum}.` : undefined,
      typeof s.exclusiveMaximum === "number" ? `Below ${s.exclusiveMaximum}.` : undefined,
      bound(s.minLength, s.maxLength, (n) => `${n} character${n === 1 ? "" : "s"}`),
      bound(s.minItems, s.maxItems, (n) => `${n} item${n === 1 ? "" : "s"}`),
    ].filter((note): note is string => note !== undefined),
  )
  return out
}

function describe(s: Json): string {
  const union = unionOf(s) ?? []
  const text = (s.description ?? union.find((m) => typeof m.description === "string")?.description) as
    | string
    | undefined
  const notes = unique([s, ...union].flatMap(constraints))
  if ("default" in s) notes.push(`Default ${code(s.default)}.`)
  const sentence = text?.trim()
  // The notes follow as sentences of their own.
  const lead = sentence && notes.length && !/[.!?:]$/.test(sentence) ? `${sentence}.` : sentence
  return [lead, ...notes].filter(Boolean).join(" ")
}

/** The fields of an object schema (or of the object in a nullable union). */
function fieldsOf(s: Json): Array<[name: string, schema: Json, required: boolean]> {
  const objects = [s, ...(unionOf(s) ?? [])].filter((m) => m.type === "object" && m.properties)
  if (!objects.length) return []
  const single = objects.length === 1
  const seen = new Map<string, [Json, boolean]>()
  for (const object of objects) {
    const required = new Set((object.required ?? []) as string[])
    for (const [name, schema] of Object.entries(object.properties as Record<string, Json>)) {
      if (!seen.has(name)) seen.set(name, [schema, single && required.has(name)])
    }
  }
  return [...seen].map(([name, [schema, required]]) => [name, schema, required])
}

function itemsOf(s: Json): Json | undefined {
  const array = [s, ...(unionOf(s) ?? [])].find((m) => m.type === "array")
  return (array?.items ?? undefined) as Json | undefined
}

interface Row {
  name: string
  type: string
  required: boolean
  description: string
}

function collectRows(name: string, s: Json, required: boolean, depth: number, rows: Row[]): void {
  rows.push({ name, type: typeOf(s), required, description: describe(s) })
  if (depth >= MAX_FIELD_DEPTH) return
  for (const [child, schema, childRequired] of fieldsOf(s)) {
    collectRows(`${name}.${child}`, schema, childRequired, depth + 1, rows)
  }
  const items = itemsOf(s)
  if (items) {
    for (const [child, schema, childRequired] of fieldsOf(items)) {
      collectRows(`${name}[].${child}`, schema, childRequired, depth + 1, rows)
    }
  }
}

function gateText(gate: ToolGate): string {
  if (gate === null) return "Always visible"
  if ("all" in gate) return `Needs ${gate.all.map(code).join(" and ")}`
  return `Needs any of ${gate.any.map(code).join(", ")}`
}

/** docs/mcp/tool-parameters.md in full. */
export function renderToolParametersDoc(cloud: ToolSurface, community: ToolSurface): string {
  const lines = [
    "# MCP tool parameters",
    "",
    "<!-- GENERATED by `cd backend && npm run gen:skills` from the tool schemas the MCP server registers. Do not edit by hand: `npm run gen:skills:check` fails CI when this page drifts. -->",
    "",
    "Every tool the Nodaro MCP server offers and every parameter it takes, read from the server's own input schemas. What each tool is for, and how the tools fit together, is in the [MCP Tool Reference](tools.md).",
    "",
    "This page shows Nodaro Cloud with every scope granted. A client sees only the tools its scopes allow (see [Scopes](tools.md#scopes)), and tools marked **Nodaro Cloud only** are not offered by self-hosted Community and Business installs.",
    "",
    "A parameter written `a.b` is the field `b` of the object `a`, and `a[].b` is the field `b` of each item in the array `a`.",
  ]
  for (const [name, tool] of Object.entries(cloud.tools)) {
    const where = [gateText(tool.gate), ...(name in community.tools ? [] : ["Nodaro Cloud only"])].join(" · ")
    lines.push("", `## \`${name}\``, "", `${where}.`, "")
    const rows: Row[] = []
    const required = new Set((tool.input.required ?? []) as string[])
    for (const [param, schema] of Object.entries((tool.input.properties ?? {}) as Record<string, Json>)) {
      collectRows(param, schema, required.has(param), 0, rows)
    }
    if (!rows.length) {
      lines.push("No parameters.")
      continue
    }
    lines.push("| Parameter | Type | Required | Description |", "|---|---|---|---|")
    for (const row of rows) {
      lines.push(`| \`${row.name}\` | ${cell(row.type)} | ${row.required ? "yes" : ""} | ${cell(row.description)} |`)
    }
  }
  return `${lines.join("\n")}\n`
}

/** The Scopes block of docs/mcp/tools.md: which tools each scope unlocks. */
export function renderScopesBlock(cloud: ToolSurface, community: ToolSurface): string {
  const mark = (name: string) => `\`${name}\`${name in community.tools ? "" : CLOUD_ONLY_MARK}`
  const rows = new Map<string, string[]>()
  const always: string[] = []
  for (const [name, { gate }] of Object.entries(cloud.tools)) {
    if (gate === null) {
      always.push(name)
      continue
    }
    const label = "all" in gate ? gate.all.map(code).join(" + ") : `any of ${gate.any.map(code).join(", ")}`
    rows.set(label, [...(rows.get(label) ?? []), name])
  }
  // One row per scope in the server's order, then the rows that need several.
  const order = [...cloud.scopes.map(code), ...[...rows.keys()].filter((label) => !cloud.scopes.map(code).includes(label))]
  const lines = ["| Scope | Tools |", "|-------|-------|"]
  for (const label of order) {
    const names = rows.get(label)
    if (names) lines.push(`| ${label} | ${names.map(mark).join(", ")} |`)
  }
  lines.push(
    "",
    `**Always visible (no scope):** ${always.map(mark).join(", ")}`,
    "",
    `${CLOUD_ONLY_MARK} Nodaro Cloud only: self-hosted Community and Business installs do not offer this tool.`,
    "",
    "Every tool's parameters: [MCP tool parameters](tool-parameters.md).",
  )
  return lines.join("\n")
}

/**
 * The tools docs/mcp/tools.md gives an entry — a `### \`tool\`` heading or a
 * row of a `| Tool | Description |` table — checked against the tools the
 * server registers, both ways: an entry for a tool that no longer exists,
 * and a tool with no entry, each fail the generation.
 */
export function toolsDocProblems(toolsDoc: string, cloud: ToolSurface): string[] {
  const lines = toolsDoc.split("\n")
  const entries = new Set<string>()
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i]!.match(/^#{2,4} `([a-z0-9_]+)`/)
    if (heading) entries.add(heading[1]!)
    const isToolTable = /^\| Tool \|/.test(lines[i]!) && /^\|[-\s|:]+\|$/.test(lines[i + 1] ?? "")
    if (!isToolTable) continue
    for (let j = i + 2; j < lines.length && lines[j]!.startsWith("|"); j++) {
      const row = lines[j]!.match(/^\| `([a-z0-9_]+)` \|/)
      if (row) entries.add(row[1]!)
    }
  }
  const problems: string[] = []
  for (const name of entries) {
    if (!(name in cloud.tools)) problems.push(`docs/mcp/tools.md has an entry for \`${name}\`, which the MCP server does not register`)
  }
  for (const name of Object.keys(cloud.tools)) {
    if (!entries.has(name)) {
      problems.push(
        `docs/mcp/tools.md has no entry for the MCP tool \`${name}\`: add a \`### \\\`${name}\\\`\` section or a row in a \`| Tool | Description |\` table`,
      )
    }
  }
  return problems
}
