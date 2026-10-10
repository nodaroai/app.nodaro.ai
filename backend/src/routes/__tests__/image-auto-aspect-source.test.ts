import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"
import sharp from "sharp"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import. The NETWORK is the only thing faked
// on the size path: `fetchOwnMedia` serves a real image, so the probe, the
// catalog snap and both engines run as they do in production.
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
  },
}))

vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) },
  redis: {},
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 1, watermark: false }),
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/llm-client.js", () => ({
  llmComplete: vi.fn().mockResolvedValue({ text: "a description", model: "claude-sonnet-4.6" }),
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

vi.mock("@/lib/fetch-own-media.js", () => ({
  fetchOwnMedia: vi.fn(),
  isOwnMediaUrl: (url: string) => url.startsWith("https://cdn.example.com/"),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { imageToImageRoutes, resolveImageToImageCreditIdentifier } from "../image-to-image.js"
import { editImageRoutes } from "../edit-image.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { fetchOwnMedia } from "../../lib/fetch-own-media.js"
import { forgetProbedImageSizes } from "../../lib/image-source-size.js"
import { buildPayloadWithSourceSize } from "../../services/workflow-engine/source-size-build.js"
import type { SimpleNode, ResolvedInputs } from "../../services/workflow-engine/types.js"

const USER = "00000000-0000-4000-8000-000000000001"
const SOURCE = "https://cdn.example.com/source.png"

let app: FastifyInstance
let sourceBytes: Buffer

async function servePng(width: number, height: number): Promise<void> {
  sourceBytes = await sharp({ create: { width, height, channels: 3, background: { r: 30, g: 120, b: 90 } } }).png().toBuffer()
  vi.mocked(fetchOwnMedia).mockImplementation(async () => new Response(new Uint8Array(sourceBytes), { status: 206 }))
}

function mockJobInsert() {
  const mockInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }) }),
  })
  vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)
  return mockInsert
}

