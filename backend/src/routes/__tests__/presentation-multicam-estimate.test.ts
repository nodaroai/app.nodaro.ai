/**
 * `GET /v1/present/:token` prices the shared workflow as its VIEWER's run
 * reads it (decided 2026-10-19): a use-case node on several recordings only for
 * a viewer who may use Speaker Map, an `auto` framing source as the even split
 * for one Speaker Frames is withheld from (`usecaseViewerEstimateFor`), never the
 * owner's answer, and an anonymous viewer never.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => false,
}))
vi.mock("@/lib/orchestration-queue.js", () => ({ orchestrationQueue: { add: vi.fn() } }))
const h = vi.hoisted(() => ({ estimate: vi.fn().mockResolvedValue(7), asked: [] as Array<{ types: string[]; userId: unknown }>, multicam: true, framesWithheld: false, metered: false }))
vi.mock("@/ee/billing/credits.js", () => ({ estimateWorkflowCreditsDetailed: async (...a: unknown[]) => ({ credits: await h.estimate(...a), estimate: h.metered, perNode: {} }) }))
vi.mock("@/lib/use-case/inner-availability.js", () => ({
  usecaseViewerEstimateFor: async (nodes: Array<{ type?: string }>, userId: unknown) => {
    h.asked.push({ types: nodes.map((n) => String(n.type)), userId })
    return { ...(h.multicam ? { multicam: true } : {}), ...(h.framesWithheld ? { framesWithheld: true } : {}) }
  },
}))
vi.mock("@/lib/canvas-result-ids.js", () => ({ resolveCanvasResultIds: async (nodes: unknown) => nodes }))
vi.mock("@/lib/ugc-composed-graph.js", () => ({ ugcPublishedGraph: async (nodes: unknown) => ({ nodes }) }))

import { presentationRoutes } from "../presentation.js"
import { supabase } from "../../lib/supabase.js"

const VIEWER_ID = "00000000-0000-4000-8000-000000000002"
const OWNER_ID = "00000000-0000-4000-8000-000000000001"
const NODES = [
  { id: "cam1", type: "upload-video", data: { url: "https://r2/a.mp4" } },
  { id: "cam2", type: "upload-video", data: { url: "https://r2/b.mp4" } },
  { id: "t1", type: "tighten-episode", data: {} },
]

function chainResolving(value: unknown) {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve(value)
      return () => new Proxy({}, handler)
    },
  }
  return new Proxy({}, handler)
}

let app: FastifyInstance
beforeEach(async () => {
  vi.clearAllMocks()
  h.asked = []
  h.multicam = true
  h.framesWithheld = false
  vi.mocked(supabase.from).mockImplementation(
    () =>
      chainResolving({
        data: { id: "wf-1", name: "Show", user_id: OWNER_ID, nodes: NODES, edges: [], settings: {}, workspace_id: null, is_presentation_enabled: true },
        error: null,
      }) as never,
  )
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (header && typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => {
    await presentationRoutes(instance)
  })
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

describe("GET /v1/present/:token — the estimate is the viewer's", () => {
  it("asks for the viewer, and passes multicam when the viewer may use Speaker Map", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/present/tok", headers: { "x-user-id": VIEWER_ID } })
    expect(res.statusCode).toBe(200)
    expect(h.asked).toEqual([{ types: ["upload-video", "upload-video", "tighten-episode"], userId: VIEWER_ID }])
    expect(h.estimate.mock.calls[0]![2]).toMatchObject({ multicam: true })
  })

  it("a viewer who may not: the options carry no multicam (the estimate as before)", async () => {
    h.multicam = false
    await app.inject({ method: "GET", url: "/v1/present/tok", headers: { "x-user-id": VIEWER_ID } })
    expect(h.estimate.mock.calls[0]![2]).not.toHaveProperty("multicam")
  })

  it("a viewer Speaker Frames is withheld from: an auto framing source priced as the even split (decided 2026-10-20)", async () => {
    h.multicam = false
    h.framesWithheld = true
    await app.inject({ method: "GET", url: "/v1/present/tok", headers: { "x-user-id": VIEWER_ID } })
    expect(h.estimate.mock.calls[0]![2]).toMatchObject({ framesWithheld: true })
    expect(h.estimate.mock.calls[0]![2]).not.toHaveProperty("multicam")
  })

  it("a metered LLM line marks the seeded figure an estimate (`estimatedCostIsEstimate`); absent otherwise", async () => {
    h.metered = true
    try {
      const res = await app.inject({ method: "GET", url: "/v1/present/tok", headers: { "x-user-id": VIEWER_ID } })
      expect(res.json()).toMatchObject({ estimatedCost: 7, estimatedCostIsEstimate: true })
    } finally {
      h.metered = false
    }
    const fixed = await app.inject({ method: "GET", url: "/v1/present/tok", headers: { "x-user-id": VIEWER_ID } })
    expect(fixed.json()).not.toHaveProperty("estimatedCostIsEstimate")
  })

  it("R51: a metered LLM model with no price still renders the page — the cost omitted, `estimatedCostUnpriced` says why", async () => {
    h.estimate.mockRejectedValueOnce(Object.assign(new Error("unpriced"), { name: "LlmUnpricedModelError", code: "llm_model_unpriced", modelId: "claude-opus-5.5" }))
    const res = await app.inject({ method: "GET", url: "/v1/present/tok", headers: { "x-user-id": VIEWER_ID } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).not.toHaveProperty("estimatedCost")
    expect(body).not.toHaveProperty("estimatedCostIsEstimate")
    expect(body.estimatedCostUnpriced).toEqual({
      reason: "llm_model_unpriced",
      modelId: "claude-opus-5.5",
      message: 'The model "claude-opus-5.5" has no price yet, so it cannot be run. Choose another model.',
    })
    expect(body.nodes).toHaveLength(3)
  })

  it("an anonymous viewer is asked as no one", async () => {
    await app.inject({ method: "GET", url: "/v1/present/tok" })
    expect(h.asked[0]?.userId ?? null).toBeNull()
  })
})
