import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * POST /v1/generate-image and POST /v1/image-to-image judge the model they
 * RUN on — the one named, or the default the route fills in for a request
 * that names none (by aspect ratio) — against the deployment's model
 * restriction, before any job or reservation.
 *
 * The handler gives a request with no `provider` the platform's default AFTER
 * the credit guard, and the guard's own id is a pricing composite
 * (`gpt-image-2-6-sunburst:medium:1K`) that no allowlist names. So a direct
 * API, SDK or MCP call that left the model out ran a model the deployment
 * withheld. This mounts the REAL routes with the REAL creditGuard (business
 * edition: the surface profile applies, the cloud credit impl never loads).
 */

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "business", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isBusiness: () => true,
  isCloud: () => false,
  isCommunity: () => false,
  hasCredits: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn(), auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) } },
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "q-1" }) }, redis: {} }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
// No network: an edit's "auto" ratio would read the photo's size.
vi.mock("@/lib/fetch-own-media.js", () => ({
  fetchOwnMedia: vi.fn(async () => new Response("gone", { status: 404 })),
  isOwnMediaUrl: () => false,
}))

import { generateImageRoutes } from "../generate-image.js"
import { imageToImageRoutes } from "../image-to-image.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { defaultImageModel, IMAGE_MODEL_ROLE_DEFAULTS } from "@nodaro/shared/model-catalog"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

const USER = "00000000-0000-4000-8000-000000000001"
const IMAGE = "https://example.com/photo.png"

function setProfile(json: string | null): void {
  if (json === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = json
  __resetSurfaceProfileCacheForTests()
}
const allow = (...ids: string[]) => setProfile(JSON.stringify({ models: { allow: ids } }))

let app: FastifyInstance
let jobInsert: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.clearAllMocks()
  jobInsert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }) }) })
  vi.mocked(supabase.from).mockImplementation(((table: string) =>
    table === "jobs"
      ? { insert: jobInsert, update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) }
      : {}) as never)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  await app.register(async (instance) => {
    await generateImageRoutes(instance)
    await imageToImageRoutes(instance)
  })
  await app.ready()
})
afterEach(async () => {
  await app.close()
  setProfile(null)
})

const generate = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/generate-image", payload: { prompt: "a quiet harbour at dawn", userId: USER, ...payload } })
const edit = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/image-to-image", payload: { prompt: "make it night", imageUrl: IMAGE, userId: USER, ...payload } })

/** The `provider` the job was created with, or undefined when none was. */
const jobProvider = (): unknown => (jobInsert.mock.calls[0]?.[0] as { input_data?: { provider?: unknown } } | undefined)?.input_data?.provider

function expectRefused(res: Awaited<ReturnType<typeof generate>>, model: string): void {
  expect(res.statusCode).toBe(403)
  expect(res.json().error.code).toBe("model_not_available")
  expect(res.json().error.message).toContain(model)
  expect(jobInsert).not.toHaveBeenCalled()
  expect(videoQueue.add).not.toHaveBeenCalled()
}

describe("the defaults these cases rely on", () => {
  it("4:5 and 5:4 move generate-image's default off the role's model; 9:8 moves image-to-image's", () => {
    expect(defaultImageModel("general")).toBe(IMAGE_MODEL_ROLE_DEFAULTS.general)
    expect(defaultImageModel("general", "4:5")).not.toBe(IMAGE_MODEL_ROLE_DEFAULTS.general)
    expect(defaultImageModel("general", "5:4")).not.toBe(IMAGE_MODEL_ROLE_DEFAULTS.general)
    expect(defaultImageModel("edit", "9:8")).not.toBe(IMAGE_MODEL_ROLE_DEFAULTS.edit)
  })
})

describe("POST /v1/generate-image — a request that names no model is judged as its default", () => {
  it("403 when models.allow does not hold the default", async () => {
    allow("nano-banana-pro")
    expectRefused(await generate({}), defaultImageModel("general"))
  })

  for (const ratio of ["4:5", "5:4"]) {
    it(`403 at ${ratio}: the ratio's own default is judged, not the role's model`, async () => {
      const ratioDefault = defaultImageModel("general", ratio)
      allow(IMAGE_MODEL_ROLE_DEFAULTS.general)
      expectRefused(await generate({ aspectRatio: ratio }), ratioDefault)
    })

    it(`runs at ${ratio} when the allowlist holds that default`, async () => {
      allow(defaultImageModel("general", ratio))
      const res = await generate({ aspectRatio: ratio })
      expect(res.statusCode).toBe(200)
      expect(jobProvider()).toBe(defaultImageModel("general", ratio))
    })
  }

  it("403 for a `count` batch that names no model", async () => {
    allow("nano-banana-pro")
    expectRefused(await generate({ count: 2 }), defaultImageModel("general"))
  })

  it("403 when models.deny names the default", async () => {
    setProfile(JSON.stringify({ models: { deny: [defaultImageModel("general")] } }))
    expectRefused(await generate({}), defaultImageModel("general"))
  })

  it("a named model the allowlist holds runs, though the default is withheld", async () => {
    allow("nano-banana-pro")
    const res = await generate({ provider: "nano-banana-pro" })
    expect(res.statusCode).toBe(200)
    expect(jobProvider()).toBe("nano-banana-pro")
  })

  it("a named model the allowlist does not hold is refused, as before", async () => {
    allow(defaultImageModel("general"))
    expectRefused(await generate({ provider: "nano-banana-pro" }), "nano-banana-pro")
  })
})

describe("POST /v1/image-to-image — a request that names no model is judged as its default", () => {
  it("403 when models.allow does not hold the edit default", async () => {
    allow("nano-banana-pro")
    expectRefused(await edit({}), defaultImageModel("edit"))
  })

  it("403 at 9:8: the ratio's own edit default is judged", async () => {
    allow(IMAGE_MODEL_ROLE_DEFAULTS.edit)
    expectRefused(await edit({ aspectRatio: "9:8" }), defaultImageModel("edit", "9:8"))
  })

  it("runs when the allowlist holds the edit default", async () => {
    allow(defaultImageModel("edit"))
    const res = await edit({})
    expect(res.statusCode).toBe(200)
    expect(jobProvider()).toBe(defaultImageModel("edit"))
  })
})

describe("inert without a model restriction — what runs is what ran before", () => {
  it("generate-image: no profile → the default runs, the 4:5 default at 4:5", async () => {
    setProfile(null)
    expect((await generate({})).statusCode).toBe(200)
    expect(jobProvider()).toBe(defaultImageModel("general"))
    jobInsert.mockClear()
    expect((await generate({ aspectRatio: "4:5" })).statusCode).toBe(200)
    expect(jobProvider()).toBe(defaultImageModel("general", "4:5"))
  })

  it("image-to-image: no profile → the edit default runs", async () => {
    setProfile(null)
    expect((await edit({})).statusCode).toBe(200)
    expect(jobProvider()).toBe(defaultImageModel("edit"))
  })

  it("a nodes-only profile changes nothing for either route", async () => {
    setProfile(JSON.stringify({ nodes: { deny: ["generate-video"] } }))
    expect((await generate({})).statusCode).toBe(200)
    expect((await edit({})).statusCode).toBe(200)
  })
})
