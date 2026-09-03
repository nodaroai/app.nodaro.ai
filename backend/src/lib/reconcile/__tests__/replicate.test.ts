import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const fetchMock = vi.fn()
  const finalizeMock = vi.fn().mockResolvedValue({ ok: true })
  const refundMock = vi.fn().mockResolvedValue(undefined)
  const jobsSingleMock = vi.fn().mockResolvedValue({
    data: { reconcile_attempts: 0 },
    error: null,
  })
  const jobsSelectEqMock = vi.fn(() => ({ single: jobsSingleMock }))
  const jobsSelectMock = vi.fn(() => ({ eq: jobsSelectEqMock }))
  const jobsUpdateNeqMock = vi.fn().mockResolvedValue({ data: null, error: null })
  // markJobFailed (lib/job-failure.ts) ends its CAS with `.select("id")` and
  // reads the returned rows to answer "did WE flip it?" — the mock must model
  // that or every migrated writer sees a lost race.
  const jobsUpdateCasSelectMock = vi.fn().mockResolvedValue({ data: [{ id: "j-1" }], error: null })
  const jobsUpdateInMock = vi.fn(() => ({ select: jobsUpdateCasSelectMock }))
  // G-7: capture every jobs.update(payload) so tests can assert on the exact
  // recorded update (lastJobsUpdate below), not just individual fields.
  const jobsUpdates: Array<Record<string, unknown>> = []
  // Fix round 1: applyTrainingTerminalStatus's jobs update chains a SECOND
  // .eq() before .not() (`.eq("id",jobId).eq("user_id",...).not(...)`) —
  // distinct from markFailed's `.eq("id",jobId).in("status",[...])`. The
  // object returned for col==="id" supports both chain shapes.
  // The TRAINING branch scopes its writes `.eq("id").eq("user_id")` and then
  // filters on status. It used a NEGATIVE filter (`.not("status","in",
  // "(completed,failed,cancelled)")`) which matches `pending_review` — spec
  // §17.1 tightens exactly these two writes to a positive `.in`.
  const jobsTrainingNotMock = vi.fn().mockResolvedValue({ data: null, error: null })
  const jobsTrainingInMock = vi.fn().mockResolvedValue({ data: null, error: null })
  const jobsUpdateSecondEqMock = vi.fn(() => ({
    not: jobsTrainingNotMock,
    in: jobsTrainingInMock,
  }))
  const jobsUpdateMock = vi.fn((arg: Record<string, unknown>) => {
    jobsUpdates.push(arg)
    return {
      eq: vi.fn((col: string, _val: string) => {
        if (col === "id") {
          // markFailed now CAS-guards with .in("status",[...]) (M6-consistent),
          // older sites used .neq("status","cancelled") — support both terminals.
          return Object.assign(
            Promise.resolve({ data: null, error: null }),
            { neq: jobsUpdateNeqMock, in: jobsUpdateInMock, eq: jobsUpdateSecondEqMock },
          )
        }
        return { neq: jobsUpdateNeqMock, in: jobsUpdateInMock, eq: jobsUpdateSecondEqMock }
      }),
    }
  })

  // Fix round 1: `characters` table mocks for applyTrainingTerminalStatus's
  // terminal (failed/canceled) branch — findCharacterForTraining's
  // `.select(...).eq(...).limit(1).single()` and the characters `.update(...)
  // .eq(...).eq(...).not(...)` write.
  const character: Record<string, unknown> = {
    id: "char-1",
    user_id: "user-1",
    lora_training_replicate_id: "tr-fail-1",
    deleted_at: null,
  }
  const charactersSingleMock = vi.fn(() => Promise.resolve({ data: character, error: null }))
  const charactersSelectMock = vi.fn(() => ({
    eq: vi.fn(() => ({ limit: vi.fn(() => ({ single: charactersSingleMock })) })),
  }))
  const charactersUpdates: Array<Record<string, unknown>> = []
  const charactersUpdateMock = vi.fn((arg: Record<string, unknown>) => {
    charactersUpdates.push(arg)
    return { eq: vi.fn(() => ({ eq: vi.fn(() => ({ not: vi.fn().mockResolvedValue({ data: null, error: null }) })) })) }
  })

  const fromMock = vi.fn((table: string) => {
    if (table === "characters") {
      return { select: charactersSelectMock, update: charactersUpdateMock }
    }
    return {
      select: jobsSelectMock,
      update: jobsUpdateMock,
    }
  })

  // Task 6 (transcribe recovery): markJobCompleted/commitJobCredits are
  // mocked out entirely (same pattern as elevenlabs.test.ts) — the real
  // implementations reach ee/ billing code and a `usage_logs` query shape
  // this file's generic jobs-table mock doesn't model, and none of that is
  // what these tests are checking (they assert on the jobs.update() the
  // reconcile branch itself drives via markJobCompleted's arguments).
  const markCompletedMock = vi.fn().mockResolvedValue(true)
  const commitMock = vi.fn().mockResolvedValue(undefined)
  // loadUsageLogId is a real (unmocked-by-default) job-finalize.js export —
  // stubbed here for the same reason: its `usage_logs` lookup shape isn't
  // what these tests exercise.
  const loadUsageLogIdMock = vi.fn().mockResolvedValue("usage-log-tr-1")

  return {
    fetchMock,
    finalizeMock,
    refundMock,
    fromMock,
    jobsSingleMock,
    jobsUpdateMock,
    jobsUpdateNeqMock,
    jobsUpdateInMock,
    jobsTrainingNotMock,
    jobsTrainingInMock,
    jobsUpdates,
    charactersUpdates,
    character,
    markCompletedMock,
    commitMock,
    loadUsageLogIdMock,
    // G-7: the prediction the mocked fetch/prediction fetcher resolves with,
    // set per-test via setPrediction below.
    prediction: null as Record<string, unknown> | null,
  }
})

