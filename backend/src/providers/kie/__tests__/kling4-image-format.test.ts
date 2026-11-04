import { describe, it, expect, vi, beforeEach } from "vitest"
import sharp from "sharp"
import { imageHasMetadata } from "../../../lib/image-metadata.js"

// Kling 4.0 takes JPG and PNG only: KIE fails the task with "Unsupported file
// format. Images must be JPG or PNG." A WebP goes to it as a PNG, exact to the
// pixel and with its transparency, and nothing else it converts changes format.
// Real `sharp` on real buffers: the format is what decides.

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

const URL_IN = "https://elsewhere.example/ref"
const CONSTRAINTS = { context: "Video generation", maxDimension: 2048 }

const solid = (width = 640, height = 360) => sharp({ create: { width, height, channels: 3, background: "#c8285a" } })
const seeThrough = () =>
  sharp({ create: { width: 64, height: 36, channels: 4, background: { r: 200, g: 40, b: 90, alpha: 0.5 } } })
/** Noise no format can shrink: its PNG is over the 10 MB cap. */
const noise = () =>
  sharp({ create: { width: 2048, height: 2048, channels: 3, background: "#000", noise: { type: "gaussian", mean: 128, sigma: 60 } } })

const pixels = (image: Buffer) => sharp(image).ensureAlpha().raw().toBuffer()

function serve(buffer: Buffer) {
  mocks.safeFetch.mockResolvedValue({
    ok: true,
    status: 200,
    body: { cancel: async () => {} },
    arrayBuffer: async () => buffer,
  })
}

const uploaded = () => mocks.uploadBufferToR2.mock.calls.at(-1) as [Buffer, string, string]

describe.each(["kling-4", "kling-4-keyframes"])("%s takes JPG and PNG only", (provider) => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.uploadBufferToR2.mockImplementation(async (_b: Buffer, key: string) => `https://cdn.test/${key}`)
  })

  it("converts a WebP that needs nothing else to a PNG with the same pixels", async () => {
    const webp = await solid().webp({ lossless: true }).toBuffer()
    serve(webp)

    const out = await ensureImageForProvider(`${URL_IN}.webp`, provider, CONSTRAINTS)

    expect(out).not.toBe(`${URL_IN}.webp`)
    const [buf, key, type] = uploaded()
    expect(key).toMatch(/provider-converted.*\.png$/)
    expect(type).toBe("image/png")
    expect((await sharp(buf).metadata()).format).toBe("png")
    expect((await pixels(buf)).equals(await pixels(webp))).toBe(true)
  })

  it("keeps a WebP's transparency in the PNG", async () => {
    const webp = await seeThrough().webp({ lossless: true }).toBuffer()
    serve(webp)

    await ensureImageForProvider(`${URL_IN}.webp`, provider, CONSTRAINTS)

    const [buf] = uploaded()
    expect((await sharp(buf).metadata()).hasAlpha).toBe(true)
    expect((await pixels(buf)).equals(await pixels(webp))).toBe(true)
  })

  it("makes a WebP over the size limit a PNG at the limit", async () => {
    serve(await solid(1920, 2880).webp().toBuffer())

    await ensureImageForProvider(`${URL_IN}.webp`, provider, CONSTRAINTS)

    const [buf, key] = uploaded()
    expect(key).toMatch(/provider-converted.*\.png$/)
    const meta = await sharp(buf).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 1365, 2048])
  })

  it("converts a WebP with metadata to a PNG without it, never a stripped WebP", async () => {
    const tagged = await solid().withMetadata({ exif: { IFD0: { Software: "Generator" } } }).webp().toBuffer()
    expect(imageHasMetadata(tagged, "webp")).toBe(true)
    serve(tagged)

    await ensureImageForProvider(`${URL_IN}.webp`, provider, CONSTRAINTS)

    const [buf, key] = uploaded()
    expect(key).toMatch(/provider-converted.*\.png$/)
    expect(imageHasMetadata(buf, "png")).toBe(false)
  })

  it("falls back to a JPEG when the WebP's PNG would be over the 10 MB cap", async () => {
    const webp = await noise().webp({ lossless: true }).toBuffer()
    expect((await sharp(webp).png({ compressionLevel: 9 }).toBuffer()).length).toBeGreaterThan(10 * 1024 * 1024)
    serve(webp)

    await ensureImageForProvider(`${URL_IN}.webp`, provider, CONSTRAINTS)

    const [buf, key] = uploaded()
    expect(key).toMatch(/provider-converted.*\.jpg$/)
    expect((await sharp(buf).metadata()).format).toBe("jpeg")
    expect(buf.length).toBeLessThanOrEqual(10 * 1024 * 1024)
  }, 30_000)

  it("keeps a clean JPEG and a clean PNG as they are", async () => {
    serve(await solid().jpeg().toBuffer())
    await expect(ensureImageForProvider(`${URL_IN}.jpg`, provider, CONSTRAINTS)).resolves.toBe(`${URL_IN}.jpg`)

    serve(await solid().png().toBuffer())
    await expect(ensureImageForProvider(`${URL_IN}.png`, provider, CONSTRAINTS)).resolves.toBe(`${URL_IN}.png`)

    expect(mocks.uploadBufferToR2).not.toHaveBeenCalled()
  })

  it("still makes a PNG over the size limit a JPEG, as finished runs send", async () => {
    serve(await solid(3312, 2480).png().toBuffer())

    await ensureImageForProvider(`${URL_IN}.png`, provider, CONSTRAINTS)

    const [, key, type] = uploaded()
    expect(key).toMatch(/provider-converted.*\.jpg$/)
    expect(type).toBe("image/jpeg")
  })
})

describe("kling-3.0 takes JPG and PNG only", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.uploadBufferToR2.mockImplementation(async (_b: Buffer, key: string) => `https://cdn.test/${key}`)
  })

  it("still converts a WebP to a JPEG", async () => {
    serve(await solid().webp().toBuffer())

    await ensureImageForProvider(`${URL_IN}.webp`, "kling-3.0", CONSTRAINTS)

    const [, key, type] = uploaded()
    expect(key).toMatch(/provider-converted.*\.jpg$/)
    expect(type).toBe("image/jpeg")
  })
})
