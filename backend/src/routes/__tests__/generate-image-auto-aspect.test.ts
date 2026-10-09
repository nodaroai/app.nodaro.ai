import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"
import sharp from "sharp"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import. The NETWORK is the only thing faked
// on the size path: `fetchOwnMedia` serves a real image per url, so the probe,
// the catalog snap and both engines run as they do in production.
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

import { generateImageRoutes, resolveImageCreditIdentifier } from "../generate-image.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { fetchOwnMedia } from "../../lib/fetch-own-media.js"
import { forgetProbedImageSizes } from "../../lib/image-source-size.js"
import { buildPayloadWithSourceSize } from "../../services/workflow-engine/source-size-build.js"
import type { SimpleNode, ResolvedInputs } from "../../services/workflow-engine/types.js"
import {
  FLUX_LORA_CHARACTER_MODEL_ID,
  IMAGE_GEN_PROVIDERS,
  autoAspectNeedsSourceImage,
  normalizeModelInput,
  normalizedImageGenModelId,
} from "@nodaro/shared"

const USER = "00000000-0000-4000-8000-000000000001"
const LANDSCAPE = "https://cdn.example.com/landscape.png"
const PORTRAIT = "https://cdn.example.com/portrait.png"
const MISSING = "https://cdn.example.com/missing.png"

/** Today's answer for "auto" with no photo: the catalog snap on its own. */
const todays = (modelId: string) => normalizeModelInput(modelId, { aspectRatio: "auto" }).aspectRatio

/** Every Generate Image model whose catalog ratios lack "auto". */
const NO_NATIVE_AUTO = IMAGE_GEN_PROVIDERS.filter((p) => autoAspectNeedsSourceImage(p, "auto"))

let app: FastifyInstance
const images = new Map<string, Buffer>()

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 30, g: 120, b: 90 } } }).png().toBuffer()
}

function serveImages(): void {
  vi.mocked(fetchOwnMedia).mockImplementation(async (url: string) => {
    const bytes = images.get(url)
    return bytes ? new Response(new Uint8Array(bytes), { status: 206 }) : new Response("gone", { status: 404 })
  })
}

function setupSupabase(charRow: Record<string, unknown> | null = null) {
  const charSingle = vi.fn().mockResolvedValue({ data: charRow, error: null })
  const charSelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ is: vi.fn().mockReturnValue({ single: charSingle }) }) }),
  })
  const jobInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }) }),
  })
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "characters") return { select: charSelect } as never
    if (table === "jobs") return { insert: jobInsert } as never
    return {} as never
  })
  return { jobInsert }
}

