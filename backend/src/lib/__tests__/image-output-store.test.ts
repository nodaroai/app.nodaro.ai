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
}))
vi.mock("../safe-fetch.js", () => ({ safeFetch: mocks.safeFetch }))
vi.mock("../storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../storage.js")>()),
  uploadBufferToR2: mocks.uploadBufferToR2,
}))

import sharp from "sharp"
import { requestedImageFormat, sniffImageFormat, storeFormattedImages } from "../image-output-store.js"
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
  mocks.uploadBufferToR2.mockImplementation(async (_b: Buffer, key: string) => `https://cdn.test/${key}`)
})

describe("which images take this path", () => {
  it("a run that asked for any format but PNG", () => {
    for (const f of ["jpeg", "webp", "gif", "svg"]) expect(requestedImageFormat({ outputFormat: f })).toBe(f)
    for (const input of [{ outputFormat: "png" }, {}, null, undefined, { outputFormat: "tiff" }, { outputFormat: 3 }]) {
      expect(requestedImageFormat(input as Record<string, unknown> | null | undefined)).toBeUndefined()
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

describe("what fails, and who pays", () => {
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
