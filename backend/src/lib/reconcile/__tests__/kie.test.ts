import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const pollKieTaskMock = vi.fn()
  const pollVeoTaskMock = vi.fn()
  const runVeo1080pTaskMock = vi.fn()
  const pollKling3TaskMock = vi.fn()
  const pollKontextTaskMock = vi.fn()
  const pollLumaTaskMock = vi.fn()
  const pollRunwayTaskMock = vi.fn()
  const pollAlephTaskMock = vi.fn()
  const pollSunoTaskMock = vi.fn()
  const uploadToR2Mock = vi.fn()
  const finalizeMock = vi.fn().mockResolvedValue({ ok: true })
  const refundMock = vi.fn().mockResolvedValue(undefined)
  const recoverEntityMock = vi.fn().mockResolvedValue(undefined)

  // KieError subclass — matches the real one's name property so the runtime
  // check `err instanceof KieError` works inside the handler.
  class FakeKieError extends Error {
    isUpstreamFailure: boolean
    internalDetails: string
    /** Set by the real poll clients from the provider's bare failMsg. */
    contentPolicyClass: "copyright" | "likeness" | "safety" | null = null
    inputVideoRefused = false
    constructor(message: string, isUpstreamFailure = false, internalDetails = "task failed: [500] raw provider text") {
      super(message)
      this.name = "KieError"
      this.isUpstreamFailure = isUpstreamFailure
      this.internalDetails = internalDetails
    }
  }

  // Supabase chain — supports both SELECT (for bumpAttempts) and UPDATE
  // (for bumpAttempts + markFailed). Per-table dispatch.
  const jobsSingleMock = vi.fn().mockResolvedValue({
    data: { reconcile_attempts: 0 },
    error: null,
  })
  const jobsSelectEqMock = vi.fn(() => ({ single: jobsSingleMock }))
  const jobsSelectMock = vi.fn(() => ({ eq: jobsSelectEqMock }))

  // markJobFailed (lib/job-failure.ts) ends its CAS with `.select("id")` and
  // reads the returned rows to answer "did WE flip it?" — the mock must model
  // that or every migrated writer sees a lost race.
  const jobsUpdateCasSelectMock = vi.fn().mockResolvedValue({ data: [{ id: "j-1" }], error: null })
  const jobsUpdateInMock = vi.fn(() => ({ select: jobsUpdateCasSelectMock }))
  const jobsUpdateEqMock = vi.fn(() => ({
    in: jobsUpdateInMock,
    // For bumpAttempts, the chain ends at .eq() — no .in()
    then: undefined,
  }))
  // Mock the chain for bumpAttempts (.update().eq()) and markFailed
  // (.update().eq().in(["pending","processing"])) by returning a thenable that
  // resolves directly when awaited.
  const jobsUpdateMock = vi.fn((arg: Record<string, unknown>) => {
    void arg
    return {
      eq: vi.fn((col: string, val: string) => {
        if (col === "id") {
          // Return an object that has both .in() (for markFailed) and is awaitable (for bumpAttempts)
          return Object.assign(
            Promise.resolve({ data: null, error: null }) as Promise<{ data: null; error: null }> & { in: typeof jobsUpdateInMock },
            { in: jobsUpdateInMock },
          )
        }
        return { in: jobsUpdateInMock }
      }),
    }
  })

  const fromMock = vi.fn((_table: string) => ({
    select: jobsSelectMock,
    update: jobsUpdateMock,
  }))

  return {
    pollKieTaskMock,
    pollVeoTaskMock,
    runVeo1080pTaskMock,
    pollKling3TaskMock,
    pollKontextTaskMock,
    pollLumaTaskMock,
    pollRunwayTaskMock,
    pollAlephTaskMock,
    pollSunoTaskMock,
    uploadToR2Mock,
    finalizeMock,
    refundMock,
    recoverEntityMock,
    FakeKieError,
    jobsUpdateMock,
    jobsUpdateInMock,
    fromMock,
    jobsSingleMock,
  }
})

vi.mock("../../supabase.js", () => ({
  supabase: { from: mocks.fromMock },
}))

vi.mock("../../../providers/kie/client.js", () => ({
  pollKieTask: mocks.pollKieTaskMock,
  pollVeoTask: mocks.pollVeoTaskMock,
  runVeo1080pTask: mocks.runVeo1080pTaskMock,
  KieError: mocks.FakeKieError,
  isUpstreamKieFailure: (err: unknown) =>
    err instanceof mocks.FakeKieError && err.isUpstreamFailure,
}))

vi.mock("../../../providers/kie/kling3-client.js", () => ({
  pollKling3Task: mocks.pollKling3TaskMock,
}))

vi.mock("../../../providers/kie/kontext-client.js", () => ({
  pollKontextTask: mocks.pollKontextTaskMock,
}))

vi.mock("../../../providers/kie/luma-client.js", () => ({
  pollLumaTask: mocks.pollLumaTaskMock,
}))

vi.mock("../../../providers/kie/runway-client.js", () => ({
  pollRunwayTask: mocks.pollRunwayTaskMock,
  pollAlephTask: mocks.pollAlephTaskMock,
}))

vi.mock("../../../providers/kie/suno-client.js", () => ({
  pollSunoTask: mocks.pollSunoTaskMock,
}))

