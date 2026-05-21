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

vi.mock("@/ee/billing/credits.js", () => ({
  estimateWorkflowCredits: vi.fn().mockReturnValue(10),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { publishedAppsRoutes } from "../published-apps.js"
import { supabase } from "../../lib/supabase.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000099"
const TEST_WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"
const TEST_APP_ID = "00000000-0000-4000-8000-000000000040"

const DB_WORKFLOW = {
  id: TEST_WORKFLOW_ID,
  user_id: TEST_USER_ID,
  nodes: [{ id: "n1", type: "generate-image" }],
  edges: [{ source: "n1", target: "n2" }],
  settings: { autoSave: true },
}

const DB_PUBLISHED_APP = {
  id: TEST_APP_ID,
  workflow_id: TEST_WORKFLOW_ID,
  creator_id: TEST_USER_ID,
  version: 1,
  slug: "my-app-ab12",
  name: "My App",
  description: "Test app",
  icon_url: null,
  snapshot_nodes: [{ id: "n1", type: "generate-image" }],
  snapshot_edges: [{ source: "n1", target: "n2" }],
  snapshot_settings: { autoSave: true },
  is_active: true,
  is_listed: false,
  is_embeddable: false,
  estimated_credits: 10,
  thumbnail_node_id: null,
  category: "other",
  output_types: [],
  tags: [],
  preview_media_url: null,
  preview_media_type: null,
  supports_remix: false,
  creator_display_name: null,
  total_run_count: 0,
  favorite_count: 0,
  created_at: "2026-01-01T00:00:00Z",
}

const CAMEL_PUBLISHED_APP = {
  id: TEST_APP_ID,
  workflowId: TEST_WORKFLOW_ID,
  creatorId: TEST_USER_ID,
  version: 1,
  slug: "my-app-ab12",
  name: "My App",
  description: "Test app",
  iconUrl: null,
  snapshotNodes: [{ id: "n1", type: "generate-image" }],
  snapshotEdges: [{ source: "n1", target: "n2" }],
  snapshotSettings: { autoSave: true },
  isActive: true,
  isListed: false,
  isEmbeddable: false,
  estimatedCredits: 10,
  thumbnailNodeId: null,
  category: "other",
  outputTypes: [],
  tags: [],
  previewMediaUrl: null,
  previewMediaType: null,
  supportsRemix: false,
  creatorDisplayName: null,
  totalRunCount: 0,
  favoriteCount: 0,
  createdAt: "2026-01-01T00:00:00Z",
}

/** Mock helper: returns a chainable mock for profiles.select().eq().single() */
function mockProfilesQuery() {
  const mockSingle = vi.fn().mockResolvedValue({ data: { full_name: null, email: "test@example.com" }, error: null })
  const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
  return { select: mockSelect } as never
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
    await publishedAppsRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// POST /v1/apps/publish
// ---------------------------------------------------------------------------

describe("POST /v1/apps/publish", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/apps/publish",
      payload: { workflowId: TEST_WORKFLOW_ID, name: "My App" },
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 400 on invalid body (missing name)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/apps/publish",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { workflowId: TEST_WORKFLOW_ID },
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns 400 on invalid body (missing workflowId)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/apps/publish",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "My App" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns 404 when workflow not found", async () => {
    // workflows query returns error
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/apps/publish",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { workflowId: TEST_WORKFLOW_ID, name: "My App" },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 403 when not workflow owner", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: { ...DB_WORKFLOW, user_id: OTHER_USER_ID },
      error: null,
    })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/apps/publish",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { workflowId: TEST_WORKFLOW_ID, name: "My App" },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
  })

  it("returns 200 on success with version=1 for first publish", async () => {
    let workflowCallCount = 0
    let appsCallCount = 0

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "workflows") {
        workflowCallCount++
        if (workflowCallCount === 1) {
          // First call: select workflow
          const mockSingle = vi.fn().mockResolvedValue({ data: DB_WORKFLOW, error: null })
          const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
          const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
          return { select: mockSelect } as never
        } else {
          // Later call: update workflow with published_app_id
          const mockEq = vi.fn().mockResolvedValue({ error: null })
          const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
          return { update: mockUpdate } as never
        }
      }
      if (table === "profiles") return mockProfilesQuery()
      if (table === "published_apps") {
        appsCallCount++
        if (appsCallCount === 1) {
          // First apps call: check existing versions (.eq().is().order().limit())
          const mockLimit = vi.fn().mockResolvedValue({ data: [], error: null })
          const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit })
          const mockIs = vi.fn().mockReturnValue({ order: mockOrder })
          const mockEq = vi.fn().mockReturnValue({ is: mockIs })
          const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
          return { select: mockSelect } as never
        } else {
          // Second apps call: insert published app
          const mockSingle = vi.fn().mockResolvedValue({ data: DB_PUBLISHED_APP, error: null })
          const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
          const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
          return { insert: mockInsert } as never
        }
      }
      return {} as never
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/apps/publish",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { workflowId: TEST_WORKFLOW_ID, name: "My App" },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.version).toBe(1)
    expect(body.name).toBe("My App")
    expect(body.workflowId).toBe(TEST_WORKFLOW_ID)
    expect(body.creatorId).toBe(TEST_USER_ID)
  })

  it("returns 200 with version increment on re-publish", async () => {
    let workflowCallCount = 0
    let appsCallCount = 0

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "workflows") {
        workflowCallCount++
        if (workflowCallCount === 1) {
          const mockSingle = vi.fn().mockResolvedValue({ data: DB_WORKFLOW, error: null })
          const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
          const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
          return { select: mockSelect } as never
        } else {
          const mockEq = vi.fn().mockResolvedValue({ error: null })
          const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
          return { update: mockUpdate } as never
        }
      }
      if (table === "profiles") return mockProfilesQuery()
      if (table === "published_apps") {
        appsCallCount++
        if (appsCallCount === 1) {
          // Return existing version 3 (with slug + is_listed for carry-forward)
          // Chain: .select().eq().is().order().limit()
          const mockLimit = vi.fn().mockResolvedValue({
            data: [{ id: "prev-id", version: 3, slug: "my-app-abc123", is_listed: true }],
            error: null,
          })
          const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit })
          const mockIs = vi.fn().mockReturnValue({ order: mockOrder })
          const mockEq = vi.fn().mockReturnValue({ is: mockIs })
          const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
          return { select: mockSelect } as never
        } else if (appsCallCount === 2) {
          // Fetch all old versions for slug retirement
          // Chain: .select().eq().eq().is()
          const mockIs = vi.fn().mockResolvedValue({
            data: [{ id: "prev-id", version: 3, slug: "my-app-abc123" }],
            error: null,
          })
          const mockEq2 = vi.fn().mockReturnValue({ is: mockIs })
          const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
          const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
          return { select: mockSelect } as never
        } else if (appsCallCount === 3) {
          // Retire old version slug (update slug + deactivate)
          const mockEq = vi.fn().mockResolvedValue({ error: null })
          const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
          return { update: mockUpdate } as never
        } else {
          // Insert with version 4
          const v4App = { ...DB_PUBLISHED_APP, version: 4 }
          const mockSingle = vi.fn().mockResolvedValue({ data: v4App, error: null })
          const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
          const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
          return { insert: mockInsert } as never
        }
      }
      return {} as never
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/apps/publish",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { workflowId: TEST_WORKFLOW_ID, name: "My App" },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().version).toBe(4)
  })

  it("returns 500 after exhausting slug collision retries", async () => {
    let appsCallCount = 0

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "workflows") {
        const mockSingle = vi.fn().mockResolvedValue({ data: DB_WORKFLOW, error: null })
        const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
        const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
        return { select: mockSelect } as never
      }
      if (table === "profiles") return mockProfilesQuery()
      if (table === "published_apps") {
        appsCallCount++
        if (appsCallCount === 1) {
          // version check — no existing versions
          // Chain: .select().eq().is().order().limit()
          const mockLimit = vi.fn().mockResolvedValue({ data: [], error: null })
          const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit })
          const mockIs = vi.fn().mockReturnValue({ order: mockOrder })
          const mockEq = vi.fn().mockReturnValue({ is: mockIs })
          const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
          return { select: mockSelect } as never
        } else {
          // Every insert fails with 23505 (slug collision)
          const mockSingle = vi.fn().mockResolvedValue({
            data: null,
            error: { code: "23505", message: "duplicate key" },
          })
          const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
          const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
          return { insert: mockInsert } as never
        }
      }
      return {} as never
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/apps/publish",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { workflowId: TEST_WORKFLOW_ID, name: "My App" },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ---------------------------------------------------------------------------
// POST /v1/apps/publish — component-metadata validation
// ---------------------------------------------------------------------------

