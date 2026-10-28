import { describe, it, expect, vi, beforeEach } from "vitest"
import { crc32 } from "node:zlib"
import sharp from "sharp"
import { imageHasMetadata } from "../../../lib/image-metadata.js"

// A reference image must reach the provider as a picture and nothing else.
// A generator's PNG carrying a Content Credentials manifest (`caBX` chunk) was
// sent untouched — it needed no conversion — and the video model refused the
// task. These tests drive the REAL helper on real sharp output, with the
// metadata spliced in by small builders below (no binary fixtures).

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

const URL_IN = "https://elsewhere.example/ref.png"

const solid = (channels: 3 | 4 = 3) =>
  sharp({ create: { width: 32, height: 24, channels, background: { r: 200, g: 40, b: 90, alpha: 0.5 } } })

/** A PNG chunk: length, type, data, CRC over type+data. */
function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, "latin1")
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}

/** Splice chunks in right after IHDR (8-byte signature + 25-byte IHDR). */
function withPngChunks(png: Buffer, chunks: Buffer[]): Buffer {
  return Buffer.concat([png.subarray(0, 33), ...chunks, png.subarray(33)])
}

/** A JPEG APPn segment. */
function jpegApp(n: number, payload: Buffer): Buffer {
  const head = Buffer.from([0xff, 0xe0 + n, 0, 0])
  head.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([head, payload])
}

/** Splice segments in right after SOI. */
function withJpegSegments(jpeg: Buffer, segments: Buffer[]): Buffer {
  return Buffer.concat([jpeg.subarray(0, 2), ...segments, jpeg.subarray(2)])
}

const C2PA = Buffer.from('jumb....c2pa claim_generator_info "Image Service" trainedAlgorithmicMedia')

const pngChunkTypes = (png: Buffer): string[] => {
  const types: string[] = []
  let o = 8
  while (o + 8 <= png.length) {
    types.push(png.toString("latin1", o + 4, o + 8))
    o += 12 + png.readUInt32BE(o)
  }
  return types
}

const jpegAppMarkers = (jpeg: Buffer): number[] => {
  const markers: number[] = []
  let o = 2
  while (o + 4 <= jpeg.length && jpeg[o + 1] !== 0xda) {
    const m = jpeg[o + 1]!
    if ((m >= 0xe0 && m <= 0xef) || m === 0xfe) markers.push(m)
    o += 2 + jpeg.readUInt16BE(o + 2)
  }
  return markers
}

function serve(buffer: Buffer) {
  mocks.safeFetch.mockResolvedValue({
    ok: true,
    status: 200,
    body: { cancel: async () => {} },
    arrayBuffer: async () => buffer,
  })
}

const uploaded = () => mocks.uploadBufferToR2.mock.calls.at(-1) as [Buffer, string, string]

