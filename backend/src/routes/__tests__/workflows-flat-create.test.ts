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
// Fixtures
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_PROJECT_ID = "00000000-0000-4000-8000-000000000010"
const OTHER_PROJECT_ID = "00000000-0000-4000-8000-000000000011"
const TEST_WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"
const DEFAULT_PROJECT_ID = "00000000-0000-4000-8000-000000000099"

const DB_WORKFLOW_FULL = {
  id: TEST_WORKFLOW_ID,
  project_id: TEST_PROJECT_ID,
  user_id: TEST_USER_ID,
  folder_id: null,
  name: "Untitled Workflow",
  description: null,
  is_template: false,
  thumbnail_url: null,
  version: 1,
  source_prompt: null,
  nodes: [],
  edges: [],
  settings: {},
  parent_workflow_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
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
// GET /v1/workflows — flat owner-scoped list
// ---------------------------------------------------------------------------

describe("GET /v1/workflows", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/workflows" })
    expect(res.statusCode).toBe(401)
  })

  it("returns the caller's workflows ordered by updated_at desc", async () => {
    const mockLimit = vi.fn().mockResolvedValue({
      data: [
        DB_WORKFLOW_FULL,
        { ...DB_WORKFLOW_FULL, id: "id-2", name: "Other", updated_at: "2025-12-31T00:00:00Z" },
      ],
      error: null,
    })
    const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit })
    const mockIs = vi.fn().mockReturnValue({ order: mockOrder })
    const mockEq = vi.fn().mockReturnValue({ is: mockIs })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/workflows",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(2)
    expect(mockEq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
    expect(mockIs).toHaveBeenCalledWith("parent_workflow_id", null)
    expect(mockOrder).toHaveBeenCalledWith("updated_at", { ascending: false })
  })

  it("respects a custom limit", async () => {
    const mockLimit = vi.fn().mockResolvedValue({ data: [], error: null })
    const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit })
    const mockIs = vi.fn().mockReturnValue({ order: mockOrder })
    const mockEq = vi.fn().mockReturnValue({ is: mockIs })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/workflows?limit=25",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(mockLimit).toHaveBeenCalledWith(25)
  })

  it("rejects limit > 500", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflows?limit=10000",
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// POST /v1/workflows — project-less / quick create
// ---------------------------------------------------------------------------

describe("POST /v1/workflows", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows",
      payload: { name: "X" },
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 400 when name missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it("creates the workflow under the default project when projectId is omitted", async () => {
    // Sequence of supabase.from() calls inside the handler:
    //   1) ensureDefaultProject lookup (select.eq.eq.maybeSingle) →
    //      returns the existing default row.
    //   2) workflows.insert(...).select(...).single() → returns the new wf.
    const defaultRow = {
      id: DEFAULT_PROJECT_ID,
      user_id: TEST_USER_ID,
      name: "My Recent Flows",
      description: null,
      settings: {},
      is_default: true,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    }

    const lookupMaybeSingle = vi.fn().mockResolvedValue({ data: defaultRow, error: null })
    const lookupEq2 = vi.fn().mockReturnValue({ maybeSingle: lookupMaybeSingle })
    const lookupEq1 = vi.fn().mockReturnValue({ eq: lookupEq2 })
    const projectsSelect = vi.fn().mockReturnValue({ eq: lookupEq1 })

    const insertSingle = vi.fn().mockResolvedValue({
      data: { ...DB_WORKFLOW_FULL, project_id: DEFAULT_PROJECT_ID },
      error: null,
    })
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle })
    const workflowsInsert = vi.fn().mockReturnValue({ select: insertSelect })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "projects") return { select: projectsSelect } as never
      if (table === "workflows") return { insert: workflowsInsert } as never
      throw new Error(`unexpected table ${table}`)
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Quick" },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().data.projectId).toBe(DEFAULT_PROJECT_ID)
    expect(workflowsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: DEFAULT_PROJECT_ID,
        user_id: TEST_USER_ID,
        name: "Quick",
      }),
    )
  })

  it("creates under a caller-owned projectId when provided", async () => {
    // Sequence:
    //   1) projects ownership lookup → returns { id } so OK.
    //   2) workflows insert → returns the new row.
    const ownershipMaybeSingle = vi.fn().mockResolvedValue({ data: { id: TEST_PROJECT_ID }, error: null })
    const ownershipEq2 = vi.fn().mockReturnValue({ maybeSingle: ownershipMaybeSingle })
    const ownershipEq1 = vi.fn().mockReturnValue({ eq: ownershipEq2 })
    const projectsSelect = vi.fn().mockReturnValue({ eq: ownershipEq1 })

    const insertSingle = vi.fn().mockResolvedValue({ data: DB_WORKFLOW_FULL, error: null })
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle })
    const workflowsInsert = vi.fn().mockReturnValue({ select: insertSelect })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "projects") return { select: projectsSelect } as never
      if (table === "workflows") return { insert: workflowsInsert } as never
      throw new Error(`unexpected table ${table}`)
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Named", projectId: TEST_PROJECT_ID },
    })

    expect(res.statusCode).toBe(201)
    expect(ownershipEq1).toHaveBeenCalledWith("id", TEST_PROJECT_ID)
    expect(ownershipEq2).toHaveBeenCalledWith("user_id", TEST_USER_ID)
  })

  it("returns 404 when projectId belongs to another user", async () => {
    const ownershipMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const ownershipEq2 = vi.fn().mockReturnValue({ maybeSingle: ownershipMaybeSingle })
    const ownershipEq1 = vi.fn().mockReturnValue({ eq: ownershipEq2 })
    const projectsSelect = vi.fn().mockReturnValue({ eq: ownershipEq1 })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "projects") return { select: projectsSelect } as never
      throw new Error(`workflows.insert should not run when project lookup fails`)
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Sneaky", projectId: OTHER_PROJECT_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })
})