describe("POST /v1/apps/publish — component metadata", () => {
  /** Wire `workflows.select().eq().single()` to return a workflow snapshot. */
  function mockWorkflowFetch(workflowNodes: Array<Record<string, unknown>>) {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "workflows") {
        const mockSingle = vi.fn().mockResolvedValue({
          data: { ...DB_WORKFLOW, nodes: workflowNodes },
          error: null,
        })
        const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
        const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
        return { select: mockSelect } as never
      }
      return {} as never
    })
  }

  const baseComponentPayload = {
    workflowId: TEST_WORKFLOW_ID,
    name: "My Component",
    publishType: "component" as const,
  }

  /** Full mock chain that mirrors the happy-path test up top — covers the
   *  workflows select+update + published_apps version-check + insert flow. */
  function mockFullPublishChain(workflowNodes: Array<Record<string, unknown>>, returnApp: Record<string, unknown> = DB_PUBLISHED_APP) {
    let workflowCallCount = 0
    let appsCallCount = 0
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "workflows") {
        workflowCallCount++
        if (workflowCallCount === 1) {
          const mockSingle = vi.fn().mockResolvedValue({
            data: { ...DB_WORKFLOW, nodes: workflowNodes },
            error: null,
          })
          const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
          const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
          return { select: mockSelect } as never
        }
        const mockEq = vi.fn().mockResolvedValue({ error: null })
        const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
        return { update: mockUpdate } as never
      }
      if (table === "profiles") return mockProfilesQuery()
      if (table === "published_apps") {
        appsCallCount++
        if (appsCallCount === 1) {
          const mockLimit = vi.fn().mockResolvedValue({ data: [], error: null })
          const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit })
          const mockIs = vi.fn().mockReturnValue({ order: mockOrder })
          const mockEq = vi.fn().mockReturnValue({ is: mockIs })
          const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
          return { select: mockSelect } as never
        }
        const mockSingle = vi.fn().mockResolvedValue({ data: returnApp, error: null })
        const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
        const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
        return { insert: mockInsert } as never
      }
      return {} as never
    })
  }

  it("accepts componentMetadata with zero inputs (no .min(1))", async () => {
    mockFullPublishChain([{ id: "n1", type: "generate-image" }])

    const res = await app.inject({
      method: "POST",
      url: "/v1/apps/publish",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        ...baseComponentPayload,
        componentMetadata: {
          inputs: [],
          outputs: [{ id: "n1", name: "Out", type: "image", required: true, mediaPreview: true, fieldKey: "imageUrl" }],
          exposedSettings: [],
        },
      },
    })

    expect(res.statusCode).toBe(200)
  })

  it("rejects componentMetadata with zero outputs (outputs.min(1) still enforced)", async () => {
    mockWorkflowFetch([{ id: "n1", type: "generate-image" }])

    const res = await app.inject({
      method: "POST",
      url: "/v1/apps/publish",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        ...baseComponentPayload,
        componentMetadata: { inputs: [], outputs: [], exposedSettings: [] },
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it("accepts compound handle ids (nodeId::portId) when port exists on sub-workflow node", async () => {
    mockFullPublishChain([
      { id: "in1", type: "sub-workflow-input", data: { ports: [{ id: "pA", name: "Subject", mediaType: "text" }] } },
      { id: "out1", type: "sub-workflow-output", data: { ports: [{ id: "pZ", name: "Result", mediaType: "image" }] } },
    ])

    const res = await app.inject({
      method: "POST",
      url: "/v1/apps/publish",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        ...baseComponentPayload,
        componentMetadata: {
          inputs: [{ id: "in1::pA", name: "Subject", type: "text", required: true, fieldKey: "pA" }],
          outputs: [{ id: "out1::pZ", name: "Result", type: "image", required: true, mediaPreview: true, fieldKey: "pZ" }],
          exposedSettings: [],
        },
      },
    })

    expect(res.statusCode).toBe(200)
  })

  it("rejects compound handle id when the port doesn't exist on the sub-workflow node", async () => {
    mockWorkflowFetch([
      { id: "in1", type: "sub-workflow-input", data: { ports: [{ id: "pA", name: "Subject", mediaType: "text" }] } },
      { id: "out1", type: "sub-workflow-output", data: { ports: [{ id: "pZ", name: "Result", mediaType: "image" }] } },
    ])

    const res = await app.inject({
      method: "POST",
      url: "/v1/apps/publish",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        ...baseComponentPayload,
        componentMetadata: {
          inputs: [{ id: "in1::nonexistent", name: "Bad", type: "text", required: true, fieldKey: "nonexistent" }],
          outputs: [{ id: "out1::pZ", name: "Result", type: "image", required: true, mediaPreview: true, fieldKey: "pZ" }],
          exposedSettings: [],
        },
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain("unknown port")
  })

  it("rejects compound handle id when the target node is not a sub-workflow node", async () => {
    mockWorkflowFetch([
      { id: "n1", type: "generate-image", data: {} },
    ])

    const res = await app.inject({
      method: "POST",
      url: "/v1/apps/publish",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        ...baseComponentPayload,
        componentMetadata: {
          inputs: [{ id: "n1::pA", name: "Bad", type: "text", required: true, fieldKey: "pA" }],
          outputs: [{ id: "n1", name: "Out", type: "image", required: true, mediaPreview: true, fieldKey: "imageUrl" }],
          exposedSettings: [],
        },
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain("expects a sub-workflow-input")
  })
})

// ---------------------------------------------------------------------------
// GET /v1/apps/mine
// ---------------------------------------------------------------------------

describe("GET /v1/apps/mine", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/apps/mine",
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 200 with empty list", async () => {
    const mockOrder = vi.fn().mockResolvedValue({ data: [], error: null })
    const mockEq = vi.fn().mockReturnValue({ order: mockOrder })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/apps/mine",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })

  it("returns 200 with apps (verify camelCase transform + runCount)", async () => {
    const dbRow = {
      ...DB_PUBLISHED_APP,
      app_runs: [{ count: 42 }],
    }

    const mockOrder = vi.fn().mockResolvedValue({ data: [dbRow], error: null })
    const mockEq = vi.fn().mockReturnValue({ order: mockOrder })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/apps/mine",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveLength(1)
    const appItem = body[0]
    expect(appItem.id).toBe(TEST_APP_ID)
    expect(appItem.workflowId).toBe(TEST_WORKFLOW_ID)
    expect(appItem.creatorId).toBe(TEST_USER_ID)
    expect(appItem.name).toBe("My App")
    expect(appItem.slug).toBe("my-app-ab12")
    expect(appItem.isActive).toBe(true)
    expect(appItem.isListed).toBe(false)
    expect(appItem.isEmbeddable).toBe(false)
    expect(appItem.estimatedCredits).toBe(10)
    expect(appItem.runCount).toBe(42)
    // Ensure snake_case keys are NOT present
    expect(appItem.workflow_id).toBeUndefined()
    expect(appItem.creator_id).toBeUndefined()
    expect(appItem.icon_url).toBeUndefined()
    expect(appItem.is_active).toBeUndefined()
  })

  it("returns 200 with runCount=0 when no app_runs", async () => {
    const dbRow = {
      ...DB_PUBLISHED_APP,
      app_runs: [],
    }

    const mockOrder = vi.fn().mockResolvedValue({ data: [dbRow], error: null })
    const mockEq = vi.fn().mockReturnValue({ order: mockOrder })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/apps/mine",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()[0].runCount).toBe(0)
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
      url: "/v1/apps/mine",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// PATCH /v1/apps/:appId
// ---------------------------------------------------------------------------

describe("PATCH /v1/apps/:appId", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/apps/${TEST_APP_ID}`,
      payload: { name: "Updated" },
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 400 on empty update body (no fields)", async () => {
    // Ownership check mock (needed because Zod parse passes for empty object)
    const mockSingle = vi.fn().mockResolvedValue({
      data: { id: TEST_APP_ID, creator_id: TEST_USER_ID },
      error: null,
    })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/apps/${TEST_APP_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("bad_request")
  })

  it("returns 404 when app not found", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/apps/${TEST_APP_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Updated" },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 403 when not creator", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: { id: TEST_APP_ID, creator_id: OTHER_USER_ID },
      error: null,
    })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/apps/${TEST_APP_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Updated" },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
  })

  it("returns 200 on partial update (name only)", async () => {
    let callCount = 0

    vi.mocked(supabase.from).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // Ownership check
        const mockSingle = vi.fn().mockResolvedValue({
          data: { id: TEST_APP_ID, creator_id: TEST_USER_ID },
          error: null,
        })
        const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
        const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
        return { select: mockSelect } as never
      } else {
        // Update
        const updatedRow = { ...DB_PUBLISHED_APP, name: "Updated Name" }
        const mockSingle = vi.fn().mockResolvedValue({ data: updatedRow, error: null })
        const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
        const mockEq = vi.fn().mockReturnValue({ select: mockSelect })
        const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
        return { update: mockUpdate } as never
      }
    })

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/apps/${TEST_APP_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Updated Name" },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.name).toBe("Updated Name")
    expect(body.workflowId).toBe(TEST_WORKFLOW_ID)
    // Verify camelCase transform
    expect(body.isActive).toBe(true)
    expect(body.estimatedCredits).toBe(10)
  })

  it("returns 500 on DB update error", async () => {
    let callCount = 0

    vi.mocked(supabase.from).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        const mockSingle = vi.fn().mockResolvedValue({
          data: { id: TEST_APP_ID, creator_id: TEST_USER_ID },
          error: null,
        })
        const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
        const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
        return { select: mockSelect } as never
      } else {
        const mockSingle = vi.fn().mockResolvedValue({
          data: null,
          error: { message: "update failed" },
        })
        const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
        const mockEq = vi.fn().mockReturnValue({ select: mockSelect })
        const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
        return { update: mockUpdate } as never
      }
    })

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/apps/${TEST_APP_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Updated" },
    })

    expect(res.statusCode).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// DELETE /v1/apps/:appId
// ---------------------------------------------------------------------------

describe("DELETE /v1/apps/:appId", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/apps/${TEST_APP_ID}`,
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 404 when app not found", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/apps/${TEST_APP_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 403 when not creator", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: { id: TEST_APP_ID, creator_id: OTHER_USER_ID },
      error: null,
    })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/apps/${TEST_APP_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
  })

  it("returns 200 on success (sets is_active=false)", async () => {
    let callCount = 0

    vi.mocked(supabase.from).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // Ownership check
        const mockSingle = vi.fn().mockResolvedValue({
          data: { id: TEST_APP_ID, creator_id: TEST_USER_ID },
          error: null,
        })
        const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
        const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
        return { select: mockSelect } as never
      } else {
        // Soft delete (update is_active=false)
        const mockEq = vi.fn().mockResolvedValue({ error: null })
        const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
        return { update: mockUpdate } as never
      }
    })

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/apps/${TEST_APP_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it("returns 500 on DB update error", async () => {
    let callCount = 0

    vi.mocked(supabase.from).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        const mockSingle = vi.fn().mockResolvedValue({
          data: { id: TEST_APP_ID, creator_id: TEST_USER_ID },
          error: null,
        })
        const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
        const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
        return { select: mockSelect } as never
      } else {
        const mockEq = vi.fn().mockResolvedValue({
          error: { message: "update failed" },
        })
        const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
        return { update: mockUpdate } as never
      }
    })

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/apps/${TEST_APP_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
  })
})
