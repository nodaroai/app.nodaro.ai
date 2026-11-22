import { describe, it, expect, vi, beforeEach } from "vitest"
import sharp from "sharp"

// A picture under a model's minimum side is ENLARGED to it by the one input
// step every KIE image takes (`ensureImageForProvider`), never refused for its
// size alone. A staging Video Remake run failed on a Kling 4 child whose
// 281×369 start frame met "kling-4 requires images at least 300×300px".
// Real `sharp` on real buffers: the sizes are what decide.

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  uploadBufferToR2: vi.fn(),
}))
vi.mock("../../../lib/safe-fetch.js", () => ({ safeFetch: mocks.safeFetch }))
vi.mock("../../../lib/storage.js", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  uploadBufferToR2: mocks.uploadBufferToR2,
}))

const { ensureImageForProvider } = await import("../video.js")

const URL_IN = "https://elsewhere.example/frame"
/** What `runKling4` sends every image with (KIE: each side 300+ px, aspect 0.4–2.5; our 2048 px cap). */
const KLING_4 = { context: "Video generation", maxDimension: 2048, minDimension: 300, minAspectRatio: 0.4, maxAspectRatio: 2.5 }

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "#c8285a" } })

function serve(buffer: Buffer) {
  mocks.safeFetch.mockResolvedValue({
    ok: true,
    status: 200,
    body: { cancel: async () => {} },
    arrayBuffer: async () => buffer,
  })
}

const uploaded = () => mocks.uploadBufferToR2.mock.calls.at(-1) as [Buffer, string, string]
const sizeOf = async (buf: Buffer) => {
  const m = await sharp(buf).metadata()
  return { format: m.format, width: m.width, height: m.height }
}

