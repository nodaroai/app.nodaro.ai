/**
 * The exclusive-node relay (4b): what it must guarantee on a self-host —
 *   - the enqueued payload replays on the cloud at the type's own wire path,
 *     with instance-only bookkeeping stripped and media URLs re-hosted;
 *   - the CLOUD job id is persisted BEFORE polling (stall-retry resumes via
 *     reconcile instead of paying for a second generation) and a persist
 *     failure aborts the run rather than running unrecoverable;
 *   - a stop stamped before the cloud job existed is forwarded right after
 *     creation; a continue replays against the cloud's own /continue;
 *   - per-type output adaptation: JSON producers land verbatim, gvp/evp
 *     videos come home via finalizeJobWithMedia (with gvp's `pro` checkpoint
 *     carried — stop/continue read it), vcp lands audio or video.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const jobsUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const jobsUpdate = vi.fn(() => ({ eq: jobsUpdateEq }))
  const maybeSingle = vi.fn().mockResolvedValue({ data: { stop_requested_at: null } })
  const selectEq = vi.fn(() => ({ maybeSingle }))
  const jobsSelect = vi.fn(() => ({ eq: selectEq }))
  return {
    markJobCompleted: vi.fn().mockResolvedValue(true),
    generateAndUploadThumbnail: vi.fn().mockResolvedValue("https://local.r2/thumbnails/job-1.png"),
    setJobProgress: vi.fn(async () => {}),
    uploadVideoMaybeWatermark: vi.fn().mockResolvedValue("https://local.r2/videos/job-1.mp4"),
    uploadToR2: vi.fn().mockResolvedValue("https://local.r2/audio/job-1.mp3"),
    finalizeJobWithMedia: vi.fn().mockResolvedValue({ ok: true }),
    claimJobFinalize: vi.fn(async (): Promise<{ won: boolean; ts: string | null }> => ({ won: true, ts: "claim-ts-1" })),
    releaseJobFinalizeClaim: vi.fn(async () => {}),
    createCloudJob: vi.fn().mockResolvedValue("cloud-job-1"),
    waitForCloudJob: vi.fn(),
    nodaroCloudFetch: vi.fn().mockResolvedValue({ ok: true }),
    rehostIfUrlField: vi.fn(async (_key: string, value: unknown) => value),
    rehostByteSize: vi.fn(async (_url: string): Promise<number | undefined> => undefined),
    bringRenderHome: vi.fn(async (): Promise<{ videoUrl: string; thumbnailUrl: string | null }> => ({ videoUrl: "https://local.r2/videos/job-1.mp4", thumbnailUrl: "https://local.r2/thumbnails/job-1.png" })),
    jobsUpdate,
    jobsUpdateEq,
    jobsSelect,
    maybeSingle,
    from: vi.fn(() => ({ update: jobsUpdate, select: jobsSelect })),
  }
})

vi.mock("../../shared.js", () => ({
  markJobCompleted: mocks.markJobCompleted,
  generateAndUploadThumbnail: mocks.generateAndUploadThumbnail,
  setJobProgress: mocks.setJobProgress,
  uploadVideoMaybeWatermark: mocks.uploadVideoMaybeWatermark,
}))
vi.mock("../../../lib/storage.js", () => ({ uploadToR2: mocks.uploadToR2 }))
vi.mock("../../../lib/post-processing-error.js", () => ({
  // Passthrough: post-provider semantics are the callee's own tested concern.
  runPostProcessing: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}))
vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: mocks.from } }))
vi.mock("../../../lib/job-finalize.js", () => ({
  finalizeJobWithMedia: mocks.finalizeJobWithMedia,
  claimJobFinalize: mocks.claimJobFinalize,
  releaseJobFinalizeClaim: mocks.releaseJobFinalizeClaim,
}))
vi.mock("../../../providers/nodaro/client.js", () => ({
  createCloudJob: mocks.createCloudJob,
  waitForCloudJob: mocks.waitForCloudJob,
  rehostByteSize: mocks.rehostByteSize,
  NodaroCloudError: class NodaroCloudError extends Error {
    constructor(message: string, readonly statusCode?: number, readonly code?: string) {
      super(message)
    }
  },
}))
vi.mock("../relay-render-home.js", () => ({ bringRenderHome: mocks.bringRenderHome }))
vi.mock("../../../lib/nodaro-connect.js", () => ({ nodaroCloudFetch: mocks.nodaroCloudFetch }))
vi.mock("../../../providers/nodaro/run-on-cloud.js", async (importOriginal) => ({
  // The REAL module, with only the network-touching rehost mocked. The strip
  // set must be the real one: a hand-copied Set here once carried names the
  // real set lacked, so the strip test passed while production forwarded a
  // LOCAL workflowId to the cloud's jobs.workflow_id FK — every relayed run
  // 500'd at create (live, 2026-08-18).
  ...(await importOriginal<typeof import("../../../providers/nodaro/run-on-cloud.js")>()),
  rehostIfUrlField: mocks.rehostIfUrlField,
}))

import {
  nodaroExclusiveRelayHandlers,
  isNodaroExclusiveJobType,
  finalizeExclusiveCloudOutput,
} from "../nodaro-exclusive-relay.js"
import { editPlanModeRefusalMessage, editPlanModesOf, withEditPlanModeGate } from "../../../lib/private-plugins/edit-plan-mode-gate.js"
import {
  plannableEditPlanModes,
  _resetPlannableEditPlanModesForTests,
  type PlannableEditPlanModesDeps,
} from "../../../lib/private-plugins/plannable-edit-plan-modes.js"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"

const EXCLUSIVES = [
  "voice-changer-pro",
  "generate-video-pro",
  "edit-video-pro",
  "video-analysis",
  "video-audit",
  "edit-plan",
  "camera-switch",
  // C2.1 (cloud-plugins #732): POST /v1/speaker-view.
  "speaker-view",
] as const

const bullJob = (data: Record<string, unknown>) =>
  ({ id: "bull-1", data, updateProgress: vi.fn() }) as never
const ctx = { jobId: "job-1", jobUserId: "user-1", usageLogId: null, shouldWatermark: true }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createCloudJob.mockResolvedValue("cloud-job-1")
  mocks.waitForCloudJob.mockResolvedValue({
    id: "cloud-job-1",
    status: "completed",
    output_data: { videoUrl: "https://cloud.r2/videos/cloud-job-1.mp4" },
  })
  mocks.uploadVideoMaybeWatermark.mockResolvedValue("https://local.r2/videos/job-1.mp4")
  mocks.generateAndUploadThumbnail.mockResolvedValue("https://local.r2/thumbnails/job-1.png")
  mocks.uploadToR2.mockResolvedValue("https://local.r2/audio/job-1.mp3")
  mocks.finalizeJobWithMedia.mockResolvedValue({ ok: true })
  mocks.claimJobFinalize.mockResolvedValue({ won: true, ts: "claim-ts-1" })
  mocks.markJobCompleted.mockResolvedValue(true)
  mocks.jobsUpdateEq.mockResolvedValue({ error: null })
  mocks.maybeSingle.mockResolvedValue({ data: { stop_requested_at: null } })
  mocks.rehostIfUrlField.mockImplementation(async (_key: string, value: unknown) => value)
  mocks.rehostByteSize.mockResolvedValue(undefined)
  mocks.bringRenderHome.mockResolvedValue({ videoUrl: "https://local.r2/videos/job-1.mp4", thumbnailUrl: "https://local.r2/thumbnails/job-1.png" })
  mocks.nodaroCloudFetch.mockResolvedValue({ ok: true })
})

describe("handler registry", () => {
  it("serves exactly the exclusive types", () => {
    expect(Object.keys(nodaroExclusiveRelayHandlers).sort()).toEqual([...EXCLUSIVES].sort())
    for (const t of EXCLUSIVES) expect(isNodaroExclusiveJobType(t)).toBe(true)
    expect(isNodaroExclusiveJobType("generate-image")).toBe(false)
    expect(isNodaroExclusiveJobType("generative-pipeline")).toBe(false)
  })
})

// Round 4 (decided 2026-10-06): the video worker merges the relay handlers
// through the edit-plan mode gate (pinned by video-worker-edit-plan-gate-wiring).
// An unknown or unplannable mode is refused BEFORE anything reaches nodaro.ai,
// so the connected account is never charged for it. Here: nodaro.ai does not
// plan trailer yet (the three original modes).
describe("edit-plan relay: the mode gate a self-host runs it through", () => {
  const relayed = withEditPlanModeGate(nodaroExclusiveRelayHandlers, async () => ({
    modes: editPlanModesOf({}),
    source: "nodaro.ai" as const,
  }))
  const plan = (mode: unknown) =>
    bullJob({ jobId: "job-ep", mode, transcript: { version: 1, words: [] }, sources: [{ url: "https://a/ep.mp4" }] })

  it("refuses trailer (undeclared) and an unknown mode without creating a cloud job", async () => {
    for (const [mode, shown] of [["trailer", "trailer"], ["montage", "montage"], [3, "3"]] as const) {
      const err = await relayed["edit-plan"]!(plan(mode), ctx).then(() => null, (e: unknown) => e)
      expect(isDeterministicJobError(err), String(mode)).toBe(true)
      expect((err as Error).message).toBe(editPlanModeRefusalMessage(shown))
    }
    expect(mocks.createCloudJob).not.toHaveBeenCalled()
  })

  it("relays a Phase-1 mode verbatim, and an absent mode for nodaro.ai's default", async () => {
    mocks.waitForCloudJob.mockResolvedValue({ id: "cloud-ep", status: "completed", output_data: { version: 1, segments: [] } })
    await relayed["edit-plan"]!(plan("clips"), ctx)
    expect(mocks.createCloudJob).toHaveBeenLastCalledWith("/v1/edit-plan", expect.objectContaining({ mode: "clips" }))
    await relayed["edit-plan"]!(plan(undefined), ctx)
    expect(mocks.createCloudJob).toHaveBeenCalledTimes(2)
    expect(mocks.createCloudJob.mock.calls[1]![1]).not.toHaveProperty("mode")
  })

  it("leaves every other exclusive type's handler as it was", () => {
    for (const t of EXCLUSIVES.filter((t) => t !== "edit-plan")) {
      expect(relayed[t]).toBe(nodaroExclusiveRelayHandlers[t])
    }
  })
})

// Round 6 (decided 2026-10-06): a CONNECTED self-host plans what nodaro.ai
// plans — the relay's gate reads `plannableEditPlanModes()`, which asks
// nodaro.ai's GET /v1/edit-plan/capabilities over the relay's connection.
describe("edit-plan relay: modes come from nodaro.ai on a connected self-host", () => {
  const PHASE1 = ["tighten", "clips", "chapters"]
  const selfHost = (over: Partial<PlannableEditPlanModesDeps>): PlannableEditPlanModesDeps => ({
    hasCredits: () => false,
    getPluginSupports: () => ({}),
    isNodaroConnected: async () => true,
    cloudFetch: async () => new Response(JSON.stringify({ modes: [...PHASE1, "trailer"] }), { status: 200 }),
    now: () => 0,
    ...over,
  })
  const gate = (deps: PlannableEditPlanModesDeps) =>
    withEditPlanModeGate(nodaroExclusiveRelayHandlers, () => plannableEditPlanModes(deps))
  const plan = (mode: unknown) =>
    bullJob({ jobId: "job-ep6", mode, transcript: { version: 1, words: [] }, sources: [{ url: "https://a/ep.mp4" }] })

  beforeEach(() => _resetPlannableEditPlanModesForTests())

  it("relays trailer to nodaro.ai once nodaro.ai plans it", async () => {
    mocks.waitForCloudJob.mockResolvedValue({ id: "cloud-ep6", status: "completed", output_data: { version: 1, segments: [] } })
    await gate(selfHost({}))["edit-plan"]!(plan("trailer"), ctx)
    expect(mocks.createCloudJob).toHaveBeenLastCalledWith("/v1/edit-plan", expect.objectContaining({ mode: "trailer" }))
  })

  // Round 7 (decided 2026-10-06): an outage is TEMPORARY — the job takes the
  // retryable path (the queue retries it under its own policy), not a
  // permanent refusal. Nothing reaches nodaro.ai on this attempt.
  it("fails trailer RETRYABLY, before relaying, when nodaro.ai can't be reached", async () => {
    const relayed = gate(selfHost({ cloudFetch: async () => { throw new Error("ECONNREFUSED") } }))
    const err = await relayed["edit-plan"]!(plan("trailer"), ctx).then(() => null, (e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(false)
    expect((err as Error).message).toBe("could not reach nodaro.ai")
    expect(mocks.createCloudJob).not.toHaveBeenCalled()
  })

  it("refuses trailer permanently when nodaro.ai answers that it does not plan it", async () => {
    const relayed = gate(selfHost({
      cloudFetch: async () => new Response(JSON.stringify({ modes: PHASE1 }), { status: 200 }),
    }))
    const err = await relayed["edit-plan"]!(plan("trailer"), ctx).then(() => null, (e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe(editPlanModeRefusalMessage("trailer"))
    expect(mocks.createCloudJob).not.toHaveBeenCalled()
  })

  it("an unconnected self-host is unchanged: trailer is refused and nodaro.ai is never asked", async () => {
    let asked = false
    const relayed = gate(selfHost({
      isNodaroConnected: async () => false,
      cloudFetch: async () => {
        asked = true
        return new Response("{}", { status: 200 })
      },
    }))
    const err = await relayed["edit-plan"]!(plan("trailer"), ctx).then(() => null, (e: unknown) => e)
    expect((err as Error).message).toBe(editPlanModeRefusalMessage("trailer"))
    expect(asked).toBe(false)
    expect(mocks.createCloudJob).not.toHaveBeenCalled()
  })
})

describe("relay to the cloud", () => {
  // B5: camera-switch's media sits one level down in its edit (`edl.sources[].url`),
  // which the top-level walker never reaches — the cloud must still read each camera.
  it("camera-switch: the edit's source URLs are re-hosted too, at the type's wire path", async () => {
    // One source at a time (its `url`), so an over-cap camera is named.
    mocks.rehostIfUrlField.mockImplementation(async (key: string, value: unknown) =>
      key === "url" && typeof value === "string" ? value.replace("http://localhost:9000/a.mp4", "https://cloud-reachable/camA") : value,
    )
    await nodaroExclusiveRelayHandlers["camera-switch"](
      bullJob({
        jobId: "job-cs",
        edl: { version: 1, clock: "master", sources: [{ id: "camA", url: "http://localhost:9000/a.mp4", kind: "video" }], segments: [] },
        transcript: { version: 1, words: [] },
        speakerMap: { speaker_0: "camA" },
      }),
      ctx,
    )
    expect(mocks.createCloudJob).toHaveBeenCalledWith("/v1/camera-switch", {
      edl: { version: 1, clock: "master", sources: [{ id: "camA", url: "https://cloud-reachable/camA", kind: "video" }], segments: [] },
      transcript: { version: 1, words: [] },
      speakerMap: { speaker_0: "camA" },
    })
  })

  it("posts the payload at the type's wire path, stripping instance-only + __ fields and re-hosting URL fields", async () => {
    mocks.rehostIfUrlField.mockImplementation(async (key: string, value: unknown) =>
      key.endsWith("Url") ? `https://cloud-reachable/${key}` : value,
    )
    await nodaroExclusiveRelayHandlers["edit-video-pro"](
      bullJob({
        jobId: "job-1",
        usageLogId: "u-1",
        userId: "00000000-0000-4000-8000-000000000001", // local Supabase id must never ride to the cloud
        workflowId: "5d6ce6a1-90d9-434b-898f-59745a56bf74", // local editor ids — the cloud's
        nodeId: "node_1", // jobs.workflow_id FK rejects them (live 500, 2026-08-18)
        __internalFlag: true,
        videoUrl: "http://localhost:9000/v.mp4",
        instructions: "remove the boom mic",
      }),
      ctx,
    )
    expect(mocks.createCloudJob).toHaveBeenCalledWith("/v1/edit-video-pro", {
      videoUrl: "https://cloud-reachable/videoUrl",
      instructions: "remove the boom mic",
    })
  })

  it("persists provider_kind + the CLOUD job id BEFORE polling — the stall-retry resume contract", async () => {
    const order: string[] = []
    mocks.jobsUpdateEq.mockImplementation(async () => {
      order.push("persist")
      return { error: null }
    })
    mocks.waitForCloudJob.mockImplementation(async () => {
      order.push("poll")
      return { id: "cloud-job-1", status: "completed", output_data: { videoUrl: "https://c/v.mp4" } }
    })
    await nodaroExclusiveRelayHandlers["generate-video-pro"](bullJob({ prompt: "p" }), ctx)
    expect(order).toEqual(["persist", "poll"])
    expect(mocks.jobsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_kind: "nodaro-cloud",
        provider_task_id: "cloud-job-1",
        provider_call_started_at: expect.any(String),
      }),
    )
  })

  it("aborts (throws) when the task id cannot be persisted — better refunded than unrecoverable", async () => {
    mocks.jobsUpdateEq.mockResolvedValue({ error: { message: "db down" } })
    await expect(
      nodaroExclusiveRelayHandlers["video-analysis"](bullJob({ videoUrl: "https://x/v.mp4" }), ctx),
    ).rejects.toThrow(/persist cloud task id/)
    expect(mocks.waitForCloudJob).not.toHaveBeenCalled()
  })

  it("forwards a stop stamped before the cloud job existed (gvp), right after creation", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { stop_requested_at: "2026-08-18T10:00:00Z" } })
    await nodaroExclusiveRelayHandlers["generate-video-pro"](bullJob({ prompt: "p" }), ctx)
    expect(mocks.nodaroCloudFetch).toHaveBeenCalledWith("/v1/generate-video-pro/cloud-job-1/stop", {
      method: "POST",
    })
  })

  it("continue: replays against the cloud's /continue with the CLOUD parent id, never re-creating from scratch", async () => {
    await nodaroExclusiveRelayHandlers["generate-video-pro"](
      bullJob({
        prompt: "continue it",
        __nodaroContinue: { cloudFromJobId: "cloud-parent-9", fromSegment: 3 },
      }),
      ctx,
    )
    expect(mocks.createCloudJob).toHaveBeenCalledWith("/v1/generate-video-pro/continue", {
      prompt: "continue it",
      fromJobId: "cloud-parent-9",
      fromSegment: 3,
    })
  })

  it("polls with the type's own budget (gvp gets the hour-plus budget)", async () => {
    await nodaroExclusiveRelayHandlers["generate-video-pro"](bullJob({ prompt: "p" }), ctx)
    expect(mocks.waitForCloudJob).toHaveBeenCalledWith("cloud-job-1", expect.any(Function), {
      budgetMs: 85 * 60 * 1000,
    })
    vi.clearAllMocks()
    mocks.waitForCloudJob.mockResolvedValue({
      id: "c",
      status: "completed",
      output_data: { analysis: {} },
    })
    mocks.createCloudJob.mockResolvedValue("c")
    mocks.jobsUpdateEq.mockResolvedValue({ error: null })
    await nodaroExclusiveRelayHandlers["video-analysis"](bullJob({ videoUrl: "https://x/v.mp4" }), ctx)
    expect(mocks.waitForCloudJob).toHaveBeenCalledWith("c", expect.any(Function), {
      budgetMs: 30 * 60 * 1000,
    })
  })
})

describe("finalizeExclusiveCloudOutput — per-type output adaptation", () => {
  it("JSON producers (video-analysis/audit): the cloud's output lands verbatim + viaNodaroCloud, provider nodaro", async () => {
    await finalizeExclusiveCloudOutput({
      jobId: "job-1",
      jobType: "video-audit",
      cloudJob: { id: "cloud-job-1", status: "completed", output_data: { report: { score: 9 } } } as never,
      jobUserId: "user-1",
      shouldWatermark: false,
    })
    expect(mocks.markJobCompleted).toHaveBeenCalledWith("job-1", {
      output_data: { report: { score: 9 }, viaNodaroCloud: true },
      provider: "nodaro",
      provider_task_id: "cloud-job-1",
      relay_job_id: "cloud-job-1",
      relay_credits: null,
    })
    expect(mocks.uploadVideoMaybeWatermark).not.toHaveBeenCalled()
  })

  it("edit-plan (JSON producer): the EDL plan output_data lands verbatim + viaNodaroCloud, no media re-host", async () => {
    // clips mode: output_data is an EdlClipSet object at the top level — carried
    // through unchanged (the unwrap to a bare Edl[] happens app-side in the output
    // extractors, NOT here — a bare array here would corrupt on the object-spread).
    const clipSet = { version: 1, clips: [{ version: 1, clock: "master", sources: [], segments: [] }] }
    await finalizeExclusiveCloudOutput({
      jobId: "job-ep",
      jobType: "edit-plan",
      cloudJob: { id: "cloud-ep-1", status: "completed", output_data: clipSet } as never,
      jobUserId: "user-1",
      shouldWatermark: false,
    })
    expect(mocks.markJobCompleted).toHaveBeenCalledWith("job-ep", {
      output_data: { ...clipSet, viaNodaroCloud: true },
      provider: "nodaro",
      provider_task_id: "cloud-ep-1",
      relay_job_id: "cloud-ep-1",
      relay_credits: null,
    })
    expect(mocks.uploadVideoMaybeWatermark).not.toHaveBeenCalled()
  })

  it("camera-switch (JSON producer): { json, transcript } lands verbatim + viaNodaroCloud, no media re-host", async () => {
    const out = { json: { version: 1, clock: "master", sources: [], segments: [] }, transcript: { version: 1, words: [] } }
    await finalizeExclusiveCloudOutput({
      jobId: "job-cs",
      jobType: "camera-switch",
      cloudJob: { id: "cloud-cs-1", status: "completed", output_data: out } as never,
      jobUserId: "user-1",
      shouldWatermark: false,
    })
    expect(mocks.markJobCompleted).toHaveBeenCalledWith("job-cs", {
      output_data: { ...out, viaNodaroCloud: true },
      provider: "nodaro",
      provider_task_id: "cloud-cs-1",
      relay_job_id: "cloud-cs-1",
      relay_credits: null,
    })
    expect(mocks.uploadVideoMaybeWatermark).not.toHaveBeenCalled()
  })

  it("gvp video: comes home under THIS instance's key + watermark rule, finalized with the `pro` checkpoint carried", async () => {
    await finalizeExclusiveCloudOutput({
      jobId: "job-1",
      jobType: "generate-video-pro",
      cloudJob: {
        id: "cloud-job-1",
        status: "completed",
        output_data: { videoUrl: "https://cloud.r2/v.mp4", pro: { segments: [1, 2] } },
      } as never,
      jobUserId: "user-1",
      shouldWatermark: true,
    })
    expect(mocks.uploadVideoMaybeWatermark).toHaveBeenCalledWith(
      "https://cloud.r2/v.mp4",
      "job-1",
      "user-1",
      true,
    )
    expect(mocks.finalizeJobWithMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        jobType: "text-to-video", // storage classification: a video deliverable
        mediaUrl: "https://local.r2/videos/job-1.mp4",
        result: {
          url: "https://cloud.r2/v.mp4",
          cost: null,
          providerUsed: "nodaro",
          relayJobId: "cloud-job-1",
          relayCredits: null,
        },
        extraOutputData: expect.objectContaining({
          pro: { segments: [1, 2] }, // stop/continue read this checkpoint
          viaNodaroCloud: true,
          thumbnailUrl: "https://local.r2/thumbnails/job-1.png",
        }),
      }),
    )
  })

  it("vcp audio mode: re-hosts to R2 and completes with provider nodaro", async () => {
    await finalizeExclusiveCloudOutput({
      jobId: "job-1",
      jobType: "voice-changer-pro",
      cloudJob: {
        id: "cloud-job-1",
        status: "completed",
        output_data: { audioUrl: "https://cloud.r2/a.mp3", analysis: { voice: "x" } },
      } as never,
      jobUserId: "user-1",
      shouldWatermark: false,
    })
    expect(mocks.uploadToR2).toHaveBeenCalledWith("https://cloud.r2/a.mp3", "job-1", "audio", "user-1")
    expect(mocks.markJobCompleted).toHaveBeenCalledWith("job-1", {
      output_data: { audioUrl: "https://local.r2/audio/job-1.mp3", analysis: { voice: "x" }, viaNodaroCloud: true },
      provider: "nodaro",
      relay_job_id: "cloud-job-1",
      relay_credits: null,
    })
    expect(mocks.finalizeJobWithMedia).not.toHaveBeenCalled()
  })

  it("vcp video mode: comes home as a video but stays a markJobCompleted (no gvp checkpoint semantics)", async () => {
    await finalizeExclusiveCloudOutput({
      jobId: "job-1",
      jobType: "voice-changer-pro",
      cloudJob: {
        id: "cloud-job-1",
        status: "completed",
        output_data: { videoUrl: "https://cloud.r2/v.mp4" },
      } as never,
      jobUserId: "user-1",
      shouldWatermark: false,
    })
    expect(mocks.markJobCompleted).toHaveBeenCalledWith("job-1", {
      output_data: {
        videoUrl: "https://local.r2/videos/job-1.mp4",
        thumbnailUrl: "https://local.r2/thumbnails/job-1.png",
        viaNodaroCloud: true,
      },
      provider: "nodaro",
      relay_job_id: "cloud-job-1",
      relay_credits: null,
    })
    expect(mocks.finalizeJobWithMedia).not.toHaveBeenCalled()
  })

  it("fails loudly when a media type finished with no media", async () => {
    await expect(
      finalizeExclusiveCloudOutput({
        jobId: "job-1",
        jobType: "edit-video-pro",
        cloudJob: { id: "c", status: "completed", output_data: {} } as never,
        jobUserId: "user-1",
        shouldWatermark: false,
      }),
    ).rejects.toThrow(/no media or analysis/)
    expect(mocks.markJobCompleted).not.toHaveBeenCalled()
    expect(mocks.finalizeJobWithMedia).not.toHaveBeenCalled()
  })
})

/**
 * Relay provenance on the EXCLUSIVE-NODE lane (spec §8.2, migration 383).
 *
 * The fourth relay lane, and the one carrying the most money: the exclusive
 * types are the most expensive generations a self-host can run, and every one
 * of them is billed at the FAR end. `finalizeExclusiveCloudOutput` is the only place
 * that holds both halves — this instance's job id and the finished cloud job —
 * so each of its four completion sites must land `relay_job_id` /
 * `relay_credits` on the row. Without them a self-host has nothing to bill its
 * user from (it settles on `relay_credits`), and the delete rule — which
 * refuses to touch an object whose row carries `relay_job_id` — is inert for
 * exactly the media it most needs to protect: bytes the FAR end created.
 *
 * Two spellings of one fact, because the two completion functions consume
 * different shapes: the three `markJobCompleted` sites carry the two COLUMNS,
 * while the `finalizeJobWithMedia` site carries the ProviderResult pair and
 * lets job-finalize write them — the only path a HOLD can park and replay.
 */
