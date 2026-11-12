/**
 * Topaz video upscale and the deployment's link-import switch, on a deployment
 * with credits (Cloud) and one without (Business): every place the lane reads
 * a clip's link asks the switch first, in every edition — the route (and so
 * the quote, which runs the route's pre-checks), the workflow run's stamp and
 * the worker. With links off, a link to another site is refused before
 * anything is read, created or held; a clip on this deployment's own storage
 * still runs. With links on, nothing changes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const ed = vi.hoisted(() => ({ cloud: true }))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/config.js")>()
  return {
    ...actual,
    get config() { return { ...actual.config, EDITION: ed.cloud ? "cloud" : "business" } },
    isCloud: () => ed.cloud,
    hasCredits: () => ed.cloud,
    isCommunity: () => false,
    isBusiness: () => !ed.cloud,
    hasAdmin: () => true,
  }
})
vi.mock("@/lib/url-validator.js", async () => ({ safeUrlSchema: (await import("zod")).z.string().url() }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn(), auth: { getUser: vi.fn() } } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) }, redis: {} }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn(async () => false) }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: vi.fn(async () => ({ data: { id: "job-1" }, error: null })) }))
// The guard is not this test's subject: the switch is asked in the route's pre-check, before it.
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn(async () => ({ usageLogId: "usage-1", creditsReserved: 1, watermark: false })),
}))
// Reading the clip: what the lane measures before anything is held.
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../providers/video/ffmpeg-utils.js")>()),
  probeVideoSource: vi.fn(async () => ({ width: 1280, height: 720, durationSeconds: 5, videoDurationSeconds: 5, fps: 30 })),
}))
// The worker's call to the model.
vi.mock("@/providers/replicate/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../providers/replicate/client.js")>()),
  runReplicatePrediction: vi.fn(async () => ({ output: "https://out.example/v.mp4", metrics: {} })),
}))

import { videoUpscaleRoutes } from "../video-upscale.js"
import { stampTopazVideoUpscale } from "../../lib/topaz-video-plan.js"
import { runTopazVideoUpscale } from "../../providers/replicate/topaz.js"
import { runReplicatePrediction } from "../../providers/replicate/client.js"
import { probeVideoSource } from "../../providers/video/ffmpeg-utils.js"
import { insertJob } from "../../lib/insert-job.js"
import { videoQueue } from "../../lib/queue.js"
import { LinkImportsDisabledError, LINK_IMPORTS_DISABLED_MESSAGE } from "../../lib/link-imports.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

const USER = "00000000-0000-4000-8000-000000000001"
const OUTSIDE = "https://cdn.example/clip.mp4"
const OWN_STORAGE = "https://media.nodaro.test"
const OWN = `${OWN_STORAGE}/uploads/videos/clip.mp4`
let app: FastifyInstance
const savedR2 = process.env.R2_PUBLIC_URL

function linksOff(off: boolean): void {
  if (off) process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ imports: { links: false } })
  else delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
}

async function boot(): Promise<void> {
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
    req.authKind = "jwt"
  })
  await app.register(async (instance) => {
    await videoUpscaleRoutes(instance)
  })
  await app.ready()
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.R2_PUBLIC_URL = OWN_STORAGE
})

afterEach(async () => {
  linksOff(false)
  if (savedR2 === undefined) delete process.env.R2_PUBLIC_URL
  else process.env.R2_PUBLIC_URL = savedR2
  await app?.close()
})

const topaz = (videoUrl: string) => ({ provider: "topaz", videoUrl, targetResolution: "1080p", targetFps: 30 })

describe.each([["Cloud", true], ["Business", false]] as const)("%s", (_edition, cloud) => {
  beforeEach(async () => {
    ed.cloud = cloud
    await boot()
  })

  it("links off: a link to another site is refused (403 link_imports_disabled) before anything is read, created or held", async () => {
    linksOff(true)
    const res = await app.inject({ method: "POST", url: "/v1/video-upscale", payload: topaz(OUTSIDE) })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toEqual({ code: "link_imports_disabled", message: LINK_IMPORTS_DISABLED_MESSAGE })
    expect(probeVideoSource).not.toHaveBeenCalled()
    expect(insertJob).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("links off: a clip on this deployment's own storage still runs", async () => {
    linksOff(true)
    const res = await app.inject({ method: "POST", url: "/v1/video-upscale", payload: topaz(OWN) })
    expect(res.statusCode, res.body).toBe(200)
    expect(probeVideoSource).toHaveBeenCalledTimes(1)
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
  })

  it("links on: a link to another site runs as before, measured first", async () => {
    linksOff(false)
    const res = await app.inject({ method: "POST", url: "/v1/video-upscale", payload: topaz(OUTSIDE) })
    expect(res.statusCode, res.body).toBe(200)
    expect(probeVideoSource).toHaveBeenCalledWith(OUTSIDE)
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
  })

  it("the workflow run's stamp: links off refuses with the switch's code and reads nothing; own storage and links on pass", async () => {
    linksOff(true)
    expect(await stampTopazVideoUpscale("video-upscale", topaz(OUTSIDE))).toEqual({
      ok: false,
      refusal: { code: "link_imports_disabled", message: LINK_IMPORTS_DISABLED_MESSAGE },
    })
    expect(probeVideoSource).not.toHaveBeenCalled()
    expect((await stampTopazVideoUpscale("video-upscale", topaz(OWN))).ok).toBe(true)
    linksOff(false)
    expect((await stampTopazVideoUpscale("video-upscale", topaz(OUTSIDE))).ok).toBe(true)
  })

  it("the worker: links off refuses a queued job's outside link, final, before the clip is read or sent; own storage and links on run", async () => {
    linksOff(true)
    await expect(runTopazVideoUpscale(OUTSIDE, { targetResolution: "1080p", targetFps: 30 })).rejects.toBeInstanceOf(LinkImportsDisabledError)
    expect(runReplicatePrediction).not.toHaveBeenCalled()
    await runTopazVideoUpscale(OWN, { targetResolution: "1080p", targetFps: 30 })
    linksOff(false)
    await runTopazVideoUpscale(OUTSIDE, { targetResolution: "1080p", targetFps: 30 })
    expect(runReplicatePrediction).toHaveBeenCalledTimes(2)
  })
})
