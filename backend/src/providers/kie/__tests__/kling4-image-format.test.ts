import { describe, it, expect, vi, beforeEach } from "vitest"
import sharp from "sharp"
import { imageHasMetadata } from "../../../lib/image-metadata.js"

// Kling 4.0 takes JPG and PNG only: KIE fails the task with "Unsupported file
// format. Images must be JPG or PNG." A WebP that needed no resize used to pass
// through as it was. Real `sharp` on real buffers: the format is what decides.

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

const solid = () => sharp({ create: { width: 640, height: 360, channels: 3, background: "#c8285a" } })

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

  it("converts a WebP that needs nothing else to a JPEG", async () => {
    serve(await solid().webp().toBuffer())

    const out = await ensureImageForProvider(`${URL_IN}.webp`, provider, { context: "Video generation", maxDimension: 2048 })

    expect(out).not.toBe(`${URL_IN}.webp`)
    const [buf, key, type] = uploaded()
    expect(key).toMatch(/provider-converted.*\.jpg$/)
    expect(type).toBe("image/jpeg")
    expect((await sharp(buf).metadata()).format).toBe("jpeg")
  })

  it("converts a WebP with metadata to a JPEG without it, never a stripped WebP", async () => {
    const tagged = await solid().withMetadata({ exif: { IFD0: { Software: "Generator" } } }).webp().toBuffer()
    expect(imageHasMetadata(tagged, "webp")).toBe(true)
    serve(tagged)

    await ensureImageForProvider(`${URL_IN}.webp`, provider, { context: "Video generation", maxDimension: 2048 })

    const [buf, key] = uploaded()
    expect(key).toMatch(/provider-converted.*\.jpg$/)
    expect(imageHasMetadata(buf, "jpeg")).toBe(false)
  })

  it("keeps a clean JPEG and a clean PNG as they are", async () => {
    serve(await solid().jpeg().toBuffer())
    await expect(ensureImageForProvider(`${URL_IN}.jpg`, provider, { context: "Video generation", maxDimension: 2048 })).resolves.toBe(`${URL_IN}.jpg`)

    serve(await solid().png().toBuffer())
    await expect(ensureImageForProvider(`${URL_IN}.png`, provider, { context: "Video generation", maxDimension: 2048 })).resolves.toBe(`${URL_IN}.png`)

    expect(mocks.uploadBufferToR2).not.toHaveBeenCalled()
  })
})
