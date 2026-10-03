// backend/src/providers/video/__tests__/video-overlay-images.test.ts
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import sharp from "sharp"

const dl = vi.hoisted(() => ({ downloadFile: vi.fn() }))
vi.mock("../ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ffmpeg-utils.js")>()),
  downloadFile: dl.downloadFile,
}))

import { fetchVideoOverlayImage, gateVideoOverlayImage, inspectVideoOverlayImage, type VideoOverlayImageFacts } from "../video-overlay-images.js"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"

async function refusal(run: () => unknown): Promise<string> {
  try {
    await run()
  } catch (err) {
    expect(isDeterministicJobError(err)).toBe(true)
    return (err as Error).message
  }
  throw new Error("expected a refusal")
}

describe("fetchVideoOverlayImage — the catch is exhaustive and URL-free", () => {
  it.each([
    ["Failed to download: https://cdn.example/a.png (403)"],
    ["safeFetch: blocked — protocol file:"],
    ["cdn.internal is a private/reserved IP"],
    ["fetch failed"],
    ["The operation was aborted"],
  ])("%s → 'image could not be fetched'", async (raw) => {
    dl.downloadFile.mockRejectedValueOnce(new Error(raw))
    const msg = await refusal(() => fetchVideoOverlayImage("https://cdn.example/a.png", "/tmp/x", { layer: 1 }))
    expect(msg).toBe("layers[1]: image could not be fetched")
    expect(msg).not.toMatch(/https?:|403/)
  })
  it("the byte cap → 'larger than 25 MB'; a canvas slot is named by its handle number", async () => {
    dl.downloadFile.mockRejectedValueOnce(new Error("Download exceeds 25 MB: https://cdn.example/big.png"))
    expect(await refusal(() => fetchVideoOverlayImage("https://cdn.example/big.png", "/tmp/x", { layer: 0, slot: 4 }))).toBe("Layer 4: image is larger than 25 MB")
  })
  it("downloads with the per-file byte cap", async () => {
    dl.downloadFile.mockResolvedValueOnce(undefined)
    await fetchVideoOverlayImage("https://cdn.example/a.png", "/tmp/x", { layer: 0 })
    expect(dl.downloadFile).toHaveBeenLastCalledWith("https://cdn.example/a.png", "/tmp/x", { maxBytes: 25 * 1024 * 1024 })
  })
})

describe("inspectVideoOverlayImage — header facts, no decode", () => {
  let dir: string
  const p = (n: string) => join(dir, n)
  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "vo-img-"))
    await sharp({ create: { width: 40, height: 20, channels: 4, background: "#ff00ff" } }).png().toFile(p("a.png"))
    await fs.writeFile(p("logo"), '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>')
    await fs.writeFile(p("page.png"), "<!doctype html><html><body>not an image</body></html>")
    await sharp({ create: { width: 10, height: 10, channels: 3, background: "#00ff00" } }).gif().toFile(p("a.gif"))
    await sharp({ create: { width: 400, height: 200, channels: 3, background: "#ff0000" } }).jpeg().withMetadata({ orientation: 6 }).toFile(p("exif6.jpg"))
    const frame = (c: string) => sharp({ create: { width: 16, height: 16, channels: 4, background: c } }).png().toBuffer()
    await sharp([await frame("#ff0000"), await frame("#0000ff")], { join: { animated: true } }).webp({ loop: 0 }).toFile(p("anim.webp"))
  })
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })
  it("reads a PNG", async () => {
    expect(await inspectVideoOverlayImage(p("a.png"))).toMatchObject({ svg: false, decodable: true, format: "png", width: 40, height: 20 })
  })
  it("sniffs an SVG whatever its name (sharp would rasterise it)", async () => {
    expect(await inspectVideoOverlayImage(p("logo"))).toMatchObject({ svg: true, decodable: false })
  })
  it("HTML saved as .png is not decodable", async () => {
    expect(await inspectVideoOverlayImage(p("page.png"))).toMatchObject({ svg: false, decodable: false })
  })
  it("reports GIF, the EXIF orientation and the page count", async () => {
    expect((await inspectVideoOverlayImage(p("a.gif"))).format).toBe("gif")
    expect(await inspectVideoOverlayImage(p("exif6.jpg"))).toMatchObject({ format: "jpeg", width: 400, height: 200, orientation: 6 })
    expect((await inspectVideoOverlayImage(p("anim.webp"))).pages).toBe(2)
  })
})

describe("gateVideoOverlayImage — spec §4.2 step 5, in order", () => {
  const png = (over: Partial<VideoOverlayImageFacts> = {}): VideoOverlayImageFacts => ({ bytes: 1000, svg: false, decodable: true, format: "png", width: 400, height: 200, ...over })
  const zero = { bytes: 0, pixels: 0 }
  it("passes a PNG and returns its display aspect and the new totals", () => {
    expect(gateVideoOverlayImage(png(), zero, { layer: 0 })).toEqual({ aspect: 2, totals: { bytes: 1000, pixels: 80_000 } })
  })
  it("EXIF 6 swaps the axes (display aspect 0.5)", () => {
    expect(gateVideoOverlayImage(png({ format: "jpeg", orientation: 6 }), zero, { layer: 0 }).aspect).toBe(0.5)
  })
  it("Σ bytes over 100 MB", async () => {
    expect(await refusal(() => gateVideoOverlayImage(png({ bytes: 60 * 1024 * 1024 }), { bytes: 60 * 1024 * 1024, pixels: 0 }, { layer: 1 }))).toBe("Layers total more than 100 MB")
  })
  it("SVG", async () => {
    expect(await refusal(() => gateVideoOverlayImage(png({ svg: true, decodable: false }), zero, { layer: 2 }))).toBe(
      "layers[2]: SVG images are not supported by Video Overlay yet — rasterise it with Image Overlay first",
    )
  })
  it("not decodable, or not PNG / JPEG / WebP", async () => {
    expect(await refusal(() => gateVideoOverlayImage(png({ decodable: false }), zero, { layer: 0, slot: 3 }))).toBe("Layer 3: not an image (PNG, JPEG or WebP)")
    expect(await refusal(() => gateVideoOverlayImage(png({ format: "gif" }), zero, { layer: 0 }))).toBe("layers[0]: not an image (PNG, JPEG or WebP)")
  })
  it("an edge over 8192 px", async () => {
    expect(await refusal(() => gateVideoOverlayImage(png({ width: 8193, height: 10 }), zero, { layer: 0 }))).toBe("layers[0]: image exceeds 8192 px")
  })
  it("Σ source pixels over 400 MP", async () => {
    let totals = zero
    for (let i = 0; i < 6; i++) totals = gateVideoOverlayImage(png({ width: 8000, height: 8000 }), totals, { layer: i }).totals
    expect(await refusal(() => gateVideoOverlayImage(png({ width: 8000, height: 8000 }), totals, { layer: 6 }))).toBe("Layers total more than 400 megapixels")
  })
  it("an animated WebP renders its first frame with a warning (D1 / D9)", () => {
    expect(gateVideoOverlayImage(png({ format: "webp", pages: 2 }), zero, { layer: 1, slot: 2 }).warning).toEqual({
      layer: 1, slot: 2, code: "animated_first_frame", detail: "animated image (2 frames): its first frame is used",
    })
  })
})
