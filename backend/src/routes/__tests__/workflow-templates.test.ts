// Regression tests for the two thumbnail-survival behaviors fixed in
// fix/thumbnail-survives-asset-delete:
//
//   1. UPDATE path must NEVER wipe an existing preview_media_url to null when
//      no fresh source URL is resolvable. Re-publishing after deleting the
//      source asset used to silently blank the marketplace/tutorial card.
//
//   2. The publish handler must use workflows.thumbnail_url ("Set as
//      Thumbnail" in the editor) as the source when no explicit
//      previewMediaUrl is provided in the request. Before the fix, that
//      field was ignored entirely.
//
// Both are silent failures — neither throws, both pass typecheck — exactly
// the kind that regresses without coverage.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
  },
}))

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
  hasAdmin: () => false, // disable admin routes for these tests
}))

vi.mock("@/ee/billing/credits.js", () => ({
  estimateWorkflowCredits: vi.fn().mockReturnValue(10),
}))

vi.mock("@/lib/marketplace-helpers.js", () => ({
  sanitizeSlugBase: (s: string) => s.toLowerCase(),
  generateSlug: (name: string) => `${name.toLowerCase().replace(/\s+/g, "-")}-test`,
  getCreatorDisplayName: vi.fn().mockResolvedValue("Test Creator"),
}))

vi.mock("@/lib/storage.js", () => ({
  copyToTemplatePreview: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { workflowTemplatesRoutes, extractNodeTypes } from "../workflow-templates.js"
import { supabase } from "../../lib/supabase.js"
import { copyToTemplatePreview } from "../../lib/storage.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"
const TEST_TEMPLATE_ID = "00000000-0000-4000-8000-000000000040"

/** Mock: `from("workflows").select(...).eq("id", _).single()` returning `data`. */
function mockWorkflowSelect(data: Record<string, unknown>) {
  const single = vi.fn().mockResolvedValue({ data, error: null })
  const eq = vi.fn().mockReturnValue({ single })
  const select = vi.fn().mockReturnValue({ eq })
  return { select } as never
}

/**
 * Mock: existing-template lookup chain
 *   `from("workflow_templates").select(...).eq().eq().eq().maybeSingle()`
 * Returns `data` (or null to drive the INSERT path).
 */
function mockExistingTemplateLookup(data: Record<string, unknown> | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error: null })
  const eq3 = vi.fn().mockReturnValue({ maybeSingle })
  const eq2 = vi.fn().mockReturnValue({ eq: eq3 })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  return { select } as never
}

/**
 * Mock: capture the payload of `from("workflow_templates").update(P).eq().select().single()`
 * into `capture.value` and return `resultRow` as the response.
 */
function mockUpdateCapture(
  capture: { value: Record<string, unknown> | null },
  resultRow: Record<string, unknown>,
) {
  return {
    update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
      capture.value = payload
      const single = vi.fn().mockResolvedValue({ data: resultRow, error: null })
      const selectAfter = vi.fn().mockReturnValue({ single })
      const eq = vi.fn().mockReturnValue({ select: selectAfter })
      return { eq }
    }),
  } as never
}

/**
 * Mock: capture the payload of `from("workflow_templates").insert(P).select().single()`
 * into `capture.value` and echo the row back.
 */
