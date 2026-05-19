import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const mockGenerateImage = vi.fn()
  const mockImageToVideo = vi.fn()
  const mockGenerateScript = vi.fn()
  const mockCommitJobCredits = vi.fn().mockResolvedValue(undefined)
  const mockShouldSaveJobResult = vi.fn().mockResolvedValue(true)
  const mockMarkJobCompleted = vi.fn().mockResolvedValue(true)
  const mockUploadImageMaybeWatermark = vi.fn().mockResolvedValue("https://r2.example.com/images/job-1.png")
  const mockUploadVideoMaybeWatermark = vi.fn().mockResolvedValue("https://r2.example.com/videos/job-1.mp4")
  const mockAttach = vi.fn().mockResolvedValue(true)
  const mockSetPortrait = vi.fn().mockResolvedValue(true)
  const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null })

  // Default chain for `.from("locations").select(...).eq(...).eq(...).is(...).single()`
  // returns a row (ownership succeeds). Individual tests override via
  // `mockLocationSingle.mockResolvedValueOnce(...)`.
  const mockLocationSingle = vi.fn().mockResolvedValue({ data: { id: "loc-1" }, error: null })
  const mockLocationIs = vi.fn().mockReturnValue({ single: mockLocationSingle })
  const mockLocationEq2 = vi.fn().mockReturnValue({ is: mockLocationIs })
  const mockLocationEq1 = vi.fn().mockReturnValue({ eq: mockLocationEq2 })
  const mockLocationSelect = vi.fn().mockReturnValue({ eq: mockLocationEq1 })

  const mockEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  // `from` routes by table name — locations gets the select chain, anything
  // else gets the old update chain (back-compat for existing character tests).
  const mockFrom = vi.fn((table: string) => {
    if (table === "locations") return { select: mockLocationSelect }
    return { update: mockUpdate }
  })

  return {
    mockGenerateImage,
    mockImageToVideo,
    mockGenerateScript,
    mockCommitJobCredits,
    mockShouldSaveJobResult,
    mockMarkJobCompleted,
    mockUploadImageMaybeWatermark,
    mockUploadVideoMaybeWatermark,
    mockAttach,
    mockSetPortrait,
    mockRpc,
    mockFrom,
    mockUpdate,
    mockEq,
    mockLocationSelect,
    mockLocationEq1,
    mockLocationEq2,
    mockLocationIs,
    mockLocationSingle,
  }
})

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.mockFrom, rpc: mocks.mockRpc } }))
vi.mock("@/providers/index.js", () => ({ generateImage: mocks.mockGenerateImage, imageToVideo: mocks.mockImageToVideo }))
vi.mock("@/providers/script/script-generator.js", () => ({ generateScript: mocks.mockGenerateScript }))
vi.mock("@/lib/character-auto-attach.js", () => ({
  attachAssetToCharacter: mocks.mockAttach,
  setCharacterPortrait: mocks.mockSetPortrait,
  resolveAssetColumn: (v: string) => {
    const normalized = v === "lighting" ? "lighting_variations" : v
    const valid = new Set(["expressions", "poses", "lighting_variations", "angles", "motions"])
    return valid.has(normalized) ? normalized : null
  },
}))
vi.mock("../../shared.js", () => ({
  commitJobCredits: mocks.mockCommitJobCredits,
  shouldSaveJobResult: mocks.mockShouldSaveJobResult,
  markJobCompleted: mocks.mockMarkJobCompleted,
  uploadImageMaybeWatermark: mocks.mockUploadImageMaybeWatermark,
  uploadVideoMaybeWatermark: mocks.mockUploadVideoMaybeWatermark,
  setJobProgress: vi.fn().mockResolvedValue(undefined),
  startProgressRamp: vi.fn().mockReturnValue({ stop: vi.fn() }),
}))

import { entityHandlers } from "../entity.js"

function makeJob(name: string, data: Record<string, unknown> = {}) {
  return { name, data: { jobId: "job-1", ...data }, id: "bull-1", updateProgress: vi.fn() }
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return { jobId: "job-1", jobUserId: "user-1", usageLogId: "usage-1", shouldWatermark: false, ...overrides }
}

