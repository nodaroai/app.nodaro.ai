/**
 * GET /v1/admin/gallery-moderation/items — the public gallery as visitors see
 * it, with who made each item, for admins only and never cached.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const state = vi.hoisted(() => ({
  profiles: [] as Array<{ id: string; email: string; full_name: string | null }>,
  pageArgs: [] as unknown[],
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => {
      let ids: string[] = []
      const builder: Record<string, unknown> = {
        select: () => builder,
        in: (_c: string, values: string[]) => {
          ids = values
          return builder
        },
        then: (resolve: (v: unknown) => unknown) => resolve({ data: state.profiles.filter((p) => ids.includes(p.id)), error: null }),
      }
      return builder
    }),
  },
}))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(true) }))
vi.mock("@/ee/lib/gallery-word-suggestions.js", () => ({ suggestForBannedWord: vi.fn() }))
vi.mock("@/lib/gallery-moderation.js", () => ({ loadGalleryModeration: vi.fn(async () => ({ marker: "moderation" })) }))
vi.mock("@/lib/gallery-listing.js", () => ({
  readGalleryPage: vi.fn(async (args: unknown) => {
    state.pageArgs.push(args)
    const item = (id: string) => ({ id, type: "image", jobName: "generate-image", outputUrl: `https://x/${id}.png`, thumbnailUrl: null, createdAt: "2026-10-01T00:00:00Z", prompt: "p", model: null })
    return { rows: [{ item: item("j1"), userId: A }, { item: item("j2"), userId: null }], nextCursor: "c1", totalCount: 2 }
  }),
}))

import { adminGalleryModerationRoutes } from "../admin-gallery-moderation.js"
import { checkIsAdmin } from "../../../lib/admin-check.js"

const A = "00000000-0000-4000-8000-00000000000a"
const ADMIN = "00000000-0000-4000-8000-0000000000ad"

let app: FastifyInstance
beforeEach(async () => {
  vi.mocked(checkIsAdmin).mockResolvedValue(true)
  state.profiles = [{ id: A, email: "maker@example.com", full_name: "Maker" }]
  state.pageArgs = []
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const id = req.headers["x-user-id"]
    if (typeof id === "string" && id) req.userId = id
  })
  await app.register(async (instance) => {
    await adminGalleryModerationRoutes(instance)
  })
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

describe("GET /v1/admin/gallery-moderation/items", () => {
  it("is for admins only", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/admin/gallery-moderation/items" })).statusCode).toBe(401)
    vi.mocked(checkIsAdmin).mockResolvedValue(false)
    expect((await app.inject({ method: "GET", url: "/v1/admin/gallery-moderation/items", headers: { "x-user-id": A } })).statusCode).toBe(403)
  })

  it("reads the public gallery with its moderation, and names each item's creator", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/gallery-moderation/items?type=image&limit=10&cursor=c0", headers: { "x-user-id": ADMIN } })
    expect(res.statusCode).toBe(200)
    expect(state.pageArgs[0]).toEqual({ type: "image", limit: 10, cursor: "c0", includePrivate: false, moderation: { marker: "moderation" } })
    expect(res.json().data.map((i: { id: string; creator: unknown }) => [i.id, i.creator])).toEqual([
      ["j1", { userId: A, email: "maker@example.com", name: "Maker" }],
      ["j2", null],
    ])
    expect(res.json().nextCursor).toBe("c1")
    expect(res.headers["cache-control"]).toBe("private, no-store")
  })

  it("refuses a bad filter", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/gallery-moderation/items?type=gif", headers: { "x-user-id": ADMIN } })
    expect(res.statusCode).toBe(400)
  })
})
