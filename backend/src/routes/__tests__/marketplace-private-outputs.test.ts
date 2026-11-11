import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * The REST marketplace on a deployment that does not allow public outputs
 * (`outputs.allowPublic: false`).
 *
 * The app and template marketplaces list other people's published work, and
 * take no sign-in. There they list nothing, without reading a listing — the
 * REST twins of MCP `list_apps` / `list_components` in their public scope. A
 * template someone else listed on the marketplace is also not found by its
 * page or its clone (an empty index beside a page that still answers by slug
 * would be a deny in name only, as the community listings already rule); the
 * administrator's tutorial channel stays, and so does the creator's own. With
 * the switch on — no profile, as every install without one runs — nothing
 * changes.
 */

const h = vi.hoisted(() => ({ checkIsAdmin: vi.fn(), tables: [] as string[], rows: new Map<string, unknown>() }))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => false,
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: h.checkIsAdmin }))
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
vi.mock("@/lib/storage.js", () => ({ copyToTemplatePreview: vi.fn(), copyToTemplateKept: vi.fn() }))

import { publishedAppsRoutes } from "../published-apps.js"
import { workflowTemplatesRoutes } from "../workflow-templates.js"
import { supabase } from "../../lib/supabase.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

const CREATOR = "00000000-0000-4000-8000-0000000000c1"
const VISITOR = "00000000-0000-4000-8000-0000000000a1"
const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const PROJECT = "00000000-0000-4000-8000-000000000010"
const SLUG = "steal-the-format-33uvcy"

const APP_CARD = {
  id: "00000000-0000-4000-8000-000000000040",
  slug: "zebrify",
  name: "Zebrify",
  description: "d",
  icon_url: null,
  estimated_credits: 10,
  category: "fun",
  output_types: ["image"],
  tags: [],
  preview_media_url: null,
  preview_media_type: null,
  supports_remix: false,
  creator_id: CREATOR,
  creator_display_name: "Creator",
  total_run_count: 3,
  favorite_count: 1,
  created_at: "2026-10-01T00:00:00Z",
  monetization_enabled: false,
  publish_type: "app",
  component_metadata: null,
}

function template(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "00000000-0000-4000-8000-000000000050",
    slug: SLUG,
    name: "Steal the Format",
    creator_id: CREATOR,
    is_active: true,
    listed_in: ["marketplace"],
    clone_count: 2,
    favorite_count: 0,
    estimated_credits: 10,
    created_at: "2026-10-04T00:00:00Z",
    ...overrides,
  }
}

/** Every builder call returns the chain; awaiting it — or `.single()` / `.maybeSingle()` — answers the table's rows. */
function chain(table: string) {
  const rows = h.rows.get(table) ?? null
  const answer = { data: rows, error: rows === null ? { code: "PGRST116", message: "none" } : null }
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve(answer)
        if (prop === "single" || prop === "maybeSingle") {
          return async () => ({ data: Array.isArray(rows) ? rows[0] ?? null : rows, error: null })
        }
        return () => proxy
      },
    },
  )
  return proxy
}

function setProfile(profile: Record<string, unknown> | null) {
  if (profile) process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  else delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  h.tables = []
  h.rows = new Map<string, unknown>([
    ["published_apps", [APP_CARD]],
    ["workflow_templates", [template()]],
    ["projects", null],
  ])
  h.checkIsAdmin.mockImplementation(async (userId: string) => userId === ADMIN)
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    h.tables.push(table)
    return chain(table)
  }) as never)
  setProfile({ outputs: { allowPublic: false } })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => {
    await publishedAppsRoutes(instance)
    await workflowTemplatesRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  setProfile(null)
})

const get = (url: string, userId?: string) => app.inject({ method: "GET", url, headers: userId ? { "x-user-id": userId } : {} })
const clone = (userId: string) =>
  app.inject({ method: "POST", url: `/v1/templates/${SLUG}/clone`, headers: { "x-user-id": userId }, payload: { projectId: PROJECT } })