// ---------------------------------------------------------------------------
// PATCH /v1/workflows/:id — cross-project move
// ---------------------------------------------------------------------------

describe("PATCH /v1/workflows/:id (projectId move)", () => {
  it("moves the workflow to a caller-owned project and clears folder_id", async () => {
    // Order of `from()` calls:
    //   1) projects: ownership lookup for the target project (succeeds).
    //   2) workflows: update.
    const ownershipMaybeSingle = vi.fn().mockResolvedValue({ data: { id: OTHER_PROJECT_ID }, error: null })
    const ownershipEq2 = vi.fn().mockReturnValue({ maybeSingle: ownershipMaybeSingle })
    const ownershipEq1 = vi.fn().mockReturnValue({ eq: ownershipEq2 })
    const projectsSelect = vi.fn().mockReturnValue({ eq: ownershipEq1 })

    const updateSingle = vi.fn().mockResolvedValue({
      data: { ...DB_WORKFLOW_FULL, project_id: OTHER_PROJECT_ID, folder_id: null },
      error: null,
    })
    // Optimistic-locking landed: PATCH now uses `.maybeSingle()`.
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateSingle })
    const updateEq2 = vi.fn().mockReturnValue({ select: updateSelect })
    const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 })
    const workflowsUpdate = vi.fn().mockReturnValue({ eq: updateEq1 })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "projects") return { select: projectsSelect } as never
      if (table === "workflows") return { update: workflowsUpdate } as never
      throw new Error(`unexpected table ${table}`)
    })

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { projectId: OTHER_PROJECT_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.projectId).toBe(OTHER_PROJECT_ID)
    // Ownership probe must scope by user_id (no IDOR).
    expect(ownershipEq2).toHaveBeenCalledWith("user_id", TEST_USER_ID)
    // The update must apply project_id and clear folder_id.
    expect(workflowsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: OTHER_PROJECT_ID, folder_id: null }),
    )
  })

  it("returns 404 when the target projectId is not owned by the caller", async () => {
    const ownershipMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const ownershipEq2 = vi.fn().mockReturnValue({ maybeSingle: ownershipMaybeSingle })
    const ownershipEq1 = vi.fn().mockReturnValue({ eq: ownershipEq2 })
    const projectsSelect = vi.fn().mockReturnValue({ eq: ownershipEq1 })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "projects") return { select: projectsSelect } as never
      throw new Error("update should not run when target project is foreign")
    })

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { projectId: OTHER_PROJECT_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })
})
