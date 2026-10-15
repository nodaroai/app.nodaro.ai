// @test-watches backend/src/lib/storage.ts
import { Readable } from "node:stream"
import { readFileSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"
import sharp from "sharp"

/**
 * The storage writers measure every image they store and note its size by the
 * url they return (`lib/image-dimensions.ts`), so a job's output can be stamped
 * with its pixel size without reading the file back. These pin that the three
 * writers an image output goes through note the size of the bytes they STORED,
 * and that nothing else is noted.
 */

const mocks = vi.hoisted(() => {
  const config = {
    R2_ACCOUNT_ID: "test-account",
    R2_ACCESS_KEY_ID: "test-key",
    R2_SECRET_ACCESS_KEY: "test-secret",
    R2_BUCKET_NAME: "test-bucket",
    R2_PUBLIC_URL: "https://r2.test.com",
    R2_SHARED_WITH_RELAY_TARGET: false,
    EDITION: "cloud",
  }
  return { config, send: vi.fn(), safeFetch: vi.fn(), sendOptions: [] as unknown[] }
})

vi.mock("@aws-sdk/client-s3", () => {
  class Command {
    constructor(params: Record<string, unknown>) {
      Object.assign(this, params)
    }
  }
  class S3Client {
    send = (cmd: unknown, options?: unknown) => {
      mocks.sendOptions.push(options)
      return mocks.send(cmd, options)
    }
  }
  return {
    S3Client,
    GetObjectCommand: class GetObjectCommand extends Command {},
    PutObjectCommand: class PutObjectCommand extends Command {},
    DeleteObjectCommand: Command,
    DeleteObjectsCommand: Command,
    CopyObjectCommand: Command,
    HeadObjectCommand: Command,
    ListObjectsV2Command: Command,
    CreateBucketCommand: Command,
    PutBucketPolicyCommand: Command,
  }
})

// The real Upload consumes its Body; this one drains it so the byte counter
// (and the header capture on it) runs end to end.
vi.mock("@aws-sdk/lib-storage", () => ({
  Upload: class {
    private body: Readable
    constructor({ params }: { params: { Body: Readable } }) {
      this.body = params.Body
    }
    async done() {
      for await (const _chunk of this.body) {
        // consume
      }
      return {}
    }
  },
}))

vi.mock("@/lib/config.js", () => ({ config: mocks.config }))

vi.mock("@/utils/file-validation.js", () => ({
  updateStorageUsage: vi.fn().mockResolvedValue(undefined),
  reserveStorageIfWithinLimit: vi.fn().mockResolvedValue(true),
  refundStorage: vi.fn().mockResolvedValue(undefined),
  getSizeLimit: vi.fn(() => 64 * 1024 * 1024),
}))

vi.mock("@/lib/safe-fetch.js", () => ({ safeFetch: mocks.safeFetch }))

import {
  uploadBufferToR2,
  uploadFileToR2,
  uploadToR2,
  streamR2Object,
  uploadFileWithKeyToR2,
  uploadLocalFileToR2Key,
  copyToTemplateKept,
} from "@/lib/storage.js"
import { storedImageDimensions, forgetStoredImageDimensions, noteStoredImage } from "@/lib/image-dimensions.js"

const canvas = (width: number, height: number) => ({
  create: { width, height, channels: 3 as const, background: { r: 10, g: 200, b: 90 } },
})

/** A fetch Response whose body arrives in `chunkSize` pieces. */
function streamedResponse(bytes: Buffer, chunkSize = 16 * 1024): Response {
  let offset = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close()
        return
      }
      controller.enqueue(new Uint8Array(bytes.subarray(offset, offset + chunkSize)))
      offset += chunkSize
    },
  })
  return { ok: true, status: 200, headers: new Headers(), body } as unknown as Response
}

const dirs: string[] = []
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })))
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.send.mockResolvedValue({})
  mocks.sendOptions.length = 0
  mocks.config.R2_SHARED_WITH_RELAY_TARGET = false
  forgetStoredImageDimensions()
})

