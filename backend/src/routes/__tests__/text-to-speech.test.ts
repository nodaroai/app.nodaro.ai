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

// The credit guard is a no-op here, but the resolver and the options the route
// hands it are kept so a test can ask which model it would bill and what it
// would compute for the body (the length-pricing hook, when the flag is on).
const guard = vi.hoisted(() => ({
  resolver: undefined as undefined | ((req: { body: unknown }) => string),
  opts: undefined as undefined | { computeCredits?: (body: unknown, req: unknown) => number | Promise<number> },
}))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: (resolver: (req: { body: unknown }) => string, opts?: { computeCredits?: (body: unknown, req: unknown) => number | Promise<number> }) => {
    guard.resolver = resolver
    guard.opts = opts
    return async () => {}
  },
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
  speechLengthPricingEnabled: () => false,
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { textToSpeechRoutes } from "../text-to-speech.js"
import { resolveOmittedTtsProvider } from "../../lib/omitted-tts-provider.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "@/middleware/credit-guard.js"
import { getMaxTtsChars, DEFAULT_TTS_PROVIDER } from "@nodaro/shared"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { TTS_NEIGHBOUR_TEXT_MAX_CHARS } from "../../providers/elevenlabs/neighbour-text.js"

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
    await textToSpeechRoutes(instance)
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

