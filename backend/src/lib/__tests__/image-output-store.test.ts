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
  // A fake bucket: what each key holds (`headR2Object` reads it).
  objects: new Map<string, { size: number; etag: string; metadata?: Record<string, string> }>(),
  etags: { n: 0 },
  // How many of the next reads fail (an injected storage error).
  headFailures: { n: 0 },
  deleted: [] as string[],
  jobRow: { value: null as null | Record<string, unknown> },
  claim: { live: false },
  updateStorageUsage: vi.fn(async () => {}),
  // The stored-image cap, lowered by the oversize tests below.
  imageCap: { bytes: 25 * 1024 * 1024 },
}))
vi.mock("../safe-fetch.js", () => ({ safeFetch: mocks.safeFetch }))
vi.mock("../../utils/file-validation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/file-validation.js")>()
  return { ...actual, updateStorageUsage: mocks.updateStorageUsage, getSizeLimit: (category: string) => (category === "image" ? mocks.imageCap.bytes : actual.getSizeLimit(category as never)) }
})
vi.mock("../storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../storage.js")>()),
  uploadBufferToR2: mocks.uploadBufferToR2,
  headR2Object: async (key: string) => {
    await Promise.resolve()
    if (mocks.headFailures.n > 0) {
      mocks.headFailures.n -= 1
      throw Object.assign(new Error("storage unavailable"), { $metadata: { httpStatusCode: 503 } })
    }
    const o = mocks.objects.get(key)
    return o ? { exists: true, sizeBytes: o.size, etag: o.etag, ...(o.metadata ? { metadata: o.metadata } : {}) } : { exists: false }
  },
}))
vi.mock("../supabase.js", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.jobRow.value, error: null }) }) }) }),
    // The set clean-up's claim (migration 704): one winner while a claim is live.
    rpc: async (fn: string, args: { p_statuses?: string[] }) => {
      await Promise.resolve()
      if (fn === "claim_job_set_discard") {
        const status = String(mocks.jobRow.value?.status ?? "failed")
        if (!args.p_statuses?.includes(status) || mocks.claim.live) return { data: null, error: null }
        mocks.claim.live = true
        return { data: "c", error: null }
      }
      if (fn === "finish_job_set_discard") mocks.claim.live = false
      return { data: true, error: null }
    },
  },
}))
vi.mock("../job-policy-outputs.js", () => ({ isOwnedObjectKey: (jobId: string, key: string) => key.includes(jobId) }))
vi.mock("../storage-delete.js", () => ({
  deleteKeysRecordingFailures: async (keys: readonly string[]) => {
    for (const key of keys) {
      mocks.objects.delete(key)
      mocks.deleted.push(key)
    }
    return { notDeleted: [], failed: [] }
  },
  recordFailedDeletes: async () => ({ recorded: 0, unavailable: false }),
  keyFailures: (keys: readonly string[]) => keys.map((key) => ({ key })),
}))

/** A write into the fake bucket, honouring the condition it carries (412 when it no longer holds). */
function bucketWrite(b: Buffer, key: string, conditional?: { ifMatch?: string; ifNoneMatch?: string; metadata?: Record<string, string> }): void {
  const now = mocks.objects.get(key)
  if (conditional?.ifNoneMatch === "*" && now) throw Object.assign(new Error("precondition"), { $metadata: { httpStatusCode: 412 } })
  if (conditional?.ifMatch !== undefined && now?.etag !== conditional.ifMatch) throw Object.assign(new Error("precondition"), { $metadata: { httpStatusCode: 412 } })
  mocks.objects.set(key, { size: b.length, etag: `e${++mocks.etags.n}`, ...(conditional?.metadata ? { metadata: conditional.metadata } : {}) })
}

