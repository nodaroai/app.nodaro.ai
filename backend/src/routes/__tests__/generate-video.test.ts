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

vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, probeMediaDuration: vi.fn() }
})

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

import { generateVideoRoutes } from "../generate-video.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { probeMediaDuration } from "../../providers/video/ffmpeg-utils.js"

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
    await generateVideoRoutes(instance)
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

describe("POST /v1/generate-video — Seedance 2 reference-audio limit", () => {
  const SEEDANCE_BODY = {
    userId: "00000000-0000-4000-8000-000000000001",
    provider: "seedance-2-fast",
    prompt: "a person speaking",
    referenceImageUrls: ["https://cdn.example/face.png"],
    referenceAudioUrls: ["https://cdn.example/voice.mp3"],
  }

  it("rejects with 400 audio_too_long when reference audio exceeds the 15.2s cap", async () => {
    vi.mocked(probeMediaDuration).mockResolvedValue(21)
    const res = await app.inject({ method: "POST", url: "/v1/generate-video", payload: SEEDANCE_BODY })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("audio_too_long")
    expect(probeMediaDuration).toHaveBeenCalledWith("https://cdn.example/voice.mp3")
  })

  it("does NOT reject for audio within the 15.2s cap (probe ran and passed)", async () => {
    mockJobInsert({ data: { id: "job-ok" }, error: null })
    vi.mocked(probeMediaDuration).mockResolvedValue(12)
    const res = await app.inject({ method: "POST", url: "/v1/generate-video", payload: SEEDANCE_BODY })
    expect(probeMediaDuration).toHaveBeenCalled()
    // The preHandler must not be the one rejecting — any 400 here would be a
    // downstream/Zod concern, never audio_too_long.
    if (res.statusCode === 400) {
      expect(res.json().error.code).not.toBe("audio_too_long")
    }
  })

  it("does not probe audio for providers without an enforced cap", async () => {
    mockJobInsert({ data: { id: "job-mm" }, error: null })
    await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: { ...SEEDANCE_BODY, provider: "minimax" },
    })
    expect(probeMediaDuration).not.toHaveBeenCalled()
  })

  it("skips the audio check in frames input mode (audio is dropped there)", async () => {
    mockJobInsert({ data: { id: "job-frames" }, error: null })
    await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: { ...SEEDANCE_BODY, seedance2InputMode: "frames" },
    })
    expect(probeMediaDuration).not.toHaveBeenCalled()
  })
})

