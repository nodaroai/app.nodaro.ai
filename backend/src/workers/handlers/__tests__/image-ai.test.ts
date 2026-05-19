import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() for variables used inside vi.mock()
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockGenerateImage = vi.fn()
  const mockEditImage = vi.fn()
  const mockCommitJobCredits = vi.fn().mockResolvedValue(undefined)
  const mockShouldSaveJobResult = vi.fn().mockResolvedValue(true)
  const mockMarkJobCompleted = vi.fn().mockResolvedValue(true)
  const mockUploadImageMaybeWatermark = vi.fn().mockResolvedValue("https://r2.example.com/images/job-1.png")
  const mockUploadImageVariantsMaybeWatermark = vi
    .fn<(urls: readonly string[], jobId: string) => Promise<readonly string[]>>()
    .mockImplementation(async (urls, jobId) =>
      urls.map((_, i) =>
        i === 0
          ? `https://r2.example.com/images/${jobId}.png`
          : `https://r2.example.com/images/${jobId}-v${i}.png`,
      ),
    )
  const mockAttach = vi.fn().mockResolvedValue(true)

  // Supabase chain
  const mockEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate })

  return {
    mockGenerateImage,
    mockEditImage,
    mockCommitJobCredits,
    mockShouldSaveJobResult,
    mockMarkJobCompleted,
    mockUploadImageMaybeWatermark,
    mockUploadImageVariantsMaybeWatermark,
    mockAttach,
    mockFrom,
    mockUpdate,
    mockEq,
  }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mocks.mockFrom },
}))

vi.mock("@/providers/index.js", () => ({
  generateImage: mocks.mockGenerateImage,
  editImage: mocks.mockEditImage,
}))

vi.mock("@/lib/character-auto-attach.js", () => ({
  attachAssetToCharacter: mocks.mockAttach,
  resolveAssetColumn: (v: string) => {
    const normalized = v === "lighting" ? "lighting_variations" : v
    const valid = new Set(["expressions", "poses", "lighting_variations", "angles", "motions"])
    return valid.has(normalized) ? normalized : null
  },
}))

vi.mock("../../shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared.js")>()
  return {
    ...actual,
    commitJobCredits: mocks.mockCommitJobCredits,
    shouldSaveJobResult: mocks.mockShouldSaveJobResult,
    markJobCompleted: mocks.mockMarkJobCompleted,
    uploadImageMaybeWatermark: mocks.mockUploadImageMaybeWatermark,
    uploadImageVariantsMaybeWatermark: mocks.mockUploadImageVariantsMaybeWatermark,
    setJobProgress: vi.fn().mockResolvedValue(undefined),
    startProgressRamp: vi.fn().mockReturnValue({ stop: vi.fn() }),
  }
})

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { imageAIHandlers } from "../image-ai.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(name: string, data: Record<string, unknown> = {}) {
  return {
    name,
    data: { jobId: "job-1", ...data },
    id: "bull-1",
    updateProgress: vi.fn(),
  }
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job-1",
    jobUserId: "user-1",
    usageLogId: "usage-1",
    shouldWatermark: false,
    ...overrides,
  }
}

const PROVIDER_RESULT = {
  url: "https://provider.example.com/image.png",
  providerUsed: "nano-banana",
  cost: 0.02,
  displayCost: 0.025,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockGenerateImage.mockResolvedValue(PROVIDER_RESULT)
  mocks.mockEditImage.mockResolvedValue(PROVIDER_RESULT)
  mocks.mockShouldSaveJobResult.mockResolvedValue(true)
  mocks.mockUploadImageMaybeWatermark.mockResolvedValue("https://r2.example.com/images/job-1.png")
})

// ---------------------------------------------------------------------------
// generate-image
// ---------------------------------------------------------------------------

