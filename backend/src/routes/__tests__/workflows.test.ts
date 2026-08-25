import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  const mockRpc = vi.fn()
  return {
    supabase: {
      from: mockFrom,
      rpc: mockRpc,
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

vi.mock("@/lib/workflow-delete.js", () => ({
  deleteWorkflowWithPrivateMedia: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { workflowRoutes } from "../workflows.js"
import { supabase } from "../../lib/supabase.js"
import { deleteWorkflowWithPrivateMedia } from "../../lib/workflow-delete.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_PROJECT_ID = "00000000-0000-4000-8000-000000000010"
const TEST_WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"
const TEST_FOLDER_ID = "00000000-0000-4000-8000-000000000030"
/** Somebody else entirely — the caller has no standing on their work. */
const OTHER_USER_ID = "00000000-0000-4000-8000-0000000000ff"

const DB_WORKFLOW_META = {
  id: TEST_WORKFLOW_ID,
  project_id: TEST_PROJECT_ID,
  user_id: TEST_USER_ID,
  workspace_id: null,
  visibility: "private",
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
  workspaceId: null,
  visibility: "private",
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
  parentWorkflowId: null,
  // Which client app created this workflow; null = native (app.nodaro.ai itself).
  appSlug: null,
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(deleteWorkflowWithPrivateMedia).mockResolvedValue(true)

  app = Fastify({ logger: false })

  // Bypass auth — set userId from header. When `x-app-scopes` is present,
  // also simulate an OAuth developer-app token (sets req.appAuthorization) so
  // scope enforcement can be exercised. Absent the header, appAuthorization
  // stays undefined (the Supabase-JWT owner path), matching every other test.
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (header && typeof header === "string") {
      req.userId = header
      req.userRole = undefined
    }
    const scopesHeader = req.headers["x-app-scopes"]
    if (typeof scopesHeader === "string") {
      req.appAuthorization = {
        appId: "app-1",
        authorizationId: "authz-1",
        scopes: scopesHeader.split(/\s+/).filter(Boolean),
      }
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

/**
 * The unfiltered by-id read every converted route now begins with.
 *
 * `.eq("id", …).eq("user_id", …)` decided who may reach a workflow inside the
 * query. The by-id routes ask the access rule instead, which means reading the
 * row first and judging it after — so a by-id test answers that read before
 * whatever chain it is actually about.
 *
 * Successive results feed successive reads, and the LAST one then repeats —
 * one request legitimately reads the same row more than once (DELETE asks the
 * access rule and then asks again whether this caller may delete), and a row
 * does not become a different row in between. Where the two answers really
 * must differ, pass both: PATCH's conflict path authorizes on the first read
 * and reports the other writer's version from the second.
 */
function workflowReads(...results: Array<{ data: unknown; error?: unknown }>) {
  const maybeSingle = vi.fn()
  for (const r of results.slice(0, -1)) {
    maybeSingle.mockResolvedValueOnce({ data: r.data, error: r.error ?? null })
  }
  const last = results[results.length - 1] ?? { data: null }
  maybeSingle.mockResolvedValue({ data: last.data, error: last.error ?? null })
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })
  return { select, eq, maybeSingle }
}

/** `workflowReads` wired straight onto `supabase.from`, for read-only routes. */
function mockWorkflowRead(...results: Array<{ data: unknown; error?: unknown }>) {
  const reads = workflowReads(...results)
  vi.mocked(supabase.from).mockReturnValue({ select: reads.select } as never)
  return reads
}

/**
 * The project-addressed routes read the project BEFORE touching workflows:
 * whether the caller may work inside it is decided from the row, not filtered
 * out by the query, because inside a workspace the owning user is not the
 * caller.
 *
 * `otherTables` is whatever the test wants every non-`projects` table to
 * return, so each test keeps mocking only the chain it cares about.
 */
function mockProjectScope(
  otherTables: Record<string, unknown>,
  project: Record<string, unknown> | null = {
    id: TEST_PROJECT_ID,
    app_slug: null,
    user_id: TEST_USER_ID,
    workspace_id: null,
  },
) {
  const scopeMaybeSingle = vi.fn().mockResolvedValue({ data: project, error: null })
  const scopeEq = vi.fn().mockReturnValue({ maybeSingle: scopeMaybeSingle })
  const scopeSelect = vi.fn().mockReturnValue({ eq: scopeEq })
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "projects") return { select: scopeSelect } as never
    return otherTables as never
  })
  return { scopeSelect, scopeEq }
}

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
    const mockIs = vi.fn().mockReturnValue({ order: mockOrder })
    const mockEq2 = vi.fn().mockReturnValue({ is: mockIs })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
    mockProjectScope({ select: mockSelect })

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
    const mockIs = vi.fn().mockReturnValue({ order: mockOrder })
    const mockEq2 = vi.fn().mockReturnValue({ is: mockIs })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
    mockProjectScope({ select: mockSelect })

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
    const mockIs = vi.fn().mockReturnValue({ order: mockOrder })
    const mockEq2 = vi.fn().mockReturnValue({ is: mockIs })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
    mockProjectScope({ select: mockSelect })

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
    mockProjectScope({ insert: mockInsert })

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
    mockProjectScope({ insert: mockInsert })

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
    mockProjectScope({ insert: mockInsert })

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

  it("returns 404 when the row does not exist", async () => {
    // `.maybeSingle()` reports "no rows" as data null with no error — the old
    // PGRST116 error shape belonged to `.single()`, which the access read
    // deliberately does not use: a missing row is an ordinary answer here.
    mockWorkflowRead({ data: null })

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 404 — NOT 403 — for a workflow this caller cannot reach", async () => {
    // The rule the conversion had to preserve: a workflow you have no access
    // to is indistinguishable from one that does not exist. A 403 here would
    // confirm to a stranger that the id is real.
    mockWorkflowRead({ data: { ...DB_WORKFLOW_FULL, user_id: OTHER_USER_ID } })

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 200 with full data (includes nodes/edges) and the caller's access level", async () => {
    mockWorkflowRead({ data: DB_WORKFLOW_FULL })

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data).toEqual({ ...CAMEL_FULL, access: "own" })
    expect(data.nodes).toEqual([{ id: "n1", type: "generate-image" }])
    expect(data.edges).toEqual([{ source: "n1", target: "n2" }])
  })

  it("returns 500 on DB error", async () => {
    mockWorkflowRead({ data: null, error: { code: "OTHER", message: "DB error" } })

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// GET /v1/public/workflows/:id  (share-by-link, NO auth, opt-in only)
// ---------------------------------------------------------------------------

describe("GET /v1/public/workflows/:id", () => {
  const mockPublicRead = (row: unknown) => {
    const mockSingle = vi.fn().mockResolvedValue({ data: row, error: null })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)
  }

  it("returns 400 for an invalid UUID (no auth needed)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/public/workflows/not-a-uuid" })
    expect(res.statusCode).toBe(400)
  })

  it("404s an UNshared workflow even though it exists (opt-in gating)", async () => {
    mockPublicRead(DB_WORKFLOW_FULL) // settings: { autoSave: true } — not shared
    const res = await app.inject({
      method: "GET",
      url: `/v1/public/workflows/${TEST_WORKFLOW_ID}`,
    })
    expect(res.statusCode).toBe(404)
  })

  it("returns 200 + a trimmed projection (no owner PII) for a SHARED workflow, no auth", async () => {
    mockPublicRead({
      ...DB_WORKFLOW_FULL,
      settings: { studio: { shared: true, version: 3 } },
    })
    const res = await app.inject({
      method: "GET",
      url: `/v1/public/workflows/${TEST_WORKFLOW_ID}`,
    })
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data.id).toBe(TEST_WORKFLOW_ID)
    expect(data.name).toBe("My Workflow")
    expect(data.nodes).toEqual([{ id: "n1", type: "generate-image" }])
    expect(data.settings).toEqual({ studio: { shared: true, version: 3 } })
    // Owner / internal fields MUST NOT leak through the public projection.
    expect(data.userId).toBeUndefined()
    expect(data.projectId).toBeUndefined()
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
      error: null,
    })
    // After optimistic-locking landed, the PATCH handler uses `.maybeSingle()`
    // so a 0-row result is no longer expressed as a PGRST116 error — it's
    // `data === null` with no error. Mock matches the new chain.
    const mockSelect = vi.fn().mockReturnValue({ maybeSingle: mockSingle })
    const mockEq1 = vi.fn().mockReturnValue({ select: mockSelect })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq1 })
    const reads = workflowReads({ data: DB_WORKFLOW_FULL })
    vi.mocked(supabase.from).mockReturnValue({ select: reads.select, update: mockUpdate } as never)

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
    const mockSelect = vi.fn().mockReturnValue({ maybeSingle: mockSingle })
    const mockEq1 = vi.fn().mockReturnValue({ select: mockSelect })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq1 })
    const reads = workflowReads({ data: DB_WORKFLOW_FULL })
    vi.mocked(supabase.from).mockReturnValue({ select: reads.select, update: mockUpdate } as never)

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
    const mockSelect = vi.fn().mockReturnValue({ maybeSingle: mockSingle })
    const mockEq1 = vi.fn().mockReturnValue({ select: mockSelect })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq1 })
    const reads = workflowReads({ data: DB_WORKFLOW_FULL })
    vi.mocked(supabase.from).mockReturnValue({ select: reads.select, update: mockUpdate } as never)

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

  it("strips transient run-state from incoming nodes (server-side defense)", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: DB_WORKFLOW_FULL, error: null })
    const mockSelect = vi.fn().mockReturnValue({ maybeSingle: mockSingle })
    const mockEq1 = vi.fn().mockReturnValue({ select: mockSelect })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq1 })
    const reads = workflowReads({ data: DB_WORKFLOW_FULL })
    vi.mocked(supabase.from).mockReturnValue({ select: reads.select, update: mockUpdate } as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        nodes: [{
          id: "n1",
          data: {
            prompt: "a cat",
            executionStatus: "running",
            currentJobId: "job-9",
            currentJobProgress: 50,
            generatedResults: [{ url: "https://r2/x.png" }],
          },
        }],
      },
    })

    expect(res.statusCode).toBe(200)
    const sent = mockUpdate.mock.calls[0]![0] as { nodes: Array<{ data: Record<string, unknown> }> }
    expect(sent.nodes[0]!.data.executionStatus).toBeUndefined()
    expect(sent.nodes[0]!.data.currentJobId).toBeUndefined()
    expect(sent.nodes[0]!.data.currentJobProgress).toBeUndefined()
    expect(sent.nodes[0]!.data.prompt).toBe("a cat")
    expect(sent.nodes[0]!.data.generatedResults).toEqual([{ url: "https://r2/x.png" }])
  })

  it("expectedVersion match: chains the integer CAS and returns 200", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: DB_WORKFLOW_FULL, error: null })
    const mockSelect = vi.fn().mockReturnValue({ maybeSingle: mockSingle })
    const mockEqVersion = vi.fn().mockReturnValue({ select: mockSelect })
    const mockEq1 = vi.fn().mockReturnValue({ select: mockSelect, eq: mockEqVersion })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq1 })
    const reads = workflowReads({ data: DB_WORKFLOW_FULL })
    vi.mocked(supabase.from).mockReturnValue({ select: reads.select, update: mockUpdate } as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Updated", expectedVersion: 7 },
    })

    expect(res.statusCode).toBe(200)
    expect(mockEqVersion).toHaveBeenCalledWith("version", 7)
  })

  it("expectedVersion mismatch: 409 workflow_conflict with currentVersion", async () => {
    // UPDATE matches 0 rows (stale version)
    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const mockEqVersion = vi.fn().mockReturnValue({ select: updateSelect })
    const mockEq1 = vi.fn().mockReturnValue({ select: updateSelect, eq: mockEqVersion })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq1 })

    // Two reads of the row through the same chain: the access read that
    // authorizes the write, then the conflict re-read that reports what the
    // other writer left behind.
    const reads = workflowReads(
      { data: DB_WORKFLOW_FULL },
      { data: { ...DB_WORKFLOW_FULL, updated_at: "2026-06-12T00:00:00Z", version: 9 } },
    )
    vi.mocked(supabase.from).mockReturnValue({ select: reads.select, update: mockUpdate } as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Updated", expectedVersion: 7 },
    })

    expect(res.statusCode).toBe(409)
    const body = res.json()
    expect(body.error.code).toBe("workflow_conflict")
    expect(body.error.currentVersion).toBe(9)
    expect(body.error.currentUpdatedAt).toBe("2026-06-12T00:00:00Z")
    // Full current record rides the 409 so the stale writer merges without a GET.
    expect(body.error.currentRecord).toMatchObject({
      ...CAMEL_FULL,
      updatedAt: "2026-06-12T00:00:00Z",
      version: 9,
    })
  })

  // ── delta saves (P3 — apply_workflow_delta RPC) ──

  it("delta: 400 when mixed with full-body fields", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { delta: { baseVersion: 3 }, nodes: [] },
    })
    expect(res.statusCode).toBe(400)
  })

  it("delta: 400 on duplicate upsert ids or delete∩upsert overlap", async () => {
    const dup = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { delta: { baseVersion: 3, upsertNodes: [{ id: "n1" }, { id: "n1" }] } },
    })
    expect(dup.statusCode).toBe(400)

    const overlap = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { delta: { baseVersion: 3, upsertNodes: [{ id: "n1" }], deleteNodeIds: ["n1"] } },
    })
    expect(overlap.statusCode).toBe(400)
  })

  it("delta: applies via RPC with stripped nodes and returns the new tokens", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: [{ ok: true, version: 42, updated_at: "2026-06-12T01:00:00Z" }],
      error: null,
    } as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        delta: {
          baseVersion: 41,
          upsertNodes: [{ id: "n1", data: { prompt: "a cat", executionStatus: "running", currentJobId: "j9" } }],
          deleteEdgeIds: ["e3"],
        },
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ version: 42, updatedAt: "2026-06-12T01:00:00Z" })

    const [fn, args] = vi.mocked(supabase.rpc).mock.calls[0]!
    expect(fn).toBe("apply_workflow_delta")
    const rpcArgs = args as Record<string, unknown>
    expect(rpcArgs.p_workflow_id).toBe(TEST_WORKFLOW_ID)
    expect(rpcArgs.p_base_version).toBe(41)
    expect(rpcArgs.p_user_id).toBe(TEST_USER_ID)
    expect(rpcArgs.p_delete_edge_ids).toEqual(["e3"])
    const sentNodes = rpcArgs.p_upsert_nodes as Array<{ data: Record<string, unknown> }>
    expect(sentNodes[0]!.data.prompt).toBe("a cat")
    expect(sentNodes[0]!.data.executionStatus).toBeUndefined()
    expect(sentNodes[0]!.data.currentJobId).toBeUndefined()
  })

  it("delta: CAS conflict → 409 with current tokens", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: [{ ok: false, version: 44, updated_at: "2026-06-12T01:05:00Z" }],
      error: null,
    } as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { delta: { baseVersion: 41, deleteNodeIds: ["n9"] } },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("workflow_conflict")
    expect(res.json().error.currentVersion).toBe(44)
  })

  it("delta: row missing/not owned → 404", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: [{ ok: false, version: null, updated_at: null }],
      error: null,
    } as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { delta: { baseVersion: 41, deleteNodeIds: ["n9"] } },
    })
    expect(res.statusCode).toBe(404)
  })

  it("returns 200 on folderId set to null", async () => {
    const updated = { ...DB_WORKFLOW_FULL, folder_id: null }
    const mockSingle = vi.fn().mockResolvedValue({ data: updated, error: null })
    const mockSelect = vi.fn().mockReturnValue({ maybeSingle: mockSingle })
    const mockEq1 = vi.fn().mockReturnValue({ select: mockSelect })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq1 })
    const reads = workflowReads({ data: DB_WORKFLOW_FULL })
    vi.mocked(supabase.from).mockReturnValue({ select: reads.select, update: mockUpdate } as never)

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
    const mockSelect = vi.fn().mockReturnValue({ maybeSingle: mockSingle })
    const mockEq1 = vi.fn().mockReturnValue({ select: mockSelect })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq1 })
    const reads = workflowReads({ data: DB_WORKFLOW_FULL })
    vi.mocked(supabase.from).mockReturnValue({ select: reads.select, update: mockUpdate } as never)

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
    const mockSelect = vi.fn().mockReturnValue({ maybeSingle: mockSingle })
    const mockEq1 = vi.fn().mockReturnValue({ select: mockSelect })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq1 })
    const reads = workflowReads({ data: DB_WORKFLOW_FULL })
    vi.mocked(supabase.from).mockReturnValue({ select: reads.select, update: mockUpdate } as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Updated" },
    })

    expect(res.statusCode).toBe(500)
  })

  it("returns 409 when expectedUpdatedAt mismatches the row's current updated_at", async () => {
    // The UPDATE chain — `.eq(id).eq(updated_at).select().maybeSingle()` —
    // matches 0 rows because the optimistic lock failed, and the handler then
    // re-reads the row to report the `updated_at` it actually has.
    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq2 = vi.fn().mockReturnValue({ select: updateSelect })
    const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2, select: updateSelect })
    const mockUpdate = vi.fn().mockReturnValue({ eq: updateEq1 })

    // Read once to authorize, once to report the conflict.
    const reads = workflowReads(
      { data: DB_WORKFLOW_FULL },
      { data: { ...DB_WORKFLOW_FULL, updated_at: "2026-01-02T00:00:00Z" } },
    )
    vi.mocked(supabase.from).mockReturnValue({
      update: mockUpdate,
      select: reads.select,
    } as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "stale",
        expectedUpdatedAt: "2026-01-01T00:00:00Z",
      },
    })

    expect(res.statusCode).toBe(409)
    const body = res.json()
    expect(body.error.code).toBe("workflow_conflict")
    expect(body.error.currentUpdatedAt).toBe("2026-01-02T00:00:00Z")
    expect(body.error.currentRecord).toMatchObject({
      ...CAMEL_FULL,
      updatedAt: "2026-01-02T00:00:00Z",
    })
    // Verify the optimistic lock filter was chained.
    expect(updateEq2).toHaveBeenCalledWith("updated_at", "2026-01-01T00:00:00Z")
  })

  it("returns 200 when expectedUpdatedAt matches (happy path)", async () => {
    const updated = { ...DB_WORKFLOW_FULL, name: "Updated" }
    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: updated, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq2 = vi.fn().mockReturnValue({ select: updateSelect })
    const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2, select: updateSelect })
    const mockUpdate = vi.fn().mockReturnValue({ eq: updateEq1 })
    const reads = workflowReads({ data: DB_WORKFLOW_FULL })
    vi.mocked(supabase.from).mockReturnValue({ select: reads.select, update: mockUpdate } as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "Updated",
        expectedUpdatedAt: "2026-01-01T00:00:00Z",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(updateEq2).toHaveBeenCalledWith("updated_at", "2026-01-01T00:00:00Z")
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

  it("returns 200 on success, and hands the RPC the CREATOR's id", async () => {
    mockWorkflowRead({ data: DB_WORKFLOW_FULL })

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
    // The RPC filters its row by `user_id = p_user_id`. Called with the
    // service role that parameter is a row filter, not an identity claim, and
    // it has to name the row's creator — which here happens to be the caller.
    expect(deleteWorkflowWithPrivateMedia).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: TEST_WORKFLOW_ID,
      userId: TEST_USER_ID,
    }))
  })

  it("returns 404 for a workflow this caller cannot reach — the RPC is never called", async () => {
    mockWorkflowRead({ data: { ...DB_WORKFLOW_FULL, user_id: OTHER_USER_ID } })

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(deleteWorkflowWithPrivateMedia).not.toHaveBeenCalled()
  })

  it("returns 404 when the delete matched nothing (already gone)", async () => {
    mockWorkflowRead({ data: DB_WORKFLOW_FULL })
    vi.mocked(deleteWorkflowWithPrivateMedia).mockResolvedValue(false)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 500 on DB error", async () => {
    mockWorkflowRead({ data: DB_WORKFLOW_FULL })
    vi.mocked(deleteWorkflowWithPrivateMedia).mockRejectedValue(new Error("FK constraint"))

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
// A workflow UUID that exists in the database but belongs to a DIFFERENT
// user. Every by-id route must refuse it, and refuse it as 404 — a 403 would
// confirm to a stranger that the id is real.
//
// What enforces that MOVED in P10 and these tests moved with it. The refusal
// used to live inside the query (`.eq("user_id", CALLER)` returned no rows) and
// now lives in the access rule, which judges the row after reading it. So the
// row here is REAL and owned by someone else — the strictly harder case, and
// the one the old shape could not express: with the filter gone, a route that
// forgot to ask the rule would hand the caller somebody else's workflow, and
// these tests are what fails when it does. Each also asserts the effect
// downstream of the refusal (no update called, no delete called), so a handler
// that answers 404 and mutates anyway cannot pass.
// ---------------------------------------------------------------------------

describe("cross-tenant denial", () => {
  const FOREIGN_WORKFLOW = { ...DB_WORKFLOW_FULL, user_id: OTHER_USER_ID }

  it("GET /v1/workflows/:id — a foreign row is 404, not 403 and not the row", async () => {
    const reads = mockWorkflowRead({ data: FOREIGN_WORKFLOW })

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(res.json().data).toBeUndefined()
    expect(reads.eq).toHaveBeenCalledWith("id", TEST_WORKFLOW_ID)
  })

  it("PATCH /v1/workflows/:id — a foreign row is 404 and nothing is written", async () => {
    const mockUpdate = vi.fn()
    const reads = workflowReads({ data: FOREIGN_WORKFLOW })
    vi.mocked(supabase.from).mockReturnValue({ select: reads.select, update: mockUpdate } as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "takeover attempt" },
    })

    expect(res.statusCode).toBe(404)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("DELETE /v1/workflows/:id — a foreign row is 404 and nothing is deleted", async () => {
    mockWorkflowRead({ data: FOREIGN_WORKFLOW })

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(deleteWorkflowWithPrivateMedia).not.toHaveBeenCalled()
  })

  it("GET /v1/workflows/:id/export — a foreign row is 404", async () => {
    mockWorkflowRead({ data: FOREIGN_WORKFLOW })

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}/export`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
  })

  it("POST /v1/workflows/:parentId/sub-workflows — a foreign parent is 404", async () => {
    const mockInsert = vi.fn()
    const reads = workflowReads({ data: FOREIGN_WORKFLOW })
    vi.mocked(supabase.from).mockReturnValue({ select: reads.select, insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}/sub-workflows`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "child" },
    })

    expect(res.statusCode).toBe(404)
    expect(mockInsert).not.toHaveBeenCalled()
  })
})

