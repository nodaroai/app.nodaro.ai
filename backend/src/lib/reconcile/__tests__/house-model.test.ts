/**
 * The `house-model` reconcile kind (lib/reconcile/house-model.ts) against a
 * FAKE plugin service: one status read of the saved reference, never a
 * re-start; done → finalized as the worker would (the lane's settle for a held
 * run); failed → the shared hint, failed and refunded; running, not served or
 * an unreadable status → counted toward exhaustion.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const m = vi.hoisted(() => ({
  bump: vi.fn(async () => {}),
  markJobFailed: vi.fn(async () => true),
  refund: vi.fn(async () => {}),
  finalize: vi.fn(async () => ({ ok: true })),
  settledBase: vi.fn(async () => 4),
  /** The fixture lane's own failure sentences; none by default. */
  failureSentences: undefined as { contentPolicy?: string; inputRefused?: string } | undefined,
}))

vi.mock("@nodaro/shared/model-catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nodaro/shared/model-catalog")>()
  return {
    ...actual,
    MODEL_CATALOG: {
      ...actual.MODEL_CATALOG,
      "house-fixture": {
        id: "house-fixture", kind: "image", modes: ["upscale"], family: "House Fixture", ownLabel: true,
        label: "House Fixture", series: "House Fixture", description: "A fixture.", useCases: [], pricing: [{ identifier: "house-fixture", credits: 1 }],
      },
    },
  }
})
vi.mock("@/lib/reconcile/bump-attempts.js", () => ({ bumpAttemptsOrExhaust: m.bump }))
vi.mock("@/lib/job-failure.js", () => ({ markJobFailed: m.markJobFailed }))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: m.refund }))
vi.mock("@/lib/job-finalize.js", () => ({
  finalizeJobWithMedia: m.finalize,
  isFinalizeJobType: (t: unknown) => t === "edit-image",
}))
vi.mock("@/lib/house-model-lanes.js", () => ({
  houseModelLane: (id: string) =>
    id === "house-fixture" ? { inputUrlArgs: ["imageUrl"], settledBase: m.settledBase, failureSentences: m.failureSentences } : undefined,
}))

import { setPluginServices } from "../../private-plugins/services-registry.js"
import type { PluginHouseModelPoll, PluginHouseModelsService } from "../../private-plugins/types.js"
import { reconcileHouseModelJob, houseModelIdOfJob } from "../house-model.js"
import { resetOwnLabelModelIdsForTests } from "../../house-models-served.js"
import { HOUSE_MODEL_CLAIM_REF } from "../../house-model-claim.js"
import { safetyBlockMessage } from "../../safety-block.js"
import { DrainAbortError, _resetWorkerDrainForTests, beginWorkerDrain } from "../../worker-drain.js"

const ROW = {
  id: "job-7",
  provider_task_id: "ref-7",
  reconcile_attempts: 2,
  job_type: "edit-image",
  input_data: { provider: "house-fixture", imageUrl: "https://in.example/a.png" },
}

function serve(poll: () => Promise<PluginHouseModelPoll>): { start: ReturnType<typeof vi.fn>; poll: ReturnType<typeof vi.fn> } {
  // The model's cadence, for pollToEnd: no wait between reads in a test.
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
    fn()
    return 0
  }) as unknown as typeof setTimeout)
  const start = vi.fn(async () => ({ taskRef: "never" }))
  const pollFn = vi.fn(poll)
  const service: PluginHouseModelsService = { ids: () => ["house-fixture"], plan: () => ({ providerCostUsd: 1 }), start, poll: pollFn }
  setPluginServices({ houseModels: service })
  return { start, poll: pollFn }
}

beforeEach(() => {
  vi.clearAllMocks()
  m.failureSentences = undefined
  // The reconcile runs where the plugins are loaded (the API's cron, the video worker's re-pick).
  setPluginServices({})
  resetOwnLabelModelIdsForTests()
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  setPluginServices({})
  vi.restoreAllMocks()
})

describe("houseModelIdOfJob", () => {
  it("is the job's provider when the catalog marks it own-label", () => {
    expect(houseModelIdOfJob({ provider: "house-fixture" })).toBe("house-fixture")
    expect(houseModelIdOfJob({ provider: "z-image" })).toBeUndefined()
    expect(houseModelIdOfJob(null)).toBeUndefined()
  })
})

