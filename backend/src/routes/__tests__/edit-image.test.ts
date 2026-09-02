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

// Captures the identifier resolver the route hands to `creditGuard` so the
// CHECK === DEBIT parity test below can run the REAL preHandler pricing: the
// guard itself is mocked to a no-op here, so that closure would otherwise never
// execute in a route test and the CHECK side would go entirely unpinned.
const guardHarness = vi.hoisted(() => ({
  resolver: undefined as ((req: { body: unknown }) => string) | undefined,
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: (resolver: unknown) => {
    if (typeof resolver === "function") {
      guardHarness.resolver = resolver as (req: { body: unknown }) => string
    }
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
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  // Mirror the real safeUrlSchema's protocol gate so SSRF-style payloads
  // (javascript:, data:, file:) are rejected the way they would be in prod.
  const safeUrlSchema = z
    .string()
    .url()
    .refine((url) => {
      try {
        const { protocol } = new URL(url)
        return protocol === "http:" || protocol === "https:"
      } catch {
        return false
      }
    })
  return { safeUrlSchema }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { editImageRoutes, resolveEditImageCreditIdentifier, editImageBody } from "../edit-image.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { IMAGE_ASPECT_RATIO_VALUES } from "@nodaro/shared"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // Bypass auth — edit-image reads userId from req.userId (set by auth hook)
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") {
      req.userId = body.userId
      req.userRole = undefined
    }
  })

  await app.register(async (instance) => {
    await editImageRoutes(instance)
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

describe("POST /v1/edit-image", () => {
  it("returns 400 when imageUrl is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: { userId: "00000000-0000-4000-8000-000000000001" },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns 401 when userId is not set", async () => {
    // Do not send userId so the preHandler hook does not set req.userId
    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: { imageUrl: "https://example.com/photo.png" },
    })

    expect(res.statusCode).toBe(401)
    const body = res.json()
    expect(body.error.code).toBe("unauthorized")
  })

  it("returns 400 when nano-banana-edit is used without a prompt", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        imageUrl: "https://example.com/photo.png",
        provider: "nano-banana-edit",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
    expect(body.error.message).toContain("nano-banana-edit")
  })

  it("creates a job and enqueues it on valid request", async () => {
    const { mockFrom, mockInsert } = mockJobInsert({
      data: { id: "job-1" },
      error: null,
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        imageUrl: "https://example.com/photo.png",
        provider: "recraft-upscale",
        userId: "00000000-0000-4000-8000-000000000001",
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
          imageUrl: "https://example.com/photo.png",
          provider: "recraft-upscale",
          type: "edit-image",
        }),
      })
    )

    expect(videoQueue.add).toHaveBeenCalledWith(
      "edit-image",
      expect.objectContaining({
        jobId: "job-1",
        imageUrl: "https://example.com/photo.png",
        provider: "recraft-upscale",
      })
    )
  })

  it("accepts maskUrl as optional field and enqueues job", async () => {
    mockJobInsert({ data: { id: "job-mask-1" }, error: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        imageUrl: "https://example.com/image.png",
        prompt: "replace the sky",
        maskUrl: "https://example.com/mask.png",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-mask-1")
    expect(videoQueue.add).toHaveBeenCalledWith(
      "edit-image",
      expect.objectContaining({ maskUrl: "https://example.com/mask.png" }),
    )
  })

  it("returns 400 when maskUrl is not a safe URL", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        imageUrl: "https://example.com/image.png",
        prompt: "test",
        maskUrl: "javascript:alert(1)",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns 500 when job insert fails", async () => {
    mockJobInsert({
      data: null,
      error: { message: "DB connection failed" },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        imageUrl: "https://example.com/photo.png",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(500)
    const body = res.json()
    expect(body.error.code).toBe("internal_error")
  })

  it("uses recraft-upscale as default provider when none specified", async () => {
    const { mockInsert } = mockJobInsert({
      data: { id: "job-1" },
      error: null,
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        imageUrl: "https://example.com/photo.png",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(200)

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        input_data: expect.objectContaining({
          imageUrl: "https://example.com/photo.png",
          type: "edit-image",
        }),
      })
    )
  })
})

// ---------------------------------------------------------------------------
// grok-upscale provider — accepts taskId instead of imageUrl
// ---------------------------------------------------------------------------

