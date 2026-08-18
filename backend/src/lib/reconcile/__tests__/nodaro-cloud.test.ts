/**
 * reconcileNodaroCloudJob — recovery for stalled exclusive-node relay jobs.
 * The contract that matters: recovery is ONE idempotent poll of the persisted
 * CLOUD job id — it never creates a second cloud job. Completed output adapts
 * through the SAME finalizeExclusiveCloudOutput as the live relay; terminal
 * cloud failures fail the local row (CAS on non-terminal statuses) + release
 * the reservation; everything transient bumps reconcile_attempts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const updateIn = vi.fn().mockResolvedValue({ data: null, error: null })
  const updateEq = vi.fn(() => ({ in: updateIn }))
  const update = vi.fn((_arg: Record<string, unknown>) => ({ eq: updateEq }))
  const maybeSingle = vi.fn().mockResolvedValue({ data: { user_id: "user-1", should_watermark: true } })
  const selectEq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq: selectEq }))
  return {
    update,
    updateIn,
    maybeSingle,
    from: vi.fn(() => ({ update, select })),
    finalize: vi.fn().mockResolvedValue(true),
    refund: vi.fn().mockResolvedValue(undefined),
    bump: vi.fn().mockResolvedValue(undefined),
    cloudFetch: vi.fn(),
  }
})

vi.mock("../../supabase.js", () => ({ supabase: { from: mocks.from } }))
vi.mock("../../../workers/handlers/nodaro-exclusive-relay.js", () => ({
  finalizeExclusiveCloudOutput: mocks.finalize,
}))
vi.mock("../bump-attempts.js", () => ({ bumpAttemptsOrExhaust: mocks.bump }))
vi.mock("../../credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: mocks.refund }))
vi.mock("../../nodaro-connect.js", () => ({ nodaroCloudFetch: mocks.cloudFetch }))

import { reconcileNodaroCloudJob } from "../nodaro-cloud.js"

const row = (over: Partial<Parameters<typeof reconcileNodaroCloudJob>[0]> = {}) => ({
  id: "j-1",
  provider_task_id: "cloud-9",
  reconcile_attempts: 0,
  job_type: "generate-video-pro",
  ...over,
})

const okPoll = (data: Record<string, unknown>) =>
  ({ ok: true, status: 200, json: async () => ({ data }) }) as never

beforeEach(() => {
  vi.clearAllMocks()
  mocks.finalize.mockResolvedValue(true)
  mocks.maybeSingle.mockResolvedValue({ data: { user_id: "user-1", should_watermark: true } })
  mocks.updateIn.mockResolvedValue({ data: null, error: null })
})

describe("reconcileNodaroCloudJob", () => {
  it("polls the persisted cloud job — GET, never a re-create", async () => {
    mocks.cloudFetch.mockResolvedValue(okPoll({ id: "cloud-9", status: "processing" }))
    await reconcileNodaroCloudJob(row())
    expect(mocks.cloudFetch).toHaveBeenCalledTimes(1)
    expect(mocks.cloudFetch).toHaveBeenCalledWith("/v1/jobs/cloud-9")
    expect(mocks.bump).toHaveBeenCalledWith("j-1", "nodaro.ai job still processing")
    expect(mocks.finalize).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("completed → adapts through the SAME finalize as the live relay, with the row's own watermark stamp", async () => {
    const cloudJob = { id: "cloud-9", status: "completed", output_data: { videoUrl: "https://c/v.mp4" } }
    mocks.cloudFetch.mockResolvedValue(okPoll(cloudJob))
    await reconcileNodaroCloudJob(row())
    expect(mocks.finalize).toHaveBeenCalledWith({
      jobId: "j-1",
      jobType: "generate-video-pro",
      cloudJob,
      jobUserId: "user-1",
      shouldWatermark: true,
    })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.refund).not.toHaveBeenCalled()
  })

  it("a finalize failure is transient (bump), not terminal — the cloud result still exists to retry against", async () => {
    mocks.cloudFetch.mockResolvedValue(okPoll({ id: "cloud-9", status: "completed", output_data: {} }))
    mocks.finalize.mockRejectedValue(new Error("R2 hiccup"))
    await reconcileNodaroCloudJob(row())
    expect(mocks.bump).toHaveBeenCalledWith("j-1", "R2 hiccup")
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("cloud failed → local row fails with the upstream message (CAS on non-terminal) + reservation released", async () => {
    mocks.cloudFetch.mockResolvedValue(
      okPoll({ id: "cloud-9", status: "failed", error_message: "content policy" }),
    )
    await reconcileNodaroCloudJob(row())
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error_message: "content policy",
        reconcile_last_error: "upstream_failed",
      }),
    )
    expect(mocks.refund).toHaveBeenCalledWith("j-1")
    expect(mocks.finalize).not.toHaveBeenCalled()
  })

  it("cloud 401/403/404 → nothing recoverable: local row fails", async () => {
    mocks.cloudFetch.mockResolvedValue({ ok: false, status: 404 } as never)
    await reconcileNodaroCloudJob(row())
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error_message: expect.stringContaining("404") }),
    )
    expect(mocks.refund).toHaveBeenCalledWith("j-1")
  })

  it("cloud 5xx → transient: bump and look again next tick", async () => {
    mocks.cloudFetch.mockResolvedValue({ ok: false, status: 502 } as never)
    await reconcileNodaroCloudJob(row())
    expect(mocks.bump).toHaveBeenCalledWith("j-1", "nodaro.ai poll 502")
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("network error → transient bump", async () => {
    mocks.cloudFetch.mockRejectedValue(new Error("fetch failed"))
    await reconcileNodaroCloudJob(row())
    expect(mocks.bump).toHaveBeenCalledWith("j-1", "fetch failed")
  })

  it("a row missing its provider_task_id can only bump — never guess a cloud job", async () => {
    await reconcileNodaroCloudJob(row({ provider_task_id: null }))
    expect(mocks.cloudFetch).not.toHaveBeenCalled()
    expect(mocks.bump).toHaveBeenCalledWith("j-1", expect.stringContaining("missing provider_task_id"))
  })
})
