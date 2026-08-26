import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// /v1/extend-video reference-image plumbing: refs are accepted ONLY for
// seedance-2-extend (whose i2v transport has a native reference_image_urls
// array), assembled through the shared video assembler with one image seat
// reserved for the worker's last-frame anchor, and forwarded on the queue
// payload. Every other provider refuses refs with a 400 — honest failure
// over the silently-dropped-reference bug class.
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  return {
    supabase: {
      from: mockFrom,
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-123" } },
          error: null,
        }),
      },
    },
  }
})

vi.mock("@/lib/queue.js", () => ({
  videoQueue: {
    add: vi.fn().mockResolvedValue({ id: "queue-job-1" }),
  },
  redis: {},
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({
    usageLogId: "usage-1",
    creditsReserved: 1,
    watermark: false,
  }),
}))

vi.mock("@/lib/kie-task-ownership.js", () => ({
  kieTaskOwnedByAnother: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
  },
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

vi.mock("@/lib/video-schemas.js", async () => {
  const { z } = await import("zod")
  return {
    shotsSchema: z.array(z.object({ prompt: z.string(), duration: z.number() })),
    elementsSchema: z.array(z.object({ name: z.string() })),
  }
})

vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, probeMediaDuration: vi.fn() }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { extendVideoRoutes, assembleExtendVideoReferences } from "../extend-video.js"
import { assembleVideoConnectedReferences } from "../generate-video.js"
import { SEEDANCE_2_REF_LIMITS, type ConnectedReference } from "@nodaro/shared"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") {
      req.userId = body.userId
      req.userRole = undefined
    }
  })
  await app.register(async (instance) => {
    await extendVideoRoutes(instance)
  })
  await app.ready()

  const mockSingle = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)
})

afterEach(async () => {
  await app.close()
})

const USER = "00000000-0000-4000-8000-000000000001"
const SOURCE = "https://cdn.example.com/source.mp4"
const refUrl = (i: number) => `https://cdn.example.com/ref-${i}.png`

function seedanceBody(extra: Record<string, unknown> = {}) {
  return {
    userId: USER,
    provider: "seedance-2-extend",
    videoUrl: SOURCE,
    prompt: "she walks out of frame",
    ...extra,
  }
}

function queuedPayload(): Record<string, unknown> {
  expect(videoQueue.add).toHaveBeenCalledTimes(1)
  return vi.mocked(videoQueue.add).mock.calls[0]![1] as Record<string, unknown>
}

describe("POST /v1/extend-video — reference-image gating", () => {
  it.each(["veo-extend", "runway-extend"])(
    "%s refuses referenceImageUrls with a 400 naming the supported provider",
    async (provider) => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/extend-video",
        payload: {
          userId: USER,
          provider,
          kieTaskId: "kie-task-1",
          prompt: "keep going",
          referenceImageUrls: [refUrl(1)],
        },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
      expect(res.json().error.message).toContain("seedance-2-extend")
      expect(videoQueue.add).not.toHaveBeenCalled()
    },
  )

  it("ltx-2.3-pro refuses connectedReferences too", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/extend-video",
      payload: {
        userId: USER,
        provider: "ltx-2.3-pro",
        videoUrl: SOURCE,
        connectedReferences: [
          { id: "r1", defaultName: "Maya", source: "manual", url: refUrl(1) },
        ],
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain("seedance-2-extend")
    expect(videoQueue.add).not.toHaveBeenCalled()
  })
})

