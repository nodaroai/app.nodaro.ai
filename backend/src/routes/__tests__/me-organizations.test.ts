import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/admin-check.js", () => ({ roleIsAdmin: () => false, warmAdminCache: () => {} }))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...actual, hasOrganizations: vi.fn(() => false) }
})
vi.mock("@/lib/private-plugins/load.js", () => ({ getPluginServices: vi.fn(() => ({})) }))

import { supabase } from "@/lib/supabase.js"
import { hasOrganizations } from "@/lib/config.js"
import { getPluginServices } from "@/lib/private-plugins/load.js"
import { meRoutes } from "../me.js"

const USER = "00000000-0000-4000-8000-000000000001"

const PROFILE = {
  id: USER,
  email: "u@example.com",
  full_name: "U",
  avatar_url: null,
  tier: "pro",
  subscription_tier: null,
  role: "user",
}

/** Chainable+thenable Supabase stub (house style). */
function chain(result: Record<string, unknown>) {
  const obj: Record<string, unknown> = {}
  for (const m of ["select", "eq"]) obj[m] = vi.fn(() => obj)
  obj.single = () => Promise.resolve({ error: null, ...result })
  return obj
}

const MEMBERSHIPS = {
  organizations: [{ id: "org-1", slug: "school-a", name: "School A", kind: "school", role: "member" }],
  workspaces: [{ id: "ws-1", orgId: "org-1", name: "Class 1", role: "member" }],
  lastWorkspaceId: "ws-1",
}

let app: FastifyInstance

beforeEach(async () => {
  vi.mocked(supabase.from).mockReturnValue(chain({ data: PROFILE }) as never)
  vi.mocked(hasOrganizations).mockReturnValue(false)
  vi.mocked(getPluginServices).mockReturnValue({})
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") (req as { userId?: string }).userId = header
  })
  await app.register(async (instance) => {
    await meRoutes(instance)
  })
  await app.ready()
})
afterEach(() => app.close())

async function get() {
  return app.inject({ method: "GET", url: "/v1/me", headers: { "x-user-id": USER } })
}

describe("GET /v1/me — organizations", () => {
  it("omits the fields entirely when the instance has no organizations", async () => {
    const res = await get()
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data).toMatchObject({ id: USER, tier: "pro" })
    expect("organizations" in data).toBe(false)
    expect("workspaces" in data).toBe(false)
    expect("lastWorkspaceId" in data).toBe(false)
  })

  it("omits them when the feature is on but no plugin provides the service", async () => {
    vi.mocked(hasOrganizations).mockReturnValue(true)
    const { data } = (await get()).json()
    expect("organizations" in data).toBe(false)
  })

  it("omits them when the plugin IS present but the feature is off", async () => {
    // Production today: cloud always installs the plugin, ORGS_ENABLED is
    // the launch lever. With both absent either gate alone would satisfy
    // the test, so the service has to be present for this to mean anything.
    const orgs = { me: vi.fn(async () => MEMBERSHIPS) }
    vi.mocked(hasOrganizations).mockReturnValue(false)
    vi.mocked(getPluginServices).mockReturnValue({ orgs: orgs as never })
    const { data } = (await get()).json()
    expect("organizations" in data).toBe(false)
    expect(orgs.me).not.toHaveBeenCalled()
  })

  it("merges what the plugin reports", async () => {
    const orgs = { me: vi.fn(async () => MEMBERSHIPS) }
    vi.mocked(hasOrganizations).mockReturnValue(true)
    vi.mocked(getPluginServices).mockReturnValue({ orgs: orgs as never })
    const { data } = (await get()).json()
    expect(data.organizations).toEqual(MEMBERSHIPS.organizations)
    expect(data.workspaces).toEqual(MEMBERSHIPS.workspaces)
    expect(data.lastWorkspaceId).toBe("ws-1")
    expect(orgs.me).toHaveBeenCalledWith(USER)
  })

  it("still answers with the identity when memberships are unavailable, and SAYS so", async () => {
    // Absence means "this instance has no organizations"; a lookup failure
    // must not be mistaken for it, or a client renders "your school is gone"
    // during a Redis blip. The third state is named so it can keep its
    // cached switcher.
    const orgs = {
      me: vi.fn(async () => {
        throw new Error("db down")
      }),
    }
    vi.mocked(hasOrganizations).mockReturnValue(true)
    vi.mocked(getPluginServices).mockReturnValue({ orgs: orgs as never })
    const res = await get()
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data.id).toBe(USER)
    expect("organizations" in data).toBe(false)
    expect(data.organizationsUnavailable).toBe(true)
  })

  it("never sets organizationsUnavailable on the healthy or feature-off paths", async () => {
    const off = (await get()).json().data
    expect("organizationsUnavailable" in off).toBe(false)
    vi.mocked(hasOrganizations).mockReturnValue(true)
    vi.mocked(getPluginServices).mockReturnValue({ orgs: { me: vi.fn(async () => MEMBERSHIPS) } as never })
    const on = (await get()).json().data
    expect("organizationsUnavailable" in on).toBe(false)
  })

  it("still requires authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/me" })
    expect(res.statusCode).toBe(401)
  })
})
