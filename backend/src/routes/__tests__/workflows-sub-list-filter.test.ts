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
import { subWorkflowRoutes } from "../sub-workflows.js"
import { supabase } from "../../lib/supabase.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_PROJECT_ID = "00000000-0000-4000-8000-000000000010"

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
  await app.register(async (instance) => {
    await subWorkflowRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Sub-workflow visibility filters
// ---------------------------------------------------------------------------
// Migration 115 added a `parent_workflow_id` column to the `workflows` table
// to model child sub-workflows owned by a SubWorkflowNode container. Child
// workflows must be hidden from:
//
//   1. GET /v1/projects/:projectId/workflows  — the dashboard list
//   2. GET /v1/workflows/callable             — the sub-workflow node picker
//
// Both endpoints must scope reads with `.is("parent_workflow_id", null)` so
// only top-level workflows surface. Without this, a refactor that drops the
// filter would let child workflows leak into the dashboard or get selected
// as picker targets — both are user-visible regressions.
// ---------------------------------------------------------------------------

describe("GET /v1/projects/:projectId/workflows — filters out child sub-workflows", () => {
  it("applies .is('parent_workflow_id', null) on the list query", async () => {
    const mockOrder = vi.fn().mockResolvedValue({ data: [], error: null })
    const mockIs = vi.fn().mockReturnValue({ order: mockOrder })
    const mockEq2 = vi.fn().mockReturnValue({ is: mockIs })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${TEST_PROJECT_ID}/workflows`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    // The critical assertion: the parent-workflow-id filter was applied.
    expect(mockIs).toHaveBeenCalledWith("parent_workflow_id", null)
    // And the chain is still scoped to the correct project + user.
    expect(mockEq1).toHaveBeenCalledWith("project_id", TEST_PROJECT_ID)
    expect(mockEq2).toHaveBeenCalledWith("user_id", TEST_USER_ID)
  })
})

describe("GET /v1/workflows/callable — filters out child sub-workflows", () => {
  it("applies .is('parent_workflow_id', null) when no projectId is given", async () => {
    const mockLimit = vi.fn().mockResolvedValue({ data: [], error: null })
    const mockIs = vi.fn().mockReturnValue({ limit: mockLimit })
    const mockEq = vi.fn().mockReturnValue({ is: mockIs })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/workflows/callable",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(mockIs).toHaveBeenCalledWith("parent_workflow_id", null)
    expect(mockEq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
  })

  it("applies .is('parent_workflow_id', null) when projectId is given", async () => {
    const mockEqProject = vi.fn().mockResolvedValue({ data: [], error: null })
    const mockLimit = vi.fn().mockReturnValue({ eq: mockEqProject })
    const mockIs = vi.fn().mockReturnValue({ limit: mockLimit })
    const mockEqUser = vi.fn().mockReturnValue({ is: mockIs })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEqUser })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/callable?projectId=${TEST_PROJECT_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(mockIs).toHaveBeenCalledWith("parent_workflow_id", null)
    expect(mockEqUser).toHaveBeenCalledWith("user_id", TEST_USER_ID)
    expect(mockEqProject).toHaveBeenCalledWith("project_id", TEST_PROJECT_ID)
  })
})