function mockInsertCapture(capture: { value: Record<string, unknown> | null }) {
  return {
    insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
      capture.value = row
      const single = vi.fn().mockResolvedValue({
        data: { ...row, created_at: "2026-01-01T00:00:00Z" },
        error: null,
      })
      const selectAfter = vi.fn().mockReturnValue({ single })
      return { select: selectAfter }
    }),
  } as never
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  // Bypass auth — set userId from header
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (header && typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => {
    await workflowTemplatesRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/templates/publish — thumbnail durability", () => {
  it("UPDATE: preserves existing preview_media_url when no source URL is resolvable", async () => {
    // Source state: workflow has no thumbnail_url, single text-output node with
    // no result. derivePreviewMedia returns null. sourcePreviewUrl is null.
    // Expected: the UPDATE payload omits preview_media_url / preview_media_type
    // entirely, so the DB row retains the existing values.
    const captureUpdate: { value: Record<string, unknown> | null } = { value: null }
    let tmplCall = 0

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "workflows") {
        return mockWorkflowSelect({
          id: TEST_WORKFLOW_ID,
          user_id: TEST_USER_ID,
          // generate-script is a text-output node — derivePreviewMedia won't
          // pick it up; the test relies on this to drive sourcePreviewUrl=null.
          nodes: [{ id: "n1", type: "generate-script", data: {} }],
          edges: [],
          settings: {},
          thumbnail_url: null,
        })
      }
      if (table === "workflow_templates") {
        tmplCall++
        if (tmplCall === 1) {
          // Existing-template lookup — returns the existing row.
          return mockExistingTemplateLookup({
            id: TEST_TEMPLATE_ID,
            slug: "my-template-existing",
            name: "Old Name",
            listed_in: ["marketplace"],
          })
        }
        // The UPDATE itself — capture the payload.
        return mockUpdateCapture(captureUpdate, {
          id: TEST_TEMPLATE_ID,
          slug: "my-template-existing",
          name: "New Name",
          listed_in: ["marketplace"],
          preview_media_url: "https://r2.example.com/old-preview.png",
          preview_media_type: "image",
        })
      }
      return {} as never
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/templates/publish",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { workflowId: TEST_WORKFLOW_ID, name: "New Name" },
    })

    expect(res.statusCode).toBe(200)
    expect(captureUpdate.value).not.toBeNull()
    // The critical assertions: preview fields must be absent from the UPDATE.
    expect(captureUpdate.value).not.toHaveProperty("preview_media_url")
    expect(captureUpdate.value).not.toHaveProperty("preview_media_type")
    // And we never attempted a copy because there was nothing to copy.
    expect(copyToTemplatePreview).not.toHaveBeenCalled()
  })

  it("INSERT: uses workflows.thumbnail_url as the source when no explicit previewMediaUrl is provided", async () => {
    // Source state: workflow.thumbnail_url is set (user clicked "Set as
    // Thumbnail"). No previewMediaUrl in request body. No existing template
    // (drives INSERT). Expected: copyToTemplatePreview is called with the
    // workflow's thumbnail URL, and the durable URL ends up on the inserted
    // row.
    const workflowThumb = "https://r2.example.com/images/asset.png"
    const durableUrl = "https://r2.example.com/templates/copied/preview.png"
    const captureInsert: { value: Record<string, unknown> | null } = { value: null }
    let tmplCall = 0

    vi.mocked(copyToTemplatePreview).mockResolvedValue(durableUrl)

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "workflows") {
        return mockWorkflowSelect({
          id: TEST_WORKFLOW_ID,
          user_id: TEST_USER_ID,
          nodes: [{ id: "n1", type: "generate-image", data: {} }],
          edges: [],
          settings: {},
          thumbnail_url: workflowThumb,
        })
      }
      if (table === "workflow_templates") {
        tmplCall++
        if (tmplCall === 1) {
          // Existing-template lookup returns null → INSERT path.
          return mockExistingTemplateLookup(null)
        }
        return mockInsertCapture(captureInsert)
      }
      return {} as never
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/templates/publish",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { workflowId: TEST_WORKFLOW_ID, name: "First Publish" },
    })

    expect(res.statusCode).toBe(200)

    // Critical: copy was invoked with the workflow's thumbnail URL, type
    // detected from extension, billed to the creator.
    expect(copyToTemplatePreview).toHaveBeenCalledTimes(1)
    const [sourceUrlArg, , typeArg, userArg] = vi.mocked(copyToTemplatePreview).mock.calls[0]
    expect(sourceUrlArg).toBe(workflowThumb)
    expect(typeArg).toBe("image")
    expect(userArg).toBe(TEST_USER_ID)

    // And the inserted row carries the durable URL — not the raw source.
    expect(captureInsert.value).not.toBeNull()
    expect(captureInsert.value?.preview_media_url).toBe(durableUrl)
    expect(captureInsert.value?.preview_media_type).toBe("image")
  })
})

// ---------------------------------------------------------------------------
// Facet-drift guard: the denormalized, GIN-indexed node_types_used column is
// derived from extractNodeTypes() at publish time. If that derivation ever
// emits a retired alias (e.g. "loop" after the loop→list unification), the
// template is mis-faceted and a one-shot sweep migration only fixes the rows
// that already exist. Routing extractNodeTypes through normalizeLegacyNodeTypes
// (single source of truth) closes the class; this test keeps it closed.
// ---------------------------------------------------------------------------

describe("extractNodeTypes — normalizes legacy aliases (facet-drift guard)", () => {
  it("rewrites loop → list so the facet never carries the retired type", () => {
    const types = extractNodeTypes([
      { type: "loop", data: { columns: [], rows: [] } },
      { type: "generate-image", data: {} },
    ])
    expect(types).toContain("list")
    expect(types).not.toContain("loop")
    expect(types).toContain("generate-image")
  })

  it("normalizes the other load-migrated aliases too", () => {
    const types = extractNodeTypes([
      { type: "image-to-image", data: {} },
      { type: "edit-image", data: { provider: "recraft-remove-bg" } },
      { type: "collect", data: {} }, // OLD collect (no order[]) → reduce
    ])
    expect(types).toEqual(
      expect.arrayContaining(["modify-image", "remove-background", "reduce"]),
    )
    expect(types).not.toContain("image-to-image")
    expect(types).not.toContain("edit-image")
  })

  it("dedupes when a workflow has both a list and a legacy loop node", () => {
    expect(
      extractNodeTypes([
        { type: "list", data: {} },
        { type: "loop", data: {} },
      ]),
    ).toEqual(["list"])
  })

  it("leaves NEW collect (with order[]) and unrelated types unchanged", () => {
    const types = extractNodeTypes([
      { type: "collect", data: { order: ["a", "b"] } },
      { type: "image-to-video", data: {} },
    ])
    expect(types).toEqual(expect.arrayContaining(["collect", "image-to-video"]))
    expect(types).not.toContain("reduce")
  })
})
