import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * Nodaro Motion's engine children move from `/v1/text-to-video` to
 * `/v1/generate-video`. This file proves the move changes nothing the engine
 * receives: one representative child body is sent through BOTH routes, each
 * route's queued payload is run through its REAL worker handler and the REAL
 * KIE provider, and the request KIE would get (`runKieTask`'s input) is
 * compared. Only the network edges are mocked: the KIE task call, the media
 * fetch / probe, storage, the DB and the queue.
 *
 * The router's provider choice is stood in for by the KIE provider itself
 * (both capabilities route these two models to KIE); the router's own glue —
 * `applyFrameFitAndDelivery` on the i2v lane, plain forwarding on t2v — is
 * kept as the real calls below make it.
 */

const mocks = vi.hoisted(() => ({
  queueAdd: vi.fn(),
  reserve: vi.fn(),
  insert: vi.fn(),
  runKieTask: vi.fn(),
  safeFetch: vi.fn(),
  uploadToR2: vi.fn(),
  uploadVideoMaybeWatermark: vi.fn(),
  finalize: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: (row: unknown) => {
        mocks.insert(row)
        return { select: () => ({ single: async () => ({ data: { id: "00000000-0000-4000-8000-0000000000c1" }, error: null }) }) }
      },
      update: () => ({ eq: async () => ({ data: null, error: null }) }),
    })),
    auth: { getUser: vi.fn() },
  },
}))

vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mocks.queueAdd }, redis: {} }))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: mocks.reserve,
}))

vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

// The reference clip's probe (route prechecks): a fixed 8 s, the same on both lanes.
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/ffmpeg-utils.js")>()),
  probeMediaDuration: vi.fn(async () => 8),
}))

// KIE: the task call is the provider-bound request under test.
vi.mock("@/providers/kie/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/kie/client.js")>()),
  runKieTask: mocks.runKieTask,
}))
vi.mock("@/providers/kie/reference-video-size.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/kie/reference-video-size.js")>()),
  ensureVideoFitsSize: vi.fn(async (u: string) => u),
}))
// Reference images are downloaded and inspected: an already-fine 1024² JPEG.
vi.mock("@/lib/safe-fetch.js", () => ({ safeFetch: mocks.safeFetch }))
vi.mock("sharp", () => {
  const chain: Record<string, unknown> = {}
  chain.metadata = () => Promise.resolve({ format: "jpeg", width: 1024, height: 1024 })
  for (const k of ["rotate", "resize", "jpeg", "webp", "png"]) chain[k] = () => chain
  chain.toBuffer = () => Promise.resolve(Buffer.from("x"))
  const sharp = () => chain
  sharp.default = sharp
  return { default: sharp }
})

// The worker's router: the real KIE provider, behind the router's own glue.
vi.mock("@/providers/index.js", async () => {
  const { KieVideoProvider } = await import("@/providers/kie/video.js")
  const { applyFrameFitAndDelivery } = await import("@/lib/video-frame-dispatch.js")
  const kie = new KieVideoProvider()
  return {
    imageToVideo: async (imageUrl: string | undefined, model: string, prompt?: string, duration?: number, endFrameUrl?: string, options?: Record<string, unknown>) => {
      const shaped = await applyFrameFitAndDelivery({ model, imageUrl, endFrameUrl, prompt, options })
      return { ...(await kie.imageToVideo(shaped.imageUrl, shaped.prompt, model, duration, shaped.endFrameUrl, shaped.options)), providerUsed: "kie", displayCost: null }
    },
    textToVideo: async (prompt: string, model: string, duration?: number, aspectRatio?: string, options?: Record<string, unknown>) =>
      ({ ...(await kie.textToVideo(prompt, model, duration, aspectRatio, options)), providerUsed: "kie", displayCost: null }),
  }
})

