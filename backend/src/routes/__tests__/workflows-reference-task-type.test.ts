/**
 * A stored Seedance reference task type on the REST workflow writes (decided
 * 2026-11-13): POST /v1/workflows, POST /v1/projects/:projectId/workflows,
 * PATCH /v1/workflows/:id (full body, an edges-only write-back, and the
 * id-keyed delta) and POST /v1/workflows/import each store the graph with a
 * `referenceTaskType` no model the node runs lists removed — that one key, and
 * nothing else (`withListedReferenceTaskTypes`, the rule the MCP writes run
 * through `normalizeNodeModelParams`). The whole stored graph is asserted: a
 * Kling node written with `edit` loses only that key, a Seedance 2.5 node with
 * `edit` is stored as written, an image ratio the catalog would snap is stored
 * as written, and a graph without the field is stored byte for byte.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

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

// The import bundle carries no media to copy onto this install.
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
    { type: "generate-video", category: "ai-video" },
    { type: "generate-image", category: "ai-image" },
    { type: "video-overlay", category: "processing" },
  ],
}))

import { workflowRoutes } from "../workflows.js"
import { supabase } from "../../lib/supabase.js"
import { __resetAvailabilityOverridesForTests, __availabilityUniverseReadyForTests } from "../../lib/availability-override.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const PROJECT_ID = "00000000-0000-4000-8000-000000000010"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000030"
const at = { x: 0, y: 0 }

/** Written: a Kling node with `edit`, a Seedance 2.5 node with `edit`, an image ratio the catalog would snap, a prompt. */
const GRAPH = [
  { id: "kling", type: "generate-video", position: at, data: { label: "Kling", provider: "kling-3.0", prompt: "a cat", aspectRatio: "21:9", duration: 5, referenceTaskType: "edit" } },
  { id: "sd25", type: "generate-video", position: at, data: { label: "Seedance", provider: "seedance-2-5", prompt: "a cat", referenceTaskType: "edit" } },
  { id: "img", type: "generate-image", position: at, data: { label: "Image", provider: "gpt-image", aspectRatio: "16:9", resolution: "2K" } },
  { id: "p", type: "text-prompt", position: at, data: { label: "Prompt", text: "hi" } },
]
/** What is stored: the same graph, the Kling node's `referenceTaskType` gone — nothing else. */
const STORED = [
  { id: "kling", type: "generate-video", position: at, data: { label: "Kling", provider: "kling-3.0", prompt: "a cat", aspectRatio: "21:9", duration: 5 } },
  GRAPH[1],
  GRAPH[2],
  GRAPH[3],
]
/** A graph without the field: stored byte for byte. */
const CLEAN = [GRAPH[1], GRAPH[2], GRAPH[3]]
const EDGES = [{ id: "e1", source: "p", sourceHandle: "text", target: "kling", targetHandle: "prompt" }]

function serve(opts: { storedNodes?: unknown[]; settings?: Record<string, unknown> } = {}) {
  const workflowWrites: Array<Record<string, unknown>> = []
  /** Every column list read from `workflows`. */
  const workflowReads: string[] = []
  const row = {
    id: WORKFLOW_ID, project_id: null, user_id: OWNER, workspace_id: null, visibility: "private",
    nodes: opts.storedNodes ?? CLEAN, edges: [], settings: opts.settings ?? {}, version: 1, updated_at: "2026-11-13T00:00:00.000Z",
    share_token: null, is_presentation_enabled: false,
  }
  const project = { id: PROJECT_ID, app_slug: null, user_id: OWNER, workspace_id: null }
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const chain: Record<string, unknown> = {}
    for (const m of ["eq", "is", "in", "order", "limit", "upsert", "delete"]) chain[m] = vi.fn(() => chain)
    chain.select = vi.fn((cols?: string) => {
      if (table === "workflows") workflowReads.push(String(cols))
      return chain
    })
    for (const m of ["insert", "update"]) {
      chain[m] = vi.fn((arg: Record<string, unknown>) => {
        if (table === "workflows") workflowWrites.push(arg)
        return chain
      })
    }
    const result = table === "workflows" ? { data: row, error: null } : table === "projects" ? { data: project, error: null } : { data: null, error: null }
    chain.single = vi.fn().mockResolvedValue(result)
    chain.maybeSingle = vi.fn().mockResolvedValue(result)
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], count: 0, error: null })
    return chain
  }) as never)
  vi.mocked(supabase.rpc).mockResolvedValue({ data: { ok: true, version: 2, updated_at: "2026-11-13T00:00:01.000Z" }, error: null } as never)
  return { workflowWrites, workflowReads }
}

