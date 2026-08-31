import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
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

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { textToVideoRoutes } from "../text-to-video.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { registerPromptPolicy, clearPromptPolicies } from "../../lib/prompt-policy.js"
import { assembleVideoConnectedReferences } from "../generate-video.js"
import {
  getStylePromptHint,
  composeVideoPromptText,
  renderDirectionHints,
  VIDEO_HINT_MODE_DEFAULT,
} from "@nodaro/prompts"
import { getMaxVideoPromptChars } from "@nodaro/shared"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // Bypass auth — set userId from request body for protected routes
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") {
      req.userId = body.userId
      req.userRole = undefined
    }
  })

  await app.register(async (instance) => {
    await textToVideoRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockJobInsert(result: { data: unknown; error: unknown }) {
  const mockSingle = vi.fn().mockResolvedValue(result)
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  const mockFrom = vi.mocked(supabase.from)
  mockFrom.mockReturnValue({ insert: mockInsert } as never)
  return { mockFrom, mockInsert, mockSelect, mockSingle }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/text-to-video", () => {
  it("returns 400 when prompt is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      payload: { userId: "00000000-0000-4000-8000-000000000001" },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns 400 when provider is invalid", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      payload: {
        prompt: "a cat walking",
        provider: "nonexistent-provider",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns 401 when userId is not provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      payload: { prompt: "a cat walking" },
    })

    expect(res.statusCode).toBe(401)
    const body = res.json()
    expect(body.error.code).toBe("unauthorized")
  })

  it("creates a job and enqueues it on valid request", async () => {
    const { mockFrom, mockInsert } = mockJobInsert({
      data: { id: "job-1" },
      error: null,
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      payload: {
        prompt: "a cat walking in the park",
        userId: "00000000-0000-4000-8000-000000000001",
        provider: "kling",
        duration: 5,
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe("job-1")

    expect(mockFrom).toHaveBeenCalledWith("jobs")
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "00000000-0000-4000-8000-000000000001",
        status: "pending",
        input_data: expect.objectContaining({
          prompt: "a cat walking in the park",
          provider: "kling",
          type: "text-to-video",
        }),
      })
    )

    expect(videoQueue.add).toHaveBeenCalledWith(
      "text-to-video",
      expect.objectContaining({
        jobId: "job-1",
        prompt: "a cat walking in the park",
        provider: "kling",
        duration: 5,
      })
    )
  })

  describe("PromptPolicy (B4b)", () => {
    afterEach(() => clearPromptPolicies())

    it("applies a registered video PromptPolicy to the direct-route prompt", async () => {
      mockJobInsert({ data: { id: "job-1" }, error: null })
      registerPromptPolicy({
        id: "vid",
        apply: (a) => (a.kind === "video" ? { ...a, prompt: `${a.prompt} VID` } : a),
      })
      const res = await app.inject({
        method: "POST",
        url: "/v1/text-to-video",
        payload: {
          prompt: "a cat walking",
          userId: "00000000-0000-4000-8000-000000000001",
          provider: "kling",
          duration: 5,
        },
      })
      expect(res.statusCode).toBe(200)
      const queued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
      expect(queued.prompt).toBe("a cat walking VID")
    })
  })

  it("assembles connectedReferences server-side into the queued prompt + referenceImageUrls", async () => {
    mockJobInsert({ data: { id: "job-cr" }, error: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      payload: {
        prompt: "a chase scene",
        userId: "00000000-0000-4000-8000-000000000001",
        provider: "seedance-2",
        connectedReferences: [
          {
            id: "r1",
            defaultName: "Car",
            source: "wired-image",
            url: "https://cdn.nodaro.ai/uploads/car.png",
            description: "a red car",
          },
        ],
      },
    })

    expect(res.statusCode).toBe(200)
    const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as Record<string, unknown>
    // The unmentioned wired-image ref auto-attaches its URL + emits an @image_N directive.
    expect(queued.referenceImageUrls).toEqual(["https://cdn.nodaro.ai/uploads/car.png"])
    expect(queued.prompt).toContain("@image_1")
    expect(queued.prompt).toContain("a red car")
    expect(queued.prompt).toContain("a chase scene")
  })

  it("returns 500 when job insert fails", async () => {
    mockJobInsert({
      data: null,
      error: { message: "DB connection failed" },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      payload: {
        prompt: "a cat walking",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(500)
    const body = res.json()
    expect(body.error.code).toBe("internal_error")
  })

  it("uses minimax as default provider when none specified", async () => {
    const { mockInsert } = mockJobInsert({
      data: { id: "job-1" },
      error: null,
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      payload: {
        prompt: "a sunset timelapse",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(200)

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        input_data: expect.objectContaining({
          type: "text-to-video",
          prompt: "a sunset timelapse",
        }),
      })
    )

    // provider should be undefined in the queue payload (route passes through raw value)
    expect(videoQueue.add).toHaveBeenCalledWith(
      "text-to-video",
      expect.objectContaining({
        jobId: "job-1",
        prompt: "a sunset timelapse",
      })
    )
  })
})

/**
 * The cinematic `direction` channel, at parity with /v1/generate-video (same
 * shared schema, same composer, same fold site — before reference assembly).
 * The composer's semantics are pinned in `@nodaro/prompts`; the two cases that
 * matter for THIS route are that the fold lands and that its absence changes
 * nothing.
 */
describe("POST /v1/text-to-video — the direction channel", () => {
  const USER = "00000000-0000-4000-8000-000000000001"
  const STYLE = "cinematic"

  it("folds the direction ids into the queued prompt, recording the source in userPrompt", async () => {
    const { mockInsert } = mockJobInsert({ data: { id: "job-dir" }, error: null })
    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      payload: { prompt: "a sunset timelapse", userId: USER, direction: { style: STYLE } },
    })
    expect(res.statusCode).toBe(200)
    const folded = `a sunset timelapse. ${getStylePromptHint(STYLE)}`
    expect(vi.mocked(videoQueue.add).mock.calls.at(-1)![1].prompt).toBe(folded)
    expect(mockInsert.mock.calls.at(-1)![0].input_data).toEqual(
      expect.objectContaining({
        prompt: folded,
        userPrompt: "a sunset timelapse",
        direction: { style: STYLE },
      }),
    )
  })

  it("is byte-identical when `direction` is absent", async () => {
    mockJobInsert({ data: { id: "job-nodir" }, error: null })
    await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      payload: { prompt: "a sunset timelapse", userId: USER },
    })
    expect(vi.mocked(videoQueue.add).mock.calls.at(-1)![1].prompt).toBe("a sunset timelapse")
  })

  /**
   * TRUNCATION ORDERING — the route must hand the composer BOTH halves of the
   * budget: the EFFECTIVE ceiling and the reference FRAMING. Either one missing
   * is a silently clamped prompt, and the package suites can't see it, so both
   * get an end-to-end case here.
   *
   * The two halves need different providers, which is why there are two blocks:
   * `minimax` (1500 cap, ZERO image refs) isolates the ceiling half — nothing
   * frames the body there, so only the cap can be under test — while
   * `minimax-h3` (7000 cap, 9 image refs, non-native negative) is the cheapest
   * t2v provider that carries references and therefore the one that can prove
   * the framing half.
   */
  const BIG_DIRECTION = {
    cameraMotion: "handheld",
    shotSize: "wide-shot",
    angle: "low-angle",
    timeOfDay: "golden-hour",
    lightingStyle: "rembrandt",
    colorLook: "teal-orange",
    atmosphere: ["fog"],
    style: "cinematic",
    mood: ["happy", "joyful"],
    setting: "forest",
  }
  // 36 is TUNED: it overflows minimax's 1500 cap with the full fold, and puts the
  // Avoid reservation across a clause boundary so the two cases below differ.
  const PROSE = "The waves are loud. ".repeat(36)

  async function postT2V(payload: Record<string, unknown>) {
    mockJobInsert({ data: { id: "job-shed" }, error: null })
    const res = await app.inject({ method: "POST", url: "/v1/text-to-video", payload })
    return { res, prompt: vi.mocked(videoQueue.add).mock.calls.at(-1)![1].prompt as string }
  }

  it("sheds trailing hints so an over-cap direction fits the provider ceiling", async () => {
    const cap = getMaxVideoPromptChars("minimax")
    // NON-VACUITY: the unshed fold really would have overflowed minimax.
    expect((composeVideoPromptText(PROSE, BIG_DIRECTION) as string).length).toBeGreaterThan(cap)

    const { res, prompt } = await postT2V({
      prompt: PROSE,
      userId: USER,
      provider: "minimax",
      direction: BIG_DIRECTION,
    })
    expect(res.statusCode).toBe(200)
    expect(prompt.length).toBeLessThanOrEqual(cap)
    // The prose is untouched and leads the body; only hints paid.
    expect(prompt.startsWith(PROSE.trim())).toBe(true)
  })

  it("budgets against the ceiling the Avoid suffix leaves, not the raw cap", async () => {
    // `minimax` is outside NATIVE_NEGATIVE_VIDEO_PROVIDERS, so the clamp folds
    // the negative in as a suffix and reserves its room FIRST.
    const negativePrompt = "blurry, low quality, distorted faces, watermark, text overlay, jitter"
    const reserved = getMaxVideoPromptChars("minimax") - `\nAvoid: ${negativePrompt}`.length
    const withNeg = await postT2V({
      prompt: PROSE,
      userId: USER,
      provider: "minimax",
      direction: BIG_DIRECTION,
      negativePrompt,
    })
    const withoutNeg = await postT2V({
      prompt: PROSE,
      userId: USER,
      provider: "minimax",
      direction: BIG_DIRECTION,
    })
    expect(reserved).toBeLessThan(getMaxVideoPromptChars("minimax"))
    expect(withNeg.prompt.length).toBeLessThanOrEqual(reserved)
    expect(withNeg.prompt.length).toBeLessThan(withoutNeg.prompt.length)
    expect(withNeg.prompt.startsWith(PROSE.trim())).toBe(true)
  })

  /**
   * …and the FRAMING half. The fold runs BEFORE the reference assembly, but the
   * assembly is what APPENDS the binding text, so the shed has to be decided on
   * the FRAMED length — the route passes its own assembly as `opts.frame`.
   * Forget that and the composer budgets a body that fits while the prompt the
   * provider receives does not, and the order-blind clamp cuts the bindings.
   *
   * `minimax-h3` is the provider that makes this observable on t2v: 7000-char
   * cap AND 9 image-reference seats. (`minimax` above has none, so nothing
   * frames its body — that block structurally cannot cover this.)
   */
  describe("the framing half — the budget includes what the resolver appends", () => {
    // Long canonical descriptions on purpose: the frame's contribution IS the
    // signal under test, so it should be worth hundreds of characters rather
    // than a handful, and the margins below should be obvious, not knife-edge.
    const REFS = [
      {
        id: "r1",
        defaultName: "Kira",
        source: "wired-character",
        url: "https://cdn.example/kira.png",
        characterSlug: "kira",
        characterCanonicalDescription:
          "auburn hair worn in a loose braid, hazel eyes, a weathered navy peacoat over a grey fisherman's sweater, salt-stained leather boots, a thin silver ring on her left hand",
      },
      {
        id: "r2",
        defaultName: "Ray",
        source: "wired-character",
        url: "https://cdn.example/ray.png",
        characterSlug: "ray",
        characterCanonicalDescription:
          "a grizzled dockworker in his sixties, close-cropped white beard, deep crow's feet, an oilskin jacket patched at both elbows, forearms tattooed with faded anchors",
      },
    ]
    // Sized so that the PROSE plus the framing fits well under 7000 on its own —
    // the overflow is the direction fold's doing, and the shed's job is to give
    // exactly it back.
    const TAIL = "The waves are loud. ".repeat(280)
    const REF_PROSE = `@kira:1 walks the seawall at dusk. ${TAIL}`
    const CAP = getMaxVideoPromptChars("minimax-h3")
    const HINTS = renderDirectionHints(BIG_DIRECTION, {
      surface: "video",
      mode: VIDEO_HINT_MODE_DEFAULT,
    })

    // The same framing the route builds, for the non-vacuity arithmetic below.
    const frame = (body: string | undefined) =>
      assembleVideoConnectedReferences({
        prompt: body,
        provider: "minimax-h3",
        connectedReferences: REFS as never,
        referenceVideoCount: 0,
        referenceAudioCount: 0,
      }).prompt

    it("sheds on the FRAMED length, so the bindings and the prose both survive", async () => {
      // NON-VACUITY (1): the unshed fold really would have overflowed.
      expect(frame(composeVideoPromptText(REF_PROSE, BIG_DIRECTION))!.length).toBeGreaterThan(CAP)
      // NON-VACUITY (2) — the one that pins `frame` itself: a shed that budgeted
      // the BARE body still overflows once the resolver's text is added. So this
      // case cannot pass on the ceiling alone; drop `frame` from the route wiring
      // and the prompt below really is over the cap and really is clamped.
      const frameBlind = composeVideoPromptText(REF_PROSE, BIG_DIRECTION, undefined, { cap: CAP })
      expect(frame(frameBlind)!.length).toBeGreaterThan(CAP)
      // …and the prose plus the framing alone was never the problem.
      expect(frame(REF_PROSE)!.length).toBeLessThanOrEqual(CAP)

      const { res, prompt } = await postT2V({
        prompt: REF_PROSE,
        userId: USER,
        provider: "minimax-h3",
        direction: BIG_DIRECTION,
        connectedReferences: REFS,
      })
      expect(res.statusCode).toBe(200)
      expect(prompt.length).toBeLessThanOrEqual(CAP)

      // Every byte the resolver added is intact — the block header and BOTH
      // canonical descriptions, which an order-blind tail cut takes first.
      expect(prompt).toContain("Use these characters:")
      expect(prompt).toContain(REFS[0]!.characterCanonicalDescription)
      expect(prompt).toContain(REFS[1]!.characterCanonicalDescription)
      // The billed quantity cannot move either.
      expect(vi.mocked(videoQueue.add).mock.calls.at(-1)![1].referenceImageUrls).toEqual([
        "https://cdn.example/kira.png",
        "https://cdn.example/ray.png",
      ])

      // The user's prose survives in full…
      expect(prompt).toContain(TAIL.trim())
      // …and only trailing hints paid: the first-folded one stayed.
      expect(prompt).toContain(HINTS[0])
      expect(prompt).not.toContain(HINTS[HINTS.length - 1])
    })

    it("leaves an under-cap framed run byte-identical to the capless fold", async () => {
      // The framing costs nothing when there is room: the shed leg stays dark.
      const short = "she walks the seawall at dusk"
      const { prompt } = await postT2V({
        prompt: short,
        userId: USER,
        provider: "minimax-h3",
        direction: BIG_DIRECTION,
        connectedReferences: REFS,
      })
      expect(prompt).toBe(frame(composeVideoPromptText(short, BIG_DIRECTION)))
    })
  })
})