import sharp from "sharp"
import { discardEndedSetImages } from "../image-set-storage.js"
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
  mocks.headFailures.n = 0
  mocks.claim.live = false
  mocks.jobRow.value = null
  mocks.deleted.length = 0
  mocks.uploadBufferToR2.mockImplementation(async (b: Buffer, key: string, _t: string, _u?: string, conditional?: Parameters<typeof bucketWrite>[2]) => {
    bucketWrite(b, key, conditional)
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

  const charges = () => mocks.updateStorageUsage.mock.calls.map((c) => (c as unknown[])[1] as number)
  const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0)
  const net = () => sum(charges())
  const stored = () => sum([...mocks.objects.values()].map((o) => o.size))

  it("a set's picture whose store fails twice is left out: handed to the caller, deleted once its completion won", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.safeFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => jpeg })
    let call = 0
    mocks.uploadBufferToR2.mockImplementation(async (b: Buffer, key: string, _t: string, _u?: string, conditional?: Parameters<typeof bucketWrite>[2]) => {
      call += 1
      // The second picture's two uploads fail; nothing lands.
      if (call === 2 || call === 3) throw new Error("upload reset")
      bucketWrite(b, key, conditional)
      return `https://cdn.test/${key}`
    })
    const out = await storeFormattedImages({ sourceUrls: ["https://kie/1", "https://kie/2"], jobId: JOB, userId: "u1", watermark: false, isSet: true })
    expect(out.dropped).toBe(1)
    // Not deleted by the store (another finalize may deliver the key): handed to the caller.
    expect(mocks.deleted).toEqual([])
    expect([...out.undelivered.keys()]).toEqual([`images/${JOB}-v1.jpg`])
    // After its completion won (the row is completed): only the left-out key, never a delivered one.
    mocks.jobRow.value = { status: "completed" }
    await discardUndeliveredImages(JOB, "u1", out.undelivered, [`https://cdn.test/images/${JOB}-v1.jpg`], ["completed"])
    expect(mocks.deleted).toEqual([])
    // Nothing of it landed: nothing to delete, nothing given back.
    await discardUndeliveredImages(JOB, "u1", out.undelivered, out.urls, ["completed"])
    expect(mocks.deleted).toEqual([])
    // A set's uploads are charged by the store itself, for what the key gained.
    expect(uploads().every((c) => c[3] === undefined)).toBe(true)
    expect(charges()).toEqual([jpeg.length])
    mocks.safeFetch.mockReset()
  })

  it("a write that errored after landing is charged once (its own marker), and its retry adds nothing", async () => {
    mocks.safeFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => jpeg })
    let call = 0
    mocks.uploadBufferToR2.mockImplementation(async (b: Buffer, key: string, _t: string, _u?: string, conditional?: Parameters<typeof bucketWrite>[2]) => {
      call += 1
      bucketWrite(b, key, conditional)
      if (call === 1) throw new Error("reset after the write")
      return `https://cdn.test/${key}`
    })
    const out = await storeFormattedImages({ sourceUrls: ["https://kie/1", "https://kie/2"], jobId: JOB, userId: "u1", watermark: false, isSet: true })
    expect(out.urls).toHaveLength(2)
    expect(net()).toBe(stored())
    mocks.safeFetch.mockReset()
  })

  it("a read that keeps failing never charges on a guess: the step fails, retryable, nothing charged", async () => {
    mocks.safeFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => jpeg })
    mocks.headFailures.n = 1000
    const err = await storeFormattedImages({ sourceUrls: ["https://kie/1", "https://kie/2"], jobId: JOB, userId: "u1", watermark: false, isSet: true }).catch((e: unknown) => e)
    expect(isPostProcessingError(err)).toBe(true)
    expect(isDeterministicJobError(err)).toBe(false)
    expect(charges()).toEqual([])
    expect(mocks.objects.size).toBe(0)
    mocks.safeFetch.mockReset()
  }, 30_000)

  // The invariant: across two attempts of one set, run one after the other or
  // interleaved, with storage reads failing now and then, the bytes charged
  // equal the bytes stored, and a later clean-up never gives back more than
  // was charged.
  it.each([
    ["one after the other", false, 0],
    ["interleaved", true, 0],
    ["interleaved, with failing reads", true, 2],
  ])("two finalize attempts of one set (%s): charged == stored, refunded <= charged", async (_name, together, failures) => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    mocks.safeFetch.mockImplementation(async () => ({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => jpeg }))
    mocks.headFailures.n = failures
    const run = () => storeFormattedImages({ sourceUrls: ["https://kie/1", "https://kie/2", "https://kie/3"], jobId: JOB, userId: "u1", watermark: false, isSet: true }).catch((e: unknown) => e)
    if (together) await Promise.all([run(), run()])
    else { await run(); await run() }
    expect(net()).toBe(stored())
    const before = net()
    // Every key goes (the job failed after all): what is given back never exceeds what was charged.
    await discardUndeliveredImages(JOB, "u1", new Map([...mocks.objects.keys()].map((k) => [k, 0])), [])
    const refunded = before - net()
    expect(refunded).toBeLessThanOrEqual(before)
    expect(net()).toBe(stored())
    mocks.safeFetch.mockReset()
  }, 30_000)

  it("a write whose response was lost answers the client's own retry with 412: it landed, charged once", async () => {
    mocks.safeFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => jpeg })
    let call = 0
    mocks.uploadBufferToR2.mockImplementation(async (b: Buffer, key: string, _t: string, _u?: string, conditional?: Parameters<typeof bucketWrite>[2]) => {
      call += 1
      bucketWrite(b, key, conditional)
      // The first write lands, its response is lost, the SDK sends it again: 412.
      if (call === 1) bucketWrite(b, key, conditional)
      return `https://cdn.test/${key}`
    })
    const out = await storeFormattedImages({ sourceUrls: ["https://kie/1", "https://kie/2"], jobId: JOB, userId: "u1", watermark: false, isSet: true })
    expect(out.urls).toHaveLength(2)
    expect(net()).toBe(stored())
    await discardUndeliveredImages(JOB, "u1", new Map([...mocks.objects.keys()].map((k) => [k, 0])), [])
    expect(net()).toBe(0)
    mocks.safeFetch.mockReset()
  })

  it("a write that errored after landing, with the read after it failing too, is charged by the picture's next try", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.safeFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => jpeg })
    let call = 0
    mocks.uploadBufferToR2.mockImplementation(async (b: Buffer, key: string, _t: string, _u?: string, conditional?: Parameters<typeof bucketWrite>[2]) => {
      call += 1
      bucketWrite(b, key, conditional)
      if (call === 1) {
        // Landed, then the connection broke, and storage cannot be read for a while.
        mocks.headFailures.n = 3
        throw new Error("reset after the write")
      }
      return `https://cdn.test/${key}`
    })
    const out = await storeFormattedImages({ sourceUrls: ["https://kie/1", "https://kie/2"], jobId: JOB, userId: "u1", watermark: false, isSet: true })
    expect(out.urls).toHaveLength(2)
    expect(net()).toBe(stored())
    mocks.safeFetch.mockReset()
  }, 30_000)

  it("two clean-ups of the same keys running together give each back once", async () => {
    mocks.safeFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => jpeg })
    await storeFormattedImages({ sourceUrls: ["https://kie/1", "https://kie/2"], jobId: JOB, userId: "u1", watermark: false, isSet: true })
    const charged = net()
    const keys = new Map([...mocks.objects.keys()].map((k) => [k, 0]))
    await Promise.all([discardUndeliveredImages(JOB, "u1", keys, []), discardUndeliveredImages(JOB, "u1", keys, [])])
    expect(charged - net()).toBe(charged)
    expect(net()).toBe(0)
    mocks.safeFetch.mockReset()
  })

  it("a refused SVG in a set deletes nothing itself: what it stored rides on the error, deleted once the row is failed", async () => {
    mocks.safeFetch
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => jpeg })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"></svg>`) })
    const err = await storeFormattedImages({ sourceUrls: ["https://kie/1", "https://kie/2"], jobId: JOB, userId: "u1", watermark: false, isSet: true }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect(mocks.deleted).toEqual([])
    expect([...((err as { undelivered: Map<string, number> }).undelivered.keys())]).toContain(`images/${JOB}.jpg`)
    // A completed row (another finalize delivered): nothing goes.
    mocks.jobRow.value = { status: "completed", user_id: "u1", setHoldCreditId: "kling-image-4:2K:x2", imageSetCount: 2 }
    await discardEndedSetImages(JOB)
    expect(mocks.deleted).toEqual([])
    // The row ended failed (whatever failed it): every picture of the set goes and is given back.
    mocks.jobRow.value = { status: "failed", user_id: "u1", setHoldCreditId: "kling-image-4:2K:x2", imageSetCount: 2 }
    await discardEndedSetImages(JOB)
    expect(mocks.deleted).toContain(`images/${JOB}.jpg`)
    expect(net()).toBe(stored())
    // A job that is not a set: nothing.
    mocks.deleted.length = 0
    mocks.jobRow.value = { status: "failed", user_id: "u1", setHoldCreditId: null }
    await discardEndedSetImages(JOB)
    expect(mocks.deleted).toEqual([])
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

describe("a job that is not a set downloads as it always did", () => {
  /** A response whose body arrives in `chunk`-byte pieces, counting what was read. */
  const streamed = (body: Buffer, chunk: number, read: { n: number }, contentLength?: number) => {
    let at = 0
    return {
      ok: true,
      status: 200,
      headers: new Headers(contentLength !== undefined ? { "content-length": String(contentLength) } : {}),
      arrayBuffer: async () => body,
      body: {
        getReader: () => ({
          read: async () => {
            if (at >= body.length) return { done: true, value: undefined }
            const value = new Uint8Array(body.subarray(at, at + chunk))
            at += value.byteLength
            read.n = at
            return { done: false, value }
          },
          cancel: async () => {},
        }),
        cancel: async () => {},
      },
    }
  }
  const svgOf = (bytes: number) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/>${"<!-- p -->".repeat(Math.ceil(bytes / 10))}</svg>`)

  it("[a refused SVG under the cap, an SVG between the cap and 4x it] ends with upload-size-exceeded, as before", async () => {
    const big = svgOf(20_000)
    mocks.imageCap.bytes = 10_000
    mocks.safeFetch
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"></svg>`) })
      .mockResolvedValueOnce(streamed(big, 1024, { n: 0 }))
    const err = await storeFormattedImages({ sourceUrls: ["https://kie/a.svg", "https://kie/b.svg"], jobId: JOB, userId: "u1", watermark: false }).catch((e: unknown) => e)
    expect((err as Error).message).toMatch(/^upload-size-exceeded/)
    expect(isPostProcessingError(err)).toBe(true)
    expect(isDeterministicJobError(err)).toBe(false)
  })

  it("an SVG over the cap stops downloading once its first bytes say what it is, never up to 4x", async () => {
    const big = svgOf(36_000)
    mocks.imageCap.bytes = 10_000
    const read = { n: 0 }
    mocks.safeFetch.mockResolvedValueOnce(streamed(big, 1024, read, big.length))
    const err = await storeFormattedImages({ sourceUrls: ["https://kie/b.svg"], jobId: JOB, userId: "u1", watermark: false }).catch((e: unknown) => e)
    expect((err as Error).message).toBe(`upload-size-exceeded: Content-Length ${big.length} > cap 10000`)
    expect(read.n).toBeLessThan(10_000)
  })

  it("a file of no recognised type over the cap is held to the cap, failing as before (upload-size-exceeded)", async () => {
    const unknown = Buffer.alloc(20_000, 0x41)
    mocks.imageCap.bytes = 10_000
    const read = { n: 0 }
    mocks.safeFetch.mockResolvedValueOnce(streamed(unknown, 1024, read))
    const err = await storeFormattedImages({ sourceUrls: ["https://kie/x"], jobId: JOB, userId: "u1", watermark: false }).catch((e: unknown) => e)
    expect((err as Error).message).toMatch(/^upload-size-exceeded: \d+ > cap 10000$/)
    expect(isPostProcessingError(err)).toBe(true)
    expect(read.n).toBeLessThanOrEqual(10_000 + 1024)
    expect(mocks.uploadBufferToR2).not.toHaveBeenCalled()
  })

  it("a PNG over the cap is still downloaded and stored as the WebP it is re-encoded to (declared)", async () => {
    const big = await sharp({ create: { width: 256, height: 256, channels: 4, background: { r: 10, g: 200, b: 30, alpha: 0.5 } } }).png({ compressionLevel: 0 }).toBuffer()
    mocks.imageCap.bytes = big.length - 1
    mocks.safeFetch.mockResolvedValueOnce(streamed(big, 4096, { n: 0 }, big.length))
    const out = await storeFormattedImages({ sourceUrls: ["https://kie/x.png"], jobId: JOB, userId: "u1", watermark: false })
    expect(out.format).toBe("webp")
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
