import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

// Mock supabase so the custom-presets query resolves to an empty list. We
// assert on the FACTORY branch + control flow, which uses the real
// `getFactoryPresets` from @nodaro/shared. Mirrors the thenable-chain mock
// style in apps.test.ts (the query is awaited after .order(...)).
vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

const { registerPresets } = await import("../node-presets.js")
const { supabase } = await import("../../../supabase.js")

/**
 * Thenable Supabase chain mock — awaiting the chain after any sequence of
 * builder calls (.select/.eq/.order) resolves to { data: [], error: null }.
 * The list_node_presets custom-presets query ends in `.order("created_at", ...)`.
 * The get_node_preset custom path (via resolvePreset) instead ends in
 * `.maybeSingle()`, which resolves to { data: null, error: null } — so an
 * unknown id resolves to `null` (not a thrown "x is not a function").
 */
function chainResolvesEmpty() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {}
  const mk = () => chain
  for (const m of ["select", "eq", "order"]) chain[m] = vi.fn(mk)
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }))
  chain.then = (onR: (v: { data: unknown[]; error: null }) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(onR)
  ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain)
}

beforeEach(() => {
  vi.clearAllMocks()
  chainResolvesEmpty()
})

// Session WITH presets:read — the gate is unchanged; this task is not about it.
function presetsServer() {
  const server = buildServer()
  registerPresets({
    server,
    session: newSession({
      userId: "u1",
      scopes: ["presets:read"] as Scope[],
      clientName: "Claude",
    }),
    fastify: Fastify(),
  })
  return server
}

describe("list_node_presets discoverability", () => {
  it("does NOT register without presets:read scope", async () => {
    const server = buildServer()
    registerPresets({
      server,
      session: newSession({
        userId: "u1",
        scopes: [] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("list_node_presets")
  })

  it("bare call with nodeType (no source) now returns FACTORY presets by default", async () => {
    const res = await callTool(presetsServer(), "list_node_presets", { nodeType: "generate-image" })
    expect(res.isError).toBeFalsy()
    const body = JSON.parse(res.content[0]?.text ?? "{}")
    expect(Array.isArray(body.factory)).toBe(true)
    expect(body.factory.length).toBeGreaterThan(50) // generate-image ships 100+
    expect(body.factory.find((p: { id: string }) => p.id === "generate-image/location-board")).toBeTruthy()
  })

  it("no nodeType + default source does NOT error — returns custom + a factory hint", async () => {
    const res = await callTool(presetsServer(), "list_node_presets", {})
    expect(res.isError).toBeFalsy()
    const body = JSON.parse(res.content[0]?.text ?? "{}")
    expect(Array.isArray(body.custom)).toBe(true)
    expect(body.factory).toBeUndefined()
    expect(typeof body.factoryNote).toBe("string") // tells caller to pass nodeType
  })

  it("explicit source:'factory' with no nodeType still errors (back-compat)", async () => {
    const res = await callTool(presetsServer(), "list_node_presets", { source: "factory" })
    expect(res.isError).toBe(true)
  })

  it("explicit source:'custom' returns only custom (no factory)", async () => {
    const res = await callTool(presetsServer(), "list_node_presets", {
      source: "custom",
      nodeType: "generate-image",
    })
    expect(res.isError).toBeFalsy()
    const body = JSON.parse(res.content[0]?.text ?? "{}")
    expect(body.factory).toBeUndefined()
  })
})

describe("get_node_preset (read one preset's full config)", () => {
  it("does NOT register without presets:read scope (gated with list_node_presets)", async () => {
    const server = buildServer()
    registerPresets({
      server,
      session: newSession({
        userId: "u1",
        scopes: [] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("get_node_preset")
  })

  it("returns a factory preset's full config (provider + prompt, stripped data)", async () => {
    const res = await callTool(presetsServer(), "get_node_preset", {
      nodeType: "generate-image",
      presetId: "generate-image/location-board",
    })
    expect(res.isError).toBeFalsy()
    const body = JSON.parse(res.content[0]?.text ?? "{}")
    expect(body.id).toBe("generate-image/location-board")
    expect(body.nodeType).toBe("generate-image")
    expect(body.source).toBe("factory")
    expect(typeof body.data.provider).toBe("string")
    expect(typeof body.data.prompt).toBe("string")
    // extractPresetData strips runtime/graph keys — never leak a node label.
    expect(body.data.label).toBeUndefined()
  })

  it("errors when the preset id is unknown", async () => {
    const res = await callTool(presetsServer(), "get_node_preset", {
      nodeType: "generate-image",
      presetId: "x/y",
    })
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text).toContain("Preset not found")
  })
})