describe("POST /v1/edit-image — grok-upscale provider", () => {
  it("accepts taskId without imageUrl", async () => {
    const { mockInsert } = mockJobInsert({
      data: { id: "job-grok" },
      error: null,
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        provider: "grok-upscale",
        taskId: "grok-prior-task-abc",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        input_data: expect.objectContaining({
          provider: "grok-upscale",
          taskId: "grok-prior-task-abc",
          type: "edit-image",
        }),
      })
    )
    expect(videoQueue.add).toHaveBeenCalledWith(
      "edit-image",
      expect.objectContaining({
        provider: "grok-upscale",
        taskId: "grok-prior-task-abc",
      })
    )
  })

  it("returns 400 when grok-upscale is sent without taskId (even with imageUrl)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        provider: "grok-upscale",
        imageUrl: "https://example.com/photo.png",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns 400 when neither imageUrl nor taskId provided for any provider", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        provider: "recraft-upscale",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("non-grok-upscale providers ignore taskId field if provided", async () => {
    const { mockInsert } = mockJobInsert({
      data: { id: "job-1" },
      error: null,
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        provider: "recraft-upscale",
        imageUrl: "https://example.com/photo.png",
        taskId: "stray-task-id",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    // Request still succeeds — taskId is plumbed through but the worker
    // routes off `provider` not `taskId`. (Belt-and-suspenders: this also
    // catches if the refinement accidentally rejects valid requests when
    // taskId is set alongside imageUrl for a non-grok provider.)
    expect(res.statusCode).toBe(200)
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        input_data: expect.objectContaining({
          imageUrl: "https://example.com/photo.png",
          provider: "recraft-upscale",
        }),
      })
    )
  })
})

// ---------------------------------------------------------------------------
// Grok Imagine 2 task-chained providers — edit (prompt + optional region
// mask indexes) and segment map (free), both keyed off a prior grok-2
// generation's taskId.
// ---------------------------------------------------------------------------

