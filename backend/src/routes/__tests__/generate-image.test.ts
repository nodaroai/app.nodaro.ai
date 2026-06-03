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
    CHARACTER_LORA_ROUTING_ENABLED: true,
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

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { generateImageRoutes, generateImageBody } from "../generate-image.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { FLUX_LORA_CHARACTER_MODEL_ID } from "@nodaro/shared"

// ---------------------------------------------------------------------------
// aspectRatio enum must cover every provider's catalog ratios. Wan 2.7 /
// Wan 2.7 Pro expose ultra-wide 8:1 and 1:8 in the picker (the per-provider
// fail-safe useEffect deliberately keeps them because they're valid catalog
// values); the route Zod enum omitted them, so selecting either 400'd at
// generate time. Guard the specific gap + the common ratios.
// ---------------------------------------------------------------------------
describe("generateImageBody aspectRatio enum", () => {
  const aspectRatioEnum = new Set(
    (generateImageBody.shape.aspectRatio.unwrap() as { options: readonly string[] }).options,
  )

  it("includes Wan 2.7 ultra-wide ratios 8:1 and 1:8", () => {
    expect(aspectRatioEnum.has("8:1")).toBe(true)
    expect(aspectRatioEnum.has("1:8")).toBe(true)
  })

  it("still accepts the common aspect ratios", () => {
    for (const r of ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "21:9"]) {
      expect(aspectRatioEnum.has(r), `missing ${r}`).toBe(true)
    }
  })
})

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
    await generateImageRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Shared mock builder: wires a chainable
//   supabase.from("characters").select().eq().eq().is().single()
// stub paired with a chainable
//   supabase.from("jobs").insert().select().single()
// stub. Both the identity-injection tests and the _internalLora spoof tests
// hit the same .select().eq().eq().is().single() shape, so they share this.
// ---------------------------------------------------------------------------