describe("finalizeExclusiveCloudOutput — relay provenance (lane 4)", () => {
  const finalize = (jobType: string, cloudJob: Record<string, unknown>) =>
    finalizeExclusiveCloudOutput({
      jobId: "job-1",
      jobType,
      cloudJob: cloudJob as never,
      jobUserId: "user-1",
      shouldWatermark: false,
    })

  const completionFields = () => mocks.markJobCompleted.mock.calls[0]![1] as Record<string, unknown>
  const finalizeResult = () =>
    (mocks.finalizeJobWithMedia.mock.calls[0]![0] as { result: Record<string, unknown> }).result

  it("JSON producers: the completion carries the far id and the far end's RESERVED credits", async () => {
    await finalize("video-analysis", {
      id: "cloud-9",
      status: "completed",
      credits: 24,
      output_data: { report: { score: 9 } },
    })
    expect(completionFields()).toMatchObject({ relay_job_id: "cloud-9", relay_credits: 24 })
  })

  it("gvp/evp video: the pair rides the ProviderResult, so job-finalize writes it (and a HOLD parks it)", async () => {
    await finalize("generate-video-pro", {
      id: "cloud-9",
      status: "completed",
      credits: 24,
      output_data: { videoUrl: "https://cloud.r2/v.mp4" },
    })
    expect(finalizeResult()).toEqual({
      url: "https://cloud.r2/v.mp4",
      cost: null,
      providerUsed: "nodaro",
      relayJobId: "cloud-9",
      relayCredits: 24,
    })
  })

  it("vcp video mode: the completion carries the pair", async () => {
    await finalize("voice-changer-pro", {
      id: "cloud-9",
      status: "completed",
      credits: 24,
      output_data: { videoUrl: "https://cloud.r2/v.mp4" },
    })
    expect(completionFields()).toMatchObject({ relay_job_id: "cloud-9", relay_credits: 24 })
    expect(mocks.finalizeJobWithMedia).not.toHaveBeenCalled()
  })

  it("vcp audio mode: the completion carries the pair", async () => {
    await finalize("voice-changer-pro", {
      id: "cloud-9",
      status: "completed",
      credits: 24,
      output_data: { audioUrl: "https://cloud.r2/a.mp3" },
    })
    expect(completionFields()).toMatchObject({ relay_job_id: "cloud-9", relay_credits: 24 })
  })

  it("writes relay_credits NULL — never 0 — when the far end withheld its cost", async () => {
    // "The authority could not say" is not "free": a 0 here would bill the
    // self-host's user nothing for the priciest job the product sells.
    await finalize("video-audit", { id: "cloud-9", status: "completed", output_data: { report: {} } })
    expect(completionFields().relay_credits).toBeNull()
    expect(completionFields().relay_job_id).toBe("cloud-9")
  })

  it("is BYTE-IDENTICAL to today for a completion that is not a relay — no relay_* key at all", async () => {
    // The exact key set, not merely "no relay_job_id": a `{ relay_job_id:
    // undefined, relay_credits: null }` reaching the UPDATE is what NULLs the
    // columns the day someone drops the presence check — and a NULLed
    // `relay_job_id` re-arms the delete path against far-end bytes.
    await finalize("video-audit", { id: "", status: "completed", output_data: { report: {} } })
    expect(Object.keys(completionFields()).sort()).toEqual(["output_data", "provider"])

    mocks.markJobCompleted.mockClear()
    await finalize("voice-changer-pro", {
      id: "",
      status: "completed",
      output_data: { audioUrl: "https://cloud.r2/a.mp3" },
    })
    expect(Object.keys(completionFields()).sort()).toEqual(["output_data", "provider"])

    await finalize("edit-video-pro", {
      id: "",
      status: "completed",
      output_data: { videoUrl: "https://cloud.r2/v.mp4" },
    })
    expect(Object.keys(finalizeResult()).sort()).toEqual(["cost", "providerUsed", "url"])
  })
})

