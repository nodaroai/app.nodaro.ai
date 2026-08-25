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
  // These routes resolve a default project, which now asks whether the
  // caller's organization allows a personal space at all. Off here: this file
  // is about the behaviour every user without an organization gets.
  hasOrganizations: () => false,
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
  workspace_id: null,
  visibility: "private",
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
    // Two .is() links now: the workspace half of the personal filter, then
    // parent_workflow_id. The first returns a shape carrying the second.
    const mockIsParent = vi.fn().mockReturnValue({ order: mockOrder })
    const mockIsWorkspace = vi.fn().mockReturnValue({ is: mockIsParent })
    const mockEq = vi.fn().mockReturnValue({ is: mockIsWorkspace })
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
    expect(mockIsWorkspace).toHaveBeenCalledWith("workspace_id", null)
    expect(mockIsParent).toHaveBeenCalledWith("parent_workflow_id", null)
    expect(mockOrder).toHaveBeenCalledWith("updated_at", { ascending: false })
  })

  it("respects a custom limit", async () => {
    const mockLimit = vi.fn().mockResolvedValue({ data: [], error: null })
    const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit })
    // Two .is() links now: the workspace half of the personal filter, then
    // parent_workflow_id. The first returns a shape carrying the second.
    const mockIsParent = vi.fn().mockReturnValue({ order: mockOrder })
    const mockIsWorkspace = vi.fn().mockReturnValue({ is: mockIsParent })
    const mockEq = vi.fn().mockReturnValue({ is: mockIsWorkspace })
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
    // The project is now fetched by id ALONE and judged in TypeScript — inside
    // a workspace the owning user is not the caller, so .eq("user_id") would
    // decide the question before asking it.
    const ownershipMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: TEST_PROJECT_ID, app_slug: null, user_id: TEST_USER_ID, workspace_id: null },
      error: null,
    })
    const ownershipEq1 = vi.fn().mockReturnValue({ maybeSingle: ownershipMaybeSingle })
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
    // The owner and the workspace must still be READ, or the decision that
    // replaced the filter has nothing to decide on.
    expect(projectsSelect).toHaveBeenCalledWith(expect.stringContaining("user_id"))
    expect(projectsSelect).toHaveBeenCalledWith(expect.stringContaining("workspace_id"))
  })

  it("returns 404 when projectId belongs to another user", async () => {
    // The row EXISTS — it simply is not the caller's. The query used to filter
    // it out; now the route refuses it on the facts, which is the case that
    // would go unnoticed if only "missing" were ever tested.
    const ownershipMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: TEST_PROJECT_ID,
        app_slug: null,
        user_id: "00000000-0000-4000-8000-0000000000ff",
        workspace_id: null,
      },
      error: null,
    })
    const ownershipEq1 = vi.fn().mockReturnValue({ maybeSingle: ownershipMaybeSingle })
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
  /**
   * PATCH now shares the move endpoint's authorization, so the reads changed
   * shape: the WORKFLOW is loaded first (its owner and its assignment are
   * inputs to the decision), then the target project, then the update.
   */
  function mockMoveTables(opts: {
    workflow?: Record<string, unknown> | null
    project?: Record<string, unknown> | null
    onUpdate?: ReturnType<typeof vi.fn>
  }) {
    const wfMaybeSingle = vi.fn().mockResolvedValue({
      data:
        opts.workflow === undefined
          ? {
              id: TEST_WORKFLOW_ID,
              user_id: TEST_USER_ID,
              workspace_id: null,
              visibility: "private",
              project_id: TEST_PROJECT_ID,
              assignment_id: null,
            }
          : opts.workflow,
      error: null,
    })
    const wfEq = vi.fn().mockReturnValue({ maybeSingle: wfMaybeSingle })
    const wfSelect = vi.fn().mockReturnValue({ eq: wfEq })

    const projMaybeSingle = vi.fn().mockResolvedValue({
      data:
        opts.project === undefined
          ? { id: OTHER_PROJECT_ID, user_id: TEST_USER_ID, workspace_id: null }
          : opts.project,
      error: null,
    })
    const projEq = vi.fn().mockReturnValue({ maybeSingle: projMaybeSingle })
    const projSelect = vi.fn().mockReturnValue({ eq: projEq })

    const workflowsUpdate =
      opts.onUpdate ??
      vi.fn().mockImplementation(() => {
        throw new Error("update should not run")
      })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "projects") return { select: projSelect } as never
      if (table === "workflows") return { select: wfSelect, update: workflowsUpdate } as never
      throw new Error("unexpected table " + table)
    })
    return { wfEq, projEq, workflowsUpdate }
  }

  it("moves the workflow to a caller-owned project and clears folder_id", async () => {
    const updateSingle = vi.fn().mockResolvedValue({
      data: { ...DB_WORKFLOW_FULL, project_id: OTHER_PROJECT_ID, folder_id: null },
      error: null,
    })
    // Optimistic-locking landed: PATCH now uses `.maybeSingle()`.
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateSingle })
    const updateEq1 = vi.fn().mockReturnValue({ select: updateSelect })
    const workflowsUpdate = vi.fn().mockReturnValue({ eq: updateEq1 })

    const { projEq } = mockMoveTables({ onUpdate: workflowsUpdate })

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { projectId: OTHER_PROJECT_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.projectId).toBe(OTHER_PROJECT_ID)
    expect(projEq).toHaveBeenCalledWith("id", OTHER_PROJECT_ID)
    // The update must apply project_id and clear folder_id.
    expect(workflowsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: OTHER_PROJECT_ID, folder_id: null }),
    )
  })

  it("returns 404 when the target project does not exist", async () => {
    mockMoveTables({ project: null })

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { projectId: OTHER_PROJECT_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("refuses when the target project exists but belongs to someone else", async () => {
    // The IDOR case, now decided on the facts rather than filtered out by the
    // query. Owning the WORKFLOW is not enough: without this the caller could
    // park their work in a stranger's project, which that stranger cannot see
    // into but can delete.
    mockMoveTables({
      project: { id: OTHER_PROJECT_ID, user_id: "00000000-0000-4000-8000-0000000000ff", workspace_id: null },
    })

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { projectId: OTHER_PROJECT_ID },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("not_permitted")
  })

  it("refuses to move someone else's workflow — 404, because it is not theirs to see", async () => {
    // 403 until P10. The PATCH route now settles ACCESS before it looks at
    // anything else, so a workflow this caller has no standing on is refused
    // the same way every other by-id route refuses it: as one that does not
    // exist. The move authorization is still there and still runs — it is
    // simply no longer the first thing a stranger can reach, which is what
    // made 403 an existence oracle for anyone holding two ids.
    //
    // `POST /v1/workflows/:id/move` still answers 403 for this case; it was
    // not part of P10's conversion list and its status code is not something
    // a scoping change gets to alter silently. Unifying the two is a
    // deliberate follow-up.
    mockMoveTables({
      workflow: {
        id: TEST_WORKFLOW_ID,
        user_id: "00000000-0000-4000-8000-0000000000ff",
        workspace_id: null,
        visibility: "private",
        project_id: TEST_PROJECT_ID,
        assignment_id: null,
      },
    })

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { projectId: OTHER_PROJECT_ID },
    })

    expect(res.statusCode).toBe(404)
  })

  it("refuses work that belongs to an assignment", async () => {
    mockMoveTables({
      workflow: {
        id: TEST_WORKFLOW_ID,
        user_id: TEST_USER_ID,
        workspace_id: null,
        visibility: "private",
        project_id: TEST_PROJECT_ID,
        assignment_id: "00000000-0000-4000-8000-0000000000aa",
      },
    })

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { projectId: OTHER_PROJECT_ID },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("move_blocked")
  })

  it("refuses a move into the project it is already in", async () => {
    mockMoveTables({
      project: { id: TEST_PROJECT_ID, user_id: TEST_USER_ID, workspace_id: null },
    })

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { projectId: TEST_PROJECT_ID },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })
})
