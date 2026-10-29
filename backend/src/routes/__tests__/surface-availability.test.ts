import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * GET /v1/surface/availability — the list the browser's node picker filters by.
 *
 * It answers PER VIEWER: the admin switch hides a node from users, so a user's
 * `denied` carries it, while an admin's does not and names it under
 * `hiddenFromUsers` instead (the picker marks those). A non-admin must never
 * receive `hiddenFromUsers`, and the response must never be shared-cacheable
 * now that it depends on who asked.
 */

const admins = vi.hoisted(() => ({ ids: new Set<string>(), fail: false }))
vi.mock("@/lib/admin-check.js", () => ({
  checkIsAdmin: async (userId: string) => {
    if (admins.fail) throw new Error("Admin check failed: db down")
    return admins.ids.has(userId)
  },
}))
vi.mock("@/lib/node-registry.js", () => ({
  NODE_REGISTRY: [
    { type: "text-prompt", category: "input" },
    { type: "generate-image", category: "ai-image" },
    { type: "generate-video", category: "ai-video" },
    { type: "instagram-scrape", category: "input" },
    { type: "meta-ads-scrape", category: "input" },
    { type: "web-scrape", category: "input" },
  ],
}))
// surfaceGateOpen() must be true for the profile case below.
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  isBusiness: () => false,
  isCloud: () => true,
  isCommunity: () => false,
  hasCredits: () => true,
  hasAdmin: () => true,
}))

import { surfaceAvailabilityRoutes } from "../surface-availability.js"
import {
  __resetAvailabilityOverridesForTests,
  __availabilityUniverseReadyForTests,
} from "../../lib/availability-override.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { __resetModelSwitchForTests } from "../../lib/model-switch.js"

const USER = "user-1"
const ADMIN = "admin-1"
let app: FastifyInstance

beforeAll(() => __availabilityUniverseReadyForTests())

beforeEach(async () => {
  admins.ids = new Set([ADMIN])
  admins.fail = false
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") (req as { userId?: string }).userId = header
  })
  await app.register(surfaceAvailabilityRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
  __resetAvailabilityOverridesForTests()
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
  __resetModelSwitchForTests()
})

const get = (userId?: string) =>
  app.inject({ method: "GET", url: "/v1/surface/availability", headers: userId ? { "x-user-id": userId } : {} })

/** The production shape: everything on except the two scrapers. */
const hideScrapers = () =>
  __resetAvailabilityOverridesForTests({ nodes: new Set(["text-prompt", "generate-image", "generate-video", "web-scrape"]) })

describe("GET /v1/surface/availability", () => {
  it("stock deployment: nothing denied, nothing hidden, for anyone", async () => {
    for (const who of [USER, ADMIN]) {
      const body = (await get(who)).json()
      expect(body.nodes).toEqual({ denied: [], hiddenFromUsers: [] })
      expect(body.models).toEqual({ denied: [] })
    }
  })

  it("a model the admin switched off on its pricing row is denied for everyone — admins too", async () => {
    __resetModelSwitchForTests(["flux-flex"])
    for (const who of [USER, ADMIN]) {
      const body = (await get(who)).json()
      expect(body.models.denied).toEqual(["flux-flex"])
    }
  })

  it("a user gets the hidden nodes as denied and is told nothing about what is hidden", async () => {
    hideScrapers()
    const body = (await get(USER)).json()
    expect([...body.nodes.denied].sort()).toEqual(["instagram-scrape", "meta-ads-scrape"])
    expect(body.nodes.hiddenFromUsers).toEqual([])
  })

  it("an admin keeps the hidden nodes, and gets them named so the picker can mark them", async () => {
    hideScrapers()
    const body = (await get(ADMIN)).json()
    expect(body.nodes.denied).toEqual([])
    expect([...body.nodes.hiddenFromUsers].sort()).toEqual(["instagram-scrape", "meta-ads-scrape"])
  })

  it("an admin does not get back what the deployment PROFILE removed", async () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nodes: { deny: ["generate-video"] } })
    __resetSurfaceProfileCacheForTests()
    __resetAvailabilityOverridesForTests({ nodes: new Set(["text-prompt", "generate-image", "web-scrape"]) })
    const body = (await get(ADMIN)).json()
    expect(body.nodes.denied).toEqual(["generate-video"])
    expect([...body.nodes.hiddenFromUsers].sort()).toEqual(["instagram-scrape", "meta-ads-scrape"])
  })

  it("no user id, or an admin-check outage, is the USER view", async () => {
    hideScrapers()
    expect([...(await get()).json().nodes.denied].sort()).toEqual(["instagram-scrape", "meta-ads-scrape"])

    admins.fail = true
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const body = (await get(ADMIN)).json()
    expect([...body.nodes.denied].sort()).toEqual(["instagram-scrape", "meta-ads-scrape"])
    expect(body.nodes.hiddenFromUsers).toEqual([])
    errors.mockRestore()
  })

  it("Web Scrape's Instagram source follows the Instagram node — denied for a user, marked for an admin", async () => {
    expect((await get(USER)).json().webScrapeSources).toEqual({ denied: [], hiddenFromUsers: [] })

    hideScrapers()
    expect((await get(USER)).json().webScrapeSources).toEqual({ denied: ["instagram"], hiddenFromUsers: [] })
    expect((await get(ADMIN)).json().webScrapeSources).toEqual({ denied: [], hiddenFromUsers: ["instagram"] })
  })

  it("is never shared-cacheable — the answer depends on who asked", async () => {
    const res = await get(ADMIN)
    expect(res.headers["cache-control"]).toBe("private, no-store")
  })
})