describe("POST /v1/edit-image — grok-2-edit / grok-2-segment providers", () => {
  it("grok-2-edit accepts taskId + prompt + maskIndexes and forwards them to the queue", async () => {
    mockJobInsert({ data: { id: "job-grok2-edit" }, error: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        provider: "grok-2-edit",
        taskId: "task_grok_imagine_image_2_0_123",
        prompt: "make the sky stormy",
        maskIndexes: [2, 5],
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledWith(
      "edit-image",
      expect.objectContaining({
        provider: "grok-2-edit",
        taskId: "task_grok_imagine_image_2_0_123",
        prompt: "make the sky stormy",
        maskIndexes: [2, 5],
      })
    )
  })

  it("grok-2-edit returns 400 without a prompt", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        provider: "grok-2-edit",
        taskId: "task_grok_imagine_image_2_0_123",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain("grok-2-edit")
  })

  it("grok-2-edit returns 400 without taskId (even with imageUrl)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        provider: "grok-2-edit",
        imageUrl: "https://example.com/photo.png",
        prompt: "make the sky stormy",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("grok-2-segment accepts taskId with no prompt (segment map is prompt-free)", async () => {
    mockJobInsert({ data: { id: "job-grok2-segment" }, error: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        provider: "grok-2-segment",
        taskId: "task_grok_imagine_image_2_0_123",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledWith(
      "edit-image",
      expect.objectContaining({
        provider: "grok-2-segment",
        taskId: "task_grok_imagine_image_2_0_123",
      })
    )
  })

  it("accepts maskIndexes [0] — production grok segment indexes are 0-BASED (contra KIE docs)", async () => {
    mockJobInsert({ data: { id: "job-grok2-idx0" }, error: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        provider: "grok-2-edit",
        taskId: "task_grok_imagine_image_2_0_123",
        prompt: "recolor the first region",
        maskIndexes: [0],
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledWith(
      "edit-image",
      expect.objectContaining({ maskIndexes: [0] })
    )
  })

  it("rejects negative maskIndexes entries", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        provider: "grok-2-edit",
        taskId: "task_grok_imagine_image_2_0_123",
        prompt: "make the sky stormy",
        maskIndexes: [-1],
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// Invariant: TASK_CHAINED_EDIT_PROVIDERS (shared, drives route/worker/MCP
// branching) must exactly match the KIE image models registered with
// imageParam: "task_id" (which drives the request-body placement), and every
// member must be an IMAGE_EDIT_PROVIDERS route-enum value. A provider in one
// set but not the other either 400s valid requests or sends a task id as an
// image URL upstream.
// ---------------------------------------------------------------------------

describe("TASK_CHAINED_EDIT_PROVIDERS ↔ KIE imageParam task_id sync", () => {
  it("matches the KIE image models with imageParam 'task_id' exactly", async () => {
    const { TASK_CHAINED_EDIT_PROVIDERS, IMAGE_EDIT_PROVIDERS } = await import("@nodaro/shared")
    const { KIE_IMAGE_MODELS } = await import("@/providers/kie/models.js")

    const taskIdModels = Object.keys(KIE_IMAGE_MODELS)
      .filter((k) => KIE_IMAGE_MODELS[k].imageParam === "task_id")
      .sort()
    expect([...TASK_CHAINED_EDIT_PROVIDERS].sort()).toEqual(taskIdModels)

    const editEnum = new Set<string>(IMAGE_EDIT_PROVIDERS)
    for (const provider of TASK_CHAINED_EDIT_PROVIDERS) {
      expect(editEnum.has(provider), `${provider} missing from IMAGE_EDIT_PROVIDERS`).toBe(true)
    }
  })
})


// ---------------------------------------------------------------------------
// Task 5: `aspectRatio` was `z.string().max(20)` and went straight to KIE as
// `image_size`. It now takes the SHARED image ratio vocabulary
// (`IMAGE_ASPECT_RATIO_VALUES` — the same enum generate-image and
// image-to-image declare) and is snapped against MODEL_CATALOG, so a provider
// with no aspect lever drops it instead of forwarding a meaningless
// `image_size`. `targetResolution` is deliberately NOT snapped: it is this
// route's PRICING dimension and recraft-upscale declares no `resolutions`, so
// a snap would drop a tier the user paid for.
// ---------------------------------------------------------------------------

describe("POST /v1/edit-image — aspect-ratio enum + catalog snap", () => {
  const VALID_UUID = "00000000-0000-4000-8000-000000000001"

  it("400s a free-form aspectRatio", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        imageUrl: "https://r2.nodaro.ai/in.png",
        userId: VALID_UUID,
        provider: "nano-banana-edit",
        prompt: "brighten it",
        aspectRatio: "square_hd",
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("drops the aspect ratio for a provider that has no such lever, and says so", async () => {
    vi.clearAllMocks()
    const { mockInsert } = mockJobInsert({ data: { id: "job-1" }, error: null })
    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        imageUrl: "https://r2.nodaro.ai/in.png",
        userId: VALID_UUID,
        provider: "recraft-upscale",
        aspectRatio: "16:9",
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { adjustments?: { field: string; from: string; to?: string }[] }
    const adj = body.adjustments?.find((a) => a.field === "aspectRatio")
    expect(adj?.from).toBe("16:9")
    // A DROPPED lever has no replacement: `to` is absent from the wire body
    // (JSON strips the undefined), so assert its absence rather than
    // `toMatchObject({ to: undefined })`, which subset-matching would fail on.
    expect(adj).not.toHaveProperty("to")

    const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as { aspectRatio?: string }
    expect(queued.aspectRatio).toBeUndefined()
    // …and the job row records what actually ran, not the caller's raw value.
    const row = mockInsert.mock.calls.at(-1)?.[0] as { input_data: Record<string, unknown> }
    expect(row.input_data.aspectRatio).toBeUndefined()
  })

  it("leaves targetResolution alone — pricing is unchanged", async () => {
    vi.clearAllMocks()
    mockJobInsert({ data: { id: "job-1" }, error: null })
    await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        imageUrl: "https://r2.nodaro.ai/in.png",
        userId: VALID_UUID,
        provider: "topaz-image-upscale",
        targetResolution: "4K",
        aspectRatio: "16:9",
      },
    })
    expect(vi.mocked(reserveCreditsForJob).mock.calls.at(-1)?.[3]).toBe("topaz-image-upscale:4K")
    const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as { targetResolution?: string }
    expect(queued.targetResolution).toBe("4K")
  })

  it("keeps a valid ratio for a provider that does have the lever", async () => {
    vi.clearAllMocks()
    mockJobInsert({ data: { id: "job-1" }, error: null })
    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        imageUrl: "https://r2.nodaro.ai/in.png",
        userId: VALID_UUID,
        provider: "nano-banana-edit",
        prompt: "brighten it",
        aspectRatio: "16:9",
      },
    })
    expect(res.statusCode).toBe(200)
    // Catalog-valid request → byte-identical to the pre-snap 200 body.
    expect(res.json()).toEqual({ jobId: expect.any(String) })
    const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as { aspectRatio?: string }
    expect(queued.aspectRatio).toBe("16:9")
  })

  it("snaps an off-list ratio to one the model declares and discloses it", async () => {
    vi.clearAllMocks()
    mockJobInsert({ data: { id: "job-1" }, error: null })
    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        imageUrl: "https://r2.nodaro.ai/in.png",
        userId: VALID_UUID,
        provider: "nano-banana-edit",
        prompt: "brighten it",
        // In the shared vocabulary (Nano Banana 2 Lite declares it) but NOT in
        // nano-banana-edit's own ratio list — corrected, never rejected.
        aspectRatio: "8:1",
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { adjustments?: { field: string; from: string; to?: string }[] }
    const adj = body.adjustments?.find((a) => a.field === "aspectRatio")
    expect(adj?.from).toBe("8:1")
    expect(adj?.to).toBe("1:1")
    const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as { aspectRatio?: string }
    expect(queued.aspectRatio).toBe("1:1")
  })

  it("declares the SHARED image ratio vocabulary, not a private copy", () => {
    const options = (editImageBody.shape.aspectRatio.unwrap() as { options: readonly string[] }).options
    expect([...options]).toEqual([...IMAGE_ASPECT_RATIO_VALUES])
  })
})

// ---------------------------------------------------------------------------
// R3 / billing parity. `resolveEditImageCreditIdentifier` is the exact
// preHandler closure the route registers with `creditGuard` (mocked to a no-op
// in every route test here), so calling it directly is the only way to
// exercise the real CHECK pricing. The aspect snap must be billing-NEUTRAL on
// this route: pricing keys on `targetResolution` alone.
// ---------------------------------------------------------------------------

describe("POST /v1/edit-image — CHECK === DEBIT", () => {
  const VALID_UUID = "00000000-0000-4000-8000-000000000001"

  async function debitFor(payload: Record<string, unknown>): Promise<{
    identifier: string | undefined
    inputData: Record<string, unknown>
  }> {
    vi.clearAllMocks()
    const { mockInsert } = mockJobInsert({ data: { id: "job-1" }, error: null })
    const res = await app.inject({ method: "POST", url: "/v1/edit-image", payload })
    expect(res.statusCode).toBe(200)
    const row = mockInsert.mock.calls.at(-1)?.[0] as { input_data: Record<string, unknown> }
    return {
      identifier: vi.mocked(reserveCreditsForJob).mock.calls.at(-1)?.[3],
      inputData: row.input_data,
    }
  }

  it("a dropped aspect ratio does not move the price (recraft-upscale)", async () => {
    const payload = {
      imageUrl: "https://r2.nodaro.ai/in.png",
      userId: VALID_UUID,
      provider: "recraft-upscale",
      aspectRatio: "16:9",
    }
    const { identifier: debit, inputData } = await debitFor(payload)
    const check = resolveEditImageCreditIdentifier({ body: payload } as FastifyRequest)
    expect(check).toBe(debit)
    expect(check).toBe("recraft-upscale")
    // The ratio was dropped from the job row; the price is the base tier.
    expect(inputData.aspectRatio).toBeUndefined()
  })

  it("targetResolution still tiers the price, with an aspect ratio alongside it", async () => {
    const payload = {
      imageUrl: "https://r2.nodaro.ai/in.png",
      userId: VALID_UUID,
      provider: "topaz-image-upscale",
      targetResolution: "4K",
      aspectRatio: "16:9",
    }
    const { identifier: debit, inputData } = await debitFor(payload)
    const check = resolveEditImageCreditIdentifier({ body: payload } as FastifyRequest)
    expect(check).toBe(debit)
    expect(check).toBe("topaz-image-upscale:4K")
    expect(inputData.targetResolution).toBe("4K")
    expect(inputData.aspectRatio).toBeUndefined()
  })

  it("resolver does not throw on a non-object body", () => {
    expect(() =>
      resolveEditImageCreditIdentifier({ body: null } as unknown as FastifyRequest),
    ).not.toThrow()
    expect(resolveEditImageCreditIdentifier({ body: null } as unknown as FastifyRequest)).toBe(
      "recraft-upscale",
    )
  })
})
// ---------------------------------------------------------------------------
// topaz-image-upscale — CHECK === DEBIT === SENT.
//
// KIE's `topaz/image-upscale` exposes exactly ONE quality lever
// (`upscale_factor`: 1 / 2 / 4). The route nevertheless priced on
// `targetResolution`, a control with no provider parameter behind it, and the
// worker rendered whatever `upscaleFactor` said — so the tier the user was
// charged for and the tier that was rendered could disagree in BOTH directions
// (a 4K/8K target billed a 2x render; a bare `upscaleFactor: "4"` billed the
// base tier). `resolveTopazUpscale` is now the single authority at the CHECK
// (preHandler), the DEBIT (reservation) and the enqueued payload, so all three
// have to agree for every combination of the two legacy inputs.
// ---------------------------------------------------------------------------

const TOPAZ_UUID = "00000000-0000-4000-8000-000000000001"

/** POST the body with a valid user + a successful job insert. */
async function postTopaz(payload: Record<string, unknown>) {
  mockJobInsert({ data: { id: "job-topaz-1" }, error: null })
  return app.inject({
    method: "POST",
    url: "/v1/edit-image",
    payload: { userId: TOPAZ_UUID, ...payload },
  })
}

/** The DEBIT identifier — `reserveCreditsForJob`'s 4th argument. */
function topazDebitIdentifier(): string | undefined {
  return vi.mocked(reserveCreditsForJob).mock.calls.at(-1)?.[3]
}

/** The CHECK identifier — the REAL preHandler resolver, run on the same body. */
function topazCheckIdentifier(body: Record<string, unknown>): string {
  if (!guardHarness.resolver) throw new Error("creditGuard resolver was never captured")
  return guardHarness.resolver({ body })
}

/** The factor the worker actually receives, from the enqueued payload. */
function topazSentFactor(): unknown {
  const payload = vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as Record<string, unknown> | undefined
  return payload?.upscaleFactor
}

describe("topaz-image-upscale reserves the tier it renders", () => {
  it("charges the bare tier for a 4K target with the default 2x factor", async () => {
    const res = await postTopaz({
      imageUrl: "https://img.png",
      provider: "topaz-image-upscale",
      upscaleFactor: "2",
      targetResolution: "4K",
    })
    expect(res.statusCode).toBe(200)
    expect(reserveCreditsForJob).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.any(String), "topaz-image-upscale",
    )
  })

  it("charges the 4x tier when the factor is 4", async () => {
    const res = await postTopaz({
      imageUrl: "https://img.png",
      provider: "topaz-image-upscale",
      upscaleFactor: "4",
    })
    expect(res.statusCode).toBe(200)
    expect(reserveCreditsForJob).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.any(String), "topaz-image-upscale:4K",
    )
  })

  it("enqueues the resolved factor so the worker and the reservation agree", async () => {
    await postTopaz({
      imageUrl: "https://img.png",
      provider: "topaz-image-upscale",
      targetResolution: "8K",
    })
    expect(videoQueue.add).toHaveBeenCalledWith(
      "edit-image",
      expect.objectContaining({ provider: "topaz-image-upscale", upscaleFactor: "4" }),
    )
  })

  it("keeps targetResolution on the payload as the evidence of what was asked for", async () => {
    await postTopaz({
      imageUrl: "https://img.png",
      provider: "topaz-image-upscale",
      targetResolution: "8K",
    })
    expect(videoQueue.add).toHaveBeenCalledWith(
      "edit-image",
      expect.objectContaining({ targetResolution: "8K" }),
    )
  })

  it("leaves a non-topaz provider's identifier and factor untouched", async () => {
    const res = await postTopaz({
      imageUrl: "https://img.png",
      provider: "recraft-upscale",
      upscaleFactor: "4",
    })
    expect(res.statusCode).toBe(200)
    expect(topazDebitIdentifier()).toBe("recraft-upscale")
    expect(topazSentFactor()).toBe("4")
  })
})

// The four bodies below are the ones the Task 2 review showed diverging in
// production: the first two under-charge relative to the 4x render, the third
// over-charges (an 8K tier reserved for a 2x render), the fourth is the
// untouched default. CHECK, DEBIT and the worker-visible factor are asserted
// against each other AND pinned to concrete values, so a regression that moves
// all three together still fails.
describe("topaz-image-upscale CHECK === DEBIT === SENT parity", () => {
  const CASES: Array<{
    label: string
    body: Record<string, unknown>
    identifier: string
    factor: string
  }> = [
    { label: "legacy 4K target, no factor", body: { targetResolution: "4K" }, identifier: "topaz-image-upscale:4K", factor: "4" },
    { label: "explicit 4x factor", body: { upscaleFactor: "4" }, identifier: "topaz-image-upscale:4K", factor: "4" },
    { label: "2x factor overriding a stored 8K tier", body: { upscaleFactor: "2", targetResolution: "8K" }, identifier: "topaz-image-upscale", factor: "2" },
    { label: "neither lever set (provider default)", body: {}, identifier: "topaz-image-upscale", factor: "2" },
  ]

  it.each(CASES)("$label", async ({ body, identifier, factor }) => {
    const full = { imageUrl: "https://img.png", provider: "topaz-image-upscale", ...body }
    const res = await postTopaz(full)
    expect(res.statusCode).toBe(200)

    const debit = topazDebitIdentifier()
    const check = topazCheckIdentifier({ userId: TOPAZ_UUID, ...full })
    expect(check).toBe(debit)
    expect(check).toBe(identifier)
    expect(topazSentFactor()).toBe(factor)
  })
})