describe("uploadBufferToR2 notes the size of an image it stores", () => {
  it("an image buffer: the size, by the returned url", async () => {
    const png = await sharp(canvas(1536, 1024)).png().toBuffer()
    const url = await uploadBufferToR2(png, "images/job-1.png", "image/png", "user-1")
    expect(url).toBe("https://r2.test.com/images/job-1.png")
    expect(storedImageDimensions(url)).toEqual({ width: 1536, height: 1024 })
  })

  it("the bytes as stored — a re-encode that dropped a quarter-turn EXIF tag reads unrotated", async () => {
    // What the free-tier watermark and the oversized WebP re-encode store: the
    // pixels as they lie, with no orientation tag left on them.
    const rotated = await sharp(canvas(1104, 1472)).jpeg().withMetadata({ orientation: 6 }).toBuffer()
    const reencoded = await sharp(rotated).png().toBuffer()
    const url = await uploadBufferToR2(reencoded, "images/job-2.png", "image/png")
    expect(storedImageDimensions(url)).toEqual({ width: 1104, height: 1472 })
  })

  it("a non-image content type notes nothing", async () => {
    const url = await uploadBufferToR2(Buffer.from("{}"), "json/x.json", "application/json")
    expect(storedImageDimensions(url)).toBeUndefined()
  })

  it("image bytes it cannot read replace a size noted before with 'unreadable' (no read-back of the same bytes)", async () => {
    await noteStoredImage("https://r2.test.com/images/job-3.png", await sharp(canvas(10, 10)).png().toBuffer())
    await uploadBufferToR2(Buffer.from("not a png"), "images/job-3.png", "image/png")
    expect(storedImageDimensions("https://r2.test.com/images/job-3.png")).toBeNull()
  })
})

describe("uploadToR2 notes the size of an image it streams, from the bytes that passed through", () => {
  it("an image: measured from the stream — no second fetch, no read-back", async () => {
    const png = await sharp(canvas(2048, 1152)).png({ compressionLevel: 0 }).toBuffer()
    expect(png.length).toBeGreaterThan(512 * 1024) // more than the header capture keeps
    mocks.safeFetch.mockResolvedValueOnce(streamedResponse(png))
    const url = await uploadToR2("https://provider.example/out.png", "job-4", "image", "user-4")
    expect(url).toBe("https://r2.test.com/images/job-4.png")
    expect(storedImageDimensions(url)).toEqual({ width: 2048, height: 1152 })
    expect(mocks.safeFetch).toHaveBeenCalledTimes(1)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("a video or an audio file notes nothing", async () => {
    mocks.safeFetch.mockResolvedValueOnce(streamedResponse(await sharp(canvas(32, 32)).png().toBuffer()))
    const url = await uploadToR2("https://provider.example/out.mp4", "job-5", "video")
    expect(storedImageDimensions(url)).toBeUndefined()
  })

  it("an image whose header cannot be read replaces a size noted before with 'unreadable'", async () => {
    await noteStoredImage("https://r2.test.com/images/job-6.png", await sharp(canvas(10, 10)).png().toBuffer())
    mocks.safeFetch.mockResolvedValueOnce(streamedResponse(Buffer.from("not an image")))
    await uploadToR2("https://provider.example/out.png", "job-6", "image")
    expect(storedImageDimensions("https://r2.test.com/images/job-6.png")).toBeNull()
  })

  it("the shared-bucket passthrough stores nothing, so it notes nothing", async () => {
    mocks.config.R2_SHARED_WITH_RELAY_TARGET = true
    const url = await uploadToR2("https://r2.test.com/images/far-end.png", "job-7", "image")
    expect(url).toBe("https://r2.test.com/images/far-end.png")
    expect(storedImageDimensions(url)).toBeUndefined()
  })
})

describe("uploadFileToR2 notes the size of an image file it stores", () => {
  it("an image: measured from the local file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "store-dims-"))
    dirs.push(dir)
    const path = join(dir, "frame.png")
    await writeFile(path, await sharp(canvas(720, 1280)).png().toBuffer())
    const url = await uploadFileToR2(path, "job-8", "image", "user-8")
    expect(url).toBe("https://r2.test.com/images/job-8.png")
    expect(storedImageDimensions(url)).toEqual({ width: 720, height: 1280 })
  })

  it("a video file notes nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "store-dims-"))
    dirs.push(dir)
    const path = join(dir, "clip.mp4")
    await writeFile(path, Buffer.from("not really a video"))
    const url = await uploadFileToR2(path, "job-9", "video")
    expect(storedImageDimensions(url)).toBeUndefined()
  })
})

