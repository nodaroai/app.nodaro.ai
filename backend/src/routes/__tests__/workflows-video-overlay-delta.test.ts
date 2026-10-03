/**
 * D10 on the id-keyed DELTA save — PATCH /v1/workflows/:id with `delta`, the
 * route MCP `update_workflow_json`'s `delta` form forwards to verbatim. An
 * agent's edge-only edit wires an EXISTING Video Overlay node's layer handle
 * without sending the node: the route reads the stored graph (only for a
 * delta that touches Video Overlay), clears that layer's stored imageUrl and
 * sends the node along in the RPC's upserts. Any other delta pays no read.
 *
 * And on the REST full-body saves (D10 holds on EVERY save path) —
 * POST /v1/workflows, POST /v1/projects/:projectId/workflows,
 * POST /v1/workflows/import and the non-delta
 * PATCH /v1/workflows/:id: the written nodes are normalised against the edges
 * the save leaves behind (a PATCH without `edges` keeps the stored ones), and
 * an edges-only PATCH that wires a stored layer writes that node back cleared.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { expandVideoOverlayLayer } from "@nodaro/shared"

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
  },
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => false,
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

// The import bundle's layer URLs are fixtures, not media to copy onto this install.
vi.mock("@/lib/media-portability.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/media-portability.js")>()
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

vi.mock("@/lib/node-registry.js", () => ({
  NODE_REGISTRY: [
    { type: "text-prompt", category: "input" },
    { type: "upload-image", category: "input" },
    { type: "video-overlay", category: "processing" },
  ],
}))

import { workflowRoutes } from "../workflows.js"
import { supabase } from "../../lib/supabase.js"
import {
  __resetAvailabilityOverridesForTests,
  __availabilityUniverseReadyForTests,
} from "../../lib/availability-override.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const PROJECT_ID = "00000000-0000-4000-8000-000000000010"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000030"
const STALE = "https://r2.test/stale.png"
const OWN = "https://r2.test/own.png"
const STORED_NODES = [
  { id: "img", type: "upload-image", position: { x: 0, y: 0 }, data: { label: "Card", url: "https://r2.test/wired.png" } },
  {
    id: "vo",
    type: "video-overlay",
    position: { x: 400, y: 0 },
    data: { label: "Video Overlay", layerCount: 4, layers: [{ imageUrl: STALE, start: 1, preset: "card" }, { imageUrl: OWN, start: 2 }] },
  },
]

/**
 * Serves the stored row; records every `select` on `workflows` so a read can be
 * counted, and every `insert` / `update` written to `workflows`.
 */
function serve(opts: { storedNodes?: unknown[]; storedEdges?: unknown[]; updateMatchesNoRow?: boolean } = {}) {
  const workflowReads: string[] = []
  const workflowWrites: Array<Record<string, unknown>> = []
  /** The `eq` filters of every `update` on `workflows` (the CAS pins). */
  const updateFilters: unknown[][] = []
  const row = {
    id: WORKFLOW_ID, project_id: null, user_id: OWNER, workspace_id: null, visibility: "private",
    nodes: opts.storedNodes ?? STORED_NODES, edges: opts.storedEdges ?? [], settings: {}, version: 1, updated_at: "2026-09-24T00:00:00.000Z",
    share_token: null, is_presentation_enabled: false,
  }
  const project = { id: PROJECT_ID, app_slug: null, user_id: OWNER, workspace_id: null }
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const chain: Record<string, unknown> = {}
    let isUpdate = false
    for (const m of ["eq", "is", "in", "order", "limit", "upsert", "delete"]) chain[m] = vi.fn(() => chain)
    for (const m of ["insert", "update"]) {
      chain[m] = vi.fn((arg: Record<string, unknown>) => {
        if (table === "workflows") workflowWrites.push(arg)
        if (table === "workflows" && m === "update") {
          isUpdate = true
          chain.eq = vi.fn((...args: unknown[]) => {
            updateFilters.push(args)
            return chain
          })
        }
        return chain
      })
    }
    chain.select = vi.fn((cols?: string) => {
      if (table === "workflows") workflowReads.push(String(cols))
      return chain
    })
    const result =
      table === "workflows" ? { data: row, error: null } : table === "projects" ? { data: project, error: null } : { data: null, error: null }
    chain.single = vi.fn().mockResolvedValue(result)
    // `updateMatchesNoRow`: the pinned update matches 0 rows (a concurrent write
    // moved the version); the re-read that follows still finds the row.
    chain.maybeSingle = vi.fn(async () => (isUpdate && opts.updateMatchesNoRow ? { data: null, error: null } : result))
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], count: 0, error: null })
    return chain
  }) as never)
  vi.mocked(supabase.rpc).mockResolvedValue({ data: { ok: true, version: 2, updated_at: "2026-09-24T00:00:01.000Z" }, error: null } as never)
  return { workflowReads, workflowWrites, updateFilters }
}

