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

// The voiced path computes the audio addon in the route handler body via
// getModelCreditBaseCost (creditGuard's computeCredits is bypassed by the mock
// above). Stub it so the addon math is deterministic and never touches the DB.
vi.mock("@/ee/billing/credits.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, getModelCreditBaseCost: vi.fn().mockResolvedValue({ creditCost: 4 }) }
})

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

import { generateVideoRoutes, assembleVideoConnectedReferences } from "../generate-video.js"
import { VIDEO_REF_LIMITS_BY_PROVIDER, type ConnectedReference } from "@nodaro/shared"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { probeMediaDuration } from "../../providers/video/ffmpeg-utils.js"
import { registerPromptPolicy, clearPromptPolicies } from "../../lib/prompt-policy.js"

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

  it("ignores the deprecated seedance2InputMode field and still validates reference audio", async () => {
    // seedance2InputMode is accepted-but-ignored for back-compat. The mode is
    // now auto-detected downstream by resolveSeedance2Inputs, so reference audio
    // must be validated regardless of any (legacy) mode value — a previously
    // "frames"-mode request with over-limit audio is still rejected.
    vi.mocked(probeMediaDuration).mockResolvedValue(21)
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: { ...SEEDANCE_BODY, seedance2InputMode: "frames" },
    })
    expect(probeMediaDuration).toHaveBeenCalledWith("https://cdn.example/voice.mp3")
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("audio_too_long")
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
        url: "/v1/generate-video",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "a dog runs",
          userId: "00000000-0000-4000-8000-000000000001",
          provider: "kling",
        },
      })
      expect(res.statusCode).toBe(200)
      const queued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
      expect(queued.prompt).toBe("a dog runs VID")
    })

    it("is byte-identical when no policy is registered", async () => {
      mockJobInsert({ data: { id: "job-1" }, error: null })
      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-video",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "a dog runs",
          userId: "00000000-0000-4000-8000-000000000001",
          provider: "kling",
        },
      })
      expect(res.statusCode).toBe(200)
      const queued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
      expect(queued.prompt).toBe("a dog runs")
    })
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

  it("persists attachReferenceVideoVariant in input_data so finalize can auto-attach the clip", async () => {
    const { mockInsert } = mockJobInsert({ data: { id: "job-1" }, error: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        imageUrl: "https://example.com/image.png",
        prompt: "she smiles",
        userId: "00000000-0000-4000-8000-000000000001",
        provider: "kling",
        attachToCharacterId: "00000000-0000-4000-8000-0000000000cc",
        attachReferenceVideoVariant: "happy",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        input_data: expect.objectContaining({
          attachToCharacterId: "00000000-0000-4000-8000-0000000000cc",
          attachReferenceVideoVariant: "happy",
        }),
      }),
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

describe("POST /v1/generate-video — character voice (voiced-video)", () => {
  const USER = "00000000-0000-4000-8000-000000000001"

  it("enqueues a voiced-video job (with the voice spec + addon) for a dialogue-capable provider", async () => {
    mockJobInsert({ data: { id: "job-voiced" }, error: null })
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        imageUrl: "https://example.com/face.png",
        prompt: "she greets the room",
        userId: USER,
        provider: "veo3.1",
        characterVoices: [{ voiceId: "anna-voice", speaker: "Anna" }],
        dialogue: [{ speaker: "Anna", line: "good morning" }],
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-voiced")
    expect(res.json().warnings).toBeUndefined()
    expect(videoQueue.add).toHaveBeenCalledWith(
      "voiced-video",
      expect.objectContaining({
        jobId: "job-voiced",
        provider: "veo3.1",
        characterVoices: [{ voiceId: "anna-voice", speaker: "Anna" }],
        dialogue: [{ speaker: "Anna", line: "good morning" }],
        voicedAudioAddon: 4,
      }),
    )
  })

  it("falls back to a silent image-to-video job + warning for a non-dialogue provider (never fails the clip)", async () => {
    mockJobInsert({ data: { id: "job-silent" }, error: null })
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        imageUrl: "https://example.com/face.png",
        prompt: "she waves",
        userId: USER,
        provider: "minimax",
        characterVoices: [{ voiceId: "anna-voice", speaker: "Anna" }],
        dialogue: [{ speaker: "Anna", line: "hi" }],
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe("job-silent")
    expect(body.warnings?.[0]?.code).toBe("voice_unsupported_for_provider")
    // Enqueued as a plain i2v job; the voice spec is NOT forwarded to the worker.
    expect(videoQueue.add).toHaveBeenCalledWith(
      "image-to-video",
      expect.not.objectContaining({ characterVoices: expect.anything() }),
    )
  })

  it("ignores an empty voice spec — normal image-to-video, no warning", async () => {
    mockJobInsert({ data: { id: "job-plain" }, error: null })
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        imageUrl: "https://example.com/face.png",
        prompt: "slow pan",
        userId: USER,
        provider: "veo3.1",
        characterVoices: [],
        dialogue: [],
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().warnings).toBeUndefined()
    const [jobName] = vi.mocked(videoQueue.add).mock.calls.at(-1)!
    expect(jobName).toBe("image-to-video")
  })
})

// ---------------------------------------------------------------------------
// connectedReferences — server-side reference assembly (parity with
// generate-image). Pure-helper unit tests exercise the assembly semantics
// directly; the route-integration tests below confirm the assembled prompt +
// referenceImageUrls reach the worker payload + job record.
// ---------------------------------------------------------------------------

/** Minimal ConnectedReference factory for the helper unit tests. */
function cref(
  over: Partial<ConnectedReference> & { source: ConnectedReference["source"]; url: string },
): ConnectedReference {
  return {
    id: over.id ?? over.url,
    defaultName: over.defaultName ?? "object",
    ...over,
  } as ConnectedReference
}

describe("assembleVideoConnectedReferences (server-side video reference assembly)", () => {
  it("auto-attaches an unmentioned wired-image ref + emits an @image_N (reference) directive", () => {
    const out = assembleVideoConnectedReferences({
      prompt: "a person dancing",
      provider: "seedance-2",
      connectedReferences: [cref({ source: "wired-image", url: "https://r2/car.png", description: "a red car" })],
      referenceVideoCount: 0,
      referenceAudioCount: 0,
    })
    expect(out.referenceImageUrls).toEqual(["https://r2/car.png"])
    expect(out.prompt).toContain("@image_1")
    expect(out.prompt).toContain("a red car")
    expect(out.prompt).toContain("a person dancing")
  })

  it("expands {image:N:label} tokens to @image_N subject bindings", () => {
    const out = assembleVideoConnectedReferences({
      prompt: "drive {image:1:car} fast",
      provider: "seedance-2",
      connectedReferences: [cref({ source: "wired-image", url: "https://r2/car.png", description: "a red car" })],
      referenceVideoCount: 0,
      referenceAudioCount: 0,
    })
    expect(out.prompt).toContain("the car from @image_1")
    expect(out.referenceImageUrls).toEqual(["https://r2/car.png"])
  })

  it("emits a canonical-fallback identity directive for an unmentioned wired character", () => {
    const out = assembleVideoConnectedReferences({
      prompt: "she walks",
      provider: "seedance-2",
      connectedReferences: [
        cref({
          source: "wired-character",
          url: "https://r2/kira.png",
          defaultName: "Kira",
          characterSlug: "kira",
          characterCanonicalDescription: "auburn hair, hazel eyes",
        }),
      ],
      referenceVideoCount: 0,
      referenceAudioCount: 0,
    })
    expect(out.referenceImageUrls).toEqual(["https://r2/kira.png"])
    expect(out.prompt).toContain("Use these characters:")
    expect(out.prompt).toContain("Kira")
  })

  it("strips {image:N} to bare labels + attaches nothing for a provider without image-ref support", () => {
    const out = assembleVideoConnectedReferences({
      prompt: "drive {image:1:car} fast",
      provider: "kling", // not in VIDEO_REF_LIMITS_BY_PROVIDER → image cap 0
      connectedReferences: [cref({ source: "wired-image", url: "https://r2/car.png", description: "car" })],
      referenceVideoCount: 0,
      referenceAudioCount: 0,
    })
    expect(out.prompt).toBe("drive car fast")
    expect(out.referenceImageUrls).toBeUndefined()
  })

  it("dedups + caps the merged reference list at the provider's image limit (seedance-2 = 9)", () => {
    const refs = Array.from({ length: 11 }, (_, i) =>
      cref({ source: "wired-image", url: `https://r2/img${i}.png`, description: `img ${i}` }),
    )
    const out = assembleVideoConnectedReferences({
      prompt: "scene",
      provider: "seedance-2",
      connectedReferences: refs,
      referenceVideoCount: 0,
      referenceAudioCount: 0,
    })
    expect(out.referenceImageUrls).toHaveLength(9)
  })

  it("never emits an @image_N directive past the cap (veo3 = 3)", () => {
    // VEO carries up to 3 reference images (REFERENCE_2_VIDEO). Four wired refs
    // must assemble to THREE URLs AND three directives — never a dangling
    // @image_4 pointing at the dropped slot. (Regression: the core numbered every
    // ref, then the route sliced URLs to the cap AFTER assembly, leaving @image_N+
    // binding nothing.)
    const out = assembleVideoConnectedReferences({
      prompt: "a chase scene",
      provider: "veo3",
      connectedReferences: [
        cref({ source: "wired-image", url: "https://r2/a.png", description: "a red car" }),
        cref({ source: "wired-image", url: "https://r2/b.png", description: "a brown dog" }),
        cref({ source: "wired-image", url: "https://r2/c.png", description: "a blue bike" }),
        cref({ source: "wired-image", url: "https://r2/d.png", description: "a green truck" }),
      ],
      referenceVideoCount: 0,
      referenceAudioCount: 0,
    })
    expect(out.referenceImageUrls).toEqual(["https://r2/a.png", "https://r2/b.png", "https://r2/c.png"])
    expect(out.prompt).toContain("@image_3")
    expect(out.prompt).not.toContain("@image_4")
  })

  it("never numbers @image_N past the cap when more refs than the limit are supplied (seedance-2 = 9)", () => {
    const refs = Array.from({ length: 11 }, (_, i) =>
      cref({ source: "wired-image", url: `https://r2/img${i}.png`, description: `img ${i}` }),
    )
    const out = assembleVideoConnectedReferences({
      prompt: "scene",
      provider: "seedance-2",
      connectedReferences: refs,
      referenceVideoCount: 0,
      referenceAudioCount: 0,
    })
    expect(out.referenceImageUrls).toHaveLength(9)
    expect(out.prompt).toContain("@image_9")
    expect(out.prompt).not.toContain("@image_10")
    expect(out.prompt).not.toContain("@image_11")
  })

  it("resolves a {image:N} body token only within the cap; out-of-range drops to its bare label (veo3 = 3)", () => {
    // {image:4:truck} exceeds the 3-image cap → must NOT bind to a dropped slot;
    // it falls back to the bare label "truck" (the resolveReferenceTokens contract).
    const out = assembleVideoConnectedReferences({
      prompt: "drive {image:1:car} past the {image:4:truck}",
      provider: "veo3",
      connectedReferences: [
        cref({ source: "wired-image", url: "https://r2/a.png", description: "a red car" }),
        cref({ source: "wired-image", url: "https://r2/b.png", description: "a brown dog" }),
        cref({ source: "wired-image", url: "https://r2/c.png", description: "a blue bike" }),
        cref({ source: "wired-image", url: "https://r2/d.png", description: "a green truck" }),
      ],
      referenceVideoCount: 0,
      referenceAudioCount: 0,
    })
    expect(out.referenceImageUrls).toEqual(["https://r2/a.png", "https://r2/b.png", "https://r2/c.png"])
    expect(out.prompt).toContain("the car from @image_1")
    expect(out.prompt).not.toContain("@image_4")
    expect(out.prompt).toContain("past the truck")
  })

  it("leads with caller-sent flat refs (image-refs-first, D5), then assets; dedups across both", () => {
    const out = assembleVideoConnectedReferences({
      prompt: "scene",
      provider: "seedance-2",
      connectedReferences: [
        cref({ source: "wired-image", url: "https://r2/asset.png", description: "asset" }),
        cref({ source: "wired-image", url: "https://r2/a.png", description: "dup of a flat ref" }),
      ],
      baseReferenceImageUrls: ["https://r2/b.png", "https://r2/a.png"],
      referenceVideoCount: 0,
      referenceAudioCount: 0,
    })
    // D5: flat refs LEAD (@image_1=b, @image_2=a), then the unique asset (@image_3);
    // the asset whose URL dups a flat ref drops.
    expect(out.referenceImageUrls).toEqual(["https://r2/b.png", "https://r2/a.png", "https://r2/asset.png"])
  })

  it("D5 ordinal offset: a leading flat ref is @image_1, the asset token binds @image_2", () => {
    const out = assembleVideoConnectedReferences({
      prompt: "the {image:2:object} on a {image:1:table}",
      provider: "seedance-2",
      connectedReferences: [cref({ source: "wired-image", url: "https://r2/obj.png", description: "object" })],
      baseReferenceImageUrls: ["https://r2/table.png"],
      referenceVideoCount: 0,
      referenceAudioCount: 0,
    })
    // payload order: flat ref first (@image_1), asset second (@image_2)
    expect(out.referenceImageUrls).toEqual(["https://r2/table.png", "https://r2/obj.png"])
    // body tokens resolve against the unified numbering
    expect(out.prompt).toContain("the table from @image_1")
    expect(out.prompt).toContain("the object from @image_2")
  })

  it("honors referenceOrder (reverses two extra refs by their wired:<url> tile id)", () => {
    const out = assembleVideoConnectedReferences({
      prompt: "scene",
      provider: "seedance-2",
      connectedReferences: [
        cref({ id: "r1", source: "wired-image", url: "https://r2/a.png", description: "car" }),
        cref({ id: "r2", source: "wired-image", url: "https://r2/b.png", description: "dog" }),
      ],
      referenceOrder: ["wired:https://r2/b.png", "wired:https://r2/a.png"],
      referenceVideoCount: 0,
      referenceAudioCount: 0,
    })
    expect(out.referenceImageUrls).toEqual(["https://r2/b.png", "https://r2/a.png"])
  })
})

describe("POST /v1/generate-video — connectedReferences integration", () => {
  const USER = "00000000-0000-4000-8000-000000000001"

  it("assembles connectedReferences server-side: assembled prompt + merged refs reach the queue", async () => {
    mockJobInsert({ data: { id: "job-cr" }, error: null })
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        prompt: "drive {image:1:car} fast",
        userId: USER,
        provider: "seedance-2",
        connectedReferences: [
          { id: "r1", defaultName: "object", source: "wired-image", url: "https://cdn.example/car.png", description: "a red car" },
        ],
      },
    })
    expect(res.statusCode).toBe(200)
    const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)![1] as Record<string, unknown>
    expect(queued.prompt).toContain("the car from @image_1")
    expect(queued.referenceImageUrls).toEqual(["https://cdn.example/car.png"])
  })

  it("records the assembled referenceImageUrls in job input_data", async () => {
    const { mockInsert } = mockJobInsert({ data: { id: "job-cr2" }, error: null })
    await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        prompt: "a person",
        userId: USER,
        provider: "seedance-2",
        connectedReferences: [
          { id: "r1", defaultName: "object", source: "wired-image", url: "https://cdn.example/x.png", description: "thing" },
        ],
      },
    })
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        input_data: expect.objectContaining({
          referenceImageUrls: ["https://cdn.example/x.png"],
        }),
      }),
    )
  })

  it("is backward-compatible: no connectedReferences → prompt + flat refs pass through unchanged", async () => {
    mockJobInsert({ data: { id: "job-flat" }, error: null })
    await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        prompt: "plain prompt",
        userId: USER,
        provider: "seedance-2",
        referenceImageUrls: ["https://cdn.example/flat.png"],
      },
    })
    const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)![1] as Record<string, unknown>
    expect(queued.prompt).toBe("plain prompt")
    expect(queued.referenceImageUrls).toEqual(["https://cdn.example/flat.png"])
  })

  it("rejects a connectedReference with an invalid url (SSRF/Zod gate parity with flat refs)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        prompt: "x",
        userId: USER,
        provider: "seedance-2",
        connectedReferences: [
          { id: "r1", defaultName: "object", source: "wired-image", url: "not-a-url", description: "bad" },
        ],
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("allows a connectedReferences-only request (no imageUrl) for a ref-capable provider", async () => {
    mockJobInsert({ data: { id: "job-noimg" }, error: null })
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        prompt: "scene",
        userId: USER,
        provider: "seedance-2",
        connectedReferences: [
          { id: "r1", defaultName: "object", source: "wired-image", url: "https://cdn.example/x.png", description: "thing" },
        ],
      },
    })
    expect(res.statusCode).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// References-only runs — the imageUrl exemption is catalog-driven
