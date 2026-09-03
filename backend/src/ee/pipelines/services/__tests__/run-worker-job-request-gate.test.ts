/**
 * `runPipelineWorkerJob` — the generic wrapper behind all six
 * `pipelineXxx` services — and the one thing it must not do with a
 * request-gate block: report it as an infrastructure failure.
 *
 * Every pipeline child job is created here. When a registered policy refuses
 * one, `insertInternalJob` answers `{ data: null, error: { blocked } }`, and
 * the wrapper's pre-existing `if (insertErr || !job?.id) throw new Error(...)`
 * would flatten "your deployment does not allow this content" into
 * "Failed to create generate-image job: …". The stage that catches it records
 * the reason verbatim, so the flattening is what a user would end up reading.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const insertInternalJobMock = vi.fn(async () => ({ data: { id: "job-1" }, error: null }) as {
  data: { id: string } | null
  error: { message: string; blocked?: { code: "job_blocked"; policyId: string; message: string } } | null
})
vi.mock("../../../../lib/insert-job.js", () => ({
  insertInternalJob: (...args: unknown[]) => insertInternalJobMock(...(args as [])),
}))
vi.mock("../../pipeline-payer.js", () => ({
  getPipelineBillingContext: vi.fn(async () => ({ payer: "user", userId: "u1" })),
}))
const reserveCreditsMock = vi.fn(async () => ({ usageLogId: "log-1", creditsReserved: 1, watermark: false }))
vi.mock("../../../billing/credits.js", () => ({
  CreditsService: { reserveCredits: (...a: unknown[]) => reserveCreditsMock(...(a as [])) },
}))
const queueAddMock = vi.fn(async () => undefined)
vi.mock("../../../../lib/queue.js", () => ({
  videoQueue: { add: (...a: unknown[]) => queueAddMock(...(a as [])) },
}))

import { runPipelineWorkerJob } from "../_run-worker-job.js"

const args = () => ({
  supabase: { from: () => { throw new Error("no table access expected before the insert") } } as never,
  pipelineId: "p1",
  userId: "u1",
  inputData: { type: "generate-image" },
  queueName: "video",
  jobName: "generate-image",
  buildPayload: (jobId: string) => ({ jobId }),
  modelIdentifier: "generate-image",
  assetType: "image" as const,
  pickOutputUrl: () => "https://r2/x.png",
  missingOutputError: "no image",
})

beforeEach(() => {
  vi.clearAllMocks()
  insertInternalJobMock.mockResolvedValue({ data: { id: "job-1" }, error: null })
})

describe("runPipelineWorkerJob — the request gate", () => {
  it("rethrows a block as JobBlockedError, so the stage can code the reason", async () => {
    insertInternalJobMock.mockResolvedValue({
      data: null,
      error: {
        message: "blocked",
        blocked: { code: "job_blocked", policyId: "sai-moderation", message: "Not allowed on this deployment" },
      },
    })

    const err = await runPipelineWorkerJob(args()).catch((e: unknown) => e)

    expect((err as { code?: string }).code).toBe("job_blocked")
    expect((err as Error).message).toBe("Not allowed on this deployment")
    // Nothing was reserved and nothing was queued — the refusal is total.
    expect(reserveCreditsMock).not.toHaveBeenCalled()
    expect(queueAddMock).not.toHaveBeenCalled()
  })

  it("a plain insert failure stays a plain error (it is not a policy decision)", async () => {
    insertInternalJobMock.mockResolvedValue({ data: null, error: { message: "connection reset" } })

    const err = await runPipelineWorkerJob(args()).catch((e: unknown) => e)

    expect((err as { code?: string }).code).toBeUndefined()
    expect((err as Error).message).toMatch(/Failed to create generate-image job/)
  })
})