describe("POST /v1/generate-video", () => {
  it("returns 400 when imageUrl is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: { userId: "00000000-0000-4000-8000-000000000001" },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns 400 when provider is invalid", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        imageUrl: "https://example.com/image.png",
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
      url: "/v1/generate-video",
      payload: { imageUrl: "https://example.com/image.png" },
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
      url: "/v1/generate-video",
      payload: {
        imageUrl: "https://example.com/image.png",
        prompt: "camera slowly zooms in",
        userId: "00000000-0000-4000-8000-000000000001",
        provider: "kling",
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
          imageUrl: "https://example.com/image.png",
          provider: "kling",
          type: "image-to-video",
        }),
      })
    )

    expect(videoQueue.add).toHaveBeenCalledWith(
      "image-to-video",
      expect.objectContaining({
        jobId: "job-1",
        imageUrl: "https://example.com/image.png",
        provider: "kling",
        prompt: "camera slowly zooms in",
      })
    )
  })

  it("passes endFrameUrl through to job and queue", async () => {
    const { mockInsert } = mockJobInsert({
      data: { id: "job-1" },
      error: null,
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        imageUrl: "https://example.com/start.png",
        endFrameUrl: "https://example.com/end.png",
        userId: "00000000-0000-4000-8000-000000000001",
        provider: "minimax",
      },
    })

    expect(res.statusCode).toBe(200)

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        input_data: expect.objectContaining({
          imageUrl: "https://example.com/start.png",
          endFrameUrl: "https://example.com/end.png",
        }),
      })
    )

    expect(videoQueue.add).toHaveBeenCalledWith(
      "image-to-video",
      expect.objectContaining({
        imageUrl: "https://example.com/start.png",
        endFrameUrl: "https://example.com/end.png",
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
      url: "/v1/generate-video",
      payload: {
        imageUrl: "https://example.com/image.png",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(500)
    const body = res.json()
    expect(body.error.code).toBe("internal_error")
  })

  // -------------------------------------------------------------------------
  // Identity injection — injectCharacterContext + attachToCharacterId append
  // the character's canonical_description + an identity-preserve suffix to
  // the prompt before worker enqueue. Default off (no DB lookup, no prompt
  // mutation, no characters table query).
  // -------------------------------------------------------------------------

  describe("identity injection (injectCharacterContext)", () => {
    const CHARACTER_ID = "00000000-0000-4000-8000-0000000000cc"
    const VALID_UUID = "00000000-0000-4000-8000-000000000001"

    function setupSupabaseMock(opts: {
      charRow?: { canonical_description: string | null; description: string | null; name: string | null } | null
    }) {
      const charSingle = vi.fn().mockResolvedValue({ data: opts.charRow ?? null, error: null })
      const charIs = vi.fn().mockReturnValue({ single: charSingle })
      const charEq2 = vi.fn().mockReturnValue({ is: charIs })
      const charEq1 = vi.fn().mockReturnValue({ eq: charEq2 })
      const charSelect = vi.fn().mockReturnValue({ eq: charEq1 })

      const jobSingle = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
      const jobSelect = vi.fn().mockReturnValue({ single: jobSingle })
      const jobInsert = vi.fn().mockReturnValue({ select: jobSelect })

      const fromMock = vi.mocked(supabase.from)
      fromMock.mockImplementation((table: string) => {
        if (table === "characters") return { select: charSelect } as never
        if (table === "jobs") return { insert: jobInsert } as never
        return {} as never
      })
      return { charSelect, charEq1, charEq2, charIs, fromMock }
    }

    it("does NOT query characters when injectCharacterContext is omitted (default off)", async () => {
      const { fromMock } = setupSupabaseMock({ charRow: { canonical_description: "ignored", description: null, name: "Kira" } })

      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-video",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "slow zoom",
          userId: VALID_UUID,
          provider: "kling",
        },
      })

      expect(res.statusCode).toBe(200)
      const tablesQueried = fromMock.mock.calls.map((c) => c[0])
      expect(tablesQueried).not.toContain("characters")
      const queuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
      expect(queuedPayload.prompt).toBe("slow zoom")
    })

    it("appends canonical_description + identity-preserve suffix to the worker prompt", async () => {
      setupSupabaseMock({
        charRow: {
          canonical_description: "A woman in her late 20s with auburn hair and warm hazel eyes.",
          description: null,
          name: "Kira",
        },
      })

      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-video",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "she walks forward",
          userId: VALID_UUID,
          provider: "kling",
          injectCharacterContext: true,
          attachToCharacterId: CHARACTER_ID,
        },
      })

      expect(res.statusCode).toBe(200)
      const queuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
      const queuedPrompt = queuedPayload.prompt as string
      expect(queuedPrompt).toContain("she walks forward")
      expect(queuedPrompt).toContain("auburn hair")
      expect(queuedPrompt).toContain("warm hazel eyes")
      expect(queuedPrompt).toContain("same person")
    })

    it("injects even when no prompt is provided (image-to-video allows undefined prompt)", async () => {
      setupSupabaseMock({
        charRow: {
          canonical_description: "Athletic woman, brown eyes.",
          description: null,
          name: "Aldric",
        },
      })

      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-video",
        payload: {
          imageUrl: "https://example.com/image.png",
          // no prompt
          userId: VALID_UUID,
          provider: "kling",
          injectCharacterContext: true,
          attachToCharacterId: CHARACTER_ID,
        },
      })

      expect(res.statusCode).toBe(200)
      const queuedPrompt = (vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>).prompt as string
      expect(queuedPrompt).toContain("Athletic woman")
      expect(queuedPrompt).toContain("same person")
    })

    it("falls back to description when canonical_description is empty", async () => {
      setupSupabaseMock({
        charRow: {
          canonical_description: "",
          description: "Older man, deep voice.",
          name: "Aldric",
        },
      })

      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-video",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "sitting by the fire",
          userId: VALID_UUID,
          provider: "kling",
          injectCharacterContext: true,
          attachToCharacterId: CHARACTER_ID,
        },
      })

      expect(res.statusCode).toBe(200)
      const queuedPrompt = (vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>).prompt as string
      expect(queuedPrompt).toContain("Older man")
    })

    it("does NOT inject when both canonical_description and description are empty (skip name-only)", async () => {
      setupSupabaseMock({
        charRow: { canonical_description: "", description: null, name: "Kira" },
      })

      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-video",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "moving",
          userId: VALID_UUID,
          provider: "kling",
          injectCharacterContext: true,
          attachToCharacterId: CHARACTER_ID,
        },
      })

      expect(res.statusCode).toBe(200)
      const queuedPrompt = (vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>).prompt as string
      expect(queuedPrompt).toBe("moving")
      expect(queuedPrompt).not.toContain("same person")
    })

    it("scopes the characters lookup by user_id (defense in depth IDOR)", async () => {
      const { charEq1, charEq2, charIs } = setupSupabaseMock({
        charRow: { canonical_description: "ignored", description: null, name: "Kira" },
      })

      await app.inject({
        method: "POST",
        url: "/v1/generate-video",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "slow zoom",
          userId: VALID_UUID,
          provider: "kling",
          injectCharacterContext: true,
          attachToCharacterId: CHARACTER_ID,
        },
      })

      expect(charEq1).toHaveBeenCalledWith("id", CHARACTER_ID)
      expect(charEq2).toHaveBeenCalledWith("user_id", VALID_UUID)
      expect(charIs).toHaveBeenCalledWith("deleted_at", null)
    })
  })

  it("accepts t2v-only providers via the unified VIDEO_GEN_PROVIDERS enum", async () => {
    // pick a provider that's in TEXT_TO_VIDEO_PROVIDERS but NOT IMAGE_TO_VIDEO_PROVIDERS
    const { TEXT_TO_VIDEO_PROVIDERS, IMAGE_TO_VIDEO_PROVIDERS } = await import("@nodaro/shared")
    const t2vOnly = TEXT_TO_VIDEO_PROVIDERS.find(
      (p) => !(IMAGE_TO_VIDEO_PROVIDERS as readonly string[]).includes(p),
    )
    if (!t2vOnly) return  // no t2v-only providers — test passes vacuously

    mockJobInsert({ data: { id: "job-1" }, error: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        imageUrl: "https://example.com/image.png",
        prompt: "a cinematic wide shot",
        userId: "00000000-0000-4000-8000-000000000001",
        provider: t2vOnly,
      },
    })

    // Must NOT be a 400 with a Zod "invalid_enum_value" error on `provider`.
    if (res.statusCode === 400) {
      const body = res.json()
      const issues = (body?.error?.issues ?? []) as Array<{ path?: unknown[]; code?: string }>
      const providerEnumRejection = issues.some(
        (i) => Array.isArray(i.path) && i.path[0] === "provider" && i.code === "invalid_enum_value",
      )
      expect(providerEnumRejection, `provider="${t2vOnly}" rejected by Zod enum`).toBe(false)
    }

    expect(res.statusCode).toBe(200)
  })
})