const PROVIDER_RESULT = {
  url: "https://provider.example.com/image.png",
  providerUsed: "nano-banana",
  cost: 0.02,
  displayCost: 0.025,
}

const VIDEO_PROVIDER_RESULT = {
  url: "https://provider.example.com/video.mp4",
  providerUsed: "kling",
  cost: 0.5,
  displayCost: 0.6,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockGenerateImage.mockResolvedValue(PROVIDER_RESULT)
  mocks.mockImageToVideo.mockResolvedValue(VIDEO_PROVIDER_RESULT)
  mocks.mockGenerateScript.mockResolvedValue({ title: "My Script", scenes: [{ description: "Scene 1" }] })
  mocks.mockShouldSaveJobResult.mockResolvedValue(true)
  mocks.mockMarkJobCompleted.mockResolvedValue(true)
  mocks.mockRpc.mockResolvedValue({ data: null, error: null })
  // Restore the active-location default for ownership re-queries.
  mocks.mockLocationSingle.mockResolvedValue({ data: { id: "loc-1" }, error: null })
})

describe("generate-character handler", () => {
  const handler = entityHandlers["generate-character"]

  it("happy path: generates character image", async () => {
    const job = makeJob("generate-character", { prompt: "a warrior" })
    await handler(job as never, makeCtx())

    expect(mocks.mockGenerateImage).toHaveBeenCalledWith(
      "a warrior", "nano-banana", undefined, undefined,
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
    expect(mocks.mockUploadImageMaybeWatermark).toHaveBeenCalledWith(PROVIDER_RESULT.url, "job-1", "user-1", false)
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1", PROVIDER_RESULT.cost)
  })

  it("uses custom provider", async () => {
    const job = makeJob("generate-character", { prompt: "a wizard", provider: "flux" })
    await handler(job as never, makeCtx())
    expect(mocks.mockGenerateImage).toHaveBeenCalledWith(
      "a wizard", "flux", undefined, undefined,
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
  })

  it("passes source image as reference", async () => {
    const job = makeJob("generate-character", { prompt: "style transfer", sourceImageUrl: "https://ref.png" })
    await handler(job as never, makeCtx())
    expect(mocks.mockGenerateImage).toHaveBeenCalledWith(
      "style transfer", "nano-banana", ["https://ref.png"], undefined,
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
  })

  it("forwards aspectRatio from job.data to generateImage extraParams.aspect_ratio", async () => {
    // The route's resolveCharacterAspectRatio computes the final ratio and
    // puts it on job.data.aspectRatio. The handler must forward that to
    // generateImage as `{ aspect_ratio: ... }` so the provider call uses it.
    const job = makeJob("generate-character", { prompt: "a warrior", aspectRatio: "3:4" })
    await handler(job as never, makeCtx())
    expect(mocks.mockGenerateImage).toHaveBeenCalledWith(
      "a warrior",
      "nano-banana",
      undefined,
      { aspect_ratio: "3:4" },
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
  })

  // Reconciliation wiring (Task 1.11): when generateImage fires
  // onTaskCreated with a taskId, the persistence layer writes provider_kind
  // + provider_task_id + provider_call_started_at on the job row. nano-banana
  // routes through KIE so the kind is "kie-standard".
  it("persists provider_kind + provider_task_id on the job row via makeOnTaskCreated", async () => {
    mocks.mockGenerateImage.mockImplementationOnce(
      async (
        _prompt: unknown,
        _model: unknown,
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
    const job = makeJob("generate-character", { prompt: "reconcile-me" })

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

describe("generate-face handler", () => {
  const handler = entityHandlers["generate-face"]

  it("forces 1:1 aspect ratio", async () => {
    const job = makeJob("generate-face", { prompt: "a portrait" })
    await handler(job as never, makeCtx())
    expect(mocks.mockGenerateImage).toHaveBeenCalledWith(
      "a portrait", "nano-banana", undefined, { aspect_ratio: "1:1" },
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
  })
})

describe("generate-character-asset handler", () => {
  const handler = entityHandlers["generate-character-asset"]
  const TEST_CHARACTER_ID = "00000000-0000-0000-0000-000000000abc"

  it("includes assetType in output", async () => {
    const job = makeJob("generate-character-asset", { prompt: "a sword", assetType: "weapon" })
    await handler(job as never, makeCtx())
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
      output_data: { imageUrl: "https://r2.example.com/images/job-1.png", assetType: "weapon" },
    }))
  })

  it("passes description / motionDescription / realLifeRefs through to attachAssetToCharacter", async () => {
    const job = makeJob("generate-character-asset", {
      prompt: "smile prompt",
      assetType: "expressions",
      variant: "smile",
      provider: "nano-banana-pro",
      attachToCharacterId: TEST_CHARACTER_ID,
      attachToColumn: "expressions",
      attachName: "smile",
      description: "warm closed-mouth smile, slight eye crinkle",
      realLifeRefs: ["https://example.com/me-smiling.jpg"],
    })
    await handler(job as never, makeCtx())
    expect(mocks.mockAttach).toHaveBeenCalledWith(
      expect.objectContaining({
        item: expect.objectContaining({
          description: "warm closed-mouth smile, slight eye crinkle",
          realLifeRefs: ["https://example.com/me-smiling.jpg"],
        }),
      }),
    )
  })
})

describe("generate-object handler", () => {
  const handler = entityHandlers["generate-object"]

  it("happy path", async () => {
    const job = makeJob("generate-object", { prompt: "a treasure chest" })
    await handler(job as never, makeCtx())
    expect(mocks.mockGenerateImage).toHaveBeenCalledWith(
      "a treasure chest", "nano-banana", undefined, undefined,
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1", PROVIDER_RESULT.cost)
  })
})

describe("generate-object-asset handler", () => {
  const handler = entityHandlers["generate-object-asset"]

  it("includes assetType in output", async () => {
    const job = makeJob("generate-object-asset", { prompt: "a key", assetType: "prop" })
    await handler(job as never, makeCtx())
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
      output_data: { imageUrl: "https://r2.example.com/images/job-1.png", assetType: "prop" },
    }))
  })
})

describe("generate-location handler", () => {
  const handler = entityHandlers["generate-location"]

  it("happy path", async () => {
    const job = makeJob("generate-location", { prompt: "a dark forest" })
    await handler(job as never, makeCtx())
    expect(mocks.mockGenerateImage).toHaveBeenCalledWith(
      "a dark forest", "nano-banana", undefined, undefined,
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1", PROVIDER_RESULT.cost)
  })
})

describe("generate-location-asset handler", () => {
  const handler = entityHandlers["generate-location-asset"]
  const TEST_LOCATION_ID = "00000000-0000-0000-0000-000000000aaa"

  it("includes assetType in output", async () => {
    const job = makeJob("generate-location-asset", { prompt: "a castle", assetType: "background" })
    await handler(job as never, makeCtx())
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
      output_data: { imageUrl: "https://r2.example.com/images/job-1.png", assetType: "background" },
    }))
  })

  it("auto-attaches to locations row via append_location_asset RPC when attach fields present", async () => {
    const job = makeJob("generate-location-asset", {
      prompt: "neon at night",
      assetType: "lighting",
      attachToLocationId: TEST_LOCATION_ID,
      attachToColumn: "lighting",
      attachName: "neon",
    })
    await handler(job as never, makeCtx())

    // Belt-and-braces ownership re-query MUST run first against `locations`,
    // scoped to (id, user_id, deleted_at IS NULL).
    expect(mocks.mockFrom).toHaveBeenCalledWith("locations")
    expect(mocks.mockLocationSelect).toHaveBeenCalledWith("id")
    expect(mocks.mockLocationEq1).toHaveBeenCalledWith("id", TEST_LOCATION_ID)
    expect(mocks.mockLocationEq2).toHaveBeenCalledWith("user_id", "user-1")
    expect(mocks.mockLocationIs).toHaveBeenCalledWith("deleted_at", null)

    // Then the RPC fires with the uploaded URL.
    expect(mocks.mockRpc).toHaveBeenCalledWith("append_location_asset", {
      p_location_id: TEST_LOCATION_ID,
      p_column: "lighting",
      p_value: { name: "neon", url: "https://r2.example.com/images/job-1.png" },
    })
  })

  it("does NOT fire RPC when attachToLocationId is missing (backward compat)", async () => {
    const job = makeJob("generate-location-asset", {
      prompt: "old payload shape",
      assetType: "lighting",
      // No attachToLocationId / attachToColumn / attachName at all — mirrors a
      // BullMQ payload enqueued before the route was extended (Pass 9 AA-1).
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockRpc).not.toHaveBeenCalled()
    // Locations table is not touched either — no ownership re-query.
    expect(mocks.mockFrom).not.toHaveBeenCalledWith("locations")
  })

  it("does NOT fire RPC when the ownership re-query returns no row", async () => {
    // Re-query yields nothing — either the row doesn't exist, belongs to a
    // different user, or is soft-deleted. All three collapse to "no row".
    mocks.mockLocationSingle.mockResolvedValueOnce({ data: null, error: null })

    const job = makeJob("generate-location-asset", {
      prompt: "forged or stale",
      assetType: "lighting",
      attachToLocationId: TEST_LOCATION_ID,
      attachToColumn: "lighting",
      attachName: "neon",
    })
    await handler(job as never, makeCtx({ jobUserId: "user-not-owner" }))

    expect(mocks.mockRpc).not.toHaveBeenCalled()
  })

  it("does NOT fire RPC or re-query when jobUserId is missing", async () => {
    // Without a user context the belt-and-braces ownership check can't run,
    // so the attach is skipped entirely (matches the character analog's
    // `attachToCharacterId && ctx.jobUserId` guard).
    const job = makeJob("generate-location-asset", {
      prompt: "no user",
      assetType: "lighting",
      attachToLocationId: TEST_LOCATION_ID,
      attachToColumn: "lighting",
      attachName: "neon",
    })
    await handler(job as never, makeCtx({ jobUserId: undefined }))

    expect(mocks.mockRpc).not.toHaveBeenCalled()
    expect(mocks.mockFrom).not.toHaveBeenCalledWith("locations")
  })

  it("logs but does not throw when the RPC returns an error (soft-delete / no-op)", async () => {
    // Mirrors the RPC's own behaviour: silent no-op when the row is
    // soft-deleted. Even if Supabase returns an error envelope, the handler
    // must complete normally (credits are already committed).
    mocks.mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "row was soft-deleted" },
    })

    const job = makeJob("generate-location-asset", {
      prompt: "deleted row",
      assetType: "lighting",
      attachToLocationId: TEST_LOCATION_ID,
      attachToColumn: "lighting",
      attachName: "neon",
    })
    await expect(handler(job as never, makeCtx())).resolves.toBeUndefined()

    // RPC was attempted (the ownership check passed) — the soft-delete
    // guard is internal to the SQL function.
    expect(mocks.mockRpc).toHaveBeenCalledTimes(1)
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledTimes(1)
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledTimes(1)
  })
})

describe("generate-script handler", () => {
  const handler = entityHandlers["generate-script"]

  it("happy path: generates script", async () => {
    const job = makeJob("generate-script", { prompt: "a story about adventure" })
    await handler(job as never, makeCtx())

    expect(mocks.mockGenerateScript).toHaveBeenCalledWith("a story about adventure", undefined, undefined, undefined, undefined, undefined)
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
      output_data: { script: { title: "My Script", scenes: [{ description: "Scene 1" }] } },
    }))
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })
})

