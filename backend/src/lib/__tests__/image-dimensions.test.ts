import { describe, it, expect, beforeEach, afterAll } from "vitest"
import sharp from "sharp"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  imageDimensionsOf,
  noteStoredImage,
  forgetStoredImage,
  storedImageDimensions,
  forgetStoredImageDimensions,
  STORED_IMAGE_DIMENSIONS_MAX,
} from "../image-dimensions.js"

/**
 * THE reader of an image's pixel size: the displayed size (EXIF orientation
 * applied), from a whole file or its leading bytes, `undefined` for anything it
 * cannot read. Every buffer here is made by sharp in the test.
 */

const canvas = (width: number, height: number) => ({
  create: { width, height, channels: 3 as const, background: { r: 30, g: 120, b: 200 } },
})

const png = (w: number, h: number) => sharp(canvas(w, h)).png().toBuffer()
const webp = (w: number, h: number) => sharp(canvas(w, h)).webp().toBuffer()
async function jpeg(w: number, h: number, orientation?: number): Promise<Buffer> {
  const img = sharp(canvas(w, h)).jpeg({ quality: 80 })
  return (orientation ? img.withMetadata({ orientation }) : img).toBuffer()
}

const dirs: string[] = []
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })))
})

beforeEach(() => forgetStoredImageDimensions())

describe("imageDimensionsOf", () => {
  it("reads a PNG, a JPEG and a WebP", async () => {
    expect(await imageDimensionsOf(await png(1024, 1536))).toEqual({ width: 1024, height: 1536 })
    expect(await imageDimensionsOf(await jpeg(1920, 1080))).toEqual({ width: 1920, height: 1080 })
    expect(await imageDimensionsOf(await webp(640, 480))).toEqual({ width: 640, height: 480 })
  })

  it("reports a rotated photo as it is displayed", async () => {
    // Stored 1104x1472 with EXIF orientation 6 (a quarter turn): shown landscape.
    expect(await imageDimensionsOf(await jpeg(1104, 1472, 6))).toEqual({ width: 1472, height: 1104 })
  })

  it("reads the size from the leading bytes alone", async () => {
    const big = await sharp({ create: { width: 2048, height: 1152, channels: 3, background: "#808080" }, }).png({ compressionLevel: 0 }).toBuffer()
    expect(big.length).toBeGreaterThan(64 * 1024)
    expect(await imageDimensionsOf(big.subarray(0, 64 * 1024))).toEqual({ width: 2048, height: 1152 })
  })

  it("reads a local file by its path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "img-dims-"))
    dirs.push(dir)
    const path = join(dir, "frame.png")
    await writeFile(path, await png(300, 200))
    expect(await imageDimensionsOf(path)).toEqual({ width: 300, height: 200 })
  })

  it("answers undefined for a corrupt buffer, an empty one, a non-image and a missing file — never throws", async () => {
    expect(await imageDimensionsOf(Buffer.from("not an image at all"))).toBeUndefined()
    expect(await imageDimensionsOf(Buffer.alloc(0))).toBeUndefined()
    const truncated = (await png(64, 64)).subarray(0, 12)
    expect(await imageDimensionsOf(truncated)).toBeUndefined()
    expect(await imageDimensionsOf(join(tmpdir(), "no-such-file-anywhere.png"))).toBeUndefined()
  })
})

describe("the sizes this process noted when it stored an image", () => {
  it("noteStoredImage measures the bytes and remembers the size by url", async () => {
    await noteStoredImage("https://cdn.test/images/a.png", await png(512, 256))
    expect(storedImageDimensions("https://cdn.test/images/a.png")).toEqual({ width: 512, height: 256 })
    expect(storedImageDimensions("https://cdn.test/images/other.png")).toBeUndefined()
  })

  it("a later store under the same url replaces the size — and one that cannot be measured is remembered as unreadable", async () => {
    const url = "https://cdn.test/images/job-1.png"
    await noteStoredImage(url, await png(100, 100))
    await noteStoredImage(url, await png(300, 100))
    expect(storedImageDimensions(url)).toEqual({ width: 300, height: 100 })
    // null, not undefined: the bytes were seen and hold no readable size, so
    // reading the stored file back would read the same bytes for nothing.
    await noteStoredImage(url, Buffer.from("garbage"))
    expect(storedImageDimensions(url)).toBeNull()
  })

  it("forgetStoredImage drops what was noted — a writer that stored new bytes without measuring them", async () => {
    const url = "https://cdn.test/images/job-2.png"
    await noteStoredImage(url, await png(64, 32))
    forgetStoredImage(url)
    expect(storedImageDimensions(url)).toBeUndefined()
    await noteStoredImage(url, Buffer.from("garbage"))
    forgetStoredImage(url)
    expect(storedImageDimensions(url)).toBeUndefined()
  })

  it("keeps at most STORED_IMAGE_DIMENSIONS_MAX notes, dropping the oldest", async () => {
    await noteStoredImage("https://cdn.test/images/0.png", await png(8, 8))
    // An empty store is noted as unreadable without decoding — cheap filler.
    for (let i = 1; i < STORED_IMAGE_DIMENSIONS_MAX; i++) await noteStoredImage(`https://cdn.test/images/${i}.png`, Buffer.alloc(0))
    expect(storedImageDimensions("https://cdn.test/images/0.png")).toEqual({ width: 8, height: 8 })
    await noteStoredImage("https://cdn.test/images/last.png", await png(4, 2))
    expect(storedImageDimensions("https://cdn.test/images/0.png")).toBeUndefined()
    expect(storedImageDimensions("https://cdn.test/images/1.png")).toBeNull()
    expect(storedImageDimensions("https://cdn.test/images/last.png")).toEqual({ width: 4, height: 2 })
  })
})