beforeEach(async () => {
  vi.clearAllMocks()
  forgetProbedImageSizes()
  images.clear()
  images.set(LANDSCAPE, await png(1920, 1080))
  images.set(PORTRAIT, await png(1104, 1472))
  serveImages()
  vi.spyOn(console, "warn").mockImplementation(() => {})
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  await app.register(async (instance) => {
    await generateImageRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  vi.restoreAllMocks()
})

async function post(payload: Record<string, unknown>, charRow: Record<string, unknown> | null = null) {
  const { jobInsert } = setupSupabase(charRow)
  const res = await app.inject({ method: "POST", url: "/v1/generate-image", payload: { userId: USER, prompt: "a lighthouse at dusk", ...payload } })
  expect(res.statusCode, res.body).toBe(200)
  const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as Record<string, unknown>
  const row = jobInsert.mock.calls.at(-1)?.[0] as { input_data: Record<string, unknown> }
  return { body: res.json() as { adjustments?: Array<Record<string, unknown>> }, queued, inputData: row.input_data }
}

const fetched = () => vi.mocked(fetchOwnMedia).mock.calls.map((c) => c[0])

describe("/v1/generate-image — 'auto' with a wired photo", () => {
  it("sends the ratio nearest a landscape reference, records it, and says so", async () => {
    const { queued, inputData, body } = await post({ provider: "seedream-5-pro", referenceImageUrls: [LANDSCAPE], aspectRatio: "auto" })
    expect(queued.provider).toBe("seedream-5-pro-i2i")
    expect(queued.aspectRatio).toBe("16:9")
    expect(inputData.aspectRatio).toBe("16:9")
    expect(body.adjustments).toEqual([expect.objectContaining({ field: "aspectRatio", from: "auto", to: "16:9" })])
    expect(fetched()).toEqual([LANDSCAPE])
  })

  it("reads only the first reference — the one the i2i swap sends first", async () => {
    const { queued } = await post({ provider: "seedream-5-pro", referenceImageUrls: [PORTRAIT, LANDSCAPE], aspectRatio: "auto" })
    expect(queued.aspectRatio).toBe("3:4")
    expect(fetched()).toEqual([PORTRAIT])
  })

  it("takes the inpaint / refine base as the photo, ahead of any reference", async () => {
    const baseOnly = await post({ provider: "seedream-5-pro", baseImageUrl: PORTRAIT, aspectRatio: "auto" })
    expect(baseOnly.queued.aspectRatio).toBe("3:4")
    vi.clearAllMocks()
    forgetProbedImageSizes()
    serveImages()
    const both = await post({ provider: "seedream-5-pro", baseImageUrl: PORTRAIT, referenceImageUrls: [LANDSCAPE], aspectRatio: "auto" })
    expect(both.queued.aspectRatio).toBe("3:4")
    expect(fetched()).toEqual([PORTRAIT])
  })

  it("without a photo, sends exactly today's snapped ratio and reads nothing", async () => {
    const { queued, inputData } = await post({ provider: "seedream-5-pro", aspectRatio: "auto" })
    expect(queued.aspectRatio).toBe(todays("seedream-5-pro"))
    expect(queued.aspectRatio).toBe("1:1")
    expect(inputData.aspectRatio).toBe("1:1")
    expect(fetched()).toEqual([])
  })

  it("leaves a native 'auto' alone and reads nothing", async () => {
    const { queued } = await post({ provider: "gpt-image-2", referenceImageUrls: [LANDSCAPE], aspectRatio: "auto" })
    expect(queued.provider).toBe("gpt-image-2-i2i")
    expect(queued.aspectRatio).toBe("auto")
    expect(fetched()).toEqual([])
  })

  it("never second-guesses a concrete ratio", async () => {
    const { queued } = await post({ provider: "seedream-5-pro", referenceImageUrls: [LANDSCAPE], aspectRatio: "9:16" })
    expect(queued.aspectRatio).toBe("9:16")
    expect(fetched()).toEqual([])
  })

  it("CHECK === DEBIT: the pre-check, which has no size, prices the same tier", async () => {
    const payload = { userId: USER, prompt: "a lighthouse at dusk", provider: "seedream-5-pro", referenceImageUrls: [LANDSCAPE], aspectRatio: "auto", quality: "high" }
    await post(payload)
    const debit = vi.mocked(reserveCreditsForJob).mock.calls.at(-1)?.[3]
    expect(resolveImageCreditIdentifier({ body: payload } as FastifyRequest)).toBe(debit)
    expect(debit).toBe("seedream-5-pro-i2i:high")
  })

  it("a LoRA run never sends 'auto' — the trained model takes none — and reads nothing", async () => {
    const { queued, inputData } = await post(
      { provider: FLUX_LORA_CHARACTER_MODEL_ID, aspectRatio: "auto", _internalLora: { characterId: "00000000-0000-4000-8000-0000000000bb" } },
      { lora_replicate_version: "owner/char:abc", lora_trigger_word: "TOK_kira", lora_training_status: "succeeded" },
    )
    expect(queued.model).toBe(FLUX_LORA_CHARACTER_MODEL_ID)
    expect(queued.aspectRatio).toBeUndefined()
    expect(inputData.aspectRatio).toBeUndefined()
    expect(fetched()).toEqual([])
  })

  it("a LoRA run keeps any other ratio as sent", async () => {
    const { queued } = await post(
      { provider: FLUX_LORA_CHARACTER_MODEL_ID, aspectRatio: "16:9", _internalLora: { characterId: "00000000-0000-4000-8000-0000000000bb" } },
      { lora_replicate_version: "owner/char:abc", lora_trigger_word: "TOK_kira", lora_training_status: "succeeded" },
    )
    expect(queued.aspectRatio).toBe("16:9")
  })
})

/**
 * NO PROVIDER EVER RECEIVES "auto" IT CANNOT TAKE. Every Generate Image model
 * without a native auto, on the two no-photo paths: none wired, and one wired
 * whose size cannot be read. Both must send exactly today's snapped value.
 */
describe("no provider receives 'auto' it cannot take (every Generate Image model)", () => {
  it("covers the catalog (fails loudly if the filter breaks)", () => {
    expect(NO_NATIVE_AUTO.length).toBeGreaterThan(15)
  })

  for (const provider of NO_NATIVE_AUTO) {
    it(`${provider}: no photo → today's snapped ratio`, async () => {
      const { queued } = await post({ provider, aspectRatio: "auto" })
      expect(queued.aspectRatio).not.toBe("auto")
      expect(queued.aspectRatio).toBe(todays(provider))
    })

    it(`${provider}: a photo that cannot be read → today's snapped ratio`, async () => {
      const { queued } = await post({ provider, referenceImageUrls: [MISSING], aspectRatio: "auto" })
      expect(queued.aspectRatio).not.toBe("auto")
      expect(queued.aspectRatio).toBe(todays(normalizedImageGenModelId({ provider, refCount: 1, swapToI2i: true })))
    })
  }
})

/**
 * BOTH ENGINES, ONE ANSWER. The single-node route and the workflow run must
 * hand the provider the same model, ratio and levers for the same request. The
 * workflow side runs exactly what node-executor runs (`buildPayloadWithSourceSize`).
 *
 * With references attached both route the image-to-image sibling: the route
 * names it as the job's `provider`, a workflow run as `model`, keeping the
 * user's pick in `provider` (node-executor records that payload as the job's
 * `input_data`). So the comparison is of the model the worker routes
 * (`model ?? provider`) and of the provider each engine records.
 */
describe("route and workflow run agree", () => {
  const LEVERS = ["aspectRatio", "resolution", "quality"] as const
  const pick = (p: Record<string, unknown>) => Object.fromEntries(LEVERS.map((k) => [k, p[k]]))
  const routed = (p: Record<string, unknown>) => p.model ?? p.provider
  const node = (data: Record<string, unknown>): SimpleNode => ({ id: "g1", type: "generate-image", data: { prompt: "a lighthouse at dusk", ...data } })

  it('Seedream + a landscape reference + "auto": the generate-image node === /v1/generate-image', async () => {
    const levers = { provider: "seedream-5-pro", aspectRatio: "auto", quality: "high" }
    const { queued, inputData } = await post({ ...levers, referenceImageUrls: [LANDSCAPE] })

    const inputs: ResolvedInputs = { referenceImageUrls: [LANDSCAPE] }
    const run = await buildPayloadWithSourceSize(node(levers), "job-1", inputs, undefined, {})
    expect(run.jobName).toBe("generate-image")
    expect((run.payload.referenceImageUrls as string[])[0]).toBe(LANDSCAPE)
    expect(routed(run.payload)).toBe(routed(queued))
    expect(routed(run.payload)).toBe("seedream-5-pro-i2i")
    expect(run.payload.provider).toBe(inputData.provider)
    expect(inputData.provider).toBe("seedream-5-pro")
    expect(pick(run.payload)).toEqual(pick(queued))
    expect(pick(run.payload)).toMatchObject({ aspectRatio: "16:9", quality: "high" })
    expect(run.modelIdentifier).toBe(vi.mocked(reserveCreditsForJob).mock.calls.at(-1)?.[3])
  })

  it('grok + a reference + "auto": both route its sibling, which takes no ratio, and neither reads anything', async () => {
    const levers = { provider: "grok", aspectRatio: "auto" }
    const { queued, inputData } = await post({ ...levers, referenceImageUrls: [LANDSCAPE] })
    const run = await buildPayloadWithSourceSize(node(levers), "job-1", { referenceImageUrls: [LANDSCAPE] }, undefined, {})
    expect(routed(run.payload)).toBe(routed(queued))
    expect(routed(run.payload)).toBe("grok-i2i")
    expect(run.payload.provider).toBe(inputData.provider)
    expect(pick(run.payload)).toEqual(pick(queued))
    expect(run.payload.aspectRatio).toBeUndefined()
    expect(fetched()).toEqual([])
  })

  it("no reference: both send today's snapped ratio, and neither reads anything", async () => {
    const levers = { provider: "seedream-5-pro", aspectRatio: "auto" }
    const { queued, inputData } = await post(levers)
    const run = await buildPayloadWithSourceSize(node(levers), "job-1", {}, undefined, {})
    expect(routed(run.payload)).toBe(routed(queued))
    expect(routed(run.payload)).toBe("seedream-5-pro")
    expect(run.payload.provider).toBe(inputData.provider)
    expect(run.payload.aspectRatio).toBe(queued.aspectRatio)
    expect(run.payload.aspectRatio).toBe(todays("seedream-5-pro"))
    expect(fetched()).toEqual([])
  })
})