describe("generate-character-motion handler", () => {
  const handler = entityHandlers["generate-character-motion"]

  it("calls imageToVideo with (sourceImageUrl, provider, prompt) and stores videoUrl", async () => {
    const job = makeJob("generate-character-motion", {
      prompt: "Alex, walking. realistic style.",
      sourceImageUrl: "https://x/p.png",
      provider: "kling",
    })
    await handler(job as never, makeCtx())

    // Trailing args (duration, endFrameUrl, options) are undefined when the
    // route didn't resolve an aspect ratio. The route now always sets one
    // for studio-path runs — see the "forwards aspectRatio" test below.
    expect(mocks.mockImageToVideo).toHaveBeenCalledWith(
      "https://x/p.png",
      "kling",
      "Alex, walking. realistic style.",
      undefined,
      undefined,
      undefined,
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
    expect(mocks.mockUploadVideoMaybeWatermark).toHaveBeenCalledWith(VIDEO_PROVIDER_RESULT.url, "job-1", "user-1", false)
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
      output_data: { videoUrl: "https://r2.example.com/videos/job-1.mp4" },
    }))
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1", VIDEO_PROVIDER_RESULT.cost)
  })

  it("defaults provider to kling when omitted", async () => {
    const job = makeJob("generate-character-motion", {
      prompt: "Sam, dancing.",
      sourceImageUrl: "https://x/q.png",
    })
    await handler(job as never, makeCtx())
    expect(mocks.mockImageToVideo).toHaveBeenCalledWith(
      "https://x/q.png",
      "kling",
      "Sam, dancing.",
      undefined,
      undefined,
      undefined,
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
  })

  it("passes watermark flag through", async () => {
    const job = makeJob("generate-character-motion", {
      prompt: "Riley, jumping.",
      sourceImageUrl: "https://x/r.png",
      provider: "minimax",
    })
    await handler(job as never, makeCtx({ shouldWatermark: true }))
    expect(mocks.mockImageToVideo).toHaveBeenCalledWith(
      "https://x/r.png",
      "minimax",
      "Riley, jumping.",
      undefined,
      undefined,
      undefined,
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
    expect(mocks.mockUploadVideoMaybeWatermark).toHaveBeenCalledWith(VIDEO_PROVIDER_RESULT.url, "job-1", "user-1", true)
  })

  it("forwards aspectRatio from job.data to imageToVideo options.aspectRatio", async () => {
    const job = makeJob("generate-character-motion", {
      prompt: "Jordan, jumping.",
      sourceImageUrl: "https://x/s.png",
      provider: "kling",
      aspectRatio: "9:16",
    })
    await handler(job as never, makeCtx())
    expect(mocks.mockImageToVideo).toHaveBeenCalledWith(
      "https://x/s.png",
      "kling",
      "Jordan, jumping.",
      undefined,
      undefined,
      { aspectRatio: "9:16" },
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
  })

  it("returns early when cancelled (no markJobCompleted, no credits)", async () => {
    mocks.mockShouldSaveJobResult.mockResolvedValueOnce(false)
    const job = makeJob("generate-character-motion", {
      prompt: "cancelled",
      sourceImageUrl: "https://x/c.png",
    })
    await handler(job as never, makeCtx())
    expect(mocks.mockMarkJobCompleted).not.toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).not.toHaveBeenCalled()
  })
})

