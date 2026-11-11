/**
 * /v1/image-to-image: a masked GPT Image 2.6 edit follows its photo. The
 * photo's size is read once, before the credit check (`readImageSourceSize`),
 * and both the check and the handler's reservation price the size nearest it,
 * at the photo's shape whatever ratio the request names; the corrections come
 * back as `adjustments`. With the size unknown, the size asked is kept.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"

const probe = vi.hoisted(() => vi.fn())

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
vi.mock("@/lib/image-source-size.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/image-source-size.js")>()),
  probeImageDisplaySize: probe,
}))

import { imageToImageRoutes, readImageSourceSize, resolveImageToImageCreditIdentifier } from "../image-to-image.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"

const USER = "00000000-0000-4000-8000-000000000001"
const SRC = "https://cdn.example.com/src.png"
const MASK = "https://cdn.example.com/mask.png"
let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  const single = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
  const insert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) })
  vi.mocked(supabase.from).mockReturnValue({ insert } as never)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  await app.register(async (instance) => imageToImageRoutes(instance))
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

type Adjustment = { field: string; from: unknown; to?: unknown }

/** The run (DEBIT, queued levers, adjustments) and the CHECK priced from the same read. */
async function run(payload: Record<string, unknown>) {
  const res = await app.inject({ method: "POST", url: "/v1/image-to-image", payload: { userId: USER, ...payload } })
  const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as Record<string, unknown> | undefined
  const debit = vi.mocked(reserveCreditsForJob).mock.calls.at(-1)?.[3] as string | undefined
  const req = { body: payload } as FastifyRequest
  await readImageSourceSize(req)
  const check = resolveImageToImageCreditIdentifier(req)
  return { res, body: res.json() as { adjustments?: Adjustment[] }, queued, debit, check }
}

describe("a masked GPT Image 2.6 edit follows its photo", () => {
  for (const provider of ["gpt-image-2-6-flare-i2i", "gpt-image-2-6-sunburst-i2i"] as const) {
    it(`${provider}: a 1K photo with a 4K request is priced and sent at 1K (check === charge)`, async () => {
      probe.mockResolvedValue({ width: 768, height: 1024 })
      const r = await run({ imageUrl: SRC, prompt: "green sky", provider, resolution: "4K", maskUrl: MASK })
      expect(r.res.statusCode).toBe(200)
      expect(r.queued).toMatchObject({ resolution: "1K", aspectRatio: "3:4", maskUrl: MASK })
      expect(r.debit).toBe(`${provider}:medium:1K:1ref`)
      expect(r.check).toBe(r.debit)
      expect(r.body.adjustments).toContainEqual(expect.objectContaining({ field: "resolution", from: "4K", to: "1K" }))
    })

    it(`${provider}: a 4000 px photo with a 1K request is priced and sent at 4K (check === charge)`, async () => {
      probe.mockResolvedValue({ width: 3000, height: 4000 })
      const r = await run({ imageUrl: SRC, prompt: "green sky", provider, resolution: "1K", maskUrl: MASK })
      expect(r.queued).toMatchObject({ resolution: "4K", aspectRatio: "3:4" })
      expect(r.debit).toBe(`${provider}:medium:4K:1ref`)
      expect(r.check).toBe(r.debit)
    })

    it(`${provider}: a named 16:9 on a 3:4 photo runs 3:4, and says so (check === charge)`, async () => {
      probe.mockResolvedValue({ width: 768, height: 1024 })
      const r = await run({ imageUrl: SRC, prompt: "green sky", provider, aspectRatio: "16:9", resolution: "1K", maskUrl: MASK })
      expect(r.queued).toMatchObject({ aspectRatio: "3:4", resolution: "1K" })
      expect(r.body.adjustments).toContainEqual(expect.objectContaining({ field: "aspectRatio", from: "16:9", to: "3:4" }))
      expect(r.check).toBe(r.debit)
    })
  }

  it("reads the photo once, before the check, and the handler reuses that read", async () => {
    probe.mockResolvedValue({ width: 768, height: 1024 })
    await app.inject({ method: "POST", url: "/v1/image-to-image", payload: { userId: USER, imageUrl: SRC, prompt: "x", provider: "gpt-image-2-6-flare-i2i", resolution: "4K", maskUrl: MASK } })
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it("with the photo's size unknown, keeps the size asked and runs at auto (check === charge)", async () => {
    probe.mockResolvedValue(undefined)
    const r = await run({ imageUrl: SRC, prompt: "green sky", provider: "gpt-image-2-6-flare-i2i", aspectRatio: "16:9", resolution: "4K", maskUrl: MASK })
    expect(r.queued).toMatchObject({ resolution: "4K", aspectRatio: "auto" })
    expect(r.debit).toBe("gpt-image-2-6-flare-i2i:medium:4K:1ref")
    expect(r.check).toBe(r.debit)
  })

  it("without a mask nothing is read for a named ratio, and the request is sent as asked", async () => {
    const r = await run({ imageUrl: SRC, prompt: "x", provider: "gpt-image-2-6-flare-i2i", aspectRatio: "16:9", resolution: "4K" })
    expect(probe).not.toHaveBeenCalled()
    expect(r.queued).toMatchObject({ aspectRatio: "16:9", resolution: "4K" })
    expect(r.check).toBe(r.debit)
  })

  it("a mask on another model reads nothing and keeps its levers", async () => {
    const r = await run({ imageUrl: SRC, prompt: "x", provider: "ideogram-edit", maskUrl: MASK })
    expect(probe).not.toHaveBeenCalled()
    expect(r.check).toBe(r.debit)
  })
})
