import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() so the mock setters survive vi.clearAllMocks().
//
// The supabase mock is a per-table dispatcher that returns a fresh chain each
// time `supabase.from(...)` is called. Each table has its OWN mock chain so
// tests can override `jobs.select` (for status) or
// `workflow_executions.select` (for node_states) independently.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // -------------------------- jobs table chain --------------------------
  // SELECT path: .from("jobs").select(cols).eq("id", id).single()
  const jobsSingleMock = vi.fn().mockResolvedValue({
    data: {
      id: "j1",
      user_id: "u1",
      should_watermark: false,
      is_public: true,
      job_type: "generate-image",
      workflow_execution_id: null,
      status: "processing",
    },
    error: null,
  })
  const jobsSelectEqMock = vi.fn(() => ({ single: jobsSingleMock }))
  const jobsSelectMock = vi.fn(() => ({ eq: jobsSelectEqMock }))

  // -------------------------- usage_logs table chain --------------------------
  // SELECT path: .from("usage_logs").select("id").eq("job_id", id).eq("status", "reserved").limit(1)
  const usageLimitMock = vi.fn().mockResolvedValue({ data: [{ id: "u-log-1" }], error: null })
  const usageEqStatusMock = vi.fn(() => ({ limit: usageLimitMock }))
  const usageEqJobMock = vi.fn(() => ({ eq: usageEqStatusMock }))
  const usageSelectMock = vi.fn(() => ({ eq: usageEqJobMock }))

  // -------------------------- workflow_executions table chain --------------------------
  // SELECT path: .from("workflow_executions").select("status, failed_nodes").eq("id", wfId).single()
  const wfSingleMock = vi.fn().mockResolvedValue({ data: null, error: null })
  const wfSelectEqMock = vi.fn(() => ({ single: wfSingleMock }))
  const wfSelectMock = vi.fn(() => ({ eq: wfSelectEqMock }))
  // UPDATE path: .from("workflow_executions").update(...).eq("id", wfId).eq("status", "failed")
  const wfUpdateEq2Mock = vi
    .fn<(col: string, val: string) => Promise<{ data: unknown[]; error: null }>>()
    .mockResolvedValue({ data: [], error: null })
  const wfUpdateEqMock = vi.fn<(col: string, val: string) => { eq: typeof wfUpdateEq2Mock }>(
    () => ({ eq: wfUpdateEq2Mock }),
  )
  const wfUpdateMock = vi.fn<(arg: Record<string, unknown>) => { eq: typeof wfUpdateEqMock }>(
    () => ({ eq: wfUpdateEqMock }),
  )

  // -------------------------- per-table dispatcher --------------------------
  const fromMock = vi.fn((table: string) => {
    if (table === "jobs") {
      return { select: jobsSelectMock }
    }
    if (table === "usage_logs") {
      return { select: usageSelectMock }
    }
    if (table === "workflow_executions") {
      return { select: wfSelectMock, update: wfUpdateMock }
    }
    return {}
  })

  return {
    jobsSingleMock,
    jobsSelectMock,
    usageLimitMock,
    usageSelectMock,
    wfSingleMock,
    wfSelectMock,
    wfUpdateMock,
    wfUpdateEqMock,
    wfUpdateEq2Mock,
    fromMock,
  }
})

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.fromMock } }))