// ---------------------------------------------------------------------------

describe("POST /v1/generate-video — references-only (catalog-driven imageUrl exemption)", () => {
  const USER = "00000000-0000-4000-8000-000000000001"
  const REFS = ["https://cdn.example/ref-1.png", "https://cdn.example/ref-2.png"]

  it("accepts a references-only kling-3-omni run (prod repro: 2 refs, duration 15, no imageUrl)", async () => {
    mockJobInsert({ data: { id: "job-k3o" }, error: null })
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        userId: USER,
        provider: "kling-3-omni",
        prompt: "two subjects interacting",
        referenceImageUrls: REFS,
        duration: 15,
      },
    })
    expect(res.statusCode).toBe(200)
    const addMock = vi.mocked(videoQueue.add)
    expect(addMock).toHaveBeenCalledTimes(1)
    const [jobName, payload] = addMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(jobName).toBe("image-to-video")
    expect(payload.referenceImageUrls).toEqual(REFS)
    expect(payload.imageUrl).toBeUndefined()
  })

  it("every catalog provider with an image-ref cap accepts a references-only run (drift guard)", async () => {
    // The References UI offers refs to every provider advertising a cap in
    // VIDEO_REF_LIMITS_BY_PROVIDER — a provider added there without this route
    // accepting its ref-only runs is the exact regression that 400'd
    // kling-3-omni / grok-i2v / happyhorse-ref2v.
    const imageRefProviders = Object.entries(VIDEO_REF_LIMITS_BY_PROVIDER)
      .filter(([, caps]) => (caps?.images ?? 0) > 0)
      .map(([provider]) => provider)
    expect(imageRefProviders.length).toBeGreaterThan(0)
    mockJobInsert({ data: { id: "job-any" }, error: null })
    for (const provider of imageRefProviders) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-video",
        payload: {
          userId: USER,
          provider,
          prompt: "references only",
          referenceImageUrls: [REFS[0]],
        },
      })
      expect(res.statusCode, `provider ${provider} must accept a references-only run`).toBe(200)
    }
  })

  it("normalizes a VEO references-only run to REFERENCE_2_VIDEO (parity with the orchestrator)", async () => {
    mockJobInsert({ data: { id: "job-veo-ref" }, error: null })
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        userId: USER,
        provider: "veo3.1",
        prompt: "scene from references",
        referenceImageUrls: REFS,
      },
    })
    expect(res.statusCode).toBe(200)
    const [, payload] = vi.mocked(videoQueue.add).mock.calls[0] as [string, Record<string, unknown>]
    // Without this hint the KIE i2v VEO branch ships imageUrls=[undefined].
    expect(payload.generationType).toBe("REFERENCE_2_VIDEO")
  })

  it("does NOT inject REFERENCE_2_VIDEO for a VEO run that has a start frame", async () => {
    mockJobInsert({ data: { id: "job-veo-i2v" }, error: null })
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        userId: USER,
        provider: "veo3.1",
        prompt: "animate this",
        imageUrl: "https://cdn.example/start.png",
        referenceImageUrls: REFS,
      },
    })
    expect(res.statusCode).toBe(200)
    const [, payload] = vi.mocked(videoQueue.add).mock.calls[0] as [string, Record<string, unknown>]
    expect(payload.generationType).toBeUndefined()
  })

  it("still rejects references-only for a provider with no ref caps (refs would be silently dropped)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        userId: USER,
        provider: "wan-i2v",
        prompt: "motion",
        referenceImageUrls: REFS,
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toBe("imageUrl is required")
  })

  it("rejects audio-only references on an images-only provider (kind not carryable)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        userId: USER,
        provider: "kling-3-omni",
        prompt: "narrated scene",
        referenceAudioUrls: ["https://cdn.example/voice.mp3"],
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toBe("imageUrl is required")
  })

  it("keeps the Seedance 2 audio-only exemption (audio IS a carryable kind there)", async () => {
    mockJobInsert({ data: { id: "job-s2-audio" }, error: null })
    vi.mocked(probeMediaDuration).mockResolvedValue(10)
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        userId: USER,
        provider: "seedance-2",
        prompt: "a person speaking",
        referenceAudioUrls: ["https://cdn.example/voice.mp3"],
      },
    })
    expect(res.statusCode).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// `{ref:<id>}` — id-addressed reference tokens (the Studio contract).
