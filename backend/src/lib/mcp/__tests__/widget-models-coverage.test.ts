// @test-watches frontend/src/nodes/** backend/src/nodes/**
// A unit's `mcp.widgetModelFor` is only honoured when the verb it names asks
// for its model through widgetModelOf (lib/mcp/widget-models.ts). A verb that
// hard-codes `model:` would ignore the declaration silently — so every tool
// the real tree declares must have been resolved through widgetModelOf while
// the full MCP server (cloud edition, every scope) registered.
import Fastify from "fastify"
import { describe, expect, it, vi } from "vitest"
import type { Scope } from "../../scopes.js"

const resolved = vi.hoisted(() => new Set<string>())
vi.mock("../../supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../config.js", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), hasCredits: () => true }))
vi.mock("../widget-models.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../widget-models.js")>()
  return {
    ...real,
    widgetModelOf: (tool: string, legacy?: string) => {
      resolved.add(tool)
      return real.widgetModelOf(tool, legacy)
    },
  }
})

const { buildMcpServer } = await import("../server.js")
const { unitWidgetModels } = await import("../widget-models.js")
const { UNIT_NODE_DESCRIPTORS } = await import("../../unit-descriptors.js")

const ALL_GRANTED: Scope[] = [
  "workflows:read", "workflows:write", "workflows:execute", "jobs:read",
  "assets:read", "assets:write", "credits:read", "apps:read",
]

/** The declared tools whose verb never asked widgetModelOf (a hard-coded model ignores the declaration). */
function ignoredDeclarations(declared: Iterable<string>, resolvedTools: ReadonlySet<string>): string[] {
  return [...declared].filter((t) => !resolvedTools.has(t)).sort()
}

describe("every unit's mcp.widgetModelFor is honoured", () => {
  it("the rule on fixtures: a declared tool its verb never resolved is reported", () => {
    expect(ignoredDeclarations(["a_tool", "b_tool"], new Set(["a_tool", "c_tool"]))).toEqual(["b_tool"])
    expect(ignoredDeclarations([], new Set(["a_tool"]))).toEqual([])
  })

  it("each tool the real tree declares was resolved through widgetModelOf while the MCP server registered", async () => {
    resolved.clear()
    await buildMcpServer({ userId: "u1", scopes: ALL_GRANTED, clientName: "Claude", fastify: Fastify() })
    // The seam is live: a verb resolves through it (else the check below is vacuous).
    expect(resolved.has("gif_to_video")).toBe(true)
    expect(ignoredDeclarations(Object.keys(unitWidgetModels(UNIT_NODE_DESCRIPTORS)), resolved)).toEqual([])
  })
})
