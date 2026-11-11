/**
 * The output format at the two image routes: the levers reach the job (and its
 * recorded request) snapped, the corrections come back as `adjustments`, the
 * credit CHECK prices what the DEBIT reserves, and a mask with a GIF or an SVG
 * is a 400 before anything is reserved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
  },
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 1, watermark: false }),
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/llm-client.js", () => ({ llmComplete: vi.fn() }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test", CHARACTER_LORA_ROUTING_ENABLED: true },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
// No network: "auto" on 2.6 would read the photo's size.
vi.mock("@/lib/fetch-own-media.js", () => ({
  fetchOwnMedia: vi.fn(async () => new Response("gone", { status: 404 })),
  isOwnMediaUrl: () => false,
}))

import { generateImageRoutes, resolveImageCreditIdentifier } from "../generate-image.js"
import { imageToImageRoutes, resolveImageToImageCreditIdentifier } from "../image-to-image.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { MASK_WITH_FORMAT_MESSAGE } from "../../lib/image-format-schema.js"

const USER = "00000000-0000-4000-8000-000000000001"
let app: FastifyInstance
let jobInsert: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.clearAllMocks()
  const single = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
  jobInsert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) })
  vi.mocked(supabase.from).mockReturnValue({ insert: jobInsert } as never)
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
})

type Adjustment = { field: string; from: unknown; to?: unknown }
async function post(url: string, payload: Record<string, unknown>) {
  const res = await app.inject({ method: "POST", url, payload: { userId: USER, ...payload } })
  const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as Record<string, unknown> | undefined
  const debit = vi.mocked(reserveCreditsForJob).mock.calls.at(-1)?.[3] as string | undefined
  const row = jobInsert.mock.calls.at(-1)?.[0] as { input_data: Record<string, unknown> } | undefined
  return { res, body: res.json() as { adjustments?: Adjustment[]; error?: { message?: string } }, queued, debit, inputData: row?.input_data }
}
const check = (body: Record<string, unknown>) => resolveImageCreditIdentifier({ body } as FastifyRequest)
const checkEdit = (body: Record<string, unknown>) => resolveImageToImageCreditIdentifier({ body } as FastifyRequest)

describe("POST /v1/generate-image with a format", () => {
  it("a GIF: frames and speed reach the job, the ratio and size are dropped and said, CHECK === DEBIT", async () => {
    const payload = { prompt: "a waving flag", provider: "gpt-image-2-6-flare", quality: "high", aspectRatio: "16:9", resolution: "2K", outputFormat: "gif", gifFrames: 14, gifFrameDurationMs: 155 }
    const { res, body, queued, debit, inputData } = await post("/v1/generate-image", payload)
    expect(res.statusCode).toBe(200)
    expect(queued).toMatchObject({ outputFormat: "gif", gifFrames: 14, gifFrameDurationMs: 160, aspectRatio: "1:1", resolution: undefined, quality: "high" })
    expect(inputData).toMatchObject({ outputFormat: "gif", gifFrames: 14, gifFrameDurationMs: 160 })
    expect(body.adjustments?.map((a) => a.field).sort()).toEqual(["aspectRatio", "gifFrameDurationMs", "resolution"])
    expect(debit).toBe("gpt-image-2-6-flare:high:gif-13-16")
    expect(check(payload)).toBe(debit)
  })

  it("an SVG: its level reaches the job, priced at its size and level, CHECK === DEBIT", async () => {
    const payload = { prompt: "a maple leaf", provider: "gpt-image-2-6-sunburst", resolution: "4K", outputFormat: "svg", svgLevel: "max", background: "transparent" }
    const { res, body, queued, debit } = await post("/v1/generate-image", payload)
    expect(res.statusCode).toBe(200)
    expect(queued).toMatchObject({ outputFormat: "svg", svgLevel: "max", resolution: "4K", background: "auto" })
    expect(body.adjustments?.map((a) => a.field)).toEqual(["background"])
    expect(debit).toBe("gpt-image-2-6-sunburst:medium:4K:svg-max")
    expect(check(payload)).toBe(debit)
  })

  it("a JPEG with a transparent background: auto, at the size asked, at the PNG price", async () => {
    const payload = { prompt: "a cup", provider: "gpt-image-2-6-flare", resolution: "4K", outputFormat: "jpeg", background: "transparent" }
    const { queued, debit, body } = await post("/v1/generate-image", payload)
    expect(queued).toMatchObject({ outputFormat: "jpeg", background: "auto", resolution: "4K" })
    expect(body.adjustments?.map((a) => a.field)).toEqual(["background"])
    expect(debit).toBe("gpt-image-2-6-flare:medium:4K")
    expect(check(payload)).toBe(debit)
  })

  it("a model with no formats drops the format, says so, and is priced as before", async () => {
    const { queued, body, debit } = await post("/v1/generate-image", { prompt: "a cup", provider: "gpt-image-2-5-flare", outputFormat: "gif", gifFrames: 9 })
    expect(queued?.outputFormat).toBeUndefined()
    expect(queued?.gifFrames).toBeUndefined()
    expect(body.adjustments?.map((a) => a.field)).toContain("outputFormat")
    expect(debit).toBe("gpt-image-2-5-flare")
  })

  it("PNG asked or no format: nothing new rides the job and no adjustment is said", async () => {
    for (const outputFormat of ["png", undefined]) {
      vi.clearAllMocks()
      const single = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
      jobInsert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) })
      vi.mocked(supabase.from).mockReturnValue({ insert: jobInsert } as never)
      const { queued, body, debit } = await post("/v1/generate-image", { prompt: "a cup", provider: "gpt-image-2-6-flare", quality: "low", resolution: "2K", aspectRatio: "1:1", ...(outputFormat && { outputFormat }) })
      expect(queued?.gifFrames).toBeUndefined()
      expect(queued?.svgLevel).toBeUndefined()
      expect(body.adjustments).toBeUndefined()
      expect(debit).toBe("gpt-image-2-6-flare:low:2K")
    }
  })

  it("a mask with a GIF or an SVG is a 400 before anything is reserved", async () => {
    for (const outputFormat of ["gif", "svg"]) {
      vi.clearAllMocks()
      const { res, body } = await post("/v1/generate-image", {
        prompt: "fix the sky", provider: "gpt-image-2-6-flare", outputFormat,
        baseImageUrl: "https://cdn.example.com/base.png", maskUrl: "https://cdn.example.com/mask.png",
      })
      expect(res.statusCode).toBe(400)
      expect(JSON.stringify(body)).toContain(MASK_WITH_FORMAT_MESSAGE)
      expect(reserveCreditsForJob).not.toHaveBeenCalled()
      expect(videoQueue.add).not.toHaveBeenCalled()
    }
  })

  it("a mask with a PNG, JPEG or WebP is not refused", async () => {
    const { res } = await post("/v1/generate-image", {
      prompt: "fix the sky", provider: "gpt-image-2-6-flare", outputFormat: "webp",
      baseImageUrl: "https://cdn.example.com/base.png", maskUrl: "https://cdn.example.com/mask.png",
    })
    expect(res.statusCode).toBe(200)
  })

  it("frames and speed outside what any model takes are refused by the schema", async () => {
    for (const extra of [{ gifFrames: 1 }, { gifFrames: 17 }, { gifFrameDurationMs: 10 }, { gifFrameDurationMs: 2010 }, { svgLevel: "ultra" }, { outputFormat: "tiff" }]) {
      const { res } = await post("/v1/generate-image", { prompt: "x", provider: "gpt-image-2-6-flare", outputFormat: "gif", ...extra })
      expect(res.statusCode, JSON.stringify(extra)).toBe(400)
    }
  })
})

describe("POST /v1/image-to-image with a format", () => {
  it("a GIF edit is priced on its band and its images, CHECK === DEBIT", async () => {
    const payload = { imageUrl: "https://cdn.example.com/src.png", referenceImageUrls: ["https://cdn.example.com/r.png"], prompt: "make it wave", provider: "gpt-image-2-6-flare-i2i", outputFormat: "gif", gifFrames: 4 }
    const { res, queued, debit } = await post("/v1/image-to-image", payload)
    expect(res.statusCode).toBe(200)
    expect(queued).toMatchObject({ outputFormat: "gif", gifFrames: 4, gifFrameDurationMs: 200 })
    expect(debit).toBe("gpt-image-2-6-flare-i2i:medium:gif-2-8:2ref")
    expect(checkEdit(payload)).toBe(debit)
  })

  it("an SVG edit, CHECK === DEBIT", async () => {
    const payload = { imageUrl: "https://cdn.example.com/src.png", prompt: "as a logo", provider: "gpt-image-2-6-sunburst-i2i", resolution: "2K", outputFormat: "svg", svgLevel: "detailed" }
    const { queued, debit } = await post("/v1/image-to-image", payload)
    expect(queued).toMatchObject({ outputFormat: "svg", svgLevel: "detailed" })
    expect(debit).toBe("gpt-image-2-6-sunburst-i2i:medium:2K:svg-detailed:1ref")
    expect(checkEdit(payload)).toBe(debit)
  })

  it("a mask with a GIF or an SVG is a 400 before anything is reserved", async () => {
    const { res, body } = await post("/v1/image-to-image", {
      imageUrl: "https://cdn.example.com/src.png", prompt: "x", provider: "gpt-image-2-6-flare-i2i",
      outputFormat: "svg", maskUrl: "https://cdn.example.com/mask.png",
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.stringify(body)).toContain(MASK_WITH_FORMAT_MESSAGE)
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })

  it("a mask with a GIF is a 400 on Sunburst too", async () => {
    const { res } = await post("/v1/image-to-image", {
      imageUrl: "https://cdn.example.com/src.png", prompt: "x", provider: "gpt-image-2-6-sunburst-i2i",
      outputFormat: "gif", maskUrl: "https://cdn.example.com/mask.png",
    })
    expect(res.statusCode).toBe(400)
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })
})

// GPT Image 2.6 Flare and Sunburst take a mask of their own. It costs nothing
// extra: the run is priced on the edit's own row, the mask not counted as an
// input image, CHECK === DEBIT.
describe("POST /v1/image-to-image with a mask on GPT Image 2.6", () => {
  for (const provider of ["gpt-image-2-6-flare-i2i", "gpt-image-2-6-sunburst-i2i"] as const) {
    for (const outputFormat of [undefined, "png", "jpeg", "webp"] as const) {
      it(`${provider}${outputFormat ? `, ${outputFormat}` : ""}: takes it and queues it, priced as the same edit without one`, async () => {
        const base = { imageUrl: "https://cdn.example.com/src.png", referenceImageUrls: ["https://cdn.example.com/r.png"], prompt: "paint it green", provider, quality: "high", resolution: "2K", aspectRatio: "1:1", ...(outputFormat && { outputFormat }) }
        const plain = await post("/v1/image-to-image", base)
        const masked = await post("/v1/image-to-image", { ...base, maskUrl: "https://cdn.example.com/mask.png" })
        expect(masked.res.statusCode).toBe(200)
        expect(masked.queued).toMatchObject({ provider, maskUrl: "https://cdn.example.com/mask.png" })
        expect(masked.inputData).toMatchObject({ maskUrl: "https://cdn.example.com/mask.png" })
        expect(masked.debit).toBe(`${provider}:high:2K:2ref`)
        expect(masked.debit).toBe(plain.debit)
        expect(checkEdit({ ...base, maskUrl: "https://cdn.example.com/mask.png" })).toBe(masked.debit)
      })
    }
  }
})
