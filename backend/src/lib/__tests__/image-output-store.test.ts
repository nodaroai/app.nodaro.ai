// @test-watches backend/src/lib/__tests__/fixtures/svg/**
/**
 * An image a run asked for as JPEG, WebP, a GIF or an SVG is stored as what its
 * bytes are: its extension and content type, a free account's watermark in its
 * format, an SVG made safe first (or the job refused, refunded), and a PNG
 * still of a GIF or an SVG.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  uploadBufferToR2: vi.fn(),
  discardOwnedKeys: vi.fn(async () => {}),
  // A fake bucket: what each key holds (getR2ObjectSize reads it).
  objects: new Map<string, number>(),
  updateStorageUsage: vi.fn(async () => {}),
  // The stored-image cap, lowered by the oversize tests below.
  imageCap: { bytes: 25 * 1024 * 1024 },
}))
vi.mock("../safe-fetch.js", () => ({ safeFetch: mocks.safeFetch }))
vi.mock("../../utils/file-validation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/file-validation.js")>()
  return { ...actual, updateStorageUsage: mocks.updateStorageUsage, getSizeLimit: (category: string) => (category === "image" ? mocks.imageCap.bytes : actual.getSizeLimit(category as never)) }
})
vi.mock("../discard-job-copies.js", () => ({ discardOwnedKeys: mocks.discardOwnedKeys }))
vi.mock("../storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../storage.js")>()),
  uploadBufferToR2: mocks.uploadBufferToR2,
  getR2ObjectSize: async (key: string) => mocks.objects.get(key) ?? 0,
}))

import sharp from "sharp"
import { discardUndeliveredImages, imageStoredAsItsBytes, requestedImageFormat, sniffImageFormat, storeFormattedImages } from "../image-output-store.js"
import { SVG_REFUSED_MESSAGE } from "../svg-sanitize.js"
import { isDeterministicJobError } from "../deterministic-job-error.js"
import { isPostProcessingError } from "../post-processing-error.js"

const JOB = "00000000-0000-4000-8000-00000000abcd"
const FIXTURES = join(__dirname, "fixtures", "svg")
const luna = readFileSync(join(FIXTURES, "luna-1k.svg"))

let gif: Buffer
let png: Buffer
let jpeg: Buffer
let webp: Buffer

beforeAll(async () => {
  const frame = (c: string) => sharp({ create: { width: 32, height: 32, channels: 3, background: c } }).png().toBuffer()
  gif = await sharp([await frame("#f00"), await frame("#00f"), await frame("#0f0")], { join: { animated: true } }).gif({ delay: [200, 200, 200], loop: 0 }).toBuffer()
  png = await frame("#fff")
  jpeg = await sharp(png).jpeg().toBuffer()
  webp = await sharp(png).webp().toBuffer()
})

function serve(...bodies: Buffer[]) {
  for (const body of bodies) {
    mocks.safeFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => body })
  }
}

const uploads = () => mocks.uploadBufferToR2.mock.calls as Array<[Buffer, string, string, string | undefined]>

beforeEach(() => {
  vi.clearAllMocks()
  mocks.imageCap.bytes = 25 * 1024 * 1024
  mocks.objects.clear()
  mocks.uploadBufferToR2.mockImplementation(async (b: Buffer, key: string) => {
    mocks.objects.set(key, b.length)
    return `https://cdn.test/${key}`
  })
})

describe("which images take this path", () => {
  it("a run that asked for any format but PNG", () => {
    for (const f of ["jpeg", "webp", "gif", "svg"]) expect(requestedImageFormat({ outputFormat: f })).toBe(f)
    for (const input of [{ outputFormat: "png" }, {}, null, undefined, { outputFormat: "tiff" }, { outputFormat: 3 }]) {
      expect(requestedImageFormat(input as Record<string, unknown> | null | undefined)).toBeUndefined()
    }
  })

  it("every run of Kling Image 4.0, whose format follows its size, whatever it asked for", () => {
    for (const input of [{ resolvedModel: "kling-image-4" }, { provider: "kling-image-4-i2i" }, { model: "kling-image-4" }, { provider: "kling-image-4", outputFormat: "png" }]) {
      expect(imageStoredAsItsBytes(input), JSON.stringify(input)).toBe(true)
    }
    expect(imageStoredAsItsBytes({ outputFormat: "jpeg", provider: "seedream-5-5" })).toBe(true)
    for (const input of [{ provider: "seedream-5-5" }, { provider: "kling-4" }, { resolvedModel: "nano-banana-pro", outputFormat: "png" }, {}, null, undefined]) {
      expect(imageStoredAsItsBytes(input as Record<string, unknown> | null | undefined), JSON.stringify(input)).toBe(false)
    }
  })

  it("reads the format from the file's own bytes", () => {
    expect([png, jpeg, webp, gif, luna].map(sniffImageFormat)).toEqual(["png", "jpeg", "webp", "gif", "svg"])
    expect(sniffImageFormat(Buffer.from("not an image"))).toBeUndefined()
  })
})

describe("stored as what it is", () => {
  it("a GIF: .gif, image/gif, every frame kept, with a PNG still of its first frame", async () => {
    serve(gif)
    const out = await storeFormattedImages({ sourceUrls: ["https://kie/x.gif"], jobId: JOB, userId: "u1", watermark: false })
    expect(out).toMatchObject({ format: "gif", mimeType: "image/gif", urls: [`https://cdn.test/images/${JOB}.gif`], thumbnailUrl: `https://cdn.test/images/${JOB}-still.png` })
    const [[stored, key, type, user], [still, stillKey, stillType]] = uploads()
    expect([key, type, user]).toEqual([`images/${JOB}.gif`, "image/gif", "u1"])
    expect(stored.equals(gif)).toBe(true)
    expect([stillKey, stillType]).toEqual([`images/${JOB}-still.png`, "image/png"])
    const meta = await sharp(still).metadata()
    expect([meta.format, meta.width, meta.height, meta.pages ?? 1]).toEqual(["png", 32, 32, 1])
  })

  it("a free account's GIF is watermarked on every frame and stays animated", async () => {
    serve(gif)
    await storeFormattedImages({ sourceUrls: ["https://kie/x.gif"], jobId: JOB, userId: "u1", watermark: true })
    const [stored] = uploads()[0]!
    const meta = await sharp(stored, { animated: true }).metadata()
    expect([meta.format, meta.pages, meta.pageHeight, meta.delay]).toEqual(["gif", 3, 32, [200, 200, 200]])
    expect(stored.equals(gif)).toBe(false)
  })

  it("an SVG: made safe, .svg, image/svg+xml, drawn the same, with a PNG still", async () => {
    const dirty = Buffer.from(luna.toString("utf8").replace("<title>", `<script>alert(1)</script><title>`))
    serve(dirty)
    const out = await storeFormattedImages({ sourceUrls: ["https://kie/x.svg"], jobId: JOB, userId: undefined, watermark: false })
    expect(out).toMatchObject({ format: "svg", mimeType: "image/svg+xml", urls: [`https://cdn.test/images/${JOB}.svg`] })
    const [[stored, key, type], [still]] = uploads()
    expect([key, type]).toEqual([`images/${JOB}.svg`, "image/svg+xml"])
    expect(stored.toString("utf8")).not.toContain("<script")
    const drawn = await sharp(stored).metadata()
    expect([drawn.width, drawn.height]).toEqual([1024, 1024])
    expect((await sharp(still).metadata()).format).toBe("png")
  })

  it("a free account's SVG carries the watermark as text in the drawing", async () => {
    serve(luna)
    await storeFormattedImages({ sourceUrls: ["https://kie/x.svg"], jobId: JOB, userId: "u1", watermark: true })
    const svg = uploads()[0]![0].toString("utf8")
    expect(svg).toContain("Nodaro.ai")
    expect((svg.match(/<text\b/g) ?? []).length).toBe((luna.toString("utf8").match(/<text\b/g) ?? []).length + 1)
  })

  it("a free account's SVG mark is outlined: its PNG still shows it on a white drawing", async () => {
    const white = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400"><rect width="400" height="400" fill="#ffffff"/></svg>`)
    serve(white)
    await storeFormattedImages({ sourceUrls: ["https://kie/x.svg"], jobId: JOB, userId: "u1", watermark: true })
    const [[stored], [still]] = uploads()
    expect(stored.toString("utf8")).toContain('paint-order="stroke"')
    const { data, info } = await sharp(still).extract({ left: 260, top: 360, width: 140, height: 40 }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    let darkest = 255
    for (let i = 0; i < data.length; i += info.channels) darkest = Math.min(darkest, (data[i]! + data[i + 1]! + data[i + 2]!) / 3)
    expect(darkest).toBeLessThan(160)
  })

  it("an SVG written without its namespace is repaired, cleaned and stored", async () => {
    serve(Buffer.from(`<svg viewBox="0 0 10 10" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>`))
    const out = await storeFormattedImages({ sourceUrls: ["https://kie/x.svg"], jobId: JOB, userId: "u1", watermark: false })
    expect(out.mimeType).toBe("image/svg+xml")
    const svg = uploads()[0]![0].toString("utf8")
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).not.toContain("<script")
  })

  it("JPEG and WebP: .jpg / .webp with their types, and no still", async () => {
    serve(jpeg, webp)
    const out = await storeFormattedImages({ sourceUrls: ["https://kie/a", "https://kie/b"], jobId: JOB, userId: "u1", watermark: false })
    expect(out).toMatchObject({ format: "jpeg", mimeType: "image/jpeg", urls: [`https://cdn.test/images/${JOB}.jpg`, `https://cdn.test/images/${JOB}-v1.webp`] })
    expect(out.thumbnailUrl).toBeUndefined()
    expect(uploads().map(([, key, type]) => [key, type])).toEqual([[`images/${JOB}.jpg`, "image/jpeg"], [`images/${JOB}-v1.webp`, "image/webp"]])
  })

  it("a file that is not what was asked for is labelled as what it is", async () => {
    serve(png)
    const out = await storeFormattedImages({ sourceUrls: ["https://kie/x.gif"], jobId: JOB, userId: "u1", watermark: false })
    expect(out).toMatchObject({ format: "png", mimeType: "image/png", urls: [`https://cdn.test/images/${JOB}.png`] })
  })
})

describe("a set is stored one picture at a time, and a file over the cap is made to fit", () => {
  it("stores a set's pictures in order, never two at once", async () => {
    serve(jpeg, png, jpeg)
    let inFlight = 0
    let most = 0
    mocks.uploadBufferToR2.mockImplementation(async (_b: Buffer, key: string) => {
      inFlight++
      most = Math.max(most, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return `https://cdn.test/${key}`
    })
    const out = await storeFormattedImages({ sourceUrls: ["https://kie/1", "https://kie/2", "https://kie/3"], jobId: JOB, userId: "u1", watermark: true, isSet: true })
    expect(most).toBe(1)
    expect(out.urls).toEqual([`https://cdn.test/images/${JOB}.jpg`, `https://cdn.test/images/${JOB}-v1.png`, `https://cdn.test/images/${JOB}-v2.jpg`])
  })

  it("a PNG over the cap is stored as the WebP it is re-encoded to, its size kept", async () => {
    const big = await sharp({ create: { width: 256, height: 256, channels: 4, background: { r: 10, g: 200, b: 30, alpha: 0.5 } } }).png({ compressionLevel: 0 }).toBuffer()
    mocks.imageCap.bytes = big.length - 1
    serve(big)
    const out = await storeFormattedImages({ sourceUrls: ["https://kie/4k.png"], jobId: JOB, userId: "u1", watermark: false })
    expect(out).toMatchObject({ format: "webp", mimeType: "image/webp", urls: [`https://cdn.test/images/${JOB}.webp`] })
    const [stored] = uploads()[0]!
    const meta = await sharp(stored).metadata()
    expect([meta.format, meta.width, meta.height, meta.hasAlpha]).toEqual(["webp", 256, 256, true])
  })

  it("a file under the cap is stored byte for byte", async () => {
    serve(jpeg)
    await storeFormattedImages({ sourceUrls: ["https://kie/8k.jpg"], jobId: JOB, userId: "u1", watermark: false })
    expect(uploads()[0]![0].equals(jpeg)).toBe(true)
  })

  it("a set delivers the images that stored: one that cannot be fetched, and one over the cap that cannot be fitted, are left out", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    // A GIF (never re-encoded to fit) of noise, larger than the two others.
    const noise = Buffer.from(Array.from({ length: 96 * 96 * 3 }, (_, i) => (i * 7919) % 251))
    const frame = await sharp(noise, { raw: { width: 96, height: 96, channels: 3 } }).png().toBuffer()
    const bigGif = await sharp([frame, frame], { join: { animated: true } }).gif({ delay: [100, 100], loop: 0 }).toBuffer()
    mocks.imageCap.bytes = Math.max(png.length, jpeg.length) + 1
    expect(bigGif.length).toBeGreaterThan(mocks.imageCap.bytes)
    mocks.safeFetch
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => png })
      .mockResolvedValueOnce({ ok: false, status: 502, headers: new Headers(), arrayBuffer: async () => Buffer.alloc(0) })
      .mockResolvedValueOnce({ ok: false, status: 502, headers: new Headers(), arrayBuffer: async () => Buffer.alloc(0) })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => bigGif })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => bigGif })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => jpeg })
    const out = await storeFormattedImages({ sourceUrls: ["https://kie/1", "https://kie/2", "https://kie/3", "https://kie/4"], jobId: JOB, userId: "u1", watermark: false, isSet: true })
    // Each kept at its own index's key, so a re-run stores the same objects.
    expect(out.urls).toEqual([`https://cdn.test/images/${JOB}.png`, `https://cdn.test/images/${JOB}-v3.jpg`])
    expect(out.mimeTypes).toEqual(["image/png", "image/jpeg"])
    expect(out.dropped).toBe(2)
  })

  it("a set none of whose images can be stored fails the job as final, so it is refunded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    for (let i = 0; i < 4; i++) mocks.safeFetch.mockResolvedValueOnce({ ok: false, status: 502, headers: new Headers(), arrayBuffer: async () => Buffer.alloc(0) })
    const err = await storeFormattedImages({ sourceUrls: ["https://kie/1", "https://kie/2"], jobId: JOB, userId: "u1", watermark: false, isSet: true }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect(isPostProcessingError(err)).toBe(false)
    expect(mocks.uploadBufferToR2).not.toHaveBeenCalled()
  })

  it("a set's picture that fails once is tried again and kept", async () => {
    mocks.safeFetch
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => jpeg })
      .mockResolvedValueOnce({ ok: false, status: 503, headers: new Headers(), arrayBuffer: async () => Buffer.alloc(0) })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => jpeg })
    const out = await storeFormattedImages({ sourceUrls: ["https://kie/1", "https://kie/2"], jobId: JOB, userId: "u1", watermark: false, isSet: true })
    expect(out.urls).toHaveLength(2)
    expect(out.dropped).toBe(0)
  })

  it("a set's picture whose store fails twice is left out: handed to the caller, deleted once its completion won", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.safeFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => jpeg })
    let call = 0
    mocks.uploadBufferToR2.mockImplementation(async (b: Buffer, key: string) => {
      call += 1
      // The second picture's two uploads fail; nothing lands.
      if (call === 2 || call === 3) throw new Error("upload reset")
      mocks.objects.set(key, b.length)
      return `https://cdn.test/${key}`
    })
    const out = await storeFormattedImages({ sourceUrls: ["https://kie/1", "https://kie/2"], jobId: JOB, userId: "u1", watermark: false, isSet: true })
    expect(out.dropped).toBe(1)
    // Not deleted by the store (another finalize may deliver the key): handed to the caller.
    expect(mocks.discardOwnedKeys).not.toHaveBeenCalled()
    expect([...out.undelivered.keys()]).toEqual([`images/${JOB}-v1.jpg`])
    await discardUndeliveredImages(JOB, "u1", out.undelivered, out.urls)
    expect(mocks.discardOwnedKeys).toHaveBeenCalledWith(JOB, "u1", [`images/${JOB}-v1.jpg`])
    mocks.discardOwnedKeys.mockClear()
    await discardUndeliveredImages(JOB, "u1", out.undelivered, [`https://cdn.test/images/${JOB}-v1.jpg`])
    expect(mocks.discardOwnedKeys).not.toHaveBeenCalled()
    // A set's uploads are charged by the store itself, for what the key gained.
    expect(uploads().every((c) => c[3] === undefined)).toBe(true)
    expect(mocks.updateStorageUsage.mock.calls).toEqual([["u1", jpeg.length]])
    mocks.safeFetch.mockReset()
  })

  it("a write that failed after its bytes landed is charged for them, and its retry onto the same key adds nothing", async () => {
    mocks.safeFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => jpeg })
    let call = 0
    mocks.uploadBufferToR2.mockImplementation(async (b: Buffer, key: string) => {
      call += 1
      mocks.objects.set(key, b.length)
      if (call === 1) throw new Error("reset after the write")
      return `https://cdn.test/${key}`
    })
    const out = await storeFormattedImages({ sourceUrls: ["https://kie/1", "https://kie/2"], jobId: JOB, userId: "u1", watermark: false, isSet: true })
    expect(out.urls).toEqual([`https://cdn.test/images/${JOB}.jpg`, `https://cdn.test/images/${JOB}-v1.jpg`])
    const charged = mocks.updateStorageUsage.mock.calls.reduce((n, c) => n + ((c as unknown[])[1] as number), 0)
    expect(charged).toBe(2 * jpeg.length)
    expect(mocks.discardOwnedKeys).not.toHaveBeenCalled()
    mocks.safeFetch.mockReset()
  })

  it("two finalize attempts storing the same set's keys charge them once in all", async () => {
    mocks.safeFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => jpeg })
    const run = () => storeFormattedImages({ sourceUrls: ["https://kie/1", "https://kie/2"], jobId: JOB, userId: "u1", watermark: false, isSet: true })
    await run()
    // A takeover re-stores the same keys (the first attempt outlived its claim).
    await run()
    const charged = mocks.updateStorageUsage.mock.calls.reduce((n, c) => n + ((c as unknown[])[1] as number), 0)
    expect(charged).toBe(2 * jpeg.length)
    mocks.safeFetch.mockReset()
  })

  it("a refused SVG in a set deletes the pictures already stored and gives them back", async () => {
    mocks.safeFetch
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => jpeg })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"></svg>`) })
    const err = await storeFormattedImages({ sourceUrls: ["https://kie/1", "https://kie/2"], jobId: JOB, userId: "u1", watermark: false, isSet: true }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect(mocks.discardOwnedKeys).toHaveBeenCalledTimes(1)
    expect((mocks.discardOwnedKeys.mock.calls[0] as unknown[])[2]).toContain(`images/${JOB}.jpg`)
  })

  it("a job that is not a set fetches every picture before it stores any: picture 2 failing leaves nothing stored", async () => {
    mocks.safeFetch
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => jpeg })
      .mockResolvedValueOnce({ ok: false, status: 502, headers: new Headers(), arrayBuffer: async () => Buffer.alloc(0) })
    const err = await storeFormattedImages({ sourceUrls: ["https://kie/1", "https://kie/2"], jobId: JOB, userId: "u1", watermark: false }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(mocks.uploadBufferToR2).not.toHaveBeenCalled()
  })

  it("a job that is not a set stores every picture or fails, as before", async () => {
    mocks.safeFetch
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => jpeg })
      .mockResolvedValueOnce({ ok: false, status: 502, headers: new Headers(), arrayBuffer: async () => Buffer.alloc(0) })
    const err = await storeFormattedImages({ sourceUrls: ["https://kie/1", "https://kie/2"], jobId: JOB, userId: "u1", watermark: false }).catch((e: unknown) => e)
    expect(isPostProcessingError(err)).toBe(true)
  })

  it("downloads one image of a set only after the one before it is stored", async () => {
    const order: string[] = []
    mocks.safeFetch.mockImplementation(async (url: string) => {
      order.push(`get ${url}`)
      return { ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => jpeg }
    })
    mocks.uploadBufferToR2.mockImplementation(async (_b: Buffer, key: string) => {
      order.push(`put ${key}`)
      return `https://cdn.test/${key}`
    })
    await storeFormattedImages({ sourceUrls: ["https://kie/1", "https://kie/2"], jobId: JOB, userId: "u1", watermark: false, isSet: true })
    expect(order).toEqual(["get https://kie/1", `put images/${JOB}.jpg`, "get https://kie/2", `put images/${JOB}-v1.jpg`])
    // A job that is not a set fetches all first, then stores, as before.
    order.length = 0
    await storeFormattedImages({ sourceUrls: ["https://kie/1", "https://kie/2"], jobId: JOB, userId: "u1", watermark: false })
    expect(order.slice(0, 2).every((o) => o.startsWith("get"))).toBe(true)
    expect(order.slice(2).every((o) => o.startsWith("put"))).toBe(true)
  })

  it("a GIF over the cap still fails as a post-processing failure", async () => {
    mocks.imageCap.bytes = gif.length - 1
    serve(gif)
    const err = await storeFormattedImages({ sourceUrls: ["https://kie/x.gif"], jobId: JOB, userId: "u1", watermark: false }).catch((e: unknown) => e)
    expect((err as Error).message).toMatch(/^upload-size-exceeded/)
    expect(isPostProcessingError(err)).toBe(true)
  })
})

describe("what fails, and who pays", () => {
  it("an SVG over the cap fails as before (upload-size-exceeded, post-processing), never read or stored", async () => {
    const big = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg">${"<!-- pad -->".repeat(200)}<rect width="10" height="10"/></svg>`)
    mocks.imageCap.bytes = big.length - 1
    serve(big)
    const err = await storeFormattedImages({ sourceUrls: ["https://kie/x.svg"], jobId: JOB, userId: "u1", watermark: false }).catch((e: unknown) => e)
    expect((err as Error).message).toMatch(/^upload-size-exceeded/)
    expect(isPostProcessingError(err)).toBe(true)
    expect(mocks.uploadBufferToR2).not.toHaveBeenCalled()
  })

  it("not a set: every download finishes before an SVG is read, so a failed sibling download ends the run, as before", async () => {
    mocks.safeFetch
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"></svg>`) })
      .mockResolvedValueOnce({ ok: false, status: 502, headers: new Headers(), arrayBuffer: async () => Buffer.alloc(0) })
    const err = await storeFormattedImages({ sourceUrls: ["https://kie/x.svg", "https://kie/2"], jobId: JOB, userId: "u1", watermark: false }).catch((e: unknown) => e)
    expect(isPostProcessingError(err)).toBe(true)
    expect(isDeterministicJobError(err)).toBe(false)
  })

  it("an SVG that cannot be made safe is refused before anything is stored: final, refunded", async () => {
    serve(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"></svg>`))
    const err = await storeFormattedImages({ sourceUrls: ["https://kie/x.svg"], jobId: JOB, userId: "u1", watermark: false }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message.startsWith(SVG_REFUSED_MESSAGE)).toBe(true)
    expect(isDeterministicJobError(err)).toBe(true)
    expect(isPostProcessingError(err)).toBe(false)
    expect(mocks.uploadBufferToR2).not.toHaveBeenCalled()
  })

  it("a delivered file that cannot be fetched is a post-processing failure, as on the PNG path", async () => {
    mocks.safeFetch.mockResolvedValueOnce({ ok: false, status: 502, headers: new Headers(), arrayBuffer: async () => Buffer.alloc(0) })
    const err = await storeFormattedImages({ sourceUrls: ["https://kie/x.gif"], jobId: JOB, userId: "u1", watermark: false }).catch((e: unknown) => e)
    expect(isPostProcessingError(err)).toBe(true)
  })

  it("a still that cannot be made is left out, with an alert, and the job keeps its file", async () => {
    const alert = vi.spyOn(console, "error").mockImplementation(() => {})
    serve(gif)
    mocks.uploadBufferToR2
      .mockImplementationOnce(async (_b: Buffer, key: string) => `https://cdn.test/${key}`)
      .mockRejectedValueOnce(new Error("R2 down"))
    const out = await storeFormattedImages({ sourceUrls: ["https://kie/x.gif"], jobId: JOB, userId: "u1", watermark: false })
    expect(out.urls).toEqual([`https://cdn.test/images/${JOB}.gif`])
    expect(out.thumbnailUrl).toBeUndefined()
    expect(alert.mock.calls.some(([m]) => String(m).startsWith("[ALERT]"))).toBe(true)
    alert.mockRestore()
  })
})