vi.mock("../../storage.js", () => ({
  uploadToR2: mocks.uploadToR2Mock,
  uploadBufferToR2: vi.fn(),
  uploadFileToR2: vi.fn(),
  uploadFileWithKeyToR2: vi.fn(),
}))

vi.mock("../../job-finalize.js", async (importOriginal) => {
  // isFinalizeJobType + NOT_GENERIC_RECOVERABLE are pure lookups over static
  // sets — keep the REAL ones so the narrowing under test is the real thing,
  // not a re-declared copy that could drift from job-finalize.ts.
  const actual = await importOriginal<typeof import("../../job-finalize.js")>()
  return {
    ...actual,
    finalizeJobWithMedia: mocks.finalizeMock,
  }
})

vi.mock("../../credits-job-lifecycle.js", () => ({
  refundReservedCreditsForJob: mocks.refundMock,
}))

// The Seedance reference-video settlement (core shim over the ee helper): the
// generic recovery must measure like the worker would, or a run whose worker
// died pays the whole worst-case reservation.
const settle = vi.hoisted(() => ({
  measure: vi.fn(async (_args: Record<string, unknown>): Promise<number | undefined> => undefined),
}))
vi.mock("../../seedance2-ref-video-settle.js", () => ({
  measureSeedance2RefVideoBaseCredits: settle.measure,
}))

// Seedance Draft: the raw take is measured (ffprobe stubbed) and a recovered
// finalize re-applies the draft's audio mux (ffmpeg half stubbed).
const draft = vi.hoisted(() => ({
  render: vi.fn(async (_args: Record<string, unknown>): Promise<number | undefined> => undefined),
  apply: vi.fn(async (_args: Record<string, unknown>): Promise<{ url: string; warning?: { code: string; message: string } }> => ({ url: "https://r2/hd.mp4" })),
}))
vi.mock("../../seedance-draft-finalize.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../seedance-draft-finalize.js")>()),
  measureSeedanceDraftRenderSec: draft.render,
}))
vi.mock("../../seedance-draft-audio-apply.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../seedance-draft-audio-apply.js")>()),
  applyDraftAudioMux: draft.apply,
}))

vi.mock("../entity-recovery.js", async (importOriginal) => {
  // Keep the REAL `isEntityMediaJobType` (the narrowing under test) and stub
  // only the recovery itself — its own behavior is covered end-to-end in
  // `entity-recovery.test.ts`.
  const actual = await importOriginal<typeof import("../entity-recovery.js")>()
  return { ...actual, recoverEntityJob: mocks.recoverEntityMock }
})

import { reconcileKieJob, type KieJobRow } from "../kie.js"

