import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  return {
    supabase: {
      from: mockFrom,
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-123" } },
          error: null,
        }),
      },
    },
  }
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
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { projectRoutes } from "../projects.js"
import { supabase } from "../../lib/supabase.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_PROJECT_ID = "00000000-0000-4000-8000-000000000010"

const DB_PROJECT = {
  id: TEST_PROJECT_ID,
  user_id: TEST_USER_ID,
  name: "My Project",
  description: "A test project",
  settings: { theme: "dark" },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

const CAMEL_PROJECT = {
  id: TEST_PROJECT_ID,
  userId: TEST_USER_ID,
  name: "My Project",
  description: "A test project",
  settings: { theme: "dark" },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
}

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
    await projectRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// GET /v1/projects
// ---------------------------------------------------------------------------

describe("GET /v1/projects", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/projects" })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 200 with empty list", async () => {
    const mockOrder = vi.fn().mockResolvedValue({ data: [], error: null })
    const mockEq = vi.fn().mockReturnValue({ order: mockOrder })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([])
  })

  it("returns 200 with camelCase data", async () => {
    const mockOrder = vi.fn().mockResolvedValue({ data: [DB_PROJECT], error: null })
    const mockEq = vi.fn().mockReturnValue({ order: mockOrder })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([CAMEL_PROJECT])
  })

  it("returns 500 on DB error", async () => {
    const mockOrder = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "DB down" },
    })
    const mockEq = vi.fn().mockReturnValue({ order: mockOrder })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ---------------------------------------------------------------------------
// POST /v1/projects
// ---------------------------------------------------------------------------

describe("POST /v1/projects", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      payload: { name: "Test" },
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 400 when name missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 when name is empty string", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns 400 when name is too long", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "a".repeat(201) },
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns 201 on success", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: DB_PROJECT, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "My Project" },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().data).toEqual(CAMEL_PROJECT)
  })

  it("returns 201 with optional fields", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: DB_PROJECT, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "My Project",
        description: "A test project",
        settings: { theme: "dark" },
      },
    })

    expect(res.statusCode).toBe(201)
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "My Project",
        description: "A test project",
        settings: { theme: "dark" },
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
      url: "/v1/projects",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Test" },
    })

    expect(res.statusCode).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// GET /v1/projects/:id
// ---------------------------------------------------------------------------

describe("GET /v1/projects/:id", () => {
  it("returns 400 for invalid UUID", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/projects/not-a-uuid",
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${TEST_PROJECT_ID}`,
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 404 when not found (PGRST116)", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    })
    const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${TEST_PROJECT_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 200 on success", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: DB_PROJECT, error: null })
    const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${TEST_PROJECT_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual(CAMEL_PROJECT)
  })

  it("returns 500 on DB error", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "OTHER", message: "DB error" },
    })
    const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${TEST_PROJECT_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// PATCH /v1/projects/:id
// ---------------------------------------------------------------------------

describe("PATCH /v1/projects/:id", () => {
  it("returns 400 for invalid UUID", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/projects/not-a-uuid",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Updated" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns 400 for empty body", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${TEST_PROJECT_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain("At least one field")
  })

  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${TEST_PROJECT_ID}`,
      payload: { name: "Updated" },
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 404 when not found", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq2 = vi.fn().mockReturnValue({ select: mockSelect })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${TEST_PROJECT_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Updated" },
    })

    expect(res.statusCode).toBe(404)
  })

  it("returns 200 on name update", async () => {
    const updated = { ...DB_PROJECT, name: "Updated" }
    const mockSingle = vi.fn().mockResolvedValue({ data: updated, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq2 = vi.fn().mockReturnValue({ select: mockSelect })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${TEST_PROJECT_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Updated" },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.name).toBe("Updated")
  })

  it("returns 200 on settings update", async () => {
    const updated = { ...DB_PROJECT, settings: { lang: "en" } }
    const mockSingle = vi.fn().mockResolvedValue({ data: updated, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq2 = vi.fn().mockReturnValue({ select: mockSelect })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${TEST_PROJECT_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { settings: { lang: "en" } },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.settings).toEqual({ lang: "en" })
  })

  it("returns 500 on DB error", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "OTHER", message: "DB error" },
    })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq2 = vi.fn().mockReturnValue({ select: mockSelect })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${TEST_PROJECT_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Updated" },
    })

    expect(res.statusCode).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// DELETE /v1/projects/:id
// ---------------------------------------------------------------------------

describe("DELETE /v1/projects/:id", () => {
  it("returns 400 for invalid UUID", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/projects/not-a-uuid",
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${TEST_PROJECT_ID}`,
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 200 on success", async () => {
    const mockEq2 = vi.fn().mockResolvedValue({ error: null })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockDelete = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ delete: mockDelete } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${TEST_PROJECT_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it("returns 500 on DB error", async () => {
    const mockEq2 = vi.fn().mockResolvedValue({ error: { message: "FK constraint" } })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockDelete = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ delete: mockDelete } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${TEST_PROJECT_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
  })
})