// Worker edges.
vi.mock("@/lib/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage.js")>()),
  uploadToR2: mocks.uploadToR2,
}))
vi.mock("@/workers/shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/workers/shared.js")>()),
  uploadVideoMaybeWatermark: mocks.uploadVideoMaybeWatermark,
  generateAndUploadThumbnail: vi.fn(async () => "https://r2.example.com/t.png"),
  setJobProgress: vi.fn(async () => {}),
  startProgressRamp: vi.fn(() => ({ stop: vi.fn() })),
}))
vi.mock("@/lib/job-finalize.js", () => ({ finalizeJobWithMedia: mocks.finalize }))
vi.mock("@/lib/seedance2-ref-video-settle.js", () => ({ measureSeedance2RefVideoBaseCredits: vi.fn(async () => undefined) }))
vi.mock("@/lib/seedance-draft-finalize.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seedance-draft-finalize.js")>()),
  measureSeedanceDraftRenderSec: vi.fn(async () => undefined),
}))
vi.mock("@/lib/reconcile/persistence.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reconcile/persistence.js")>()),
  makeOnTaskCreated: () => undefined,
}))

import { generateVideoRoutes } from "../generate-video.js"
import { textToVideoRoutes } from "../text-to-video.js"
import { withJobSubmissionContext } from "../../lib/job-submission-context.js"
import { videoAIHandlers } from "../../workers/handlers/video-ai.js"

const USER = "00000000-0000-4000-8000-000000000001"
const PARENT = "00000000-0000-4000-8000-0000000000b2"
const VIDEO = "https://cdn.nodaro.ai/videos/sent-clip.mp4"
const IMAGES = [
  "https://cdn.nodaro.ai/images/singer.jpg",
  "https://cdn.nodaro.ai/images/singer-side.jpg",
  "https://cdn.nodaro.ai/images/dog.jpg",
]
/** The shape of a cast-swap prompt: labelled first images, unlabelled extras, the clip. */
const PROMPT =
  "edit {video:1} as follows:\n" +
  "Use {image:1:person} (also shown in {image:2}) as the singer, with the exact face from {image:1} wearing the exact outfit from {video:1}, with {image:1} body shape and {video:1} hairstyle and haircut.\n" +
  "Use {image:3:pet} as the dog, with {image:3} coat.\n" +
  "Keep the camera, the cuts and the timing of {video:1}."

/** The fields every Nodaro Motion child sends, whatever its engine. */
const CHILD = {
  prompt: PROMPT,
  referenceVideoUrls: [VIDEO],
  referenceImageUrls: IMAGES,
  forcePrivate: true,
  contentPolicyRewrite: false,
  userId: USER,
}

const BODIES = {
  // SEEDANCE_VIDEO_EDIT_SHAPE + a full run's resolution + the mov container.
  "seedance-2-5 (edit shape)": { ...CHILD, provider: "seedance-2-5", aspectRatio: "adaptive", duration: -1, resolution: "720p", outputFormat: "mov" },
  // klingChildBody.
  "kling-4": { ...CHILD, provider: "kling-4", duration: 8, resolution: "720p", aspectRatio: "auto", keepOriginalSound: true },
} as const

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.queueAdd.mockResolvedValue({ id: "q-1" })
  mocks.reserve.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 1, watermark: false })
  mocks.safeFetch.mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(100) })
  mocks.runKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://kie.example/out.mp4"] }, taskId: "t-1", providerMs: 1 })
  mocks.uploadToR2.mockResolvedValue("https://r2.example.com/videos/out.mov")
  mocks.uploadVideoMaybeWatermark.mockResolvedValue("https://r2.example.com/videos/out.mp4")
  mocks.finalize.mockResolvedValue({ ok: true })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
    req.authKind = "internal"
  })
  await app.register(async (instance) => {
    await generateVideoRoutes(instance)
    await textToVideoRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

/** One child through `url`: what was recorded, reserved, queued and sent to KIE. */
async function runChild(url: "/v1/text-to-video" | "/v1/generate-video", body: Record<string, unknown>) {
  vi.clearAllMocks()
  mocks.queueAdd.mockResolvedValue({ id: "q-1" })
  mocks.reserve.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 1, watermark: false })
  mocks.runKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://kie.example/out.mp4"] }, taskId: "t-1", providerMs: 1 })
  mocks.finalize.mockResolvedValue({ ok: true })
  const res = await withJobSubmissionContext(
    { userId: USER, method: "POST", url, parentJobId: PARENT },
    () => app.inject({ method: "POST", url, payload: body }),
  )
  expect(res.statusCode, res.body).toBe(200)
  const row = mocks.insert.mock.calls[0]![0] as Record<string, unknown>
  const [jobName, queued] = mocks.queueAdd.mock.calls[0]! as [string, Record<string, unknown>]
  // Through BullMQ's JSON, as the worker receives it.
  const data = JSON.parse(JSON.stringify(queued)) as Record<string, unknown>
  await videoAIHandlers[jobName]!(
    { name: jobName, data, id: "bull-1", updateProgress: vi.fn() } as never,
    { jobId: data.jobId as string, jobUserId: USER, usageLogId: "usage-1", shouldWatermark: false } as never,
  )
  expect(mocks.runKieTask).toHaveBeenCalledTimes(1)
  const [taskModel, kieInput] = mocks.runKieTask.mock.calls[0]! as [string, Record<string, unknown>]
  return {
    jobName,
    row,
    modelIdentifier: mocks.reserve.mock.calls[0]![3] as string,
    taskModel,
    kieInput,
    finalize: mocks.finalize.mock.calls[0]![0] as Record<string, unknown>,
  }
}