// POST /v1/workflows/:id/run — now handled by workflow-execution routes
// (tested in workflow-execution.test.ts if present)

// ---------------------------------------------------------------------------
// GET /v1/workflows/:id/export
// ---------------------------------------------------------------------------

describe("GET /v1/workflows/:id/export", () => {
  const CHAR_ROW = {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
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
    mockWorkflowRead({ data: null })

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}/export`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(404)
  })

  it("returns template export (no assets) by default", async () => {
    mockWorkflowRead({ data: DB_WORKFLOW_FULL })

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
    // No media, nothing to warn about — the note is absent, not empty.
    expect(body.portability).toBeUndefined()
  })

  it("lists media another instance cannot fetch — a private host's own storage (#866)", async () => {
    const localMedia = {
      ...DB_WORKFLOW_FULL,
      nodes: [
        { id: "n-yt", type: "youtube-video", data: { label: "Video URL", youtubeUrl: "http://localhost:3000/storage/nodaro-assets/videos/yt-1.mp4" } },
        { id: "n-img", type: "generate-image", data: { imageUrl: "https://cdn.nodaro.ai/images/public.png" } },
      ],
    }
    mockWorkflowRead({ data: localMedia })

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}/export`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.portability).toEqual({
      unreachableMedia: [
        { nodeId: "n-yt", nodeLabel: "Video URL", field: "youtubeUrl", url: "http://localhost:3000/storage/nodaro-assets/videos/yt-1.mp4" },
      ],
    })
    // The bundle itself is untouched — the note is informative, never a rewrite.
    expect(body.nodes[0].data.youtubeUrl).toBe("http://localhost:3000/storage/nodaro-assets/videos/yt-1.mp4")
  })

  it("includes assets when assets=true and entities exist", async () => {
    const workflowWithChar = {
      ...DB_WORKFLOW_FULL,
      nodes: [{ id: "n-char", type: "character", data: { characterDbId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" } }],
    }
    const workflowChain = { select: workflowReads({ data: workflowWithChar }).select }
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
    expect(body.assets.characters[0].id).toBe("dddddddd-dddd-4ddd-8ddd-dddddddddddd")
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

  // `maybeSingle` as well as `single`: the scope read uses it, and a project
  // that is absent must read as "not in scope" rather than as an error.
  function projectChain(data: unknown, error: unknown = null) {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data, error }),
      maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    }
  }

  function insertIdChain(id: string) {
    return {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id }, error: null }),
    }
  }

  // reCreateAssets de-dupes character names before inserting, so each bundled
  // character now issues a `deriveAvailableName` read FIRST:
  //   characters.select("name").eq("user_id").is("deleted_at").ilike("name", pat)
  // Empty result ⇒ the bundle name is free (inserted as-is, no "<name> N").
  function deriveNameChain(existing: string[] = []) {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockResolvedValue({
        data: existing.map((name) => ({ name })),
        error: null,
      }),
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
      .mockReturnValueOnce(projectChain({ id: TEST_PROJECT_ID, user_id: TEST_USER_ID, workspace_id: null }) as never)
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
    // Always present, so a caller can rely on the shape (#866); nothing to
    // copy here — the bundle carries no media URLs.
    expect(body.importReport).toEqual({ rehosted: 0, unreachable: [], skipped: [] })
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
      .mockReturnValueOnce(projectChain({ id: TEST_PROJECT_ID, user_id: TEST_USER_ID, workspace_id: null }) as never)
      .mockReturnValueOnce(deriveNameChain() as never) // deriveAvailableName("Hero") → free
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

// ---------------------------------------------------------------------------
// OAuth developer-app scope enforcement (regression for the scope-bypass bug:
// mutating workflow routes called authorize() with no scope arg, so an app
// token granted e.g. only jobs:read could read/rewrite/hard-delete every
// workflow the consenting user owns over plain HTTP).
// ---------------------------------------------------------------------------

describe("OAuth scope enforcement", () => {
  // A token whose granted scopes do NOT include the one the route requires.
  const NARROW = "jobs:read"

  it("PATCH /v1/workflows/:id → 403 when token lacks workflows:write", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID, "x-app-scopes": NARROW },
      payload: { name: "Updated" },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("insufficient_scope")
  })

  it("DELETE /v1/workflows/:id → 403 when token lacks workflows:write", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID, "x-app-scopes": NARROW },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("insufficient_scope")
  })

  it("GET /v1/workflows/:id → 403 when token lacks workflows:read", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID, "x-app-scopes": NARROW },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("insufficient_scope")
  })

  it("POST /v1/projects/:projectId/workflows → 403 when token lacks workflows:write", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${TEST_PROJECT_ID}/workflows`,
      headers: { "x-user-id": TEST_USER_ID, "x-app-scopes": NARROW },
      payload: { name: "New" },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("insufficient_scope")
  })

  it("POST /v1/workflows/:parentId/sub-workflows → 403 when token lacks workflows:write", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}/sub-workflows`,
      headers: { "x-user-id": TEST_USER_ID, "x-app-scopes": NARROW },
      payload: {},
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("insufficient_scope")
  })

  it("PATCH /v1/workflows/:id → allowed (200) when token carries workflows:write", async () => {
    const updated = { ...DB_WORKFLOW_FULL, name: "Updated" }
    const mockSingle = vi.fn().mockResolvedValue({ data: updated, error: null })
    const mockSelect = vi.fn().mockReturnValue({ maybeSingle: mockSingle })
    const mockEq1 = vi.fn().mockReturnValue({ select: mockSelect })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq1 })
    const reads = workflowReads({ data: DB_WORKFLOW_FULL })
    vi.mocked(supabase.from).mockReturnValue({ select: reads.select, update: mockUpdate } as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID, "x-app-scopes": "workflows:read workflows:write" },
      payload: { name: "Updated" },
    })
    expect(res.statusCode).toBe(200)
  })
})