describe("reconcileHouseModelJob", () => {
  it("done: one read of the saved reference, never a re-start; finalized with the held run's settle", async () => {
    const { start, poll } = serve(async () => ({ state: "done", resultUrls: ["https://out.example/1.png", "https://out.example/2.png"], width: 2048, height: 2048, providerCostUsd: 0.0123 }))
    await reconcileHouseModelJob(ROW)
    expect(start).not.toHaveBeenCalled()
    expect(poll).toHaveBeenCalledWith("house-fixture", "ref-7")
    expect(m.settledBase).toHaveBeenCalledWith(ROW.input_data, { url: "https://out.example/1.png", width: 2048, height: 2048 })
    expect(m.finalize).toHaveBeenCalledWith({
      jobId: "job-7",
      jobType: "edit-image",
      claimant: "cron",
      meteredBaseCredits: 4,
      result: { url: "https://out.example/1.png", extraUrls: ["https://out.example/2.png"], cost: 0.0123, providerUsed: "house-fixture" },
    })
    expect(m.markJobFailed).not.toHaveBeenCalled()
  })

  it("failed: the shared hint and the neutral detail, failed and refunded", async () => {
    serve(async () => ({ state: "failed", message: "UPSTREAM-WORDS", requestRefused: true }))
    await reconcileHouseModelJob(ROW, { claimant: "worker" })
    expect(m.markJobFailed).toHaveBeenCalledWith("job-7", {
      error_message: "House Fixture refused this request as it was sent.",
      error_detail: "House model run failed (requestRefused).",
      reconcile_last_error: "upstream_failed",
      error_hint: { kind: "request-refused" },
    })
    expect(m.refund).toHaveBeenCalledWith("job-7")
    expect(m.finalize).not.toHaveBeenCalled()
  })

  it("running, or an unreadable status: counted toward exhaustion", async () => {
    serve(async () => ({ state: "running" }))
    await reconcileHouseModelJob(ROW)
    serve(async () => { throw new Error("socket") })
    await reconcileHouseModelJob(ROW)
    expect(m.bump).toHaveBeenCalledTimes(2)
    expect(m.finalize).not.toHaveBeenCalled()
    expect(m.markJobFailed).not.toHaveBeenCalled()
  })

  it("a done with no file is the run's end, as in the worker: failed and refunded", async () => {
    serve(async () => ({ state: "done", resultUrls: [] }))
    await reconcileHouseModelJob(ROW)
    expect(m.markJobFailed).toHaveBeenCalledWith("job-7", expect.objectContaining({ error_message: "House Fixture could not complete this run." }))
    expect(m.refund).toHaveBeenCalledWith("job-7")
    expect(m.bump).not.toHaveBeenCalled()
  })

  it("a content-policy failure keeps the seam's fixed sentence when the lane gives none — never the generic safety one", async () => {
    serve(async () => ({ state: "failed", message: "UPSTREAM-WORDS flagged https://upstream.example/t/1", contentPolicy: true }))
    await reconcileHouseModelJob(ROW)
    const fields = (m.markJobFailed.mock.calls[0] as unknown[])[1] as Record<string, unknown>
    expect(fields.error_message).toBe("House Fixture could not complete this run.")
    expect(fields.error_message).not.toBe(safetyBlockMessage(undefined, false))
    expect(fields.error_hint).toMatchObject({ kind: "safety-block", class: "safety", retried: false })
    expect(JSON.stringify(fields)).not.toMatch(/UPSTREAM-WORDS|upstream\.example/)
  })

  it("a content-policy failure writes the lane's own sentence, with the safety hint, and no upstream words", async () => {
    m.failureSentences = { contentPolicy: "LANE: blocked by the content policy; try another model.", inputRefused: "LANE: unreadable picture." }
    serve(async () => ({ state: "failed", message: "UPSTREAM-WORDS flagged https://upstream.example/t/1", contentPolicy: true }))
    await reconcileHouseModelJob(ROW)
    expect(m.markJobFailed).toHaveBeenCalledWith("job-7", {
      error_message: "LANE: blocked by the content policy; try another model.",
      error_detail: "House model run failed (contentPolicy).",
      reconcile_last_error: "upstream_failed",
      error_hint: { kind: "safety-block", class: "safety", retried: false },
    })
    expect(JSON.stringify(m.markJobFailed.mock.calls)).not.toMatch(/UPSTREAM-WORDS|upstream\.example/)
    expect(m.refund).toHaveBeenCalledWith("job-7")
  })

  it("a refused input picture writes the lane's input-refused sentence", async () => {
    m.failureSentences = { contentPolicy: "LANE: blocked.", inputRefused: "LANE: unreadable picture." }
    serve(async () => ({ state: "failed", message: "UPSTREAM-WORDS", inputImageRefused: true }))
    await reconcileHouseModelJob(ROW)
    const fields = (m.markJobFailed.mock.calls[0] as unknown[])[1] as Record<string, unknown>
    expect(fields.error_message).toBe("LANE: unreadable picture.")
  })

  it("not served here (no plugin, or a job whose model is no house model): counted toward exhaustion, nothing read", async () => {
    await reconcileHouseModelJob(ROW)
    const { poll } = serve(async () => ({ state: "running" }))
    await reconcileHouseModelJob({ ...ROW, input_data: { provider: "z-image" } })
    expect(poll).not.toHaveBeenCalled()
    expect(m.bump).toHaveBeenCalledTimes(2)
  })

  it("a service that does not list the id (an install with no upstream key): counted toward exhaustion, nothing read", async () => {
    const poll = vi.fn(async () => ({ state: "running" as const }))
    setPluginServices({ houseModels: { ids: () => [], plan: () => null, start: vi.fn(), poll } })
    await reconcileHouseModelJob(ROW)
    expect(poll).not.toHaveBeenCalled()
    expect(m.bump).toHaveBeenCalledTimes(1)
  })

  it("a delivered size comes as a pair or not at all", async () => {
    serve(async () => ({ state: "done", resultUrls: ["https://out.example/1.png"], width: 2048 }))
    await reconcileHouseModelJob(ROW)
    expect(m.settledBase).toHaveBeenCalledWith(ROW.input_data, { url: "https://out.example/1.png" })
  })

  it("a job claimed for a run whose reference was never saved: failed and refunded at the first look, on the cron and on the inline re-pick — nothing read or started", async () => {
    const { poll, start } = serve(async () => ({ state: "running" }))
    await reconcileHouseModelJob({ ...ROW, provider_task_id: HOUSE_MODEL_CLAIM_REF }) // the cron
    await reconcileHouseModelJob({ ...ROW, id: "job-8", provider_task_id: HOUSE_MODEL_CLAIM_REF }, { claimant: "worker", pollToEnd: true }) // the re-pick
    expect(poll).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    expect(m.bump).not.toHaveBeenCalled()
    for (const jobId of ["job-7", "job-8"]) {
      expect(m.markJobFailed).toHaveBeenCalledWith(jobId, {
        error_message: "House Fixture could not complete this run, and it will not be retried.",
        error_detail: "House model run claimed, but its reference was never saved.",
        reconcile_last_error: "claimed_without_reference",
      })
      expect(m.refund).toHaveBeenCalledWith(jobId)
    }
  })

  it("a claimed row a concurrent writer already ended is not refunded again", async () => {
    serve(async () => ({ state: "running" }))
    m.markJobFailed.mockResolvedValueOnce(false)
    await reconcileHouseModelJob({ ...ROW, provider_task_id: HOUSE_MODEL_CLAIM_REF })
    expect(m.refund).not.toHaveBeenCalled()
  })

  it("pollToEnd (the inline re-pick): reads a run still going to its end, on the model's cadence", async () => {
    const states = [{ state: "running" as const }, { state: "running" as const }, { state: "done" as const, resultUrls: ["https://out.example/1.png"] }]
    const { poll } = serve(async () => states.shift()!)
    await reconcileHouseModelJob(ROW, { claimant: "worker", pollToEnd: true })
    expect(poll).toHaveBeenCalledTimes(3)
    expect(m.finalize).toHaveBeenCalledTimes(1)
    expect(m.bump).not.toHaveBeenCalled()
  })

  it("pollToEnd hands the job back on a drain", async () => {
    serve(async () => ({ state: "running" }))
    beginWorkerDrain()
    try {
      await expect(reconcileHouseModelJob(ROW, { claimant: "worker", pollToEnd: true })).rejects.toBeInstanceOf(DrainAbortError)
    } finally {
      _resetWorkerDrainForTests()
    }
  })
})
