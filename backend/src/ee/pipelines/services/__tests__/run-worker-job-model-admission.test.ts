/**
 * `runPipelineWorkerJob` asks, before any row exists, what the route guard
 * asks at its door: whether the deployment offers the model the job runs, and
 * (for a video job) the free-credit video limits.
 *
 * A job is reserved under a PRICE row, and a row's name is not always the
 * model's: LTX 2.3 Pro Extend is priced on `ltx-2.3-pro-extend:per-second`,
 * and no catalog model is called `ltx-2.3-pro-extend` (Seedance 2.0 Extend
 * was priced on rows named for no model too, before it had its own). Judging
 * only the row's name, an availability override that withholds the model did
 * not reach it. A video job is judged by the provider it runs as well.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const insertInternalJobMock = vi.fn(async () => ({ data: null, error: { message: "connection reset" } }) as {
  data: { id: string } | null
  error: { message: string } | null
})
vi.mock("../../../../lib/insert-job.js", () => ({
  insertInternalJob: (...args: unknown[]) => insertInternalJobMock(...(args as [])),
}))
vi.mock("../../pipeline-payer.js", () => ({
  getPipelineBillingContext: vi.fn(async () => ({ payer: "user", userId: "u1" })),
}))
const checkCreditsMock = vi.fn(async (..._a: unknown[]) => ({ allowed: true }) as { allowed: boolean; code?: string; error?: string })
vi.mock("../../../billing/credits.js", () => ({
  CreditsService: {
    checkCredits: (...a: unknown[]) => checkCreditsMock(...a),
    reserveCredits: vi.fn(),
  },
}))
vi.mock("../../../../lib/queue.js", () => ({ videoQueue: { add: vi.fn() } }))

import { runPipelineWorkerJob } from "../_run-worker-job.js"
import { GATEABLE_MODEL_IDS, __resetAvailabilityOverridesForTests } from "../../../../lib/availability-override.js"
import { __resetModelSwitchForTests } from "../../../../lib/model-switch.js"

const extendJob = (provider: string, modelIdentifier: string) => ({
  supabase: { from: () => { throw new Error("no table access expected") } } as never,
  pipelineId: "p1",
  userId: "u1",
  inputData: { type: "extend-video", provider, videoUrl: "https://cdn.example.com/a.mp4", prompt: "keep going" },
  queueName: "videoQueue",
  jobName: "extend-video",
  buildPayload: (jobId: string) => ({ jobId }),
  modelIdentifier,
  assetType: "video" as const,
  pickOutputUrl: () => "https://r2/x.mp4",
  missingOutputError: "no video",
})

/** Withhold these models (Admin → Availability), every other gateable model on. */
function withhold(...ids: string[]): void {
  __resetAvailabilityOverridesForTests({ models: new Set([...GATEABLE_MODEL_IDS].filter((id) => !ids.includes(id))) })
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  __resetAvailabilityOverridesForTests()
  __resetModelSwitchForTests()
})

describe("runPipelineWorkerJob — the model a Seedance extend job runs", () => {
  it("an availability override withholding seedance-2-0-extend refuses it", async () => {
    withhold("seedance-2-0-extend")
    const err = await runPipelineWorkerJob(extendJob("seedance-2-0-extend", "seedance-2-0-extend:8s:720p")).catch((e: unknown) => e)
    expect((err as Error).message).toMatch(/not available on this deployment: seedance-2-0-extend/)
    expect(insertInternalJobMock).not.toHaveBeenCalled()
  })

  it("the same job is admitted where the override leaves it on (it reaches the insert)", async () => {
    withhold("seedance-2-5-extend")
    const err = await runPipelineWorkerJob(extendJob("seedance-2-0-extend", "seedance-2-0-extend:8s:720p")).catch((e: unknown) => e)
    expect((err as Error).message).toMatch(/Failed to create extend-video job/)
    expect(insertInternalJobMock).toHaveBeenCalledTimes(1)
  })

  it("a job priced on a row named for no model is judged by the model it runs (LTX 2.3 Pro Extend)", async () => {
    withhold("ltx-2.3-pro")
    const err = await runPipelineWorkerJob(extendJob("ltx-2.3-pro", "ltx-2.3-pro-extend:per-second")).catch((e: unknown) => e)
    expect((err as Error).message).toMatch(/not available on this deployment: ltx-2.3-pro/)
    expect(insertInternalJobMock).not.toHaveBeenCalled()
  })

  it("an admin's switch on the provider's own id refuses it", async () => {
    __resetModelSwitchForTests(["seedance-2-0-extend"])
    const err = await runPipelineWorkerJob(extendJob("seedance-2-0-extend", "seedance-2-0-extend:8s:720p")).catch((e: unknown) => e)
    expect((err as Error).message).toBe("This model is currently disabled")
    expect(insertInternalJobMock).not.toHaveBeenCalled()
  })

  it("a mode twin that shares its id with another model is not judged as that model (Grok video's `grok` is the image model's id)", async () => {
    withhold("grok")
    const job = { ...extendJob("grok", "grok-i2v:6s"), jobName: "text-to-video", inputData: { type: "text-to-video", provider: "grok", duration: 6 } }
    const err = await runPipelineWorkerJob(job).catch((e: unknown) => e)
    expect((err as Error).message).toMatch(/Failed to create text-to-video job/)
    expect(insertInternalJobMock).toHaveBeenCalledTimes(1)
  })

  it("an LTX 2.3 Pro extend job is handed to the free-credit limits as an extension", async () => {
    await runPipelineWorkerJob(extendJob("ltx-2.3-pro", "ltx-2.3-pro-extend:per-second")).catch(() => undefined)
    const surface = checkCreditsMock.mock.calls[0]![4] as { video?: { provider: string; extend?: boolean } }
    expect(surface.video).toMatchObject({ provider: "ltx-2.3-pro", extend: true })
  })

  it("the free-credit limits judge the provider the job runs, not the row's name", async () => {
    checkCreditsMock.mockResolvedValueOnce({ allowed: false, code: "free_video_limit", error: "Extending video is not available on free credits." })
    const err = await runPipelineWorkerJob(extendJob("seedance-2-0-extend", "seedance-2-0-extend:8s:720p")).catch((e: unknown) => e)
    expect((err as Error).message).toMatch(/not available on free credits/)
    const surface = checkCreditsMock.mock.calls[0]![4] as { video?: { provider: string } }
    expect(surface.video?.provider).toBe("seedance-2-0-extend")
    expect(insertInternalJobMock).not.toHaveBeenCalled()
  })
})
