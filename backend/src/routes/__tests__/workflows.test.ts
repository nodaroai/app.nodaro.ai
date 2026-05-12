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

import { workflowRoutes } from "../workflows.js"
import { supabase } from "../../lib/supabase.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_PROJECT_ID = "00000000-0000-4000-8000-000000000010"
const TEST_WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"
const TEST_FOLDER_ID = "00000000-0000-4000-8000-000000000030"

const DB_WORKFLOW_META = {
  id: TEST_WORKFLOW_ID,
  project_id: TEST_PROJECT_ID,
  user_id: TEST_USER_ID,
  folder_id: null,
  name: "My Workflow",
  description: "Test workflow",
  is_template: false,
  thumbnail_url: null,
  version: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

const DB_WORKFLOW_FULL = {
  ...DB_WORKFLOW_META,
  source_prompt: null,
  nodes: [{ id: "n1", type: "generate-image" }],
  edges: [{ source: "n1", target: "n2" }],
  settings: { autoSave: true },
}

const CAMEL_META = {
  id: TEST_WORKFLOW_ID,
  projectId: TEST_PROJECT_ID,
  userId: TEST_USER_ID,
  folderId: null,
  name: "My Workflow",
  description: "Test workflow",
  isTemplate: false,
  thumbnailUrl: null,
  version: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
}

const CAMEL_FULL = {
  ...CAMEL_META,
  sourcePrompt: null,
  nodes: [{ id: "n1", type: "generate-image" }],
  edges: [{ source: "n1", target: "n2" }],
  settings: { autoSave: true },
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
    await workflowRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// GET /v1/projects/:projectId/workflows
// ---------------------------------------------------------------------------

describe("GET /v1/projects/:projectId/workflows", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${TEST_PROJECT_ID}/workflows`,
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 400 for invalid UUID", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/projects/not-a-uuid/workflows",
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns 200 with empty list", async () => {
    const mockOrder = vi.fn().mockResolvedValue({ data: [], error: null })
    const mockEq2 = vi.fn().mockReturnValue({ order: mockOrder })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${TEST_PROJECT_ID}/workflows`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([])
  })

  it("returns 200 with meta-only data (no nodes/edges)", async () => {
    const mockOrder = vi.fn().mockResolvedValue({ data: [DB_WORKFLOW_META], error: null })
    const mockEq2 = vi.fn().mockReturnValue({ order: mockOrder })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${TEST_PROJECT_ID}/workflows`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    const data = res.json().data[0]
    expect(data).toEqual(CAMEL_META)
    expect(data.nodes).toBeUndefined()
    expect(data.edges).toBeUndefined()
  })

  it("returns 500 on DB error", async () => {
    const mockOrder = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "DB down" },
    })
    const mockEq2 = vi.fn().mockReturnValue({ order: mockOrder })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${TEST_PROJECT_ID}/workflows`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// POST /v1/projects/:projectId/workflows
// ---------------------------------------------------------------------------

describe("POST /v1/projects/:projectId/workflows", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${TEST_PROJECT_ID}/workflows`,
      payload: { name: "Test" },
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 400 when name missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${TEST_PROJECT_ID}/workflows`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns 201 with defaults (nodes=[], edges=[])", async () => {
    const defaultRow = {
      ...DB_WORKFLOW_FULL,
      nodes: [],
      edges: [],
      settings: {},
      source_prompt: null,
    }
    const mockSingle = vi.fn().mockResolvedValue({ data: defaultRow, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${TEST_PROJECT_ID}/workflows`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "My Workflow" },
    })

    expect(res.statusCode).toBe(201)
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: TEST_PROJECT_ID,
        user_id: TEST_USER_ID,
        name: "My Workflow",
        nodes: [],
        edges: [],
      })
    )
  })

  it("returns 201 with all fields", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: DB_WORKFLOW_FULL, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${TEST_PROJECT_ID}/workflows`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "My Workflow",
        description: "Test workflow",
        folderId: TEST_FOLDER_ID,
        nodes: [{ id: "n1", type: "generate-image" }],
        edges: [{ source: "n1", target: "n2" }],
        settings: { autoSave: true },
        sourcePrompt: "Create a video",
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().data).toEqual(CAMEL_FULL)
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
      url: `/v1/projects/${TEST_PROJECT_ID}/workflows`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Test" },
    })

    expect(res.statusCode).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// GET /v1/workflows/:id
// ---------------------------------------------------------------------------

describe("GET /v1/workflows/:id", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 400 for invalid UUID", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflows/not-a-uuid",
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(400)
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
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 200 with full data (includes nodes/edges)", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: DB_WORKFLOW_FULL, error: null })
    const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data).toEqual(CAMEL_FULL)
    expect(data.nodes).toEqual([{ id: "n1", type: "generate-image" }])
    expect(data.edges).toEqual([{ source: "n1", target: "n2" }])
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
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// PATCH /v1/workflows/:id
// ---------------------------------------------------------------------------

describe("PATCH /v1/workflows/:id", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      payload: { name: "Updated" },
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 400 for invalid UUID", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/workflows/not-a-uuid",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Updated" },
    })
    expect(res.statusCode).toBe(400)
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
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Updated" },
    })

    expect(res.statusCode).toBe(404)
  })

  it("returns 200 on name-only update", async () => {
    const updated = { ...DB_WORKFLOW_FULL, name: "Updated" }
    const mockSingle = vi.fn().mockResolvedValue({ data: updated, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq2 = vi.fn().mockReturnValue({ select: mockSelect })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Updated" },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.name).toBe("Updated")
  })

  it("returns 200 on nodes+edges update (auto-save)", async () => {
    const newNodes = [{ id: "n1" }, { id: "n2" }]
    const newEdges = [{ source: "n1", target: "n2" }]
    const updated = { ...DB_WORKFLOW_FULL, nodes: newNodes, edges: newEdges }
    const mockSingle = vi.fn().mockResolvedValue({ data: updated, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq2 = vi.fn().mockReturnValue({ select: mockSelect })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { nodes: newNodes, edges: newEdges },
    })

    expect(res.statusCode).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: newNodes,
        edges: newEdges,
      })
    )
  })

  it("returns 200 on folderId set to null", async () => {
    const updated = { ...DB_WORKFLOW_FULL, folder_id: null }
    const mockSingle = vi.fn().mockResolvedValue({ data: updated, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq2 = vi.fn().mockReturnValue({ select: mockSelect })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { folderId: null },
    })

    expect(res.statusCode).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ folder_id: null })
    )
  })

  it("returns 200 on sourcePrompt update", async () => {
    const updated = { ...DB_WORKFLOW_FULL, source_prompt: "New prompt" }
    const mockSingle = vi.fn().mockResolvedValue({ data: updated, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq2 = vi.fn().mockReturnValue({ select: mockSelect })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { sourcePrompt: "New prompt" },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.sourcePrompt).toBe("New prompt")
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
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Updated" },
    })

    expect(res.statusCode).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// DELETE /v1/workflows/:id
// ---------------------------------------------------------------------------

describe("DELETE /v1/workflows/:id", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 400 for invalid UUID", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/workflows/not-a-uuid",
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns 200 on success", async () => {
    const mockEq2 = vi.fn().mockResolvedValue({ error: null })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockDelete = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ delete: mockDelete } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
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
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// Cross-tenant denial — behavior contract
// ---------------------------------------------------------------------------
// These tests simulate the case where a workflow UUID exists in the DB but
// is owned by a DIFFERENT user than the caller. The user_id-scoped query
// returns PGRST116 (no match), and the handler must reject the request.
// We additionally assert `.eq("user_id", CALLER)` is invoked — without this,
// a refactor that drops the scope but keeps the 404 path (e.g., by handling
// PGRST116 generically) would look green while silently re-opening IDOR.
// ---------------------------------------------------------------------------

describe("cross-tenant denial", () => {
  it("GET /v1/workflows/:id — foreign-owner row is 404 and query is user-scoped", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "no rows" },
    })
    const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(mockEq1).toHaveBeenCalledWith("id", TEST_WORKFLOW_ID)
    expect(mockEq2).toHaveBeenCalledWith("user_id", TEST_USER_ID)
  })

  it("PATCH /v1/workflows/:id — foreign-owner row is 404 and update is user-scoped", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "no rows" },
    })
    const mockSelectAfterEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq2 = vi.fn().mockReturnValue({ select: mockSelectAfterEq })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "takeover attempt" },
    })

    expect(res.statusCode).toBe(404)
    expect(mockEq1).toHaveBeenCalledWith("id", TEST_WORKFLOW_ID)
    expect(mockEq2).toHaveBeenCalledWith("user_id", TEST_USER_ID)
  })

  it("DELETE /v1/workflows/:id — delete is user-scoped (foreign rows untouched)", async () => {
    // supabase delete().eq().eq() returns { error: null } whether or not
    // rows matched — no way to distinguish "deleted" from "no-match" at the
    // query level. The critical security property is that .eq("user_id",
    // CALLER) is applied, which excludes other users' rows from the delete
    // set. We assert the scope; the victim's row is then provably untouched.
    const mockEq2 = vi.fn().mockResolvedValue({ error: null })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockDelete = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ delete: mockDelete } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(mockEq1).toHaveBeenCalledWith("id", TEST_WORKFLOW_ID)
    expect(mockEq2).toHaveBeenCalledWith("user_id", TEST_USER_ID)
  })
})