describe("a write that measures nothing drops the size noted for that url", () => {
  // A deterministic key can be written again by another writer; a size noted
  // for the old bytes must never describe the new ones.
  async function noted(url: string): Promise<void> {
    await noteStoredImage(url, await sharp(canvas(10, 10)).png().toBuffer())
    expect(storedImageDimensions(url)).toEqual({ width: 10, height: 10 })
  }

  it("a non-image buffer", async () => {
    await noted("https://r2.test.com/images/job-12.png")
    await uploadBufferToR2(Buffer.from("{}"), "images/job-12.png", "application/json")
    expect(storedImageDimensions("https://r2.test.com/images/job-12.png")).toBeUndefined()
  })

  it("a keyed file upload of a non-image, and an infra file upload", async () => {
    const dir = await mkdtemp(join(tmpdir(), "store-dims-"))
    dirs.push(dir)
    const path = join(dir, "x.bin")
    await writeFile(path, Buffer.from("bytes"))
    await noted("https://r2.test.com/audios/a.mp3")
    await uploadFileWithKeyToR2(path, "audios/a.mp3", "audio/mpeg")
    expect(storedImageDimensions("https://r2.test.com/audios/a.mp3")).toBeUndefined()
    await noted("https://r2.test.com/proxies/p.mp4")
    await uploadLocalFileToR2Key(path, "proxies/p.mp4", "video/mp4")
    expect(storedImageDimensions("https://r2.test.com/proxies/p.mp4")).toBeUndefined()
  })

  it("a keyed file upload of an image is measured like the others", async () => {
    const dir = await mkdtemp(join(tmpdir(), "store-dims-"))
    dirs.push(dir)
    const path = join(dir, "still.png")
    await writeFile(path, await sharp(canvas(48, 96)).png().toBuffer())
    const url = await uploadFileWithKeyToR2(path, "images/still-1.png", "image/png")
    expect(storedImageDimensions(url)).toEqual({ width: 48, height: 96 })
  })

  it("a storage-to-storage copy over a key noted before (it holds no bytes to measure)", async () => {
    mocks.send.mockResolvedValue({ ContentLength: 10 })
    // The kept key is derived from the source, so a second copy lands on the same key.
    const url = await copyToTemplateKept("https://r2.test.com/images/src.png", "t1", "user-1")
    await noted(url)
    await copyToTemplateKept("https://r2.test.com/images/src.png", "t1", "user-1")
    expect(storedImageDimensions(url)).toBeUndefined()
  })

  it("every function in storage.ts that writes an object notes or drops the size it leaves behind", () => {
    const src = readFileSync(join(__dirname, "..", "storage.ts"), "utf8")
    const fns = src.split(/\n(?=(?:export )?(?:async )?function )/)
    const writers = fns.filter((f) => /new (PutObjectCommand|CopyObjectCommand)\(/.test(f) || /^(?:export )?(?:async )?function streamToR2\(/.test(f))
    // streamToR2, uploadBufferToR2, uploadFileToR2 and the four copy writers today.
    expect(writers.length).toBeGreaterThanOrEqual(7)
    const silent = writers
      .filter((f) => !/\b(noteStoredImage|forgetStoredImage)\(/.test(f))
      .map((f) => f.match(/function (\w+)/)?.[1])
    expect(silent, "a writer that measures nothing must forgetStoredImage(url); one holding image bytes must noteStoredImage(url, bytes)").toEqual([])
  })
})

describe("streamR2Object takes an abort signal (the stamp's bounded read)", () => {
  it("hands the signal and the range to the storage call", async () => {
    mocks.send.mockResolvedValueOnce({ Body: Readable.from([Buffer.from("x")]), ContentType: "image/png" })
    const controller = new AbortController()
    const object = await streamR2Object("images/job-10.png", { range: "bytes=0-1023", signal: controller.signal })
    expect(object?.contentType).toBe("image/png")
    const [cmd] = mocks.send.mock.calls[0] as [{ Key: string; Range: string }]
    expect(cmd).toMatchObject({ Key: "images/job-10.png", Range: "bytes=0-1023" })
    expect(mocks.sendOptions[0]).toEqual({ abortSignal: controller.signal })
  })

  it("without a signal it sends exactly as before", async () => {
    mocks.send.mockResolvedValueOnce({ Body: Readable.from([Buffer.from("x")]) })
    await streamR2Object("images/job-11.png")
    expect(mocks.sendOptions[0]).toBeUndefined()
  })
})
