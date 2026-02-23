import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const mockSend = vi.fn().mockResolvedValue({})
  const putCalls: unknown[] = []
  const deleteCalls: unknown[] = []
  const deleteObjectsCalls: unknown[] = []
  return { mockSend, putCalls, deleteCalls, deleteObjectsCalls }
})

vi.mock("@aws-sdk/client-s3", () => {
  class MockS3Client {
    send = mocks.mockSend
  }
  class MockPutObjectCommand {
    constructor(params: unknown) {
      Object.assign(this, params)
      mocks.putCalls.push(params)
    }
  }
  class MockDeleteObjectCommand {
    constructor(params: unknown) {
      Object.assign(this, params)
      mocks.deleteCalls.push(params)
    }
  }
  class MockDeleteObjectsCommand {
    constructor(params: unknown) {
      Object.assign(this, params)
      mocks.deleteObjectsCalls.push(params)
    }
  }
  return {
    S3Client: MockS3Client,
    PutObjectCommand: MockPutObjectCommand,
    DeleteObjectCommand: MockDeleteObjectCommand,
    DeleteObjectsCommand: MockDeleteObjectsCommand,
  }
})

vi.mock("@aws-sdk/lib-storage", () => {
  class MockUpload {
    done = vi.fn().mockResolvedValue({})
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
}))

import {
  uploadBufferToR2,
  deleteFromR2,
  batchDeleteFromR2,
} from "@/lib/storage.js"
import { updateStorageUsage } from "@/utils/file-validation.js"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockSend.mockResolvedValue({})
  mocks.putCalls.length = 0
  mocks.deleteCalls.length = 0
  mocks.deleteObjectsCalls.length = 0
})

// ---------- uploadBufferToR2 ----------

describe("uploadBufferToR2", () => {
  it("calls send with PutObjectCommand params", async () => {
    const buf = Buffer.from("hello")
    await uploadBufferToR2(buf, "images/test.png", "image/png")

    expect(mocks.mockSend).toHaveBeenCalledTimes(1)
    expect(mocks.putCalls).toHaveLength(1)
    expect(mocks.putCalls[0]).toEqual(
      expect.objectContaining({
        Bucket: "test-bucket",
        Key: "images/test.png",
        Body: buf,
        ContentType: "image/png",
      }),
    )
  })

  it("returns the correct R2 public URL", async () => {
    const url = await uploadBufferToR2(
      Buffer.from("data"),
      "videos/abc.mp4",
      "video/mp4",
    )

    expect(url).toBe("https://r2.test.com/videos/abc.mp4")
  })

  it("tracks storage when userId is provided", async () => {
    const buf = Buffer.from("track me")
    await uploadBufferToR2(buf, "images/t.png", "image/png", "user-123")

    expect(updateStorageUsage).toHaveBeenCalledWith("user-123", buf.length)
  })

  it("does not track storage when userId is omitted", async () => {
    await uploadBufferToR2(Buffer.from("no track"), "images/t.png", "image/png")

    expect(updateStorageUsage).not.toHaveBeenCalled()
  })
})

// ---------- deleteFromR2 ----------

describe("deleteFromR2", () => {
  it("calls send with DeleteObjectCommand params", async () => {
    await deleteFromR2("images/old.png")

    expect(mocks.mockSend).toHaveBeenCalledTimes(1)
    expect(mocks.deleteCalls).toHaveLength(1)
    expect(mocks.deleteCalls[0]).toEqual(
      expect.objectContaining({
        Bucket: "test-bucket",
        Key: "images/old.png",
      }),
    )
  })
})

// ---------- batchDeleteFromR2 ----------

describe("batchDeleteFromR2", () => {
  it("returns zeroes for empty array without calling send", async () => {
    const result = await batchDeleteFromR2([])

    expect(result).toEqual({ deleted: 0, errors: 0 })
    expect(mocks.mockSend).not.toHaveBeenCalled()
  })

  it("sends a single batch for <= 1000 keys", async () => {
    const keys = Array.from({ length: 5 }, (_, i) => `key-${i}`)

    mocks.mockSend.mockResolvedValueOnce({
      Deleted: keys.map((Key) => ({ Key })),
      Errors: [],
    })

    const result = await batchDeleteFromR2(keys)

    expect(result).toEqual({ deleted: 5, errors: 0 })
    expect(mocks.mockSend).toHaveBeenCalledTimes(1)
    expect(mocks.deleteObjectsCalls).toHaveLength(1)
    expect(mocks.deleteObjectsCalls[0]).toEqual(
      expect.objectContaining({
        Bucket: "test-bucket",
        Delete: {
          Objects: keys.map((Key) => ({ Key })),
        },
      }),
    )
  })

  it("counts deleted and errors from response", async () => {
    mocks.mockSend.mockResolvedValueOnce({
      Deleted: [{ Key: "a" }, { Key: "b" }],
      Errors: [{ Key: "c", Code: "AccessDenied" }],
    })

    const result = await batchDeleteFromR2(["a", "b", "c"])

    expect(result).toEqual({ deleted: 2, errors: 1 })
  })

  it("chunks into multiple batches for > 1000 keys", async () => {
    const keys = Array.from({ length: 1500 }, (_, i) => `key-${i}`)

    // First batch: 1000 keys
    mocks.mockSend.mockResolvedValueOnce({
      Deleted: Array.from({ length: 1000 }, (_, i) => ({ Key: `key-${i}` })),
      Errors: [],
    })
    // Second batch: 500 keys
    mocks.mockSend.mockResolvedValueOnce({
      Deleted: Array.from({ length: 500 }, (_, i) => ({ Key: `key-${1000 + i}` })),
      Errors: [],
    })

    const result = await batchDeleteFromR2(keys)

    expect(result).toEqual({ deleted: 1500, errors: 0 })
    expect(mocks.mockSend).toHaveBeenCalledTimes(2)
  })

  it("counts all keys as errors when send throws", async () => {
    mocks.mockSend.mockRejectedValueOnce(new Error("network failure"))

    const result = await batchDeleteFromR2(["a", "b", "c"])

    expect(result).toEqual({ deleted: 0, errors: 3 })
  })
})