describe("generate-location-motion handler", () => {
  const handler = entityHandlers["generate-location-motion"]
  const TEST_LOCATION_ID = "00000000-0000-0000-0000-000000000bbb"

  it("registers in entityHandlers map", () => {
    expect(handler).toBeDefined()
    expect(typeof handler).toBe("function")
  })

  it("calls imageToVideo with (sourceImageUrl, provider, prompt, undefined, undefined, options) and stores videoUrl", async () => {
    const job = makeJob("generate-location-motion", {
      prompt: "Neon-lit alley with rain reflections, cinematic.",
      sourceImageUrl: "https://x/loc.png",
      provider: "kling",
      aspectRatio: "16:9",
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockImageToVideo).toHaveBeenCalledWith(
      "https://x/loc.png",
      "kling",
      "Neon-lit alley with rain reflections, cinematic.",
      undefined,
      undefined,
      { aspectRatio: "16:9" },
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
    expect(mocks.mockUploadVideoMaybeWatermark).toHaveBeenCalledWith(
      VIDEO_PROVIDER_RESULT.url, "job-1", "user-1", false,
    )
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
      output_data: { videoUrl: "https://r2.example.com/videos/job-1.mp4" },
      provider: VIDEO_PROVIDER_RESULT.providerUsed,
      provider_cost: VIDEO_PROVIDER_RESULT.cost,
      display_cost: VIDEO_PROVIDER_RESULT.displayCost,
    }))
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith(
      "usage-1", "job-1", VIDEO_PROVIDER_RESULT.cost,
    )
  })

  it("defaults provider to kling when omitted, omits options when aspectRatio missing", async () => {
    const job = makeJob("generate-location-motion", {
      prompt: "Misty mountain pass at dawn",
      sourceImageUrl: "https://x/loc2.png",
    })
    await handler(job as never, makeCtx())
    expect(mocks.mockImageToVideo).toHaveBeenCalledWith(
      "https://x/loc2.png",
      "kling",
      "Misty mountain pass at dawn",
      undefined,
      undefined,
      undefined,
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
  })

  it("passes watermark flag through to upload", async () => {
    const job = makeJob("generate-location-motion", {
      prompt: "Stormy seas",
      sourceImageUrl: "https://x/loc3.png",
      provider: "minimax",
      aspectRatio: "16:9",
    })
    await handler(job as never, makeCtx({ shouldWatermark: true }))
    expect(mocks.mockUploadVideoMaybeWatermark).toHaveBeenCalledWith(
      VIDEO_PROVIDER_RESULT.url, "job-1", "user-1", true,
    )
  })

  it("auto-attaches to locations.atmosphere_motions via append_location_asset RPC after ownership re-verify", async () => {
    const job = makeJob("generate-location-motion", {
      prompt: "Flickering streetlight",
      sourceImageUrl: "https://x/loc4.png",
      provider: "kling",
      aspectRatio: "16:9",
      attachToLocationId: TEST_LOCATION_ID,
      attachToColumn: "atmosphere_motions",
      attachName: "streetlight-flicker",
    })
    await handler(job as never, makeCtx())

    // Belt-and-braces ownership re-query against locations row.
    expect(mocks.mockFrom).toHaveBeenCalledWith("locations")
    expect(mocks.mockLocationSelect).toHaveBeenCalledWith("id")
    expect(mocks.mockLocationEq1).toHaveBeenCalledWith("id", TEST_LOCATION_ID)
    expect(mocks.mockLocationEq2).toHaveBeenCalledWith("user_id", "user-1")
    expect(mocks.mockLocationIs).toHaveBeenCalledWith("deleted_at", null)

    // Then RPC fires with the uploaded video URL.
    expect(mocks.mockRpc).toHaveBeenCalledWith("append_location_asset", {
      p_location_id: TEST_LOCATION_ID,
      p_column: "atmosphere_motions",
      p_value: {
        name: "streetlight-flicker",
        url: "https://r2.example.com/videos/job-1.mp4",
      },
    })
  })

  it("backward compat: old-shape jobs without attachToLocationId complete without crash and skip RPC", async () => {
    const job = makeJob("generate-location-motion", {
      prompt: "old payload — no attach fields",
      sourceImageUrl: "https://x/loc5.png",
      provider: "kling",
      // No attachToLocationId / attachToColumn / attachName.
    })
    await expect(handler(job as never, makeCtx())).resolves.toBeUndefined()
    expect(mocks.mockRpc).not.toHaveBeenCalled()
    expect(mocks.mockFrom).not.toHaveBeenCalledWith("locations")
    // Video upload + job completion + credit commit still happen.
    expect(mocks.mockUploadVideoMaybeWatermark).toHaveBeenCalledTimes(1)
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledTimes(1)
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledTimes(1)
  })

  it("skips attach when ownership re-query returns no row (soft-deleted/forged) but still completes job + commits credits", async () => {
    // Belt-and-braces: location was soft-deleted between route accept and
    // worker pickup. Attach must be skipped, but video upload + completion
    // + credit commit must still proceed.
    mocks.mockLocationSingle.mockResolvedValueOnce({ data: null, error: null })

    const job = makeJob("generate-location-motion", {
      prompt: "stale location",
      sourceImageUrl: "https://x/loc6.png",
      provider: "kling",
      attachToLocationId: TEST_LOCATION_ID,
      attachToColumn: "atmosphere_motions",
      attachName: "stale",
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockRpc).not.toHaveBeenCalled()
    // But everything else completed.
    expect(mocks.mockUploadVideoMaybeWatermark).toHaveBeenCalledTimes(1)
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledTimes(1)
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledTimes(1)
  })

  it("skips attach when jobUserId is missing (no user context, can't verify ownership)", async () => {
    const job = makeJob("generate-location-motion", {
      prompt: "no user",
      sourceImageUrl: "https://x/loc7.png",
      provider: "kling",
      attachToLocationId: TEST_LOCATION_ID,
      attachToColumn: "atmosphere_motions",
      attachName: "no-user",
    })
    await handler(job as never, makeCtx({ jobUserId: undefined }))

    expect(mocks.mockRpc).not.toHaveBeenCalled()
    expect(mocks.mockFrom).not.toHaveBeenCalledWith("locations")
  })

  it("retry guard: shouldSaveJobResult=false (post-upload) short-circuits before markJobCompleted (mirrors character-motion precedent)", async () => {
    // Mirrors `handleGenerateCharacterMotion` which has a single
    // `shouldSaveJobResult` check before `markJobCompleted`. Provider call
    // and upload are unavoidable side effects when retrying a job; the
    // guard prevents double-completion + double-charge.
    mocks.mockShouldSaveJobResult.mockResolvedValueOnce(false)
    const job = makeJob("generate-location-motion", {
      prompt: "cancelled-mid-flight",
      sourceImageUrl: "https://x/locD.png",
      provider: "kling",
      attachToLocationId: TEST_LOCATION_ID,
      attachToColumn: "atmosphere_motions",
      attachName: "mid",
    })
    await handler(job as never, makeCtx())

    // Provider ran, upload ran — those are the side effects we can't undo.
    expect(mocks.mockImageToVideo).toHaveBeenCalledTimes(1)
    expect(mocks.mockUploadVideoMaybeWatermark).toHaveBeenCalledTimes(1)
    // But job completion + credit commit + attach are all suppressed.
    expect(mocks.mockMarkJobCompleted).not.toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).not.toHaveBeenCalled()
    expect(mocks.mockRpc).not.toHaveBeenCalled()
  })

  it("retry guard: markJobCompleted=false also suppresses credit commit + attach (CAS contention)", async () => {
    // Mirrors the `if (!ok) return` line in character-motion. If another
    // worker beat us to flipping status, we must not double-commit credits
    // or double-attach.
    mocks.mockMarkJobCompleted.mockResolvedValueOnce(false)
    const job = makeJob("generate-location-motion", {
      prompt: "CAS contention",
      sourceImageUrl: "https://x/locE.png",
      provider: "kling",
      attachToLocationId: TEST_LOCATION_ID,
      attachToColumn: "atmosphere_motions",
      attachName: "cas",
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockCommitJobCredits).not.toHaveBeenCalled()
    expect(mocks.mockRpc).not.toHaveBeenCalled()
  })
})

describe("shared entity handler behavior", () => {
  it("returns early when cancelled", async () => {
    mocks.mockShouldSaveJobResult.mockResolvedValueOnce(false)
    const handler = entityHandlers["generate-character"]
    const job = makeJob("generate-character", { prompt: "cancelled" })
    await handler(job as never, makeCtx())
    expect(mocks.mockMarkJobCompleted).not.toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).not.toHaveBeenCalled()
  })

  it("passes watermark flag", async () => {
    const handler = entityHandlers["generate-character"]
    const job = makeJob("generate-character", { prompt: "watermarked" })
    await handler(job as never, makeCtx({ shouldWatermark: true }))
    expect(mocks.mockUploadImageMaybeWatermark).toHaveBeenCalledWith(PROVIDER_RESULT.url, "job-1", "user-1", true)
  })
})
