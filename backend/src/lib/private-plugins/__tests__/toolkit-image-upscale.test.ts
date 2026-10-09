/**
 * `tk.providers.imageUpscale` — the gvp identity-plate lever's toolkit member
 * (stage 3, 2026-08-02). Composition: editImage(topaz-image-upscale) → fetch
 * both images → REAL plate gate (exact 2x dims + pixel alignment) → host the
 * verified bytes on R2. The gate here is the actual implementation — only the
 * network edges (router, fetch, R2) are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import sharp from "sharp"

const { mockEditImage, mockFetchImage, mockUploadBuffer } = vi.hoisted(() => ({
  mockEditImage: vi.fn(),
  mockFetchImage: vi.fn(),
  mockUploadBuffer: vi.fn(),
}))
vi.mock("../../../providers/router.js", () => ({ editImage: mockEditImage, videoUpscale: vi.fn(), generateImage: vi.fn() }))
vi.mock("../plate-gate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plate-gate.js")>()),
  fetchImageBuffer: mockFetchImage,
}))
vi.mock("../../storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../storage.js")>()),
  uploadBufferToR2: mockUploadBuffer,
}))

import { buildToolkit } from "../toolkit.js"

const W = 48
const H = 28

async function checkerPng(w: number, h: number): Promise<Buffer> {
  const raw = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      const v = (Math.floor(x / 6) + Math.floor(y / 6)) % 2 === 0 ? 220 : 30
      raw[i] = v
      raw[i + 1] = Math.round((x / w) * 255)
      raw[i + 2] = Math.round((y / h) * 255)
    }
  }
  // Blurred to natural-image edge sharpness — see plate-gate.test.ts.
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).blur(1.2).png().toBuffer()
}

describe("tk.providers.imageUpscale", () => {
  beforeEach(() => {
    mockEditImage.mockReset()
    mockFetchImage.mockReset()
    mockUploadBuffer.mockReset()
  })

  it("upscales via topaz, passes the real gate, and returns the R2-hosted verified bytes", async () => {
    const src = await checkerPng(W, H)
    const plate = await sharp(src).resize(W * 2, H * 2, { kernel: "lanczos3" }).png().toBuffer()
    mockEditImage.mockResolvedValue({ url: "https://provider/plate.png" })
    mockFetchImage.mockImplementation(async (url: string) =>
      url === "https://r2/anchor.png" ? src : plate)
    mockUploadBuffer.mockResolvedValue("https://cdn/images/plate-x.png")
    const tk = buildToolkit()

    const result = await tk.providers.imageUpscale("https://r2/anchor.png", "topaz-image-upscale")

    expect(mockEditImage).toHaveBeenCalledWith("https://r2/anchor.png", "topaz-image-upscale")
    expect(mockUploadBuffer).toHaveBeenCalledTimes(1)
    const [bytes, key, mime] = mockUploadBuffer.mock.calls[0]
    expect(bytes).toBe(plate) // the VERIFIED bytes, not a re-encode
    expect(key).toMatch(/^images\/plate-[0-9a-f-]+\.png$/)
    expect(mime).toBe("image/png")
    expect(result).toEqual({ url: "https://cdn/images/plate-x.png" })
  })

  it("hosts the plate in the RUNNING job's family, so that job's expiry finds it (decided 2026-10-08)", async () => {
    const { runWithJobCancellation } = await import("../../job-cancellation.js")
    const JOB = "00000000-0000-4000-8000-0000000000aa"
    const src = await checkerPng(W, H)
    const plate = await sharp(src).resize(W * 2, H * 2, { kernel: "lanczos3" }).png().toBuffer()
    mockEditImage.mockResolvedValue({ url: "https://provider/plate.png" })
    mockFetchImage.mockImplementation(async (url: string) => (url === "https://r2/anchor.png" ? src : plate))
    mockUploadBuffer.mockResolvedValue("https://cdn/images/x.png")
    const tk = buildToolkit()

    await runWithJobCancellation(JOB, "user-1", () => tk.providers.imageUpscale("https://r2/anchor.png", "topaz-image-upscale"))

    const [, key] = mockUploadBuffer.mock.calls[0]
    expect(key).toMatch(new RegExp(`^images/${JOB}-plate-[0-9a-f-]{36}\\.png$`))
  })

  it("rejects (and never hosts) when the provider breaks the exact-same-frame guarantee", async () => {
    const src = await checkerPng(W, H)
    // Right dims, wrong frame: cropped then stretched back to exact 2x.
    const badPlate = await sharp(src)
      .extract({ left: 6, top: 4, width: W - 12, height: H - 8 })
      .resize(W * 2, H * 2, { fit: "fill" })
      .png()
      .toBuffer()
    mockEditImage.mockResolvedValue({ url: "https://provider/plate.png" })
    mockFetchImage.mockImplementation(async (url: string) =>
      url === "https://r2/anchor.png" ? src : badPlate)
    const tk = buildToolkit()

    await expect(tk.providers.imageUpscale("https://r2/anchor.png", "topaz-image-upscale"))
      .rejects.toThrow(/misaligned/)
    expect(mockUploadBuffer).not.toHaveBeenCalled()
  })

  it("propagates provider failures unchanged (the plugin's non-fatal guard owns degradation)", async () => {
    mockEditImage.mockRejectedValue(new Error("topaz 502"))
    const tk = buildToolkit()

    await expect(tk.providers.imageUpscale("https://r2/anchor.png", "topaz-image-upscale"))
      .rejects.toThrow("topaz 502")
    expect(mockUploadBuffer).not.toHaveBeenCalled()
  })

  // KIE's market ingest can fail transiently on a seconds-old object and the
  // failure sticks to that exact URL for a window (2026-08-03: 422 "Field
  // required" replayed ~2h while Seedance ingested the same URL fine). The
  // retry rides a fresh query nonce so KIE sees a new cache key.
  it("retries once under a fresh query nonce when the provider rejects, and plates from the retry", async () => {
    const src = await checkerPng(W, H)
    const plate = await sharp(src).resize(W * 2, H * 2, { kernel: "lanczos3" }).png().toBuffer()
    mockEditImage
      .mockRejectedValueOnce(new Error("Image editing failed: Field required"))
      .mockResolvedValueOnce({ url: "https://provider/plate.png" })
    mockFetchImage.mockImplementation(async (url: string) =>
      url === "https://r2/anchor.png" ? src : plate)
    mockUploadBuffer.mockResolvedValue("https://cdn/images/plate-x.png")
    const tk = buildToolkit()

    const result = await tk.providers.imageUpscale("https://r2/anchor.png", "topaz-image-upscale")

    expect(mockEditImage).toHaveBeenCalledTimes(2)
    expect(mockEditImage.mock.calls[0]).toEqual(["https://r2/anchor.png", "topaz-image-upscale"])
    expect(mockEditImage.mock.calls[1][0]).toMatch(/^https:\/\/r2\/anchor\.png\?n=[0-9a-f]{8}$/)
    expect(mockEditImage.mock.calls[1][1]).toBe("topaz-image-upscale")
    expect(result).toEqual({ url: "https://cdn/images/plate-x.png" })
  })

  it("nonce joins with & when the source URL already carries a query string", async () => {
    const src = await checkerPng(W, H)
    const plate = await sharp(src).resize(W * 2, H * 2, { kernel: "lanczos3" }).png().toBuffer()
    mockEditImage
      .mockRejectedValueOnce(new Error("Field required"))
      .mockResolvedValueOnce({ url: "https://provider/plate.png" })
    mockFetchImage.mockImplementation(async (url: string) =>
      url.startsWith("https://r2/anchor.png?w=1") ? src : plate)
    mockUploadBuffer.mockResolvedValue("https://cdn/images/plate-x.png")
    const tk = buildToolkit()

    await tk.providers.imageUpscale("https://r2/anchor.png?w=1", "topaz-image-upscale")

    expect(mockEditImage.mock.calls[1][0]).toMatch(/^https:\/\/r2\/anchor\.png\?w=1&n=[0-9a-f]{8}$/)
  })

  it("gives up after the nonce retry — exactly two provider attempts, error propagates", async () => {
    mockEditImage.mockRejectedValue(new Error("Field required"))
    const tk = buildToolkit()

    await expect(tk.providers.imageUpscale("https://r2/anchor.png", "topaz-image-upscale"))
      .rejects.toThrow("Field required")
    expect(mockEditImage).toHaveBeenCalledTimes(2)
    expect(mockUploadBuffer).not.toHaveBeenCalled()
  })

  it("an unreadable source fails BEFORE any provider attempt is spent", async () => {
    mockFetchImage.mockRejectedValue(new Error("plate gate: fetch 404 for https://r2/anchor.png"))
    const tk = buildToolkit()

    await expect(tk.providers.imageUpscale("https://r2/anchor.png", "topaz-image-upscale"))
      .rejects.toThrow(/fetch 404/)
    expect(mockEditImage).not.toHaveBeenCalled()
    expect(mockUploadBuffer).not.toHaveBeenCalled()
  })
})