describe("reconcileKieJob", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.finalizeMock.mockResolvedValue({ ok: true })
    mocks.refundMock.mockResolvedValue(undefined)
    mocks.jobsSingleMock.mockResolvedValue({ data: { reconcile_attempts: 0 }, error: null })
  })

  it("kie-standard success → calls finalizeJobWithMedia with the polled result URL", async () => {
    mocks.pollKieTaskMock.mockResolvedValueOnce({
      resultJson: { resultUrls: ["https://kie.example/result.png"] },
      providerMs: 1234,
      taskId: "t1",
    })
    const row: KieJobRow = {
      id: "j-success",
      provider_kind: "kie-standard",
      provider_task_id: "t1",
      reconcile_attempts: 0,
      job_type: "generate-image",
    }
    await reconcileKieJob(row)
    expect(mocks.finalizeMock).toHaveBeenCalledWith({
      jobId: "j-success",
      jobType: "generate-image",
      // Claimant identity (audit H1): the cron must claim as "cron" so it
      // never steals a live worker's fresh claim (and vice versa), while a
      // stall re-pick (inline reconcile, claimant "worker") can immediately
      // re-claim its own crashed predecessor's claim.
      claimant: "cron",
      result: expect.objectContaining({
        url: "https://kie.example/result.png",
        extraUrls: [],
        providerMs: 1234,
      }),
    })
    expect(mocks.refundMock).not.toHaveBeenCalled()
  })

  it("a Seedance reference-video run recovered by the cron settles to the DELIVERED clip, from the row's own inputs, like the worker would", async () => {
    mocks.pollKieTaskMock.mockResolvedValueOnce({
      resultJson: { resultUrls: ["https://kie.example/out.mp4"] },
      providerMs: 40000,
      taskId: "t-sd",
    })
    settle.measure.mockResolvedValueOnce(7193)
    const row: KieJobRow = {
      id: "j-seedance",
      provider_kind: "kie-standard",
      provider_task_id: "t-sd",
      reconcile_attempts: 0,
      job_type: "image-to-video",
      input_data: {
        provider: "seedance-2-5", resolution: "1080p", duration: 12,
        referenceVideoUrls: ["https://r2.example.com/videos/ref.mp4"], refVideoDurationsSec: [30],
      },
    }
    await reconcileKieJob(row)
    expect(settle.measure).toHaveBeenCalledWith({
      provider: "seedance-2-5",
      resolution: "1080p",
      outputUrl: "https://kie.example/out.mp4",
      referenceVideoUrls: ["https://r2.example.com/videos/ref.mp4"],
      refVideoDurationsSec: [30],
      duration: 12,
      jobId: "j-seedance",
    })
    expect(mocks.finalizeMock).toHaveBeenCalledWith(expect.objectContaining({ jobId: "j-seedance", meteredBaseCredits: 7193 }))
  })

  it("a run with nothing to measure finalizes without a measured charge (the reservation is committed, as before)", async () => {
    mocks.pollKieTaskMock.mockResolvedValueOnce({
      resultJson: { resultUrls: ["https://kie.example/out.mp4"] },
      providerMs: 40000,
      taskId: "t-plain",
    })
    const row: KieJobRow = {
      id: "j-plain",
      provider_kind: "kie-standard",
      provider_task_id: "t-plain",
      reconcile_attempts: 0,
      job_type: "image-to-video",
      input_data: { provider: "minimax", duration: 5 },
    }
    await reconcileKieJob(row)
    expect(mocks.finalizeMock.mock.calls[0]![0]).not.toHaveProperty("meteredBaseCredits")
  })

  it("a recovered Seedance DRAFT records its raw take and draftAudioMux: null — the stored clip got no merge here", async () => {
    // The worker died before the audioUrl merge; the recovery delivers the raw
    // (silent) clip, so the finalize must NOT later infer a copy from it.
    mocks.pollKieTaskMock.mockResolvedValueOnce({ resultJson: { resultUrls: ["https://kie.example/draft.mp4"] }, providerMs: 1, taskId: "t-d" })
    draft.render.mockResolvedValueOnce(4.04)
    await reconcileKieJob({
      id: "j-draft", provider_kind: "kie-standard", provider_task_id: "t-d", reconcile_attempts: 0, job_type: "image-to-video",
      input_data: { provider: "seedance-2-5", draft: true, resolution: "480p", duration: 4, audioUrl: "https://a/vo.mp3", generateAudio: false },
    })
    expect(mocks.finalizeMock.mock.calls[0]![0]).toMatchObject({ extraOutputData: { draftRenderSec: 4.04, draftAudioMux: null } })
  })

  it("a recovered draft FINALIZE re-applies the draft's mux; a failed re-apply delivers silent with the warning", async () => {
    mocks.pollKieTaskMock.mockResolvedValueOnce({ resultJson: { resultUrls: ["https://kie.example/hd.mp4"] }, providerMs: 1, taskId: "t-hd" })
    mocks.jobsSingleMock.mockResolvedValue({ data: { user_id: "u1", should_watermark: true, reconcile_attempts: 0 }, error: null })
    draft.apply.mockResolvedValueOnce({ url: "https://r2/hd-silent.mp4", warning: { code: "draft_audio_not_reapplied", message: "no audio" } })
    const mux = { kind: "voice-track", audioUrl: "https://r2/t.mp3" }
    await reconcileKieJob({
      id: "j-hd", provider_kind: "kie-seedance-draft", provider_task_id: "t-hd", reconcile_attempts: 0, job_type: "video-upscale",
      input_data: { provider: "seedance-2-5-hd", draftAudioMux: mux, draftVideoUrl: "https://r2/draft.mp4" },
    })
    expect(draft.apply).toHaveBeenCalledWith(expect.objectContaining({ videoUrl: "https://kie.example/hd.mp4", mux, draftVideoUrl: "https://r2/draft.mp4", jobId: "j-hd" }))
    expect(mocks.finalizeMock.mock.calls[0]![0]).toMatchObject({
      mediaUrl: "https://r2/hd-silent.mp4",
      extraOutputData: { warningCode: "draft_audio_not_reapplied", warningMessage: "no audio" },
    })
  })

  it("a recovered plain draft finalize uploads the render as is (no mux, no warning)", async () => {
    mocks.pollKieTaskMock.mockResolvedValueOnce({ resultJson: { resultUrls: ["https://kie.example/hd.mp4"] }, providerMs: 1, taskId: "t-hd2" })
    await reconcileKieJob({
      id: "j-hd2", provider_kind: "kie-seedance-draft", provider_task_id: "t-hd2", reconcile_attempts: 0, job_type: "video-upscale",
      input_data: { provider: "seedance-2-5-hd" },
    })
    expect(draft.apply).not.toHaveBeenCalled()
    const arg = mocks.finalizeMock.mock.calls[0]![0] as Record<string, unknown>
    expect(arg).not.toHaveProperty("mediaUrl")
    expect(arg).not.toHaveProperty("extraOutputData")
  })

  it("inline (stall re-pick) caller: claimant 'worker' is threaded through to finalize", async () => {
    mocks.pollKieTaskMock.mockResolvedValueOnce({
      resultJson: { resultUrls: ["https://kie.example/result.png"] },
      providerMs: 99,
      taskId: "t-inline",
    })
    const row: KieJobRow = {
      id: "j-inline",
      provider_kind: "kie-standard",
      provider_task_id: "t-inline",
      reconcile_attempts: 0,
      job_type: "generate-image",
    }
    await reconcileKieJob(row, { claimant: "worker" })
    expect(mocks.finalizeMock).toHaveBeenCalledWith(
      expect.objectContaining({ claimant: "worker" }),
    )
  })

  it("kie-veo success → uses pollVeoTask + finalize with the resultUrls", async () => {
    mocks.pollVeoTaskMock.mockResolvedValueOnce({
      resultUrls: ["https://veo.example/clip.mp4"],
      providerMs: 30000,
    })
    const row: KieJobRow = {
      id: "j-veo",
      provider_kind: "kie-veo",
      provider_task_id: "t-veo",
      reconcile_attempts: 0,
      job_type: "image-to-video",
    }
    await reconcileKieJob(row)
    expect(mocks.pollVeoTaskMock).toHaveBeenCalledWith("t-veo", "VEO")
    expect(mocks.finalizeMock).toHaveBeenCalled()
  })

  it("kie-aleph success → uses pollAlephTask and finalizes", async () => {
    // Reconcile blind-spot regression: runway-aleph used to be tagged
    // `kie-standard`, which routed singlePoll to the wrong endpoint and
    // force-failed every stuck Aleph row after 18 attempts.
    mocks.pollAlephTaskMock.mockResolvedValueOnce("https://aleph.example/v.mp4")
    const row: KieJobRow = {
      id: "j-aleph",
      provider_kind: "kie-aleph",
      provider_task_id: "t-aleph",
      reconcile_attempts: 0,
      job_type: "video-to-video",
    }
    await reconcileKieJob(row)
    expect(mocks.pollAlephTaskMock).toHaveBeenCalledWith("t-aleph")
    expect(mocks.pollKieTaskMock).not.toHaveBeenCalled()
    expect(mocks.finalizeMock).toHaveBeenCalled()
  })

  it("kie-veo-1080p success → re-calls runVeo1080pTask with parent kieTaskId", async () => {
    // The 1080p endpoint reuses the original VEO task's id (no separate
    // 1080p task is created). singlePoll uses runVeo1080pTask which retries
    // internally; here we just verify the dispatch.
    mocks.runVeo1080pTaskMock.mockResolvedValueOnce({ url: "https://veo.example/1080p.mp4" })
    const row: KieJobRow = {
      id: "j-veo1080",
      provider_kind: "kie-veo-1080p",
      provider_task_id: "parent-veo-id",
      reconcile_attempts: 0,
      job_type: "video-upscale",
    }
    await reconcileKieJob(row)
    expect(mocks.runVeo1080pTaskMock).toHaveBeenCalledWith("parent-veo-id")
    expect(mocks.finalizeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "j-veo1080",
        jobType: "video-upscale",
        result: expect.objectContaining({ url: "https://veo.example/1080p.mp4" }),
      }),
    )
  })

  it("kie-kling3 success → uses pollKling3Task and finalizes", async () => {
    mocks.pollKling3TaskMock.mockResolvedValueOnce("https://kling.example/v.mp4")
    const row: KieJobRow = {
      id: "j-kling3",
      provider_kind: "kie-kling3",
      provider_task_id: "t-kling",
      reconcile_attempts: 0,
      job_type: "image-to-video",
    }
    await reconcileKieJob(row)
    expect(mocks.pollKling3TaskMock).toHaveBeenCalledWith("t-kling")
    expect(mocks.finalizeMock).toHaveBeenCalled()
  })

  it("upstream failure (KieError with upstreamFailure flag) → markFailed + refund, no finalize", async () => {
    // Regression: the REAL KieError.message is SANITIZED (e.g. the generic
    // "Generation failed…"), so the old `err.message.includes("task failed")`
    // check never matched and reconcile bumped a TERMINAL failure toward the
    // 18-attempt / 90-min exhaustion (the seedance-2 r2v incident). Classify
    // off the structured `upstreamFailure` flag, never the sanitized message.
    mocks.pollKieTaskMock.mockRejectedValueOnce(
      new mocks.FakeKieError(
        "Generation failed. Please try again or contact support if the issue persists.",
        true, // structured terminal-failure flag (NOT the sanitized message)
      ),
    )
    const row: KieJobRow = {
      id: "j-failed",
      provider_kind: "kie-standard",
      provider_task_id: "t-failed",
      reconcile_attempts: 0,
      job_type: "image-to-video",
    }
    await reconcileKieJob(row)
    expect(mocks.refundMock).toHaveBeenCalledWith("j-failed")
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    // W0: the redacted raw provider text rides along with the sanitized reason.
    expect(mocks.jobsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error_detail: expect.any(String) }),
    )
    // Spec D11: the shared markJobFailed CAS. "queued" is newly failable (these
    // sweeps could not take a queued row at all before); "pending_review" is
    // absent BY CONSTRUCTION, so no reconcile tick can fail a job under review.
    expect(mocks.jobsUpdateInMock).toHaveBeenCalledWith("status", ["pending", "queued", "processing"])
  })

  it("kie-veo upstream failure → markFailed + refund (fail-fast for non-kie-standard kinds)", async () => {
    // The shared isUpstreamKieFailure must fail-fast for EVERY poll client, not
    // just kie-standard — VEO/Kling-3/Kontext/Luma/Runway/Aleph terminal failures
    // previously rode to the 90-min exhaustion because only the sanitized message
    // was inspected.
    mocks.pollVeoTaskMock.mockRejectedValueOnce(
      new mocks.FakeKieError("Generation failed. Please try again or contact support.", true),
    )
    const row: KieJobRow = {
      id: "j-veo-failed",
      provider_kind: "kie-veo",
      provider_task_id: "t-veo-failed",
      reconcile_attempts: 0,
      job_type: "image-to-video",
    }
    await reconcileKieJob(row)
    expect(mocks.refundMock).toHaveBeenCalledWith("j-veo-failed")
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
  })

  // A job re-picked after a worker restart ends HERE, not in the worker's
  // catch — so the reconcile failure must carry the same error_hint the worker
  // would have written (a caller such as Cast Swap's auto mode acts on it).
  describe("a terminal failure carries the worker's error_hint", () => {
    /** The error pollKieTask throws for a KIE `state:"fail"` task: its flags
     *  come from the REAL classifiers run on the provider's bare failMsg. */
    async function kieTaskFailure(failMsg: string) {
      const real = await vi.importActual<typeof import("../../../providers/kie/client.js")>(
        "../../../providers/kie/client.js",
      )
      const err = new mocks.FakeKieError("The provider declined this generation.", true, `task failed: [501] ${failMsg}`)
      err.contentPolicyClass = real.classifyContentPolicyClass(failMsg)
      err.inputVideoRefused = real.isInputVideoRefusal(failMsg)
      return err
    }
    const COPYRIGHT_VIDEO = "Input video may be related to copyright restrictions. Please try another video."
    const FILE_FAILED = "File processing failed"

    function failedUpdate(): Record<string, unknown> {
      const call = mocks.jobsUpdateMock.mock.calls.find(
        (c) => (c[0] as Record<string, unknown>).status === "failed",
      )
      expect(call).toBeTruthy()
      return call![0] as Record<string, unknown>
    }

    function videoRow(input_data: Record<string, unknown>): KieJobRow {
      return {
        id: "j-refused",
        provider_kind: "kie-standard",
        provider_task_id: "t-refused",
        reconcile_attempts: 0,
        job_type: "image-to-video",
        input_data,
      }
    }

    it("a copyright refusal of the job's reference video → the copyright hint names the input video", async () => {
      mocks.pollKieTaskMock.mockRejectedValueOnce(await kieTaskFailure(COPYRIGHT_VIDEO))
      await reconcileKieJob(videoRow({ provider: "seedance-2", referenceVideoUrls: ["https://cdn.example/src.mp4"] }))
      const update = failedUpdate()
      expect(update.error_hint).toEqual({ kind: "safety-block", class: "copyright", retried: false, subject: "input_video" })
      // The user-facing message is the sanitized one, as before.
      expect(update.error_message).toBe("The provider declined this generation.")
      expect(mocks.refundMock).toHaveBeenCalledWith("j-refused")
    })

    it("'File processing failed' on a job that sent a source video → the input-refused hint", async () => {
      mocks.pollKieTaskMock.mockRejectedValueOnce(await kieTaskFailure(FILE_FAILED))
      await reconcileKieJob(videoRow({ provider: "kling-o1-edit", videoUrl: "https://cdn.example/src.mp4" }))
      expect(failedUpdate().error_hint).toEqual({ kind: "input-refused", subject: "input_video" })
    })

    it("the copyright message on a job that sent no video → the plain copyright hint (no input-video subject)", async () => {
      mocks.pollKieTaskMock.mockRejectedValueOnce(await kieTaskFailure(COPYRIGHT_VIDEO))
      await reconcileKieJob(videoRow({ provider: "seedance-2", imageUrl: "https://cdn.example/a.png" }))
      expect(failedUpdate().error_hint).toEqual({ kind: "safety-block", class: "copyright", retried: false })
    })

    it("'File processing failed' on a job that sent no video → no hint", async () => {
      mocks.pollKieTaskMock.mockRejectedValueOnce(await kieTaskFailure(FILE_FAILED))
      await reconcileKieJob(videoRow({ provider: "seedance-2" }))
      expect(failedUpdate()).not.toHaveProperty("error_hint")
    })

    it("a failure that is not a refusal → no hint, even on a job that sent a video", async () => {
      mocks.pollKieTaskMock.mockRejectedValueOnce(await kieTaskFailure("internal error, please retry"))
      await reconcileKieJob(videoRow({ provider: "seedance-2", referenceVideoUrls: ["https://cdn.example/src.mp4"] }))
      expect(failedUpdate()).not.toHaveProperty("error_hint")
    })

    it("a row without input_data (legacy caller) still fails cleanly with the class hint only", async () => {
      mocks.pollKieTaskMock.mockRejectedValueOnce(await kieTaskFailure(COPYRIGHT_VIDEO))
      await reconcileKieJob({ ...videoRow({}), input_data: undefined })
      expect(failedUpdate().error_hint).toEqual({ kind: "safety-block", class: "copyright", retried: false })
    })

    it("a Suno content-policy failure carries its plain hint too", async () => {
      mocks.pollSunoTaskMock.mockRejectedValueOnce(
        await kieTaskFailure("The lyrics contain copyrighted material (copyright)."),
      )
      await reconcileKieJob({
        id: "j-suno-refused",
        provider_kind: "kie-suno",
        provider_task_id: "t-suno-refused",
        reconcile_attempts: 0,
        job_type: "suno-generate",
        input_data: { provider: "suno-v5" },
      })
      expect(failedUpdate().error_hint).toEqual({ kind: "safety-block", class: "copyright", retried: false })
    })
  })

  it("still-running (timeout error) → bumps reconcile_attempts, no finalize, no refund", async () => {
    mocks.pollKieTaskMock.mockRejectedValueOnce(
      new Error("task timed out after 1 poll attempts"),
    )
    const row: KieJobRow = {
      id: "j-pending",
      provider_kind: "kie-standard",
      provider_task_id: "t-pending",
      reconcile_attempts: 5,
      job_type: "generate-image",
    }
    mocks.jobsSingleMock.mockResolvedValueOnce({
      data: { reconcile_attempts: 5 },
      error: null,
    })
    await reconcileKieJob(row)
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
    // bumpAttempts read the current value + wrote +1
    expect(mocks.jobsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ reconcile_attempts: 6 }),
    )
  })

  it("missing provider_task_id → no-op (returns without polling)", async () => {
    const row: KieJobRow = {
      id: "j-no-task",
      provider_kind: "kie-standard",
      provider_task_id: null,
      reconcile_attempts: 0,
      job_type: "generate-image",
    }
    await reconcileKieJob(row)
    expect(mocks.pollKieTaskMock).not.toHaveBeenCalled()
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
  })

  it("unknown provider_kind → bumps attempts, no failure marked", async () => {
    const row: KieJobRow = {
      id: "j-unknown",
      provider_kind: "kie-mysterious",
      provider_task_id: "t-1",
      reconcile_attempts: 0,
      job_type: "generate-image",
    }
    await reconcileKieJob(row)
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
    expect(mocks.jobsUpdateMock).toHaveBeenCalled()
  })

  it("kie-suno with unrecoverable variant (job_type=suno-lyrics) → bumps attempts", async () => {
    const row: KieJobRow = {
      id: "j-suno-lyrics",
      provider_kind: "kie-suno",
      provider_task_id: "t-suno",
      reconcile_attempts: 0,
      job_type: "suno-lyrics",
    }
    await reconcileKieJob(row)
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
    expect(mocks.jobsUpdateMock).toHaveBeenCalled()
  })

  it("a suno-separate row is never polled — bump/exhaust only, whichever lane's task id it holds", async () => {
    // Suno Separate registers BOTH its lanes' task ids (the old vocal-removal
    // endpoint and the market jobs/createTask endpoint) as kie-suno. Polling
    // either with the wrong endpoint, or through a single-URL kind, could
    // "complete" the job with one URL and no stems; a crash must instead ride
    // to exhaustion → refund.
    const row: KieJobRow = {
      id: "j-suno-separate",
      provider_kind: "kie-suno",
      provider_task_id: "market-task-x",
      reconcile_attempts: 0,
      job_type: "suno-separate",
    }
    await reconcileKieJob(row)
    expect(mocks.pollSunoTaskMock).not.toHaveBeenCalled()
    expect(mocks.pollKieTaskMock).not.toHaveBeenCalled()
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
    const bumpCall = mocks.jobsUpdateMock.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).reconcile_attempts === 1,
    )
    expect(bumpCall).toBeTruthy()
  })

  // -------------------------------------------------------------------------
  // Post-poll failures MUST bump reconcile_attempts (P0.1, audit Blocker B1).
  // Before this, a poll-success-but-finalize-failure propagated to the cron's
  // per-row catch (errors++ only) — a deterministic upload failure looped at
  // every tick FOREVER: charged user, credits stranded `reserved`, no refund,
  // no anomaly row. Bumping routes it into the 18-attempt exhaustion path
  // (forceFailExhausted → refund + credit_anomalies), which terminates.
  // -------------------------------------------------------------------------
  it("kie-standard: finalize throws → bumps reconcile_attempts, no markFailed, no refund, no propagation", async () => {
    mocks.pollKieTaskMock.mockResolvedValueOnce({
      resultJson: { resultUrls: ["https://kie.example/r.png"] },
      providerMs: 1000,
      taskId: "t-fin",
    })
    mocks.finalizeMock.mockRejectedValueOnce(new Error("R2 upload failed"))
    const row: KieJobRow = {
      id: "j-finalize-throw",
      provider_kind: "kie-standard",
      provider_task_id: "t-fin",
      reconcile_attempts: 0,
      job_type: "generate-image",
    }

    await expect(reconcileKieJob(row)).resolves.toBeUndefined()

    expect(mocks.refundMock).not.toHaveBeenCalled()
    const bumpCall = mocks.jobsUpdateMock.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).reconcile_attempts === 1,
    )
    expect(bumpCall).toBeTruthy()
    expect(String((bumpCall![0] as Record<string, unknown>).reconcile_last_error)).toContain(
      "R2 upload failed",
    )
    const failCall = mocks.jobsUpdateMock.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).status === "failed",
    )
    expect(failCall).toBeUndefined()
  })

  it("kie-suno music success → finalizes with providerUsed 'kie', matching the worker path (#753)", async () => {
    mocks.pollSunoTaskMock.mockResolvedValueOnce({
      taskId: "t-suno-ok",
      tracks: [
        { id: "tr1", title: "Track", duration: 30, imageUrl: "", audioUrl: "https://suno.example/a.mp3" },
      ],
    })
    mocks.uploadToR2Mock.mockResolvedValueOnce("https://r2.example/audio/j-suno-ok.mp3")
    mocks.finalizeMock.mockResolvedValueOnce({ ok: true })
    const row: KieJobRow = {
      id: "j-suno-ok",
      provider_kind: "kie-suno",
      provider_task_id: "t-suno-ok",
      reconcile_attempts: 0,
      job_type: "suno-generate",
    }

    await reconcileKieJob(row)

    expect(mocks.finalizeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "j-suno-ok",
        // The SERVING provider — the same value the worker's KIE path writes.
        // "suno" here used to split attribution across three values.
        result: expect.objectContaining({ providerUsed: "kie" }),
      }),
    )
  })

  it("kie-suno music: track upload throws → bumps reconcile_attempts, no finalize, no refund", async () => {
    mocks.pollSunoTaskMock.mockResolvedValueOnce({
      taskId: "t-suno-up",
      tracks: [
        { id: "tr1", title: "Track", duration: 30, imageUrl: "", audioUrl: "https://suno.example/a.mp3" },
      ],
    })
    // Generic transient failure — upload-size-exceeded now fast-fails
    // deterministically on the first bump (bump-attempts.test.ts).
    mocks.uploadToR2Mock.mockRejectedValueOnce(new Error("R2 503: service unavailable"))
    const row: KieJobRow = {
      id: "j-suno-upload-throw",
      provider_kind: "kie-suno",
      provider_task_id: "t-suno-up",
      reconcile_attempts: 0,
      job_type: "suno-generate",
    }

    await expect(reconcileKieJob(row)).resolves.toBeUndefined()

    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
    const bumpCall = mocks.jobsUpdateMock.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).reconcile_attempts === 1,
    )
    expect(bumpCall).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// pollAttempts threading (stall-guard resume polling, incident 2026-07-15)
