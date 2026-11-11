import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * The node allowlist on routes whose node is not their path.
 *
 * `creditGuard` asks the availability funnel about the node a route runs
 * (lib/route-node-gate.ts). It used to ask about the path minus `/v1/`, so
 * `POST /v1/suno/generate` was checked as `suno/generate` — a name no allowlist
 * holds — and ran on a deployment that had withdrawn Suno, and `POST /v1/cast-swap`
 * (Nodaro Motion; every trend run) was refused by nothing at all.
 *
 * The REAL creditGuard on minimal routes mounted at the REAL paths (the node
 * key is `req.routeOptions.url`, the route pattern). Business edition, no
 * credits: the surface profile applies and the ee impl never loads, so the
 * availability check is the only thing that can 403.
 */

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "business" },
  isBusiness: () => true,
  isCloud: () => false,
  isCommunity: () => false,
  hasCredits: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

const admins = vi.hoisted(() => ({ ids: new Set<string>() }))
/** Every handler that ran — a refusal must stop the request before it. */
const ran = vi.hoisted(() => ({ urls: [] as string[] }))
vi.mock("@/lib/admin-check.js", () => ({ checkIsAdmin: async (userId: string) => admins.ids.has(userId) }))

// The node universe the funnel inverts over; the real registry drags the whole
// credits graph in behind this file's config stub.
vi.mock("@/lib/node-registry.js", () => ({
  NODE_REGISTRY: [
    { type: "generate-image", category: "ai-image" },
    { type: "suno-generate", category: "ai-audio" },
    { type: "upscale-image", category: "ai-image" },
    { type: "modify-image", category: "ai-image" },
    { type: "remove-background", category: "ai-image" },
    { type: "instagram-post", category: "output" },
    { type: "tiktok-post", category: "output" },
    { type: "publish-social", category: "output" },
    { type: "pitch-tempo", category: "processing" },
  ],
}))

import { creditGuard } from "../../middleware/credit-guard.js"
import { requireNodeAvailable } from "../../lib/availability-viewer.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import {
  __resetAvailabilityOverridesForTests,
  __availabilityUniverseReadyForTests,
  storedNodesEnabled,
} from "../../lib/availability-override.js"

const USER = "00000000-0000-4000-8000-000000000001"
const ADMIN = "00000000-0000-4000-8000-0000000000ad"

const ROUTES = [
  "/v1/generate-image",
  "/v1/suno/generate",
  "/v1/cast-swap",
  "/v1/edit-image",
  "/v1/social/publish",
  "/v1/pitch-tempo",
  "/v1/copilot/threads/:id/messages",
  "/v1/brand-new/thing",
  "/v1/another-new/thing",
  // The Video Director and a pipeline scene's regeneration: gateable features
  // with no canvas node (lib/availability-override.ts), once exempt.
  "/v1/video-director/run",
  "/v1/pipelines/:id/stages/script/regenerate-scene",
] as const

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    ;(req as { userId?: string }).userId = (req.headers["x-test-user"] as string | undefined) ?? USER
  })
  for (const url of ROUTES) {
    app.post(url, { preHandler: creditGuard(() => "credit-id") }, async (req) => {
      ran.urls.push(req.url)
      return { ok: true }
    })
  }
  // A trend run: composed by the platform and dispatched to Nodaro Motion, so
  // its route asks cast-swap's availability itself (ee/routes/trends.ts).
  app.post("/v1/trends/:slug/runs", { preHandler: requireNodeAvailable("cast-swap") }, async (req) => {
    ran.urls.push(req.url)
    return { ok: true }
  })
  // A guard run INSIDE the handler, as the Cloud plugin runs this route's.
  app.post("/v1/cast-swap/:jobId/full-quality", async (req, reply) => {
    await creditGuard(() => "credit-id")(req, reply)
    if (reply.sent) return reply
    ran.urls.push(req.url)
    return { ok: true }
  })
  await app.ready()
  return app
}

