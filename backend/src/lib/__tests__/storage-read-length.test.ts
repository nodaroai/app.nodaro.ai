// @test-reads-none writes and reads only its own temp directory; reads no repo file
/**
 * `downloadR2ObjectToFile` holds what it wrote to the object's stored size:
 * a read that ends early is refused (its partial file removed), never handed
 * on as the whole file. The storage client is a stub answering GetObject with
 * a body and a `ContentLength`; the streams and the temp directory are real.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { Readable } from "node:stream"

const mocks = vi.hoisted(() => ({ send: vi.fn() }))

vi.mock("@aws-sdk/client-s3", () => {
  class MockS3Client { send = mocks.send }
  class Passthrough { constructor(params: unknown) { Object.assign(this, params) } }
  return {
    S3Client: MockS3Client,
    GetObjectCommand: Passthrough,
    PutObjectCommand: Passthrough,
    DeleteObjectCommand: Passthrough,
    DeleteObjectsCommand: Passthrough,
    CopyObjectCommand: Passthrough,
    HeadObjectCommand: Passthrough,
    ListObjectsV2Command: Passthrough,
    CreateBucketCommand: Passthrough,
    PutBucketPolicyCommand: Passthrough,
  }
})
vi.mock("../config.js", () => ({
  config: {
    R2_ENDPOINT: "http://127.0.0.1:1", R2_ACCOUNT_ID: "", R2_ACCESS_KEY_ID: "key", R2_SECRET_ACCESS_KEY: "secret",
    R2_REGION: "auto", R2_BUCKET_NAME: "bucket", R2_PUBLIC_URL: "https://cdn.example", R2_FORCE_PATH_STYLE: true, STORAGE_OBJECT_ACL: "",
  },
}))
vi.mock("../../utils/file-validation.js", () => ({
  updateStorageUsage: vi.fn(), reserveStorageIfWithinLimit: vi.fn(), refundStorage: vi.fn(), getSizeLimit: vi.fn(),
}))

const { downloadR2ObjectToFile } = await import("../storage.js")
const { DownloadIncompleteError } = await import("../download-incomplete.js")

let dir = ""
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "storage-read-length-")) })
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

function stored(body: Buffer, extra: Record<string, unknown>) {
  mocks.send.mockResolvedValueOnce({ Body: Readable.from([body]), ...extra })
}
const exists = (p: string) => stat(p).then(() => true, () => false)

describe("downloadR2ObjectToFile checks the stored size", () => {
  it("refuses a read shorter than ContentLength and removes the partial file", async () => {
    const dest = join(dir, "short.bin")
    stored(Buffer.alloc(6, 1), { ContentLength: 10 })

    const err = await downloadR2ObjectToFile("videos/a.mp4", dest).then(() => null, (e: Error) => e)

    expect(err).toBeInstanceOf(DownloadIncompleteError)
    expect(err?.message).toBe("Download incomplete: wrote 6 of the 10 bytes announced: r2 object videos/a.mp4")
    expect(await exists(dest)).toBe(false)
  })

  it("on a caller's budget too", async () => {
    const dest = join(dir, "short-budget.bin")
    stored(Buffer.alloc(6, 1), { ContentLength: 10 })

    await expect(downloadR2ObjectToFile("videos/b.mp4", dest, { timeoutMs: 10_000, maxBytes: 1024 })).rejects.toBeInstanceOf(DownloadIncompleteError)
    expect(await exists(dest)).toBe(false)
  })

  it("keeps an exact read as before", async () => {
    const dest = join(dir, "exact.bin")
    stored(Buffer.from("hello"), { ContentLength: 5 })

    await downloadR2ObjectToFile("videos/c.mp4", dest)

    expect(await readFile(dest, "utf8")).toBe("hello")
  })

  it("does not compare when the store reports no size", async () => {
    const dest = join(dir, "unsized.bin")
    stored(Buffer.from("hello"), {})

    await downloadR2ObjectToFile("videos/d.mp4", dest)

    expect(await readFile(dest, "utf8")).toBe("hello")
  })

  it("checks the raw bytes of an object stored with a content coding", async () => {
    const dest = join(dir, "encoded.bin")
    stored(Buffer.from("hello"), { ContentLength: 5, ContentEncoding: "gzip" })

    await downloadR2ObjectToFile("videos/e.mp4", dest)

    expect(await readFile(dest, "utf8")).toBe("hello")
  })
  it("refuses a short encoded object", async () => {
    const dest = join(dir, "short-gzip.bin")
    stored(Buffer.alloc(5), { ContentLength: 10, ContentEncoding: "gzip" })
    await expect(downloadR2ObjectToFile("videos/e.mp4", dest)).rejects.toBeInstanceOf(DownloadIncompleteError)
    expect(await exists(dest)).toBe(false)
  })

  it("removes the partial file when the storage body errors", async () => {
    const dest = join(dir, "interrupted.bin")
    const failure = new Error("socket disconnected")
    const body = Readable.from((async function* () {
      yield Buffer.alloc(5)
      await new Promise(resolve => setTimeout(resolve, 10))
      throw failure
    })())
    mocks.send.mockResolvedValueOnce({ Body: body, ContentLength: 10 })
    await expect(downloadR2ObjectToFile("videos/e.mp4", dest)).rejects.toBe(failure)
    expect(await exists(dest)).toBe(false)
  })

})
