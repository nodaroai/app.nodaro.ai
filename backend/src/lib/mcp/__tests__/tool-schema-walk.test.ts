/**
 * L4#3 — MCP tool schema ↔ implementation walk.
 *
 * Every `server.registerTool(name, opts, handler)` call in the MCP tool
 * files declares an `inputSchema` with parameter keys. The handler body
 * destructures or reads `args.<key>`. If the schema declares a key the
 * handler never reads, the schema is misleading. If the handler reads a
 * key the schema doesn't declare, the MCP runtime silently drops it
 * (request validation strips unknown fields).
 *
 * The walk is regex-based, not AST-based — sufficient for the structured
 * style the tool files use. Two checks per tool:
 *
 *   1. **Schema is non-trivial** — has at least one parameter key.
 *      Tools with no inputs are flagged via empty-input allowlist.
 *
 *   2. **Every schema key is referenced** somewhere in the file by the
 *      pattern `args.<key>` OR `{ <key> }` (destructuring). False
 *      positives are fine; false negatives (key not used) is the bug.
 *
 * Bug class: developer renames a schema key but forgets to update the
 * handler. Tool silently malfunctions when called from Claude.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"

const TOOLS_DIR = join(__dirname, "..", "tools")
const TOOL_FILES = readdirSync(TOOLS_DIR).filter(
  (f) =>
    f.endsWith(".ts") &&
    !f.endsWith(".d.ts") &&
    !f.endsWith(".test.ts") &&
    !f.startsWith("_") /* helpers like _verb-helpers, _wait-for-job */,
)

interface ParsedTool {
  file: string
  name: string
  schemaKeys: string[]
  /** The full file source — used to check key references in handlers. */
  source: string
}

/**
 * Parse a tool file and return one entry per registerTool call. The shape we
 * scan for:
 *
 *   server.registerTool(
 *     "name",
 *     { ..., inputSchema: { keyA: z.foo(...), keyB: z.bar(...).optional(), ... }, ... },
 *     async (args) => { ... },
 *   )
 *
 * The inputSchema object body is captured by counting braces from the open
 * `{` to its matching `}`.
 */