beforeEach(async () => {
  vi.clearAllMocks()
  forgetProbedImageSizes()
  vi.spyOn(console, "warn").mockImplementation(() => {})
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  await app.register(async (instance) => {
    await imageToImageRoutes(instance)
    await editImageRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  vi.restoreAllMocks()
})

async function post(url: string, payload: Record<string, unknown>) {
  const mockInsert = mockJobInsert()
  const res = await app.inject({ method: "POST", url, payload: { userId: USER, ...payload } })
  expect(res.statusCode).toBe(200)
  const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as Record<string, unknown>
  const row = mockInsert.mock.calls.at(-1)?.[0] as { input_data: Record<string, unknown> }
  return { body: res.json() as { adjustments?: Array<Record<string, unknown>> }, queued, inputData: row.input_data }
}

describe("/v1/image-to-image — 'auto' keeps the source photo's shape", () => {
  it("sends the model's ratio nearest a landscape source, records it, and says so", async () => {
    await servePng(1920, 1080)
    const { body, queued, inputData } = await post("/v1/image-to-image", {
      imageUrl: SOURCE, prompt: "make it dusk", provider: "seedream-5-pro-i2i", aspectRatio: "auto",
    })
    expect(queued.aspectRatio).toBe("16:9")
    expect(inputData.aspectRatio).toBe("16:9")
    expect(body.adjustments).toEqual([
      expect.objectContaining({ field: "aspectRatio", from: "auto", to: "16:9" }),
    ])
    expect(vi.mocked(fetchOwnMedia)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchOwnMedia).mock.calls[0]![0]).toBe(SOURCE)
  })

  it("reads a phone portrait as 3:4", async () => {
    await servePng(1104, 1472)
    const { queued } = await post("/v1/image-to-image", {
      imageUrl: SOURCE, prompt: "make it dusk", provider: "seedream-5-pro-i2i", aspectRatio: "auto",
    })
    expect(queued.aspectRatio).toBe("3:4")
  })

  it("falls back to today's ratio when the source cannot be read", async () => {
    vi.mocked(fetchOwnMedia).mockResolvedValue(new Response("gone", { status: 404 }))
    const { queued } = await post("/v1/image-to-image", {
      imageUrl: SOURCE, prompt: "make it dusk", provider: "seedream-5-pro-i2i", aspectRatio: "auto",
    })
    expect(queued.aspectRatio).toBe("1:1")
  })

  it("does not read the source for a model with a native auto", async () => {
    await servePng(1920, 1080)
    const { queued } = await post("/v1/image-to-image", {
      imageUrl: SOURCE, prompt: "make it dusk", provider: "gpt-image-2-i2i", aspectRatio: "auto",
    })
    expect(queued.aspectRatio).toBe("auto")
    expect(vi.mocked(fetchOwnMedia)).not.toHaveBeenCalled()
  })

  it("does not read the source for a concrete ratio", async () => {
    await servePng(1920, 1080)
    const { queued } = await post("/v1/image-to-image", {
      imageUrl: SOURCE, prompt: "make it dusk", provider: "seedream-5-pro-i2i", aspectRatio: "9:16",
    })
    expect(queued.aspectRatio).toBe("9:16")
    expect(vi.mocked(fetchOwnMedia)).not.toHaveBeenCalled()
  })

  it("CHECK === DEBIT: the pre-check, which has no size, prices the same tier", async () => {
    await servePng(1920, 1080)
    const payload = { imageUrl: SOURCE, prompt: "make it dusk", provider: "seedream-5-pro-i2i", aspectRatio: "auto", quality: "high", userId: USER }
    await post("/v1/image-to-image", payload)
    const debit = vi.mocked(reserveCreditsForJob).mock.calls.at(-1)?.[3]
    const check = resolveImageToImageCreditIdentifier({ body: payload } as FastifyRequest)
    expect(check).toBe(debit)
    expect(check).toBe("seedream-5-pro-i2i:high")
  })
})

describe("/v1/edit-image — 'auto' keeps the source photo's shape", () => {
  it("sends the model's ratio nearest the source", async () => {
    await servePng(1104, 1472)
    const { queued, inputData, body } = await post("/v1/edit-image", {
      imageUrl: SOURCE, prompt: "make it dusk", provider: "nano-banana-edit", aspectRatio: "auto",
    })
    expect(queued.aspectRatio).toBe("3:4")
    expect(inputData.aspectRatio).toBe("3:4")
    expect(body.adjustments?.[0]).toMatchObject({ field: "aspectRatio", from: "auto", to: "3:4" })
  })

  it("does not read anything for a model with no ratio lever", async () => {
    await servePng(1104, 1472)
    const { queued } = await post("/v1/edit-image", {
      imageUrl: SOURCE, provider: "recraft-upscale", aspectRatio: "auto",
    })
    expect(queued.aspectRatio).toBeUndefined()
    expect(vi.mocked(fetchOwnMedia)).not.toHaveBeenCalled()
  })
})

/**
 * BOTH ENGINES, ONE ANSWER. The single-node route and the workflow run must
 * hand the provider the same body for the same request. The workflow side runs
 * exactly what node-executor runs (`buildPayloadWithSourceSize`).
 */
describe("route and workflow run agree", () => {
  const workflowPayload = (node: SimpleNode, inputs: ResolvedInputs) => buildPayloadWithSourceSize(node, "job-1", inputs, undefined, {})

  const LEVERS = ["provider", "imageUrl", "aspectRatio", "resolution", "quality"] as const
  const pick = (p: Record<string, unknown>) => Object.fromEntries(LEVERS.map((k) => [k, p[k]]))

  for (const type of ["image-to-image", "modify-image"] as const) {
    it(`seedream image-to-image + landscape source + "auto": ${type} node === /v1/image-to-image`, async () => {
      await servePng(1920, 1080)
      const levers = { provider: "seedream-5-pro-i2i", aspectRatio: "auto", quality: "high" }
      const { queued } = await post("/v1/image-to-image", { imageUrl: SOURCE, prompt: "make it dusk", ...levers })

      const run = await workflowPayload({ id: "n1", type, data: { prompt: "make it dusk", ...levers } }, { imageUrl: SOURCE })
      expect(run.jobName).toBe("image-to-image")
      expect(pick(run.payload)).toEqual(pick(queued))
      expect(pick(run.payload)).toMatchObject({ aspectRatio: "16:9", quality: "high", provider: "seedream-5-pro-i2i" })
      expect(run.modelIdentifier).toBe(vi.mocked(reserveCreditsForJob).mock.calls.at(-1)?.[3])
    })
  }

  it(`nano-banana-edit + portrait source + "auto": edit-image node === /v1/edit-image`, async () => {
    await servePng(1104, 1472)
    const { queued } = await post("/v1/edit-image", { imageUrl: SOURCE, prompt: "make it dusk", provider: "nano-banana-edit", aspectRatio: "auto" })
    const run = await workflowPayload(
      { id: "n1", type: "edit-image", data: { prompt: "make it dusk", provider: "nano-banana-edit", aspectRatio: "auto" } },
      { imageUrl: SOURCE },
    )
    expect(run.payload.aspectRatio).toBe(queued.aspectRatio)
    expect(run.payload.aspectRatio).toBe("3:4")
  })
})