vi.mock("../../supabase.js", () => ({ supabase: { from: mocks.fromMock } }))
vi.mock("../../job-finalize.js", async (importOriginal) => {
  // isFinalizeJobType + NOT_GENERIC_RECOVERABLE are pure lookups over static
  // sets — keep the REAL ones so the narrowing under test is the real thing,
  // not a re-declared copy that could drift from job-finalize.ts.
  const actual = await importOriginal<typeof import("../../job-finalize.js")>()
  return { ...actual, finalizeJobWithMedia: mocks.finalizeMock, loadUsageLogId: mocks.loadUsageLogIdMock }
})
vi.mock("../../credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: mocks.refundMock }))
vi.mock("../../config.js", () => ({ config: { REPLICATE_API_TOKEN: "test-token" } }))
vi.mock("../../../workers/shared.js", () => ({
  markJobCompleted: mocks.markCompletedMock,
  commitJobCredits: mocks.commitMock,
}))

import { reconcileReplicateJob, type ReplicateJobRow } from "../replicate.js"

// G-7 harness accessors (did not exist before this task).
const lastJobsUpdate = (): Record<string, unknown> => mocks.jobsUpdates.at(-1) ?? {}
const lastCharactersUpdate = (): Record<string, unknown> => mocks.charactersUpdates.at(-1) ?? {}
const setPrediction = (p: Record<string, unknown>) => {
  mocks.prediction = p
}

// Task 6: shared row builder for the "transcribe recovery" describe block,
// mirroring elevenlabs.test.ts's `row()` helper.
function row(overrides: Partial<ReplicateJobRow> = {}): ReplicateJobRow {
  return {
    id: "j-tr",
    provider_kind: "replicate-prediction",
    provider_task_id: "pred-tr",
    reconcile_attempts: 0,
    job_type: "transcribe",
    ...overrides,
  }
}

describe("reconcileReplicateJob", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mocks.fetchMock as unknown as typeof fetch
    mocks.finalizeMock.mockResolvedValue({ ok: true })
    mocks.jobsSingleMock.mockResolvedValue({ data: { reconcile_attempts: 0 }, error: null })
    mocks.markCompletedMock.mockResolvedValue(true)
    mocks.commitMock.mockResolvedValue(undefined)
    mocks.loadUsageLogIdMock.mockResolvedValue("usage-log-tr-1")
    mocks.jobsUpdates.length = 0
    mocks.charactersUpdates.length = 0
    mocks.prediction = null
    // Default fetch behavior reads whatever setPrediction() last set. Tests
    // that need finer control over the raw HTTP response (non-ok, etc.) still
    // override with mockResolvedValueOnce, which takes priority per-call.
    mocks.fetchMock.mockImplementation(async () => ({
      ok: true,
      json: async () => mocks.prediction,
    }))
  })

  it("succeeded with output URL → finalizes with the URL", async () => {
    mocks.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "p-1",
        status: "succeeded",
        output: "https://replicate.example/result.png",
        metrics: { predict_time: 4.5 },
      }),
    })
    const row: ReplicateJobRow = {
      id: "j-r",
      provider_kind: "replicate-prediction",
      provider_task_id: "p-1",
      reconcile_attempts: 0,
      job_type: "generate-image",
    }
    await reconcileReplicateJob(row)
    expect(mocks.finalizeMock).toHaveBeenCalledWith({
      jobId: "j-r",
      jobType: "generate-image",
      claimant: "cron",
      result: expect.objectContaining({
        url: "https://replicate.example/result.png",
        providerUsed: "replicate",
        providerMs: 4500,
      }),
    })
  })

  it("succeeded with output array → uses first URL + extras", async () => {
    mocks.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "p-2",
        status: "succeeded",
        output: ["https://r.example/v0.png", "https://r.example/v1.png"],
      }),
    })
    const row: ReplicateJobRow = {
      id: "j-r2",
      provider_kind: "replicate-prediction",
      provider_task_id: "p-2",
      reconcile_attempts: 0,
      job_type: "generate-image",
    }
    await reconcileReplicateJob(row)
    expect(mocks.finalizeMock).toHaveBeenCalledWith({
      jobId: "j-r2",
      jobType: "generate-image",
      claimant: "cron",
      result: expect.objectContaining({
        url: "https://r.example/v0.png",
        extraUrls: ["https://r.example/v1.png"],
      }),
    })
  })

  it("failed status → markFailed + refund", async () => {
    mocks.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "p-fail",
        status: "failed",
        error: "model crashed",
      }),
    })
    const row: ReplicateJobRow = {
      id: "j-fail",
      provider_kind: "replicate-prediction",
      provider_task_id: "p-fail",
      reconcile_attempts: 0,
      job_type: "generate-image",
    }
    await reconcileReplicateJob(row)
    expect(mocks.refundMock).toHaveBeenCalledWith("j-fail")
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    // Spec D11: the shared markJobFailed CAS. "queued" is newly failable (these
    // sweeps could not take a queued row at all before); "pending_review" is
    // absent BY CONSTRUCTION, so no reconcile tick can fail a job under review.
    expect(mocks.jobsUpdateInMock).toHaveBeenCalledWith("status", ["pending", "queued", "processing"])
  })

  it("canceled status → markFailed + refund", async () => {
    mocks.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "p-c", status: "canceled" }),
    })
    const row: ReplicateJobRow = {
      id: "j-c",
      provider_kind: "replicate-prediction",
      provider_task_id: "p-c",
      reconcile_attempts: 0,
      job_type: "generate-image",
    }
    await reconcileReplicateJob(row)
    expect(mocks.refundMock).toHaveBeenCalledWith("j-c")
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
  })

  it("starting status → bumpAttempts, no finalize, no refund", async () => {
    mocks.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "p-s", status: "starting" }),
    })
    mocks.jobsSingleMock.mockResolvedValueOnce({
      data: { reconcile_attempts: 3 },
      error: null,
    })
    const row: ReplicateJobRow = {
      id: "j-s",
      provider_kind: "replicate-prediction",
      provider_task_id: "p-s",
      reconcile_attempts: 3,
      job_type: "generate-image",
    }
    await reconcileReplicateJob(row)
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
    expect(mocks.jobsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ reconcile_attempts: 4 }),
    )
  })

  it("fetch failure → bumpAttempts (HTTP error)", async () => {
    mocks.fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({}),
    })
    const row: ReplicateJobRow = {
      id: "j-err",
      provider_kind: "replicate-prediction",
      provider_task_id: "p-err",
      reconcile_attempts: 0,
      job_type: "generate-image",
    }
    await reconcileReplicateJob(row)
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
    expect(mocks.jobsUpdateMock).toHaveBeenCalled()
  })

  it("missing provider_task_id → no-op", async () => {
    const row: ReplicateJobRow = {
      id: "j-no",
      provider_kind: "replicate-prediction",
      provider_task_id: null,
      reconcile_attempts: 0,
      job_type: "generate-image",
    }
    await reconcileReplicateJob(row)
    expect(mocks.fetchMock).not.toHaveBeenCalled()
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
  })

  it("replicate-training still-running → bumps attempts, no fetch character", async () => {
    mocks.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "processing" }),
    })
    const row: ReplicateJobRow = {
      id: "j-tr",
      provider_kind: "replicate-training",
      provider_task_id: "tr-1",
      reconcile_attempts: 0,
      job_type: "character-lora-training",
    }
    await reconcileReplicateJob(row)
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1)
    expect(mocks.fetchMock.mock.calls[0]![0]).toContain("/v1/trainings/tr-1")
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
  })

  // Fix round 1: applyTrainingTerminalStatus wrote raw remote.error straight
  // into jobs.error_message AND characters.lora_training_error — the second
  // is read directly by the owner via GET /v1/character-training/:id/status.
  // Both must now carry the same redacted/generic text (M-2b).
  it("replicate-training failed → sanitizes error_message + lora_training_error, keeps raw text in error_detail", async () => {
    setPrediction({
      status: "failed",
      error: "CUDA driver crash https://replicate.delivery/pbxt/x/log.txt?token=zz",
    })
    const row: ReplicateJobRow = {
      id: "job-train-fail",
      provider_kind: "replicate-training",
      provider_task_id: "tr-fail-1", // matches mocks.character.lora_training_replicate_id
      reconcile_attempts: 0,
      job_type: "character-lora-training",
    }
    await reconcileReplicateJob(row)

    const jobUpdate = lastJobsUpdate()
    expect(jobUpdate.status).toBe("failed")
    expect(jobUpdate.error_message).toBe("Character training failed. Please try again.")
    expect(jobUpdate.error_message).not.toContain("token=")
    expect(jobUpdate.error_message).not.toMatch(/https?:\/\//)
    expect(jobUpdate.error_detail).toContain("CUDA driver crash")
    expect(jobUpdate.error_detail).not.toContain("token=zz")

    const charUpdate = lastCharactersUpdate()
    expect(charUpdate.lora_training_status).toBe("failed")
    expect(charUpdate.lora_training_error).toContain("CUDA driver crash")
    expect(charUpdate.lora_training_error).not.toContain("token=")

    expect(mocks.refundMock).toHaveBeenCalledWith("job-train-fail")

    // Spec §17.1: the negative `.not("status","in","(completed,failed,cancelled)")`
    // filter MATCHES a pending_review row. The failed arm goes through
    // markJobFailed, whose CAS is positive and cannot.
    expect(mocks.jobsUpdateInMock).toHaveBeenCalledWith("status", ["pending", "queued", "processing"])
    expect(mocks.jobsTrainingNotMock).not.toHaveBeenCalled()
  })

  it("replicate-training canceled → sanitizes error_message (cancel wording, no refund claim)", async () => {
    setPrediction({ status: "canceled", error: null })
    const row: ReplicateJobRow = {
      id: "job-train-cancel",
      provider_kind: "replicate-training",
      provider_task_id: "tr-fail-1",
      reconcile_attempts: 0,
      job_type: "character-lora-training",
    }
    await reconcileReplicateJob(row)

    const jobUpdate = lastJobsUpdate()
    expect(jobUpdate.status).toBe("cancelled")
    expect(jobUpdate.error_message).toBe("Character training was cancelled.")
    // A cancel is not a failure, so it stays a direct write — but its filter is
    // positive now, so it cannot cancel a job parked in review either (§17.1).
    expect(mocks.jobsTrainingInMock).toHaveBeenCalledWith("status", ["pending", "queued", "processing"])
    expect(mocks.jobsTrainingNotMock).not.toHaveBeenCalled()
  })

  // §17.1 + WS2's COMPLETED_ALLOWLIST: a LoRA training completion is a MODEL,
  // not a media publication — it stays a direct write (routing it through
  // markJobCompleted would run the result gate over an empty output). What it
  // must NOT keep is the negative status filter.
  it("replicate-training succeeded → completes with a positive status filter, never .not(TERMINAL)", async () => {
    setPrediction({ status: "succeeded", output: null, version: "nodaroai/char-1:abc" })
    await reconcileReplicateJob({
      id: "job-train-ok",
      provider_kind: "replicate-training",
      provider_task_id: "tr-fail-1",
      reconcile_attempts: 0,
      job_type: "character-lora-training",
    })
    expect(lastJobsUpdate().status).toBe("completed")
    expect(mocks.jobsTrainingInMock).toHaveBeenCalledWith("status", ["pending", "queued", "processing"])
    expect(mocks.jobsTrainingNotMock).not.toHaveBeenCalled()
  })

  it("succeeded with no output → markFailed + refund", async () => {
    mocks.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "p-empty", status: "succeeded", output: null }),
    })
    const row: ReplicateJobRow = {
      id: "j-empty",
      provider_kind: "replicate-prediction",
      provider_task_id: "p-empty",
      reconcile_attempts: 0,
      job_type: "generate-image",
    }
    await reconcileReplicateJob(row)
    expect(mocks.refundMock).toHaveBeenCalledWith("j-empty")
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
  })

  // P0.1 (audit Blocker B1): a poll-success-but-finalize-failure must bump
  // reconcile_attempts so a deterministic failure exhausts to refund+anomaly
  // instead of looping at every cron tick forever.
  it("succeeded but finalize throws → bumps reconcile_attempts, no markFailed, no refund, no propagation", async () => {
    mocks.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "p-fin",
        status: "succeeded",
        output: ["https://replicate.example/out.png"],
      }),
    })
    mocks.finalizeMock.mockRejectedValueOnce(new Error("R2 upload failed"))
    const row: ReplicateJobRow = {
      id: "j-finalize-throw",
      provider_kind: "replicate-prediction",
      provider_task_id: "p-fin",
      reconcile_attempts: 0,
      job_type: "generate-image",
    }

    await expect(reconcileReplicateJob(row)).resolves.toBeUndefined()

    expect(mocks.refundMock).not.toHaveBeenCalled()
    const bumpCall = mocks.jobsUpdateMock.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).reconcile_attempts === 1,
    )
    expect(bumpCall).toBeTruthy()
    const failCall = mocks.jobsUpdateMock.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).status === "failed",
    )
    expect(failCall).toBeUndefined()
  })

  // Task 2 (app-reports W4): jobs.error_message is user-visible (GET /v1/jobs/:id,
  // MCP job tools, the app-report sweep) — it must never carry raw provider text
  // (vendor stack fragments, signed URLs). The raw text belongs in error_detail
  // (admin-only), redacted through redactProviderDetail.
  it("puts a user-safe sentence in error_message and the raw provider text in error_detail", async () => {
    setPrediction({
      id: "pred-raw-1",
      status: "failed",
      error: "CUDA out of memory at https://replicate.delivery/pbxt/secret-path/out.mp4?token=abc",
    })
    const row: ReplicateJobRow = {
      id: "job-raw-1",
      provider_kind: "replicate-prediction",
      provider_task_id: "pred-raw-1",
      reconcile_attempts: 0,
      job_type: "generate-image",
    }
    await reconcileReplicateJob(row)
    const update = lastJobsUpdate()
    expect(update.status).toBe("failed")
    expect(update.error_message).toBe("Generation failed on the provider. Please try again.")
    expect(update.error_message).not.toContain("CUDA")
    expect(update.error_detail).toContain("CUDA out of memory")
    expect(update.error_detail).not.toContain("token=abc")
  })

  // Task 4 (B2b): DAG-node-type and unknown/NULL job_type rows must bump with
  // a named reason instead of being cast into finalizeJobWithMedia. Mirrors
  // the kie.ts twin — bump-attempts.js is NOT mocked here either, so
  // bumpAttemptsOrExhaust is the real implementation and lastJobsUpdate()
  // (already defined above for the error_message/error_detail assertions)
  // reads the bump reason straight off the same jobs.update() capture.
  describe("NOT_GENERIC_RECOVERABLE rows", () => {
    it("bumps with a named reason instead of finalizing a DAG scene row", async () => {
      mocks.fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "p-dag-scene",
          status: "succeeded",
          output: "https://replicate.example/dag-scene.png",
        }),
      })
      const row: ReplicateJobRow = {
        id: "j-dag-scene",
        provider_kind: "replicate-prediction",
        provider_task_id: "p-dag-scene",
        reconcile_attempts: 0,
        job_type: "scene",
      }
      await reconcileReplicateJob(row)
      expect(mocks.finalizeMock).not.toHaveBeenCalled()
      expect(lastJobsUpdate().reconcile_last_error).toMatch(/not generically recoverable: scene/)
    })

    it("bumps rather than finalizing as an image when job_type is null", async () => {
      mocks.fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "p-null-type",
          status: "succeeded",
          output: "https://replicate.example/null-type.png",
        }),
      })
      const row: ReplicateJobRow = {
        id: "j-null-type",
        provider_kind: "replicate-prediction",
        provider_task_id: "p-null-type",
        reconcile_attempts: 0,
        job_type: null,
      }
      await reconcileReplicateJob(row)
      expect(mocks.finalizeMock).not.toHaveBeenCalled()
      expect(lastJobsUpdate().reconcile_last_error).toMatch(/unknown job_type/)
    })

    it("still finalizes a genuine media row", async () => {
      mocks.fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "p-genuine",
          status: "succeeded",
          output: "https://replicate.example/genuine.png",
        }),
      })
      const row: ReplicateJobRow = {
        id: "j-genuine",
        provider_kind: "replicate-prediction",
        provider_task_id: "p-genuine",
        reconcile_attempts: 0,
        job_type: "generate-image",
      }
      await reconcileReplicateJob(row)
      expect(mocks.finalizeMock).toHaveBeenCalledWith(
        expect.objectContaining({ jobType: "generate-image" }),
      )
    })

    // Task 4 review ruling (in scope for Task 6): a NOT_GENERIC_RECOVERABLE
    // row whose prediction succeeded with an EMPTY output (empty string or
    // empty array — an object output, e.g. transcribe's shape, still counts
    // as "has output") must markFailed + refund immediately instead of
    // bumping for up to 18 ticks first.
    it("succeeded with EMPTY output on a NOT_GENERIC_RECOVERABLE row → markFailed + refund instead of bumping", async () => {
      mocks.fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "p-dag-empty",
          status: "succeeded",
          output: [],
        }),
      })
      const row: ReplicateJobRow = {
        id: "j-dag-empty",
        provider_kind: "replicate-prediction",
        provider_task_id: "p-dag-empty",
        reconcile_attempts: 0,
        job_type: "generate-character",
      }
      await reconcileReplicateJob(row)
      expect(mocks.finalizeMock).not.toHaveBeenCalled()
      const update = lastJobsUpdate()
      expect(update.status).toBe("failed")
      expect(update.error_detail).toContain("empty provider output for generate-character")
      expect(mocks.refundMock).toHaveBeenCalledWith("j-dag-empty")
    })

    it("succeeded with an EMPTY STRING output on a NOT_GENERIC_RECOVERABLE row → markFailed + refund instead of bumping", async () => {
      mocks.fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "p-dag-empty-str",
          status: "succeeded",
          output: "",
        }),
      })
      const row: ReplicateJobRow = {
        id: "j-dag-empty-str",
        provider_kind: "replicate-prediction",
        provider_task_id: "p-dag-empty-str",
        reconcile_attempts: 0,
        job_type: "generate-character",
      }
      await reconcileReplicateJob(row)
      expect(mocks.finalizeMock).not.toHaveBeenCalled()
      const update = lastJobsUpdate()
      expect(update.status).toBe("failed")
      expect(update.error_detail).toContain("empty provider output for generate-character")
      expect(mocks.refundMock).toHaveBeenCalledWith("j-dag-empty-str")
    })

    it("succeeded with an OBJECT output on a NOT_GENERIC_RECOVERABLE row → still bumps (object output counts as 'has output')", async () => {
      mocks.fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "p-dag-object",
          status: "succeeded",
          output: {},
        }),
      })
      const row: ReplicateJobRow = {
        id: "j-dag-object",
        provider_kind: "replicate-prediction",
        provider_task_id: "p-dag-object",
        reconcile_attempts: 0,
        job_type: "generate-character",
      }
      await reconcileReplicateJob(row)
      expect(mocks.finalizeMock).not.toHaveBeenCalled()
      expect(lastJobsUpdate().reconcile_last_error).toMatch(/not generically recoverable/)
      expect(mocks.refundMock).not.toHaveBeenCalled()
    })
  })

  // Task 6 (app-reports W4): transcribe's completion writer is {text,
  // language, segments} (audio-ai.ts:279), not a media URL — so a stalled
  // prediction must be recovered through mapWhisperOutput/mapFastWhisperOutput
  // + markJobCompleted, never through the generic finalizeJobWithMedia path.
  describe("transcribe recovery", () => {
    it("completes a succeeded whisper prediction with its transcript instead of failing it", async () => {
      setPrediction({
        id: "pred-tr-1",
        status: "succeeded",
        output: { transcription: "recovered text", detected_language: "english", segments: [] },
        metrics: { predict_time: 4 },
      })
      await reconcileReplicateJob(row({
        id: "job-tr-1",
        provider_kind: "replicate-prediction",
        provider_task_id: "pred-tr-1",
        job_type: "transcribe",
        input_data: { provider: "whisper" },
      }))
      expect(mocks.finalizeMock).not.toHaveBeenCalled()
      expect(mocks.refundMock).not.toHaveBeenCalled()
      expect(mocks.markCompletedMock).toHaveBeenCalledWith(
        "job-tr-1",
        expect.objectContaining({
          output_data: expect.objectContaining({ text: "recovered text", language: "english" }),
        }),
      )
      // Pin the usage-log lookup to THIS job — a wrong-job lookup (e.g. a
      // copy-paste bug passing some other id) must not silently pass.
      expect(mocks.loadUsageLogIdMock).toHaveBeenCalledWith("job-tr-1")
      expect(mocks.commitMock).toHaveBeenCalledWith("usage-log-tr-1", "job-tr-1")
    })

    it("fails a genuinely empty transcribe prediction honestly", async () => {
      setPrediction({ id: "pred-tr-2", status: "succeeded", output: null })
      await reconcileReplicateJob(row({
        id: "job-tr-2",
        provider_kind: "replicate-prediction",
        provider_task_id: "pred-tr-2",
        job_type: "transcribe",
        input_data: { provider: "whisper" },
      }))
      const update = lastJobsUpdate()
      expect(update.status).toBe("failed")
      expect(update.error_message).toMatch(/could not be read|no transcript/i)
      expect(mocks.refundMock).toHaveBeenCalledWith("job-tr-2")
      expect(mocks.markCompletedMock).not.toHaveBeenCalled()
    })

    it("routes incredibly-fast-whisper output through mapFastWhisperOutput with the row's language", async () => {
      setPrediction({
        id: "pred-tr-3",
        status: "succeeded",
        output: { text: "fast recovered", chunks: [{ timestamp: [0, 1], text: "fast recovered" }] },
      })
      await reconcileReplicateJob(row({
        id: "job-tr-3",
        provider_kind: "replicate-prediction",
        provider_task_id: "pred-tr-3",
        job_type: "transcribe",
        input_data: { provider: "incredibly-fast-whisper", language: "fr" },
      }))
      expect(mocks.markCompletedMock).toHaveBeenCalledWith(
        "job-tr-3",
        expect.objectContaining({
          output_data: expect.objectContaining({ text: "fast recovered", language: "fr" }),
        }),
      )
      expect(mocks.refundMock).not.toHaveBeenCalled()
    })

    it("defaults to the whisper mapper when input_data carries no provider key", async () => {
      // routes/transcribe.ts stores `provider` only when the caller chose one
      // (z.enum(...).optional(), no default) — an absent key must fall back
      // to "whisper", matching transcribe.ts's own `provider ?? "whisper"`.
      setPrediction({
        id: "pred-tr-4",
        status: "succeeded",
        output: { transcription: "no provider key", detected_language: "en" },
      })
      await reconcileReplicateJob(row({
        id: "job-tr-4",
        provider_kind: "replicate-prediction",
        provider_task_id: "pred-tr-4",
        job_type: "transcribe",
        input_data: {},
      }))
      expect(mocks.markCompletedMock).toHaveBeenCalledWith(
        "job-tr-4",
        expect.objectContaining({
          output_data: expect.objectContaining({ text: "no provider key" }),
        }),
      )
    })
  })
})
