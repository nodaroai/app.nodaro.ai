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
    { type: "text-to-video", category: "ai-video" },
    { type: "suno-generate", category: "ai-audio" },
    { type: "voice-changer-pro", category: "ai-audio" },
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

import { WORLD_IDS } from "@nodaro/shared/runtime-config"
import { surfaceAvailabilityRoutes } from "../surface-availability.js"
import {
  __resetAvailabilityOverridesForTests,
  __availabilityUniverseReadyForTests,
  GATEABLE_MODEL_IDS,
} from "../../lib/availability-override.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { __resetModelSwitchForTests } from "../../lib/model-switch.js"
import { ownLabelModelIds } from "../../lib/house-models-served.js"
import { serveEveryHouseModel, serveNoHouseModel } from "../../test/house-models.js"

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

/** Every node type of the mocked registry. */
const ALL_NODES = ["text-prompt", "generate-image", "generate-video", "text-to-video", "suno-generate", "voice-changer-pro", "instagram-scrape", "meta-ads-scrape", "web-scrape"]
const SCRAPERS = ["instagram-scrape", "meta-ads-scrape"]

/** The production shape: everything on except the two scrapers. */
const hideScrapers = () => __resetAvailabilityOverridesForTests({ nodes: new Set(ALL_NODES.filter((t) => !SCRAPERS.includes(t))) })

describe("GET /v1/surface/availability", () => {
  // A stock install serves no house model: the catalog's one is hidden, and is
  // no restriction — it withholds only itself.
  it("stock deployment: nothing denied but the unserved house model, nothing hidden, no restriction, for anyone", async () => {
    for (const who of [USER, ADMIN]) {
      const body = (await get(who)).json()
      expect(body.nodes).toEqual({ denied: [], hiddenFromUsers: [] })
      expect(body.models).toEqual({ denied: [...ownLabelModelIds()], restricted: false })
    }
    expect([...ownLabelModelIds()]).toContain("nodaro-image-upscale")
  })

  it("a model the admin switched off on its pricing row is denied for everyone — admins too", async () => {
    __resetModelSwitchForTests(["flux-flex"])
    for (const who of [USER, ADMIN]) {
      const body = (await get(who)).json()
      expect([...body.models.denied].sort()).toEqual(["flux-flex", ...ownLabelModelIds()].sort())
      expect(body.models.restricted).toBe(false)
    }
  })

  it("a deployment that serves its house models lists none of them as denied", async () => {
    serveEveryHouseModel()
    try {
      expect((await get(USER)).json().models).toEqual({ denied: [], restricted: false })
    } finally {
      serveNoHouseModel()
    }
  })

  // `restricted` is what the editor reads to decide whether a new node may start
  // on another model than its default; a switched-off row alone is no restriction.
  it("says whether the deployment restricts models — never for a switched-off row alone", async () => {
    __resetModelSwitchForTests(["flux-flex"])
    expect((await get(USER)).json().models.restricted).toBe(false)

    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { allow: ["flux-flex"] } })
    __resetSurfaceProfileCacheForTests()
    expect((await get(USER)).json().models.restricted).toBe(true)

    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { deny: ["gpt-image-2"] } })
    __resetSurfaceProfileCacheForTests()
    expect((await get(ADMIN)).json().models.restricted).toBe(true)
  })

  it("a models override restricts only when it leaves a gateable model off", async () => {
    __resetAvailabilityOverridesForTests({ models: new Set(GATEABLE_MODEL_IDS) })
    expect((await get(USER)).json().models.restricted).toBe(false)

    __resetAvailabilityOverridesForTests({ models: new Set([...GATEABLE_MODEL_IDS].filter((id) => id !== "flux-flex")) })
    const body = (await get(USER)).json()
    expect(body.models.restricted).toBe(true)
    expect(body.models.denied).toContain("flux-flex")
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
    __resetAvailabilityOverridesForTests({ nodes: new Set(ALL_NODES.filter((t) => t !== "generate-video" && !SCRAPERS.includes(t))) })
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

describe("GET /v1/surface/availability — worlds", () => {
  type World = { id: string; enabled: boolean }
  const worldsOf = async (who?: string): Promise<World[]> => (await get(who)).json().worlds
  const enabled = (worlds: World[]) => worlds.filter((w) => w.enabled).map((w) => w.id)
  const setProfile = (profile: unknown) => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
    __resetSurfaceProfileCacheForTests()
  }

  it("stock deployment: every world, in the shared header's order, enabled for anyone", async () => {
    for (const who of [undefined, USER, ADMIN]) {
      expect(await worldsOf(who)).toEqual(WORLD_IDS.map((id) => ({ id, enabled: true })))
    }
  })

  it("a world is off when a node type it runs is not offered — every one is required", async () => {
    setProfile({ nodes: { allow: ["generate-image", "text-to-video", "voice-changer-pro"] } })
    const worlds = await worldsOf(USER)
    // video also runs generate-video, which the allowlist leaves out; music runs suno-generate.
    expect(worlds.find((w) => w.id === "video")?.enabled).toBe(false)
    expect(worlds.find((w) => w.id === "music")?.enabled).toBe(false)
    expect(worlds.find((w) => w.id === "image")?.enabled).toBe(true)
    expect(worlds.find((w) => w.id === "voice")?.enabled).toBe(true)
    // Worlds that run no node of their own are untouched by the node lists.
    for (const id of ["explore", "app", "studio"]) expect(worlds.find((w) => w.id === id)?.enabled, id).toBe(true)
  })

  it("Trends and Motion follow Cast Swap: denying it turns both off", async () => {
    setProfile({ nodes: { deny: ["cast-swap"] } })
    const worlds = await worldsOf(USER)
    expect(worlds.find((w) => w.id === "trends")?.enabled).toBe(false)
    expect(worlds.find((w) => w.id === "motion")?.enabled).toBe(false)
    expect(worlds.find((w) => w.id === "video")?.enabled).toBe(true)
  })

  it("worlds.allow narrows by presence; order leads; worlds left out are still listed, off", async () => {
    setProfile({ worlds: { allow: ["image", "app"], order: ["app", "image"] } })
    const worlds = await worldsOf(USER)
    expect(worlds.map((w) => w.id)).toEqual(["app", "image", "explore", "video", "music", "trends", "motion", "voice", "studio"])
    expect(enabled(worlds)).toEqual(["app", "image"])

    setProfile({ worlds: { allow: [] } })
    expect(enabled(await worldsOf(USER))).toEqual([])
  })

  it("both conditions hold: an allowed world whose node is not offered stays off", async () => {
    setProfile({ worlds: { allow: ["image", "video"] }, nodes: { deny: ["generate-video"] } })
    expect(enabled(await worldsOf(USER))).toEqual(["image"])
  })

  it("per viewer: a node the admin switch withholds from users turns its world off for a user, not for an admin", async () => {
    // Everything released except Voice Changer Pro.
    __resetAvailabilityOverridesForTests({ nodes: new Set(ALL_NODES.filter((t) => t !== "voice-changer-pro")) })
    expect((await worldsOf(USER)).find((w) => w.id === "voice")?.enabled).toBe(false)
    expect((await worldsOf(ADMIN)).find((w) => w.id === "voice")?.enabled).toBe(true)
  })
})
