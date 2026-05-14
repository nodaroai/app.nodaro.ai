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

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // Bypass auth — set userId from header
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (header && typeof header === "string") {
      ;(req as any).userId = header
      ;(req as any).userRole = undefined
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
// Sub-workflow boundary-shape validation
// ---------------------------------------------------------------------------
// Task 5 of the SubWorkflowNode v1 plan: invalid sub-workflow boundary
// shapes (orphan inputs/outputs, duplicate routeIds, output with no ports)
// must be rejected with 400 `invalid_sub_workflow` BEFORE the supabase
// insert/update fires. Valid shapes (or workflows with no boundary nodes
// at all) must pass through unmodified.
// ---------------------------------------------------------------------------

describe("POST /v1/projects/:projectId/workflows — sub-workflow validation", () => {
  it("rejects an orphaned sub-workflow-input with 400 invalid_sub_workflow", async () => {
    // No supabase mock needed — validation runs before the insert chain.
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${TEST_PROJECT_ID}/workflows`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "Broken sub-workflow",
        nodes: [
          {
            id: "input-1",
            type: "sub-workflow-input",
            data: { routeId: "r1" },
          },
        ],
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("invalid_sub_workflow")
    expect(Array.isArray(body.error.details)).toBe(true)
    expect(
      body.error.details.some(
        (e: { code: string; routeId: string }) =>
          e.code === "missing_output_for_route" && e.routeId === "r1",
      ),
    ).toBe(true)

    // The supabase insert chain must NOT have been hit.
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("allows a matching input/output pair to pass through to the insert", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: {
        id: TEST_WORKFLOW_ID,
        project_id: TEST_PROJECT_ID,
        user_id: TEST_USER_ID,
        name: "Valid sub-workflow",
        nodes: [],
        edges: [],
        settings: {},
        source_prompt: null,
        folder_id: null,
        description: null,
        is_template: false,
        version: 1,
        thumbnail_url: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      error: null,
    })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${TEST_PROJECT_ID}/workflows`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "Valid sub-workflow",
        nodes: [
          {
            id: "input-1",
            type: "sub-workflow-input",
            data: { routeId: "r1" },
          },
          {
            id: "output-1",
            type: "sub-workflow-output",
            data: {
              routeId: "r1",
              ports: [{ id: "p1", name: "Result", mediaType: "text" }],
            },
          },
        ],
      },
    })

    expect(res.statusCode).toBe(201)
    expect(supabase.from).toHaveBeenCalledWith("workflows")
    expect(mockInsert).toHaveBeenCalledTimes(1)
  })

  it("allows a workflow with no nodes (no validation needed)", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: {
        id: TEST_WORKFLOW_ID,
        project_id: TEST_PROJECT_ID,
        user_id: TEST_USER_ID,
        name: "Empty workflow",
        nodes: [],
        edges: [],
        settings: {},
        source_prompt: null,
        folder_id: null,
        description: null,
        is_template: false,
        version: 1,
        thumbnail_url: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      error: null,
    })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    // Case 1: nodes omitted entirely
    const res1 = await app.inject({
      method: "POST",
      url: `/v1/projects/${TEST_PROJECT_ID}/workflows`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Empty workflow" },
    })
    expect(res1.statusCode).toBe(201)

    // Case 2: nodes is an empty array
    const res2 = await app.inject({
      method: "POST",
      url: `/v1/projects/${TEST_PROJECT_ID}/workflows`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Empty workflow", nodes: [] },
    })
    expect(res2.statusCode).toBe(201)
  })
})

describe("PATCH /v1/workflows/:id — sub-workflow validation", () => {
  it("rejects an orphaned sub-workflow-input with 400 invalid_sub_workflow", async () => {
    // No supabase mock needed — validation runs before the update chain.
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        nodes: [
          {
            id: "input-1",
            type: "sub-workflow-input",
            data: { routeId: "r1" },
          },
        ],
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("invalid_sub_workflow")
    expect(Array.isArray(body.error.details)).toBe(true)
    expect(
      body.error.details.some(
        (e: { code: string; routeId: string }) =>
          e.code === "missing_output_for_route" && e.routeId === "r1",
      ),
    ).toBe(true)

    // The supabase update chain must NOT have been hit.
    expect(supabase.from).not.toHaveBeenCalled()
  })
})
