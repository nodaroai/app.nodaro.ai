/**
 * The worker and the one delivery: each picture the run sends made ready for
 * the provider (a product picture held to the provider's size and shape rule,
 * a webpage picture to its formats only), one task, then the picture stored as
 * what its bytes are, its provider cost from the task's record, else the listed
 * figure for what was sent. A store failure refunds; the reconcile's recovery
 * runs the same delivery from the saved task.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const m = vi.hoisted(() => ({
  run: vi.fn(),
  ensure: vi.fn(async (url: string, _provider?: string, _opts?: Record<string, unknown>) => `${url}?ready`),
  finalize: vi.fn(async (_input: Record<string, unknown>) => ({ ok: true })),
  progress: vi.fn(async () => {}),
}))

vi.mock("@/providers/kie/long-image.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/kie/long-image.js")>()),
  runLongImage: m.run,
}))
vi.mock("@/providers/kie/video.js", () => ({ ensureImageForProvider: m.ensure }))
vi.mock("@/lib/job-finalize.js", () => ({ finalizeJobWithMedia: m.finalize }))
vi.mock("@/lib/reconcile/persistence.js", () => ({ makeOnTaskCreated: () => async () => {} }))
vi.mock("@/workers/shared.js", () => ({ setJobProgress: m.progress, startProgressRamp: () => ({ stop: () => {} }) }))

import { PostProcessingError } from "@/lib/post-processing-error.js"
import { KIE_CREDIT_USD } from "@/providers/kie/models.js"
import { recover } from "../recover.js"
import { worker } from "../worker.js"

const ctx = { jobId: "job-1", jobUserId: "u1", usageLogId: "ul-1", shouldWatermark: false }
const job = (data: Record<string, unknown>) => ({ data: { jobId: "job-1", prompt: "a page", ...data }, updateProgress: async () => {} }) as never
const A = "https://r2/a.png"
const B = "https://r2/b.png"

beforeEach(() => {
  vi.clearAllMocks()
  m.run.mockResolvedValue({ taskId: "t1", url: "https://kie/page.png", kieCredits: 107.5, providerMs: 90000 })
})

const finalized = () => m.finalize.mock.calls[0]![0] as Record<string, any>

describe("long-image worker", () => {
  it("a webpage design: each picture made ready (formats only), one task, the picture stored as what its bytes are", async () => {
    await worker(job({ mode: "webpage", resolution: "2K", styleImageUrl: A, subjectImageUrl: B }), ctx as never)
    expect(m.ensure).toHaveBeenCalledTimes(2)
    for (const call of m.ensure.mock.calls) {
      const opts = call[2] as Record<string, unknown>
      expect(call[1]).toBe("kling-4-long-image")
      expect(opts.acceptedFormats).toEqual(new Set(["jpeg", "png"]))
      // A tall page is the obvious style picture: no shape rule on the webpage pictures.
      expect(opts).not.toHaveProperty("minAspectRatio")
      expect(opts).not.toHaveProperty("maxAspectRatio")
    }
    const [run, sentUrlOf] = m.run.mock.calls[0]! as [Record<string, unknown>, (u: string) => string]
    expect(run).toEqual({ mode: "webpage", resolution: "2K", prompt: "a page", styleImageUrl: A, subjectImageUrl: B })
    expect(sentUrlOf(A)).toBe(`${A}?ready`)
    const input = finalized()
    expect(input.jobType).toBe("generate-image")
    expect(input.storeAsItsBytes).toBe(true)
    expect(input.result).toMatchObject({ url: "https://kie/page.png", providerUsed: "kling-4-long-image", kieTaskId: "t1", providerMs: 90000 })
    expect(input.result.cost).toBeCloseTo(107.5 * KIE_CREDIT_USD)
    // The charge is the reservation: nothing settles it.
    expect(input).not.toHaveProperty("meteredBaseCredits")
  })

  it("a product page: each picture sent once, held to the provider's size and shape rule", async () => {
    await worker(job({ mode: "ecommerce", length: "long", productImageUrls: [A, null, A, B] }), ctx as never)
    expect(m.ensure.mock.calls.map((c) => c[0])).toEqual([A])
    const opts = m.ensure.mock.calls[0]![2] as Record<string, unknown>
    expect(opts).toMatchObject({ minDimension: 300, minAspectRatio: 0.4, maxAspectRatio: 2.5 })
    expect((m.run.mock.calls[0]![0] as Record<string, unknown>).productImageUrls).toEqual([A, null, A])
  })

  it("a task record with no figure records the listed figure for what was sent", async () => {
    m.run.mockResolvedValue({ taskId: "t1", url: "https://kie/page.png" })
    await worker(job({ mode: "ecommerce", length: "medium", resolution: "1K", productImageUrls: [A, B] }), ctx as never)
    expect(finalized().result.cost).toBeCloseTo(((8450 + 50 * 2) / 100) * KIE_CREDIT_USD)
  })

  it("a picture that cannot be stored fails the run as a plain error, so it is refunded", async () => {
    m.finalize.mockRejectedValueOnce(new PostProcessingError("upload-size-exceeded"))
    const err = await worker(job({}), ctx as never).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(PostProcessingError)
    expect((err as Error).message).toMatch(/the picture could not be saved/)
  })
})

describe("long-image recovery", () => {
  it("delivers the saved task through the same delivery, with the settings off the job's request", async () => {
    await recover({
      jobId: "job-9",
      input: { type: "long-image", mode: "webpage", resolution: "1K", prompt: "p", styleImageUrl: A, inputImages: 1 },
      taskId: "t9",
      providerKind: "kie-standard",
      result: { resultUrls: ["https://kie/recovered.png"] },
      providerCredits: 99.5,
      claimant: "cron",
    })
    const input = finalized()
    expect(input).toMatchObject({ jobId: "job-9", jobType: "generate-image", claimant: "cron", storeAsItsBytes: true })
    expect(input.result).toMatchObject({ url: "https://kie/recovered.png", kieTaskId: "t9" })
    expect(input.result.cost).toBeCloseTo(99.5 * KIE_CREDIT_USD)
  })

  it("a saved task with no picture throws, so the reconcile fails and refunds the job", async () => {
    await expect(recover({ jobId: "job-9", input: {}, taskId: "t9", providerKind: "kie-standard", result: { resultUrls: [] }, claimant: "cron" })).rejects.toThrow()
    expect(m.finalize).not.toHaveBeenCalled()
  })
})
