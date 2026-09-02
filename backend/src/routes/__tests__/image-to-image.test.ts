import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"

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

vi.mock("@/lib/llm-client.js", () => ({
  llmComplete: vi.fn().mockResolvedValue({
    text: "warm closed-mouth smile, eyes softened",
    model: "claude-sonnet-4.6",
  }),
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

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { imageToImageRoutes, resolveImageToImageCreditIdentifier, imageToImageBody } from "../image-to-image.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { llmComplete } from "../../lib/llm-client.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { IMAGE_ASPECT_RATIO_VALUES, MODIFY_IMAGE_PROVIDERS, resolveNormalizedImageGen } from "@nodaro/shared"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const VALID_UUID = "00000000-0000-4000-8000-000000000001"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  // Re-prime llmComplete — clearAllMocks wipes the implementation set in vi.mock.
  vi.mocked(llmComplete).mockResolvedValue({
    text: "warm closed-mouth smile, eyes softened",
    model: "claude-sonnet-4.6",
  } as never)

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
    await imageToImageRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockJobInsert(jobId = "job-1", error: { message: string } | null = null) {
  const mockSingle = vi.fn().mockResolvedValue({
    data: error ? null : { id: jobId },
    error,
  })
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  const mockFrom = vi.mocked(supabase.from)
  mockFrom.mockReturnValue({ insert: mockInsert } as never)
  return { mockFrom, mockInsert, mockSelect, mockSingle }
}

/**
 * Studio-path helper: route supabase.from() by table name.
 *   - "characters" → fetch chain returning the supplied row (or error)
 *   - "jobs"       → insert chain returning the supplied result
 */
function setupSupabaseMockStudio(opts: {
  charRow?: { source_image_url: string | null; canonical_description: string | null } | null
  charError?: { message: string } | null
  jobInsertResult?: { data: { id: string } | null; error: { message: string } | null }
}) {
  const charSingle = vi.fn().mockResolvedValue({
    data: opts.charRow ?? null,
    error: opts.charError ?? null,
  })
  // characters select chain:
  //   .select("...").eq("id", ...).eq("user_id", ...).is("deleted_at", null).single()
  // The `.is("deleted_at", null)` step rejects soft-deleted rows so a soft-deleted
  // character can't trip a portrait_required false-positive or attach assets.
  const charIs = vi.fn().mockReturnValue({ single: charSingle })
  const charEq2 = vi.fn().mockReturnValue({ is: charIs })
  const charEq1 = vi.fn().mockReturnValue({ eq: charEq2 })
  const charSelect = vi.fn().mockReturnValue({ eq: charEq1 })

  const jobInsertResult = opts.jobInsertResult ?? { data: { id: "job-1" }, error: null }
  const jobSingle = vi.fn().mockResolvedValue(jobInsertResult)
  const jobSelect = vi.fn().mockReturnValue({ single: jobSingle })
  const jobInsert = vi.fn().mockReturnValue({ select: jobSelect })

  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "characters") return { select: charSelect } as never
    if (table === "jobs") return { insert: jobInsert } as never
    return {} as never
  })

  return { charSelect, charEq1, charEq2, charIs, charSingle, jobInsert, jobSelect, jobSingle }
}

