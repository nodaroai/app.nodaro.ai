import { describe, it, expect, vi, beforeEach, afterEach, expectTypeOf } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"
import type { z } from "zod"

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

import {
  generateImageRoutes,
  generateImageBody,
  connectedReferenceSchema,
  resolveImageCreditIdentifier,
} from "../generate-image.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { FLUX_LORA_CHARACTER_MODEL_ID, assembleImageInput, type ConnectedReference } from "@nodaro/shared"

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

describe("generateImageBody prompt length cap", () => {
  it("accepts a prompt up to 5000 chars and rejects 5001", () => {
    // 5000 = IMAGE_PROMPT_MAX (raised from the legacy 2000 day-one cap)
    expect(generateImageBody.safeParse({ prompt: "a".repeat(5000) }).success).toBe(true)
    expect(generateImageBody.safeParse({ prompt: "a".repeat(5001) }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Drift guard for the hand-mirrored `connectedReferenceSchema` (WI-1b).
//
// The route's `connectedReferenceSchema` hand-mirrors the ~21-field shared
// `ConnectedReference`. The ENUMS are derived from the catalog (can't drift),
// but the FIELD SET is hand-typed — and Zod `.object()` is non-strict, so a NEW
// optional field added to `ConnectedReference` would be SILENTLY STRIPPED here
// (the structured-mode prompt builder would never see it) with no failing test.
//
// This is a COMPILE-TIME assertion: `tsc --noEmit` fails if the schema's
// inferred key set diverges from `ConnectedReference`'s in EITHER direction
// (missing field OR extra field). `readonly` modifiers differ between the two
// (the shared type marks most fields `readonly`, Zod's inference does not), so
// we compare KEY SETS rather than full structural types — that's the part the
// hand-mirror can actually get wrong. See the TODO(nodaro) on the schema:
// WI-7 replaces this mirror with a shared Zod schema and retires this guard.
// ---------------------------------------------------------------------------
describe("connectedReferenceSchema mirrors ConnectedReference (key-set drift guard)", () => {
  type SchemaKeys = keyof z.infer<typeof connectedReferenceSchema>
  type TypeKeys = keyof ConnectedReference
  // `Exclude<A, B>` is `never` iff every member of A is in B. Asserting it both
  // ways pins the key sets to be EQUAL — a missing field trips one direction,
  // an extra field trips the other. If either resolves to a non-`never` key,
  // `expectTypeOf<never>().toEqualTypeOf<...>()` fails at compile time.
  type MissingFromSchema = Exclude<TypeKeys, SchemaKeys>
  type ExtraInSchema = Exclude<SchemaKeys, TypeKeys>

  it("has no field present in ConnectedReference but missing from the schema", () => {
    expectTypeOf<MissingFromSchema>().toEqualTypeOf<never>()
  })

  it("has no field present in the schema but missing from ConnectedReference", () => {
    expectTypeOf<ExtraInSchema>().toEqualTypeOf<never>()
  })

  // Runtime smoke: the two key sets are the same SIZE (catches a duplicate /
  // typo'd key that the type-level Exclude would still see as a member of one
  // side). The schema's runtime `.shape` is the source for its key count.
  it("has the same number of keys in the schema as in ConnectedReference (runtime cross-check)", () => {
    // A fully-populated ConnectedReference: TS forces EXACTLY the type's keys
    // (excess-property + missing-property both error), so its key count is the
    // authoritative `ConnectedReference` field count without runtime reflection.
    const sample: Record<keyof ConnectedReference, true> = {
      id: true,
      defaultName: true,
      source: true,
      description: true,
      url: true,
      characterSlug: true,
      variantSlug: true,
      characterCanonicalDescription: true,
      locationCanonicalDescription: true,
      locationSlug: true,
      locationVariantBucket: true,
      locationVariantSlug: true,
      locationVariantDisplayName: true,
      locationReferencePhotoKind: true,
      variantDescription: true,
      variantDisplayName: true,
      defaultUsageMode: true,
      isExtraRef: true,
      loraReplicateVersion: true,
      loraTriggerWord: true,
      loraTrainingStatus: true,
    }
    expect(Object.keys(connectedReferenceSchema.shape).sort()).toEqual(
      Object.keys(sample).sort(),
    )
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
  // Robustness: a non-object JSON body (literal `null`, or a scalar) must NOT
  // crash the preHandler. This route has no Fastify body schema, so `req.body`
  // can legitimately be `null`/`"x"`/`42`. Before the `isStructuredImageMode`
  // null-guard, `body.connectedReferences` threw a TypeError inside the
  // (try/catch-less) preHandler → 500; the guard makes it fall through to the
  // flat-ref path so the handler's `safeParse(null)` returns a clean 400.
  // -------------------------------------------------------------------------
  it.each([
    ["null", null],
    ["a scalar string", "x"],
    ["a scalar number", 42],
  ])("returns 400 (not 500) when the request body is %s", async (_label, payload) => {
    setupSupabaseMock({})
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-image",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(payload),
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    // The preHandler reached the flat path (no throw), and no work was enqueued.
    expect(videoQueue.add).not.toHaveBeenCalled()
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

  // ─── WI-1b: structured inputs + server-side assembly ──────────────────────
  // The route now ALSO accepts the structured inputs a thin client (Studio /
  // MCP) sends — `connectedReferences` / `direction` / `structured` — and
  // assembles them server-side via the shared `assembleImageInput`. These
  // tests pin: (1) the old pre-assembled shape is byte-identical (non-breaking),
  // (2) structured inputs assemble to the same prompt/refs `assembleImageInput`
  // produces, (3) the billed identifier prices on the ASSEMBLED ref count
  // (parity with the flat path), (4) an assembly that yields an empty prompt → 400.
  describe("WI-1b structured inputs", () => {
    const VALID_UUID = "00000000-0000-4000-8000-000000000001"

    function mkManualRefs(n: number) {
      return Array.from({ length: n }, (_, i) => ({
        id: `m${i}`,
        defaultName: `ref${i}`,
        source: "manual" as const,
        url: `https://r2.nodaro.ai/cref-${i}.png`,
      }))
    }

    // ── Non-breaking: OLD shape produces a byte-identical queued job ──────────
    it("is byte-identical for the OLD pre-assembled shape (no structured fields)", async () => {
      setupSupabaseMock({})
      const oldShapePayload = {
        prompt: "a beautiful sunset",
        userId: VALID_UUID,
        provider: "nano-banana",
        negativePrompt: "blurry",
        referenceImageUrls: ["https://r2.nodaro.ai/ref-a.png", "https://r2.nodaro.ai/ref-b.png"],
      }

      const res = await app.inject({ method: "POST", url: "/v1/generate-image", payload: oldShapePayload })
      expect(res.statusCode).toBe(200)

      // Queued payload must carry the prompt + refs + negativePrompt VERBATIM —
      // no assembly ran (structured fields absent), so the route is unchanged.
      const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as Record<string, unknown>
      expect(queued.prompt).toBe("a beautiful sunset")
      expect(queued.referenceImageUrls).toEqual([
        "https://r2.nodaro.ai/ref-a.png",
        "https://r2.nodaro.ai/ref-b.png",
      ])
      // Flat path: the raw negative prompt rides its own channel unchanged.
      expect(queued.negativePrompt).toBe("blurry")
      expect(queued.provider).toBe("nano-banana")

      // Reservation identifier unchanged (nano-banana has no ref-count pricing).
      expect(vi.mocked(reserveCreditsForJob).mock.calls.at(-1)?.[3]).toBe("nano-banana")
    })

    it("preserves `referenceImageUrls: undefined` on the queue when the old shape omits refs", async () => {
      setupSupabaseMock({})
      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-image",
        payload: { prompt: "a city skyline", userId: VALID_UUID, provider: "nano-banana" },
      })
      expect(res.statusCode).toBe(200)
      const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as Record<string, unknown>
      // Byte-identical to before: no refs → the field stays `undefined` (not `[]`).
      expect(queued.referenceImageUrls).toBeUndefined()
    })

    // ── Structured mode: assembles via the SAME shared assembleImageInput ─────
    it("assembles `connectedReferences` + `direction` into the queued prompt/refs (matches assembleImageInput)", async () => {
      setupSupabaseMock({})
      const connectedReferences = mkManualRefs(2)
      const direction = { framingId: "close-up", lightingId: "golden-hour" }

      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-image",
        payload: {
          prompt: "a hero shot",
          userId: VALID_UUID,
          provider: "nano-banana",
          connectedReferences,
          direction,
        },
      })
      expect(res.statusCode).toBe(200)

      // Independently assemble the SAME inputs and compare the queued payload.
      const expected = assembleImageInput({
        userPrompt: "a hero shot",
        provider: "nano-banana",
        connectedReferences,
        direction,
        throwOnEmpty: true,
      })
      const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as Record<string, unknown>
      expect(queued.prompt).toBe(expected.prompt)
      expect(queued.referenceImageUrls).toEqual(expected.referenceImageUrls)
      // The direction hints must have actually changed the prompt vs. the raw input.
      expect(queued.prompt).not.toBe("a hero shot")
    })

    it("routes the non-native negative prompt into the assembled prompt (native rides its own channel)", async () => {
      setupSupabaseMock({})
      // nano-banana is NOT a native-negative model → negative folds into prompt.
      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-image",
        payload: {
          prompt: "a portrait",
          userId: VALID_UUID,
          provider: "nano-banana",
          structured: { mood: "somber" },
          negativePrompt: "cartoonish",
        },
      })
      expect(res.statusCode).toBe(200)
      const expected = assembleImageInput({
        userPrompt: "a portrait",
        provider: "nano-banana",
        structured: { mood: "somber" },
        negativePrompt: "cartoonish",
        throwOnEmpty: true,
      })
      const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as Record<string, unknown>
      expect(queued.prompt).toBe(expected.prompt)
      // Non-native model → assembled `nativeNegativePrompt` is undefined, so the
      // queue's negativePrompt channel is undefined (it's folded into prompt).
      expect(queued.negativePrompt).toBe(expected.nativeNegativePrompt)
      expect(queued.prompt).toContain("Avoid: cartoonish")
    })

    // ── Pricing parity: flux-2-max bills the ASSEMBLED ref count ──────────────
    it.each([0, 1, 2, 4, 8])(
      "flux-2-max with %d connectedReferences bills the same as %d flat referenceImageUrls",
      async (n) => {
        // Flat path billed identifier.
        setupSupabaseMock({})
        await app.inject({
          method: "POST",
          url: "/v1/generate-image",
          payload: {
            prompt: "subject with refs",
            userId: VALID_UUID,
            provider: "flux-2-max",
            referenceImageUrls: Array.from({ length: n }, (_, i) => `https://r2.nodaro.ai/ref-${i}.png`),
          },
        })
        const flatIdentifier = vi.mocked(reserveCreditsForJob).mock.calls.at(-1)?.[3]

        // Structured path billed identifier (N manual refs → N assembled refs).
        vi.clearAllMocks()
        setupSupabaseMock({})
        await app.inject({
          method: "POST",
          url: "/v1/generate-image",
          payload: {
            prompt: "subject with refs",
            userId: VALID_UUID,
            provider: "flux-2-max",
            connectedReferences: mkManualRefs(n),
          },
        })
        const structuredIdentifier = vi.mocked(reserveCreditsForJob).mock.calls.at(-1)?.[3]

        expect(structuredIdentifier).toBe(flatIdentifier)
        expect(structuredIdentifier).toBe(`flux-2-max:1MP:${n}ref`)
      },
    )

    it("flux-2-max prices a wired-character canonical fallback as 1 ref (not 0)", async () => {
      // A wired-character with no @-mention contributes its canonical URL (1 ref)
      // via buildImagePrompt's fallback — the billed count must reflect that.
      setupSupabaseMock({})
      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-image",
        payload: {
          prompt: "a portrait",
          userId: VALID_UUID,
          provider: "flux-2-max",
          connectedReferences: [{
            id: "c1",
            defaultName: "Kira",
            source: "wired-character",
            characterSlug: "kira",
            url: "https://r2.nodaro.ai/kira.png",
          }],
        },
      })
      expect(res.statusCode).toBe(200)
      expect(vi.mocked(reserveCreditsForJob).mock.calls.at(-1)?.[3]).toBe("flux-2-max:1MP:1ref")
    })

    it("auto-swaps a T2I provider to its i2i sibling when connectedReferences assemble to >=1 ref", async () => {
      setupSupabaseMock({})
      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-image",
        payload: {
          prompt: "make it night",
          userId: VALID_UUID,
          provider: "seedream-5-lite",
          connectedReferences: mkManualRefs(1),
        },
      })
      expect(res.statusCode).toBe(200)
      // Reserved + queued provider must be the i2i sibling (refs are consumed).
      expect(vi.mocked(reserveCreditsForJob).mock.calls.at(-1)?.[3]).toContain("seedream-5-lite-i2i")
      const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as Record<string, unknown>
      expect(queued.provider).toBe("seedream-5-lite-i2i")
    })

    // ── Empty assembled prompt → 400 ──────────────────────────────────────────
    it("returns 400 when structured inputs assemble to an empty prompt", async () => {
      const { jobInsert } = setupSupabaseMock({})
      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-image",
        payload: {
          // Empty user prompt + an empty `structured` object (no fields) and no
          // refs → assembled prompt is empty → throwOnEmpty fires → 400.
          prompt: "",
          userId: VALID_UUID,
          provider: "nano-banana",
          structured: {},
        },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("no_prompt")
      // No job created, nothing enqueued — the 400 short-circuits before insert.
      expect(jobInsert).not.toHaveBeenCalled()
      expect(videoQueue.add).not.toHaveBeenCalled()
    })

    it("does NOT reject when the user prompt is empty but a wired character fills it", async () => {
      setupSupabaseMock({})
      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-image",
        payload: {
          prompt: "",
          userId: VALID_UUID,
          provider: "nano-banana",
          // A wired-character with no @-mention emits a canonical-fallback
          // "Use these characters:" directive block → assembled prompt is
          // non-empty even though the user typed nothing (mirrors the frontend
          // execute-node guard: "type one, mention a character, or connect a
          // cinematography source").
          connectedReferences: [{
            id: "c1",
            defaultName: "Kira",
            source: "wired-character",
            characterSlug: "kira",
            url: "https://r2.nodaro.ai/kira.png",
          }],
        },
      })
      expect(res.statusCode).toBe(200)
      const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as Record<string, unknown>
      expect(queued.prompt as string).toContain("Use these characters:")
    })

    it("returns 400 when the user prompt is empty and only a bare manual ref is attached (no directive text)", async () => {
      // A `manual` ref with no `{image:N}` token auto-attaches its URL but emits
      // NO directive text — so an empty user prompt assembles to an empty prompt
      // → 400. (The URL alone is not a prompt; this matches assembleImageInput's
      // throwOnEmpty contract and the frontend guard.)
      const { jobInsert } = setupSupabaseMock({})
      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-image",
        payload: {
          prompt: "",
          userId: VALID_UUID,
          provider: "nano-banana",
          connectedReferences: mkManualRefs(1),
        },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("no_prompt")
      expect(jobInsert).not.toHaveBeenCalled()
    })
  })

  // ─── WI-1b: CHECK === DEBIT billing-parity invariant ──────────────────────
  // The credit CHECK (preHandler `resolveImageCreditIdentifier`) and the credit
  // DEBIT (handler `reserveCreditsForJob(..., modelIdentifier)`) are computed at
  // SEPARATELY-WRITTEN sites. They're equal today (both derive the assembled
  // ref count via the same `buildAssembleInput` + `assembleImageInput`), but a
  // future tweak to one site could silently mis-bill — and every OTHER route
  // test mocks `creditGuard` to a no-op, so the CHECK closure never runs there.
  //
  // This block runs the REAL preHandler pricing by calling the exported
  // `resolveImageCreditIdentifier` resolver DIRECTLY (the exact function handed
  // to `creditGuard` in the route — un-mockable here since `creditGuard` itself
  // is mocked) and asserts, for the SAME structured body, that the CHECK
  // identifier === the DEBIT identifier (captured from the `reserveCreditsForJob`
  // 4th arg the handler computes). Cases mirror the DEBIT parity test:
  // [0,1,2,4,8] refs, the wired-character canonical fallback (→ 1 ref), and the
  // i2i auto-swap. This is the direct guard on the CHECK===DEBIT invariant.
  describe("WI-1b CHECK === DEBIT identifier parity (real preHandler pricing)", () => {
    const VALID_UUID = "00000000-0000-4000-8000-000000000001"

    function mkManualRefs(n: number) {
      return Array.from({ length: n }, (_, i) => ({
        id: `m${i}`,
        defaultName: `ref${i}`,
        source: "manual" as const,
        url: `https://r2.nodaro.ai/cref-${i}.png`,
      }))
    }

    /** Run the route, return the DEBIT identifier (reserveCreditsForJob arg 4). */
    async function debitIdentifierFor(payload: Record<string, unknown>): Promise<string | undefined> {
      vi.clearAllMocks()
      setupSupabaseMock({})
      const res = await app.inject({ method: "POST", url: "/v1/generate-image", payload })
      expect(res.statusCode).toBe(200)
      return vi.mocked(reserveCreditsForJob).mock.calls.at(-1)?.[3]
    }

    /** Run the REAL preHandler CHECK resolver directly on the same body. */
    function checkIdentifierFor(body: Record<string, unknown>): string {
      // The resolver only reads `req.body`; a minimal stub suffices.
      return resolveImageCreditIdentifier({ body } as FastifyRequest)
    }

    it.each([0, 1, 2, 4, 8])(
      "CHECK === DEBIT for flux-2-max with %d connectedReferences",
      async (n) => {
        const body = {
          prompt: "subject with refs",
          userId: VALID_UUID,
          provider: "flux-2-max",
          connectedReferences: mkManualRefs(n),
        }
        const debit = await debitIdentifierFor(body)
        const check = checkIdentifierFor(body)
        expect(check).toBe(debit)
        // Pin the concrete value so a regression in BOTH sites can't pass silently.
        expect(check).toBe(`flux-2-max:1MP:${n}ref`)
      },
    )

    it("CHECK === DEBIT for flat referenceImageUrls (non-structured path)", async () => {
      const body = {
        prompt: "subject with refs",
        userId: VALID_UUID,
        provider: "flux-2-max",
        referenceImageUrls: ["https://r2.nodaro.ai/a.png", "https://r2.nodaro.ai/b.png", "https://r2.nodaro.ai/c.png"],
      }
      const debit = await debitIdentifierFor(body)
      const check = checkIdentifierFor(body)
      expect(check).toBe(debit)
      expect(check).toBe("flux-2-max:1MP:3ref")
    })

    it("CHECK === DEBIT for a wired-character canonical fallback (→ 1 ref, not 0)", async () => {
      const body = {
        prompt: "a portrait",
        userId: VALID_UUID,
        provider: "flux-2-max",
        connectedReferences: [{
          id: "c1",
          defaultName: "Kira",
          source: "wired-character",
          characterSlug: "kira",
          url: "https://r2.nodaro.ai/kira.png",
        }],
      }
      const debit = await debitIdentifierFor(body)
      const check = checkIdentifierFor(body)
      expect(check).toBe(debit)
      expect(check).toBe("flux-2-max:1MP:1ref")
    })

    it("CHECK === DEBIT for the i2i auto-swap case (T2I provider + assembled refs)", async () => {
      const body = {
        prompt: "make it night",
        userId: VALID_UUID,
        provider: "seedream-5-lite",
        connectedReferences: mkManualRefs(1),
      }
      const debit = await debitIdentifierFor(body)
      const check = checkIdentifierFor(body)
      // Both sites must swap T2I → i2i off the SAME assembled ref count.
      expect(check).toBe(debit)
      expect(check).toContain("seedream-5-lite-i2i")
    })

    // Robustness companion to the route-level null-body test: the REAL preHandler
    // resolver must not throw on a non-object body (the `isStructuredImageMode`
    // null-guard). A throw here = the production 500 regression.
    it.each([
      ["null", null],
      ["a scalar string", "x"],
      ["a scalar number", 42],
    ])("CHECK resolver does not throw on %s body (falls back to default identifier)", (_label, body) => {
      let identifier = ""
      expect(() => {
        identifier = resolveImageCreditIdentifier({ body } as unknown as FastifyRequest)
      }).not.toThrow()
      // Non-object body → flat path, 0 refs, default provider.
      expect(identifier).toBe("nano-banana")
    })
  })
})