let app: FastifyInstance

beforeAll(() => __availabilityUniverseReadyForTests())

beforeEach(async () => {
  vi.clearAllMocks()
  __resetAvailabilityOverridesForTests()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") (req as { userId?: string }).userId = header
  })
  await app.register(async (instance) => {
    await workflowRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  __resetAvailabilityOverridesForTests()
})

const deltaSave = (delta: Record<string, unknown>) =>
  app.inject({ method: "PATCH", url: `/v1/workflows/${WORKFLOW_ID}`, headers: { "x-user-id": OWNER }, payload: { delta: { baseVersion: 1, ...delta } } })

const rpcArgs = () => vi.mocked(supabase.rpc).mock.calls[0]![1] as {
  p_upsert_nodes: Array<{ id: string; position?: unknown; data: { layers?: Array<Record<string, unknown>> } }>
  p_upsert_edges: unknown[]
}

describe("PATCH /v1/workflows/:id — delta — Video Overlay (D10)", () => {
  it("an edge-only delta that wires a stored layer sends that node along, its imageUrl cleared (the agent's edge-only edit)", async () => {
    const { workflowReads } = serve()
    const edge = { id: "e1", source: "img", sourceHandle: "image", target: "vo", targetHandle: "overlay" }
    const res = await deltaSave({ upsertEdges: [edge] })
    expect(res.statusCode).toBe(200)
    expect(workflowReads).toContain("nodes, edges")
    const vo = rpcArgs().p_upsert_nodes.find((n) => n.id === "vo")
    expect(vo).toBeDefined()
    expect(vo!.position).toEqual({ x: 400, y: 0 })
    expect(vo!.data.layers![0]).toEqual(expandVideoOverlayLayer({ start: 1, preset: "card" }))
    expect(vo!.data.layers![1]).toEqual(expandVideoOverlayLayer({ imageUrl: OWN, start: 2 }))
    expect(rpcArgs().p_upsert_edges).toEqual([edge])
  })

  it("a delta that does not touch Video Overlay pays no read and sends its upserts unchanged", async () => {
    const { workflowReads } = serve()
    const node = { id: "t", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "Prompt", text: "hi" } }
    const res = await deltaSave({ upsertNodes: [node] })
    expect(res.statusCode).toBe(200)
    expect(workflowReads).not.toContain("nodes, edges")
    expect(rpcArgs().p_upsert_nodes.map((n) => n.id)).toEqual(["t"])
  })
})

