// @test-watches docs/mcp/tool-parameters.md backend/src/lib/mcp/** backend/src/ee/video-director/orchestrate.ts
/**
 * THE TOOL-TO-NEED TABLE, HELD TO THE CODE (lib/mcp/tool-needs.ts).
 *
 *  1. TOTALITY: every tool the MCP server offers anywhere — the tools the
 *     generated `docs/mcp/tool-parameters.md` lists, Nodaro Cloud with every
 *     scope, which `gen:skills:check` keeps equal to what the server registers
 *     — has exactly one entry, and the table names no other tool. Building
 *     the server under Vitest also fails on any tool with no entry
 *     (`tool-offer.ts`), so every suite that builds one is part of this guard.
 *  2. EVERY NEED RESOLVES: each route is a node-running route, its node read
 *     through lib/route-node-gate.ts as the credit guard reads it; each node
 *     the table names directly is one the availability funnel knows; a model
 *     family is one the catalog has and the route's own default model belongs
 *     to; a need for nothing says why.
 *  3. THE TABLE AGREES WITH THE CODE: each node-running route a tool's own
 *     registration calls is a route it declares, each route it declares is one
 *     its file (or a helper that file imports) calls, every node-running route
 *     anywhere in lib/mcp is declared by some tool, and a Video Director step
 *     is a route the chain's own file calls.
 *
 * `TOOL_NEEDS_TABLE=<file>` writes the measured table (tool, class, nodes) there.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import Fastify from "fastify"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { WORLD_IDS } from "@nodaro/shared/runtime-config"
import { ALL_SCOPES } from "../../scopes.js"

vi.mock("../../supabase.js", () => ({ supabase: { from: vi.fn() } }))
let credits = true
vi.mock("../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => credits }
})

const { TOOL_NEEDS } = await import("../tool-needs.js")
type ToolNeed = (typeof TOOL_NEEDS)[string]
const { routeNodeGate, isKnownNodeType } = await import("../../route-node-gate.js")
const { __availabilityUniverseReadyForTests } = await import("../../availability-override.js")
const { RESOLVED_MODEL_OF_JOB, resolvedModelOfJob } = await import("../../job-resolved-model.js")
const { buildMcpServer } = await import("../server.js")

const here = dirname(fileURLToPath(import.meta.url))
const MCP_DIR = resolve(here, "..")
const REPO_ROOT = resolve(here, "../../../../..")

// ── Inputs ─────────────────────────────────────────────────────────────────

/** Every tool the generated parameter page documents (Nodaro Cloud, every scope). */
const DOCUMENTED_TOOLS: readonly string[] = [
  ...readFileSync(join(REPO_ROOT, "docs/mcp/tool-parameters.md"), "utf8").matchAll(/^## `([a-z0-9_]+)`/gm),
].map((m) => m[1]!)

/** Source without comments, line breaks kept so line numbers still match. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1")
}

/** A route as a pattern of segments, every parameter (`:id`, `${…}`) one wildcard. */
function routePattern(route: string): string {
  return route
    .replace(/\$\{[^}]*\}/g, ":")
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ":")
    .split("?")[0]!
}

/** Does a route literal of the code (with wildcards) stand for the declared route? */
function literalCovers(literal: string, declared: string): boolean {
  const a = routePattern(literal).split("/")
  const b = routePattern(declared).split("/")
  return a.length === b.length && a.every((seg, i) => seg === b[i] || seg === ":" || b[i] === ":")
}

/** The `/v1/…` route literals of a source text. */
function routeLiterals(source: string): string[] {
  return [...source.matchAll(/["`](\/v1\/[^"`\s]*)["`]/g)].map((m) => routePattern(m[1]!))
}

/** A literal the funnel would read as a node-running route (a wildcard segment never resolves). */
function isNodeRoute(literal: string): boolean {
  return routeNodeGate(literal.replace(/(^|\/):(?=\/|$)/g, "$1:p"), {}).kind === "node"
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) {
      if (entry !== "__tests__") out.push(...walk(p))
    } else if (entry.endsWith(".ts")) out.push(p)
  }
  return out
}