describe("reference images reach the provider without metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.uploadBufferToR2.mockImplementation(async (_b: Buffer, key: string) => `https://cdn.test/${key}`)
  })

  it("a PNG with a Content Credentials (caBX) chunk comes out without it, still a lossless PNG with its alpha", async () => {
    const clean = await solid(4).png().toBuffer()
    const tagged = withPngChunks(clean, [
      pngChunk("caBX", C2PA),
      pngChunk("tEXt", Buffer.from("Software\0Generator")),
      pngChunk("iTXt", Buffer.from("XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>")),
    ])
    expect(imageHasMetadata(tagged, "png")).toBe(true)
    serve(tagged)

    const out = await ensureImageForProvider(URL_IN, "seedance-2-5", { context: "Video generation", maxDimension: 2048 })

    expect(out).not.toBe(URL_IN)
    const [buf, key, type] = uploaded()
    expect(key).toMatch(/provider-stripped.*\.png$/)
    expect(type).toBe("image/png")
    const chunks = pngChunkTypes(buf)
    expect(chunks).not.toContain("caBX")
    expect(chunks).not.toContain("tEXt")
    expect(chunks).not.toContain("iTXt")
    expect(imageHasMetadata(buf, "png")).toBe(false)
    // Same pixels (PNG re-encode is lossless) and alpha kept.
    const meta = await sharp(buf).metadata()
    expect(meta.hasAlpha).toBe(true)
    const [a, b] = await Promise.all([sharp(clean).raw().toBuffer(), sharp(buf).raw().toBuffer()])
    expect(b.equals(a)).toBe(true)
  })

  it("a JPEG with APP1 (EXIF/XMP), APP11 (JUMBF) and APP13 (IPTC) comes out without them", async () => {
    const clean = await solid().jpeg({ quality: 90 }).toBuffer()
    const tagged = withJpegSegments(clean, [
      jpegApp(1, Buffer.concat([Buffer.from("Exif\0\0"), Buffer.alloc(16)])),
      jpegApp(1, Buffer.from("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>")),
      jpegApp(11, Buffer.concat([Buffer.from("JP"), C2PA])),
      jpegApp(13, Buffer.from("Photoshop 3.0\0")),
    ])
    expect(imageHasMetadata(tagged, "jpeg")).toBe(true)
    serve(tagged)

    await ensureImageForProvider(URL_IN, "kling-4", { context: "Video generation" })

    const [buf, key, type] = uploaded()
    expect(key).toMatch(/provider-stripped.*\.jpg$/)
    expect(type).toBe("image/jpeg")
    const markers = jpegAppMarkers(buf)
    expect(markers).not.toContain(0xe1)
    expect(markers).not.toContain(0xeb)
    expect(markers).not.toContain(0xed)
    expect(imageHasMetadata(buf, "jpeg")).toBe(false)
  })

  it("a WebP with EXIF/XMP chunks comes out without them", async () => {
    const tagged = await solid().withMetadata({ exif: { IFD0: { Software: "Generator" } } }).webp().toBuffer()
    expect(imageHasMetadata(tagged, "webp")).toBe(true)
    serve(tagged)

    await ensureImageForProvider(URL_IN, "kling-4", { context: "Video generation" })

    const [buf, key] = uploaded()
    expect(key).toMatch(/provider-stripped.*\.webp$/)
    expect(imageHasMetadata(buf, "webp")).toBe(false)
  })

  it("an oversize PNG with a caBX chunk takes the existing conversion path and comes out without it", async () => {
    const tagged = withPngChunks(await solid(4).png().toBuffer(), [pngChunk("caBX", C2PA), pngChunk("eXIf", Buffer.alloc(16))])
    serve(tagged)

    // Longer than the cap: the downscale + JPEG conversion ("provider-converted").
    await ensureImageForProvider(URL_IN, "seedance-2-5", { context: "Video generation", maxDimension: 16 })

    const [buf, key, type] = uploaded()
    expect(key).toMatch(/provider-converted.*\.jpg$/)
    expect(type).toBe("image/jpeg")
    expect(buf.includes(Buffer.from("c2pa"))).toBe(false)
    expect(jpegAppMarkers(buf).filter((m) => m !== 0xe0)).toEqual([])
    expect(imageHasMetadata(buf, "jpeg")).toBe(false)
    expect((await sharp(buf).metadata()).width).toBe(16)
  })

  it("the lossless conversion path (edit lanes) drops it too", async () => {
    serve(withPngChunks(await solid(4).png().toBuffer(), [pngChunk("caBX", C2PA)]))

    await ensureImageForProvider(URL_IN, "some-edit-sku", { context: "Image editing", maxDimension: 16, preferLossless: true })

    const [buf, key] = uploaded()
    expect(key).toMatch(/provider-converted.*\.webp$/)
    expect(buf.includes(Buffer.from("c2pa"))).toBe(false)
    expect(imageHasMetadata(buf, "webp")).toBe(false)
  })

  it("a clean small image keeps today's path: its own URL, no upload", async () => {
    for (const clean of [await solid(4).png().toBuffer(), await solid().jpeg().toBuffer(), await solid().webp().toBuffer()]) {
      serve(clean)
      const out = await ensureImageForProvider(URL_IN, "seedance-2-5", { context: "Video generation", maxDimension: 2048 })
      expect(out).toBe(URL_IN)
    }
    expect(mocks.uploadBufferToR2).not.toHaveBeenCalled()
  })

  it("an ICC profile alone is image data, not metadata", async () => {
    const withIcc = await solid().withIccProfile("p3").jpeg().toBuffer()
    expect(imageHasMetadata(withIcc, "jpeg")).toBe(false)
    const pngIcc = await solid().withIccProfile("p3").png().toBuffer()
    expect(imageHasMetadata(pngIcc, "png")).toBe(false)
  })

  it("a file the walker cannot vouch for counts as metadata-bearing", () => {
    expect(imageHasMetadata(Buffer.from("not an image"), "png")).toBe(true)
    expect(imageHasMetadata(Buffer.from("not an image"), "jpeg")).toBe(true)
    expect(imageHasMetadata(Buffer.from("not an image"), "webp")).toBe(true)
    expect(imageHasMetadata(Buffer.alloc(8), "gif")).toBe(true)
  })
})
