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
  hasOrganizations: () => false,
}))

vi.mock("@/ee/billing/credits.js", () => ({
  estimateWorkflowCredits: vi.fn().mockReturnValue(10),
  estimateWorkflowListingCredits: vi.fn().mockReturnValue(10),
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

/**
 * Mock: `from("workflows").select(...).eq("id", _).maybeSingle()` returning
 * `data`.
 *
 * The publish route reads the workflow unfiltered and lets the access rule
 * judge it — publishing takes `own`, so an editor grant on class work is not
 * enough to turn somebody else's workflow into a public template.
 */
function mockWorkflowSelect(data: Record<string, unknown>) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error: null })
  const eq = vi.fn().mockReturnValue({ maybeSingle })
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
          workspace_id: null,
          visibility: "private",
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
          workspace_id: null,
          visibility: "private",
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

// ---------------------------------------------------------------------------
// Browse sorts: every sort keys its cursor off the columns it orders by, so a
// page boundary never repeats or skips a card. "cheapest" is the Templates
// page's "Fewest credits" — ascending credits, newest first within a tie.
// ---------------------------------------------------------------------------

/**
 * Mock: a chainable browse query that records every `.order()` / `.or()` and
 * resolves to `rows` when awaited (the route awaits the builder itself).
 */
function mockBrowseQuery(rows: Array<Record<string, unknown>>) {
  const calls = { order: [] as unknown[][], or: [] as string[], in: [] as unknown[][] }
  const builder: Record<string, unknown> = {}
  for (const method of ["select", "contains", "eq", "limit", "textSearch", "lt", "order", "or", "in"]) {
    builder[method] = vi.fn().mockImplementation((...args: unknown[]) => {
      if (method === "order") calls.order.push(args)
      if (method === "or") calls.or.push(String(args[0]))
      if (method === "in") calls.in.push(args)
      return builder
    })
  }
  builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve, reject)
  return { builder: builder as never, calls }
}

describe("GET /v1/templates/browse — sort=cheapest", () => {
  const cheap = { id: "t1", slug: "cheap", name: "Cheap", estimated_credits: 80, created_at: "2026-02-01T00:00:00Z" }
  const dearer = { id: "t2", slug: "dearer", name: "Dearer", estimated_credits: 120, created_at: "2026-03-01T00:00:00Z" }

  it("orders by estimated credits ascending, then newest, and continues past the cursor", async () => {
    const { builder, calls } = mockBrowseQuery([cheap, dearer])
    vi.mocked(supabase.from).mockReturnValue(builder)

    const res = await app.inject({
      method: "GET",
      url: "/v1/templates/browse?sort=cheapest&limit=1&cursor=60:2026-01-15T00:00:00Z",
    })

    expect(res.statusCode).toBe(200)
    expect(calls.order).toEqual([
      ["estimated_credits", { ascending: true }],
      ["created_at", { ascending: false }],
    ])
    expect(calls.or).toEqual(["estimated_credits.gt.60,and(estimated_credits.eq.60,created_at.lt.2026-01-15T00:00:00Z)"])
    const body = res.json()
    expect(body.data.map((c: { slug: string }) => c.slug)).toEqual(["cheap"])
    // The cursor names the last card's credits + date — the columns the sort keys on.
    expect(body.nextCursor).toBe("80:2026-02-01T00:00:00Z")
  })

  it("keeps the whole timestamp of a popular-sort cursor (only the first colon separates the pair)", async () => {
    const { builder, calls } = mockBrowseQuery([dearer])
    vi.mocked(supabase.from).mockReturnValue(builder)

    const res = await app.inject({
      method: "GET",
      url: "/v1/templates/browse?sort=popular&cursor=7:2026-01-15T10:20:30.123Z",
    })

    expect(res.statusCode).toBe(200)
    expect(calls.or).toEqual(["clone_count.lt.7,and(clone_count.eq.7,created_at.lt.2026-01-15T10:20:30.123Z)"])
  })

  it("drops a cursor whose date is not a timestamp instead of splicing it into the filter", async () => {
    const { builder, calls } = mockBrowseQuery([dearer])
    vi.mocked(supabase.from).mockReturnValue(builder)

    const res = await app.inject({
      method: "GET",
      url: `/v1/templates/browse?sort=popular&cursor=${encodeURIComponent("7:2026-01-15T00:00:00Z),or(is_active.eq.false")}`,
    })

    expect(res.statusCode).toBe(200)
    expect(calls.or).toEqual([])
  })

  it("filters a category by every stored value that reads as it, and answers with the current one", async () => {
    // A row the category migration has not rewritten yet still carries the old value.
    const legacyRow = { ...dearer, category: "video-production" }
    const { builder, calls } = mockBrowseQuery([legacyRow])
    vi.mocked(supabase.from).mockReturnValue(builder)

    const res = await app.inject({ method: "GET", url: "/v1/templates/browse?category=video-ads" })

    expect(res.statusCode).toBe(200)
    expect(calls.in).toEqual([["category", ["video-ads", "video-production"]]])
    expect(res.json().data[0].category).toBe("video-ads")
  })

  it("rejects a category from the previous taxonomy — the client sends the current eight", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/templates/browse?category=video-production" })
    expect(res.statusCode).toBe(400)
  })

  it("rejects a sort the route does not know", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/templates/browse?sort=fanciest" })
    expect(res.statusCode).toBe(400)
  })
})

