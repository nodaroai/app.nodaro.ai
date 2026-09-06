import { describe, it, expect, vi } from "vitest"
import Fastify from "fastify"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { type Scope } from "../../scopes.js"

// Audit 2026-09-06 fix #3 (D-8, C-13(4), A-4 / D-4).
//
// MEMBERSHIP: `server-full.test.ts` bounded the catalog to `30..165` tools
// and pinned the unscoped count at 13 — a dropped tool family, or a gated
// family re-registered outside its edition gate, passed CI. This test
// asserts the EXACT name set per (edition × scope grant) from a checked-in
// fixture. Adding a tool is a one-line fixture change made on purpose; the
// studio program's +17 lands the same way.
//
// BUDGET: `tools/list` was 315 KB for 167 tools (+67 % since June) —
// ~80 k tokens of definitions per session on every host, cached for days by
// Claude.ai. A description carries WHEN to use a tool, its preconditions,
// what comes back and its cost class; model tables, caps and prompting
// doctrine live behind `get_node_skill` / `get_recipe` / `list_models`.
// The budget is the tripwire on that rule.
vi.mock("../../supabase.js", () => ({ supabase: { from: vi.fn() } }))
let credits = true
vi.mock("../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => credits }
})
const { buildMcpServer } = await import("../server.js")

const ALL_GRANTED: Scope[] = [
  "workflows:read", "workflows:write", "workflows:execute", "jobs:read",
  "assets:read", "assets:write", "credits:read", "apps:read",
]
const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = JSON.parse(readFileSync(resolve(here, "fixtures/tool-surface.json"), "utf8")) as Record<string, string[]>

/** Per-tool and total wire budget for the cloud edition under ALL_GRANTED. */
// 2026-09-06 baseline after the six trims: max tool 8.1 KB, total 303 KB. The
// headroom is deliberately small — the studio program's +17 tools (≈ +35 KB)
// must raise this on purpose, not slide under it.
export const TOOL_WIRE_BUDGET = { perToolBytes: 8_192, totalBytes: 310_000 }

type ToolDef = { name: string; description?: string }
async function list(scopes: Scope[]): Promise<ToolDef[]> {
  const server = await buildMcpServer({ userId: "u1", scopes, clientName: "Claude", fastify: Fastify() })
  const inner = (server as unknown as {
    server: { _requestHandlers: Map<string, (r: unknown, e: unknown) => Promise<{ tools: ToolDef[] }>> }
  }).server
  const res = await inner._requestHandlers.get("tools/list")!({ method: "tools/list", params: {} }, {})
  return res.tools
}

describe("tool surface — exact membership per edition × scope grant", () => {
  it.each([
    ["cloud", "all", true, ALL_GRANTED],
    ["cloud", "jobs", true, ["jobs:read"] as Scope[]],
    ["cloud", "none", true, [] as Scope[]],
    ["community", "all", false, ALL_GRANTED],
    ["community", "none", false, [] as Scope[]],
  ])("%s edition, %s scopes: the fixture names, nothing more, nothing less", async (edition, grant, hasCredits, scopes) => {
    credits = hasCredits
    const names = (await list(scopes)).map((t) => t.name).sort()
    expect(names).toEqual(FIXTURE[`${edition}/${grant}`])
  })
})

describe("tool surface — wire budget (cloud, all scopes)", () => {
  it("keeps every tool definition and the whole list under budget", async () => {
    credits = true
    const tools = await list(ALL_GRANTED)
    const sizes = tools.map((t) => ({ name: t.name, bytes: JSON.stringify(t).length })).sort((a, b) => b.bytes - a.bytes)
    const over = sizes.filter((s) => s.bytes > TOOL_WIRE_BUDGET.perToolBytes)
    expect(over, `over the ${TOOL_WIRE_BUDGET.perToolBytes} B per-tool budget`).toEqual([])
    const total = sizes.reduce((sum, s) => sum + s.bytes, 0)
    expect(total, `top: ${JSON.stringify(sizes.slice(0, 5))}`).toBeLessThanOrEqual(TOOL_WIRE_BUDGET.totalBytes)
  })
})
