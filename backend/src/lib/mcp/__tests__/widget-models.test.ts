// @test-watches backend/src/lib/mcp/__tests__/fixtures/tool-surface.json frontend/src/nodes/** backend/src/nodes/**
// The MCP widget-model seam (lib/mcp/widget-models.ts; tools/units/README.md):
// the `model` a verb's result widget shows is the verb's legacy literal ∪ the
// node unit that declares the verb in unit.json `mcp.widgetModelFor`.
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import type { UnitDescriptor } from "@/nodes/kit.js"
import { mcpToolClaims } from "../../../../../tools/units/manifest.mjs"

const h = vi.hoisted(() => ({ dispatchJob: vi.fn(async () => ({ content: [] })) }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/mcp/tools/_verb-helpers.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mcp/tools/_verb-helpers.js")>()),
  dispatchJob: h.dispatchJob,
}))

const { composeWidgetModel, unitWidgetModels, widgetModelOf } = await import("@/lib/mcp/widget-models.js")
const { UNIT_NODE_DESCRIPTORS } = await import("@/lib/unit-descriptors.js")
const { registerVideoVerbs } = await import("@/lib/mcp/tools/verbs-video.js")

/** A fixture unit's descriptor: only the fields the seam reads matter. */
const unit = (type: string, tools?: string[]): UnitDescriptor => ({
  type,
  label: type,
  category: "utility",
  description: "fixture",
  outputType: "video",
  position: { after: null },
  inputs: [],
  outputs: [],
  handles: { inputs: [], outputs: [] },
  execution: { kind: "worker", queue: "video" },
  capabilities: [],
  ...(tools ? { mcp: { widgetModelFor: tools } } : {}),
})

type Handler = (args: Record<string, unknown>) => Promise<unknown>
function fakeServer() {
  const tools = new Map<string, Handler>()
  return { server: { registerTool: (name: string, _config: unknown, handler: Handler) => tools.set(name, handler) } as never, tools }
}

describe("zero behaviour change: gif_to_video's widget model is what the verb sent before", () => {
  it("the unit's declaration composes the legacy literal the verb passed before the migration (decided 2026-10-18)", () => {
    expect(widgetModelOf("gif_to_video")).toBe("gif-to-video")
    expect(() => widgetModelOf("gif_to_video", "gif-to-video")).toThrow()
  })

  it("the real verb dispatches with model \"gif-to-video\"", async () => {
    const { server, tools } = fakeServer()
    registerVideoVerbs({
      server,
      session: { userId: "00000000-0000-4000-8000-000000000001", scopes: ["workflows:execute"], clientName: "test" },
      fastify: {} as never,
    } as never)
    await tools.get("gif_to_video")!({ gif_url: "https://example.com/a.gif" })
    expect(h.dispatchJob).toHaveBeenCalledTimes(1)
    expect(h.dispatchJob.mock.calls[0]).toEqual([
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ url: "/v1/gif-to-video", widgetData: { prompt: "(gif to video)", model: "gif-to-video" } }),
    ])
  })
})

describe("a fixture unit that declares a verb", () => {
  const units = [unit("fixture-echo", ["fixture_echo", "echo_twice"]), unit("fixture-other")]

  it("names the unit's own type, keyed by the tool, with no legacy literal", () => {
    const byTool = unitWidgetModels(units)
    expect({ ...byTool }).toEqual({ fixture_echo: "fixture-echo", echo_twice: "fixture-echo" })
    expect(composeWidgetModel("fixture_echo", undefined, byTool)).toBe("fixture-echo")
    expect(composeWidgetModel("echo_twice", undefined, byTool)).toBe("fixture-echo")
  })

  it("a legacy verb keeps its literal", () => {
    expect(composeWidgetModel("still_to_video", "still-to-video", unitWidgetModels(units))).toBe("still-to-video")
  })

  it("a tool lookup by an Object.prototype name finds no unit", () => {
    expect(() => composeWidgetModel("constructor", undefined, unitWidgetModels(units))).toThrow(/no legacy literal/)
  })

  it("refuses a tool that is both a legacy literal and a unit's", () => {
    expect(() => composeWidgetModel("fixture_echo", "fixture-echo", unitWidgetModels(units))).toThrow(/drop the verb's literal/)
  })

  it("refuses a tool with neither", () => {
    expect(() => composeWidgetModel("nothing_here", undefined, unitWidgetModels(units))).toThrow(/no node unit declares it/)
  })

  it("refuses two units claiming one tool", () => {
    expect(() => unitWidgetModels([...units, unit("fixture-third", ["fixture_echo"])])).toThrow(/claimed by both fixture-echo and fixture-third/)
  })

  it("the gen-time validator (tools/units/manifest.mjs) and the run-time table agree on every claim set — the one-claim rule is written twice and cannot drift", () => {
    const cases: Array<{ claims: Record<string, string[] | undefined>; refused: boolean }> = [
      { claims: { "fixture-echo": ["fixture_echo", "echo_twice"], "fixture-other": undefined }, refused: false },
      { claims: { "fixture-echo": ["fixture_echo", "echo_twice"], "fixture-third": ["fixture_echo"] }, refused: true },
      { claims: { "fixture-echo": ["echo_twice"], "fixture-third": ["fixture_echo", "echo_twice"] }, refused: true },
    ]
    for (const { claims, refused } of cases) {
      const entries = Object.entries(claims)
      const genTime = mcpToolClaims(entries.map(([type, tools]) => ({ type, manifest: tools ? { mcp: { widgetModelFor: tools } } : {} })))
      const runTime = () => unitWidgetModels(entries.map(([type, tools]) => unit(type, tools)))
      expect(genTime.length > 0, JSON.stringify(claims)).toBe(refused)
      if (refused) expect(runTime, JSON.stringify(claims)).toThrow(/claimed by both/)
      else expect(runTime, JSON.stringify(claims)).not.toThrow()
    }
  })
})

describe("the real tree", () => {
  it("every tool a unit declares is a registered MCP tool (tool-surface.json)", () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const surface = JSON.parse(readFileSync(resolve(here, "fixtures/tool-surface.json"), "utf8")) as Record<string, string[]>
    const registered = new Set(Object.entries(surface).filter(([k]) => !k.startsWith("_")).flatMap(([, names]) => names))
    expect(registered.has("gif_to_video")).toBe(true)
    const unknown = Object.keys(unitWidgetModels(UNIT_NODE_DESCRIPTORS)).filter((t) => !registered.has(t))
    expect(unknown).toEqual([])
  })
})