describe("generate-image handler", () => {
  const handler = imageAIHandlers["generate-image"]

  it("happy path: generates, uploads, saves, commits credits", async () => {
    const job = makeJob("generate-image", { prompt: "a cat" })
    const ctx = makeCtx()

    await handler(job as never, ctx)

    expect(mocks.mockGenerateImage).toHaveBeenCalledWith(
      "a cat", "nano-banana", undefined, undefined,
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
    expect(mocks.mockUploadImageVariantsMaybeWatermark).toHaveBeenCalledWith(
      [PROVIDER_RESULT.url], "job-1", "user-1", false,
    )
    // Progress is now written through the `setJobProgress` helper in
    // shared.ts (mocked above as a no-op). The handler still passes
    // 10 → 85 → 100 through it; we don't re-assert that here since
    // the helper itself is unit-tested separately.
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
      output_data: { imageUrl: "https://r2.example.com/images/job-1.png" },
      provider: "nano-banana",
      provider_cost: 0.02,
      display_cost: 0.025,
    }))
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1", PROVIDER_RESULT.cost)
  })

  it("uses default provider 'nano-banana' when none specified", async () => {
    const job = makeJob("generate-image", { prompt: "a dog" })
    await handler(job as never, makeCtx())

    expect(mocks.mockGenerateImage).toHaveBeenCalledWith(
      "a dog", "nano-banana", undefined, undefined,
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
  })

  it("uses custom provider when specified", async () => {
    const job = makeJob("generate-image", { prompt: "a bird", provider: "flux" })
    await handler(job as never, makeCtx())

    expect(mocks.mockGenerateImage).toHaveBeenCalledWith(
      "a bird", "flux", undefined, undefined,
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
  })

  it("passes referenceImageUrls to provider", async () => {
    const refs = ["https://ref1.png", "https://ref2.png"]
    const job = makeJob("generate-image", { prompt: "style transfer", referenceImageUrls: refs })
    await handler(job as never, makeCtx())

    expect(mocks.mockGenerateImage).toHaveBeenCalledWith(
      "style transfer", "nano-banana", refs, undefined,
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
  })

  it("converts aspectRatio to extraParams", async () => {
    const job = makeJob("generate-image", { prompt: "wide shot", aspectRatio: "16:9" })
    await handler(job as never, makeCtx())

    expect(mocks.mockGenerateImage).toHaveBeenCalledWith(
      "wide shot", "nano-banana", undefined, { aspect_ratio: "16:9" },
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
  })

  it("returns early when job is cancelled (shouldSaveJobResult returns false)", async () => {
    mocks.mockShouldSaveJobResult.mockResolvedValueOnce(false)
    const job = makeJob("generate-image", { prompt: "cancelled" })
    await handler(job as never, makeCtx())

    expect(mocks.mockUploadImageVariantsMaybeWatermark).toHaveBeenCalled()
    expect(mocks.mockMarkJobCompleted).not.toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).not.toHaveBeenCalled()
  })

  it("passes watermark flag through to upload helper", async () => {
    const job = makeJob("generate-image", { prompt: "watermarked" })
    await handler(job as never, makeCtx({ shouldWatermark: true }))

    expect(mocks.mockUploadImageVariantsMaybeWatermark).toHaveBeenCalledWith(
      [PROVIDER_RESULT.url], "job-1", "user-1", true,
    )
  })

  // Regression net for the Grok bug: KIE's grok-imagine endpoint returns up
  // to 6 image variants per task in resultUrls. Pre-fix, the provider took
  // resultUrls[0] and dropped the others. Now extraUrls is forwarded all the
  // way to output_data.imageUrls so the frontend can fan out N results.
  it("fans out all provider variants to output_data.imageUrls", async () => {
    const variants = [
      "https://provider.example.com/img-a.jpg",
      "https://provider.example.com/img-b.jpg",
      "https://provider.example.com/img-c.jpg",
      "https://provider.example.com/img-d.jpg",
      "https://provider.example.com/img-e.jpg",
      "https://provider.example.com/img-f.jpg",
    ]
    mocks.mockGenerateImage.mockResolvedValueOnce({
      url: variants[0],
      extraUrls: variants.slice(1),
      providerUsed: "grok",
      cost: 0.04,
      displayCost: 0.05,
    })
    const job = makeJob("generate-image", { prompt: "grok grid", provider: "grok" })
    await handler(job as never, makeCtx())

    expect(mocks.mockUploadImageVariantsMaybeWatermark).toHaveBeenCalledWith(
      variants, "job-1", "user-1", false,
    )
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
      output_data: expect.objectContaining({
        imageUrl: "https://r2.example.com/images/job-1.png",
        imageUrls: [
          "https://r2.example.com/images/job-1.png",
          "https://r2.example.com/images/job-1-v1.png",
          "https://r2.example.com/images/job-1-v2.png",
          "https://r2.example.com/images/job-1-v3.png",
          "https://r2.example.com/images/job-1-v4.png",
          "https://r2.example.com/images/job-1-v5.png",
        ],
      }),
    }))
  })

  // The inverse: single-result providers must NOT add imageUrls to output_data
  // (downstream code distinguishes single vs multi by array presence). Pre-fix
  // a stray empty array would have triggered the multi-variant UI for every job.
  it("omits imageUrls when provider returns only a single variant", async () => {
    const job = makeJob("generate-image", { prompt: "single" })
    await handler(job as never, makeCtx())

    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
      output_data: expect.not.objectContaining({ imageUrls: expect.anything() }),
    }))
  })

  // Reconciliation wiring (Task 1.11): the handler builds a
  // `makeOnTaskCreated` callback and passes it to `generateImage`. When the
  // provider fires it with a fresh taskId, the persistence layer issues a
  // supabase update setting provider_kind + provider_task_id +
  // provider_call_started_at on the job row. We assert by intercepting the
  // mock generateImage call: pull the reconcileOpts arg, invoke its callback,
  // then check the supabase update mock.
  it("persists provider_kind + provider_task_id on the job row via makeOnTaskCreated", async () => {
    mocks.mockGenerateImage.mockImplementationOnce(
      async (
        _prompt: string,
        _model: string,
        _refs: unknown,
        _extra: unknown,
        reconcileOpts?: { onTaskCreated?: (taskId: string) => Promise<void> },
      ) => {
        if (reconcileOpts?.onTaskCreated) {
          await reconcileOpts.onTaskCreated("t-test")
        }
        return PROVIDER_RESULT
      },
    )
    const job = makeJob("generate-image", { prompt: "reconcile-me" })

    await handler(job as never, makeCtx())

    expect(mocks.mockFrom).toHaveBeenCalledWith("jobs")
    expect(mocks.mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_kind: "kie-standard",
        provider_task_id: "t-test",
        provider_call_started_at: expect.any(String),
      }),
    )
    expect(mocks.mockEq).toHaveBeenCalledWith("id", "job-1")
  })
})