describe("with outputs.allowPublic false", () => {
  it.each([
    ["GET /v1/apps/browse", "/v1/apps/browse", "published_apps"],
    ["GET /v1/apps/browse for components", "/v1/apps/browse?publishType=component", "published_apps"],
    ["GET /v1/templates/browse", "/v1/templates/browse", "workflow_templates"],
  ])("%s lists nothing, signed in or not, and reads no listing", async (_label, url, table) => {
    for (const userId of [undefined, VISITOR, CREATOR]) {
      h.tables = []
      const res = await get(url, userId)
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ data: [], nextCursor: null })
      expect(h.tables).not.toContain(table)
    }
  })

  it("the favorites view of the app marketplace lists nothing either, and still asks for a sign-in", async () => {
    h.rows.set("app_favorites", [{ app_id: APP_CARD.id }])
    const res = await get("/v1/apps/browse?favoritesOnly=true", VISITOR)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [], nextCursor: null })
    expect(h.tables).not.toContain("published_apps")
    expect((await get("/v1/apps/browse?favoritesOnly=true")).statusCode).toBe(401)
  })

  it("the Favorites view of the template marketplace lists nothing either", async () => {
    h.rows.set("template_favorites", [{ template_id: "00000000-0000-4000-8000-000000000050" }])
    const res = await get("/v1/templates/browse?favoritesOnly=true", VISITOR)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [], nextCursor: null })
    expect(h.tables).not.toContain("workflow_templates")
  })

  it("a template on the marketplace is not found by its page for anyone but its creator (and an admin's preview)", async () => {
    expect((await get(`/v1/templates/${SLUG}`)).statusCode).toBe(404)
    expect((await get(`/v1/templates/${SLUG}`, VISITOR)).statusCode).toBe(404)
    expect((await get(`/v1/templates/${SLUG}`, VISITOR)).json()).toEqual({ error: { code: "not_found", message: "Template not found" } })
    expect((await get(`/v1/templates/${SLUG}`, CREATOR)).statusCode).toBe(200)
    expect((await get(`/v1/templates/${SLUG}`, ADMIN)).statusCode).toBe(200)
  })

  it("a template in the administrator's tutorial channel is still read by anyone", async () => {
    h.rows.set("workflow_templates", [template({ listed_in: ["tutorial"] })])
    const res = await get(`/v1/templates/${SLUG}`)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ slug: SLUG })
  })

  it("someone else's marketplace template is not found by its clone; its creator's clone goes on as before", async () => {
    const other = await clone(VISITOR)
    expect(other.statusCode).toBe(404)
    expect(other.json()).toEqual({ error: { code: "not_found", message: "Template not found" } })
    expect(h.tables).not.toContain("projects")

    h.tables = []
    const own = await clone(CREATOR)
    // Past the gate: the next step asks for the target project.
    expect(h.tables).toContain("projects")
    expect(own.json()).toEqual({ error: { code: "not_found", message: "Project not found" } })
  })

  it("a tutorial template is still cloned by anyone", async () => {
    h.rows.set("workflow_templates", [template({ listed_in: ["tutorial"] })])
    const res = await clone(VISITOR)
    expect(h.tables).toContain("projects")
    expect(res.json()).toEqual({ error: { code: "not_found", message: "Project not found" } })
  })
})

describe.each([
  ["no profile (the default)", null],
  ["a profile that allows public outputs", { outputs: { allowPublic: true } }],
])("with public outputs allowed: %s", (_label, profile) => {
  beforeEach(() => setProfile(profile))

  it("GET /v1/apps/browse lists the marketplace as before", async () => {
    const res = await get("/v1/apps/browse")
    expect(res.statusCode).toBe(200)
    expect(res.json().data.map((card: { slug: string }) => card.slug)).toEqual(["zebrify"])
    expect(h.tables).toContain("published_apps")
  })

  it("GET /v1/apps/browse?favoritesOnly=true lists the caller's favorited apps as before", async () => {
    h.rows.set("app_favorites", [{ app_id: APP_CARD.id }])
    const res = await get("/v1/apps/browse?favoritesOnly=true", VISITOR)
    expect(res.statusCode).toBe(200)
    expect(res.json().data.map((card: { slug: string }) => card.slug)).toEqual(["zebrify"])
    expect(h.tables).toEqual(expect.arrayContaining(["app_favorites", "published_apps"]))
  })

  it("GET /v1/templates/browse lists the marketplace as before", async () => {
    const res = await get("/v1/templates/browse")
    expect(res.statusCode).toBe(200)
    expect(res.json().data.map((card: { slug: string }) => card.slug)).toEqual([SLUG])
  })

  it("a marketplace template's page answers anyone, and its clone goes past the listing check", async () => {
    expect((await get(`/v1/templates/${SLUG}`)).statusCode).toBe(200)
    expect((await get(`/v1/templates/${SLUG}`, VISITOR)).statusCode).toBe(200)
    const res = await clone(VISITOR)
    expect(h.tables).toContain("projects")
    expect(res.json()).toEqual({ error: { code: "not_found", message: "Project not found" } })
  })
})