// POST /v1/workflows/:id/run — now handled by workflow-execution routes
// (tested in workflow-execution.test.ts if present)

// ---------------------------------------------------------------------------
// GET /v1/workflows/:id/export
// ---------------------------------------------------------------------------

describe("GET /v1/workflows/:id/export", () => {
  const CHAR_ROW = {
    id: "char-1",
    node_id: "n-char",
    name: "Hero",
    description: null,
    gender: "male",
    style: null,
    base_outfit: null,
    source_image_url: null,
    expressions: [],
    poses: [],
    lighting_variations: [],
  }

  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}/export`,
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 404 when workflow not found", async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } }),
    }
    vi.mocked(supabase.from).mockReturnValue(mockChain as any)

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}/export`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(404)
  })

  it("returns template export (no assets) by default", async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: DB_WORKFLOW_FULL, error: null }),
    }
    vi.mocked(supabase.from).mockReturnValue(mockChain as any)

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}/export`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.version).toBe(1)
    expect(body.name).toBe("My Workflow")
    expect(body.assets).toBeUndefined()
    expect(body.exportedAt).toBeDefined()
  })

  it("includes assets when assets=true and entities exist", async () => {
    const workflowWithChar = {
      ...DB_WORKFLOW_FULL,
      nodes: [{ id: "n-char", type: "character", data: { characterDbId: "char-1" } }],
    }
    const workflowChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: workflowWithChar, error: null }),
    }
    // `.eq(...)` is now the terminal call (after `.in()`) → the chain resolves like a thenable.
    // Use a real thenable (invokes `resolve`), not `mockResolvedValue` (which
    // only returns a promise and ignores the callbacks `await`/`Promise.all` pass).
    const charChain = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
        resolve({ data: [CHAR_ROW], error: null }),
    }
    const emptyChain = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
        resolve({ data: [], error: null }),
    }
    // Only 2 supabase.from calls happen: workflows + characters.
    // objectIds and locationIds are empty, so those use Promise.resolve — no from() call.
    vi.mocked(supabase.from)
      .mockReturnValueOnce(workflowChain as any)
      .mockReturnValueOnce(charChain as any)

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}/export?assets=true`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.assets.characters).toHaveLength(1)
    expect(body.assets.characters[0].id).toBe("char-1")
    expect(body.assets.objects).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// POST /v1/workflows/import