const STUDIO_CHARACTER_ID = "00000000-0000-4000-8000-000000000099"

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/image-to-image", () => {
  it("returns 400 when imageUrl is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/image-to-image",
      payload: {
        prompt: "make it look vintage",
        userId: VALID_UUID,
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns 400 when prompt is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/image-to-image",
      payload: {
        imageUrl: "https://example.com/image.png",
        userId: VALID_UUID,
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns 401 when userId is not provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/image-to-image",
      payload: {
        imageUrl: "https://example.com/image.png",
        prompt: "make it look vintage",
      },
    })

    expect(res.statusCode).toBe(401)
    const body = res.json()
    expect(body.error.code).toBe("unauthorized")
  })

  it("creates a job and enqueues it on valid request (default provider)", async () => {
    const { mockFrom, mockInsert } = mockJobInsert("job-1")

    const res = await app.inject({
      method: "POST",
      url: "/v1/image-to-image",
      payload: {
        imageUrl: "https://example.com/image.png",
        prompt: "make it look vintage",
        userId: VALID_UUID,
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe("job-1")

    // Verify supabase was called to insert the job
    expect(mockFrom).toHaveBeenCalledWith("jobs")
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: VALID_UUID,
        status: "pending",
        input_data: expect.objectContaining({
          imageUrl: "https://example.com/image.png",
          prompt: "make it look vintage",
          type: "image-to-image",
        }),
      })
    )

    // Verify job was enqueued (provider is undefined when not explicitly set — worker defaults to nano-banana)
    expect(videoQueue.add).toHaveBeenCalledWith(
      "image-to-image",
      expect.objectContaining({
        jobId: "job-1",
        imageUrl: "https://example.com/image.png",
        prompt: "make it look vintage",
      })
    )
  })

  it("passes referenceImageUrls through to input_data and queue", async () => {
    mockJobInsert("job-2")

    const refUrls = ["https://example.com/ref1.png", "https://example.com/ref2.png"]

    const res = await app.inject({
      method: "POST",
      url: "/v1/image-to-image",
      payload: {
        imageUrl: "https://example.com/image.png",
        prompt: "apply character style",
        userId: VALID_UUID,
        referenceImageUrls: refUrls,
      },
    })

    expect(res.statusCode).toBe(200)

    // Verify referenceImageUrls in queue payload
    expect(videoQueue.add).toHaveBeenCalledWith(
      "image-to-image",
      expect.objectContaining({
        jobId: "job-2",
        referenceImageUrls: refUrls,
      })
    )
  })

  it("returns 500 when job insert fails", async () => {
    mockJobInsert("job-1", { message: "DB connection failed" })

    const res = await app.inject({
      method: "POST",
      url: "/v1/image-to-image",
      payload: {
        imageUrl: "https://example.com/image.png",
        prompt: "make it look vintage",
        userId: VALID_UUID,
      },
    })

    expect(res.statusCode).toBe(500)
    const body = res.json()
    expect(body.error.code).toBe("internal_error")
  })

  // ---------------------------------------------------------------------------
  // Credit model identifier tests
  // ---------------------------------------------------------------------------

  describe("credit model identifier", () => {
    it("sends gpt-image-i2i:high for quality=high", async () => {
      mockJobInsert("job-gpt")

      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "enhance",
          userId: VALID_UUID,
          provider: "gpt-image-i2i",
          quality: "high",
        },
      })

      expect(res.statusCode).toBe(200)
      expect(videoQueue.add).toHaveBeenCalledWith(
        "image-to-image",
        expect.objectContaining({
          provider: "gpt-image-i2i",
          quality: "high",
        })
      )
    })

    it("sends flux-pro-i2i:2K for resolution=2K", async () => {
      mockJobInsert("job-flux-pro")

      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "upscale",
          userId: VALID_UUID,
          provider: "flux-pro-i2i",
          resolution: "2K",
        },
      })

      expect(res.statusCode).toBe(200)
      expect(videoQueue.add).toHaveBeenCalledWith(
        "image-to-image",
        expect.objectContaining({
          provider: "flux-pro-i2i",
          resolution: "2K",
        })
      )
    })

    it("sends nano-banana-pro:4K for resolution=4K", async () => {
      mockJobInsert("job-nano-pro")

      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "upscale",
          userId: VALID_UUID,
          provider: "nano-banana-pro",
          resolution: "4K",
        },
      })

      expect(res.statusCode).toBe(200)
      expect(videoQueue.add).toHaveBeenCalledWith(
        "image-to-image",
        expect.objectContaining({
          provider: "nano-banana-pro",
          resolution: "4K",
        })
      )
    })

    it("sends base provider name for default settings", async () => {
      mockJobInsert("job-base")

      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "stylize",
          userId: VALID_UUID,
          provider: "grok-i2i",
        },
      })

      expect(res.statusCode).toBe(200)
      expect(videoQueue.add).toHaveBeenCalledWith(
        "image-to-image",
        expect.objectContaining({
          provider: "grok-i2i",
        })
      )
    })
  })

  // ---------------------------------------------------------------------------
  // Non-studio path — assert NO behavior change. attachToCharacterId absent ⇒
  // no portrait gate, no LLM call, no force_private override, no description /
  // realLifeRefs pass-through in worker payload.
  // ---------------------------------------------------------------------------

  describe("non-studio path (attachToCharacterId absent)", () => {
    it("does NOT set force_private when attachToCharacterId is absent", async () => {
      const { mockInsert } = mockJobInsert("job-1")

      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "make it look vintage",
          userId: VALID_UUID,
        },
      })

      expect(res.statusCode).toBe(200)
      expect(mockInsert).toHaveBeenCalledTimes(1)
      const insertArg = mockInsert.mock.calls[0][0] as Record<string, unknown>
      // Non-studio callers must NOT have force_private silently set to true.
      // The route still allows `forcePrivate: true` via extractForcePrivate
      // body-passthrough, but the default body here doesn't set it → undefined.
      expect(insertArg.force_private).toBeUndefined()
    })

    it("does NOT call LLM when attachToCharacterId is absent (even if description is also absent)", async () => {
      mockJobInsert("job-1")

      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "stylize",
          userId: VALID_UUID,
          // no description, no attachToCharacterId — pure non-studio path
        },
      })

      expect(res.statusCode).toBe(200)
      expect(llmComplete).not.toHaveBeenCalled()
    })

    it("does NOT query characters table when attachToCharacterId is absent", async () => {
      mockJobInsert("job-1")
      const mockFrom = vi.mocked(supabase.from)

      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "stylize",
          userId: VALID_UUID,
        },
      })

      expect(res.statusCode).toBe(200)
      // Only the "jobs" insert table call — no "characters" lookup.
      const tablesQueried = mockFrom.mock.calls.map((c) => c[0])
      expect(tablesQueried).not.toContain("characters")
    })
  })

  // ---------------------------------------------------------------------------
  // Studio path — attachToCharacterId triggers portrait gate, LLM description
  // draft, force_private: true, and worker payload extensions.
  // ---------------------------------------------------------------------------

  describe("studio path (attachToCharacterId present)", () => {
    it("returns 404 not_found when character does not exist / is cross-user", async () => {
      setupSupabaseMockStudio({ charRow: null, charError: { message: "row not found" } })

      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "refine",
          userId: VALID_UUID,
          attachToCharacterId: STUDIO_CHARACTER_ID,
          attachToColumn: "expressions",
          attachName: "smile",
        },
      })

      expect(res.statusCode).toBe(404)
      expect(res.json().error.code).toBe("not_found")
      expect(llmComplete).not.toHaveBeenCalled()
      expect(videoQueue.add).not.toHaveBeenCalled()
    })

    it("returns 400 portrait_required when character has null source_image_url", async () => {
      setupSupabaseMockStudio({
        charRow: { source_image_url: null, canonical_description: "tall woman" },
      })

      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "refine",
          userId: VALID_UUID,
          attachToCharacterId: STUDIO_CHARACTER_ID,
          attachToColumn: "expressions",
          attachName: "smile",
        },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("portrait_required")
      // No LLM call, no job insert, no enqueue when portrait gate rejects.
      expect(llmComplete).not.toHaveBeenCalled()
      expect(videoQueue.add).not.toHaveBeenCalled()
    })

    it("sets force_private: true on the inserted job row (unconditional in studio path)", async () => {
      const { jobInsert } = setupSupabaseMockStudio({
        charRow: { source_image_url: "https://example.com/portrait.png", canonical_description: "tall woman" },
      })

      // Even with body.forcePrivate=false explicitly set, the route must force true.
      await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "refine",
          userId: VALID_UUID,
          attachToCharacterId: STUDIO_CHARACTER_ID,
          attachToColumn: "expressions",
          attachName: "smile",
          forcePrivate: false,
        },
      })

      expect(jobInsert).toHaveBeenCalledTimes(1)
      expect(jobInsert.mock.calls[0][0]).toEqual(
        expect.objectContaining({ force_private: true }),
      )
    })

    it("calls llmComplete to draft description when attachToCharacterId present and description absent", async () => {
      setupSupabaseMockStudio({
        charRow: { source_image_url: "https://example.com/portrait.png", canonical_description: "tall woman with red hair" },
      })

      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "warm closed-mouth smile",
          userId: VALID_UUID,
          attachToCharacterId: STUDIO_CHARACTER_ID,
          attachToColumn: "expressions",
          attachName: "smile",
        },
      })

      expect(res.statusCode).toBe(200)
      expect(llmComplete).toHaveBeenCalledTimes(1)
      const call = vi.mocked(llmComplete).mock.calls[0][0]
      expect(call.modelId).toBe("claude-sonnet-4.6")
      expect(call.system.toLowerCase()).toContain("description")
      // Shared LLM options sanity (maxTokens 400, temperature 0.8).
      expect(call.maxTokens).toBe(400)
      expect(call.temperature).toBe(0.8)
      const userText = typeof call.messages[0].content === "string" ? call.messages[0].content : ""
      // The route's `prompt` field is folded in as the LLM input (image-to-image
      // has no natural variant — the user prompt is the meaningful signal).
      expect(userText).toContain("warm closed-mouth smile")
      // Canonical description threaded through.
      expect(userText).toContain("tall woman with red hair")
    })

    it("does NOT call llmComplete when description is provided", async () => {
      setupSupabaseMockStudio({
        charRow: { source_image_url: "https://example.com/portrait.png", canonical_description: "tall woman" },
      })

      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "refine",
          userId: VALID_UUID,
          description: "warm closed-mouth smile, soft eyes",
          attachToCharacterId: STUDIO_CHARACTER_ID,
          attachToColumn: "expressions",
          attachName: "smile",
        },
      })

      expect(res.statusCode).toBe(200)
      expect(llmComplete).not.toHaveBeenCalled()
    })

    it("LLM failure is non-fatal — still inserts job + returns 200 with description undefined in worker payload", async () => {
      setupSupabaseMockStudio({
        charRow: { source_image_url: "https://example.com/portrait.png", canonical_description: "tall woman" },
      })
      vi.mocked(llmComplete).mockRejectedValueOnce(new Error("LLM provider blew up"))

      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "refine",
          userId: VALID_UUID,
          attachToCharacterId: STUDIO_CHARACTER_ID,
          attachToColumn: "expressions",
          attachName: "smile",
        },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().jobId).toBe("job-1")
      expect(videoQueue.add).toHaveBeenCalledTimes(1)
      const enqueuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
      expect(enqueuedPayload.description).toBeUndefined()
    })

    it("worker queue payload includes description (from LLM draft) and realLifeRefs", async () => {
      setupSupabaseMockStudio({
        charRow: { source_image_url: "https://example.com/portrait.png", canonical_description: "tall woman" },
      })
      vi.mocked(llmComplete).mockResolvedValueOnce({
        text: "  warm smile, soft eyes  ",
        model: "claude-sonnet-4.6",
      } as never)

      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "refine",
          userId: VALID_UUID,
          attachToCharacterId: STUDIO_CHARACTER_ID,
          attachToColumn: "expressions",
          attachName: "smile",
          realLifeRefs: ["https://example.com/me-1.png", "https://example.com/me-2.png"],
        },
      })

      expect(res.statusCode).toBe(200)
      expect(videoQueue.add).toHaveBeenCalledWith(
        "image-to-image",
        expect.objectContaining({
          jobId: "job-1",
          description: "warm smile, soft eyes",
          realLifeRefs: ["https://example.com/me-1.png", "https://example.com/me-2.png"],
          attachToCharacterId: STUDIO_CHARACTER_ID,
          attachToColumn: "expressions",
          attachName: "smile",
        }),
      )
    })

    it("returns 400 validation_error when realLifeRefs has more than 5 entries", async () => {
      setupSupabaseMockStudio({
        charRow: { source_image_url: "https://example.com/portrait.png", canonical_description: null },
      })

      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "refine",
          userId: VALID_UUID,
          attachToCharacterId: STUDIO_CHARACTER_ID,
          attachToColumn: "expressions",
          attachName: "smile",
          realLifeRefs: [
            "https://example.com/r1.png",
            "https://example.com/r2.png",
            "https://example.com/r3.png",
            "https://example.com/r4.png",
            "https://example.com/r5.png",
            "https://example.com/r6.png",
          ],
        },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    })

    it("description longer than 1000 chars is rejected with validation_error", async () => {
      setupSupabaseMockStudio({
        charRow: { source_image_url: "https://example.com/portrait.png", canonical_description: null },
      })

      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "refine",
          userId: VALID_UUID,
          description: "x".repeat(1001),
          attachToCharacterId: STUDIO_CHARACTER_ID,
        },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    })

    it("does NOT override imageUrl with character's portrait URL (caller supplies source explicitly)", async () => {
      setupSupabaseMockStudio({
        charRow: { source_image_url: "https://example.com/anchor.png", canonical_description: "tall woman" },
      })

      await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/explicit-source.png",
          prompt: "refine",
          userId: VALID_UUID,
          attachToCharacterId: STUDIO_CHARACTER_ID,
          attachToColumn: "expressions",
          attachName: "smile",
        },
      })

      const enqueuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
      // The caller's imageUrl wins — the route does NOT silently swap to char.source_image_url.
      expect(enqueuedPayload.imageUrl).toBe("https://example.com/explicit-source.png")
    })
  })

  // ---------------------------------------------------------------------------
  // Identity injection (NON-studio path) — injectCharacterContext +
  // attachToCharacterId append canonical_description to the worker prompt.
  // The studio path is intentionally exempt (it already drafts a `description`
  // via LLM and forwards a richer payload).
  //
  // Studio vs non-studio gate: studio = `attachToCharacterId && !injectCharacterContext`.
  // When a DAG executor / workflow wires a Character node downstream, it sets
  // both flags so the simpler injection path runs instead of the studio LLM
  // draft.
  // ---------------------------------------------------------------------------

  describe("identity injection (non-studio path)", () => {
    const NS_CHARACTER_ID = "00000000-0000-4000-8000-0000000000bb"

    function setupSupabaseInjectMock(opts: {
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

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === "characters") return { select: charSelect } as never
        if (table === "jobs") return { insert: jobInsert } as never
        return {} as never
      })
      return { charSelect, charEq1, charEq2, charIs, jobInsert }
    }

    it("appends canonical_description + identity-preserve suffix to the worker prompt", async () => {
      setupSupabaseInjectMock({
        charRow: {
          canonical_description: "A woman with auburn hair and warm hazel eyes.",
          description: null,
          name: "Kira",
        },
      })

      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/source.png",
          prompt: "Make her smile gently",
          userId: VALID_UUID,
          injectCharacterContext: true,
          attachToCharacterId: NS_CHARACTER_ID,
          // No studio fields (attachToColumn/attachName) — workflow caller.
        },
      })

      expect(res.statusCode).toBe(200)
      // Non-studio path triggered (injectCharacterContext=true defeats studio).
      // No LLM call — pure DB lookup + prompt concat.
      expect(llmComplete).not.toHaveBeenCalled()
      const queued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
      const queuedPrompt = queued.prompt as string
      expect(queuedPrompt).toContain("Make her smile gently")
      expect(queuedPrompt).toContain("auburn hair")
      expect(queuedPrompt).toContain("warm hazel eyes")
      expect(queuedPrompt).toContain("same person")
      // force_private NOT set — non-studio path keeps default privacy.
      expect((queued as Record<string, unknown>).force_private).toBeUndefined()
    })

    it("falls back to description when canonical_description is empty", async () => {
      setupSupabaseInjectMock({
        charRow: {
          canonical_description: "",
          description: "Athletic build, brown eyes, short black hair.",
          name: "Aldric",
        },
      })

      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/source.png",
          prompt: "in motion",
          userId: VALID_UUID,
          injectCharacterContext: true,
          attachToCharacterId: NS_CHARACTER_ID,
        },
      })

      expect(res.statusCode).toBe(200)
      const queuedPrompt = (vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>).prompt as string
      expect(queuedPrompt).toContain("Athletic build")
    })

    it("does NOT inject when both canonical_description and description are empty (skip name-only)", async () => {
      setupSupabaseInjectMock({
        charRow: { canonical_description: "", description: null, name: "Kira" },
      })

      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/source.png",
          prompt: "stylize",
          userId: VALID_UUID,
          injectCharacterContext: true,
          attachToCharacterId: NS_CHARACTER_ID,
        },
      })

      expect(res.statusCode).toBe(200)
      const queuedPrompt = (vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>).prompt as string
      expect(queuedPrompt).toBe("stylize")
      expect(queuedPrompt).not.toContain("same person")
    })

    it("scopes the characters lookup by user_id (defense in depth IDOR)", async () => {
      const { charEq1, charEq2, charIs } = setupSupabaseInjectMock({
        charRow: { canonical_description: "ignored", description: null, name: "Kira" },
      })

      await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/source.png",
          prompt: "stylize",
          userId: VALID_UUID,
          injectCharacterContext: true,
          attachToCharacterId: NS_CHARACTER_ID,
        },
      })

      expect(charEq1).toHaveBeenCalledWith("id", NS_CHARACTER_ID)
      expect(charEq2).toHaveBeenCalledWith("user_id", VALID_UUID)
      expect(charIs).toHaveBeenCalledWith("deleted_at", null)
    })
  })

  // Regression net for the flux-2-max underbilling bug: the preHandler check
  // and the handler reservation MUST resolve to the same modelIdentifier.
  // In image-to-image the primary `imageUrl` counts as one of the up-to-8 refs
  // because the worker concatenates [imageUrl, ...referenceImageUrls] before
  // dispatching to Replicate — so the bare i2i call against flux-2-max with
  // zero extra refs must still reserve at `flux-2-max:1MP:1ref` (no resolution
  // in the payload → 1 MP default; primary image counts as the single ref).
  describe("flux-2-max reservation identifier parity", () => {
    it("reserves at `flux-2-max:1MP:1ref` when only the primary imageUrl is supplied", async () => {
      mockJobInsert()

      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/primary.png",
          prompt: "stylize this",
          userId: VALID_UUID,
          provider: "flux-2-max",
        },
      })

      expect(res.statusCode).toBe(200)
      const reserveMock = vi.mocked(reserveCreditsForJob)
      expect(reserveMock).toHaveBeenCalledTimes(1)
      expect(reserveMock.mock.calls[0][3]).toBe("flux-2-max:1MP:1ref")
    })

    it.each([
      [0, "flux-2-max:1MP:1ref"],
      [1, "flux-2-max:1MP:2ref"],
      [3, "flux-2-max:1MP:4ref"],
      [7, "flux-2-max:1MP:8ref"],
    ])(
      "reserves at composite identifier matching primary+%d extras → %s",
      async (extras, expected) => {
        mockJobInsert()
        const refs = Array.from({ length: extras }, (_, i) => `https://r2.nodaro.ai/ref-${i}.png`)

        const res = await app.inject({
          method: "POST",
          url: "/v1/image-to-image",
          payload: {
            imageUrl: "https://example.com/primary.png",
            prompt: "stylize this",
            userId: VALID_UUID,
            provider: "flux-2-max",
            referenceImageUrls: refs,
          },
        })

        expect(res.statusCode).toBe(200)
        const reserveMock = vi.mocked(reserveCreditsForJob)
        expect(reserveMock.mock.calls.at(-1)?.[3]).toBe(expected)
      },
    )
  })

  // ─── MP resolution Zod acceptance (TASK 7) ────────────────────────────────
  describe("resolution: MP values accepted by Zod", () => {
    it("accepts resolution '2 MP' for provider flux-2-max (returns 200, not 400)", async () => {
      mockJobInsert("job-mp-1")
      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/primary.png",
          prompt: "make it dramatic",
          userId: VALID_UUID,
          provider: "flux-2-max",
          resolution: "2 MP",
        },
      })
      // Zod should accept "2 MP"; the route returns 200.
      expect(res.statusCode).toBe(200)
    })

    it("accepts '0.5 MP' resolution", async () => {
      mockJobInsert("job-mp-2")
      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/primary.png",
          prompt: "test",
          userId: VALID_UUID,
          resolution: "0.5 MP",
        },
      })
      expect(res.statusCode).toBe(200)
    })
  })

  // ─── Catalog parameter normalization + CHECK === DEBIT (Task 4) ───────────
  // Mirrors generate-image.test.ts's WI-1b block: `resolveImageToImageCreditIdentifier`
  // is the exact preHandler closure the route registers with `creditGuard`
  // (mocked to a no-op in every route test here), so calling it directly is
  // the only way to exercise the real CHECK pricing. `debitIdentifierFor` runs
  // the route end-to-end and returns BOTH halves of the money record — the
  // DEBIT identifier (`reserveCreditsForJob` arg 4) and the `input_data` row
  // that was persisted — so parity is three-way: CHECK === DEBIT === the
  // levers the job row says produced the result.
  describe("catalog parameter normalization + CHECK === DEBIT", () => {
    const VALID_UUID = "00000000-0000-4000-8000-000000000001"

    function checkIdentifierFor(body: Record<string, unknown>): string {
      return resolveImageToImageCreditIdentifier({ body } as FastifyRequest)
    }

    async function debitIdentifierFor(payload: Record<string, unknown>): Promise<{
      identifier: string | undefined
      inputData: Record<string, unknown>
    }> {
      vi.clearAllMocks()
      const { mockInsert } = mockJobInsert()
      const res = await app.inject({ method: "POST", url: "/v1/image-to-image", payload })
      expect(res.statusCode).toBe(200)
      const row = mockInsert.mock.calls.at(-1)?.[0] as { input_data: Record<string, unknown> }
      return {
        identifier: vi.mocked(reserveCreditsForJob).mock.calls.at(-1)?.[3],
        inputData: row.input_data,
      }
    }

    it("CHECK === DEBIT for gpt-image-2-i2i + auto + 2K (the cross-field snap re-prices to 1K)", async () => {
      const payload = {
        imageUrl: "https://r2.nodaro.ai/in.png",
        prompt: "make it night",
        userId: VALID_UUID,
        provider: "gpt-image-2-i2i",
        aspectRatio: "auto",
        resolution: "2K",
      }
      const { identifier: debit, inputData } = await debitIdentifierFor(payload)
      const check = checkIdentifierFor(payload)
      expect(check).toBe(debit)
      // `auto` only renders 1K, so the reserve is the BASE tier, not `:2K`.
      expect(check).toBe("gpt-image-2-i2i")
      // …and the job row records the 1K render we actually paid for.
      expect(inputData.aspectRatio).toBe("auto")
      expect(inputData.resolution).toBe("1K")
    })

    it("snaps an off-list ratio before enqueue and discloses it", async () => {
      vi.clearAllMocks()
      const { mockInsert } = mockJobInsert()
      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://r2.nodaro.ai/in.png",
          prompt: "make it night",
          userId: VALID_UUID,
          provider: "gpt-image-2-i2i",
          aspectRatio: "3:2",
        },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { adjustments?: { field: string; from: string; to?: string }[] }
      const adj = body.adjustments?.find((a) => a.field === "aspectRatio")
      // 3:2 is off-list for GPT Image 2 (I2I) → snaps to the catalog's first
      // ratio ("auto"), which HAS a replacement (unlike a dropped lever).
      expect(adj?.from).toBe("3:2")
      expect(adj?.to).toBe("auto")

      const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as { aspectRatio?: string }
      expect(queued.aspectRatio).not.toBe("3:2")
      expect(queued.aspectRatio).toBe("auto")

      // The snapped value — not the caller's raw one — is what got persisted.
      const row = mockInsert.mock.calls.at(-1)?.[0] as { input_data: Record<string, unknown> }
      expect(row.input_data.aspectRatio).toBe("auto")
    })

    it("drops a lever the model has no setting for and says so with no `to`", async () => {
      vi.clearAllMocks()
      const { mockInsert } = mockJobInsert()
      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://r2.nodaro.ai/in.png",
          prompt: "make it night",
          userId: VALID_UUID,
          provider: "gpt-image-2-i2i",
          aspectRatio: "16:9",
          // GPT Image 2 (I2I) declares no `qualities` — the lever is dropped,
          // not snapped.
          quality: "high",
        },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { adjustments?: { field: string; from: string; to?: string }[] }
      const adj = body.adjustments?.find((a) => a.field === "quality")
      expect(adj?.from).toBe("high")
      // A dropped lever has no replacement: `to` is absent from the wire body.
      expect(adj).not.toHaveProperty("to")

      const row = mockInsert.mock.calls.at(-1)?.[0] as { input_data: Record<string, unknown> }
      expect(row.input_data.quality).toBeUndefined()
      const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as { quality?: string }
      expect(queued.quality).toBeUndefined()
    })

    it("returns no `adjustments` key when the request was already valid", async () => {
      vi.clearAllMocks()
      mockJobInsert("job-1")
      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://r2.nodaro.ai/in.png",
          prompt: "make it night",
          userId: VALID_UUID,
        },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ jobId: expect.any(String) })
    })

    it("resolver does not throw on a non-object body", () => {
      expect(() =>
        resolveImageToImageCreditIdentifier({ body: null } as unknown as FastifyRequest),
      ).not.toThrow()
      expect(resolveImageToImageCreditIdentifier({ body: null } as unknown as FastifyRequest)).toBe("nano-banana")
    })
  })

  // ---------------------------------------------------------------------------
  // Structural guard for `applySnappedLevers` (backend/src/lib/image-gen-normalize.ts).
  // It narrows each snapped lever through the route's OWN Zod enum and, when
  // that parse fails, leaves the caller's value in place — which would put an
  // un-snapped value on the wire while the credit identifier was priced off the
  // snapped one. That fallback is only unreachable while every value the snap
  // can EMIT is spelled in the route's enums, so sweep it exhaustively instead
  // of trusting the reasoning: every MODIFY_IMAGE_PROVIDERS member (image-to-image
  // is already an i2i provider, so swapToI2i is always false and there is no
  // T2I→I2I variant expansion to add), both a single ref and multiple refs, and
  // every route-enum value plus `undefined` for all three levers.
  // ---------------------------------------------------------------------------
  describe("snap output is always route-enum representable", () => {
    const optionsOf = (field: "aspectRatio" | "resolution" | "quality"): readonly string[] =>
      (imageToImageBody.shape[field].unwrap() as { options: readonly string[] }).options

    it("never emits a lever value the route's Zod enum cannot carry", () => {
      const LEVERS = ["aspectRatio", "resolution", "quality"] as const
      const allowed = {
        aspectRatio: new Set(optionsOf("aspectRatio")),
        resolution: new Set(optionsOf("resolution")),
        quality: new Set(optionsOf("quality")),
      }
      const ratios: (string | undefined)[] = [...optionsOf("aspectRatio"), undefined]
      const resolutions: (string | undefined)[] = [...optionsOf("resolution"), undefined]
      const qualities: (string | undefined)[] = [...optionsOf("quality"), undefined]
      const models = [...new Set<string>(MODIFY_IMAGE_PROVIDERS)]

      const violations: string[] = []
      for (const provider of models) {
        for (const refCount of [1, 2]) {
          for (const aspectRatio of ratios) {
            for (const resolution of resolutions) {
              for (const quality of qualities) {
                const out = resolveNormalizedImageGen({
                  provider,
                  aspectRatio,
                  resolution,
                  quality,
                  refCount,
                  swapToI2i: false,
                })
                for (const field of LEVERS) {
                  const value = out[field]
                  if (value !== undefined && !allowed[field].has(value)) {
                    violations.push(
                      `${provider} refs=${refCount} in(${aspectRatio}/${resolution}/${quality}) → ${field}="${value}"`,
                    )
                  }
                }
              }
            }
          }
        }
      }
      expect(violations).toEqual([])
      // Guard the guard: a domain that silently collapsed would make this vacuous.
      expect(models.length).toBeGreaterThan(20)
      expect(ratios.length * resolutions.length * qualities.length).toBeGreaterThan(200)
    })
  })
})

// The tuple is the ONE ratio vocabulary all three image routes share, and a
// catalog test asserts it is a superset of every image model's declared ratios.
// A private copy here would silently drift out from under that guarantee — the
// exact shape of the bug that shipped twice (Wan 2.7's 8:1/1:8, then Nano
// Banana 2 Lite's 4:1/1:4).
describe("imageToImageBody aspectRatio enum", () => {
  it("declares the SHARED image ratio vocabulary, not a private copy", () => {
    const options = (imageToImageBody.shape.aspectRatio.unwrap() as { options: readonly string[] }).options
    expect([...options]).toEqual([...IMAGE_ASPECT_RATIO_VALUES])
  })
})
