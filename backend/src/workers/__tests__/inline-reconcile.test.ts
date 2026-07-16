import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  reconcileKieJob: vi.fn().mockResolvedValue(undefined),
  reconcileReplicateJob: vi.fn().mockResolvedValue(undefined),
  reconcileElevenLabsJob: vi.fn().mockResolvedValue(undefined),
  reconcileFalJob: vi.fn().mockResolvedValue(undefined),
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

vi.mock("../../lib/reconcile/fal.js", () => ({
  reconcileFalJob: mocks.reconcileFalJob,
}))

import { tryInlineReconcile } from "../inline-reconcile.js"
import { KIE_RECOVER_KINDS } from "../../lib/reconcile/types.js"
import { MAX_POLL_ATTEMPTS } from "../../providers/kie/client.js"
import { DrainAbortError } from "../../lib/worker-drain.js"

describe("tryInlineReconcile", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("dispatches every kie-* kind to reconcileKieJob as claimant 'worker' with a FULL resume-poll budget", async () => {
    // Iterate the SHARED dispatch set (audit M5) — a hardcoded copy here was
    // the fourth divergent list. Claimant "worker" (audit H1) lets the stall
    // re-pick re-claim its own crashed predecessor's finalize claim.
    // pollAttempts (incident 2026-07-15): the stall re-pick runs inside a live
    // BullMQ handler, so it resumes polling a still-running task to completion
    // instead of one-shot-probing and parking the row for the cron.
    for (const kind of KIE_RECOVER_KINDS) {
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
        { claimant: "worker", pollAttempts: MAX_POLL_ATTEMPTS },
      )
    }
  })

  it("rethrows DrainAbortError so BullMQ requeues the job instead of parking it for the cron", async () => {
    // A drain (deploy SIGTERM) mid-resume-poll must NOT be swallowed like a
    // transient error: swallowing completes the BullMQ job and strands the row
    // until the cron's staleness threshold. Rethrowing fails the attempt, the
    // lock releases, and the replacement process re-picks it within seconds.
    mocks.reconcileKieJob.mockRejectedValueOnce(new DrainAbortError())
    await expect(
      tryInlineReconcile({
        id: "j-drain",
        provider_kind: "kie-standard",
        provider_task_id: "t-drain",
        reconcile_attempts: 0,
        job_type: "generate-image",
      }),
    ).rejects.toBeInstanceOf(DrainAbortError)
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
    expect(mocks.reconcileReplicateJob).toHaveBeenCalledWith(
      expect.objectContaining({ provider_kind: "replicate-prediction" }),
      { claimant: "worker" },
    )
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
      { claimant: "worker" },
    )
  })

  it("dispatches fal-request to reconcileFalJob (POSITIVE dispatch — catch-all would swallow a missing branch)", async () => {
    await tryInlineReconcile({
      id: "j-fal",
      provider_kind: "fal-request",
      provider_task_id: "req-fal",
      reconcile_attempts: 0,
      job_type: "lip-sync",
    })
    expect(mocks.reconcileFalJob).toHaveBeenCalledTimes(1)
    expect(mocks.reconcileFalJob).toHaveBeenCalledWith(
      expect.objectContaining({ provider_kind: "fal-request" }),
      { claimant: "worker" },
    )
    expect(mocks.reconcileKieJob).not.toHaveBeenCalled()
    expect(mocks.reconcileReplicateJob).not.toHaveBeenCalled()
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