function setupSupabaseMock(opts: {
  charRow?: Record<string, unknown> | null
  charError?: { code?: string } | null
}) {
  const charSingle = vi.fn().mockResolvedValue({
    data: opts.charRow ?? null,
    error: opts.charError ?? null,
  })
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
  return { charSelect, charEq1, charEq2, charIs, charSingle, jobInsert, fromMock }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/generate-image", () => {
  it("returns 400 when prompt is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-image",
      payload: { userId: "00000000-0000-4000-8000-000000000001" },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns 401 when userId is not provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-image",
      payload: { prompt: "a beautiful sunset" },
    })

    expect(res.statusCode).toBe(401)
    const body = res.json()
    expect(body.error.code).toBe("unauthorized")
  })

  it("creates a job and enqueues it on valid request", async () => {
    // Mock supabase.from("jobs").insert().select().single() chain
    const mockSingle = vi.fn().mockResolvedValue({
      data: { id: "job-1" },
      error: null,
    })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-image",
      payload: {
        prompt: "a beautiful sunset",
        userId: "00000000-0000-4000-8000-000000000001",
        provider: "nano-banana",
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe("job-1")

    // Verify supabase was called to insert the job
    expect(mockFrom).toHaveBeenCalledWith("jobs")
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "00000000-0000-4000-8000-000000000001",
        status: "pending",
        input_data: expect.objectContaining({
          prompt: "a beautiful sunset",
          provider: "nano-banana",
          type: "generate-image",
        }),
      })
    )

    // Verify job was enqueued
    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-image",
      expect.objectContaining({
        jobId: "job-1",
        prompt: "a beautiful sunset",
        provider: "nano-banana",
      })
    )
  })

  it("returns 500 when job insert fails", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "DB connection failed" },
    })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-image",
      payload: {
        prompt: "a beautiful sunset",
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
  // the prompt that gets sent to the worker. Default off (no DB lookup, no
  // prompt mutation, no characters table query).
  // -------------------------------------------------------------------------

  describe("identity injection (injectCharacterContext)", () => {
    const CHARACTER_ID = "00000000-0000-4000-8000-0000000000aa"
    const VALID_UUID = "00000000-0000-4000-8000-000000000001"

    it("does NOT query characters when injectCharacterContext is omitted (default off)", async () => {
      const { fromMock } = setupSupabaseMock({ charRow: { canonical_description: "ignored", description: null, name: "Kira" } })

      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-image",
        payload: { prompt: "a portrait", userId: VALID_UUID },
      })

      expect(res.statusCode).toBe(200)
      const tablesQueried = fromMock.mock.calls.map((c) => c[0])
      expect(tablesQueried).not.toContain("characters")
      // Prompt stays untouched.
      const queuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
      expect(queuedPayload.prompt).toBe("a portrait")
    })

    it("does NOT query characters when injectCharacterContext=true but attachToCharacterId is absent", async () => {
      const { fromMock } = setupSupabaseMock({ charRow: { canonical_description: "ignored", description: null, name: "Kira" } })

      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-image",
        payload: {
          prompt: "a portrait",
          userId: VALID_UUID,
          injectCharacterContext: true,
        },
      })

      expect(res.statusCode).toBe(200)
      const tablesQueried = fromMock.mock.calls.map((c) => c[0])
      expect(tablesQueried).not.toContain("characters")
    })

    it("appends canonical_description + identity-preserve suffix to the worker prompt", async () => {
      setupSupabaseMock({
        charRow: {
          canonical_description: "A woman in her late 20s with shoulder-length auburn hair, warm hazel eyes, fair skin with light freckles.",
          description: null,
          name: "Kira",
        },
      })

      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-image",
        payload: {
          prompt: "standing in a sunlit garden",
          userId: VALID_UUID,
          injectCharacterContext: true,
          attachToCharacterId: CHARACTER_ID,
        },
      })

      expect(res.statusCode).toBe(200)
      const queuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
      const queuedPrompt = queuedPayload.prompt as string
      expect(queuedPrompt).toContain("standing in a sunlit garden")
      expect(queuedPrompt).toContain("warm hazel eyes")
      expect(queuedPrompt).toContain("auburn hair")
      expect(queuedPrompt).toContain("same person")
    })

    it("falls back to description when canonical_description is empty", async () => {
      setupSupabaseMock({
        charRow: {
          canonical_description: "",
          description: "Tall older man with kind eyes and a deep voice.",
          name: "Aldric",
        },
      })

      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-image",
        payload: {
          prompt: "sitting by the fire",
          userId: VALID_UUID,
          injectCharacterContext: true,
          attachToCharacterId: CHARACTER_ID,
        },
      })

      expect(res.statusCode).toBe(200)
      const queuedPrompt = (vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>).prompt as string
      expect(queuedPrompt).toContain("Tall older man with kind eyes")
    })

    it("does NOT inject when both canonical_description and description are empty (skip name-only)", async () => {
      setupSupabaseMock({
        charRow: { canonical_description: "", description: null, name: "Kira" },
      })

      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-image",
        payload: {
          prompt: "a portrait",
          userId: VALID_UUID,
          injectCharacterContext: true,
          attachToCharacterId: CHARACTER_ID,
        },
      })

      expect(res.statusCode).toBe(200)
      const queuedPrompt = (vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>).prompt as string
      // No identity-preserve suffix — pure passthrough.
      expect(queuedPrompt).toBe("a portrait")
      expect(queuedPrompt).not.toContain("same person")
    })

    it("scopes the characters lookup by user_id (defense in depth IDOR)", async () => {
      const { charEq1, charEq2, charIs } = setupSupabaseMock({
        charRow: { canonical_description: "ignored", description: null, name: "Kira" },
      })

      await app.inject({
        method: "POST",
        url: "/v1/generate-image",
        payload: {
          prompt: "a portrait",
          userId: VALID_UUID,
          injectCharacterContext: true,
          attachToCharacterId: CHARACTER_ID,
        },
      })

      expect(charEq1).toHaveBeenCalledWith("id", CHARACTER_ID)
      expect(charEq2).toHaveBeenCalledWith("user_id", VALID_UUID)
      expect(charIs).toHaveBeenCalledWith("deleted_at", null)
    })
  })

  // Regression net for PR #2474, which moved _internalLora resolution from a
  // raw Replicate version hash (spoofable) to a server-side characterId
  // lookup scoped by (id, user_id). These tests pin the ownership check.
  describe("_internalLora cross-user spoof guard", () => {
    const VICTIM_USER_ID = "00000000-0000-4000-8000-0000000000aa"
    const VICTIM_CHARACTER_ID = "00000000-0000-4000-8000-0000000000bb"
    const ATTACKER_USER_ID = "00000000-0000-4000-8000-0000000000cc"

    it("returns 400 character_not_trained when characterId belongs to a different user", async () => {
      // Foreign-owned characterId: (id, user_id) filter matches no row.
      const { charEq1, charEq2, jobInsert } = setupSupabaseMock({ charRow: null })

      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-image",
        payload: {
          prompt: "a portrait",
          userId: ATTACKER_USER_ID,
          provider: FLUX_LORA_CHARACTER_MODEL_ID,
          _internalLora: { characterId: VICTIM_CHARACTER_ID },
        },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("character_not_trained")
      expect(charEq1).toHaveBeenCalledWith("id", VICTIM_CHARACTER_ID)
      expect(charEq2).toHaveBeenCalledWith("user_id", ATTACKER_USER_ID)
      expect(charEq2).not.toHaveBeenCalledWith("user_id", VICTIM_USER_ID)
      expect(jobInsert).not.toHaveBeenCalled()
      expect(videoQueue.add).not.toHaveBeenCalled()
    })

    it("returns 400 character_not_trained when character exists but lora_training_status != 'succeeded'", async () => {
      // Same-user characterId, but the LoRA hasn't finished training yet.
      const { jobInsert } = setupSupabaseMock({
        charRow: {
          lora_replicate_version: "v_in_progress",
          lora_trigger_word: "TOK_kira",
          lora_training_status: "training",
        },
      })

      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-image",
        payload: {
          prompt: "a portrait",
          userId: VICTIM_USER_ID,
          provider: FLUX_LORA_CHARACTER_MODEL_ID,
          _internalLora: { characterId: VICTIM_CHARACTER_ID },
        },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("character_not_trained")
      expect(jobInsert).not.toHaveBeenCalled()
    })
  })

  // Regression net for the flux-2-max underbilling bug: the preHandler check
  // and the handler reservation MUST resolve to the same modelIdentifier.
  // Previously the handler dropped the refCount arg, so the preHandler verified
  // the user could afford e.g. `flux-2-max:4ref` (10cr) but the reservation
  // debited the bare `flux-2-max` row (3cr) — 7cr free per generation.
  describe("flux-2-max reservation identifier parity", () => {
    const VALID_UUID = "00000000-0000-4000-8000-000000000001"

    it("reserves at `flux-2-max:1MP:0ref` when no refs are attached", async () => {
      setupSupabaseMock({})

      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-image",
        payload: {
          prompt: "lone subject",
          userId: VALID_UUID,
          provider: "flux-2-max",
        },
      })

      expect(res.statusCode).toBe(200)
      const reserveMock = vi.mocked(reserveCreditsForJob)
      expect(reserveMock).toHaveBeenCalledTimes(1)
      // 4th arg is the modelIdentifier.
      expect(reserveMock.mock.calls[0][3]).toBe("flux-2-max:1MP:0ref")
    })

    it.each([1, 2, 4, 8])(
      "reserves at composite `flux-2-max:1MP:Nref` when %d refs are attached",
      async (n) => {
        setupSupabaseMock({})
        const refs = Array.from({ length: n }, (_, i) => `https://r2.nodaro.ai/ref-${i}.png`)

        const res = await app.inject({
          method: "POST",
          url: "/v1/generate-image",
          payload: {
            prompt: "subject with refs",
            userId: VALID_UUID,
            provider: "flux-2-max",
            referenceImageUrls: refs,
          },
        })

        expect(res.statusCode).toBe(200)
        const reserveMock = vi.mocked(reserveCreditsForJob)
        expect(reserveMock.mock.calls.at(-1)?.[3]).toBe(`flux-2-max:1MP:${n}ref`)
      },
    )
  })

  describe("reference auto-swap to i2i (triggered by attached refs, no marker)", () => {
    const VALID_UUID = "00000000-0000-4000-8000-000000000001"

    it("routes a swap-map T2I provider to its i2i sibling when refs are attached + a PLAIN prompt", async () => {
      setupSupabaseMock({})
      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-image",
        payload: {
          prompt: "make it night", // plain — NO "Use these references…" marker
          userId: VALID_UUID,
          provider: "seedream-5-lite",
          referenceImageUrls: ["https://r2.nodaro.ai/frame.png"],
        },
      })
      expect(res.statusCode).toBe(200)
      const reserveMock = vi.mocked(reserveCreditsForJob)
      // The bare T2I endpoint ignores refs; the route auto-routes to the i2i sibling.
      expect(reserveMock.mock.calls.at(-1)?.[3]).toContain("seedream-5-lite-i2i")
    })

    it("does NOT swap when no refs are attached", async () => {
      setupSupabaseMock({})
      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-image",
        payload: { prompt: "a city", userId: VALID_UUID, provider: "seedream-5-lite" },
      })
      expect(res.statusCode).toBe(200)
      const reserveMock = vi.mocked(reserveCreditsForJob)
      expect(reserveMock.mock.calls.at(-1)?.[3]).not.toContain("i2i")
    })
  })

  // ─── MP resolution Zod acceptance (TASK 7) ────────────────────────────────
  describe("resolution: MP values accepted by Zod", () => {
    it("accepts resolution '2 MP' for provider flux-2-max (returns 200)", async () => {
      setupSupabaseMock({})
      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-image",
        payload: {
          prompt: "a landscape",
          userId: "00000000-0000-4000-8000-000000000001",
          provider: "flux-2-max",
          resolution: "2 MP",
        },
      })
      // Zod should accept "2 MP"; the route should return 200 (not 400).
      expect(res.statusCode).toBe(200)
    })

    it("accepts all MP resolution tiers in generateImageBody schema", () => {
      for (const mp of ["0.5 MP", "1 MP", "2 MP", "4 MP"]) {
        const result = generateImageBody.safeParse({
          prompt: "test",
          resolution: mp,
        })
        expect(result.success, `resolution "${mp}" should be valid`).toBe(true)
      }
    })
  })
})