describe("REST full-body saves — Video Overlay (D10)", () => {
  const WIRE_OVERLAY = { id: "e1", source: "img", sourceHandle: "image", target: "vo", targetHandle: "overlay" }

  /** The layers of the `vo` node in the one write that carries a node list. */
  function writtenLayers(writes: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const withNodes = writes.filter((w) => Array.isArray(w.nodes))
    expect(withNodes).toHaveLength(1)
    const vo = (withNodes[0]!.nodes as Array<{ id: string; data: { layers: Array<Record<string, unknown>> } }>).find((n) => n.id === "vo")
    return vo!.data.layers
  }

  function assertD10(layers: Array<Record<string, unknown>>) {
    expect(layers[0]).not.toHaveProperty("imageUrl")
    expect(layers[0]).toEqual(expandVideoOverlayLayer({ start: 1, preset: "card" }))
    expect(layers[1]).toEqual(expandVideoOverlayLayer({ imageUrl: OWN, start: 2 }))
  }

  it("POST /v1/workflows clears a wired layer's imageUrl and expands presets", async () => {
    const { workflowWrites } = serve()
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows",
      headers: { "x-user-id": OWNER },
      payload: { name: "Flow", projectId: PROJECT_ID, nodes: STORED_NODES, edges: [WIRE_OVERLAY] },
    })
    expect(res.statusCode).toBe(201)
    assertD10(writtenLayers(workflowWrites))
  })

  it("POST /v1/projects/:projectId/workflows (the SDK's workflows.create) does the same", async () => {
    const { workflowWrites } = serve()
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_ID}/workflows`,
      headers: { "x-user-id": OWNER },
      payload: { name: "Flow", nodes: STORED_NODES, edges: [WIRE_OVERLAY] },
    })
    expect(res.statusCode).toBe(201)
    assertD10(writtenLayers(workflowWrites))
  })

  it("POST /v1/workflows/import does the same", async () => {
    const { workflowWrites } = serve()
    const bundle = { version: 1, exportedAt: "2026-09-24T00:00:00Z", name: "Flow", nodes: STORED_NODES, edges: [WIRE_OVERLAY], settings: {} }
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows/import",
      headers: { "x-user-id": OWNER },
      payload: { projectId: PROJECT_ID, workflow_json: bundle },
    })
    expect(res.statusCode).toBe(201)
    assertD10(writtenLayers(workflowWrites))
  })

  it("PATCH (full body, nodes + edges) does the same", async () => {
    const { workflowWrites } = serve()
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${WORKFLOW_ID}`,
      headers: { "x-user-id": OWNER },
      payload: { nodes: STORED_NODES, edges: [WIRE_OVERLAY] },
    })
    expect(res.statusCode).toBe(200)
    assertD10(writtenLayers(workflowWrites))
  })

  it("PATCH (full body, nodes and no edges) normalises against the STORED edges the save keeps", async () => {
    const { workflowWrites } = serve({ storedEdges: [WIRE_OVERLAY] })
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${WORKFLOW_ID}`,
      headers: { "x-user-id": OWNER },
      payload: { nodes: STORED_NODES },
    })
    expect(res.statusCode).toBe(200)
    assertD10(writtenLayers(workflowWrites))
  })

  it("PATCH (full body, edges only) that wires a stored layer writes that node back cleared", async () => {
    const { workflowWrites, updateFilters } = serve()
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${WORKFLOW_ID}`,
      headers: { "x-user-id": OWNER },
      payload: { edges: [WIRE_OVERLAY] },
    })
    expect(res.statusCode).toBe(200)
    assertD10(writtenLayers(workflowWrites))
    expect(workflowWrites.find((w) => Array.isArray(w.nodes))!.edges).toEqual([WIRE_OVERLAY])
    // The stored nodes were read before this write: it is pinned to that version.
    expect(updateFilters).toContainEqual(["version", 1])
  })

  it("PATCH (full body, edges only) whose pinned write loses to a concurrent writer answers 409 workflow_conflict, not 404", async () => {
    // No expectedVersion / expectedUpdatedAt from the caller: the pin is the
    // route's own (the stored nodes it writes back were read at version 1).
    serve({ updateMatchesNoRow: true })
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${WORKFLOW_ID}`,
      headers: { "x-user-id": OWNER },
      payload: { edges: [WIRE_OVERLAY] },
    })
    expect(res.statusCode).toBe(409)
    const body = res.json() as { error: { code: string; currentVersion?: number; currentRecord?: { id?: string } } }
    expect(body.error.code).toBe("workflow_conflict")
    expect(body.error.currentVersion).toBe(1)
    expect(body.error.currentRecord?.id).toBe(WORKFLOW_ID)
  })

  it("PATCH (full body, edges only) that wires nothing leaves the stored nodes unwritten", async () => {
    // Stored nodes already normalised: nothing for the pass to change.
    const normalised = STORED_NODES.map((n) =>
      n.type === "video-overlay"
        ? { ...n, data: { ...n.data, layers: (n.data as { layers: Array<Record<string, unknown>> }).layers.map((l) => expandVideoOverlayLayer(l)) } }
        : n,
    )
    const { workflowWrites, updateFilters } = serve({ storedNodes: normalised })
    const edge = { id: "e9", source: "img", target: "other", targetHandle: "image" }
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${WORKFLOW_ID}`,
      headers: { "x-user-id": OWNER },
      payload: { edges: [edge] },
    })
    expect(res.statusCode).toBe(200)
    expect(workflowWrites.some((w) => "nodes" in w)).toBe(false)
    expect(updateFilters).not.toContainEqual(["version", 1])
  })
})
