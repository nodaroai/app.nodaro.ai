/**
 * Saved result ids resolved on the server's workflow doors (decided
 * 2026-10-05): a read hands back a patched copy and writes nothing, a save
 * resolves the nodes it writes, a codec-owned document is never touched, and
 * a request asks the jobs table at most once — never when nothing needs it.
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

vi.mock("@/lib/node-registry.js", () => ({
  NODE_REGISTRY: [
    { type: "generate-image", category: "ai-image" },
    { type: "apply-edl", category: "processing" },
  ],
}))

import { workflowRoutes } from "../workflows.js"
import { supabase } from "../../lib/supabase.js"
import {
  __resetAvailabilityOverridesForTests,
  __availabilityUniverseReadyForTests,
} from "../../lib/availability-override.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000030"
const JOB_GEN = "f0000000-0000-4000-8000-000000000101"
const JOB_RENDER = "f0000000-0000-4000-8000-000000000102"

const PLACEHOLDER_NODES = [
  { id: "gen", type: "generate-image", position: { x: 0, y: 0 }, data: { label: "Gen", generatedResults: [
    { url: "https://m.test/a0.png", jobId: "exec-gen", timestamp: "2026-09-01T00:00:00Z" },
  ] } },
  { id: "render", type: "apply-edl", position: { x: 300, y: 0 }, data: { label: "Render", quality: "final", generatedResults: [
    { url: "https://m.test/e0.mp4", jobId: JOB_RENDER },
  ] } },
]
const CLEAN_NODES = [
  { id: "gen", type: "generate-image", position: { x: 0, y: 0 }, data: { label: "Gen", generatedResults: [
    { url: "https://m.test/a0.png", jobId: JOB_GEN },
  ] } },
]
/** The jobs table's answer, in the resolver's projection. */
const JOB_ROWS = [
  { id: JOB_GEN, user_id: OWNER, status: "completed", job_type: "generate-image", node_id: "gen", image_url: "https://m.test/a0.png", thumbnail_url: "https://m.test/a0-t.png" },
  { id: JOB_RENDER, user_id: OWNER, status: "completed", job_type: "apply-edl", node_id: "render", input_quality: "proxy", video_url: "https://m.test/e0.mp4" },
]

function serve(opts: { storedNodes: unknown[]; storedSettings?: Record<string, unknown> }) {
  const jobQueries: Array<{ select: string; or?: string }> = []
  const workflowWrites: Array<Record<string, unknown>> = []
  const row = {
    id: WORKFLOW_ID, project_id: null, user_id: OWNER, workspace_id: null, visibility: "private", folder_id: null,
    name: "W", description: null, is_template: false, thumbnail_url: null, source_prompt: null, parent_workflow_id: null,
    app_slug: null, share_token: null, is_presentation_enabled: false, created_at: "2026-09-01T00:00:00.000Z",
    nodes: opts.storedNodes, edges: [], settings: opts.storedSettings ?? {}, version: 1, updated_at: "2026-09-24T00:00:00.000Z",
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const chain: Record<string, unknown> = {}
    let written: Record<string, unknown> | null = null
    const query: { select: string; or?: string } = { select: "" }
    for (const m of ["eq", "is", "in", "order", "limit", "upsert", "delete"]) chain[m] = vi.fn(() => chain)
    for (const m of ["insert", "update"]) {
      chain[m] = vi.fn((arg: Record<string, unknown>) => {
        if (table === "workflows") {
          workflowWrites.push(arg)
          written = arg
        }
        return chain
      })
    }
    chain.select = vi.fn((cols?: string) => {
      if (table === "jobs") {
        query.select = String(cols)
        jobQueries.push(query)
      }
      return chain
    })
    chain.or = vi.fn((filter: string) => {
      query.or = filter
      return chain
    })
    chain.range = vi.fn(async () => ({ data: table === "jobs" ? JOB_ROWS : [], error: null }))
    const result = () => (table === "workflows" ? { data: written ? { ...row, ...written } : row, error: null } : { data: null, error: null })
    chain.single = vi.fn(async () => result())
    chain.maybeSingle = vi.fn(async () => result())
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], count: 0, error: null })
    return chain
  }) as never)
  vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null } as never)
  return { jobQueries, workflowWrites }
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

type Node = { id: string; data: { quality?: unknown; generatedResults: Array<Record<string, unknown>> } }
const resultsOf = (nodes: unknown, id: string) => (nodes as Node[]).find((n) => n.id === id)!.data.generatedResults