// ---------------------------------------------------------------------------
//
// The worker's stall re-pick (inline reconcile) runs INSIDE a live BullMQ
// handler, so it can afford to RESUME polling a still-running upstream task
// with a full attempt budget instead of the cron's one-shot probe. Without
// this, a job re-picked while the provider is still generating gets one
// failed probe, a bumped attempt counter, and then waits for the cron's
// 20-minute staleness threshold — the exact UX hole the drain fix closes.
describe("reconcileKieJob pollAttempts threading", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.finalizeMock.mockResolvedValue({ ok: true })
    mocks.jobsSingleMock.mockResolvedValue({ data: { reconcile_attempts: 0 }, error: null })
  })

  const successPoll = {
    resultJson: { resultUrls: ["https://kie.example/r.png"] },
    taskId: "t-poll",
  }

  it("kie-standard: opts.pollAttempts is forwarded to pollKieTask", async () => {
    mocks.pollKieTaskMock.mockResolvedValueOnce(successPoll)
    await reconcileKieJob(
      { id: "j-pa", provider_kind: "kie-standard", provider_task_id: "t-pa", reconcile_attempts: 0, job_type: "generate-image" },
      { claimant: "worker", pollAttempts: 120 },
    )
    expect(mocks.pollKieTaskMock).toHaveBeenCalledWith("t-pa", 120)
  })

  it("kie-standard: defaults to a single probe when opts.pollAttempts is absent (cron path unchanged)", async () => {
    mocks.pollKieTaskMock.mockResolvedValueOnce(successPoll)
    await reconcileKieJob(
      { id: "j-pa-default", provider_kind: "kie-standard", provider_task_id: "t-pa1", reconcile_attempts: 0, job_type: "generate-image" },
    )
    expect(mocks.pollKieTaskMock).toHaveBeenCalledWith("t-pa1", 1)
  })

  it("kie-kontext + kie-luma: pollAttempts forwarded to their pollers too", async () => {
    mocks.pollKontextTaskMock.mockResolvedValueOnce(successPoll)
    await reconcileKieJob(
      { id: "j-kontext", provider_kind: "kie-kontext", provider_task_id: "t-k", reconcile_attempts: 0, job_type: "generate-image" },
      { claimant: "worker", pollAttempts: 60 },
    )
    expect(mocks.pollKontextTaskMock).toHaveBeenCalledWith("t-k", 60)

    mocks.pollLumaTaskMock.mockResolvedValueOnce(successPoll)
    await reconcileKieJob(
      { id: "j-luma", provider_kind: "kie-luma", provider_task_id: "t-l", reconcile_attempts: 0, job_type: "image-to-video" },
      { claimant: "worker", pollAttempts: 60 },
    )
    expect(mocks.pollLumaTaskMock).toHaveBeenCalledWith("t-l", 60)
  })
})

