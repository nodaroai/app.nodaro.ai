/**
 * Nodaro Image Upscale's lane on the house-models seam
 * (lib/nodaro-image-upscale-lane.ts): the workflow run's stamp — served, the
 * image copied into the job's scratch folder through the copy helper and
 * measured there, refused past the limits or as the helper refuses it — and
 * the worker's run — the plugin's arguments from the stamped payload, the
 * stamped bytes as the run's one measurement, the model's own timing, then
 * the one delivery. Against fakes of the helper and the seam.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const m = vi.hoisted(() => ({
  served: true,
  size: { width: 1024, height: 1024 } as { width: number; height: number } | undefined,
  probed: undefined as { width: number; height: number } | undefined,
  refusal: undefined as Error | undefined,
  copy: vi.fn(),
  run: vi.fn(),
  deliver: vi.fn(async () => ({ ok: true })),
}))

vi.mock("@/lib/outside-input-copy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../outside-input-copy.js")>()
  return {
    ...actual,
    copyOutsideInput: m.copy.mockImplementation(async () => {
      if (m.refusal) throw m.refusal
      return { url: "https://storage.example/tmp/provider-input/job-7/outside-input-1.png", bytes: 98_765, copied: true, ...(m.size ? { inspected: m.size } : {}) }
    }),
  }
})
vi.mock("@/lib/image-source-size.js", () => ({ probeImageDisplaySize: vi.fn(async () => m.probed) }))
vi.mock("@/lib/house-models.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../house-models.js")>()
  return {
    ...actual,
    houseModelServed: vi.fn(() => m.served),
    runHouseModelTask: m.run.mockImplementation(async () => ({ resultUrls: ["https://out.example/1.png"], width: 4096, height: 4096, reportedCostUsd: null, plannedCostUsd: 0.02 })),
  }
})
vi.mock("@/lib/house-model-delivery.js", () => ({ deliverHouseModelRun: m.deliver }))

import { runNodaroImageUpscaleJob, stampNodaroImageUpscaleInput } from "../nodaro-image-upscale-lane.js"
import { OutsideInputBusyError, OutsideInputTooLargeError } from "../outside-input-copy.js"
import { LinkImportsDisabledError } from "../link-imports.js"
import { DrainAbortError } from "../worker-drain.js"
import { isDeterministicJobError } from "../deterministic-job-error.js"

const ID = "nodaro-image-upscale"
const SRC = "https://elsewhere.example/photo.png"
const STORED = "https://storage.example/tmp/provider-input/job-7/outside-input-1.png"
const CTX = { userId: "user-7", jobId: "job-7" }

beforeEach(() => {
  vi.clearAllMocks()
  m.served = true
  m.size = { width: 1024, height: 1024 }
  m.probed = undefined
  m.refusal = undefined
})

describe("stampNodaroImageUpscaleInput — the workflow run's stamp", () => {
  it("copies the image into the job's scratch folder through the helper, and stamps what the run uses", async () => {
    const stamp = await stampNodaroImageUpscaleInput("edit-image", { provider: ID, imageUrl: SRC, upscaleFactor: "4" }, CTX)
    expect(m.copy).toHaveBeenCalledWith(SRC, expect.objectContaining({ kind: "image", maxBytes: 20_000_000, userId: "user-7", jobId: "job-7", inspect: expect.any(Function) }))
    expect(stamp).toEqual({
      ok: true,
      patch: { nodaroImageUpscaleStoredUrl: STORED, nodaroImageUpscaleInputBytes: 98_765, nodaroImageUpscaleOutputPixels: 16_777_216, nodaroImageUpscaleCreditId: "nodaro-image-upscale:4K" },
    })
    // The node's own link stays the job's `imageUrl`: the patch never touches it.
    expect(stamp.ok && "imageUrl" in stamp.patch).toBe(false)
  })

  it("passes the run's stop signal to the copy", async () => {
    const stop = new AbortController()
    await stampNodaroImageUpscaleInput("edit-image", { provider: ID, imageUrl: SRC }, { ...CTX, signal: stop.signal })
    expect(m.copy).toHaveBeenCalledWith(SRC, expect.objectContaining({ signal: stop.signal }))
  })

  it("leaves every other job alone, and copies nothing for one", async () => {
    expect(await stampNodaroImageUpscaleInput("edit-image", { provider: "topaz-image-upscale", imageUrl: SRC }, CTX)).toEqual({ ok: true, patch: {} })
    expect(await stampNodaroImageUpscaleInput("image-to-image", { provider: ID, imageUrl: SRC }, CTX)).toEqual({ ok: true, patch: {} })
    expect(m.copy).not.toHaveBeenCalled()
  })

  it("not served here: refused, nothing copied", async () => {
    m.served = false
    expect(await stampNodaroImageUpscaleInput("edit-image", { provider: ID, imageUrl: SRC }, CTX)).toEqual({
      ok: false,
      code: "model_not_available",
      message: "Nodaro Image Upscale is not available on this deployment.",
    })
    expect(m.copy).not.toHaveBeenCalled()
  })

  it("an output past the limits is refused (1100 × 1100 at 8x)", async () => {
    m.size = { width: 1100, height: 1100 }
    const stamp = await stampNodaroImageUpscaleInput("edit-image", { provider: ID, imageUrl: SRC, upscaleFactor: "8" }, CTX)
    expect(stamp).toMatchObject({ ok: false, code: "image_too_large", message: expect.stringContaining("8,800 × 8,800") })
  })

  it("a size that cannot be read stamps the hold, and no output size", async () => {
    m.size = undefined
    const stamp = await stampNodaroImageUpscaleInput("edit-image", { provider: ID, imageUrl: SRC, upscaleFactor: "2" }, CTX)
    expect(stamp).toEqual({ ok: true, patch: { nodaroImageUpscaleStoredUrl: STORED, nodaroImageUpscaleInputBytes: 98_765, nodaroImageUpscaleCreditId: "nodaro-image-upscale" } })
  })

  it("the helper's refusals end the node in their own words; the deployment's own switch unchanged; a drain goes on as it is", async () => {
    m.refusal = new OutsideInputTooLargeError(20_000_000)
    expect(await stampNodaroImageUpscaleInput("edit-image", { provider: ID, imageUrl: SRC }, CTX)).toEqual({ ok: false, code: "input_too_large", message: "The file is larger than the 20 MB this step takes." })
    m.refusal = new OutsideInputBusyError()
    expect(await stampNodaroImageUpscaleInput("edit-image", { provider: ID, imageUrl: SRC }, CTX)).toMatchObject({ ok: false, code: "input_busy" })
    m.refusal = new LinkImportsDisabledError()
    expect(await stampNodaroImageUpscaleInput("edit-image", { provider: ID, imageUrl: SRC }, CTX)).toEqual({
      ok: false,
      code: "link_imports_disabled",
      message: "Importing media from a link to another site is turned off on this deployment. Upload the file instead.",
    })
    m.refusal = new DrainAbortError()
    await expect(stampNodaroImageUpscaleInput("edit-image", { provider: ID, imageUrl: SRC }, CTX)).rejects.toBeInstanceOf(DrainAbortError)
  })
})

describe("runNodaroImageUpscaleJob — the worker's run", () => {
  const PAYLOAD = {
    provider: ID,
    imageUrl: SRC,
    nodaroImageUpscaleStoredUrl: STORED,
    upscaleFactor: "4",
    nodaroImageUpscaleInputBytes: 98_765,
    nodaroImageUpscaleOutputPixels: 16_777_216,
    nodaroImageUpscaleCreditId: "nodaro-image-upscale:4K",
    usageLogId: "usage-7",
  }

  it("runs the seam's runner with the plugin's arguments, the one measurement and the model's own timing, then the one delivery", async () => {
    await runNodaroImageUpscaleJob(PAYLOAD, { jobId: "job-7" })
    expect(m.run).toHaveBeenCalledWith(ID, { imageUrl: STORED, factor: "4", outputPixels: 16_777_216 }, {
      jobId: "job-7",
      timeoutMs: 12 * 60_000,
      pollIntervalMs: 5_000,
      inputFacts: { [STORED]: { bytes: 98_765 } },
    })
    expect(m.deliver).toHaveBeenCalledWith({
      id: ID,
      jobId: "job-7",
      jobType: "edit-image",
      job: PAYLOAD,
      resultUrls: ["https://out.example/1.png"],
      width: 4096,
      height: 4096,
      reportedCostUsd: null,
      plannedCostUsd: 0.02,
      claimant: "worker",
    })
  })

  it("a held run (no output size stamped) reads the stored image's size now", async () => {
    m.probed = { width: 512, height: 512 }
    const { nodaroImageUpscaleOutputPixels: _px, ...held } = PAYLOAD
    await runNodaroImageUpscaleJob({ ...held, nodaroImageUpscaleCreditId: "nodaro-image-upscale" }, { jobId: "job-7" })
    expect(m.run).toHaveBeenCalledWith(ID, { imageUrl: STORED, factor: "4", outputPixels: 4_194_304 }, expect.anything())
  })

  it("runs the stored copy, never the caller's link; a job queued before the stamp kept them apart runs its imageUrl", async () => {
    await runNodaroImageUpscaleJob(PAYLOAD, { jobId: "job-7" })
    expect(m.run.mock.calls.at(-1)![1]).toMatchObject({ imageUrl: STORED })
    const { nodaroImageUpscaleStoredUrl: _s, ...older } = PAYLOAD
    await runNodaroImageUpscaleJob({ ...older, imageUrl: STORED }, { jobId: "job-7" })
    expect(m.run.mock.calls.at(-1)![1]).toMatchObject({ imageUrl: STORED })
    expect(m.run.mock.calls.at(-1)![2]).toMatchObject({ inputFacts: { [STORED]: { bytes: 98_765 } } })
  })

  it("no image, a size still unreadable, or an output past the limits: refused, final, nothing started", async () => {
    const { imageUrl: _u, nodaroImageUpscaleStoredUrl: _s, ...noImage } = PAYLOAD
    for (const payload of [noImage, { ...PAYLOAD, nodaroImageUpscaleOutputPixels: undefined }]) {
      const err = await runNodaroImageUpscaleJob(payload, { jobId: "job-7" }).catch((e: unknown) => e)
      expect(isDeterministicJobError(err)).toBe(true)
    }
    m.probed = { width: 1100, height: 1100 }
    const err = await runNodaroImageUpscaleJob({ ...PAYLOAD, upscaleFactor: "8", nodaroImageUpscaleOutputPixels: undefined }, { jobId: "job-7" }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect(m.run).not.toHaveBeenCalled()
  })

  it("a held run the worker still cannot read, or that is past the limits, says so in plain words", async () => {
    m.probed = undefined
    const unreadable = await runNodaroImageUpscaleJob({ ...PAYLOAD, nodaroImageUpscaleOutputPixels: undefined }, { jobId: "job-7" }).catch((e: unknown) => e)
    expect((unreadable as Error).message).toBe(
      "Nodaro Image Upscale could not read this picture. Send a PNG, JPEG or WebP image, or try Topaz Upscale or Recraft Upscale.",
    )
    m.probed = { width: 1100, height: 1100 }
    const tooLarge = await runNodaroImageUpscaleJob({ ...PAYLOAD, upscaleFactor: "8", nodaroImageUpscaleOutputPixels: undefined }, { jobId: "job-7" }).catch((e: unknown) => e)
    expect((tooLarge as Error).message).toContain("8,800 × 8,800")
    expect(m.run).not.toHaveBeenCalled()
  })

  it("a runner rejection is the job's, unchanged, and nothing is delivered", async () => {
    const err = Object.assign(new Error("Nodaro Image Upscale could not complete this run."), { deterministic: true })
    m.run.mockRejectedValueOnce(err)
    await expect(runNodaroImageUpscaleJob(PAYLOAD, { jobId: "job-7" })).rejects.toBe(err)
    expect(m.deliver).not.toHaveBeenCalled()
  })
})
