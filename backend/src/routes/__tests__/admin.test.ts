import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  return { supabase: { from: mockFrom } }
})

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(true),
}))

// Mock requireAdmin as passthrough — admin check is not the focus of these tests
vi.mock("@/middleware/require-admin.js", () => ({
  requireAdmin: async () => {},
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { adminRoutes } from "../admin.js"
import { supabase } from "../../lib/supabase.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_ALERT_ID = "00000000-0000-4000-8000-000000000010"
const TEST_MODEL_ID = "00000000-0000-4000-8000-000000000020"
const TEST_ASSET_ID = "00000000-0000-4000-8000-000000000030"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // Bypass auth — set userId from header
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (header && typeof header === "string") {
      req.userId = header
      req.userRole = undefined
    }
  })

  await app.register(async (instance) => {
    await adminRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// GET /v1/admin/alerts
// ---------------------------------------------------------------------------

describe("GET /v1/admin/alerts", () => {
  it("returns 200 with data array and total count", async () => {
    const alerts = [
      { id: TEST_ALERT_ID, alert_type: "cost_overrun", threshold: 100, is_enabled: true },
    ]
    const mockRange = vi.fn().mockResolvedValue({ data: alerts, error: null, count: 1 })
    const mockOrder = vi.fn().mockReturnValue({ range: mockRange })
    const mockSelect = vi.fn().mockReturnValue({ order: mockOrder })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/alerts",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toEqual(alerts)
    expect(body.total).toBe(1)
    expect(body.limit).toBe(50)
    expect(body.offset).toBe(0)
    expect(supabase.from).toHaveBeenCalledWith("admin_alerts")
  })

  it("returns 500 on DB error", async () => {
    const mockRange = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "DB down" },
      count: null,
    })
    const mockOrder = vi.fn().mockReturnValue({ range: mockRange })
    const mockSelect = vi.fn().mockReturnValue({ order: mockOrder })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/alerts",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ---------------------------------------------------------------------------
// POST /v1/admin/alerts
// ---------------------------------------------------------------------------

describe("POST /v1/admin/alerts", () => {
  it("returns 400 on validation error (missing alertType)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/alerts",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { threshold: 100 },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 on validation error (invalid alertType)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/alerts",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { alertType: "invalid", threshold: 100 },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 401 when no userId", async () => {
    // No x-user-id header => req.userId is undefined
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/alerts",
      payload: { alertType: "cost_overrun", threshold: 100 },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 200 with created alert data", async () => {
    const alertData = {
      id: TEST_ALERT_ID,
      alert_type: "cost_overrun",
      threshold: 100,
      user_id: TEST_USER_ID,
      is_enabled: true,
    }
    const mockSingle = vi.fn().mockResolvedValue({ data: alertData, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/alerts",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { alertType: "cost_overrun", threshold: 100 },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual(alertData)
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        alert_type: "cost_overrun",
        threshold: 100,
        user_id: TEST_USER_ID,
        is_enabled: true,
      })
    )
  })

  it("returns 500 on DB error", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "insert failed" },
    })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/alerts",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { alertType: "credit_low", threshold: 50 },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ---------------------------------------------------------------------------
// PUT /v1/admin/alerts/:id
// ---------------------------------------------------------------------------

describe("PUT /v1/admin/alerts/:id", () => {
  it("returns 400 for invalid UUID", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/admin/alerts/not-a-uuid",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { threshold: 200 },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 for invalid body (bad threshold type)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/v1/admin/alerts/${TEST_ALERT_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { threshold: "not-a-number" },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 404 on PGRST116", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq = vi.fn().mockReturnValue({ select: mockSelect })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "PUT",
      url: `/v1/admin/alerts/${TEST_ALERT_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { threshold: 200 },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 200 on success", async () => {
    const updatedAlert = {
      id: TEST_ALERT_ID,
      alert_type: "cost_overrun",
      threshold: 200,
      is_enabled: true,
    }
    const mockSingle = vi.fn().mockResolvedValue({ data: updatedAlert, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq = vi.fn().mockReturnValue({ select: mockSelect })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "PUT",
      url: `/v1/admin/alerts/${TEST_ALERT_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { threshold: 200 },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual(updatedAlert)
  })

  it("returns 500 on DB error", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "OTHER", message: "DB error" },
    })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq = vi.fn().mockReturnValue({ select: mockSelect })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "PUT",
      url: `/v1/admin/alerts/${TEST_ALERT_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { isEnabled: false },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ---------------------------------------------------------------------------
// DELETE /v1/admin/alerts/:id
// ---------------------------------------------------------------------------

describe("DELETE /v1/admin/alerts/:id", () => {
  it("returns 400 for invalid UUID", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/admin/alerts/not-a-uuid",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 200 on success", async () => {
    const mockEq = vi.fn().mockResolvedValue({ error: null })
    const mockDelete = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ delete: mockDelete } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/admin/alerts/${TEST_ALERT_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it("returns 500 on DB error", async () => {
    const mockEq = vi.fn().mockResolvedValue({ error: { message: "delete failed" } })
    const mockDelete = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ delete: mockDelete } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/admin/alerts/${TEST_ALERT_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ---------------------------------------------------------------------------
// GET /v1/admin/model-pricing
// ---------------------------------------------------------------------------

describe("GET /v1/admin/model-pricing", () => {
  it("returns 200 with data and total", async () => {
    const models = [
      { id: TEST_MODEL_ID, model_identifier: "flux", credit_cost: 10, is_enabled: true },
    ]
    const mockRange = vi.fn().mockResolvedValue({ data: models, error: null, count: 1 })
    const mockOrder = vi.fn().mockReturnValue({ range: mockRange })
    const mockSelect = vi.fn().mockReturnValue({ order: mockOrder })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/model-pricing",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toEqual(models)
    expect(body.total).toBe(1)
    expect(body.limit).toBe(100)
    expect(body.offset).toBe(0)
    expect(supabase.from).toHaveBeenCalledWith("model_pricing")
  })

  it("returns 500 on DB error", async () => {
    const mockRange = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "DB down" },
      count: null,
    })
    const mockOrder = vi.fn().mockReturnValue({ range: mockRange })
    const mockSelect = vi.fn().mockReturnValue({ order: mockOrder })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/model-pricing",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ---------------------------------------------------------------------------
// POST /v1/admin/model-pricing
// ---------------------------------------------------------------------------

describe("POST /v1/admin/model-pricing", () => {
  it("returns 400 on validation error (missing fields)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/model-pricing",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { modelIdentifier: "flux" },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 on validation error (invalid category)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/model-pricing",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        modelIdentifier: "flux",
        displayName: "Flux",
        category: "invalid",
        creditCost: 10,
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 200 on success", async () => {
    const modelData = {
      id: TEST_MODEL_ID,
      model_identifier: "flux",
      display_name: "Flux",
      category: "image",
      credit_cost: 10,
      is_enabled: true,
      tier_restriction: "free",
    }
    const mockSingle = vi.fn().mockResolvedValue({ data: modelData, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockUpsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/model-pricing",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        modelIdentifier: "flux",
        displayName: "Flux",
        category: "image",
        creditCost: 10,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual(modelData)
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        model_identifier: "flux",
        display_name: "Flux",
        category: "image",
        credit_cost: 10,
        is_enabled: true,
        tier_restriction: "free",
      }),
      { onConflict: "model_identifier" }
    )
  })

  it("returns 500 on DB error", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "upsert failed" },
    })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockUpsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/model-pricing",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        modelIdentifier: "flux",
        displayName: "Flux",
        category: "image",
        creditCost: 10,
      },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ---------------------------------------------------------------------------
// PUT /v1/admin/model-pricing/:id/toggle
// ---------------------------------------------------------------------------

describe("PUT /v1/admin/model-pricing/:id/toggle", () => {
  it("returns 400 for invalid UUID", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/admin/model-pricing/not-a-uuid/toggle",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { isEnabled: false },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 for invalid body (missing isEnabled)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/v1/admin/model-pricing/${TEST_MODEL_ID}/toggle`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: {},
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 for invalid body (wrong type)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/v1/admin/model-pricing/${TEST_MODEL_ID}/toggle`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { isEnabled: "yes" },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 404 on PGRST116", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq = vi.fn().mockReturnValue({ select: mockSelect })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "PUT",
      url: `/v1/admin/model-pricing/${TEST_MODEL_ID}/toggle`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { isEnabled: false },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 200 on success", async () => {
    const updatedModel = {
      id: TEST_MODEL_ID,
      model_identifier: "flux",
      is_enabled: false,
    }
    const mockSingle = vi.fn().mockResolvedValue({ data: updatedModel, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq = vi.fn().mockReturnValue({ select: mockSelect })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "PUT",
      url: `/v1/admin/model-pricing/${TEST_MODEL_ID}/toggle`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { isEnabled: false },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual(updatedModel)
  })

  it("returns 500 on DB error", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "OTHER", message: "DB error" },
    })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq = vi.fn().mockReturnValue({ select: mockSelect })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "PUT",
      url: `/v1/admin/model-pricing/${TEST_MODEL_ID}/toggle`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { isEnabled: true },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ---------------------------------------------------------------------------
// DELETE /v1/admin/model-pricing/:id
// ---------------------------------------------------------------------------

describe("DELETE /v1/admin/model-pricing/:id", () => {
  it("returns 400 for invalid UUID", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/admin/model-pricing/not-a-uuid",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 200 on success", async () => {
    const mockEq = vi.fn().mockResolvedValue({ error: null })
    const mockDelete = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ delete: mockDelete } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/admin/model-pricing/${TEST_MODEL_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it("returns 500 on DB error", async () => {
    const mockEq = vi.fn().mockResolvedValue({ error: { message: "delete failed" } })
    const mockDelete = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ delete: mockDelete } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/admin/model-pricing/${TEST_MODEL_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ---------------------------------------------------------------------------
// POST /v1/admin/assets/:id/promote-to-library
// ---------------------------------------------------------------------------

describe("POST /v1/admin/assets/:id/promote-to-library", () => {
  it("returns 400 for invalid UUID", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/assets/not-a-uuid/promote-to-library",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 404 when asset not found (PGRST116)", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "POST",
      url: `/v1/admin/assets/${TEST_ASSET_ID}/promote-to-library`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 500 on fetch error (non-PGRST116)", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "OTHER", message: "DB error" },
    })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "POST",
      url: `/v1/admin/assets/${TEST_ASSET_ID}/promote-to-library`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })

  it("returns 401 when no userId", async () => {
    // First from() call: fetch asset
    const mockSingle = vi.fn().mockResolvedValue({
      data: { id: TEST_ASSET_ID, metadata: {} },
      error: null,
    })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    // No x-user-id header => req.userId is undefined
    const res = await app.inject({
      method: "POST",
      url: `/v1/admin/assets/${TEST_ASSET_ID}/promote-to-library`,
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 200 on success with merged metadata", async () => {
    // First from() call: fetch existing asset
    const existingAsset = {
      id: TEST_ASSET_ID,
      metadata: { demoted_at: "old", demoted_by: "old-user", custom: "keep" },
    }
    const fetchSingle = vi.fn().mockResolvedValue({ data: existingAsset, error: null })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })
    const fetchSelect = vi.fn().mockReturnValue({ eq: fetchEq })

    // Second from() call: update asset
    const updatedAsset = {
      id: TEST_ASSET_ID,
      is_library_item: true,
      upload_source: "library",
      metadata: { custom: "keep", promoted_at: "2026-01-01", promoted_by: TEST_USER_ID },
    }
    const updateSingle = vi.fn().mockResolvedValue({ data: updatedAsset, error: null })
    const updateSelect = vi.fn().mockReturnValue({ single: updateSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const mockUpdate = vi.fn().mockReturnValue({ eq: updateEq })

    vi.mocked(supabase.from)
      .mockReturnValueOnce({ select: fetchSelect } as never)
      .mockReturnValueOnce({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "POST",
      url: `/v1/admin/assets/${TEST_ASSET_ID}/promote-to-library`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.message).toBe("Asset promoted to library")
    expect(body.data).toEqual(updatedAsset)

    // Verify update was called with correct fields
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        is_library_item: true,
        upload_source: "library",
      })
    )
  })

  it("returns 200 with null metadata treated as empty object", async () => {
    const existingAsset = { id: TEST_ASSET_ID, metadata: null }
    const fetchSingle = vi.fn().mockResolvedValue({ data: existingAsset, error: null })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })
    const fetchSelect = vi.fn().mockReturnValue({ eq: fetchEq })

    const updatedAsset = { id: TEST_ASSET_ID, is_library_item: true }
    const updateSingle = vi.fn().mockResolvedValue({ data: updatedAsset, error: null })
    const updateSelect = vi.fn().mockReturnValue({ single: updateSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const mockUpdate = vi.fn().mockReturnValue({ eq: updateEq })

    vi.mocked(supabase.from)
      .mockReturnValueOnce({ select: fetchSelect } as never)
      .mockReturnValueOnce({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "POST",
      url: `/v1/admin/assets/${TEST_ASSET_ID}/promote-to-library`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it("returns 500 on update error", async () => {
    const existingAsset = { id: TEST_ASSET_ID, metadata: {} }
    const fetchSingle = vi.fn().mockResolvedValue({ data: existingAsset, error: null })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })
    const fetchSelect = vi.fn().mockReturnValue({ eq: fetchEq })

    const updateSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "update failed" },
    })
    const updateSelect = vi.fn().mockReturnValue({ single: updateSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const mockUpdate = vi.fn().mockReturnValue({ eq: updateEq })

    vi.mocked(supabase.from)
      .mockReturnValueOnce({ select: fetchSelect } as never)
      .mockReturnValueOnce({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "POST",
      url: `/v1/admin/assets/${TEST_ASSET_ID}/promote-to-library`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ---------------------------------------------------------------------------
// POST /v1/admin/assets/:id/demote-from-library
// ---------------------------------------------------------------------------

describe("POST /v1/admin/assets/:id/demote-from-library", () => {
  it("returns 400 for invalid UUID", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/assets/not-a-uuid/demote-from-library",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 404 when asset not found (PGRST116)", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "POST",
      url: `/v1/admin/assets/${TEST_ASSET_ID}/demote-from-library`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 401 when no userId", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: { id: TEST_ASSET_ID, metadata: {} },
      error: null,
    })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "POST",
      url: `/v1/admin/assets/${TEST_ASSET_ID}/demote-from-library`,
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 200 on success with cleaned metadata", async () => {
    // First from() call: fetch existing asset with promotion metadata
    const existingAsset = {
      id: TEST_ASSET_ID,
      metadata: { promoted_at: "2026-01-01", promoted_by: "admin-1", custom: "keep" },
    }
    const fetchSingle = vi.fn().mockResolvedValue({ data: existingAsset, error: null })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })
    const fetchSelect = vi.fn().mockReturnValue({ eq: fetchEq })

    // Second from() call: update asset
    const updatedAsset = {
      id: TEST_ASSET_ID,
      is_library_item: false,
      upload_source: "manual_upload",
      metadata: { custom: "keep", demoted_at: "2026-01-02", demoted_by: TEST_USER_ID },
    }
    const updateSingle = vi.fn().mockResolvedValue({ data: updatedAsset, error: null })
    const updateSelect = vi.fn().mockReturnValue({ single: updateSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const mockUpdate = vi.fn().mockReturnValue({ eq: updateEq })

    vi.mocked(supabase.from)
      .mockReturnValueOnce({ select: fetchSelect } as never)
      .mockReturnValueOnce({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "POST",
      url: `/v1/admin/assets/${TEST_ASSET_ID}/demote-from-library`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.message).toBe("Asset demoted from library")
    expect(body.data).toEqual(updatedAsset)

    // Verify update was called with correct fields
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        is_library_item: false,
        upload_source: "manual_upload",
      })
    )
  })

  it("returns 500 on update error", async () => {
    const existingAsset = { id: TEST_ASSET_ID, metadata: {} }
    const fetchSingle = vi.fn().mockResolvedValue({ data: existingAsset, error: null })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })
    const fetchSelect = vi.fn().mockReturnValue({ eq: fetchEq })

    const updateSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "update failed" },
    })
    const updateSelect = vi.fn().mockReturnValue({ single: updateSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const mockUpdate = vi.fn().mockReturnValue({ eq: updateEq })

    vi.mocked(supabase.from)
      .mockReturnValueOnce({ select: fetchSelect } as never)
      .mockReturnValueOnce({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "POST",
      url: `/v1/admin/assets/${TEST_ASSET_ID}/demote-from-library`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})