function parseToolFile(filename: string): ParsedTool[] {
  const path = join(TOOLS_DIR, filename)
  const source = readFileSync(path, "utf8")
  const tools: ParsedTool[] = []

  // Find each `server.registerTool(...)` opening + tool name.
  const callMatches = source.matchAll(
    /server\.registerTool\(\s*["']([^"']+)["']\s*,\s*\{/g,
  )
  for (const m of callMatches) {
    const name = m[1]
    const matchEnd = (m.index ?? 0) + m[0].length
    const inputSchemaIdx = source.indexOf("inputSchema", matchEnd)
    if (inputSchemaIdx === -1) {
      tools.push({ file: filename, name, schemaKeys: [], source })
      continue
    }
    const openIdx = source.indexOf("{", inputSchemaIdx)
    if (openIdx === -1) {
      tools.push({ file: filename, name, schemaKeys: [], source })
      continue
    }
    // Walk to matching `}`
    let depth = 1
    let i = openIdx + 1
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth++
      else if (source[i] === "}") depth--
      i++
    }
    const schemaBody = source.slice(openIdx + 1, i - 1)
    // Top-level keys: lines like `  keyName: z.something(...)` or
    // `  "keyName": z.something(...)`. Only count keys with a direct `z.`
    // value; defensive against future helper functions.
    // Allow whitespace (including newlines) between `z` and `.method()` —
    // multi-line builders like `key: z\n  .string()\n  .optional()` are
    // common for keys with several modifiers.
    const keyMatches = schemaBody.matchAll(
      /^\s*(?:"([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*))\s*:\s*z\s*\./gm,
    )
    const keys = [...keyMatches].map((k) => (k[1] ?? k[2]) as string)
    tools.push({ file: filename, name, schemaKeys: keys, source })
  }
  return tools
}

const ALL_TOOLS: ParsedTool[] = []
for (const f of TOOL_FILES) {
  ALL_TOOLS.push(...parseToolFile(f))
}

/**
 * Tools that legitimately have no input parameters (e.g. `check_balance`,
 * `ping`). Add entries here ONLY when truly parameter-less.
 */
const TOOLS_WITHOUT_INPUTS: ReadonlySet<string> = new Set<string>([
  // Tools confirmed parameter-less by manual inspection. Most "list_*" tools
  // accept pagination params (limit/cursor/search) and are NOT in this set.
  "check_balance",
])

// ---------------------------------------------------------------------------
// Sanity: parser found a non-trivial number of tools.
// ---------------------------------------------------------------------------

describe("MCP tool walk sanity", () => {
  it("found at least 20 registered tools", () => {
    expect(ALL_TOOLS.length).toBeGreaterThanOrEqual(20)
  })

  it("baseline tools were parsed (list_components, get_component_inputs)", () => {
    const names = new Set(ALL_TOOLS.map((t) => t.name))
    expect(names.has("list_components")).toBe(true)
    expect(names.has("get_component_inputs")).toBe(true)
  })

  it("tool names are snake_case (no whitespace, lowercase)", () => {
    for (const t of ALL_TOOLS) {
      expect(
        /^[a-z][a-z0-9_]*$/.test(t.name),
        `Tool "${t.name}" in ${t.file} doesn't follow snake_case naming. MCP tool names should be lowercase letters, digits, and underscores only.`,
      ).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Test 1 — every tool either has at least one schema key OR is in the
// no-inputs allowlist. Empty schemas with no allowlist entry mean the
// developer forgot to add params (or the parser missed them).
// ---------------------------------------------------------------------------

describe("MCP tools declare a non-empty inputSchema", () => {
  it.each(ALL_TOOLS.map((t) => [t.name, t.file, t.schemaKeys.length] as const))(
    'tool "%s" (in %s) has %d schema keys (or is in TOOLS_WITHOUT_INPUTS)',
    (name) => {
      const tool = ALL_TOOLS.find((t) => t.name === name)
      if (!tool) {
        throw new Error(`Tool ${name} not found in ALL_TOOLS — internal test bug`)
      }
      if (TOOLS_WITHOUT_INPUTS.has(name)) return
      expect(
        tool.schemaKeys.length,
        `Tool "${name}" in ${tool.file} has an empty inputSchema. Either it really takes no inputs (add to TOOLS_WITHOUT_INPUTS allowlist with explanation), OR the parser missed the schema body (check that keys use the "key: z.foo()" form, not a helper).`,
      ).toBeGreaterThan(0)
    },
  )
})

// ---------------------------------------------------------------------------
// Test 2 — every schema key is referenced somewhere in the tool's file
// (the handler body lives in the same file).
// ---------------------------------------------------------------------------

describe("MCP tool schema keys are referenced in the handler", () => {
  const cases: Array<[string, string, string]> = []
  for (const t of ALL_TOOLS) {
    for (const k of t.schemaKeys) {
      cases.push([t.name, k, t.file])
    }
  }

  it.each(cases)(
    'tool "%s" — schema key "%s" appears in %s',
    (toolName, key) => {
      const tool = ALL_TOOLS.find((t) => t.name === toolName)
      if (!tool) {
        throw new Error(`Tool ${toolName} not found — internal test bug`)
      }
      const escaped = key.replace(/[$()*+./?[\\\]^{|}-]/g, "\\$&")
      // Reference patterns: args.key, args["key"], or `{ key } = args` /
      // `({ key }) =>` destructuring.
      const pattern = new RegExp(
        `\\bargs\\s*\\.\\s*${escaped}\\b|\\bargs\\s*\\[\\s*["']${escaped}["']\\s*\\]|\\{[^}]*?\\b${escaped}\\b[^}]*?\\}`,
        "s",
      )
      expect(
        pattern.test(tool.source),
        `Tool "${toolName}" declares schema key "${key}" but the handler in ${tool.file} doesn't appear to read it (no \`args.${key}\`, \`args["${key}"]\`, or \`{ ${key} }\` reference found). Either the handler ignores this input (remove from schema), or it reads via a helper fn this static check missed (add an inline comment so future readers don't get confused).`,
      ).toBe(true)
    },
  )
})

// ---------------------------------------------------------------------------
// Test 3 — TOOLS_WITHOUT_INPUTS integrity.
// ---------------------------------------------------------------------------

describe("TOOLS_WITHOUT_INPUTS integrity", () => {
  it("every entry corresponds to a registered tool with no schema keys", () => {
    const stale: string[] = []
    const allNames = new Set(ALL_TOOLS.map((t) => t.name))
    for (const name of TOOLS_WITHOUT_INPUTS) {
      if (!allNames.has(name)) {
        stale.push(`${name} (no longer registered)`)
        continue
      }
      const tool = ALL_TOOLS.find((t) => t.name === name)
      if (tool && tool.schemaKeys.length > 0) {
        stale.push(`${name} (now declares ${tool.schemaKeys.length} keys)`)
      }
    }
    expect(
      stale,
      `These TOOLS_WITHOUT_INPUTS entries are stale — remove from allowlist: ${stale.join(", ")}`,
    ).toEqual([])
  })
})
