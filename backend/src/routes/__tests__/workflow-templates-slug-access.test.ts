// GET /v1/templates/:slug — who may read a template. The route is public and
// reads with the service role, so it decides visibility itself:
//
//   - on AND listed in a public channel → anyone;
//   - on, not listed → its creator only;
//   - an admin → any template, listed or not, on or off (the preview in
//     Admin → Templates). The role is asked only when nothing else lets the
//     request through, and a failed lookup never widens access.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const h = vi.hoisted(() => ({ checkIsAdmin: vi.fn(), hasAdmin: vi.fn(() => true) }))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
  },
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: h.hasAdmin,
  hasOrganizations: () => false,
}))

vi.mock("@/lib/admin-check.js", () => ({ checkIsAdmin: h.checkIsAdmin }))

vi.mock("@/ee/middleware/require-admin.js", () => ({ requireAdmin: async () => undefined }))

vi.mock("@/ee/billing/credits.js", () => ({
  estimateWorkflowCredits: vi.fn().mockReturnValue(10),
  estimateWorkflowListingCredits: vi.fn().mockResolvedValue({ preview: 10, final: 0 }),
}))

vi.mock("@/lib/marketplace-helpers.js", () => ({
  sanitizeSlugBase: (s: string) => s.toLowerCase(),
  generateSlug: (name: string) => `${name.toLowerCase()}-test`,
  getCreatorDisplayName: vi.fn().mockResolvedValue("Test Creator"),
}))

vi.mock("@/lib/storage.js", () => ({ copyToTemplatePreview: vi.fn() }))

import { workflowTemplatesRoutes } from "../workflow-templates.js"
import { supabase } from "../../lib/supabase.js"

const CREATOR = "00000000-0000-4000-8000-0000000000c1"
const VISITOR = "00000000-0000-4000-8000-0000000000a1"
const ADMIN = "00000000-0000-4000-8000-0000000000ad"

function row(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "00000000-0000-4000-8000-000000000040",
    slug: "steal-the-format-33uvcy",
    name: "Steal the Format",
    creator_id: CREATOR,
    is_active: true,
    listed_in: [],
    created_at: "2026-10-04T00:00:00Z",
    ...overrides,
  }
}

/** `from("workflow_templates").select("*").eq("slug", _).maybeSingle()` answers `data`. */
function serve(data: Record<string, unknown> | null) {
  const eqCalls: Array<[string, unknown]> = []
  vi.mocked(supabase.from).mockImplementation(() => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((column: string, value: unknown) => {
        eqCalls.push([column, value])
        return chain
      }),
      maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
    }
    return chain as never
  })
  return eqCalls
}

function get(userId?: string) {
  return app.inject({
    method: "GET",
    url: "/v1/templates/steal-the-format-33uvcy",
    headers: userId ? { "x-user-id": userId } : {},
  })
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  h.hasAdmin.mockReturnValue(true)
  h.checkIsAdmin.mockImplementation(async (userId: string) => userId === ADMIN)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => {
    await workflowTemplatesRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("GET /v1/templates/:slug — who may read a template", () => {
  it("anyone reads a template that is on and listed, and no role is asked", async () => {
    const eqCalls = serve(row({ listed_in: ["marketplace"] }))
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ slug: "steal-the-format-33uvcy", isListed: true })
    expect(h.checkIsAdmin).not.toHaveBeenCalled()
    // One unique slug, read whole: the visibility is decided in code.
    expect(eqCalls).toEqual([["slug", "steal-the-format-33uvcy"]])
  })

  it("an unlisted template answers its creator, and 404s anyone else", async () => {
    serve(row({}))
    expect((await get(CREATOR)).statusCode).toBe(200)
    expect((await get(VISITOR)).statusCode).toBe(404)
    expect((await get()).statusCode).toBe(404)
  })

  it("a template that is off 404s even its creator, as before", async () => {
    serve(row({ is_active: false, listed_in: ["marketplace"] }))
    expect((await get(CREATOR)).statusCode).toBe(404)
    expect((await get()).statusCode).toBe(404)
  })

  it("an admin reads an unlisted template someone else made", async () => {
    serve(row({}))
    const res = await get(ADMIN)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ isListed: false, isActive: true })
  })

  it("an admin reads a template that is off", async () => {
    serve(row({ is_active: false, listed_in: ["marketplace"] }))
    const res = await get(ADMIN)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ isActive: false })
  })

  it("a failed role lookup never widens access", async () => {
    serve(row({}))
    h.checkIsAdmin.mockRejectedValue(new Error("Admin check failed"))
    expect((await get(ADMIN)).statusCode).toBe(404)
  })

  it("on an edition with no admin panel, nobody is asked for a role", async () => {
    serve(row({}))
    h.hasAdmin.mockReturnValue(false)
    expect((await get(ADMIN)).statusCode).toBe(404)
    expect(h.checkIsAdmin).not.toHaveBeenCalled()
  })

  it("a slug that does not exist is a 404 for everyone", async () => {
    serve(null)
    expect((await get(ADMIN)).statusCode).toBe(404)
  })
})