describe("POST /v1/text-to-speech", () => {
  describe("neighbour text (previousText / nextText)", () => {
    const USER = "00000000-0000-4000-8000-000000000001"

    it("forwards both to the queue and stores them on the job's input_data", async () => {
      const { mockInsert } = mockJobInsert({ data: { id: "job-n1" }, error: null })
      const res = await app.inject({
        method: "POST",
        url: "/v1/text-to-speech",
        payload: { text: "Middle.", provider: "elevenlabs-v4", previousText: "Before.", nextText: "After.", userId: USER },
      })
      expect(res.statusCode).toBe(200)
      expect(vi.mocked(videoQueue.add)).toHaveBeenCalledWith("text-to-speech", expect.objectContaining({ previousText: "Before.", nextText: "After." }))
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          input_data: expect.objectContaining({ previousText: "Before.", nextText: "After.", type: "text-to-speech" }),
        }),
      )
    })

    it("accepts them on a model that does not stitch — the funnel decides whether they are sent", async () => {
      mockJobInsert({ data: { id: "job-n2" }, error: null })
      const res = await app.inject({ method: "POST", url: "/v1/text-to-speech", payload: { text: "Hi.", provider: "elevenlabs-v3", previousText: "Before.", userId: USER } })
      expect(res.statusCode).toBe(200)
      expect(vi.mocked(videoQueue.add)).toHaveBeenCalledWith("text-to-speech", expect.objectContaining({ previousText: "Before." }))
    })

    it("rejects a neighbour text over the cap with a 400 before any reservation (REST callers get told, not trimmed)", async () => {
      mockJobInsert({ data: { id: "job-n3" }, error: null })
      const res = await app.inject({ method: "POST", url: "/v1/text-to-speech", payload: { text: "Hi.", previousText: "x".repeat(TTS_NEIGHBOUR_TEXT_MAX_CHARS + 1), userId: USER } })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
      expect(reserveCreditsForJob).not.toHaveBeenCalled()
    })

    it("a model that does not stitch never sees the cap or the type check: the fields are not sent there, so they cannot fail the request", async () => {
      mockJobInsert({ data: { id: "job-n6" }, error: null })
      const long = "x".repeat(TTS_NEIGHBOUR_TEXT_MAX_CHARS * 3)
      const res = await app.inject({ method: "POST", url: "/v1/text-to-speech", payload: { text: "Hi.", provider: "elevenlabs-v3", previousText: long, nextText: null, userId: USER } })
      expect(res.statusCode).toBe(200)
      const queued = vi.mocked(videoQueue.add).mock.calls[0]![1] as Record<string, unknown>
      expect(queued.previousText).toBe(long) // carried as given; the funnel drops it for this model
      expect(queued.nextText).toBeUndefined() // not a string, so absent
    })

    it("the cap is measured on the trimmed text, like the funnel: padding does not push a valid value over it", async () => {
      mockJobInsert({ data: { id: "job-n7" }, error: null })
      const padded = ` ${"x".repeat(TTS_NEIGHBOUR_TEXT_MAX_CHARS)}${" ".repeat(100)}`
      const res = await app.inject({ method: "POST", url: "/v1/text-to-speech", payload: { text: "Hi.", provider: "elevenlabs-v4", previousText: padded, userId: USER } })
      expect(res.statusCode).toBe(200)
    })

    it("a stitching model still rejects a value over the cap once trimmed", async () => {
      mockJobInsert({ data: { id: "job-n8" }, error: null })
      const res = await app.inject({ method: "POST", url: "/v1/text-to-speech", payload: { text: "Hi.", provider: "elevenlabs-v4", nextText: ` ${"x".repeat(TTS_NEIGHBOUR_TEXT_MAX_CHARS + 1)} `, userId: USER } })
      expect(res.statusCode).toBe(400)
    })

    it("rejects a non-string neighbour text with a 400", async () => {
      mockJobInsert({ data: { id: "job-n4" }, error: null })
      const res = await app.inject({ method: "POST", url: "/v1/text-to-speech", payload: { text: "Hi.", nextText: ["After."], userId: USER } })
      expect(res.statusCode).toBe(400)
    })

    it("a request without them is unchanged: no neighbour key on the queue payload", async () => {
      mockJobInsert({ data: { id: "job-n5" }, error: null })
      await app.inject({ method: "POST", url: "/v1/text-to-speech", payload: { text: "Hi.", userId: USER } })
      const payload = vi.mocked(videoQueue.add).mock.calls[0]![1] as Record<string, unknown>
      expect(payload.previousText).toBeUndefined()
      expect(payload.nextText).toBeUndefined()
    })
  })

  it("returns 400 when text is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-speech",
      payload: { userId: "00000000-0000-4000-8000-000000000001" },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  // Per-model TTS caps replaced the old flat 5000 reject: turbo accepts 40000,
  // multilingual 10000, v3 5000. The route now uses a generous 40000 ceiling and
  // clamps to the model cap in the handler (warn-don't-block); only past the
  // ceiling is it a hard validation reject.
  it("returns 400 when text exceeds the 40000 ceiling", async () => {
    const longText = "a".repeat(40001)

    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-speech",
      payload: {
        text: longText,
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
      url: "/v1/text-to-speech",
      payload: { text: "Hello world" },
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
      url: "/v1/text-to-speech",
      payload: {
        text: "Hello, this is a test of text to speech.",
        userId: "00000000-0000-4000-8000-000000000001",
        provider: "elevenlabs-turbo",
        voice: "rachel",
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
          text: "Hello, this is a test of text to speech.",
          provider: "elevenlabs-turbo",
          type: "text-to-speech",
        }),
      })
    )

    expect(videoQueue.add).toHaveBeenCalledWith(
      "text-to-speech",
      expect.objectContaining({
        jobId: "job-1",
        text: "Hello, this is a test of text to speech.",
        provider: "elevenlabs-turbo",
        voice: "rachel",
      })
    )
  })

  it("defaults an omitted provider to the default speech model (ElevenLabs v4), and bills that model", async () => {
    const { mockInsert } = mockJobInsert({
      data: { id: "job-1" },
      error: null,
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-speech",
      payload: {
        text: "Omitted provider test",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(200)

    // input_data has no provider key — the user submitted none.
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        input_data: expect.not.objectContaining({
          provider: expect.anything(),
        }),
      })
    )

    // The BullMQ worker receives the resolved default, and the reservation is for it.
    expect(DEFAULT_TTS_PROVIDER).toBe("elevenlabs-v4")
    expect(videoQueue.add).toHaveBeenCalledWith(
      "text-to-speech",
      expect.objectContaining({
        provider: DEFAULT_TTS_PROVIDER,
      })
    )
    expect(reserveCreditsForJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-1", DEFAULT_TTS_PROVIDER)
  })

  describe("voice.allowedGenders enforcement (B4c)", () => {
    // Gate is open (config mock: isCloud → true). Drive the profile via the env
    // the memoized getter reads fresh; reset the memo before/after each case.
    beforeEach(() => {
      process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ voice: { allowedGenders: ["male"] } })
      __resetSurfaceProfileCacheForTests()
    })
    afterEach(() => {
      delete process.env.NODARO_SURFACE_PROFILE
      __resetSurfaceProfileCacheForTests()
    })

    it("rejects a premade female voice under a male-only lock", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/text-to-speech",
        payload: { text: "hello", voice: "Rachel", voiceType: "premade", userId: "00000000-0000-4000-8000-000000000001" },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("voice_not_available")
    })

    it("allows a premade male voice, and any custom voice", async () => {
      mockJobInsert({ data: { id: "job-1" }, error: null })
      const male = await app.inject({
        method: "POST",
        url: "/v1/text-to-speech",
        payload: { text: "hi", voice: "Adam", voiceType: "premade", userId: "00000000-0000-4000-8000-000000000001" },
      })
      expect(male.statusCode).toBe(200)
      mockJobInsert({ data: { id: "job-2" }, error: null })
      const custom = await app.inject({
        method: "POST",
        url: "/v1/text-to-speech",
        payload: { text: "hi", voice: "someClonedId", voiceType: "custom", userId: "00000000-0000-4000-8000-000000000001" },
      })
      expect(custom.statusCode).toBe(200)
    })
  })

  // ── length-aware omitted-provider default (non-lossy) ────────────────────
  // The default model (v4) takes the common case, but its per-request cap
  // (10,000 chars) is below the route's 40,000-char ceiling. Callers that
  // omit `provider` and send longer text keep landing on turbo (cap 40,000,
  // lossless) — never silently truncated by the default model's clamp.

  it("resolveOmittedTtsProvider: the default model at and under its own cap, turbo beyond it", () => {
    const cap = getMaxTtsChars(DEFAULT_TTS_PROVIDER)
    expect(cap).toBe(10000)
    expect(resolveOmittedTtsProvider("a".repeat(cap))).toBe(DEFAULT_TTS_PROVIDER)
    expect(resolveOmittedTtsProvider("a".repeat(cap + 1))).toBe("elevenlabs-turbo")
    expect(resolveOmittedTtsProvider("short text")).toBe(DEFAULT_TTS_PROVIDER)
  })

  it("a request that omits the provider with 5,001 to 10,000 characters now runs on the default model, not turbo (v3's old cap no longer decides)", () => {
    expect(resolveOmittedTtsProvider("a".repeat(5001))).toBe(DEFAULT_TTS_PROVIDER)
    expect(resolveOmittedTtsProvider("a".repeat(8000))).toBe(DEFAULT_TTS_PROVIDER)
  })

  it("defaults an omitted provider to the default model at exactly its 10,000-char cap", async () => {
    const { mockInsert } = mockJobInsert({ data: { id: "job-1" }, error: null })
    const text = "a".repeat(10000)

    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-speech",
      payload: { text, userId: "00000000-0000-4000-8000-000000000001" },
    })

    expect(res.statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledWith(
      "text-to-speech",
      expect.objectContaining({ provider: DEFAULT_TTS_PROVIDER })
    )
    // At exactly the cap, the clamp is a no-op — full text preserved.
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        input_data: expect.objectContaining({ text: expect.stringMatching(/^a{10000}$/) }),
      })
    )
  })

  it("defaults an omitted provider to elevenlabs-turbo above the default model's 10,000-char cap (non-lossy)", async () => {
    const { mockInsert } = mockJobInsert({ data: { id: "job-1" }, error: null })
    const text = "a".repeat(10001)

    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-speech",
      payload: { text, userId: "00000000-0000-4000-8000-000000000001" },
    })

    expect(res.statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledWith(
      "text-to-speech",
      expect.objectContaining({ provider: "elevenlabs-turbo", text })
    )
    // turbo's cap is 40000 — well above 10001, so the clamp is a no-op and the
    // full text is preserved (not truncated to the default model's 10000).
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        input_data: expect.objectContaining({ text: expect.stringMatching(/^a{10001}$/) }),
      })
    )
  })

  // The credit guard (pre-handler) and the handler resolve the provider separately;
  // the model the guard checks the balance for must be the model reserved and run.
  it.each([
    ["omitted, short text", { text: "hello" }, DEFAULT_TTS_PROVIDER],
    ["omitted, at the default model's cap", { text: "a".repeat(10000) }, DEFAULT_TTS_PROVIDER],
    ["omitted, past the default model's cap", { text: "a".repeat(10001) }, "elevenlabs-turbo"],
    ["legacy elevenlabs", { text: "hello", provider: "elevenlabs" }, "elevenlabs-turbo"],
    ["explicit v3", { text: "hello", provider: "elevenlabs-v3" }, "elevenlabs-v3"],
    ["explicit v4", { text: "hello", provider: "elevenlabs-v4" }, "elevenlabs-v4"],
    ["explicit v4 Turbo", { text: "hello", provider: "elevenlabs-v4-turbo" }, "elevenlabs-v4-turbo"],
  ])("the credit guard, the reservation and the queued job agree on the model (%s)", async (_label, body, expected) => {
    mockJobInsert({ data: { id: "job-1" }, error: null })
    const payload = { ...body, userId: "00000000-0000-4000-8000-000000000001" }
    const res = await app.inject({ method: "POST", url: "/v1/text-to-speech", payload })
    expect(res.statusCode).toBe(200)
    expect(guard.resolver?.({ body: payload })).toBe(expected)
    expect(reserveCreditsForJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-1", expected)
    expect(videoQueue.add).toHaveBeenCalledWith("text-to-speech", expect.objectContaining({ provider: expected }))
  })

  it("respects an explicit elevenlabs-v3 provider for long text — clamp still applies", async () => {
    const { mockInsert } = mockJobInsert({ data: { id: "job-1" }, error: null })
    const text = "a".repeat(5500)

    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-speech",
      payload: { text, provider: "elevenlabs-v3", userId: "00000000-0000-4000-8000-000000000001" },
    })

    expect(res.statusCode).toBe(200)
    // Explicit choice is respected — not overridden to turbo despite the length.
    expect(videoQueue.add).toHaveBeenCalledWith(
      "text-to-speech",
      expect.objectContaining({ provider: "elevenlabs-v3" })
    )
    // The pre-existing per-model clamp still truncates the STORED record to
    // v3's 5000-char cap — unchanged by this fix (only the OMITTED-provider
    // resolution is length-aware; an explicit provider's clamp behaves as before).
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        input_data: expect.objectContaining({ text: expect.stringMatching(/^a{5000}$/) }),
      })
    )
  })

  it("sends the CLAMPED text to the worker, not the raw pre-clamp text", async () => {
    mockJobInsert({ data: { id: "job-1" }, error: null })
    const text = "a".repeat(5500)

    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-speech",
      payload: { text, provider: "elevenlabs-v3", userId: "00000000-0000-4000-8000-000000000001" },
    })

    expect(res.statusCode).toBe(200)
    const queueCall = vi.mocked(videoQueue.add).mock.calls[0]
    const queuedPayload = queueCall[1] as { text: string }
    // The worker must receive the clamped text (v3 cap = 5000), not the raw
    // 5500-char input — otherwise the per-model cap never reaches the
    // provider call and elevenlabs rejects the over-long request.
    expect(queuedPayload.text.length).toBe(getMaxTtsChars("elevenlabs-v3"))
    expect(getMaxTtsChars("elevenlabs-v3")).toBe(5000)
  })

  describe("elevenlabs-v4", () => {
    const userId = "00000000-0000-4000-8000-000000000001"

    it("withTimestamps rides to the queue as a boolean; omitted stays omitted; a non-boolean is a 400", async () => {
      mockJobInsert({ data: { id: "job-1" }, error: null })
      await app.inject({ method: "POST", url: "/v1/text-to-speech", payload: { text: "Hi", provider: "elevenlabs-v4", userId, withTimestamps: true } })
      expect(videoQueue.add).toHaveBeenLastCalledWith("text-to-speech", expect.objectContaining({ withTimestamps: true }))

      mockJobInsert({ data: { id: "job-2" }, error: null })
      await app.inject({ method: "POST", url: "/v1/text-to-speech", payload: { text: "Hi", provider: "elevenlabs-v4", userId } })
      const payload = vi.mocked(videoQueue.add).mock.lastCall![1] as Record<string, unknown>
      expect("withTimestamps" in payload).toBe(false)

      const bad = await app.inject({ method: "POST", url: "/v1/text-to-speech", payload: { text: "Hi", provider: "elevenlabs-v4", userId, withTimestamps: "yes" } })
      expect(bad.statusCode).toBe(400)
    })

    it("is accepted, reserved under its own credit id, and queued as itself", async () => {
      mockJobInsert({ data: { id: "job-1" }, error: null })

      const res = await app.inject({
        method: "POST",
        url: "/v1/text-to-speech",
        payload: { text: "hello", provider: "elevenlabs-v4", userId },
      })

      expect(res.statusCode).toBe(200)
      expect(reserveCreditsForJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-1", "elevenlabs-v4")
      expect(videoQueue.add).toHaveBeenCalledWith("text-to-speech", expect.objectContaining({ provider: "elevenlabs-v4" }))
    })

    it("takes the full 10,000 characters unclamped, and clamps past 10,000 (v3 would stop at 5,000)", async () => {
      mockJobInsert({ data: { id: "job-1" }, error: null })
      await app.inject({
        method: "POST",
        url: "/v1/text-to-speech",
        payload: { text: "a".repeat(10000), provider: "elevenlabs-v4", userId },
      })
      expect((vi.mocked(videoQueue.add).mock.calls[0]![1] as { text: string }).text.length).toBe(10000)

      vi.mocked(videoQueue.add).mockClear()
      mockJobInsert({ data: { id: "job-2" }, error: null })
      await app.inject({
        method: "POST",
        url: "/v1/text-to-speech",
        payload: { text: "a".repeat(10001), provider: "elevenlabs-v4", userId },
      })
      expect((vi.mocked(videoQueue.add).mock.calls[0]![1] as { text: string }).text.length).toBe(10000)
    })

    it("is what an omitted provider resolves to (then turbo past its 10,000-character cap)", () => {
      expect(resolveOmittedTtsProvider("short text")).toBe("elevenlabs-v4")
      expect(resolveOmittedTtsProvider("a".repeat(10001))).toBe("elevenlabs-turbo")
    })
  })

  describe("elevenlabs-v4-turbo", () => {
    const userId = "00000000-0000-4000-8000-000000000001"

    it("is accepted, reserved under its own credit id, and queued as itself", async () => {
      mockJobInsert({ data: { id: "job-1" }, error: null })
      const res = await app.inject({ method: "POST", url: "/v1/text-to-speech", payload: { text: "hello", provider: "elevenlabs-v4-turbo", userId } })
      expect(res.statusCode).toBe(200)
      expect(reserveCreditsForJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-1", "elevenlabs-v4-turbo")
      expect(videoQueue.add).toHaveBeenCalledWith("text-to-speech", expect.objectContaining({ provider: "elevenlabs-v4-turbo" }))
    })

    it("takes its sheet's cap unclamped and clamps past it", async () => {
      const cap = getMaxTtsChars("elevenlabs-v4-turbo")
      mockJobInsert({ data: { id: "job-1" }, error: null })
      await app.inject({ method: "POST", url: "/v1/text-to-speech", payload: { text: "a".repeat(cap), provider: "elevenlabs-v4-turbo", userId } })
      expect((vi.mocked(videoQueue.add).mock.calls[0]![1] as { text: string }).text.length).toBe(cap)
      vi.mocked(videoQueue.add).mockClear()
      mockJobInsert({ data: { id: "job-2" }, error: null })
      await app.inject({ method: "POST", url: "/v1/text-to-speech", payload: { text: "a".repeat(cap + 1), provider: "elevenlabs-v4-turbo", userId } })
      expect((vi.mocked(videoQueue.add).mock.calls[0]![1] as { text: string }).text.length).toBe(cap)
    })

    it("is never what an omitted provider resolves to — the default stays v4, the long-text fallback stays turbo v2.5", () => {
      expect(resolveOmittedTtsProvider("short text")).toBe("elevenlabs-v4")
      expect(resolveOmittedTtsProvider("a".repeat(10001))).toBe("elevenlabs-turbo")
    })
  })

  it("maps legacy elevenlabs provider to elevenlabs-turbo", async () => {
    const { mockInsert } = mockJobInsert({
      data: { id: "job-1" },
      error: null,
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-speech",
      payload: {
        text: "Legacy provider test",
        userId: "00000000-0000-4000-8000-000000000001",
        provider: "elevenlabs",
      },
    })

    expect(res.statusCode).toBe(200)

    // input_data preserves the user's submitted provider value verbatim.
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        input_data: expect.objectContaining({
          provider: "elevenlabs",
          type: "text-to-speech",
        }),
      })
    )

    // The BullMQ worker still receives the mapped "elevenlabs-turbo" provider.
    expect(videoQueue.add).toHaveBeenCalledWith(
      "text-to-speech",
      expect.objectContaining({
        provider: "elevenlabs-turbo",
      })
    )
  })

  it("returns 500 when job insert fails", async () => {
    mockJobInsert({
      data: null,
      error: { message: "DB connection failed" },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-speech",
      payload: {
        text: "Hello world",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(500)
    const body = res.json()
    expect(body.error.code).toBe("internal_error")
  })
})
