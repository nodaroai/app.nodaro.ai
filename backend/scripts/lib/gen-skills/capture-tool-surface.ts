/**
 * Child-process entry for gen-skills: capture the MCP tool surface of the
 * edition this process was started as, and write it as JSON.
 *
 *   capture-tool-surface.ts <out.json>
 *
 * Spawned by tool-surface.ts, which sets the whole environment (the edition
 * and flags being documented) — see there for why. Not run by hand.
 */
import { writeFileSync } from "node:fs"
import { z } from "zod"
import { ALL_SCOPES } from "../../../src/lib/scopes.js"
import { publishStandInPluginServices } from "../../../src/lib/private-plugins/load.js"
import { setPluginEngines } from "../../../src/lib/private-plugins/engine-registry.js"
import { captureMcpToolSchemas } from "./capture-mcp-schemas.js"
import type { PluginEngines, PluginServices } from "../../../src/lib/private-plugins/types.js"
import type { Edition, ToolGate, ToolSurface } from "./tool-surface.js"

const outPath = process.argv[2]
const edition = process.env.EDITION as Edition | undefined
if (!outPath || (edition !== "cloud" && edition !== "community")) {
  console.error("capture-tool-surface.ts <out.json>, spawned with EDITION=cloud|community")
  process.exit(2)
}

if (edition === "cloud") {
  // Nodaro Cloud always runs with the private plugin loaded, and some tools
  // register only when it provides a service or an engine (the workspace
  // tools ask for `orgs`, 3D Render Pro for an engine that implements it).
  // Here everything a registration asks about exists; nothing may be CALLED —
  // capturing builds schemas and never runs a handler, and a registration
  // that calls a stand-in fails the capture instead of silently shrinking it.
  //
  // Both maps name EVERY member of their type, so a service or engine added
  // to the plugin contract fails tsc here until the capture covers it.
  const standIn = (): never => {
    throw new Error("a stand-in plugin member was called while capturing the MCP tool surface")
  }
  const engine = new Proxy({}, { get: () => standIn }) as never
  const services: Required<{ [K in keyof PluginServices]: never }> = {
    publicWorkflow: {} as never,
    orgs: {} as never,
    billing: {} as never,
    ugc: {} as never,
    policy: {} as never,
    collab: {} as never,
  }
  const engines: Required<{ [K in keyof PluginEngines]: never }> = { scene3d: engine, surround: engine, smartCut: engine }
  publishStandInPluginServices(services)
  setPluginEngines(engines)
}

/** The tool's input as JSON Schema: what a client is told it may send. */
function inputJsonSchema(shape: Record<string, unknown>): Record<string, unknown> {
  return z.toJSONSchema(z.object(shape as z.ZodRawShape), { io: "input", unrepresentable: "any" }) as Record<
    string,
    unknown
  >
}

const registered = new Map<string, Set<string>>()
/** The tools registered for a session granted exactly `scopes`. */
async function toolsWith(scopes: readonly string[]): Promise<Set<string>> {
  const key = [...scopes].sort().join(" ")
  let names = registered.get(key)
  if (!names) {
    names = new Set((await captureMcpToolSchemas(scopes)).map((t) => t.name))
    registered.set(key, names)
  }
  return names
}

/**
 * The scopes a tool needs, read off the registrations: every scope whose
 * withholding hides the tool is required (`all`); a tool no single
 * withholding hides needs `any` one of the scopes that show it alone. A gate
 * of another shape fails the generation rather than being written down wrong.
 */
async function gateOf(tool: string): Promise<ToolGate> {
  if ((await toolsWith([])).has(tool)) return null
  const needed: string[] = []
  for (const scope of ALL_SCOPES) {
    if (!(await toolsWith(ALL_SCOPES.filter((s) => s !== scope))).has(tool)) needed.push(scope)
  }
  if (needed.length) {
    if (!(await toolsWith(needed)).has(tool)) throw new Error(`${tool}: its scope gate is not a plain set of scopes`)
    return { all: needed }
  }
  const any: string[] = []
  for (const scope of ALL_SCOPES) if ((await toolsWith([scope])).has(tool)) any.push(scope)
  if (!any.length) throw new Error(`${tool}: its scope gate needs a combination this capture does not model`)
  return { any }
}

const all = [...(await captureMcpToolSchemas(ALL_SCOPES))].sort((a, b) => a.name.localeCompare(b.name))
const surface: ToolSurface = { edition, scopes: [...ALL_SCOPES], tools: {} }
for (const tool of all) {
  surface.tools[tool.name] = { gate: await gateOf(tool.name), input: inputJsonSchema(tool.inputSchema) }
}

writeFileSync(outPath, JSON.stringify(surface))
// The MCP server's module graph opens infra handles (Redis); see gen-skills.ts.
process.exit(0)