describe("a picture under the model's minimum side is enlarged", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.uploadBufferToR2.mockImplementation(async (_b: Buffer, key: string) => `https://cdn.test/${key}`)
  })

  it("kling-4: a 281×369 PNG start frame goes as a 300×394 PNG", async () => {
    serve(await solid(281, 369).png().toBuffer())

    const out = await ensureImageForProvider(`${URL_IN}.png`, "kling-4", { ...KLING_4, inputLabel: "start frame" })

    expect(out).not.toBe(`${URL_IN}.png`)
    const [buf, key, type] = uploaded()
    expect(key).toMatch(/provider-enlarged.*\.png$/)
    expect(type).toBe("image/png")
    expect(await sizeOf(buf)).toEqual({ format: "png", width: 300, height: 394 })
  })

  it("a JPEG stays a JPEG, and its metadata is not carried", async () => {
    serve(await solid(281, 369).withMetadata({ exif: { IFD0: { Software: "Generator" } } }).jpeg().toBuffer())

    await ensureImageForProvider(`${URL_IN}.jpg`, "kling-4", KLING_4)

    const [buf] = uploaded()
    expect(await sizeOf(buf)).toEqual({ format: "jpeg", width: 300, height: 394 })
    expect((await sharp(buf).metadata()).exif).toBeUndefined()
  })

  it("a WebP to a JPG/PNG-only model is enlarged and converted in one pass", async () => {
    serve(await solid(200, 250).webp({ lossless: true }).toBuffer())

    await ensureImageForProvider(`${URL_IN}.webp`, "kling-4", KLING_4)

    const [buf] = uploaded()
    expect(await sizeOf(buf)).toEqual({ format: "png", width: 300, height: 375 })
  })

  it("a quarter-turned photo is measured and enlarged upright", async () => {
    // Stored 369×281 with EXIF orientation 6: shown 281×369.
    serve(await solid(369, 281).withMetadata({ orientation: 6 }).jpeg().toBuffer())

    await ensureImageForProvider(`${URL_IN}.jpg`, "kling-4", KLING_4)

    const [buf] = uploaded()
    expect(await sizeOf(buf)).toEqual({ format: "jpeg", width: 300, height: 394 })
  })

  it("a tiny 50×50 picture is enlarged to 300×300 (no smallest starting size)", async () => {
    serve(await solid(50, 50).png().toBuffer())

    await ensureImageForProvider(`${URL_IN}.png`, "kling-4", KLING_4)

    expect(await sizeOf(uploaded()[0])).toEqual({ format: "png", width: 300, height: 300 })
  })

  it("at the max boundary: a long side landing exactly on the cap is sent, one past it is refused", async () => {
    const wide = { context: "Video generation", maxDimension: 2048, minDimension: 400 }
    serve(await solid(1024, 200).png().toBuffer())
    await ensureImageForProvider(`${URL_IN}.png`, "happyhorse-ref2v", wide)
    expect(await sizeOf(uploaded()[0])).toEqual({ format: "png", width: 2048, height: 400 })

    mocks.uploadBufferToR2.mockClear()
    serve(await solid(1025, 200).png().toBuffer())
    await expect(ensureImageForProvider(`${URL_IN}.png`, "happyhorse-ref2v", wide)).rejects.toThrow(/longer side would be 2050|longer side 2050/)
    expect(mocks.uploadBufferToR2).not.toHaveBeenCalled()
  })

  it("an aspect-bounded model: a small picture inside the bounds is enlarged, one outside them is refused for its shape", async () => {
    // Wan 3.0: each side 240+ px, aspect up to 8:1.
    const wan3 = { context: "Video generation", maxDimension: 2048, minDimension: 240, minAspectRatio: 0.125, maxAspectRatio: 8 }
    serve(await solid(800, 100).png().toBuffer())
    await ensureImageForProvider(`${URL_IN}.png`, "wan-3", wan3)
    expect(await sizeOf(uploaded()[0])).toEqual({ format: "png", width: 1920, height: 240 })

    mocks.uploadBufferToR2.mockClear()
    serve(await solid(900, 100).png().toBuffer())
    await expect(ensureImageForProvider(`${URL_IN}.png`, "wan-3", wan3)).rejects.toThrow(/900×100/)
    expect(mocks.uploadBufferToR2).not.toHaveBeenCalled()
  })

  it("a picture whose pixel grid is held (an inpainting mask is aligned to it) is refused, not resized", async () => {
    serve(await solid(281, 369).png().toBuffer())
    await expect(
      ensureImageForProvider(`${URL_IN}.png`, "kling-4", { ...KLING_4, preserveGeometry: true }),
    ).rejects.toThrow(/mask/)
  })

  it("the over-size-cap fallback scales the UPRIGHT picture: a quarter-turned photo comes out like the same photo stored upright", async () => {
    // Noise no JPEG quality can bring under a 10 KB cap, so the last step (a
    // resize sized from the picture's width) runs. Stored 480×240 with EXIF
    // orientation 6, it is shown 240×480; capped at 400 px it is 200×400.
    const constraints = { context: "Video generation", maxDimension: 400, maxBytes: 10_000 }
    const noisy = sharp({ create: { width: 480, height: 240, channels: 3, background: "#000", noise: { type: "gaussian", mean: 128, sigma: 60 } } })
    const turned = await noisy.withMetadata({ orientation: 6 }).jpeg({ quality: 95 }).toBuffer()
    const upright = await sharp(turned).rotate().jpeg({ quality: 95 }).toBuffer()

    serve(turned)
    await ensureImageForProvider(`${URL_IN}.jpg`, "kling-4", constraints)
    const fromTurned = await sizeOf(uploaded()[0])
    serve(upright)
    await ensureImageForProvider(`${URL_IN}.jpg`, "kling-4", constraints)
    const fromUpright = await sizeOf(uploaded()[0])

    expect(fromTurned.height!).toBeGreaterThan(fromTurned.width!)
    expect(fromTurned.height!).toBeLessThan(400)
    // Same picture, same ladder: within a few percent (sizing from the stored
    // 480 px width instead would make it twice as wide).
    expect(Math.abs(fromTurned.width! - fromUpright.width!) / fromUpright.width!).toBeLessThan(0.1)
  })

  it("a picture already at the minimum is sent as it is", async () => {
    serve(await solid(300, 300).png().toBuffer())
    expect(await ensureImageForProvider(`${URL_IN}.png`, "kling-4", KLING_4)).toBe(`${URL_IN}.png`)
    expect(mocks.uploadBufferToR2).not.toHaveBeenCalled()
  })
})
