// @test-watches backend/src/lib/__tests__/fixtures/svg/**
/**
 * A GIF or an SVG wired into an image node reaches the model as a PNG still:
 * a GIF's first frame, an SVG drawn (made safe first), large enough to read.
 * Only an address that names one is read; every other input passes untouched.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  uploadBufferToR2: vi.fn(),
}))
vi.mock("../safe-fetch.js", () => ({ safeFetch: mocks.safeFetch }))
vi.mock("../storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../storage.js")>()),
  uploadBufferToR2: mocks.uploadBufferToR2,
}))

import sharp from "sharp"
import { namesGifOrSvg, stillInputImage, stillInputImages, stillPngOf } from "../still-input-image.js"

const teapot = readFileSync(join(__dirname, "fixtures", "svg", "teapot-2880.svg"))
let gif: Buffer
let png: Buffer

beforeAll(async () => {
  const frame = (c: string) => sharp({ create: { width: 40, height: 30, channels: 3, background: c } }).png().toBuffer()
  gif = await sharp([await frame("#ff0000"), await frame("#0000ff")], { join: { animated: true } }).gif().toBuffer()
  png = await frame("#ffffff")
})

const serve = (body: Buffer) =>
  mocks.safeFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => body })
const uploaded = () => mocks.uploadBufferToR2.mock.calls.at(-1) as [Buffer, string, string] | undefined

beforeEach(() => {
  vi.clearAllMocks()
  mocks.uploadBufferToR2.mockImplementation(async (_b: Buffer, key: string) => `https://cdn.test/${key}`)
})

describe("which inputs are read", () => {
  it("an http(s) address whose path ends in .gif or .svg", () => {
    expect(namesGifOrSvg("https://cdn.nodaro.ai/images/a.gif")).toBe(true)
    expect(namesGifOrSvg("https://cdn.nodaro.ai/images/a.SVG?x=1")).toBe(true)
    for (const other of ["https://cdn.nodaro.ai/images/a.png", "https://x/a.gif.png", "task-123", "data:image/gif;base64,R0lG", undefined]) {
      expect(namesGifOrSvg(other)).toBe(false)
    }
  })

  it("any other input is not fetched, and the list keeps its order", async () => {
    const urls = ["https://cdn/a.png", "https://cdn/b.webp"]
    expect(await stillInputImages(urls)).toEqual(urls)
    expect(await stillInputImages(undefined)).toBeUndefined()
    expect(mocks.safeFetch).not.toHaveBeenCalled()
  })
})

describe("the still", () => {
  it("a GIF is sent as its first frame, a PNG", async () => {
    serve(gif)
    const out = await stillInputImage("https://cdn.nodaro.ai/images/job.gif")
    const [bytes, key, type] = uploaded()!
    expect(out).toBe(`https://cdn.test/${key}`)
    expect(type).toBe("image/png")
    const meta = await sharp(bytes).metadata()
    expect([meta.format, meta.width, meta.height, meta.pages ?? 1]).toEqual(["png", 40, 30, 1])
    const { data } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true })
    expect([data[0], data[1], data[2]]).toEqual([255, 0, 0])
  })

  // Drawing and encoding 2880 x 2880 takes seconds on a loaded runner.
  it("an SVG is drawn at its own size (the sample: 2880 a side)", { timeout: 60_000 }, async () => {
    serve(teapot)
    await stillInputImage("https://cdn.nodaro.ai/images/job.svg")
    const meta = await sharp(uploaded()![0]).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 2880, 2880])
  })

  it("a small SVG is drawn large enough to read, never past the cap", async () => {
    const small = await stillPngOf(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150"><rect width="300" height="150" fill="red"/></svg>`))
    const meta = await sharp(small!).metadata()
    expect([meta.width, meta.height]).toEqual([1024, 512])
  })

  it("an SVG is made safe before it is drawn: nothing it names outside itself is fetched", async () => {
    const out = await stillPngOf(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><image href="https://evil.example/x.png" width="64" height="64"/><rect width="10" height="10"/></svg>`))
    expect((await sharp(out!).metadata()).format).toBe("png")
    expect(mocks.safeFetch).not.toHaveBeenCalled()
  })

  it("a file named .gif that is not a GIF is sent as it is", async () => {
    serve(png)
    expect(await stillInputImage("https://cdn.nodaro.ai/images/job.gif")).toBe("https://cdn.nodaro.ai/images/job.gif")
    expect(mocks.uploadBufferToR2).not.toHaveBeenCalled()
  })

  it("an input that cannot be read fails the run before the provider is called, with a plain error", async () => {
    serve(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>`))
    await expect(stillInputImage("https://cdn.nodaro.ai/images/job.svg")).rejects.toThrow("could not be read")
    mocks.safeFetch.mockResolvedValueOnce({ ok: false, status: 404, headers: new Headers(), arrayBuffer: async () => Buffer.alloc(0) })
    await expect(stillInputImage("https://example.com/job.gif")).rejects.toThrow("could not be downloaded")
  })
})