describe("a cast-swap child sends the same request on /v1/generate-video as on /v1/text-to-video", () => {
  for (const [label, body] of Object.entries(BODIES)) {
    describe(label, () => {
      it("the request KIE receives is identical", async () => {
        const t2v = await runChild("/v1/text-to-video", body)
        const gv = await runChild("/v1/generate-video", body)
        expect(t2v.jobName).toBe("text-to-video")
        expect(gv.jobName).toBe("image-to-video")
        expect(gv.taskModel).toBe(t2v.taskModel)
        // The whole provider-bound body, so a key one lane alone sends shows up.
        expect(gv.kieInput).toEqual(t2v.kieInput)
        // And the fields the plugin depends on, named.
        for (const field of ["prompt", "reference_image_urls", "reference_video_urls", "image_urls", "video_urls", "duration", "aspect_ratio", "resolution", "mode", "output_format", "keep_original_sound"]) {
          expect(gv.kieInput[field], field).toEqual(t2v.kieInput[field])
        }
        // Every token resolved: nothing raw reaches the engine.
        expect(String(gv.kieInput.prompt)).not.toMatch(/\{(?:image|video):/)
      })

      it("the child is private, tied to its parent, and priced on the same credit id", async () => {
        const t2v = await runChild("/v1/text-to-video", body)
        const gv = await runChild("/v1/generate-video", body)
        for (const r of [t2v, gv]) {
          expect(r.row.force_private).toBe(true)
          expect(r.row.parent_job_id).toBe(PARENT)
        }
        expect(gv.modelIdentifier).toBe(t2v.modelIdentifier)
      })
    })
  }

  it("a CDN display rendition among the reference images is recorded and sent as its original file", async () => {
    const rendition = "https://cdn.nodaro.ai/cdn-cgi/image/width=1600,quality=80,format=auto/community/listing-1/portrait.png"
    const original = "https://cdn.nodaro.ai/community/listing-1/portrait.png"
    const body = { ...BODIES["kling-4"], referenceImageUrls: [IMAGES[0], IMAGES[1], rendition] }
    for (const url of ["/v1/text-to-video", "/v1/generate-video"] as const) {
      const r = await runChild(url, body)
      expect((r.row.input_data as Record<string, unknown>).referenceImageUrls, url).toEqual([IMAGES[0], IMAGES[1], original])
      // Only the original was downloaded; the rendition never reached the image preparation.
      const fetched = mocks.safeFetch.mock.calls.map((c) => c[0] as string)
      expect(fetched, url).toContain(original)
      expect(fetched.some((u) => u.includes("/cdn-cgi/")), url).toBe(false)
      expect(JSON.stringify(r.kieInput), url).not.toContain("/cdn-cgi/")
    }
  })

  it("the seedance-2-5 child keeps its mov container on /v1/generate-video", async () => {
    const gv = await runChild("/v1/generate-video", BODIES["seedance-2-5 (edit shape)"])
    expect(gv.kieInput.output_format).toBe("mov")
    expect((gv.row.input_data as Record<string, unknown>).outputFormat).toBe("mov")
  })
})