function setProfile(profile: object | null): void {
  if (profile === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
}

const post = (url: string, payload: object = {}, user = USER) =>
  app.inject({ method: "POST", url, headers: { "x-test-user": user }, payload })

let app: FastifyInstance
beforeAll(() => __availabilityUniverseReadyForTests())
beforeEach(async () => {
  admins.ids = new Set([ADMIN])
  ran.urls = []
  app = await buildApp()
})
afterEach(async () => {
  await app.close()
  setProfile(null)
  __resetAvailabilityOverridesForTests()
})

describe("a deployment with no allow/deny lists and no override (Nodaro cloud): nothing changes", () => {
  for (const url of ["/v1/suno/generate", "/v1/cast-swap", "/v1/cast-swap/abc/full-quality", "/v1/edit-image", "/v1/brand-new/thing"]) {
    it(`${url} runs`, async () => {
      const res = await post(url, { platform: "instagram" })
      expect(res.statusCode).toBe(200)
    })
  }
})

describe("nodes.allow is the server-side on-switch for nested routes too", () => {
  beforeEach(() => setProfile({ nodes: { allow: ["generate-image"] } }))

  it("refuses POST /v1/suno/generate when suno-generate is not allowed (it was checked as `suno/generate`)", async () => {
    const res = await post("/v1/suno/generate")
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatchObject({ code: "node_not_available" })
    expect(res.json().error.message).toContain("suno-generate")
    expect(ran.urls).toEqual([])
  })

  it("refuses Nodaro Motion — the route, its nested routes and a guard run inside a handler", async () => {
    for (const url of ["/v1/cast-swap", "/v1/cast-swap/abc/full-quality"]) {
      const res = await post(url)
      expect(res.statusCode, url).toBe(403)
      expect(res.json().error.message, url).toContain("cast-swap")
    }
  })

  it("refuses Edit Image as the node its provider makes it", async () => {
    const res = await post("/v1/edit-image", { provider: "recraft-remove-bg" })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.message).toContain("remove-background")
  })

  it("refuses a credit-spending route linked to no node: the whitelist never allowed it — and says so once", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await post("/v1/another-new/thing")
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("node_not_available")
    await post("/v1/another-new/thing")
    expect(errors).toHaveBeenCalledTimes(1)
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("/v1/another-new/thing"))
    errors.mockRestore()
  })

  it("lets a documented exemption through", async () => {
    const res = await post("/v1/copilot/threads/t1/messages")
    expect(res.statusCode).toBe(200)
  })

  it("runs what the list allows", async () => {
    setProfile({ nodes: { allow: ["generate-image", "suno-generate", "cast-swap", "upscale-image"] } })
    for (const [url, body] of [
      ["/v1/suno/generate", {}],
      ["/v1/cast-swap", {}],
      ["/v1/cast-swap/abc/full-quality", {}],
      ["/v1/edit-image", { provider: "recraft-upscale" }],
    ] as const) {
      const res = await post(url, body)
      expect(res.statusCode, url).toBe(200)
    }
    expect((await post("/v1/edit-image", { provider: "nano-banana-edit" })).statusCode).toBe(403)
  })
})

describe("nodes.deny names the node, whatever its route", () => {
  it("a deny of suno-generate refuses /v1/suno/generate", async () => {
    setProfile({ nodes: { deny: ["suno-generate"] } })
    expect((await post("/v1/suno/generate")).statusCode).toBe(403)
    expect((await post("/v1/generate-image")).statusCode).toBe(200)
  })
})

describe("Publish to Social runs as the platform's own node OR the unified one", () => {
  it("is let through when either is allowed", async () => {
    setProfile({ nodes: { allow: ["publish-social"] } })
    expect((await post("/v1/social/publish", { platform: "instagram" })).statusCode).toBe(200)
    setProfile({ nodes: { allow: ["instagram-post"] } })
    expect((await post("/v1/social/publish", { platform: "instagram" })).statusCode).toBe(200)
    expect((await post("/v1/social/publish", { platform: "tiktok" })).statusCode).toBe(403)
  })
})

describe("an override stored BEFORE these gates existed decides none of them", () => {
  // Saved by an older build: an enabled-set with no gating generation, that
  // never listed cast-swap (it was not gateable) and left suno-generate off.
  const legacyOverride = () => __resetAvailabilityOverridesForTests({ nodes: new Set(["generate-image", "upscale-image"]) })

  it("keeps Nodaro Motion running for users (cast-swap falls back to the factory set)", async () => {
    legacyOverride()
    expect((await post("/v1/cast-swap")).statusCode).toBe(200)
    expect((await post("/v1/cast-swap/abc/full-quality")).statusCode).toBe(200)
  })

  it("keeps a nested route it never decided running, exactly as the path derivation did", async () => {
    legacyOverride()
    expect((await post("/v1/suno/generate")).statusCode).toBe(200)
  })

  it("still withholds a top-level route it did decide: the release switch is unchanged", async () => {
    legacyOverride()
    const res = await post("/v1/pitch-tempo")
    expect(res.statusCode).toBe(403)
    expect(res.json().error.message).toContain("pitch-tempo")
  })

  it("under a whitelist the factory set refuses what it never allowed, override or not", async () => {
    setProfile({ nodes: { allow: ["generate-image"] } })
    legacyOverride()
    expect((await post("/v1/cast-swap")).statusCode).toBe(403)
    expect((await post("/v1/suno/generate")).statusCode).toBe(403)
  })
})