describe("POST /v1/extend-video — seedance-2-extend reference plumbing", () => {
  it("forwards flat referenceImageUrls on the queue payload, prompt untouched", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/extend-video",
      payload: seedanceBody({ referenceImageUrls: [refUrl(1), refUrl(2)] }),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    const payload = queuedPayload()
    expect(payload.referenceImageUrls).toEqual([refUrl(1), refUrl(2)])
    // Plain flat refs carry no directives — the continuation prompt survives.
    expect(payload.prompt).toBe("she walks out of frame")
    expect(payload.usageLogId).toBe("usage-1")
  })

  it("caps user refs at the anchor-budgeted seat count (provider cap − 1)", async () => {
    const budget = SEEDANCE_2_REF_LIMITS.images - 1
    const overflow = Array.from({ length: SEEDANCE_2_REF_LIMITS.images + 1 }, (_, i) => refUrl(i))
    const res = await app.inject({
      method: "POST",
      url: "/v1/extend-video",
      payload: seedanceBody({ referenceImageUrls: overflow }),
    })
    expect(res.statusCode).toBe(200)
    const payload = queuedPayload()
    expect(payload.referenceImageUrls).toEqual(overflow.slice(0, budget))
  })

  it("assembles connectedReferences into URLs after the flat refs", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/extend-video",
      payload: seedanceBody({
        referenceImageUrls: [refUrl(1)],
        connectedReferences: [
          { id: "c1", defaultName: "Red mug", source: "manual", url: refUrl(2), description: "the hero mug" },
        ],
      }),
    })
    expect(res.statusCode).toBe(200)
    const payload = queuedPayload()
    expect(payload.referenceImageUrls).toEqual([refUrl(1), refUrl(2)])
    // The structured ref's bullet rides the rewritten prompt.
    expect(String(payload.prompt)).toContain("she walks out of frame")
  })

  it("keeps the Avoid clause LAST — negative injection runs after assembly", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/extend-video",
      payload: seedanceBody({
        referenceImageUrls: [refUrl(1)],
        connectedReferences: [
          { id: "c1", defaultName: "Red mug", source: "manual", url: refUrl(2) },
        ],
        negativePrompt: "blurry frames",
      }),
    })
    expect(res.statusCode).toBe(200)
    expect(String(queuedPayload().prompt)).toMatch(/Avoid: blurry frames\.?\s*$/)
  })

  it("no refs → payload carries NO referenceImageUrls key (legacy shape preserved)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/extend-video", payload: seedanceBody() })
    expect(res.statusCode).toBe(200)
    expect("referenceImageUrls" in queuedPayload()).toBe(false)
  })
})

describe("assembleExtendVideoReferences / imageCapOverride (pure)", () => {
  const connected = (i: number): ConnectedReference =>
    ({ id: `c${i}`, defaultName: `Ref ${i}`, source: "manual", url: refUrl(100 + i) }) as ConnectedReference

  it("output URL count never exceeds the anchor budget, whatever mix goes in", () => {
    const out = assembleExtendVideoReferences({
      prompt: "keep rolling",
      referenceImageUrls: Array.from({ length: 6 }, (_, i) => refUrl(i)),
      connectedReferences: Array.from({ length: 6 }, (_, i) => connected(i)),
    })
    expect(out.referenceImageUrls).toHaveLength(SEEDANCE_2_REF_LIMITS.images - 1)
    // Flat refs lead (D5 ordering) — the structured refs get the remainder.
    expect(out.referenceImageUrls!.slice(0, 6)).toEqual(
      Array.from({ length: 6 }, (_, i) => refUrl(i)),
    )
  })

  it("imageCapOverride can only LOWER the provider cap, never raise it", () => {
    const urls = Array.from({ length: 12 }, (_, i) => refUrl(i))
    const raised = assembleVideoConnectedReferences({
      prompt: "p",
      provider: "seedance-2",
      connectedReferences: [],
      baseReferenceImageUrls: urls,
      referenceVideoCount: 0,
      referenceAudioCount: 0,
      imageCapOverride: 99,
    })
    expect(raised.referenceImageUrls).toHaveLength(SEEDANCE_2_REF_LIMITS.images)

    const lowered = assembleVideoConnectedReferences({
      prompt: "p",
      provider: "seedance-2",
      connectedReferences: [],
      baseReferenceImageUrls: urls,
      referenceVideoCount: 0,
      referenceAudioCount: 0,
      imageCapOverride: 2,
    })
    expect(lowered.referenceImageUrls).toHaveLength(2)
  })

  it("a provider with no reference support stays at zero even with an override", () => {
    const out = assembleVideoConnectedReferences({
      prompt: "with a {image:1} token",
      provider: "wan-turbo", // deliberately absent from VIDEO_REF_LIMITS_BY_PROVIDER
      connectedReferences: [connected(1)],
      baseReferenceImageUrls: undefined,
      referenceVideoCount: 0,
      referenceAudioCount: 0,
      imageCapOverride: 5,
    })
    // Zero-cap path: nothing attached; the {image:N} token is stripped to a label.
    expect(out.referenceImageUrls).toBeUndefined()
    expect(out.prompt).not.toContain("{image:1}")
  })
})
