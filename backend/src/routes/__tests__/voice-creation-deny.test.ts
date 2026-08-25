import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// B4c — the three voice-CREATION routes (clone/design/remix) reuse B1's
// nodes.deny. These direct routes create jobs WITHOUT passing a workflow write
// guard, so B1's findDeniedNodeTypes never sees them — the guard is added at the
// top of each handler. A deployment sets nodes.deny to remove the capability.
// (The MCP tools reach these routes via dispatchJob, which surfaces the route's
// 403 as an MCP error — so the route is the single chokepoint for MCP too.)

vi.mock("@/lib/config.js", () => ({
  // Business edition → surfaceGateOpen() true → the nodes.deny profile applies.
  config: { EDITION: "business", ELEVENLABS_API_KEY: "test-key" },
  isBusiness: () => true,
  isCloud: () => false,
  hasCredits: () => true,
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "u-1" }),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }) }))
// voice-design / voice-remix dispatch to BullMQ on the success path via
// videoQueue.add(...). queue.js eagerly constructs a real IORedis-backed Queue
// at module load, so without this mock the "proceeds past the guard" test hangs
// on unavailable Redis until the 5s timeout. Stub the whole module (the routes
// import only videoQueue; redis/tryRemoveFromQueue stubbed for completeness).
vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue({ id: "q-1" }) },
  redis: { quit: vi.fn() },
  tryRemoveFromQueue: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/storage.js", () => ({ uploadBufferToR2: vi.fn() }))
vi.mock("@/lib/safe-fetch.js", () => ({ safeFetch: vi.fn() }))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

import { voiceCloneRoutes } from "../voice-clones.js"
import { voiceDesignRoutes } from "../voice-design.js"
import { voiceRemixRoutes } from "../voice-remix.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

const USER = "00000000-0000-4000-8000-000000000001"

async function buildApp(register: (app: FastifyInstance) => Promise<void>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") req.userId = body.userId
    else req.userId = USER // multipart routes carry no JSON body to read userId from
  })
  await app.register(async (instance) => {
    await register(instance)
  })
  await app.ready()
  return app
}

beforeEach(() => __resetSurfaceProfileCacheForTests())
afterEach(() => {
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

function denyAll() {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nodes: { deny: ["voice-clone", "voice-design", "voice-remix"] } })
  __resetSurfaceProfileCacheForTests()
}

describe("voice-creation routes honor B1 nodes.deny (B4c)", () => {
  it("refuses POST /v1/voice-clones/from-url when voice-clone is denied", async () => {
    denyAll()
    const app = await buildApp(voiceCloneRoutes)
    try {
      const res = await app.inject({
        method: "POST",
        url: "/v1/voice-clones/from-url",
        payload: { name: "x", audioUrl: "https://example.com/a.mp3", userId: USER },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe("node_not_available")
    } finally {
      await app.close()
    }
  })

  it("refuses POST /v1/voice-design when voice-design is denied", async () => {
    denyAll()
    const app = await buildApp(voiceDesignRoutes)
    try {
      const res = await app.inject({
        method: "POST",
        url: "/v1/voice-design",
        payload: { text: "a".repeat(120), voiceDescription: "warm narrator", userId: USER },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe("node_not_available")
    } finally {
      await app.close()
    }
  })

  it("refuses POST /v1/voice-remix when voice-remix is denied", async () => {
    denyAll()
    const app = await buildApp(voiceRemixRoutes)
    try {
      const res = await app.inject({
        method: "POST",
        url: "/v1/voice-remix",
        payload: { text: "remix this", voiceDescription: "warm narrator", userId: USER },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe("node_not_available")
    } finally {
      await app.close()
    }
  })

  it("is inert when nothing is denied — voice-design proceeds past the guard", async () => {
    // No profile → default (empty deny). The guard must NOT fire; the request
    // reaches the normal path (200 via the mocked insertJob).
    const app = await buildApp(voiceDesignRoutes)
    try {
      const res = await app.inject({
        method: "POST",
        url: "/v1/voice-design",
        payload: { text: "a".repeat(120), voiceDescription: "warm narrator", userId: USER },
      })
      expect(res.statusCode).not.toBe(403)
    } finally {
      await app.close()
    }
  })
})