//
// Studio sends `connectedReferences` and writes `{ref:<connectedReference.id>}`
// where the picture is used in the prose. The ROUTE numbers the references
// (rail first, then canonical characters, then extras) and substitutes the
// slot — the client never mirrors the walk.
// ---------------------------------------------------------------------------
describe("assembleVideoConnectedReferences — {ref:<id>} id-addressed tokens", () => {
  it("the studio scene: rail + [character view, canonical character, image, image] → @image_3 / @image_2 / @image_4 / @image_5, legend agrees", () => {
    const out = assembleVideoConnectedReferences({
      prompt: "{ref:view-1} turns to {ref:char-kira}, then {ref:https://r2/p1.png} and {ref:https://r2/p2.png:poster}",
      provider: "seedance-2",
      connectedReferences: [
        cref({ id: "view-1", source: "wired-character", url: "https://r2/kira-side.png", defaultName: "Kira / side", characterSlug: "kira", variantSlug: "side", isExtraRef: true, description: "side profile" }),
        cref({ id: "char-kira", source: "wired-character", url: "https://r2/kira.png", defaultName: "Kira", characterSlug: "kira" }),
        cref({ id: "https://r2/p1.png", source: "wired-image", url: "https://r2/p1.png", defaultName: "photo 1", description: "a city street" }),
        cref({ id: "https://r2/p2.png", source: "wired-image", url: "https://r2/p2.png", defaultName: "photo 2", description: "a movie poster" }),
      ],
      baseReferenceImageUrls: ["https://r2/rail.png"],
      referenceVideoCount: 0,
      referenceAudioCount: 0,
    })
    // Payload order = the numbering: rail, canonical, then the extras in order.
    expect(out.referenceImageUrls).toEqual([
      "https://r2/rail.png",
      "https://r2/kira.png",
      "https://r2/kira-side.png",
      "https://r2/p1.png",
      "https://r2/p2.png",
    ])
    // The tokens landed on the same seats the legend lines describe.
    expect(out.prompt).toContain("@image_3 turns to @image_2, then @image_4 and the poster from @image_5")
    expect(out.prompt).toContain("- @image_3 is the same subject as @image_2, side profile.")
    expect(out.prompt).toContain("- @image_4 (reference): a city street.")
    expect(out.prompt).toContain("- @image_5 (reference): a movie poster.")
    expect(out.prompt).not.toMatch(/\{ref:/i)
  })

  it("a ref capped out by the provider limit keeps its name — never a binding onto a dropped seat (veo3 = 3)", () => {
    const out = assembleVideoConnectedReferences({
      prompt: "{ref:d} chases {ref:c}",
      provider: "veo3",
      connectedReferences: [
        cref({ id: "a", source: "wired-image", url: "https://r2/a.png", defaultName: "car", description: "a red car" }),
        cref({ id: "b", source: "wired-image", url: "https://r2/b.png", defaultName: "dog", description: "a brown dog" }),
        cref({ id: "c", source: "wired-image", url: "https://r2/c.png", defaultName: "bike", description: "a blue bike" }),
        cref({ id: "d", source: "wired-image", url: "https://r2/d.png", defaultName: "the green truck", description: "a green truck" }),
      ],
      referenceVideoCount: 0,
      referenceAudioCount: 0,
    })
    expect(out.referenceImageUrls).toEqual(["https://r2/a.png", "https://r2/b.png", "https://r2/c.png"])
    expect(out.prompt).toContain("the green truck chases @image_3")
    expect(out.prompt).not.toContain("@image_4")
    expect(out.prompt).not.toMatch(/\{ref:/i)
  })

  it("a provider without image-ref support degrades every {ref:} — label, then name, then nothing — and attaches nothing", () => {
    const out = assembleVideoConnectedReferences({
      prompt: "{ref:a:the car} passes {ref:b} near {ref:zzz}",
      provider: "kling", // not in VIDEO_REF_LIMITS_BY_PROVIDER → image cap 0
      connectedReferences: [
        cref({ id: "a", source: "wired-image", url: "https://r2/a.png", defaultName: "car", description: "a red car" }),
        cref({ id: "b", source: "wired-image", url: "https://r2/b.png", defaultName: "the brown dog", description: "a brown dog" }),
      ],
      referenceVideoCount: 0,
      referenceAudioCount: 0,
    })
    expect(out.prompt).toBe("the car passes the brown dog near")
    expect(out.referenceImageUrls).toBeUndefined()
  })

  it("a prompt that is ONLY an unresolvable token ships as empty text, not as the raw token", () => {
    const out = assembleVideoConnectedReferences({
      prompt: "{ref:zzz}",
      provider: "kling",
      connectedReferences: [cref({ id: "a", source: "wired-image", url: "https://r2/a.png", description: "car" })],
      referenceVideoCount: 0,
      referenceAudioCount: 0,
    })
    expect(out.prompt ?? "").not.toMatch(/\{ref:/i)
  })
})