// ---------------------------------------------------------------------------
// edit-image
// ---------------------------------------------------------------------------

describe("edit-image handler", () => {
  const handler = imageAIHandlers["edit-image"]

  it("happy path: edits, uploads, saves, commits credits", async () => {
    const job = makeJob("edit-image", { imageUrl: "https://input.png", prompt: "upscale" })
    const ctx = makeCtx()

    await handler(job as never, ctx)

    expect(mocks.mockEditImage).toHaveBeenCalledWith(
      "https://input.png", "recraft-upscale", "upscale", undefined,
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
    expect(mocks.mockUploadImageVariantsMaybeWatermark).toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1", PROVIDER_RESULT.cost)
  })

  it("uses default provider 'recraft-upscale' when none specified", async () => {
    const job = makeJob("edit-image", { imageUrl: "https://input.png" })
    await handler(job as never, makeCtx())

    expect(mocks.mockEditImage).toHaveBeenCalledWith(
      "https://input.png", "recraft-upscale", undefined, undefined,
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
  })

  it("uses custom provider when specified", async () => {
    const job = makeJob("edit-image", { imageUrl: "https://input.png", provider: "recraft-remove-bg" })
    await handler(job as never, makeCtx())

    expect(mocks.mockEditImage).toHaveBeenCalledWith(
      "https://input.png", "recraft-remove-bg", undefined, undefined,
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
  })

  it("handles undefined prompt", async () => {
    const job = makeJob("edit-image", { imageUrl: "https://input.png" })
    await handler(job as never, makeCtx())

    expect(mocks.mockEditImage).toHaveBeenCalledWith(
      "https://input.png", "recraft-upscale", undefined, undefined,
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
  })

  // -------------------------------------------------------------------------
  // grok-upscale: takes a prior Grok task_id instead of imageUrl. The KIE
  // provider's editImage signature is unchanged — the worker passes the
  // taskId through the imageUrl arg, and `imageParam: "task_id"` on the KIE
  // model config (kie/models.ts) routes it to the correct request key.
  // -------------------------------------------------------------------------

  it("grok-upscale: passes taskId through the imageUrl arg of editImage", async () => {
    const job = makeJob("edit-image", {
      provider: "grok-upscale",
      taskId: "grok-prior-task-abc",
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockEditImage).toHaveBeenCalledWith(
      "grok-prior-task-abc", // taskId routed through imageUrl arg
      "grok-upscale",
      undefined,
      undefined,
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
  })

  it("grok-upscale: throws when taskId is missing (no fallback to imageUrl)", async () => {
    const job = makeJob("edit-image", {
      provider: "grok-upscale",
      imageUrl: "https://input.png", // ignored for grok-upscale
    })

    await expect(handler(job as never, makeCtx())).rejects.toThrow(
      /grok-upscale requires taskId/,
    )
    expect(mocks.mockEditImage).not.toHaveBeenCalled()
  })

  it("non-grok-upscale providers ignore taskId field in job data", async () => {
    const job = makeJob("edit-image", {
      provider: "recraft-upscale",
      imageUrl: "https://input.png",
      taskId: "ignored-task-id",
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockEditImage).toHaveBeenCalledWith(
      "https://input.png", // imageUrl wins for non-grok providers
      "recraft-upscale",
      undefined,
      undefined,
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
  })

  it("non-grok-upscale: throws when imageUrl is missing", async () => {
    const job = makeJob("edit-image", { provider: "recraft-upscale" })

    await expect(handler(job as never, makeCtx())).rejects.toThrow(
      /edit-image requires imageUrl/,
    )
    expect(mocks.mockEditImage).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// image-to-image
// ---------------------------------------------------------------------------

describe("image-to-image handler", () => {
  const handler = imageAIHandlers["image-to-image"]

  it("happy path: combines imageUrl with referenceImageUrls and generates", async () => {
    const refs = ["https://ref1.png"]
    const job = makeJob("image-to-image", {
      imageUrl: "https://main.png",
      referenceImageUrls: refs,
      prompt: "transform",
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockGenerateImage).toHaveBeenCalledWith(
      "transform", "nano-banana", ["https://main.png", "https://ref1.png"], undefined,
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1", PROVIDER_RESULT.cost)
  })

  it("uses default provider 'nano-banana' when none specified", async () => {
    const job = makeJob("image-to-image", { imageUrl: "https://main.png", prompt: "edit" })
    await handler(job as never, makeCtx())

    expect(mocks.mockGenerateImage).toHaveBeenCalledWith(
      "edit", "nano-banana", ["https://main.png"], undefined,
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
  })

  it("uses custom provider when specified", async () => {
    const job = makeJob("image-to-image", { imageUrl: "https://main.png", prompt: "edit", provider: "flux-i2i" })
    await handler(job as never, makeCtx())

    expect(mocks.mockGenerateImage).toHaveBeenCalledWith(
      "edit", "flux-i2i", ["https://main.png"], undefined,
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
  })

  it("works without referenceImageUrls", async () => {
    const job = makeJob("image-to-image", { imageUrl: "https://main.png", prompt: "solo" })
    await handler(job as never, makeCtx())

    expect(mocks.mockGenerateImage).toHaveBeenCalledWith(
      "solo", "nano-banana", ["https://main.png"], undefined,
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
  })

  it("returns early when cancelled", async () => {
    mocks.mockShouldSaveJobResult.mockResolvedValueOnce(false)
    const job = makeJob("image-to-image", { imageUrl: "https://main.png", prompt: "cancelled" })
    await handler(job as never, makeCtx())

    expect(mocks.mockMarkJobCompleted).not.toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Character Studio auto-attach (studio path)
  //
  // When the route's image-to-image handler is called with
  // attachToCharacterId + attachToColumn + attachName, the worker forwards
  // the result to attachAssetToCharacter. Task 9 added description +
  // realLifeRefs to the worker payload; Task 12 closes the loop here in the
  // worker by passing those richer fields into the attach helper's `item`.
  // -------------------------------------------------------------------------

  it("studio path passes description + realLifeRefs to attachAssetToCharacter", async () => {
    const job = makeJob("image-to-image", {
      imageUrl: "https://x/portrait.png",
      prompt: "warmer lighting",
      provider: "nano-banana-pro",
      attachToCharacterId: "00000000-0000-0000-0000-000000000abc",
      attachToColumn: "expressions",
      attachName: "warm",
      description: "warm closed-mouth smile, soft golden hour light",
      realLifeRefs: ["https://x/ref1.jpg"],
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockAttach).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: "00000000-0000-0000-0000-000000000abc",
        column: "expressions",
        item: expect.objectContaining({
          name: "warm",
          url: "https://r2.example.com/images/job-1.png",
          description: "warm closed-mouth smile, soft golden hour light",
          realLifeRefs: ["https://x/ref1.jpg"],
        }),
      }),
    )
  })

  it("studio path with undefined description / realLifeRefs leaves them undefined on the item", async () => {
    const job = makeJob("image-to-image", {
      imageUrl: "https://x/portrait.png",
      prompt: "stylize",
      provider: "nano-banana-pro",
      attachToCharacterId: "00000000-0000-0000-0000-000000000abc",
      attachToColumn: "expressions",
      attachName: "warm",
      // description + realLifeRefs intentionally omitted (route may not
      // forward them on the non-studio path, or LLM draft may have failed)
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockAttach).toHaveBeenCalledTimes(1)
    const call = mocks.mockAttach.mock.calls[0]?.[0] as {
      item: { description?: unknown; realLifeRefs?: unknown }
    }
    expect(call.item.description).toBeUndefined()
    expect(call.item.realLifeRefs).toBeUndefined()
  })

  it("non-studio path does NOT call attachAssetToCharacter", async () => {
    const job = makeJob("image-to-image", {
      imageUrl: "https://x/whatever.png",
      prompt: "stylize",
      provider: "nano-banana",
      // no attachToCharacterId / attachToColumn / attachName
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockAttach).not.toHaveBeenCalled()
  })
})
