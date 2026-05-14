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

import { subWorkflowRoutes } from "../sub-workflows.js"
import { supabase } from "../../lib/supabase.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_PROJECT_ID = "00000000-0000-4000-8000-000000000010"
const TEST_WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"

function makeSubWorkflowNodes(routeId = "route-1") {
  return [
    {
      id: "in1",
      type: "sub-workflow-input",
      data: {
        label: "Input",
        routeId,
        ports: [{ id: "p1", name: "Image", mediaType: "image" }],
      },
    },
    {
      id: "gen1",
      type: "generate-image",
      data: { label: "Generate" },
    },
    {
      id: "out1",
      type: "sub-workflow-output",
      data: {
        label: "Output",
        routeId,
        ports: [{ id: "op1", name: "Result", mediaType: "video" }],
        visibleOutputPortId: "op1",
      },
    },
  ]
}

function makeSubWorkflowEdges() {
  return [
    { id: "e1", source: "in1", target: "gen1" },
    { id: "e2", source: "gen1", target: "out1" },
  ]
}

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
    await subWorkflowRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// GET /v1/workflows/callable
// ---------------------------------------------------------------------------

describe("GET /v1/workflows/callable", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflows/callable",
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns empty array when no workflows", async () => {
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
    expect(res.json().data).toEqual([])
  })

  it("returns empty when workflows have no valid routes", async () => {
    const workflow = {
      id: TEST_WORKFLOW_ID,
      name: "No Routes",
      project_id: TEST_PROJECT_ID,
      nodes: [{ id: "n1", type: "generate-image", data: {} }],
      edges: [],
      projects: { name: "Project 1" },
    }

    const mockLimit = vi.fn().mockResolvedValue({ data: [workflow], error: null })
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
    expect(res.json().data).toEqual([])
  })

  it("returns callable workflows with route snapshots", async () => {
    const workflow = {
      id: TEST_WORKFLOW_ID,
      name: "My Sub-Workflow",
      project_id: TEST_PROJECT_ID,
      nodes: makeSubWorkflowNodes(),
      edges: makeSubWorkflowEdges(),
      projects: { name: "My Project" },
    }

    const mockLimit = vi.fn().mockResolvedValue({ data: [workflow], error: null })
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
    const data = res.json().data
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe(TEST_WORKFLOW_ID)
    expect(data[0].name).toBe("My Sub-Workflow")
    expect(data[0].projectName).toBe("My Project")
    expect(data[0].routes).toHaveLength(1)
    expect(data[0].routes[0].routeId).toBe("route-1")
    expect(data[0].routes[0].inputPorts).toHaveLength(1)
    expect(data[0].routes[0].outputPorts).toHaveLength(1)
  })

  it("filters by projectId when provided", async () => {
    const workflow = {
      id: TEST_WORKFLOW_ID,
      name: "WF",
      project_id: TEST_PROJECT_ID,
      nodes: makeSubWorkflowNodes(),
      edges: makeSubWorkflowEdges(),
      projects: { name: "P1" },
    }

    const mockEq2 = vi.fn().mockResolvedValue({ data: [workflow], error: null })
    const mockLimit = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockIs = vi.fn().mockReturnValue({ limit: mockLimit })
    const mockEq1 = vi.fn().mockReturnValue({ is: mockIs })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/callable?projectId=${TEST_PROJECT_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    // Verify that the second .eq was called with project_id
    expect(mockEq2).toHaveBeenCalledWith("project_id", TEST_PROJECT_ID)
  })

  it("handles multiple callable workflows", async () => {
    const wf1 = {
      id: "wf-1",
      name: "First",
      project_id: TEST_PROJECT_ID,
      nodes: makeSubWorkflowNodes("route-a"),
      edges: makeSubWorkflowEdges(),
      projects: { name: "P" },
    }
    const wf2 = {
      id: "wf-2",
      name: "Second",
      project_id: TEST_PROJECT_ID,
      nodes: makeSubWorkflowNodes("route-b"),
      edges: makeSubWorkflowEdges(),
      projects: { name: "P" },
    }

    const mockLimit = vi.fn().mockResolvedValue({ data: [wf1, wf2], error: null })
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
    expect(res.json().data).toHaveLength(2)
  })

  it("uses fallback names for unnamed workflows and projects", async () => {
    const workflow = {
      id: TEST_WORKFLOW_ID,
      name: "",
      project_id: TEST_PROJECT_ID,
      nodes: makeSubWorkflowNodes(),
      edges: makeSubWorkflowEdges(),
      projects: null,
    }

    const mockLimit = vi.fn().mockResolvedValue({ data: [workflow], error: null })
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
    const data = res.json().data
    expect(data[0].name).toBe("Unnamed Workflow")
    expect(data[0].projectName).toBe("Unknown Project")
  })

  it("returns 500 on DB error", async () => {
    const mockLimit = vi.fn().mockResolvedValue({ data: null, error: { message: "DB down" } })
    const mockIs = vi.fn().mockReturnValue({ limit: mockLimit })
    const mockEq = vi.fn().mockReturnValue({ is: mockIs })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/workflows/callable",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// GET /v1/workflows/:id/interface
// ---------------------------------------------------------------------------

describe("GET /v1/workflows/:id/interface", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}/interface`,
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 404 when workflow not found", async () => {
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
      url: `/v1/workflows/${TEST_WORKFLOW_ID}/interface`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
  })

  it("returns empty routes for non-sub-workflow workflows", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: {
        id: TEST_WORKFLOW_ID,
        nodes: [{ id: "n1", type: "generate-image", data: {} }],
        edges: [],
      },
      error: null,
    })
    const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}/interface`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.routes).toEqual([])
  })

  it("returns discovered routes for a sub-workflow", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: {
        id: TEST_WORKFLOW_ID,
        nodes: makeSubWorkflowNodes(),
        edges: makeSubWorkflowEdges(),
      },
      error: null,
    })
    const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}/interface`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    const routes = res.json().data.routes
    expect(routes).toHaveLength(1)
    expect(routes[0].routeId).toBe("route-1")
    expect(routes[0].inputPorts).toHaveLength(1)
    expect(routes[0].outputPorts).toHaveLength(1)
    expect(routes[0].visibleOutputPortId).toBe("op1")
  })
})