/**
 * Speaker View on a self-host (C3.1, decided 2026-10-06). It relays at its own
 * wire path, with the edit's sources re-hosted one by one; it polls for as long
 * as its own budget says (a 3-hour final outlives the fixed 85 minutes); a
 * private source over the re-host cap is refused before anything is relayed,
 * naming it (SV12); and the render comes home as a plain copy (SV13).
 */
describe("speaker-view relay", () => {
  const MIN = 60_000
  /** `n` 30-second segments alternating two cameras, on the master clock. */
  const edit = (n: number, url = "http://localhost:9000/a.mp4") => ({
    version: 1,
    clock: "master",
    sources: [
      { id: "camA", url, kind: "video" },
      { id: "camB", url: "https://media.example/b.mp4", kind: "video" },
      { id: "mic", url: "https://media.example/mic.wav", kind: "audio", role: "master-audio" },
    ],
    segments: Array.from({ length: n }, (_, i) => ({
      id: `s${i}`, inMs: i * 30_000, outMs: (i + 1) * 30_000, video: i % 2 ? "camB" : "camA", speaker: i % 2 ? "Guest" : "Host",
    })),
  })
  const run = (data: Record<string, unknown>) => nodaroExclusiveRelayHandlers["speaker-view"](bullJob(data), ctx)

  it("relays at /v1/speaker-view with every setting, the edit's sources re-hosted", async () => {
    mocks.rehostIfUrlField.mockImplementation(async (key: string, value: unknown) =>
      key === "url" && value === "http://localhost:9000/a.mp4" ? "https://cloud-reachable/camA" : value,
    )
    const e = edit(2)
    await run({
      jobId: "job-sv",
      usageLogId: "u-1",
      nodeId: "node_1",
      edl: e,
      transcript: { version: 1, words: [] },
      quality: "proxy",
      targetAspect: "9:16",
      layout: "auto",
      switch: { type: "cut" },
      clipKey: "0-60000",
      planBasis: "0123456789abcdef",
      renderBasis: "fedcba9876543210",
    })
    // The stamps (decided 2026-10-07) reach the far end, which stamps them on its result.
    expect(mocks.createCloudJob).toHaveBeenCalledWith("/v1/speaker-view", {
      edl: { ...e, sources: [{ ...e.sources[0], url: "https://cloud-reachable/camA" }, e.sources[1], e.sources[2]] },
      transcript: { version: 1, words: [] },
      quality: "proxy",
      targetAspect: "9:16",
      layout: "auto",
      switch: { type: "cut" },
      clipKey: "0-60000",
      planBasis: "0123456789abcdef",
      renderBasis: "fedcba9876543210",
    })
  })

  it("polls for its own declared budget, past the fixed 85 minutes a 3-hour final would outlive", async () => {
    const { declaredJobBudgetMs, nodeCeilings } = await import("../../../lib/job-budget.js")
    const payload = { edl: edit(360), quality: "final" } // 180 min
    await run(payload)
    const budgetMs = (mocks.waitForCloudJob.mock.calls[0]![2] as { budgetMs: number }).budgetMs
    expect(budgetMs).toBeGreaterThan(85 * MIN)
    // The orchestrator's ceiling for this node, less the margin every relayed
    // type keeps under it — read off the same budget, never a second formula.
    expect(budgetMs).toBe(nodeCeilings(declaredJobBudgetMs("speaker-view", payload)).processingMs - 5 * MIN)
  })

  it("keeps the 85-minute poll when the budget cannot be read", async () => {
    await run({ edl: "not an edit" })
    await run({ edl: { ...edit(2), segments: [] } })
    expect(mocks.waitForCloudJob).toHaveBeenCalledTimes(2)
    for (const call of mocks.waitForCloudJob.mock.calls) {
      expect((call[2] as { budgetMs: number }).budgetMs).toBe(85 * MIN)
    }
  })

  it("refuses a private source over the cap BEFORE relaying — named, and not retried", async () => {
    mocks.rehostByteSize.mockImplementation(async (url: string) => (url === "http://localhost:9000/a.mp4" ? 3_100_000_000 : undefined))
    const err = await run({ edl: edit(2) }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe(
      'Speaker View sends each source of the edit to nodaro.ai; "camA" is 3.1 GB, over the 500 MB limit. Use a public URL or a smaller file.',
    )
    expect(mocks.rehostIfUrlField).not.toHaveBeenCalled()
    expect(mocks.createCloudJob).not.toHaveBeenCalled()
  })

  it("the in-rehost cap is the backstop when no size was readable up front, and names the source the same way", async () => {
    mocks.rehostIfUrlField.mockImplementation(async (key: string, value: unknown) => {
      if (key === "url" && value === "http://localhost:9000/a.mp4") {
        throw Object.assign(new Error("nodaro.ai: media is too large to send to the cloud (900 MB; limit 500 MB)"), { code: "media_too_large", bytes: 900_000_000 })
      }
      return value
    })
    const err = await run({ edl: edit(2) }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe(
      'Speaker View sends each source of the edit to nodaro.ai; "camA" is 900 MB, over the 500 MB limit. Use a public URL or a smaller file.',
    )
    expect(mocks.createCloudJob).not.toHaveBeenCalled()
  })

  it("nodaro.ai's refusal before it charges (not priced yet, until C4) fails the job once, with its message", async () => {
    const { NodaroCloudError } = await import("../../../providers/nodaro/client.js")
    mocks.createCloudJob.mockRejectedValueOnce(new NodaroCloudError("nodaro.ai: Speaker View is not priced yet", 503, "not_priced"))
    const err = await run({ edl: edit(2) }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe("nodaro.ai: Speaker View is not priced yet")
    expect(mocks.waitForCloudJob).not.toHaveBeenCalled()
  })

  it("an outage at create stays retryable", async () => {
    const { NodaroCloudError } = await import("../../../providers/nodaro/client.js")
    mocks.createCloudJob.mockRejectedValueOnce(new NodaroCloudError("nodaro.ai: POST /v1/speaker-view failed (502)", 502))
    const err = await run({ edl: edit(2) }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(isDeterministicJobError(err)).toBe(false)
  })

  it("camera-switch's backstop names its source too", async () => {
    mocks.rehostIfUrlField.mockImplementation(async (key: string, value: unknown) => {
      if (key === "url" && value === "http://localhost:9000/a.mp4") {
        throw Object.assign(new Error("too large"), { code: "media_too_large", bytes: 2_000_000_000 })
      }
      return value
    })
    const err = await nodaroExclusiveRelayHandlers["camera-switch"](bullJob({ edl: edit(2), transcript: { version: 1, words: [] } }), ctx).catch((e: unknown) => e)
    expect((err as Error).message).toBe(
      'Camera Switch sends each source of the edit to nodaro.ai; "camA" is 2.0 GB, over the 500 MB limit. Use a public URL or a smaller file.',
    )
  })

  it("names EVERY source over the cap in the backstop, in source order, whichever upload settles first", async () => {
    // Re-hosts run concurrently: camB's refusal settles first, then camA's.
    mocks.rehostIfUrlField.mockImplementation(async (key: string, value: unknown) => {
      if (key === "url" && value === "http://localhost:9000/a.mp4") {
        await new Promise((r) => setTimeout(r, 5))
        throw Object.assign(new Error("too large"), { code: "media_too_large", bytes: 900_000_000 })
      }
      if (key === "url" && value === "https://media.example/b.mp4") {
        throw Object.assign(new Error("too large"), { code: "media_too_large", bytes: 2_000_000_000 })
      }
      return value
    })
    const err = await run({ edl: edit(2) }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe(
      'Speaker View sends each source of the edit to nodaro.ai; "camA" is 900 MB and "camB" is 2.0 GB, over the 500 MB limit. Use a public URL or a smaller file.',
    )
    expect(mocks.createCloudJob).not.toHaveBeenCalled()
  })

  it("a size refusal outranks a transient re-host failure on another source — no retry can change it", async () => {
    mocks.rehostIfUrlField.mockImplementation(async (key: string, value: unknown) => {
      if (key === "url" && value === "http://localhost:9000/a.mp4") throw new Error("ECONNRESET")
      if (key === "url" && value === "https://media.example/b.mp4") {
        throw Object.assign(new Error("too large"), { code: "media_too_large", bytes: 2_000_000_000 })
      }
      return value
    })
    const err = await run({ edl: edit(2) }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toContain('"camB" is 2.0 GB')
  })

  it("a transient re-host failure alone stays retryable", async () => {
    mocks.rehostIfUrlField.mockImplementation(async (key: string, value: unknown) => {
      if (key === "url" && value === "http://localhost:9000/a.mp4") throw new Error("ECONNRESET")
      return value
    })
    const err = await run({ edl: edit(2) }).catch((e: unknown) => e)
    expect((err as Error).message).toBe("ECONNRESET")
    expect(isDeterministicJobError(err)).toBe(false)
  })
})

describe("finalizeExclusiveCloudOutput — speaker-view comes home as a plain copy (SV13)", () => {
  const svOutput = {
    videoUrl: "https://cloud.r2/videos/sv-1.mp4",
    thumbnailUrl: "https://cloud.r2/thumbnails/sv-1.png",
    json: { version: 1, clock: "master", sources: [], segments: [] },
    quality: "proxy",
    clipKey: "0-60000",
    planBasis: "0123456789abcdef",
    renderBasis: "fedcba9876543210",
  }

  it("copies the render without watermark or transcode, carrying json, quality, clipKey, planBasis and renderBasis", async () => {
    await finalizeExclusiveCloudOutput({
      jobId: "job-1",
      jobType: "speaker-view",
      cloudJob: { id: "cloud-sv-1", status: "completed", credits: 30, output_data: svOutput } as never,
      jobUserId: "user-1",
      shouldWatermark: true, // a render of the user's own footage is never watermarked
    })
    expect(mocks.bringRenderHome).toHaveBeenCalledWith("https://cloud.r2/videos/sv-1.mp4", "job-1", "user-1")
    expect(mocks.uploadVideoMaybeWatermark).not.toHaveBeenCalled()
    expect(mocks.generateAndUploadThumbnail).not.toHaveBeenCalled()
    expect(mocks.finalizeJobWithMedia).not.toHaveBeenCalled()
    expect(mocks.markJobCompleted).toHaveBeenCalledWith("job-1", {
      output_data: {
        videoUrl: "https://local.r2/videos/job-1.mp4",
        thumbnailUrl: "https://local.r2/thumbnails/job-1.png",
        json: svOutput.json,
        quality: "proxy",
        clipKey: "0-60000",
        planBasis: "0123456789abcdef",
        renderBasis: "fedcba9876543210",
        viaNodaroCloud: true,
      },
      provider: "nodaro",
      provider_task_id: "cloud-sv-1",
      relay_job_id: "cloud-sv-1",
      relay_credits: 30,
    })
  })

  it("keeps the far end's thumbnail only when it could not cut its own", async () => {
    mocks.bringRenderHome.mockResolvedValueOnce({ videoUrl: "https://local.r2/videos/job-1.mp4", thumbnailUrl: null })
    await finalizeExclusiveCloudOutput({
      jobId: "job-1",
      jobType: "speaker-view",
      cloudJob: { id: "cloud-sv-1", status: "completed", output_data: svOutput } as never,
      jobUserId: "user-1",
      shouldWatermark: false,
    })
    const out = (mocks.markJobCompleted.mock.calls[0]![1] as { output_data: Record<string, unknown> }).output_data
    expect(out.thumbnailUrl).toBe("https://cloud.r2/thumbnails/sv-1.png")
  })

  it("is byte-identical to a non-relay completion when the far end gave no id — no relay_* key", async () => {
    await finalizeExclusiveCloudOutput({
      jobId: "job-1",
      jobType: "speaker-view",
      cloudJob: { id: "", status: "completed", output_data: svOutput } as never,
      jobUserId: "user-1",
      shouldWatermark: false,
    })
    expect(Object.keys(mocks.markJobCompleted.mock.calls[0]![1] as Record<string, unknown>).sort()).toEqual(["output_data", "provider"])
  })

  it("fails loudly when the render finished with no video", async () => {
    await expect(
      finalizeExclusiveCloudOutput({
        jobId: "job-1",
        jobType: "speaker-view",
        cloudJob: { id: "c", status: "completed", output_data: { json: {} } } as never,
        jobUserId: "user-1",
        shouldWatermark: false,
      }),
    ).rejects.toThrow(/no media/)
    expect(mocks.markJobCompleted).not.toHaveBeenCalled()
  })
})

// Review round (finding A): the copy is the slow part of a Speaker View
// finalize — an hour-long download of a multi-GB render. Without the finalize
// claim every reconcile tick that finds the stale row starts ANOTHER copy of
// the same render; the claim (kept fresh for as long as the copy runs) is what
// the cron's hasFreshFinalizeClaim reads to leave the row alone.
describe("finalizeExclusiveCloudOutput — speaker-view copies under the finalize claim", () => {
  const svJob = {
    id: "cloud-sv-1",
    status: "completed",
    output_data: { videoUrl: "https://cloud.r2/videos/sv-1.mp4", json: {}, quality: "final" },
  } as never
  const finalize = (claimant?: "worker" | "cron") =>
    finalizeExclusiveCloudOutput({
      jobId: "job-1",
      jobType: "speaker-view",
      cloudJob: svJob,
      jobUserId: "user-1",
      shouldWatermark: false,
      ...(claimant ? { claimant } : {}),
    })

  it("claims the finalize BEFORE it copies, as the worker by default", async () => {
    await expect(finalize()).resolves.toBe(true)
    expect(mocks.claimJobFinalize).toHaveBeenCalledWith("job-1", "worker")
    expect(mocks.claimJobFinalize.mock.invocationCallOrder[0]!).toBeLessThan(mocks.bringRenderHome.mock.invocationCallOrder[0]!)
    expect(mocks.markJobCompleted).toHaveBeenCalledTimes(1)
  })

  it("claims as the cron when the cron recovers it", async () => {
    await finalize("cron")
    expect(mocks.claimJobFinalize).toHaveBeenCalledWith("job-1", "cron")
  })

  it("another finalizer holds the claim: no second copy, no completion", async () => {
    mocks.claimJobFinalize.mockResolvedValueOnce({ won: false, ts: null })
    await expect(finalize("cron")).resolves.toBe(false)
    expect(mocks.bringRenderHome).not.toHaveBeenCalled()
    expect(mocks.markJobCompleted).not.toHaveBeenCalled()
  })

  it("a cron tick that scanned before another tick claimed the row does not re-enter that tick's claim", async () => {
    // Two cron ticks share the claimant "cron", which the claim RPC lets re-enter.
    // A long tick reaches a row on an hour-old scan: the claim is read again here.
    mocks.maybeSingle.mockResolvedValueOnce({ data: { finalize_claimed_at: new Date(Date.now() - 60_000).toISOString() } })
    await expect(finalize("cron")).resolves.toBe(false)
    expect(mocks.claimJobFinalize).not.toHaveBeenCalled()
    expect(mocks.bringRenderHome).not.toHaveBeenCalled()
  })

  it("a stall re-pick (the worker) still re-takes its crashed predecessor's fresh claim", async () => {
    // The worker does not read the claim first: the RPC's same-claimant re-entry decides.
    await expect(finalize("worker")).resolves.toBe(true)
    expect(mocks.jobsSelect).not.toHaveBeenCalled()
    expect(mocks.claimJobFinalize).toHaveBeenCalledWith("job-1", "worker")
  })

  it("a cron finds a claim older than its TTL (a dead copier) and takes over", async () => {
    const { FINALIZE_CLAIM_TTL_MS } = await import("../../../lib/reconcile/types.js")
    mocks.maybeSingle.mockResolvedValueOnce({ data: { finalize_claimed_at: new Date(Date.now() - FINALIZE_CLAIM_TTL_MS - 1000).toISOString() } })
    await expect(finalize("cron")).resolves.toBe(true)
    expect(mocks.bringRenderHome).toHaveBeenCalledTimes(1)
  })

  it("a failed copy releases the claim, so the next attempt need not wait out its TTL", async () => {
    mocks.bringRenderHome.mockRejectedValueOnce(new Error("download timed out"))
    await expect(finalize()).rejects.toThrow("download timed out")
    expect(mocks.releaseJobFinalizeClaim).toHaveBeenCalledWith("job-1", "claim-ts-1")
    expect(mocks.markJobCompleted).not.toHaveBeenCalled()
  })

  it("keeps the claim fresh while a copy outlives the claim's TTL, and stops once it is done", async () => {
    const { FINALIZE_CLAIM_TTL_MS } = await import("../../../lib/reconcile/types.js")
    vi.useFakeTimers()
    try {
      let finishCopy: () => void = () => {}
      mocks.bringRenderHome.mockImplementationOnce(
        () => new Promise((resolve) => {
          finishCopy = () => resolve({ videoUrl: "https://local.r2/videos/job-1.mp4", thumbnailUrl: null })
        }),
      )
      mocks.claimJobFinalize
        .mockResolvedValueOnce({ won: true, ts: "claim-ts-1" })
        .mockResolvedValue({ won: true, ts: "claim-ts-later" })
      const done = finalize("cron")
      // An hour of copying: the claim must never be older than its TTL.
      for (let elapsed = 0; elapsed < 60 * 60_000; elapsed += FINALIZE_CLAIM_TTL_MS / 2) {
        await vi.advanceTimersByTimeAsync(FINALIZE_CLAIM_TTL_MS / 2)
      }
      const refreshes = mocks.claimJobFinalize.mock.calls.length - 1
      expect(refreshes).toBeGreaterThanOrEqual(Math.floor((60 * 60_000) / FINALIZE_CLAIM_TTL_MS))
      for (const call of mocks.claimJobFinalize.mock.calls) expect(call).toEqual(["job-1", "cron"])
      finishCopy()
      await expect(done).resolves.toBe(true)
      const callsAtFinish = mocks.claimJobFinalize.mock.calls.length
      await vi.advanceTimersByTimeAsync(3 * FINALIZE_CLAIM_TTL_MS)
      expect(mocks.claimJobFinalize.mock.calls.length).toBe(callsAtFinish)
    } finally {
      vi.useRealTimers()
    }
  })

  it("a failed copy after a refresh releases the LATEST claim", async () => {
    const { FINALIZE_CLAIM_TTL_MS } = await import("../../../lib/reconcile/types.js")
    vi.useFakeTimers()
    try {
      let failCopy: () => void = () => {}
      mocks.bringRenderHome.mockImplementationOnce(
        () => new Promise((_resolve, reject) => {
          failCopy = () => reject(new Error("upload failed"))
        }),
      )
      mocks.claimJobFinalize
        .mockResolvedValueOnce({ won: true, ts: "claim-ts-1" })
        .mockResolvedValue({ won: true, ts: "claim-ts-refreshed" })
      const done = finalize()
      const settled = done.catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(FINALIZE_CLAIM_TTL_MS)
      failCopy()
      expect(((await settled) as Error).message).toBe("upload failed")
      expect(mocks.releaseJobFinalizeClaim).toHaveBeenCalledWith("job-1", "claim-ts-refreshed")
    } finally {
      vi.useRealTimers()
    }
  })

  it("only Speaker View takes the claim here — gvp/evp take it inside finalizeJobWithMedia", async () => {
    await finalizeExclusiveCloudOutput({
      jobId: "job-1",
      jobType: "video-analysis",
      cloudJob: { id: "c", status: "completed", output_data: { json: {} } } as never,
      jobUserId: "user-1",
      shouldWatermark: false,
    })
    expect(mocks.claimJobFinalize).not.toHaveBeenCalled()
  })

  it("passes the claimant into finalizeJobWithMedia for gvp/evp, so a cron recovery claims as the cron", async () => {
    await finalizeExclusiveCloudOutput({
      jobId: "job-1",
      jobType: "generate-video-pro",
      cloudJob: { id: "c", status: "completed", output_data: { videoUrl: "https://cloud.r2/v.mp4" } } as never,
      jobUserId: "user-1",
      shouldWatermark: false,
      claimant: "cron",
    })
    expect(mocks.finalizeJobWithMedia).toHaveBeenCalledWith(expect.objectContaining({ claimant: "cron" }))
  })
})
