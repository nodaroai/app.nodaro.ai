import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { expandVideoOverlayLayer } from "@nodaro/shared"
import { newSession } from "../../session.js"
import type { McpSession } from "../../session.js"
import { buildServer, callTool } from "./_helpers.js"

/**
 * D10 — the workflow-JSON write boundary. An agent-written Video Overlay node
 * never renders the canvas writer that clears a wired layer's `imageUrl` (D3),
 * so every MCP write that carries a graph runs the shared pass: presets are
 * expanded, and a layer whose `overlay<i>` handle the written edges wire keeps
 * no stored `imageUrl`. An unwired layer keeps its own.
 */

vi.mock("../../../supabase.js", () => ({ supabase: { from: vi.fn() } }))
// The bundle's layer URLs are fixtures, not media to copy onto this install.
vi.mock("../../../media-portability.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../media-portability.js")>()
  return {
    ...actual,
    rehostForeignMedia: async (
      nodes: readonly unknown[],
      userId: string,
      opts: { assets?: unknown; settings?: Record<string, unknown> } = {},
    ) => {
      const { report } = await actual.rehostForeignMedia([], userId)
      return {
        nodes: [...nodes],
        ...(opts.assets ? { assets: opts.assets } : {}),
        ...(opts.settings ? { settings: opts.settings } : {}),
        report,
      }
    },
  }
})

const { registerWorkflows } = await import("../workflows.js")
const { supabase } = await import("../../../supabase.js")
const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>

const MCP_PROJECT_ID = "11111111-1111-4111-8111-111111111111"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000001"

function chain(result: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {}
  for (const m of ["select", "eq", "is", "lt", "in", "order", "limit", "insert", "delete", "update"]) {
    obj[m] = vi.fn(() => obj)
  }
  obj.maybeSingle = vi.fn().mockResolvedValue(result)
  obj.single = vi.fn().mockResolvedValue(result)
  obj.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return obj
}

function session(): McpSession {
  const s = newSession({ userId: "u1", scopes: ["workflows:read", "workflows:write"], clientName: "Claude" })
  s.mcpProjectId = MCP_PROJECT_ID
  return s
}

const STALE = "https://cdn.example.com/stale.png"
const OWN = "https://cdn.example.com/own.png"

/** Layer 1 is wired (edge into `overlay`) AND carries a stale URL; layer 2 is not wired. */
const NODES = [
  { id: "img", type: "upload-image", position: { x: 0, y: 0 }, data: { imageUrl: "https://cdn.example.com/wired.png" } },
  {
    id: "vo",
    type: "video-overlay",
    position: { x: 300, y: 0 },
    data: {
      label: "Video Overlay",
      layerCount: 4,
      layers: [
        { imageUrl: STALE, start: 1, end: 3, preset: "card" },
        { imageUrl: OWN, start: 2 },
      ],
    },
  },
]
const EDGES = [{ id: "e1", source: "img", sourceHandle: "image", target: "vo", targetHandle: "overlay" }]

function writtenLayers(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const vo = (payload.nodes as Array<{ id: string; data: { layers: Array<Record<string, unknown>> } }>).find((n) => n.id === "vo")
  return vo!.data.layers
}

function assertD10(layers: Array<Record<string, unknown>>) {
  expect(layers[0]).not.toHaveProperty("imageUrl")
  expect(layers[0]).toEqual(expandVideoOverlayLayer({ start: 1, end: 3, preset: "card" }))
  expect(layers[1]).toEqual(expandVideoOverlayLayer({ imageUrl: OWN, start: 2 }))
}

/** The argument of the first `insert` / `update` call across every `from()` builder. */
function firstCall(method: "insert" | "update"): Record<string, unknown> {
  for (const r of fromMock.mock.results) {
    const fn = (r.value as Record<string, ReturnType<typeof vi.fn>>)[method]
    if (fn?.mock.calls.length) return fn.mock.calls[0]![0] as Record<string, unknown>
  }
  throw new Error(`no ${method} call`)
}