// Mock workers/shared.js: every helper finalizeJobWithMedia calls is a
// vi.fn() so we can assert calls / count / arguments per test.
const sharedMocks = vi.hoisted(() => ({
  uploadImageVariantsMaybeWatermark: vi
    .fn<(urls: readonly string[], jobId: string) => Promise<readonly string[]>>()
    .mockResolvedValue(["https://r2.example/img-j1.png"]),
  uploadVideoMaybeWatermark: vi.fn().mockResolvedValue("https://r2.example/vid-j1.mp4"),
  buildImageOutputData: vi.fn((result: unknown, urls: readonly string[]) => ({
    imageUrl: urls[0],
    ...(urls.length > 1 ? { imageUrls: urls } : {}),
  })),
  markJobCompleted: vi
    .fn<(jobId: string, fields: Record<string, unknown>) => Promise<boolean>>()
    .mockResolvedValue(true),
  commitJobCredits: vi.fn().mockResolvedValue(undefined),
  createAssetFromJob: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/workers/shared.js", () => sharedMocks)

// Mock lib/storage.js: uploadToR2 returns a deterministic R2 URL so the audio
// branch's assertion can check both the call args AND the recorded output URL.
const storageMocks = vi.hoisted(() => ({
  uploadToR2: vi
    .fn<
      (sourceUrl: string, jobId: string, type: string, userId?: string) => Promise<string>
    >()
    .mockResolvedValue("https://r2.example/audio-j-aud.mp3"),
}))

vi.mock("@/lib/storage.js", () => storageMocks)

import { finalizeJobWithMedia } from "@/lib/job-finalize.js"

// ---------------------------------------------------------------------------
// Default factory — resets every mock back to a successful happy-path state
// so each test starts from a clean slate after vi.clearAllMocks().
// ---------------------------------------------------------------------------
function resetMocksToHappyPath() {
  mocks.jobsSingleMock.mockResolvedValue({
    data: {
      id: "j1",
      user_id: "u1",
      should_watermark: false,
      is_public: true,
      job_type: "generate-image",
      workflow_execution_id: null,
      status: "processing",
    },
    error: null,
  })
  mocks.usageLimitMock.mockResolvedValue({ data: [{ id: "u-log-1" }], error: null })
  mocks.wfSingleMock.mockResolvedValue({ data: null, error: null })
  mocks.wfUpdateEq2Mock.mockResolvedValue({ data: [], error: null })

  sharedMocks.uploadImageVariantsMaybeWatermark.mockResolvedValue([
    "https://r2.example/img-j1.png",
  ])
  sharedMocks.uploadVideoMaybeWatermark.mockResolvedValue("https://r2.example/vid-j1.mp4")
  sharedMocks.buildImageOutputData.mockImplementation((_result, urls) => ({
    imageUrl: urls[0],
    ...(urls.length > 1 ? { imageUrls: urls } : {}),
  }))
  sharedMocks.markJobCompleted.mockResolvedValue(true)
  sharedMocks.commitJobCredits.mockResolvedValue(undefined)
  sharedMocks.createAssetFromJob.mockResolvedValue(undefined)

  storageMocks.uploadToR2.mockResolvedValue("https://r2.example/audio-j-aud.mp3")
}

// ===========================================================================
describe("finalizeJobWithMedia", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMocksToHappyPath()
  })

  // -------------------------------------------------------------------------
  // 1. Happy path image
  // -------------------------------------------------------------------------
  it("happy path (image): upload → markCompleted → commitCredits → createAsset, returns { ok: true }", async () => {
    const result = await finalizeJobWithMedia({
      jobId: "j1",
      jobType: "generate-image",
      result: { url: "https://kie.example/x.png", cost: 0.02, providerUsed: "nano-banana" },
    })

    expect(result.ok).toBe(true)
    expect(sharedMocks.uploadImageVariantsMaybeWatermark).toHaveBeenCalledTimes(1)
    expect(sharedMocks.uploadImageVariantsMaybeWatermark).toHaveBeenCalledWith(
      ["https://kie.example/x.png"],
      "j1",
      "u1",
      false,
    )
    expect(sharedMocks.markJobCompleted).toHaveBeenCalledTimes(1)
    // 4th arg = extraNonProviderCredits (undefined here); 5th = meteredCost
    // (undefined → commit-reserved per pricing convention A).
    expect(sharedMocks.commitJobCredits).toHaveBeenCalledWith("u-log-1", "j1", 0.02, undefined, undefined)
    expect(sharedMocks.createAssetFromJob).toHaveBeenCalledWith("j1", "u1")
  })

  // -------------------------------------------------------------------------
  // 1b. Regression: result.kieTaskId writes to `provider_task_id` (the actual
  // schema column from migration 135), NOT the legacy `kie_task_id` name.
  // -------------------------------------------------------------------------
  it("kieTaskId persists as provider_task_id (not kie_task_id) in markJobCompleted payload", async () => {
    await finalizeJobWithMedia({
      jobId: "j1",
      jobType: "generate-image",
      result: {
        url: "https://kie.example/x.png",
        cost: 0.02,
        providerUsed: "nano-banana",
        kieTaskId: "kie-task-abc123",
      },
    })

    expect(sharedMocks.markJobCompleted).toHaveBeenCalledTimes(1)
    const payload = sharedMocks.markJobCompleted.mock.calls[0]![1]
    expect(payload).toMatchObject({ provider_task_id: "kie-task-abc123" })
    expect(payload).not.toHaveProperty("kie_task_id")
  })

  it("omits provider_task_id from payload when result.kieTaskId is absent", async () => {
    await finalizeJobWithMedia({
      jobId: "j1",
      jobType: "generate-image",
      result: { url: "https://kie.example/x.png", cost: 0.02, providerUsed: "nano-banana" },
    })

    const payload = sharedMocks.markJobCompleted.mock.calls[0]![1]
    expect(payload).not.toHaveProperty("provider_task_id")
    expect(payload).not.toHaveProperty("kie_task_id")
  })

  // -------------------------------------------------------------------------
  // 2. CAS race: markJobCompleted returns false → no commit, no asset
  // -------------------------------------------------------------------------
  it("CAS race: markJobCompleted returns false → returns { ok: false } and does NOT commit credits or create asset", async () => {
    sharedMocks.markJobCompleted.mockResolvedValueOnce(false)

    const result = await finalizeJobWithMedia({
      jobId: "j-cancelled",
      jobType: "generate-image",
      result: { url: "https://x.png", cost: 0.01, providerUsed: "p" },
    })

    expect(result.ok).toBe(false)
    expect(sharedMocks.markJobCompleted).toHaveBeenCalledTimes(1)
    expect(sharedMocks.commitJobCredits).not.toHaveBeenCalled()
    expect(sharedMocks.createAssetFromJob).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 3. Already terminal: status is 'completed' → early return, no upload
  // -------------------------------------------------------------------------
  it("already terminal: jobs.status='completed' → returns { ok: false } before uploading", async () => {
    mocks.jobsSingleMock.mockResolvedValueOnce({
      data: {
        id: "j-done",
        user_id: "u1",
        should_watermark: false,
        is_public: true,
        job_type: "generate-image",
        workflow_execution_id: null,
        status: "completed",
      },
      error: null,
    })

    const result = await finalizeJobWithMedia({
      jobId: "j-done",
      jobType: "generate-image",
      result: { url: "https://x.png", cost: 0.02, providerUsed: "p" },
    })

    expect(result.ok).toBe(false)
    expect(sharedMocks.uploadImageVariantsMaybeWatermark).not.toHaveBeenCalled()
    expect(sharedMocks.markJobCompleted).not.toHaveBeenCalled()
    expect(sharedMocks.commitJobCredits).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 4. Missing usage_log: commitJobCredits still called with null
  // -------------------------------------------------------------------------
  it("missing usage_log: usage_logs query returns empty → commitJobCredits is called with null (gracefully no-ops)", async () => {
    mocks.usageLimitMock.mockResolvedValueOnce({ data: [], error: null })

    const result = await finalizeJobWithMedia({
      jobId: "j1",
      jobType: "generate-image",
      result: { url: "https://x.png", cost: 0.02, providerUsed: "p" },
    })

    expect(result.ok).toBe(true)
    expect(sharedMocks.commitJobCredits).toHaveBeenCalledWith(null, "j1", 0.02, undefined, undefined)
  })

  // -------------------------------------------------------------------------
  // 5. Image vs video dispatch
  // -------------------------------------------------------------------------
  it("image dispatch: jobType='generate-image' → uploadImageVariantsMaybeWatermark called, NOT uploadVideoMaybeWatermark", async () => {
    await finalizeJobWithMedia({
      jobId: "j-img",
      jobType: "generate-image",
      result: { url: "https://i.png", cost: 0.02, providerUsed: "p" },
    })

    expect(sharedMocks.uploadImageVariantsMaybeWatermark).toHaveBeenCalledTimes(1)
    expect(sharedMocks.uploadVideoMaybeWatermark).not.toHaveBeenCalled()
  })

  it("video dispatch: jobType='image-to-video' → uploadVideoMaybeWatermark called, NOT uploadImageVariantsMaybeWatermark", async () => {
    // Override jobs row to have job_type='image-to-video' for clarity
    mocks.jobsSingleMock.mockResolvedValueOnce({
      data: {
        id: "j-vid",
        user_id: "u1",
        should_watermark: false,
        is_public: true,
        job_type: "image-to-video",
        workflow_execution_id: null,
        status: "processing",
      },
      error: null,
    })

    await finalizeJobWithMedia({
      jobId: "j-vid",
      jobType: "image-to-video",
      result: { url: "https://v.mp4", cost: 0.4, providerUsed: "p" },
    })

    expect(sharedMocks.uploadVideoMaybeWatermark).toHaveBeenCalledTimes(1)
    expect(sharedMocks.uploadVideoMaybeWatermark).toHaveBeenCalledWith(
      "https://v.mp4",
      "j-vid",
      "u1",
      false,
    )
    expect(sharedMocks.uploadImageVariantsMaybeWatermark).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 6. Audio uploads to R2 — never watermarked, image/video helpers untouched
  // -------------------------------------------------------------------------
  it("audio: jobType='text-to-speech' → uploadToR2 called with (provider url, jobId, 'audio', userId); outputData carries R2 URL", async () => {
    mocks.jobsSingleMock.mockResolvedValueOnce({
      data: {
        id: "j-aud",
        user_id: "u1",
        should_watermark: false,
        is_public: true,
        job_type: "text-to-speech",
        workflow_execution_id: null,
        status: "processing",
      },
      error: null,
    })
    storageMocks.uploadToR2.mockResolvedValueOnce("https://r2.example/audio-j-aud.mp3")

    await finalizeJobWithMedia({
      jobId: "j-aud",
      jobType: "text-to-speech",
      result: { url: "https://kie.example/audio.mp3", cost: 0.005, providerUsed: "elevenlabs" },
    })

    expect(sharedMocks.uploadImageVariantsMaybeWatermark).not.toHaveBeenCalled()
    expect(sharedMocks.uploadVideoMaybeWatermark).not.toHaveBeenCalled()
    // Audio uploads to R2 with the same signature audio-ai.ts handlers use.
    expect(storageMocks.uploadToR2).toHaveBeenCalledTimes(1)
    expect(storageMocks.uploadToR2).toHaveBeenCalledWith(
      "https://kie.example/audio.mp3",
      "j-aud",
      "audio",
      "u1",
    )
    // The output_data passed to markJobCompleted carries the R2 URL, NOT the
    // provider's transient URL.
    expect(sharedMocks.markJobCompleted).toHaveBeenCalledTimes(1)
    const markArg = sharedMocks.markJobCompleted.mock.calls[0]![1] as Record<string, unknown>
    expect(markArg.output_data).toEqual({ audioUrl: "https://r2.example/audio-j-aud.mp3" })
  })

  // -------------------------------------------------------------------------
  // 7. workflow_executions sole-cause reopen
  // -------------------------------------------------------------------------
  it("sole-cause reopen: workflow_execution_id set, node_states[n1]={status:'failed',jobId:'j-wf'} → workflow_executions.update('completed') with CAS .eq('status','failed')", async () => {
    mocks.jobsSingleMock.mockResolvedValueOnce({
      data: {
        id: "j-wf",
        user_id: "u1",
        should_watermark: false,
        is_public: true,
        job_type: "generate-image",
        workflow_execution_id: "wf1",
        status: "processing",
      },
      error: null,
    })
    mocks.wfSingleMock.mockResolvedValueOnce({
      data: {
        status: "failed",
        node_states: { n1: { status: "failed", jobId: "j-wf" } },
        completed_nodes: 0,
      },
      error: null,
    })

    const result = await finalizeJobWithMedia({
      jobId: "j-wf",
      jobType: "generate-image",
      result: { url: "https://x.png", cost: 0.02, providerUsed: "p" },
    })

    expect(result.ok).toBe(true)
    expect(mocks.wfUpdateMock).toHaveBeenCalledTimes(1)
    const updateArg = mocks.wfUpdateMock.mock.calls[0]![0] as Record<string, unknown>
    expect(updateArg.status).toBe("completed")
    expect(updateArg.failed_nodes).toBe(0)
    expect(updateArg.completed_nodes).toBe(1)
    expect(updateArg.error_message).toBeNull()
    // node_states[n1].status flipped failed → completed
    const updatedNodeStates = updateArg.node_states as Record<
      string,
      { status?: string; jobId?: string }
    >
    expect(updatedNodeStates.n1?.status).toBe("completed")
    expect(updatedNodeStates.n1?.jobId).toBe("j-wf")
    // CAS guard: .eq("id", "wf1").eq("status", "failed")
    expect(mocks.wfUpdateEqMock).toHaveBeenCalledWith("id", "wf1")
    expect(mocks.wfUpdateEq2Mock).toHaveBeenCalledWith("status", "failed")
  })

  // -------------------------------------------------------------------------
  // 8. multi-cause: another node also failed → no update
  // -------------------------------------------------------------------------
  it("multi-cause: node_states has n1 (ours) AND n2 also failed → workflow_executions.update NOT called", async () => {
    mocks.jobsSingleMock.mockResolvedValueOnce({
      data: {
        id: "j-wf-multi",
        user_id: "u1",
        should_watermark: false,
        is_public: true,
        job_type: "generate-image",
        workflow_execution_id: "wf1",
        status: "processing",
      },
      error: null,
    })
    mocks.wfSingleMock.mockResolvedValueOnce({
      data: {
        status: "failed",
        node_states: {
          n1: { status: "failed", jobId: "j-wf-multi" },
          n2: { status: "failed", jobId: "other" },
        },
        completed_nodes: 0,
      },
      error: null,
    })

    await finalizeJobWithMedia({
      jobId: "j-wf-multi",
      jobType: "generate-image",
      result: { url: "https://x.png", cost: 0.02, providerUsed: "p" },
    })

    expect(mocks.wfUpdateMock).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 9. user-cancel preserved: status='cancelled' → no update path taken
  // -------------------------------------------------------------------------
  it("user-cancel preserved: workflow_executions.status='cancelled' (not 'failed') → reopen branch is NOT entered", async () => {
    mocks.jobsSingleMock.mockResolvedValueOnce({
      data: {
        id: "j-wf-cancel",
        user_id: "u1",
        should_watermark: false,
        is_public: true,
        job_type: "generate-image",
        workflow_execution_id: "wf1",
        status: "processing",
      },
      error: null,
    })
    mocks.wfSingleMock.mockResolvedValueOnce({
      data: {
        status: "cancelled",
        node_states: { n1: { status: "failed", jobId: "j-wf-cancel" } },
        completed_nodes: 0,
      },
      error: null,
    })

    await finalizeJobWithMedia({
      jobId: "j-wf-cancel",
      jobType: "generate-image",
      result: { url: "https://x.png", cost: 0.02, providerUsed: "p" },
    })

    expect(mocks.wfUpdateMock).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 10. Defensive: job not present in node_states → no reopen
  // -------------------------------------------------------------------------
  it("job not found in node_states: empty node_states → workflow_executions.update NOT called", async () => {
    mocks.jobsSingleMock.mockResolvedValueOnce({
      data: {
        id: "j-orphan",
        user_id: "u1",
        should_watermark: false,
        is_public: true,
        job_type: "generate-image",
        workflow_execution_id: "wf1",
        status: "processing",
      },
      error: null,
    })
    mocks.wfSingleMock.mockResolvedValueOnce({
      data: { status: "failed", node_states: {}, completed_nodes: 0 },
      error: null,
    })

    await finalizeJobWithMedia({
      jobId: "j-orphan",
      jobType: "generate-image",
      result: { url: "https://x.png", cost: 0.02, providerUsed: "p" },
    })

    expect(mocks.wfUpdateMock).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Pre-uploaded mediaUrl path (video handlers upload before finalize because
  // audio-merge produces a local file)
  // -------------------------------------------------------------------------

  it("video + mediaUrl: skips uploadVideoMaybeWatermark, uses the passed R2 URL", async () => {
    mocks.jobsSingleMock.mockResolvedValueOnce({
      data: {
        id: "j-pre",
        user_id: "u1",
        should_watermark: false,
        is_public: true,
        job_type: "image-to-video",
        workflow_execution_id: null,
        status: "processing",
      },
      error: null,
    })

    await finalizeJobWithMedia({
      jobId: "j-pre",
      jobType: "image-to-video",
      result: { url: "https://kie.example/raw.mp4", cost: 0.4, providerUsed: "p" },
      mediaUrl: "https://r2.example/already-uploaded.mp4",
    })

    expect(sharedMocks.uploadVideoMaybeWatermark).not.toHaveBeenCalled()

    const updateArg = sharedMocks.markJobCompleted.mock.calls[0]![1] as { output_data: { videoUrl: string } }
    expect(updateArg.output_data.videoUrl).toBe("https://r2.example/already-uploaded.mp4")
  })

  it("extraOutputData: merges thumbnail + provider meta alongside the upload result", async () => {
    mocks.jobsSingleMock.mockResolvedValueOnce({
      data: {
        id: "j-thumb",
        user_id: "u1",
        should_watermark: false,
        is_public: true,
        job_type: "image-to-video",
        workflow_execution_id: null,
        status: "processing",
      },
      error: null,
    })

    await finalizeJobWithMedia({
      jobId: "j-thumb",
      jobType: "image-to-video",
      result: { url: "https://kie.example/raw.mp4", cost: 0.4, providerUsed: "p" },
      mediaUrl: "https://r2.example/v.mp4",
      extraOutputData: {
        thumbnailUrl: "https://r2.example/thumb.png",
        seed: 12345,
      },
    })

    const updateArg = sharedMocks.markJobCompleted.mock.calls[0]![1] as { output_data: Record<string, unknown> }
    expect(updateArg.output_data.videoUrl).toBe("https://r2.example/v.mp4")
    expect(updateArg.output_data.thumbnailUrl).toBe("https://r2.example/thumb.png")
    expect(updateArg.output_data.seed).toBe(12345)
  })

  it("image + mediaUrl + extraMediaUrls: skips upload, uses passed URLs as the variant array", async () => {
    mocks.jobsSingleMock.mockResolvedValueOnce({
      data: {
        id: "j-img-pre",
        user_id: "u1",
        should_watermark: false,
        is_public: true,
        job_type: "generate-image",
        workflow_execution_id: null,
        status: "processing",
      },
      error: null,
    })

    await finalizeJobWithMedia({
      jobId: "j-img-pre",
      jobType: "generate-image",
      result: { url: "https://kie.example/raw.png", cost: 0.02, providerUsed: "p" },
      mediaUrl: "https://r2.example/v0.png",
      extraMediaUrls: ["https://r2.example/v1.png"],
    })

    expect(sharedMocks.uploadImageVariantsMaybeWatermark).not.toHaveBeenCalled()
    expect(sharedMocks.buildImageOutputData).toHaveBeenCalledWith(
      expect.anything(),
      ["https://r2.example/v0.png", "https://r2.example/v1.png"],
    )
  })

  it("audio + mediaUrl: skips uploadToR2, uses the passed R2 URL", async () => {
    mocks.jobsSingleMock.mockResolvedValueOnce({
      data: {
        id: "j-aud-pre",
        user_id: "u1",
        should_watermark: false,
        is_public: true,
        job_type: "text-to-speech",
        workflow_execution_id: null,
        status: "processing",
      },
      error: null,
    })

    await finalizeJobWithMedia({
      jobId: "j-aud-pre",
      jobType: "text-to-speech",
      result: { url: "https://kie.example/raw.mp3", cost: 0.01, providerUsed: "p" },
      mediaUrl: "https://r2.example/pre-uploaded.mp3",
    })

    expect(storageMocks.uploadToR2).not.toHaveBeenCalled()

    const updateArg = sharedMocks.markJobCompleted.mock.calls[0]![1] as { output_data: { audioUrl: string } }
    expect(updateArg.output_data.audioUrl).toBe("https://r2.example/pre-uploaded.mp3")
  })
})
