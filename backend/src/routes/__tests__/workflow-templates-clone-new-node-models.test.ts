/**
 * Template instantiation starts a cloned node on a model the deployment offers
 * (lib/new-node-models.ts, decided 2026-11-10): where models are restricted, a
 * template node that names no model, whose default is withheld, starts on the
 * first row its menu offers. A model the template names is kept, and a
 * deployment that restricts nothing clones the template exactly as it is.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { DEFAULT_VIDEO_PROVIDER } from "@nodaro/shared/models"
import { VIDEO_GEN_MODELS } from "@nodaro/render-rules"

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn(), auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) } },
}))
vi.mock("@/ee/billing/credits.js", () => ({
  estimateWorkflowCredits: vi.fn().mockReturnValue(10),
  estimateWorkflowListingCredits: vi.fn().mockResolvedValue({ preview: 10, final: 0 }),
}))
vi.mock("@/lib/storage.js", () => ({ copyToTemplatePreview: vi.fn() }))
// The cloner's free-credit video limits: none.
vi.mock("@/ee/lib/free-video-limits-for.js", () => ({ freeVideoLimitsFor: async () => null }))

import { workflowTemplatesRoutes } from "../workflow-templates.js"
import { supabase } from "../../lib/supabase.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { __availabilityUniverseReadyForTests } from "../../lib/availability-override.js"

const USER = "00000000-0000-4000-8000-000000000001"
const PROJECT = "00000000-0000-4000-8000-000000000030"

let app: FastifyInstance
let inserted: Record<string, unknown> | null

function mockTables(snapshotNodes: unknown[]): void {
  let templateCalls = 0
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "workflow_templates") {
      templateCalls++
      if (templateCalls === 1) {
        const maybeSingle = vi.fn().mockResolvedValue({
          data: { id: "tpl-1", name: "Demo", clone_count: 0, snapshot_nodes: snapshotNodes, snapshot_edges: [], snapshot_settings: {} },
          error: null,
        })
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle }) }) }) } as never
      }
      return { update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }) } as never
    }
    if (table === "projects") {
      const single = vi.fn().mockResolvedValue({ data: { id: PROJECT, user_id: USER }, error: null })
      return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single }) }) } as never
    }
    if (table === "workflows") {
      const insert = vi.fn().mockImplementation((row: Record<string, unknown>) => {
        inserted = row
        return { select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "wf-new" }, error: null }) }) }
      })
      return { insert } as never
    }
    return {} as never
  })
}

const clone = () => app.inject({ method: "POST", url: "/v1/templates/demo/clone", headers: { "x-user-id": USER }, payload: { projectId: PROJECT } })
const clonedNodes = () => inserted!.nodes as Array<{ id: string; data: Record<string, unknown> }>

beforeAll(() => __availabilityUniverseReadyForTests())

beforeEach(async () => {
  vi.clearAllMocks()
  inserted = null
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { deny: [DEFAULT_VIDEO_PROVIDER] } })
  __resetSurfaceProfileCacheForTests()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => workflowTemplatesRoutes(instance))
  await app.ready()
})

afterEach(async () => {
  await app.close()
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

describe("POST /v1/templates/:slug/clone — a cloned node starts on an offered model", () => {
  it("a template node that names no model moves to the menu's first offered row; a named one is kept", async () => {
    mockTables([
      { id: "unnamed", type: "generate-video", data: { prompt: "a cat" } },
      { id: "named", type: "generate-video", data: { prompt: "a dog", provider: DEFAULT_VIDEO_PROVIDER } },
    ])
    const res = await clone()
    expect(res.statusCode).toBe(200)
    const nodes = clonedNodes()
    expect(nodes.find((n) => n.id === "unnamed")!.data.provider).toBe(VIDEO_GEN_MODELS.map((m) => m.value).find((v) => v !== DEFAULT_VIDEO_PROVIDER))
    expect(nodes.find((n) => n.id === "named")!.data.provider).toBe(DEFAULT_VIDEO_PROVIDER)
  })

  it("a deployment that restricts nothing clones the template exactly as it is", async () => {
    delete process.env.NODARO_SURFACE_PROFILE
    __resetSurfaceProfileCacheForTests()
    const snapshot = [{ id: "unnamed", type: "generate-video", data: { prompt: "a cat" } }]
    mockTables(snapshot)
    expect((await clone()).statusCode).toBe(200)
    expect(clonedNodes()).toEqual(snapshot)
  })
})