/** A declared route need, as a path and body. */
function routeOf(need: string | { route: string; body: Readonly<Record<string, unknown>> }) {
  return typeof need === "string" ? { route: need, body: {} } : need
}

/** The node types one route need resolves to (the credit guard's resolution). */
function nodesOfRoute(need: string | { route: string; body: Readonly<Record<string, unknown>> }): readonly string[] {
  const { route, body } = routeOf(need)
  const gate = routeNodeGate(route, body)
  return gate.kind === "node" ? gate.types : []
}

/** What a need resolves to, for the measured table. */
function classify(need: ToolNeed): string {
  if (need.none !== undefined) return "none"
  const parts: string[] = []
  if (need.routes) parts.push(need.routes.length > 1 ? "node (any lane)" : "node")
  if (need.steps) parts.push("steps")
  if (need.nodes) parts.push(need.nodes.some((n) => !isKnownNodeType(n) || ["cast-swap", "film-pipeline", "video-director"].includes(n)) ? "feature" : "node (declared)")
  if (need.world) parts.push("world")
  if (need.linkImports) parts.push("link imports")
  if (need.modelFamily) parts.push("model family")
  return parts.join(" + ")
}

// ── Where each tool registers ──────────────────────────────────────────────

interface Site {
  file: string
  line: number
}
const sites = new Map<string, Site>()

/** The first frame of a registration that is the tool's own code (not the patches in front of the SDK). */
function siteOf(stack: string): Site | undefined {
  for (const frame of stack.split("\n").slice(1)) {
    const m = /\((\/[^)]+\.ts):(\d+):\d+\)$/.exec(frame) ?? /at (\/[^ ]+\.ts):(\d+):\d+$/.exec(frame)
    if (!m) continue
    const file = m[1]!
    if (!file.startsWith(MCP_DIR) || file.includes("__tests__") || file.endsWith("tool-offer.ts") || file.endsWith("flows/user-request.ts")) continue
    return { file, line: Number(m[2]) }
  }
  return undefined
}

