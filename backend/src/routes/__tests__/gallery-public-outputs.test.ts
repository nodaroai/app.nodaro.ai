import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * GET /v1/gallery on a deployment that does not allow public outputs
 * (`outputs.allowPublic: false`).
 *
 * The media workers already make every new output private there. These pin the
 * READ: the public view answers an empty gallery without reading a job — a row
 * marked public before the switch was set, or carried over in a copied
 * database, is not listed — while the owner's own view, which is their private
 * library and never public, is untouched.
 */

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/config/content-filter.js", () => ({ isPromptBlocked: vi.fn().mockReturnValue(false) }))

import { galleryRoutes } from "../gallery.js"
import { supabase } from "../../lib/supabase.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-000000000002"
const JOB = {
  id: "job-1",
  job_type: "generate-image",
  input_data: { prompt: "a sunset" },
  output_data: { imageUrl: "https://example.com/img.png" },
  completed_at: "2026-01-01T00:00:00Z",
  user_id: OWNER,
  provider: "kie",
}

/** Every builder call returns the chain; awaiting it answers `result`. */
function chain(result: unknown) {
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve(result)
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
  vi.mocked(supabase.from).mockReturnValue(chain({ data: [JOB], error: null, count: 1 }) as never)
  setProfile({ outputs: { allowPublic: false } })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string" && header) req.userId = header
  })
  await app.register(async (instance) => {
    await galleryRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  setProfile(null)
  await app.close()
})

const EMPTY = { data: [], nextCursor: null, totalCount: 0 }

describe("GET /v1/gallery — a deployment that does not allow public outputs", () => {
  it("the public gallery is empty, and no job is read", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/gallery?type=image" })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(EMPTY)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("so is one person's work, asked for anonymously or by someone else", async () => {
    for (const headers of [{}, { "x-user-id": OTHER }]) {
      const res = await app.inject({ method: "GET", url: `/v1/gallery?userId=${OWNER}`, headers })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual(EMPTY)
    }
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("favoritesOnly keeps its own refusals for anyone but the owner", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/gallery?favoritesOnly=true" })).statusCode).toBe(401)
    const res = await app.inject({ method: "GET", url: `/v1/gallery?userId=${OWNER}&favoritesOnly=true`, headers: { "x-user-id": OTHER } })
    expect(res.statusCode).toBe(403)
  })

  it("the owner's own view still lists their work, privately cached", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/gallery?userId=${OWNER}`, headers: { "x-user-id": OWNER } })

    expect(res.statusCode).toBe(200)
    expect((res.json().data as Array<{ id: string }>).map((item) => item.id)).toEqual(["job-1"])
    expect(res.headers["cache-control"]).toBe("private, no-store")
    expect(supabase.from).toHaveBeenCalledWith("jobs")
  })

  it("with the switch on (the default), the public gallery lists as before", async () => {
    setProfile(null)

    const res = await app.inject({ method: "GET", url: "/v1/gallery" })

    expect(res.statusCode).toBe(200)
    expect((res.json().data as Array<{ id: string }>).map((item) => item.id)).toEqual(["job-1"])
  })
})
