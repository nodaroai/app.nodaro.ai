/**
 * A stalled Nemotron 3.5 Transcribe job (its KIE task id saved under
 * `kie-standard` by the transcribe worker) is recovered from the task's
 * result — the SAME `output_data` the worker writes, the reserved tier
 * committed, KIE's cost recorded — never bumped toward the 90-minute
 * exhaustion that `NOT_GENERIC_RECOVERABLE` would give a transcribe row.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => {
  class FakeKieError extends Error {
    isUpstreamFailure = true
  }
  return {
    FakeKieError,
    pollKieTask: vi.fn(),
    safeFetch: vi.fn(),
    markJobCompleted: vi.fn().mockResolvedValue(true),
    commitJobCredits: vi.fn().mockResolvedValue(undefined),
    commitJobCreditsAtActualPrice: vi.fn().mockResolvedValue(undefined),
    markJobFailed: vi.fn().mockResolvedValue(true),
    refund: vi.fn().mockResolvedValue(undefined),
    bump: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock("../../supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../../providers/kie/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../providers/kie/client.js")>()),
  pollKieTask: m.pollKieTask,
  isUpstreamKieFailure: (err: unknown) => err instanceof m.FakeKieError,
}))
vi.mock("../../safe-fetch.js", () => ({ safeFetch: m.safeFetch }))
vi.mock("../../../workers/shared.js", () => ({
  markJobCompleted: m.markJobCompleted,
  commitJobCredits: m.commitJobCredits,
  commitJobCreditsAtActualPrice: m.commitJobCreditsAtActualPrice,
}))
vi.mock("../../job-finalize.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../job-finalize.js")>()),
  loadUsageLogId: async () => "usage-1",
  finalizeJobWithMedia: vi.fn(),
}))
vi.mock("../../job-failure.js", () => ({ markJobFailed: m.markJobFailed }))
vi.mock("../../credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: m.refund }))
vi.mock("../bump-attempts.js", () => ({ bumpAttemptsOrExhaust: m.bump }))

import { reconcileKieJob, type KieJobRow } from "../kie.js"

const RESULT_URL = "https://tempfile.aiquickdraw.com/js/y1/task.json"

function row(input: Record<string, unknown>): KieJobRow {
  return {
    id: "job-n",
    provider_kind: "kie-standard",
    provider_task_id: "task-1",
    reconcile_attempts: 0,
    job_type: "transcribe",
    input_data: { provider: "nemotron-3-5-transcribe", duration_seconds: 100, ...input },
  }
}

function fileResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

beforeEach(() => {
  vi.clearAllMocks()
  m.markJobCompleted.mockResolvedValue(true)
  m.markJobFailed.mockResolvedValue(true)
})

describe("reconcileKieJob — a stalled Nemotron transcription", () => {
  it("writes the worker's output_data from the finished task, records KIE's cost and commits the reserved tier", async () => {
    m.pollKieTask.mockResolvedValue({
      resultJson: { resultObject: { text: "Hi there.", duration: 120, url: RESULT_URL } },
      rawRecordInfo: { data: { creditsConsumed: 0.6 } },
    })
    m.safeFetch.mockResolvedValue(fileResponse({
      text: "Hi there.",
      duration: 120,
      words: [{ word: "Hi", start: 0, end: 0.3, speaker: "0" }, { word: "there.", start: 0.3, end: 0.8, speaker: "1" }],
    }))

    await reconcileKieJob(row({ wordTimestamps: true }))

    expect(m.markJobCompleted).toHaveBeenCalledWith("job-n", {
      output_data: expect.objectContaining({
        text: "Hi there.",
        language: "unknown",
        words: [expect.objectContaining({ text: "Hi", speaker: "speaker_0" }), expect.objectContaining({ text: " there.", speaker: "speaker_1" })],
        json: expect.objectContaining({ words: expect.any(Array) }),
      }),
      provider_cost: 0.003,
    })
    // No hold recorded on this row; KIE decoded 120 s → charged for 2 minutes, in ONE commit,
    // through the up-or-down settle (an overrun collected, a surplus released).
    expect(m.commitJobCreditsAtActualPrice).toHaveBeenCalledTimes(1)
    expect(m.commitJobCreditsAtActualPrice).toHaveBeenCalledWith("usage-1", "job-n", "nemotron-3-5-transcribe:2m")
    expect(m.commitJobCredits).not.toHaveBeenCalled()
    expect(m.bump).not.toHaveBeenCalled()
  })

  it("a recovery whose KIE length matches the hold commits the reserved tier, once", async () => {
    m.pollKieTask.mockResolvedValue({ resultJson: { resultObject: { text: "Hi.", duration: 110, url: RESULT_URL } } })
    m.safeFetch.mockResolvedValue(fileResponse({ text: "Hi.", duration: 110 }))
    await reconcileKieJob(row({ bucketKey: "nemotron-3-5-transcribe:2m" }))
    expect(m.commitJobCredits).toHaveBeenCalledTimes(1)
    expect(m.commitJobCredits).toHaveBeenCalledWith("usage-1", "job-n")
    expect(m.commitJobCreditsAtActualPrice).not.toHaveBeenCalled()
  })

  it("a recovery of an over-measured file (held 60 minutes) commits less, once", async () => {
    m.pollKieTask.mockResolvedValue({ resultJson: { resultObject: { text: "Hi.", duration: 50, url: RESULT_URL } } })
    m.safeFetch.mockResolvedValue(fileResponse({ text: "Hi.", duration: 50 }))
    await reconcileKieJob(row({ bucketKey: "nemotron-3-5-transcribe:60m", duration_seconds: undefined }))
    expect(m.commitJobCreditsAtActualPrice).toHaveBeenCalledTimes(1)
    expect(m.commitJobCreditsAtActualPrice).toHaveBeenCalledWith("usage-1", "job-n", "nemotron-3-5-transcribe:1m")
    expect(m.commitJobCredits).not.toHaveBeenCalled()
  })

  it("recovers a translation as one, in its target language", async () => {
    m.pollKieTask.mockResolvedValue({ resultJson: { resultObject: { text: "Hello.", duration: 6, url: RESULT_URL, target_language: "en" } } })
    m.safeFetch.mockResolvedValue(fileResponse({ task: "translate", text: "Hello.", duration: 6 }))
    await reconcileKieJob(row({ targetLanguage: "en" }))
    expect(m.markJobCompleted).toHaveBeenCalledWith("job-n", expect.objectContaining({
      output_data: expect.objectContaining({ text: "Hello.", language: "en" }),
    }))
  })

  it("fails and refunds a finished task whose word timings never came (the worker's own contract)", async () => {
    m.pollKieTask.mockResolvedValue({ resultJson: { resultObject: { text: "Hi there.", duration: 120, url: RESULT_URL } } })
    m.safeFetch.mockResolvedValue(fileResponse({ text: "Hi there.", words: [] }))
    await reconcileKieJob(row({ wordTimestamps: true }))
    expect(m.markJobCompleted).not.toHaveBeenCalled()
    expect(m.markJobFailed).toHaveBeenCalled()
    expect(m.refund).toHaveBeenCalledWith("job-n")
  })

  it("fails fast and refunds a task that failed upstream", async () => {
    m.pollKieTask.mockRejectedValue(new m.FakeKieError("task failed: [500] The audio exceeds the maximum allowed duration of 60 minutes."))
    await reconcileKieJob(row({}))
    expect(m.markJobFailed).toHaveBeenCalled()
    expect(m.refund).toHaveBeenCalledWith("job-n")
  })

  it("bumps a task that is still running", async () => {
    m.pollKieTask.mockRejectedValue(new Error("task timed out after 1 poll attempts"))
    await reconcileKieJob(row({}))
    expect(m.bump).toHaveBeenCalled()
    expect(m.refund).not.toHaveBeenCalled()
  })
})
