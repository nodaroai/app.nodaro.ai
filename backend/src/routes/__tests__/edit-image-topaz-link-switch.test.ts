/**
 * The size-priced upscaler (Topaz) and the deployment's link-import switch on
 * a deployment with no credits (Business): the switch is asked in every
 * edition, whether or not the run reads the picture's size for a price. With
 * links off, an outside link is refused before anything is read or created,
 * as every other lane that takes an outside link refuses it; with links on,
 * the run starts and nothing reads the link here (no price to size).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn(), auth: { getUser: vi.fn() } } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) }, redis: {} }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn(async () => false) }))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/config.js")>()
  return {
    ...actual,
    config: { ...actual.config, EDITION: "business" },
    isCloud: () => false,
    hasCredits: () => false,
    isCommunity: () => false,
    isBusiness: () => true,
    hasAdmin: () => true,
  }
})
vi.mock("@/lib/image-source-size.js", () => ({
  probeImageDisplaySize: vi.fn(async () => ({ width: 1024, height: 1024 })),
  sourceImageForAutoAspect: vi.fn(async () => undefined),
}))

import { editImageRoutes } from "../edit-image.js"
import { stampTopazImageSize } from "../../lib/topaz-image-size.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { probeImageDisplaySize } from "../../lib/image-source-size.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { isBusiness } from "../../lib/config.js"

const USER = "00000000-0000-4000-8000-000000000001"
const OUTSIDE = "https://cdn.example/photo.png"
const insert = vi.fn()
let app: FastifyInstance

function linksOff(off: boolean): void {
  if (off) process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ imports: { links: false } })
  else delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
}

beforeEach(async () => {
  vi.clearAllMocks()
  insert.mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }) }) })
  // The row's insert, and the reservation step's stamp of its fingerprint.
  vi.mocked(supabase.from).mockReturnValue({ insert, update: () => ({ eq: async () => ({ data: null, error: null }) }) } as never)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
    req.authKind = "jwt"
  })
  await app.register(async (instance) => {
    await editImageRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  linksOff(false)
  await app.close()
})

const topaz = { provider: "topaz-image-upscale", imageUrl: OUTSIDE, upscaleFactor: "2" }

describe("Topaz on a Business deployment", () => {
  it("is a Business deployment with no credits", () => {
    expect(isBusiness()).toBe(true)
  })

  it("links off: an outside link is refused (403 link_imports_disabled) before anything is read or created", async () => {
    linksOff(true)
    const res = await app.inject({ method: "POST", url: "/v1/edit-image", payload: topaz })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("link_imports_disabled")
    expect(probeImageDisplaySize).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("links on: the run starts, and nothing reads the link here (there is no price to size)", async () => {
    linksOff(false)
    const res = await app.inject({ method: "POST", url: "/v1/edit-image", payload: topaz })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json().jobId).toBe("job-1")
    expect(probeImageDisplaySize).not.toHaveBeenCalled()
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
  })

  it("the workflow run's stamp: links off refuses with the switch's code, links on passes untouched", async () => {
    linksOff(true)
    expect(await stampTopazImageSize("edit-image", topaz, false)).toEqual({ ok: false, code: "link_imports_disabled", message: expect.stringContaining("turned off") })
    linksOff(false)
    expect(await stampTopazImageSize("edit-image", topaz, false)).toEqual({ ok: true, patch: {} })
    expect(probeImageDisplaySize).not.toHaveBeenCalled()
  })

  it("another edit model's outside link is not this check's to refuse", async () => {
    linksOff(true)
    const res = await app.inject({ method: "POST", url: "/v1/edit-image", payload: { provider: "recraft-upscale", imageUrl: OUTSIDE } })
    expect(res.statusCode, res.body).toBe(200)
  })
})