describe("GET /v1/workflows/:id", () => {
  it("hands back the resolved ids and labels, writes nothing, and asks the jobs table once", async () => {
    const { jobQueries, workflowWrites } = serve({ storedNodes: PLACEHOLDER_NODES })
    const res = await app.inject({ method: "GET", url: `/v1/workflows/${WORKFLOW_ID}`, headers: { "x-user-id": OWNER } })
    expect(res.statusCode).toBe(200)
    const nodes = res.json().data.nodes
    expect(resultsOf(nodes, "gen")[0]).toEqual({ url: "https://m.test/a0.png", jobId: JOB_GEN, timestamp: "2026-09-01T00:00:00Z", thumbnailUrl: "https://m.test/a0-t.png" })
    expect(resultsOf(nodes, "render")[0]).toEqual({ url: "https://m.test/e0.mp4", jobId: JOB_RENDER, quality: "proxy" })
    // The node's own Quality setting is not a result's.
    expect((nodes as Node[]).find((n) => n.id === "render")!.data.quality).toBe("final")
    // Same version, same updated_at: nothing was written.
    expect(res.json().data.version).toBe(1)
    expect(workflowWrites).toEqual([])
    expect(jobQueries).toHaveLength(1)
    // Never `output_data` whole.
    expect(jobQueries[0].select).not.toMatch(/(^|,\s*)output_data(\s*,|$)/)
    expect(jobQueries[0].or).toContain(`id.in.("${JOB_RENDER}")`)
    expect(jobQueries[0].or).toContain(`input_data->>node_id.in.("gen")`)
  })

  it("asks the jobs table nothing when no result needs resolving", async () => {
    const { jobQueries } = serve({ storedNodes: CLEAN_NODES })
    const res = await app.inject({ method: "GET", url: `/v1/workflows/${WORKFLOW_ID}`, headers: { "x-user-id": OWNER } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.nodes).toEqual(CLEAN_NODES)
    expect(jobQueries).toHaveLength(0)
  })

  it("leaves a codec-owned (Studio) document as stored", async () => {
    const { jobQueries } = serve({ storedNodes: PLACEHOLDER_NODES, storedSettings: { studio: { keyframes: [] } } })
    const res = await app.inject({ method: "GET", url: `/v1/workflows/${WORKFLOW_ID}`, headers: { "x-user-id": OWNER } })
    expect(res.statusCode).toBe(200)
    expect(resultsOf(res.json().data.nodes, "gen")[0].jobId).toBe("exec-gen")
    expect(jobQueries).toHaveLength(0)
  })
})

describe("PATCH /v1/workflows/:id (full body)", () => {
  it("writes the resolved ids — one jobs lookup for the whole request", async () => {
    const { jobQueries, workflowWrites } = serve({ storedNodes: CLEAN_NODES })
    const res = await app.inject({
      method: "PATCH", url: `/v1/workflows/${WORKFLOW_ID}`, headers: { "x-user-id": OWNER },
      payload: { nodes: PLACEHOLDER_NODES, edges: [] },
    })
    expect(res.statusCode).toBe(200)
    const written = workflowWrites.find((w) => Array.isArray(w.nodes))!.nodes
    expect(resultsOf(written, "gen")[0].jobId).toBe(JOB_GEN)
    expect(resultsOf(written, "render")[0]).toEqual({ url: "https://m.test/e0.mp4", jobId: JOB_RENDER, quality: "proxy" })
    expect(jobQueries).toHaveLength(1)
  })

  it("resolves its answer, not the stored row, when the save carries no nodes", async () => {
    const { jobQueries, workflowWrites } = serve({ storedNodes: PLACEHOLDER_NODES })
    const res = await app.inject({
      method: "PATCH", url: `/v1/workflows/${WORKFLOW_ID}`, headers: { "x-user-id": OWNER },
      payload: { name: "Renamed" },
    })
    expect(res.statusCode).toBe(200)
    expect(workflowWrites.some((w) => "nodes" in w)).toBe(false)
    expect(resultsOf(res.json().data.nodes, "gen")[0].jobId).toBe(JOB_GEN)
    expect(jobQueries).toHaveLength(1)
  })

  it("never resolves into a codec-owned document, stored or sent", async () => {
    const { jobQueries, workflowWrites } = serve({ storedNodes: CLEAN_NODES, storedSettings: { studio: { sequences: [] } } })
    const res = await app.inject({
      method: "PATCH", url: `/v1/workflows/${WORKFLOW_ID}`, headers: { "x-user-id": OWNER },
      payload: { nodes: PLACEHOLDER_NODES, edges: [] },
    })
    // The save went through (a refusal before the resolve step would also
    // leave zero job queries, and prove nothing about the codec skip).
    expect(res.statusCode).toBe(200)
    const written = workflowWrites.find((w) => Array.isArray(w.nodes))!.nodes
    expect(resultsOf(written, "gen")[0].jobId).toBe("exec-gen")
    expect(jobQueries).toHaveLength(0)
  })
})

describe("POST /v1/workflows/:id/sync-triggers", () => {
  it("asks the jobs table nothing: it judges trigger nodes and hands no saved result out", async () => {
    const { jobQueries } = serve({ storedNodes: PLACEHOLDER_NODES })
    const res = await app.inject({
      method: "POST", url: `/v1/workflows/${WORKFLOW_ID}/sync-triggers`, headers: { "x-user-id": OWNER },
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    expect(jobQueries).toHaveLength(0)
  })
})
