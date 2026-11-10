import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * The routes the Cloud plugin guards with the model and node checks alone
 * (since plugin 0.464.0), through the REAL credit guard at their REAL route
 * patterns: under a `nodes.allow` whitelist each runs when the node it follows
 * is listed, and is refused as that node when it is not. Before they were
 * mapped, a whitelist refused every one of them as a route linked to no node,
 * whatever it listed: a deployment offering Nodaro Motion could not make a
 * trend's face mask (the trend editor's own internal call).
 *
 * The plugin's guard prices on the free id with dedup off; the edition here
 * has no credits, so past the availability checks the guard is a no-op and a
 * 200 means exactly "the guard let it through".
 */

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    })),
  },
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: async () => false,
}))

vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/config.js")>()),
  hasCredits: () => false,
  isCloud: () => false,
  isBusiness: () => true,
  isCommunity: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/node-registry.js", () => ({
  NODE_REGISTRY: [
    { type: "generate-image", category: "ai-image" },
    { type: "generate-video", category: "ai-video" },
    { type: "generate-video-pro", category: "ai-video" },
  ],
}))

import { creditGuard } from "../credit-guard.js"
import { __availabilityUniverseReadyForTests, __resetAvailabilityOverridesForTests } from "../../lib/availability-override.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

/** Each route plugin 0.464.0 newly guards: its pattern, a URL it serves, and the node it follows. */
const NEWLY_GUARDED: ReadonlyArray<{ readonly pattern: string; readonly url: string; readonly node: string }> = [
  { pattern: "/v1/recast/revise", url: "/v1/recast/revise", node: "generate-video-pro" },
  { pattern: "/v1/recast/recommend", url: "/v1/recast/recommend", node: "generate-video-pro" },
  { pattern: "/v1/recast/:id/retake/revise", url: "/v1/recast/r1/retake/revise", node: "generate-video-pro" },
  { pattern: "/v1/recast/:id/plan", url: "/v1/recast/r1/plan", node: "generate-video-pro" },
  { pattern: "/v1/cast-swap/face-mask", url: "/v1/cast-swap/face-mask", node: "cast-swap" },
  {
    pattern: "/v1/studio/productions/:id/sequences/:sequenceId/takes/:takeId/units/:unitId/generate",
    url: "/v1/studio/productions/p1/sequences/s1/takes/t1/units/u1/generate",
    node: "generate-video",
  },
]

let app: FastifyInstance

function useProfile(profile: unknown): void {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
}

beforeAll(async () => {
  await __availabilityUniverseReadyForTests()
  __resetAvailabilityOverridesForTests()
  app = Fastify({ logger: false })
  for (const { pattern } of NEWLY_GUARDED) {
    // The plugin's guard for these routes: the free id, dedup off, its own run model.
    app.post(pattern, { preHandler: creditGuard(() => "ffmpeg", { dedup: false, runModel: () => undefined }) }, async () => ({ ran: true }))
  }
  await app.ready()
})

afterEach(() => {
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

afterAll(async () => {
  await app?.close()
})

const post = (url: string) => app.inject({ method: "POST", url, payload: {} })

describe("the routes plugin 0.464.0 newly guards follow their nodes under nodes.allow", () => {
  it.each(NEWLY_GUARDED)("$pattern runs where $node is listed", async ({ url, node }) => {
    useProfile({ nodes: { allow: [node] } })
    const res = await post(url)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ran: true })
  })

  it.each(NEWLY_GUARDED)("$pattern is refused as $node where it is not listed", async ({ url, node }) => {
    useProfile({ nodes: { allow: ["generate-image"] } })
    const res = await post(url)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("node_not_available")
    // Refused as its node, never as a route linked to no node.
    expect(res.json().error.message).toContain(node)
    expect(res.json().error.message).not.toMatch(/linked to no node/)
  })

  it.each(NEWLY_GUARDED)("$pattern is refused where $node is denied", async ({ url, node }) => {
    useProfile({ nodes: { deny: [node] } })
    const res = await post(url)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("node_not_available")
  })

  it("a deployment that restricts nothing runs every one, exactly as before", async () => {
    for (const { url } of NEWLY_GUARDED) {
      const res = await post(url)
      expect(res.statusCode, url).toBe(200)
    }
  })
})