/** Every `insert` / `update` argument that writes a node list, in call order. */
function nodeWrites(method: "insert" | "update"): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const r of fromMock.mock.results) {
    const fn = (r.value as Record<string, ReturnType<typeof vi.fn>>)[method]
    for (const call of fn?.mock.calls ?? []) {
      const arg = call[0] as Record<string, unknown>
      if (Array.isArray(arg?.nodes)) out.push(arg)
    }
  }
  return out
}

beforeEach(() => {
  vi.clearAllMocks()
  fromMock.mockImplementation(() =>
    chain({ data: { id: WORKFLOW_ID, name: "Flow", created_at: "x", updated_at: "t1" }, error: null }),
  )
})

describe("Video Overlay — the D10 write-boundary pass", () => {
  it("create_workflow clears a wired layer's imageUrl and expands presets", async () => {
    const server = buildServer()
    registerWorkflows({ server, session: session(), fastify: Fastify() })
    const result = await callTool(server, "create_workflow", { name: "Flow", nodes: NODES, edges: EDGES })
    expect(result.isError).toBeUndefined()
    assertD10(writtenLayers(firstCall("insert")))
  })

  it("update_workflow_json (full body) does the same", async () => {
    const server = buildServer()
    registerWorkflows({ server, session: session(), fastify: Fastify() })
    const result = await callTool(server, "update_workflow_json", { workflow_id: WORKFLOW_ID, nodes: NODES, edges: EDGES })
    expect(result.isError).toBeUndefined()
    assertD10(writtenLayers(firstCall("update")))
  })

  it("update_workflow_json: an edge-only SECOND write (the node data unchanged) clears the layer it newly wires (spec §7)", async () => {
    const server = buildServer()
    registerWorkflows({ server, session: session(), fastify: Fastify() })
    // First write: no edges — both layers keep their own URL (expanded).
    await callTool(server, "update_workflow_json", { workflow_id: WORKFLOW_ID, nodes: NODES, edges: [] })
    const first = nodeWrites("update")[0]!
    expect(writtenLayers(first)[0]).toHaveProperty("imageUrl", STALE)
    expect(writtenLayers(first)[1]).toHaveProperty("imageUrl", OWN)
    // Second write: the SAME stored nodes, one new edge into overlay2 — no node data touched.
    const wireLayer2 = { id: "e2", source: "img", sourceHandle: "image", target: "vo", targetHandle: "overlay2" }
    const result = await callTool(server, "update_workflow_json", { workflow_id: WORKFLOW_ID, nodes: first.nodes, edges: [wireLayer2] })
    expect(result.isError).toBeUndefined()
    const second = writtenLayers(nodeWrites("update")[1]!)
    expect(second[1]).not.toHaveProperty("imageUrl")
    expect(second[0]).toHaveProperty("imageUrl", STALE)
  })

  it("import_workflow does the same", async () => {
    const bundle = { version: 1, exportedAt: "2026-09-24T00:00:00Z", name: "Flow", nodes: NODES, edges: EDGES, settings: {} }
    const server = buildServer()
    registerWorkflows({ server, session: session(), fastify: Fastify() })
    const result = await callTool(server, "import_workflow", { workflow_json: JSON.stringify(bundle) })
    expect(result.isError).toBeUndefined()
    assertD10(writtenLayers(firstCall("insert")))
  })

  it("leaves a graph with no video-overlay node exactly as written", async () => {
    const nodes = [{ id: "t", type: "text-prompt", position: { x: 0, y: 0 }, data: { text: "hi" } }]
    const server = buildServer()
    registerWorkflows({ server, session: session(), fastify: Fastify() })
    await callTool(server, "create_workflow", { name: "Flow", nodes, edges: [] })
    expect(firstCall("insert").nodes).toEqual(nodes)
  })
})