/** The node list of the one write that carries one. */
function storedNodes(writes: Array<Record<string, unknown>>): unknown[] {
  const withNodes = writes.filter((w) => Array.isArray(w.nodes))
  expect(withNodes).toHaveLength(1)
  return withNodes[0]!.nodes as unknown[]
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

const bundle = (nodes: unknown[]) => ({ version: 1, exportedAt: "2026-11-13T00:00:00Z", name: "Flow", nodes, edges: EDGES, settings: {} })

/** Each full-graph REST write: its request for `nodes`, and the status it answers. */
const FULL_WRITES: ReadonlyArray<readonly [string, (nodes: unknown[]) => Promise<{ statusCode: number; body: string }>, number]> = [
  ["POST /v1/workflows", (nodes) => app.inject({ method: "POST", url: "/v1/workflows", headers: { "x-user-id": OWNER }, payload: { name: "Flow", projectId: PROJECT_ID, nodes, edges: EDGES } }), 201],
  ["POST /v1/projects/:projectId/workflows", (nodes) => app.inject({ method: "POST", url: `/v1/projects/${PROJECT_ID}/workflows`, headers: { "x-user-id": OWNER }, payload: { name: "Flow", nodes, edges: EDGES } }), 201],
  ["POST /v1/workflows/import", (nodes) => app.inject({ method: "POST", url: "/v1/workflows/import", headers: { "x-user-id": OWNER }, payload: { projectId: PROJECT_ID, workflow_json: bundle(nodes) } }), 201],
  ["PATCH /v1/workflows/:id (full body)", (nodes) => app.inject({ method: "PATCH", url: `/v1/workflows/${WORKFLOW_ID}`, headers: { "x-user-id": OWNER }, payload: { nodes, edges: EDGES } }), 200],
]

describe("a stored reference task type on the REST workflow writes", () => {
  it.each(FULL_WRITES)("%s: the Kling node loses only that key; everything else is stored as written", async (_route, write, status) => {
    const { workflowWrites } = serve()
    const res = await write(GRAPH)
    expect(res.statusCode, res.body).toBe(status)
    expect(storedNodes(workflowWrites)).toStrictEqual(STORED)
  })

  it.each(FULL_WRITES)("%s: a graph without the field is stored byte for byte", async (_route, write, status) => {
    const { workflowWrites } = serve()
    const res = await write(CLEAN)
    expect(res.statusCode, res.body).toBe(status)
    expect(JSON.stringify(storedNodes(workflowWrites))).toBe(JSON.stringify(CLEAN))
  })

  it("PATCH delta: the upserted Kling node loses only that key; the Seedance 2.5 node and the rest go as sent", async () => {
    serve()
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${WORKFLOW_ID}`,
      headers: { "x-user-id": OWNER },
      payload: { delta: { baseVersion: 1, upsertNodes: GRAPH } },
    })
    expect(res.statusCode, res.body).toBe(200)
    const args = vi.mocked(supabase.rpc).mock.calls[0]![1] as { p_upsert_nodes: unknown[] }
    expect(args.p_upsert_nodes).toStrictEqual(STORED)
  })

  it("PATCH delta: a codec-owned document's node re-sent with a stale value is written unchanged (its write guard refuses any other change)", async () => {
    // A Studio production's settings make the document codec-owned.
    const { workflowReads } = serve({ storedNodes: GRAPH, settings: { studio: { keyframes: [] } } })
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${WORKFLOW_ID}`,
      headers: { "x-user-id": OWNER },
      payload: { delta: { baseVersion: 1, upsertNodes: GRAPH } },
    })
    expect(res.statusCode, res.body).toBe(200)
    const args = vi.mocked(supabase.rpc).mock.calls[0]![1] as { p_upsert_nodes: unknown[] }
    expect(JSON.stringify(args.p_upsert_nodes)).toBe(JSON.stringify(GRAPH))
    expect(workflowReads).toContain("nodes, settings")
  })

  it("PATCH delta: an ordinary document is cleaned after the one read; a delta the rule leaves alone pays no read", async () => {
    const { workflowReads } = serve({ storedNodes: GRAPH })
    await app.inject({ method: "PATCH", url: `/v1/workflows/${WORKFLOW_ID}`, headers: { "x-user-id": OWNER }, payload: { delta: { baseVersion: 1, upsertNodes: GRAPH } } })
    expect((vi.mocked(supabase.rpc).mock.calls[0]![1] as { p_upsert_nodes: unknown[] }).p_upsert_nodes).toStrictEqual(STORED)
    expect(workflowReads.filter((c) => c === "nodes, settings")).toHaveLength(1)
    vi.mocked(supabase.rpc).mockClear()
    const clean = serve({ storedNodes: GRAPH })
    await app.inject({ method: "PATCH", url: `/v1/workflows/${WORKFLOW_ID}`, headers: { "x-user-id": OWNER }, payload: { delta: { baseVersion: 1, upsertNodes: CLEAN } } })
    expect(clean.workflowReads).not.toContain("nodes, settings")
  })

  it("PATCH delta: upserts without the field go byte for byte", async () => {
    serve()
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${WORKFLOW_ID}`,
      headers: { "x-user-id": OWNER },
      payload: { delta: { baseVersion: 1, upsertNodes: CLEAN } },
    })
    expect(res.statusCode, res.body).toBe(200)
    const args = vi.mocked(supabase.rpc).mock.calls[0]![1] as { p_upsert_nodes: unknown[] }
    expect(JSON.stringify(args.p_upsert_nodes)).toBe(JSON.stringify(CLEAN))
  })

  it("PATCH (edges only) that writes the stored nodes back for a Video Overlay layer writes them with the rule; one that writes nothing leaves them unwritten", async () => {
    const overlay = { id: "vo", type: "video-overlay", position: at, data: { label: "Video Overlay", layerCount: 4, layers: [{ imageUrl: "https://r2.test/stale.png", start: 1 }] } }
    const upload = { id: "up", type: "upload-image", position: at, data: { label: "Card", url: "https://r2.test/card.png" } }
    const { workflowWrites } = serve({ storedNodes: [...GRAPH, upload, overlay] })
    const wire = { id: "e9", source: "up", sourceHandle: "image", target: "vo", targetHandle: "overlay" }
    const res = await app.inject({ method: "PATCH", url: `/v1/workflows/${WORKFLOW_ID}`, headers: { "x-user-id": OWNER }, payload: { edges: [wire] } })
    expect(res.statusCode, res.body).toBe(200)
    const written = storedNodes(workflowWrites) as Array<{ id: string }>
    expect(written.slice(0, 4)).toStrictEqual(STORED)
    // An edges-only save the overlay pass leaves alone writes no node at all.
    const second = serve({ storedNodes: GRAPH })
    await app.inject({ method: "PATCH", url: `/v1/workflows/${WORKFLOW_ID}`, headers: { "x-user-id": OWNER }, payload: { edges: EDGES } })
    expect(second.workflowWrites.some((w) => "nodes" in w)).toBe(false)
  })
})