/** A tool no census build registers (an engine or an organizations build it needs): found by its name in the source. */
function siteByName(name: string): Site | undefined {
  for (const file of walk(MCP_DIR)) {
    const lines = readFileSync(file, "utf8").split("\n")
    const i = lines.findIndex((l, idx) => /registerTool\(/.test(l) && new RegExp(`["'\`]${name}["'\`]`).test(l + (lines[idx + 1] ?? "")))
    if (i >= 0) return { file, line: i + 1 }
  }
  return undefined
}

/** The tool's registration span: its `registerTool(` line up to the next one in its file. */
function spanOf(site: Site): string {
  const lines = withoutComments(readFileSync(site.file, "utf8")).split("\n")
  const start = site.line - 1
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/registerTool\(/.test(lines[i]!)) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join("\n")
}

/** The file plus the lib/mcp helpers it imports directly. */
function fileAndHelpers(file: string): string {
  const source = readFileSync(file, "utf8")
  const helpers = [...source.matchAll(/from "(\.{1,2}\/[^"]+)\.js"/g)]
    .map((m) => resolve(dirname(file), `${m[1]}.ts`))
    .filter((p) => p.startsWith(MCP_DIR) && existsSync(p))
  return [source, ...helpers.map((p) => readFileSync(p, "utf8"))].map(withoutComments).join("\n")
}

beforeAll(async () => {
  await __availabilityUniverseReadyForTests()
  const original = McpServer.prototype.registerTool
  const spy = vi.spyOn(McpServer.prototype, "registerTool").mockImplementation(function (this: McpServer, ...args: unknown[]) {
    const name = args[0] as string
    const site = siteOf(new Error().stack ?? "")
    if (site && !sites.has(name)) sites.set(name, site)
    return (original as (...a: unknown[]) => unknown).apply(this, args) as never
  })
  for (const cloud of [true, false]) {
    credits = cloud
    await buildMcpServer({ userId: "u1", scopes: [...ALL_SCOPES], clientName: "Claude", fastify: Fastify() })
  }
  credits = true
  spy.mockRestore()
  for (const name of Object.keys(TOOL_NEEDS)) {
    if (!sites.has(name)) {
      const site = siteByName(name)
      if (site) sites.set(name, site)
    }
  }
}, 120_000)

afterAll(() => {
  const out = process.env.TOOL_NEEDS_TABLE
  if (!out) return
  const rows = Object.entries(TOOL_NEEDS)
    .map(([name, need]) => {
      const nodes = [
        ...(need.routes ?? []).flatMap((r) => nodesOfRoute(r)),
        ...(need.steps ?? []).flatMap((r) => nodesOfRoute(r)),
        ...(need.nodes ?? []),
      ]
      const extra = [need.world ? `world ${need.world}` : "", need.linkImports ? "link imports" : "", need.modelFamily ? `a ${need.modelFamily} model` : ""].filter(Boolean)
      const site = sites.get(name)
      return { name, cls: classify(need), needs: [...new Set(nodes)].join(need.routes && need.routes.length > 1 ? " | " : ", "), extra: extra.join(", "), why: need.none ?? need.why ?? "", file: site ? relative(MCP_DIR, site.file) : "" }
    })
    .sort((a, b) => a.cls.localeCompare(b.cls) || a.name.localeCompare(b.name))
  writeFileSync(out, JSON.stringify(rows, null, 2))
})

// ── 1. Totality ────────────────────────────────────────────────────────────

/** The tools the table should name but does not, and the names it holds that are no tool. */
function totalityProblems(table: Readonly<Record<string, unknown>>, tools: readonly string[]): { missing: string[]; stale: string[] } {
  const declared = new Set(Object.keys(table))
  const offered = new Set(tools)
  return { missing: [...offered].filter((t) => !declared.has(t)).sort(), stale: [...declared].filter((t) => !offered.has(t)).sort() }
}

describe("TOOL_NEEDS — totality", () => {
  it("names every tool the server documents, and nothing else", () => {
    expect(DOCUMENTED_TOOLS.length).toBeGreaterThan(200)
    expect(totalityProblems(TOOL_NEEDS, DOCUMENTED_TOOLS)).toEqual({ missing: [], stale: [] })
  })

  it("covers every tool the server registered while this suite built it (Cloud and Community, every scope)", () => {
    for (const name of sites.keys()) expect(Object.hasOwn(TOOL_NEEDS, name), name).toBe(true)
  })

  it("bites when an entry is removed: the census names it, and building the server fails", async () => {
    const { generate_image: _dropped, ...without } = TOOL_NEEDS
    expect(totalityProblems(without, DOCUMENTED_TOOLS).missing).toEqual(["generate_image"])
    const server = await buildMcpServer({ userId: "u1", scopes: [], clientName: "Claude", fastify: Fastify() })
    expect(() => server.registerTool("an_undeclared_tool", { description: "x" }, async () => ({ content: [] }))).toThrow(/no entry in TOOL_NEEDS/)
  })
})

// ── 2. Every need resolves ─────────────────────────────────────────────────

describe("TOOL_NEEDS — every need resolves", () => {
  const entries = Object.entries(TOOL_NEEDS)

  it.each(entries)("%s", (name, need) => {
    if (need.none !== undefined) {
      expect(need.none.length, `${name}: why it needs nothing`).toBeGreaterThan(10)
      expect(Object.keys(need), `${name}: a need for nothing carries nothing else`).toEqual(["none"])
      return
    }
    const declaredSomething = need.routes || need.steps || need.nodes || need.world || need.linkImports
    expect(declaredSomething, `${name}: declares what it needs`).toBeTruthy()
    for (const route of [...(need.routes ?? []), ...(need.steps ?? [])]) {
      const types = nodesOfRoute(route)
      expect(types.length, `${name}: ${JSON.stringify(route)} runs a node (lib/route-node-gate.ts)`).toBeGreaterThan(0)
      for (const t of types) expect(isKnownNodeType(t), `${name}: ${t} is a node the funnel knows`).toBe(true)
    }
    // Lanes of one route told apart by their body must pick different nodes.
    const bodyLanes = (need.routes ?? []).filter((r) => typeof r !== "string")
    if (bodyLanes.length > 0) {
      const nodes = bodyLanes.map((r) => nodesOfRoute(r).join("|"))
      expect(new Set(nodes).size, `${name}: each body lane picks its own node`).toBe(nodes.length)
    }
    if (need.steps) expect(need.stepsIn, `${name}: names the file that calls its steps`).toBeTruthy()
    if (need.nodes) {
      expect(need.why && need.why.length > 10, `${name}: says why it needs ${need.nodes.join(", ")}`).toBe(true)
      for (const n of need.nodes) expect(isKnownNodeType(n), `${name}: ${n}`).toBe(true)
    }
    if (need.world) expect(WORLD_IDS).toContain(need.world)
    if (need.modelFamily) {
      const family = Object.values(MODEL_CATALOG).filter((m) => m.family === need.modelFamily)
      expect(family.length, `${name}: the catalog has ${need.modelFamily} models`).toBeGreaterThan(0)
      // The route's own model door: the model it runs when the call names none is one of the family.
      for (const route of need.routes ?? []) {
        for (const job of nodesOfRoute(route)) {
          expect(Object.hasOwn(RESOLVED_MODEL_OF_JOB, job), `${name}: ${job} judges the model it runs (runModel)`).toBe(true)
          const model = resolvedModelOfJob(job, {})
          expect(MODEL_CATALOG[model as string]?.family, `${name}: ${job}'s default model ${model}`).toBe(need.modelFamily)
        }
      }
    }
  })
})

// ── 3. The table agrees with the code ──────────────────────────────────────

describe("TOOL_NEEDS — agrees with the code that registers each tool", () => {
  it("finds where every tool registers", () => {
    const unfound = Object.keys(TOOL_NEEDS).filter((t) => !sites.has(t))
    expect(unfound).toEqual([])
  })

  it("each node-running route a tool's own registration calls is one it declares", () => {
    const undeclared: string[] = []
    for (const [name, need] of Object.entries(TOOL_NEEDS)) {
      const site = sites.get(name)
      if (!site) continue
      const declared = [...(need.routes ?? []).map((r) => routeOf(r).route), ...(need.steps ?? [])]
      for (const literal of routeLiterals(spanOf(site))) {
        if (!isNodeRoute(literal)) continue
        if (!declared.some((d) => literalCovers(literal, d))) undeclared.push(`${name} calls ${literal} (${relative(MCP_DIR, site.file)}:${site.line})`)
      }
    }
    expect(undeclared).toEqual([])
  })

  it("each route a tool declares is one its file, or a helper it imports, calls", () => {
    const unfound: string[] = []
    for (const [name, need] of Object.entries(TOOL_NEEDS)) {
      if (!need.routes || need.fromRegistry) continue
      const site = sites.get(name)
      if (!site) continue
      const literals = routeLiterals(fileAndHelpers(site.file))
      for (const r of need.routes) {
        const { route } = routeOf(r)
        if (!literals.some((l) => literalCovers(l, route))) unfound.push(`${name}: ${route} (${relative(MCP_DIR, site.file)})`)
      }
    }
    expect(unfound).toEqual([])
  })

  it("every node-running route anywhere in lib/mcp is declared by some tool", () => {
    const declared = Object.values(TOOL_NEEDS).flatMap((n) => [...(n.routes ?? []).map((r) => routeOf(r).route), ...(n.steps ?? [])])
    const orphans: string[] = []
    for (const file of walk(MCP_DIR)) {
      for (const literal of routeLiterals(withoutComments(readFileSync(file, "utf8")))) {
        if (isNodeRoute(literal) && !declared.some((d) => literalCovers(literal, d))) orphans.push(`${relative(MCP_DIR, file)}: ${literal}`)
      }
    }
    expect([...new Set(orphans)]).toEqual([])
  })

  it("a declared step is a route the file that runs the steps calls", () => {
    for (const [name, need] of Object.entries(TOOL_NEEDS)) {
      if (!need.steps) continue
      const literals = routeLiterals(withoutComments(readFileSync(join(REPO_ROOT, need.stepsIn!), "utf8")))
      for (const step of need.steps) expect(literals.some((l) => literalCovers(l, step)), `${name}: ${step} in ${need.stepsIn}`).toBe(true)
    }
  })
})
