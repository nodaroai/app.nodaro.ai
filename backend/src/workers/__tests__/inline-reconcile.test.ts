import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  reconcileKieJob: vi.fn().mockResolvedValue(undefined),
  reconcileReplicateJob: vi.fn().mockResolvedValue(undefined),
  reconcileElevenLabsJob: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../lib/reconcile/kie.js", () => ({
  reconcileKieJob: mocks.reconcileKieJob,
}))

vi.mock("../../lib/reconcile/replicate.js", () => ({
  reconcileReplicateJob: mocks.reconcileReplicateJob,
}))

vi.mock("../../lib/reconcile/elevenlabs.js", () => ({
  reconcileElevenLabsJob: mocks.reconcileElevenLabsJob,
}))

import { tryInlineReconcile } from "../inline-reconcile.js"

describe("tryInlineReconcile", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("dispatches every kie-* kind to reconcileKieJob", async () => {
    const kieKinds = [
      "kie-standard", "kie-veo", "kie-veo-1080p", "kie-suno", "kie-kontext",
      "kie-luma", "kie-kling3", "kie-runway", "kie-aleph", "kie-lip-sync",
    ]
    for (const kind of kieKinds) {
      mocks.reconcileKieJob.mockClear()
      await tryInlineReconcile({
        id: `j-${kind}`,
        provider_kind: kind,
        provider_task_id: "t-1",
        reconcile_attempts: 0,
        job_type: "image-to-video",
      })
      expect(mocks.reconcileKieJob).toHaveBeenCalledTimes(1)
      expect(mocks.reconcileKieJob).toHaveBeenCalledWith(
        expect.objectContaining({ provider_kind: kind }),
      )
    }
  })

  it("dispatches replicate-* kinds to reconcileReplicateJob", async () => {
    await tryInlineReconcile({
      id: "j-rep",
      provider_kind: "replicate-prediction",
      provider_task_id: "t-rep",
      reconcile_attempts: 0,
      job_type: "image-to-video",
    })
    expect(mocks.reconcileReplicateJob).toHaveBeenCalledTimes(1)
    expect(mocks.reconcileKieJob).not.toHaveBeenCalled()
  })

  it("dispatches elevenlabs-async to reconcileElevenLabsJob (with input_data: null)", async () => {
    await tryInlineReconcile({
      id: "j-11",
      provider_kind: "elevenlabs-async",
      provider_task_id: "t-11",
      reconcile_attempts: 0,
      job_type: "dubbing",
    })
    expect(mocks.reconcileElevenLabsJob).toHaveBeenCalledTimes(1)
    expect(mocks.reconcileElevenLabsJob).toHaveBeenCalledWith(
      expect.objectContaining({ provider_kind: "elevenlabs-async", input_data: null }),
    )
  })

  it("no-op when provider_kind is null (cron handles legacy rows)", async () => {
    await tryInlineReconcile({
      id: "j-legacy",
      provider_kind: null,
      provider_task_id: "t-legacy",
      reconcile_attempts: 0,
      job_type: "generate-image",
    })
    expect(mocks.reconcileKieJob).not.toHaveBeenCalled()
    expect(mocks.reconcileReplicateJob).not.toHaveBeenCalled()
    expect(mocks.reconcileElevenLabsJob).not.toHaveBeenCalled()
  })

  it("no-op for unknown async kinds (cron catch-all sweeps them)", async () => {
    await tryInlineReconcile({
      id: "j-future",
      provider_kind: "kie-future-model",
      provider_task_id: "t-future",
      reconcile_attempts: 0,
      job_type: "future-thing",
    })
    expect(mocks.reconcileKieJob).not.toHaveBeenCalled()
  })

  it("swallows thrown errors from the per-provider handler (cron retries)", async () => {
    mocks.reconcileKieJob.mockRejectedValueOnce(new Error("transient"))
    // The promise must resolve, not reject — the worker should exit cleanly so
    // BullMQ doesn't retry the same stalled job in a tight loop.
    await expect(
      tryInlineReconcile({
        id: "j-throw",
        provider_kind: "kie-suno",
        provider_task_id: "t-throw",
        reconcile_attempts: 0,
        job_type: "suno-generate",
      }),
    ).resolves.toBeUndefined()
  })
})
