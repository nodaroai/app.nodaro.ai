// PATCH /v1/admin/workflow-templates/:id/listing — the admin's switches for ANY
// template: `isActive` turns it off everywhere (gallery, its page, cloning, the
// tutorials), `isListed` takes it in or out of the gallery. Not ownership-gated,
// and `isListed` touches only the marketplace tag: a tutorial stays a tutorial.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify"

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
  hasAdmin: () => true,
  hasOrganizations: () => false,
}))

// The real guard reads the role table; here an `x-admin` header stands in for it.
vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.headers["x-admin"] !== "1") {
      return reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
    }
  },
}))

vi.mock("@/ee/billing/credits.js", () => ({
  estimateWorkflowCredits: vi.fn().mockReturnValue(10),
  estimateWorkflowListingCredits: vi.fn().mockResolvedValue({ preview: 10, final: 0 }),
}))

vi.mock("@/lib/marketplace-helpers.js", () => ({
  sanitizeSlugBase: (s: string) => s.toLowerCase(),
  generateSlug: (name: string) => `${name.toLowerCase()}-test`,
  getCreatorDisplayName: vi.fn().mockResolvedValue("Test Creator"),
}))

vi.mock("@/lib/storage.js", () => ({
  copyToTemplatePreview: vi.fn(),
}))

import { workflowTemplatesRoutes } from "../workflow-templates.js"
import { supabase } from "../../lib/supabase.js"

const TEMPLATE_ID = "00000000-0000-4000-8000-000000000040"
const CREATOR_ID = "00000000-0000-4000-8000-000000000001"

/**
 * `from("workflow_templates")` for this route: the lookup
 * `.select("id, listed_in").eq("id", _).maybeSingle()` answers `existing`, and
 * `.update(P).eq("id", _).select().single()` records P and echoes the row.
 */
function mockTemplatesTable(existing: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = []
  vi.mocked(supabase.from).mockImplementation(() => ({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: existing, error: null }),
      }),
    }),
    update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
      updates.push(payload)
      return {
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { ...existing, ...payload }, error: null }),
          }),
        }),
      }
    }),
  }) as never)
  return updates
}

function patch(body: unknown, headers: Record<string, string> = { "x-admin": "1" }) {
  return app.inject({
    method: "PATCH",
    url: `/v1/admin/workflow-templates/${TEMPLATE_ID}/listing`,
    headers,
    payload: body as Record<string, unknown>,
  })
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  await app.register(async (instance) => {
    await workflowTemplatesRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("PATCH /v1/admin/workflow-templates/:id/listing", () => {
  it("turns off a template the admin did not create, and changes nothing else", async () => {
    const updates = mockTemplatesTable({ id: TEMPLATE_ID, creator_id: CREATOR_ID, listed_in: ["marketplace"] })
    const res = await patch({ isActive: false })
    expect(res.statusCode).toBe(200)
    expect(updates).toEqual([{ is_active: false }])
    expect(res.json()).toMatchObject({ id: TEMPLATE_ID, isActive: false, isListed: true })
  })

  it("turns a template back on", async () => {
    const updates = mockTemplatesTable({ id: TEMPLATE_ID, creator_id: CREATOR_ID, listed_in: [], is_active: false })
    const res = await patch({ isActive: true })
    expect(res.statusCode).toBe(200)
    expect(updates).toEqual([{ is_active: true }])
  })

  it("taking a template out of the gallery keeps it in the tutorials", async () => {
    const updates = mockTemplatesTable({ id: TEMPLATE_ID, listed_in: ["marketplace", "tutorial"] })
    const res = await patch({ isListed: false })
    expect(res.statusCode).toBe(200)
    expect(updates).toEqual([{ listed_in: ["tutorial"] }])
    expect(res.json()).toMatchObject({ isListed: false, isTutorial: true })
  })

  it("putting a template in the gallery adds the marketplace tag beside the others", async () => {
    const updates = mockTemplatesTable({ id: TEMPLATE_ID, listed_in: ["tutorial"] })
    const res = await patch({ isListed: true })
    expect(res.statusCode).toBe(200)
    expect(updates).toEqual([{ listed_in: ["tutorial", "marketplace"] }])
  })

  it("refuses a body with neither switch", async () => {
    const updates = mockTemplatesTable({ id: TEMPLATE_ID, listed_in: [] })
    const res = await patch({})
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(updates).toEqual([])
  })

  it("answers 404 for a template that does not exist", async () => {
    const updates = mockTemplatesTable(null)
    const res = await patch({ isActive: false })
    expect(res.statusCode).toBe(404)
    expect(updates).toEqual([])
  })

  it("is closed to a signed-in person who is not an admin", async () => {
    const updates = mockTemplatesTable({ id: TEMPLATE_ID, listed_in: ["marketplace"] })
    const res = await patch({ isActive: false }, {})
    expect(res.statusCode).toBe(403)
    expect(updates).toEqual([])
    expect(vi.mocked(supabase.from)).not.toHaveBeenCalled()
  })
})