// ---------------------------------------------------------------------------
// NOT_GENERIC_RECOVERABLE (Task 4, B2b): DAG-node-type, entity-handler, and
// unknown/NULL job_type rows must bump reconcile_attempts with a NAMED reason
// instead of being cast into finalizeJobWithMedia (the old
// `(row.job_type ?? "generate-image") as FinalizeJobType`), which threw
// "unknown jobType" and rode the exhaustion path to a bogus refund.
//
// G-7 harness note: this file has no `bumpMock`/`lastBumpReason` — only
// fal.test.ts mocks `../bump-attempts.js`. Rather than invent a second,
// parallel bump-attempts harness here, `bumpAttemptsOrExhaust` stays the REAL
// implementation (as it already is for every other test in this file) and
// `lastBumpReason` reads the reason back off the same `jobsUpdateMock` every
// other test in this file already asserts against.
// ---------------------------------------------------------------------------
describe("NOT_GENERIC_RECOVERABLE rows", () => {
  const row = (over: Partial<KieJobRow> = {}): KieJobRow => ({
    id: "j-row",
    provider_kind: "kie-standard",
    provider_task_id: "t-row",
    reconcile_attempts: 0,
    job_type: "generate-image",
    ...over,
  })

  const lastJobsUpdate = (): Record<string, unknown> =>
    (mocks.jobsUpdateMock.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined) ?? {}

  const lastBumpReason = (): string => {
    const last = lastJobsUpdate()
    return typeof last.reconcile_last_error === "string" ? last.reconcile_last_error : ""
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.finalizeMock.mockResolvedValue({ ok: true })
    mocks.refundMock.mockResolvedValue(undefined)
    mocks.jobsSingleMock.mockResolvedValue({ data: { reconcile_attempts: 0 }, error: null })
    // The guard sits AFTER the poll (M-4a), so every test here except the
    // "still fails fast" one needs the poll to succeed to reach it.
    mocks.pollKieTaskMock.mockResolvedValue({
      resultJson: { resultUrls: ["https://kie.example/should-not-reach-finalize.png"] },
      providerMs: 100,
      taskId: "t-default",
    })
  })

  it("bumps with a named reason instead of calling finalize for a DAG character row", async () => {
    await reconcileKieJob(row({
      id: "job-dag-char",
      provider_kind: "kie-standard",
      provider_task_id: "task-dag-char",
      job_type: "character",
    }))
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    // The poll DOES run — the guard sits after it on purpose (M-4a), so a
    // genuinely-failed provider task still fails fast + refunds on tick 1.
    expect(mocks.pollKieTaskMock).toHaveBeenCalled()
    expect(lastBumpReason()).toMatch(/not generically recoverable: character/)
  })

  it("still fails fast and refunds when the provider task itself failed", async () => {
    mocks.pollKieTaskMock.mockRejectedValue(
      new mocks.FakeKieError("Generation failed. Please try again.", true),
    )
    await reconcileKieJob(row({
      id: "job-dag-char-failed",
      provider_kind: "kie-standard",
      provider_task_id: "task-dag-char-failed",
      job_type: "character",
    }))
    // This is what the after-the-poll placement buys: tick 1 instead of 18.
    expect(mocks.refundMock).toHaveBeenCalled()
    expect(lastJobsUpdate().status).toBe("failed")
  })

  it("RECOVERS a route-origin generate-character row instead of bumping it", async () => {
    // This case used to assert the opposite — "bumps with a named reason" —
    // which is the 2026-09-03/09-07 incident written down as a passing test:
    // the provider had already produced the image, and riding the bump to 18
    // attempts refunded the user ~90 minutes later with nothing to show. The
    // entity studios keep their own completion writer; the reconciler now runs
    // THAT writer (lib/entity-finalize.ts) instead of discarding the result.
    mocks.pollKieTaskMock.mockResolvedValue({
      resultJson: { resultUrls: ["https://cdn.example/char.png"] },
      providerMs: 120,
    })
    await reconcileKieJob(row({
      id: "job-entity-char",
      provider_kind: "kie-standard",
      provider_task_id: "task-entity-char",
      job_type: "generate-character",
    }))
    expect(mocks.recoverEntityMock).toHaveBeenCalledWith({
      jobId: "job-entity-char",
      jobType: "generate-character",
      url: "https://cdn.example/char.png",
      claimant: "cron",
    })
    // Neither the generic finalize (which writes none of the studio rows) nor
    // the bump-toward-refund may fire.
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(lastBumpReason()).toBe("")
  })

  it("bumps the recovery, rather than swallowing it, when the entity tail throws", async () => {
    mocks.pollKieTaskMock.mockResolvedValue({
      resultJson: { resultUrls: ["https://cdn.example/char.png"] },
      providerMs: 120,
    })
    mocks.recoverEntityMock.mockRejectedValueOnce(new Error("r2 upload exploded"))
    await reconcileKieJob(row({
      id: "job-entity-throw",
      provider_kind: "kie-standard",
      provider_task_id: "task-entity-throw",
      job_type: "generate-character",
    }))
    expect(lastBumpReason()).toMatch(/r2 upload exploded/)
  })

  it("bumps rather than finalizing as an image when job_type is null", async () => {
    await reconcileKieJob(row({
      id: "job-null-type",
      provider_kind: "kie-standard",
      provider_task_id: "task-null-type",
      job_type: null,
    }))
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(lastBumpReason()).toMatch(/unknown job_type/)
  })

  it("still finalizes a genuine media row", async () => {
    mocks.pollKieTaskMock.mockResolvedValue({
      resultJson: { resultUrls: ["https://cdn.example/out.png"] },
      providerMs: 50,
      taskId: "t-img",
    })
    await reconcileKieJob(row({
      id: "job-img",
      provider_kind: "kie-standard",
      provider_task_id: "task-img",
      job_type: "generate-image",
    }))
    expect(mocks.finalizeMock).toHaveBeenCalledWith(expect.objectContaining({ jobType: "generate-image" }))
  })

  it("logs one line when the cron fails a job, so a burst is traceable in Railway", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.pollKieTaskMock.mockRejectedValue(
      new mocks.FakeKieError("Generation failed. Please try again.", true),
    )
    await reconcileKieJob(row({
      id: "job-silent-1",
      provider_kind: "kie-standard",
      provider_task_id: "task-silent-1",
      job_type: "generate-image",
    }))
    const lines = spy.mock.calls.map((c) => String(c[0]))
    expect(lines.some((l) => l.includes("[reconcile/kie]") && l.includes("job-silent-1"))).toBe(true)
    spy.mockRestore()
  })
})