describe("an override saved by this code decides every gate it showed", () => {
  it("withholds cast-swap and the nested route from users when they were left off", async () => {
    __resetAvailabilityOverridesForTests({ nodes: new Set(storedNodesEnabled(["generate-image"])) })
    expect((await post("/v1/cast-swap")).statusCode).toBe(403)
    expect((await post("/v1/suno/generate")).statusCode).toBe(403)
    // The admin switch hides from users, not from admins.
    expect((await post("/v1/cast-swap", {}, ADMIN)).statusCode).toBe(200)
    expect((await post("/v1/suno/generate", {}, ADMIN)).statusCode).toBe(200)
  })

  it("releases them when they were ticked — even past a whitelist that lacks them (the override replaces it)", async () => {
    setProfile({ nodes: { allow: ["generate-image"] } })
    __resetAvailabilityOverridesForTests({ nodes: new Set(storedNodesEnabled(["generate-image", "cast-swap", "suno-generate"])) })
    expect((await post("/v1/cast-swap")).statusCode).toBe(200)
    expect((await post("/v1/suno/generate")).statusCode).toBe(200)
  })
})

describe("a trend run follows cast-swap, as Nodaro Motion's own route does", () => {
  it("is refused where cast-swap is not offered — before the run starts — and runs where it is", async () => {
    expect((await post("/v1/trends/dance/runs")).statusCode).toBe(200)
    expect(ran.urls).toEqual(["/v1/trends/dance/runs"])
    setProfile({ nodes: { allow: ["generate-image"] } })
    const res = await post("/v1/trends/dance/runs")
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatchObject({ code: "node_not_available" })
    expect(res.json().error.message).toContain("cast-swap")
    expect(ran.urls).toEqual(["/v1/trends/dance/runs"])
    setProfile({ nodes: { allow: ["cast-swap"] } })
    expect((await post("/v1/trends/dance/runs")).statusCode).toBe(200)
  })

  it("keeps running under an override stored before cast-swap was gateable", async () => {
    __resetAvailabilityOverridesForTests({ nodes: new Set(["generate-image"]) })
    expect((await post("/v1/trends/dance/runs")).statusCode).toBe(200)
  })

  it("is withheld from users, not admins, by an override saved with cast-swap off", async () => {
    __resetAvailabilityOverridesForTests({ nodes: new Set(storedNodesEnabled(["generate-image"])) })
    expect((await post("/v1/trends/dance/runs")).statusCode).toBe(403)
    expect((await post("/v1/trends/dance/runs", {}, ADMIN)).statusCode).toBe(200)
  })
})

describe("the Video Director and a pipeline's scene regeneration follow their features (once exempt)", () => {
  const DIRECTOR = "/v1/video-director/run"
  const REGENERATE = "/v1/pipelines/p1/stages/script/regenerate-scene"

  it("run on a deployment with no lists and no override", async () => {
    expect((await post(DIRECTOR)).statusCode).toBe(200)
    expect((await post(REGENERATE)).statusCode).toBe(200)
  })

  it("are refused under nodes.allow without their ids — node_not_available, before the handler", async () => {
    setProfile({ nodes: { allow: ["generate-image", "cast-swap"] } })
    for (const [url, id] of [[DIRECTOR, "video-director"], [REGENERATE, "film-pipeline"]] as const) {
      const res = await post(url)
      expect(res.statusCode, url).toBe(403)
      expect(res.json().error, url).toMatchObject({ code: "node_not_available" })
      expect(res.json().error.message, url).toContain(id)
    }
    expect(ran.urls).toEqual([])
  })

  it("run where the list names them", async () => {
    setProfile({ nodes: { allow: ["generate-image", "video-director", "film-pipeline"] } })
    expect((await post(DIRECTOR)).statusCode).toBe(200)
    expect((await post(REGENERATE)).statusCode).toBe(200)
  })

  it("follow a deny entry of their own id", async () => {
    setProfile({ nodes: { deny: ["video-director"] } })
    expect((await post(DIRECTOR)).statusCode).toBe(403)
    expect((await post(REGENERATE)).statusCode).toBe(200)
  })

  it("keep running under an override stored before they were gateable (generation 1 or none)", async () => {
    __resetAvailabilityOverridesForTests({ nodes: new Set(storedNodesEnabled(["generate-image", "cast-swap"], 1)) })
    expect((await post(DIRECTOR)).statusCode).toBe(200)
    expect((await post(REGENERATE)).statusCode).toBe(200)
    __resetAvailabilityOverridesForTests({ nodes: new Set(["generate-image"]) })
    expect((await post(DIRECTOR)).statusCode).toBe(200)
    expect((await post(REGENERATE)).statusCode).toBe(200)
  })

  it("are withheld from users, not admins, by an override saved by this code with them off", async () => {
    __resetAvailabilityOverridesForTests({ nodes: new Set(storedNodesEnabled(["generate-image"])) })
    expect((await post(DIRECTOR)).statusCode).toBe(403)
    expect((await post(REGENERATE)).statusCode).toBe(403)
    expect((await post(DIRECTOR, {}, ADMIN)).statusCode).toBe(200)
    expect((await post(REGENERATE, {}, ADMIN)).statusCode).toBe(200)
  })
})