describe("GET /v1/templates/browse — favoritesOnly", () => {
  const card = { id: "t2", slug: "fav", name: "Fav", estimated_credits: 10, created_at: "2026-03-01T00:00:00Z" }

  function mockFavorites(templateIds: string[]) {
    const eq = vi.fn().mockResolvedValue({ data: templateIds.map((template_id) => ({ template_id })), error: null })
    const select = vi.fn().mockReturnValue({ eq })
    return { select } as never
  }

  it("needs a signed-in caller", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/templates/browse?favoritesOnly=true" })
    expect(res.statusCode).toBe(401)
  })

  it("narrows the browse to the caller's favorites and never caches it", async () => {
    const { builder, calls } = mockBrowseQuery([card])
    vi.mocked(supabase.from).mockImplementation((table: string) =>
      table === "template_favorites" ? mockFavorites(["t2", "t9"]) : builder,
    )

    const res = await app.inject({
      method: "GET",
      url: "/v1/templates/browse?favoritesOnly=true",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(calls.in).toEqual([["id", ["t2", "t9"]]])
    expect(res.json().data.map((c: { slug: string }) => c.slug)).toEqual(["fav"])
    expect(res.headers["cache-control"]).toBe("private, no-store")
  })

  it("answers an empty list without touching the templates table when nothing is favorited", async () => {
    const { builder } = mockBrowseQuery([card])
    vi.mocked(supabase.from).mockImplementation((table: string) =>
      table === "template_favorites" ? mockFavorites([]) : builder,
    )

    const res = await app.inject({
      method: "GET",
      url: "/v1/templates/browse?favoritesOnly=true",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [], nextCursor: null })
    expect(vi.mocked(supabase.from)).not.toHaveBeenCalledWith("workflow_templates")
  })
})

describe("POST /v1/templates/:slug/clone — baked demo outputs survive the clone", () => {
  const TEST_PROJECT_ID = "00000000-0000-4000-8000-000000000030"
  // A snapshot node with baked results — exactly what a tutorial template ships
  // so its walkthrough shows real media instead of empty grey boxes.
  const bakedNode = {
    id: "scene-image",
    type: "generate-image",
    data: {
      prompt: "a lighthouse at dusk",
      generatedImageUrl: "https://cdn.nodaro.ai/demo/lighthouse.png",
      generatedResults: [{ url: "https://cdn.nodaro.ai/demo/lighthouse.png", jobId: "demo-1" }],
    },
  }

  it("carries the template's baked generatedResults into the cloned workflow's nodes", async () => {
    const captureInsert: { value: Record<string, unknown> | null } = { value: null }
    let tmplCall = 0

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "workflow_templates") {
        tmplCall++
        if (tmplCall === 1) {
          // Load template: select("*").eq("slug", _).eq("is_active", true).maybeSingle()
          const maybeSingle = vi.fn().mockResolvedValue({
            data: {
              id: "tpl-1", name: "Welcome Demo", clone_count: 0,
              snapshot_nodes: [bakedNode], snapshot_edges: [], snapshot_settings: {},
              preview_media_url: "https://cdn.nodaro.ai/demo/lighthouse.png",
            },
            error: null,
          })
          const eq2 = vi.fn().mockReturnValue({ maybeSingle })
          const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
          const select = vi.fn().mockReturnValue({ eq: eq1 })
          return { select } as never
        }
        // clone_count increment: update(_).eq("id", _)  (awaited, no select)
        const eq = vi.fn().mockResolvedValue({ data: null, error: null })
        return { update: vi.fn().mockReturnValue({ eq }) } as never
      }
      if (table === "projects") {
        // select("id, user_id").eq("id", _).single()
        const single = vi.fn().mockResolvedValue({
          data: { id: TEST_PROJECT_ID, user_id: TEST_USER_ID }, error: null,
        })
        const eq = vi.fn().mockReturnValue({ single })
        const select = vi.fn().mockReturnValue({ eq })
        return { select } as never
      }
      if (table === "workflows") {
        // insert(row).select("id").single()
        const insert = vi.fn().mockImplementation((row: Record<string, unknown>) => {
          captureInsert.value = row
          const single = vi.fn().mockResolvedValue({ data: { id: "wf-new" }, error: null })
          return { select: vi.fn().mockReturnValue({ single }) }
        })
        return { insert } as never
      }
      return {} as never
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/templates/welcome-demo/clone",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { projectId: TEST_PROJECT_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(captureInsert.value).not.toBeNull()
    const nodes = captureInsert.value!.nodes as Array<{ data: Record<string, unknown> }>
    // The invariant: baked demo output survives the clone. If someone re-wires
    // stripExecutionData into this path, generatedResults disappears and this fails.
    expect(nodes[0].data.generatedResults).toEqual([
      { url: "https://cdn.nodaro.ai/demo/lighthouse.png", jobId: "demo-1" },
    ])
    expect(nodes[0].data.generatedImageUrl).toBe("https://cdn.nodaro.ai/demo/lighthouse.png")
  })
})