// ---------------------------------------------------------------------------

describe("POST /v1/workflows/import", () => {
  const IMPORT_WF_JSON = {
    version: 1,
    exportedAt: "2026-01-01T00:00:00Z",
    name: "Imported WF",
    nodes: [{ id: "n1", type: "generate-image", data: {} }],
    edges: [{ source: "n1", target: "n2" }],
    settings: { autoSave: true },
  }

  const IMPORT_WF_JSON_WITH_ASSETS = {
    version: 1,
    exportedAt: "2026-01-01T00:00:00Z",
    name: "Imported WF With Assets",
    nodes: [
      { id: "n-char", type: "character", data: { characterDbId: "old-char-1", name: "Hero" } },
      { id: "n-obj", type: "object", data: { objectDbId: "old-obj-1" } },
      { id: "n-loc", type: "location", data: { locationDbId: "old-loc-1" } },
      { id: "n-img", type: "generate-image", data: {} },
    ],
    edges: [{ source: "n-char", target: "n-img" }],
    settings: {},
    assets: {
      characters: [{ id: "old-char-1", nodeId: "n-char", name: "Hero", gender: "male" }],
      objects: [{ id: "old-obj-1", nodeId: "n-obj", name: "Sword" }],
      locations: [{ id: "old-loc-1", nodeId: "n-loc", name: "Castle" }],
    },
  }

  function projectChain(data: unknown, error: unknown = null) {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data, error }),
    }
  }

  function insertIdChain(id: string) {
    return {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id }, error: null }),
    }
  }

  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows/import",
      payload: { projectId: TEST_PROJECT_ID, workflow_json: IMPORT_WF_JSON },
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 400 when projectId is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows/import",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { workflow_json: IMPORT_WF_JSON },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 404 when project not found or not owned by user", async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      projectChain(null, { code: "PGRST116", message: "no rows" }) as never
    )
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows/import",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { projectId: TEST_PROJECT_ID, workflow_json: IMPORT_WF_JSON },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("imports a workflow without assets and returns 201", async () => {
    const newRow = {
      ...DB_WORKFLOW_FULL,
      name: "Imported WF",
      nodes: IMPORT_WF_JSON.nodes,
      edges: IMPORT_WF_JSON.edges,
      settings: IMPORT_WF_JSON.settings,
    }
    const insertFn = vi.fn().mockReturnThis()
    const workflowChain = {
      insert: insertFn,
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: newRow, error: null }),
    }
    vi.mocked(supabase.from)
      .mockReturnValueOnce(projectChain({ id: TEST_PROJECT_ID, user_id: TEST_USER_ID }) as never)
      .mockReturnValueOnce(workflowChain as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows/import",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { projectId: TEST_PROJECT_ID, workflow_json: IMPORT_WF_JSON },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.data.name).toBe("Imported WF")
    expect(body.data.projectId).toBe(TEST_PROJECT_ID)
    expect(body.data.userId).toBe(TEST_USER_ID)
    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: TEST_PROJECT_ID,
        user_id: TEST_USER_ID,
        name: "Imported WF",
      })
    )
  })

  it("imports a workflow with assets and remaps entity DB ids on nodes", async () => {
    const newRow = { ...DB_WORKFLOW_FULL, name: "Imported WF With Assets" }
    const wfInsertFn = vi.fn().mockReturnThis()
    const workflowChain = {
      insert: wfInsertFn,
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: newRow, error: null }),
    }
    vi.mocked(supabase.from)
      .mockReturnValueOnce(projectChain({ id: TEST_PROJECT_ID, user_id: TEST_USER_ID }) as never)
      .mockReturnValueOnce(insertIdChain("new-char-1") as never)
      .mockReturnValueOnce(insertIdChain("new-obj-1") as never)
      .mockReturnValueOnce(insertIdChain("new-loc-1") as never)
      .mockReturnValueOnce(workflowChain as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows/import",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { projectId: TEST_PROJECT_ID, workflow_json: IMPORT_WF_JSON_WITH_ASSETS },
    })

    expect(res.statusCode).toBe(201)

    const insertArg = wfInsertFn.mock.calls[0][0] as {
      nodes: Array<{ id: string; data: Record<string, unknown> }>
    }
    const byId = Object.fromEntries(insertArg.nodes.map((n) => [n.id, n]))
    expect(byId["n-char"].data.characterDbId).toBe("new-char-1")
    expect(byId["n-obj"].data.objectDbId).toBe("new-obj-1")
    expect(byId["n-loc"].data.locationDbId).toBe("new-loc-1")
    expect(byId["n-char"].data.name).toBe("Hero")
    expect(byId["n-img"].data).toEqual({})
  })
})
