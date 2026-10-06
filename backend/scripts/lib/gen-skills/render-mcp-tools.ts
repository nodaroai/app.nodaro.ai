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

/** Distinct schemas, compared by content. */
function uniqueSchemas(schemas: Json[]): Json[] {
  const seen = new Map<string, Json>()
  for (const schema of schemas) seen.set(JSON.stringify(schema), schema)
  return [...seen.values()]
}

/** "integer or number" says no more than "number". */
function joinTypes(types: string[]): string {
  const set = unique(types)
  return (set.includes("number") ? set.filter((t) => t !== "integer") : set).join(" or ")
}

function typeOf(s: Json): string {
  const union = unionOf(s)
  if (union) return joinTypes(union.map(typeOf))
  if (Array.isArray(s.enum)) return joinTypes(s.enum.map(valueType))
  if ("const" in s) return typeof s.type === "string" ? s.type : valueType(s.const)
  if (s.type === "array") {
    const item = typeOf((s.items ?? {}) as Json)
    return item.includes(" or ") ? `(${item})[]` : `${item}[]`
  }
  if (s.type === "object" && s.additionalProperties && typeof s.additionalProperties === "object" && !s.properties) {
    return `object (map of ${typeOf(s.additionalProperties as Json)})`
  }
  if (Array.isArray(s.type)) return joinTypes(s.type as string[])
  if (s.type === "string" && s.format === "uri") return "string (URL)"
  return typeof s.type === "string" ? s.type : "any"
}

/**
 * The values a field is limited to, as one sentence: `enum` and `const` on the
 * schema or on the members of its union ("One of `24`, `30`."). A union that
 * also takes a free type lists its fixed values as extras ("Also takes …").
 */
function allowedValuesNote(s: Json): string | undefined {
  const union = unionOf(s)
  const members = union ?? [s]
  const values: unknown[] = []
  let free = false
  for (const member of members) {
    if (Array.isArray(member.enum)) values.push(...member.enum)
    else if ("const" in member) values.push(member.const)
    else if (member.type !== "null") free = true
  }
  const distinct = [...new Map(values.map((v) => [JSON.stringify(v), v])).values()]
  if (!distinct.length) return undefined
  if (free && union) return `Also takes ${distinct.map(code).join(", ")}.`
  return distinct.length === 1 ? `Always ${code(distinct[0])}.` : `One of ${distinct.map(code).join(", ")}.`
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

/** Numeric, length and item-count limits (the allowed values are {@link allowedValuesNote}'s). */
function constraints(s: Json): string[] {
  const out: string[] = []
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

function describe(s: Json, extra?: string): string {
  const union = unionOf(s) ?? []
  const text = (s.description ?? union.find((m) => typeof m.description === "string")?.description) as
    | string
    | undefined
  const allowed = allowedValuesNote(s)
  const notes = unique([...(allowed ? [allowed] : []), ...[s, ...union].flatMap(constraints)])
  if ("default" in s) notes.push(`Default ${code(s.default)}.`)
  if (extra) notes.push(extra)
  const sentence = text?.trim()
  // The notes follow as sentences of their own.
  const lead = sentence && notes.length && !/[.!?:]$/.test(sentence) ? `${sentence}.` : sentence
  return [lead, ...notes].filter(Boolean).join(" ")
}

interface Field {
  name: string
  schema: Json
  required: boolean
  /** Which branch of a discriminated union the field belongs to, when not all. */
  note?: string
}

/**
 * The property that tells a union's object branches apart: present in every
 * branch, with a fixed value in each (`kind: "prompt" | "scene" | …`).
 */
function discriminatorOf(objects: Json[]): string | undefined {
  const first = objects[0]!.properties as Record<string, Json>
  return Object.keys(first).find((name) =>
    objects.every((object) => {
      const property = (object.properties as Record<string, Json>)[name]
      return property !== undefined && "const" in property
    }),
  )
}

/**
 * The fields of an object schema. A union of objects (a nullable object, or a
 * discriminated union) merges its branches: a field in several branches takes
 * every shape it has there, and a field of some branches says which.
 */
function fieldsOf(s: Json): Field[] {
  const objects = [s, ...(unionOf(s) ?? [])].filter((m) => m.type === "object" && m.properties)
  if (!objects.length) return []
  if (objects.length === 1) {
    const required = new Set((objects[0]!.required ?? []) as string[])
    return Object.entries(objects[0]!.properties as Record<string, Json>).map(([name, schema]) => ({
      name,
      schema,
      required: required.has(name),
    }))
  }
  const tag = discriminatorOf(objects)
  const byName = new Map<string, { schemas: Json[]; tags: unknown[]; requiredTags: unknown[] }>()
  for (const object of objects) {
    const value = tag ? ((object.properties as Record<string, Json>)[tag]!.const as unknown) : undefined
    const required = new Set((object.required ?? []) as string[])
    for (const [name, schema] of Object.entries(object.properties as Record<string, Json>)) {
      const entry = byName.get(name) ?? { schemas: [], tags: [], requiredTags: [] }
      entry.schemas.push(schema)
      entry.tags.push(value)
      if (required.has(name)) entry.requiredTags.push(value)
      byName.set(name, entry)
    }
  }
  return [...byName].map(([name, entry]) => {
    const shapes = uniqueSchemas(entry.schemas)
    const when = (values: unknown[]) => `\`${tag}\` is ${values.map(code).join(" or ")}`
    const inAll = entry.tags.length === objects.length
    const requiredEverywhereItAppears = entry.requiredTags.length === entry.tags.length
    let note: string | undefined
    if (tag && name !== tag) {
      if (!inAll) {
        note = `Only when ${when(entry.tags)}`
        if (requiredEverywhereItAppears) note += " (required there)."
        else if (entry.requiredTags.length) note += `; required when ${when(entry.requiredTags)}.`
        else note += "."
      } else if (entry.requiredTags.length && !requiredEverywhereItAppears) {
        note = `Required when ${when(entry.requiredTags)}.`
      }
    }
    return {
      name,
      schema: shapes.length === 1 ? shapes[0]! : { anyOf: shapes },
      required: inAll && requiredEverywhereItAppears,
      ...(note ? { note } : {}),
    }
  })
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

function collectRows(name: string, s: Json, required: boolean, depth: number, rows: Row[], note?: string): void {
  rows.push({ name, type: typeOf(s), required, description: describe(s, note) })
  if (depth >= MAX_FIELD_DEPTH) return
  for (const field of fieldsOf(s)) {
    collectRows(`${name}.${field.name}`, field.schema, field.required, depth + 1, rows, field.note)
  }
  const items = itemsOf(s)
  if (items) {
    for (const field of fieldsOf(items)) {
      collectRows(`${name}[].${field.name}`, field.schema, field.required, depth + 1, rows, field.note)
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
  // A Windows checkout (core.autocrlf) hands this file over with CRLF; the
  // `$`-anchored table test below would then see no table at all.
  const lines = toolsDoc.split(/\r?\n/)
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
