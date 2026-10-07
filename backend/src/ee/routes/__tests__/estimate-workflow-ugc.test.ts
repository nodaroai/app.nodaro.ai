/**
 * POST /v1/credits/estimate-workflow reaches the UGC estimate seam with no
 * caller argument: the route calls `estimateWorkflowCredits(nodes, edges)` as it
 * always has, and a graph holding UGC Clip is priced through the plugin's
 * estimate under the estimate caller (spec section 6.8).
 *
 * The real `CreditsService` runs. Only `estimateUgcRun` is stubbed, and the
 * database answers the `model_pricing` read with no rows, so a graph that holds
 * only UGC nodes totals exactly the seam's figure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const u = vi.hoisted(() => ({ estimate: vi.fn() }))
vi.mock("@/ee/lib/ugc-estimate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ee/lib/ugc-estimate.js")>()),
  estimateUgcRun: u.estimate,
}))

vi.mock("@/lib/supabase.js", () => {
  function modelPricingQuery() {
    const query = {
      select: () => query,
      order: () => query,
      eq: () => query,
      single: async () => ({ data: null, error: { code: "PGRST116" } }),
      range: async () => ({ data: [], error: null }),
    }
    return query
  }
  return {
    supabase: {
      from: () => modelPricingQuery(),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
    },
  }
})

vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: async () => ({ cost_markup_percent: 0, service_margin_percent: {} }),
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 1, watermark: false }),
}))

vi.mock("@/lib/private-plugins/load.js", () => ({
  getPluginServices: () => ({}),
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/deployment-payer.js", () => ({
  deploymentPayerActive: vi.fn(() => false),
  deploymentPayerId: vi.fn(() => null),
  allowanceEnforcementActive: vi.fn(() => false),
}))

vi.mock("@/ee/billing/deployment-allowance-service.js", () => ({
  allowanceFor: vi.fn(),
}))

vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, hasCredits: () => true, isCloud: () => true, isCommunity: () => false, hasAdmin: () => true, hasOrganizations: () => true }
})

import { creditsRoutes } from "../credits.js"

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-test-user-id"]
    if (header && typeof header === "string") {
      req.userId = header
      req.userRole = undefined
    }
  })
  await app.register(async (instance) => {
    await creditsRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function authedPost(url: string, payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url, headers: { "x-test-user-id": TEST_USER_ID }, payload })
}

describe("POST /v1/credits/estimate-workflow with a UGC graph", () => {
  it("prices a UGC graph through the seam", async () => {
    u.estimate.mockResolvedValue({ expected: 2563, range: [2083, 3033], worstCase: 5876, lines: [], ceiling: 0 })
    const res = await authedPost("/v1/credits/estimate-workflow", {
      nodes: [
        { id: "script", type: "ugc-script", data: { targetDurationSec: 15 } },
        { id: "creator", type: "ugc-creator", data: { source: "sampled" } },
        { id: "clip", type: "ugc-clip", data: {} },
      ],
      edges: [],
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.totalCredits).toBe(2563)
    expect(u.estimate).toHaveBeenCalledWith({ kind: "estimate" }, { targetDurationSec: 15, screenshotCount: 0, source: "sampled" })
  })

  it("a graph without UGC Clip never reaches the seam", async () => {
    const res = await authedPost("/v1/credits/estimate-workflow", { nodes: [{ id: "a", type: "text-prompt", data: {} }], edges: [] })
    expect(res.statusCode).toBe(200)
    expect(u.estimate).not.toHaveBeenCalled()
  })
})
