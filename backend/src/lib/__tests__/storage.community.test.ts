import { describe, it, expect, vi, beforeEach } from "vitest"

// Mirrors the proven mock setup in storage.test.ts: the module-level
// `s3 = new S3Client(...)` runs at import time, so the S3Client mock must be
// hoisted and its instances must expose the shared `send` spy. We keep the real
// AWS command constructors (ListObjectsV2Command / CopyObjectCommand /
// HeadObjectCommand) so the params captured by `send` reflect real shapes.
const mocks = vi.hoisted(() => {
  const mockSend = vi.fn()
  const listCalls: unknown[] = []
  const copyCalls: unknown[] = []
  const headCalls: unknown[] = []
  const safeFetchMock = vi.fn()
  return { mockSend, listCalls, copyCalls, headCalls, safeFetchMock }
})

vi.mock("@aws-sdk/client-s3", () => {
  class MockS3Client {
    send = mocks.mockSend
  }
  class MockListObjectsV2Command {
    constructor(params: unknown) {
      Object.assign(this, params)
      mocks.listCalls.push(params)
    }
  }
  class MockCopyObjectCommand {
    constructor(params: unknown) {
      Object.assign(this, params)
      mocks.copyCalls.push(params)
    }
  }
  class MockHeadObjectCommand {
    constructor(params: unknown) {
      Object.assign(this, params)
      mocks.headCalls.push(params)
    }
  }
  // Other commands are referenced at module load by storage.ts; stub them so
  // the import doesn't crash even though these tests don't exercise them.
  class Noop {
    constructor(params: unknown) {
      Object.assign(this, params)
    }
  }
  return {
    S3Client: MockS3Client,
    ListObjectsV2Command: MockListObjectsV2Command,
    CopyObjectCommand: MockCopyObjectCommand,
    HeadObjectCommand: MockHeadObjectCommand,
    PutObjectCommand: Noop,
    DeleteObjectCommand: Noop,
    DeleteObjectsCommand: Noop,
  }
})

vi.mock("@aws-sdk/lib-storage", () => {
  class MockUpload {
    constructor() {}
    async done() {
      return {}
    }
    async abort() {
      return {}
    }
  }
  return { Upload: MockUpload }
})

vi.mock("@/lib/config.js", () => ({
  config: {
    R2_ACCOUNT_ID: "test-account",
    R2_ACCESS_KEY_ID: "test-key",
    R2_SECRET_ACCESS_KEY: "test-secret",
    R2_BUCKET_NAME: "test-bucket",
    R2_PUBLIC_URL: "https://r2.test.com",
    EDITION: "cloud",
  },
}))

vi.mock("@/utils/file-validation.js", () => ({
  updateStorageUsage: vi.fn().mockResolvedValue(undefined),
  reserveStorageIfWithinLimit: vi.fn().mockResolvedValue(true),
  refundStorage: vi.fn().mockResolvedValue(undefined),
  getSizeLimit: vi.fn(() => 1024),
}))

vi.mock("@/lib/safe-fetch.js", () => ({
  safeFetch: mocks.safeFetchMock,
}))

import { listObjectsByPrefix, copyR2ObjectToPrefix } from "@/lib/storage.js"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockSend.mockReset()
  mocks.listCalls.length = 0
  mocks.copyCalls.length = 0
  mocks.headCalls.length = 0
  mocks.safeFetchMock.mockReset()
})

describe("listObjectsByPrefix", () => {
  it("loops continuation tokens until exhausted", async () => {
    mocks.mockSend
      .mockResolvedValueOnce({
        Contents: [{ Key: "community/a/1" }],
        IsTruncated: true,
        NextContinuationToken: "t1",
      })
      .mockResolvedValueOnce({ Contents: [{ Key: "community/a/2" }], IsTruncated: false })

    const keys = await listObjectsByPrefix("community/a/")

    expect(keys).toEqual(["community/a/1", "community/a/2"])
    expect(mocks.mockSend).toHaveBeenCalledTimes(2)
    // Second call must carry the continuation token from the first response.
    expect(mocks.listCalls[0]).toEqual(
      expect.objectContaining({ Bucket: "test-bucket", Prefix: "community/a/" }),
    )
    expect(mocks.listCalls[1]).toEqual(
      expect.objectContaining({ ContinuationToken: "t1" }),
    )
  })

  it("returns an empty array when the prefix has no objects", async () => {
    mocks.mockSend.mockResolvedValueOnce({ Contents: [], IsTruncated: false })

    const keys = await listObjectsByPrefix("community/empty/")

    expect(keys).toEqual([])
    expect(mocks.mockSend).toHaveBeenCalledTimes(1)
  })

  it("skips entries without a Key", async () => {
    mocks.mockSend.mockResolvedValueOnce({
      Contents: [{ Key: "community/a/1" }, {}, { Key: "community/a/2" }],
      IsTruncated: false,
    })

    const keys = await listObjectsByPrefix("community/a/")

    expect(keys).toEqual(["community/a/1", "community/a/2"])
  })
})

describe("copyR2ObjectToPrefix", () => {
  it("R2->R2 copies our own URL and HEADs the dest for bytes", async () => {
    // CopyObjectCommand resolves, then HeadObjectCommand returns ContentLength.
    mocks.mockSend
      .mockResolvedValueOnce({}) // CopyObjectCommand
      .mockResolvedValueOnce({ ContentLength: 4242 }) // HeadObjectCommand

    const result = await copyR2ObjectToPrefix(
      "https://r2.test.com/videos/job-123.mp4",
      "community/clones/",
    )

    expect(mocks.copyCalls).toHaveLength(1)
    const copy = mocks.copyCalls[0] as Record<string, unknown>
    expect(copy.Bucket).toBe("test-bucket")
    // dest key = <prefix><uuid>.<ext> — ext preserved from source
    expect(String(copy.Key)).toMatch(/^community\/clones\/[0-9a-f-]+\.mp4$/)
    // CopySource references the source key within the bucket
    expect(String(copy.CopySource)).toContain("videos/job-123.mp4")

    expect(mocks.headCalls).toHaveLength(1)
    const head = mocks.headCalls[0] as Record<string, unknown>
    expect(head.Key).toBe(copy.Key) // HEAD the dest, not the source

    expect(result.bytes).toBe(4242)
    expect(result.url).toMatch(
      /^https:\/\/r2\.test\.com\/community\/clones\/[0-9a-f-]+\.mp4$/,
    )
    expect(result.url).toBe(`https://r2.test.com/${String(copy.Key)}`)
    // no foreign fetch for our own URL
    expect(mocks.safeFetchMock).not.toHaveBeenCalled()
  })

  it("foreign URL falls back to safeFetch + stream upload", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(128))
        controller.close()
      },
    })
    mocks.safeFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      body,
    } as unknown as Response)
    // Only the dest HEAD hits s3.send on the foreign path (Upload is mocked).
    mocks.mockSend.mockResolvedValueOnce({ ContentLength: 128 })

    const result = await copyR2ObjectToPrefix(
      "https://foreign.example.com/asset.webp",
      "community/clones/",
    )

    expect(mocks.safeFetchMock).toHaveBeenCalledTimes(1)
    expect(mocks.copyCalls).toHaveLength(0) // no R2->R2 copy for foreign URL
    expect(result.bytes).toBe(128)
    expect(result.url).toMatch(
      /^https:\/\/r2\.test\.com\/community\/clones\/[0-9a-f-]+\.webp$/,
    )
  })
})
