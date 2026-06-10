import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Readable } from "node:stream"

const mocks = vi.hoisted(() => {
  const mockSend = vi.fn().mockResolvedValue({})
  const putCalls: unknown[] = []
  const deleteCalls: unknown[] = []
  const deleteObjectsCalls: unknown[] = []
  const uploadBodies: unknown[] = []
  const safeFetchMock = vi.fn()
  return { mockSend, putCalls, deleteCalls, deleteObjectsCalls, uploadBodies, safeFetchMock }
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

// Drain the body stream so our byte-counter Transform runs end-to-end.
// Real `@aws-sdk/lib-storage` Upload consumes the Body stream; mocking that
// read faithfully is what lets size-enforcement tests fail as expected.
vi.mock("@aws-sdk/lib-storage", () => {
  class MockUpload {
    private body: Readable
    constructor({ params }: { params: { Body: Readable } }) {
      this.body = params.Body
      mocks.uploadBodies.push(params.Body)
    }
    async done() {
      for await (const _ of this.body) {
        // consume; errors in the body (e.g. size-limit Transform) surface here
      }
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
  // Small caps keep size tests cheap; real values are 25MB/500MB/50MB.
  getSizeLimit: vi.fn((category: string) =>
    category === "image" ? 1024 : category === "video" ? 4096 : 2048,
  ),
}))

vi.mock("@/lib/safe-fetch.js", () => ({
  safeFetch: mocks.safeFetchMock,
}))

import {
  uploadToR2,
  uploadBufferToR2,
  deleteFromR2,
  batchDeleteFromR2,
} from "@/lib/storage.js"
import {
  updateStorageUsage,
  reserveStorageIfWithinLimit,
  refundStorage,
} from "@/utils/file-validation.js"

// Build a fetch-Response-like object with a WHATWG ReadableStream body.
// `chunks` are emitted in order; pass `headerLength` to advertise a
// Content-Length (may be a lie or omitted entirely).
function makeResponse({
  chunks,
  headerLength,
  ok = true,
  status = 200,
}: {
  chunks: Uint8Array[]
  headerLength?: number | null
  ok?: boolean
  status?: number
}) {
  const headers = new Headers()
  if (headerLength !== null && headerLength !== undefined) {
    headers.set("content-length", String(headerLength))
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })
  return { ok, status, headers, body } as unknown as Response
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockSend.mockResolvedValue({})
  mocks.putCalls.length = 0
  mocks.deleteCalls.length = 0
  mocks.deleteObjectsCalls.length = 0
  mocks.uploadBodies.length = 0
  mocks.safeFetchMock.mockReset()
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

// ---------- uploadToR2 (URL streaming) ----------
//
// These tests exercise the size-enforcement behaviour that closes the
// save-to-storage quota-bypass bug. getSizeLimit is mocked to small caps
// (image=1024, video=4096, audio=2048) so tests don't allocate megabytes
// of buffer just to cross a threshold.

describe("uploadToR2 — streaming size enforcement", () => {
  it("tracks counted bytes when Content-Length is absent", async () => {
    const payload = new Uint8Array(500) // below 1024 cap
    mocks.safeFetchMock.mockResolvedValueOnce(
      makeResponse({ chunks: [payload], headerLength: null }),
    )

    const url = await uploadToR2("https://src.example/x.png", "job-1", "image", "user-1")

    expect(url).toBe("https://r2.test.com/images/job-1.png")
    expect(updateStorageUsage).toHaveBeenCalledWith("user-1", 500)
  })

  it("tracks counted bytes even when Content-Length lies low", async () => {
    // Header claims 10 bytes but actual body is 800. Track the truth.
    const payload = new Uint8Array(800)
    mocks.safeFetchMock.mockResolvedValueOnce(
      makeResponse({ chunks: [payload], headerLength: 10 }),
    )

    await uploadToR2("https://src.example/x.png", "job-2", "image", "user-2")

    expect(updateStorageUsage).toHaveBeenCalledWith("user-2", 800)
  })

  it("early-rejects when Content-Length exceeds per-type cap", async () => {
    // Image cap is 1024. Advertise 2000 upfront — must reject before streaming.
    mocks.safeFetchMock.mockResolvedValueOnce(
      makeResponse({ chunks: [new Uint8Array(0)], headerLength: 2000 }),
    )

    await expect(
      uploadToR2("https://src.example/big.png", "job-3", "image", "user-3"),
    ).rejects.toThrow(/size|limit|exceed/i)

    expect(mocks.uploadBodies).toHaveLength(0) // upload was never started
    expect(updateStorageUsage).not.toHaveBeenCalled()
  })

  it("early-rejects when Content-Length exceeds remaining quota", async () => {
    // Image cap is 1024, remaining quota is 500 → effective cap 500.
    // Header advertises 600 → early reject.
    mocks.safeFetchMock.mockResolvedValueOnce(
      makeResponse({ chunks: [new Uint8Array(0)], headerLength: 600 }),
    )

    await expect(
      uploadToR2("https://src.example/x.png", "job-4", "image", "user-4", {
        remainingQuotaBytes: 500,
      }),
    ).rejects.toThrow(/size|limit|exceed|quota/i)

    expect(mocks.uploadBodies).toHaveLength(0)
    expect(updateStorageUsage).not.toHaveBeenCalled()
  })

  it("aborts mid-stream when body exceeds per-type cap without Content-Length", async () => {
    // No header, but body is 2000 bytes (> 1024 image cap). The counter
    // Transform must error mid-stream and propagate up through Upload.done().
    const chunks = [new Uint8Array(800), new Uint8Array(800), new Uint8Array(400)]
    mocks.safeFetchMock.mockResolvedValueOnce(
      makeResponse({ chunks, headerLength: null }),
    )

    await expect(
      uploadToR2("https://src.example/x.png", "job-5", "image", "user-5"),
    ).rejects.toThrow(/size|limit|exceed/i)

    // Upload started (body handed over) but failed. Storage not tracked.
    expect(updateStorageUsage).not.toHaveBeenCalled()
  })

  it("aborts mid-stream when body exceeds Content-Length (lying header)", async () => {
    // Header advertises 500 (passes early check against 1024 cap), but body
    // actually delivers 2000. Mid-stream enforcement must stop the upload.
    const chunks = [new Uint8Array(800), new Uint8Array(800), new Uint8Array(400)]
    mocks.safeFetchMock.mockResolvedValueOnce(
      makeResponse({ chunks, headerLength: 500 }),
    )

    await expect(
      uploadToR2("https://src.example/x.png", "job-6", "image", "user-6"),
    ).rejects.toThrow(/size|limit|exceed/i)

    expect(updateStorageUsage).not.toHaveBeenCalled()
  })

  it("aborts mid-stream when body exceeds remaining quota", async () => {
    // Remaining quota = 500, image cap = 1024 → effective cap 500.
    // Body streams 1200 bytes without a Content-Length header.
    const chunks = [new Uint8Array(400), new Uint8Array(400), new Uint8Array(400)]
    mocks.safeFetchMock.mockResolvedValueOnce(
      makeResponse({ chunks, headerLength: null }),
    )

    await expect(
      uploadToR2("https://src.example/x.png", "job-7", "image", "user-7", {
        remainingQuotaBytes: 500,
      }),
    ).rejects.toThrow(/size|limit|exceed|quota/i)

    expect(updateStorageUsage).not.toHaveBeenCalled()
  })

  it("does NOT delete the R2 key on upload failure (a concurrent finalizer may own a live object at the same deterministic key)", async () => {
    // Keys are deterministic (`images/<jobId>.png`), and the worker and the
    // reconcile cron can finalize the same job concurrently. A failure-path
    // delete here destroyed the OTHER writer's successfully-uploaded object
    // while the job stayed `completed` — permanent 404 for a charged job
    // (incident 2026-06-10, job 7955772a). Incomplete multipart uploads never
    // materialize an object (lib-storage aborts them), so there is nothing of
    // ours to clean up; the key must be left untouched.
    const chunks = [new Uint8Array(2000)]
    mocks.safeFetchMock.mockResolvedValueOnce(
      makeResponse({ chunks, headerLength: null }),
    )

    await expect(
      uploadToR2("https://src.example/x.png", "job-8", "image", "user-8"),
    ).rejects.toThrow()

    expect(mocks.deleteCalls).toHaveLength(0)
  })

  it("throws when the upstream fetch returns a non-ok status", async () => {
    mocks.safeFetchMock.mockResolvedValueOnce(
      makeResponse({ chunks: [], headerLength: 0, ok: false, status: 404 }),
    )

    await expect(
      uploadToR2("https://src.example/x.png", "job-9", "image", "user-9"),
    ).rejects.toThrow(/404/)

    expect(updateStorageUsage).not.toHaveBeenCalled()
  })
})

// ---------- uploadToR2 — atomic quota reservation ----------
//
// These tests cover the concurrent-upload oversubscription fix: reserveQuota
// pre-reserves effectiveCap via RPC, refunds the unused portion on success,
// and refunds the full reservation on failure. trackStorage is skipped in
// the reserved path because the RPC already committed the write.

describe("uploadToR2 — atomic quota reservation", () => {
  const reserveMock = vi.mocked(reserveStorageIfWithinLimit)
  const refundMock = vi.mocked(refundStorage)
  const trackMock = vi.mocked(updateStorageUsage)

  it("reserves effectiveCap before streaming and refunds unused bytes on success", async () => {
    // Image type cap (mocked) = 1024, snapshot says 800 remaining →
    // effectiveCap = 800. Actual body is 500 → refund 300.
    const payload = new Uint8Array(500)
    mocks.safeFetchMock.mockResolvedValueOnce(
      makeResponse({ chunks: [payload], headerLength: null }),
    )
    reserveMock.mockResolvedValueOnce(true)

    await uploadToR2("https://src.example/x.png", "job-r1", "image", "user-r1", {
      remainingQuotaBytes: 800,
      reserveQuota: true,
    })

    expect(reserveMock).toHaveBeenCalledWith("user-r1", 800)
    expect(refundMock).toHaveBeenCalledWith("user-r1", 300)
    expect(trackMock).not.toHaveBeenCalled()
  })

  it("rejects when the reservation RPC returns false (concurrent exhaustion)", async () => {
    // Two parallel callers each try to reserve 800 bytes; second one must
    // be turned away by the RPC because the first already committed.
    const payload = new Uint8Array(200)
    mocks.safeFetchMock.mockResolvedValueOnce(
      makeResponse({ chunks: [payload], headerLength: null }),
    )
    reserveMock.mockResolvedValueOnce(false)

    await expect(
      uploadToR2("https://src.example/x.png", "job-r2", "image", "user-r2", {
        remainingQuotaBytes: 800,
        reserveQuota: true,
      }),
    ).rejects.toThrow(/storage|limit|quota/i)

    expect(mocks.uploadBodies).toHaveLength(0)
    expect(refundMock).not.toHaveBeenCalled()
    expect(trackMock).not.toHaveBeenCalled()
  })

  it("refunds the full reservation when the upload fails mid-stream", async () => {
    // Reserve 800, then body overflows the cap → stream aborts → full refund.
    const chunks = [new Uint8Array(400), new Uint8Array(400), new Uint8Array(400)]
    mocks.safeFetchMock.mockResolvedValueOnce(
      makeResponse({ chunks, headerLength: null }),
    )
    reserveMock.mockResolvedValueOnce(true)

    await expect(
      uploadToR2("https://src.example/x.png", "job-r3", "image", "user-r3", {
        remainingQuotaBytes: 800,
        reserveQuota: true,
      }),
    ).rejects.toThrow(/size|limit|exceed/i)

    expect(reserveMock).toHaveBeenCalledWith("user-r3", 800)
    expect(refundMock).toHaveBeenCalledWith("user-r3", 800)
    expect(trackMock).not.toHaveBeenCalled()
  })

  it("skips refund when actual upload matches the reservation exactly", async () => {
    // effectiveCap = 800, body = 800, so nothing to refund.
    const payload = new Uint8Array(800)
    mocks.safeFetchMock.mockResolvedValueOnce(
      makeResponse({ chunks: [payload], headerLength: null }),
    )
    reserveMock.mockResolvedValueOnce(true)

    await uploadToR2("https://src.example/x.png", "job-r4", "image", "user-r4", {
      remainingQuotaBytes: 800,
      reserveQuota: true,
    })

    expect(reserveMock).toHaveBeenCalledWith("user-r4", 800)
    expect(refundMock).not.toHaveBeenCalled()
    expect(trackMock).not.toHaveBeenCalled()
  })

  it("leaves the non-reserve path using trackStorage (back-compat)", async () => {
    const payload = new Uint8Array(300)
    mocks.safeFetchMock.mockResolvedValueOnce(
      makeResponse({ chunks: [payload], headerLength: null }),
    )

    await uploadToR2("https://src.example/x.png", "job-r5", "image", "user-r5")

    expect(reserveMock).not.toHaveBeenCalled()
    expect(refundMock).not.toHaveBeenCalled()
    expect(trackMock).toHaveBeenCalledWith("user-r5", 300)
  })

  it("short-circuits Content-Length early-reject without consuming the reservation", async () => {
    // Content-Length advertises a value larger than effectiveCap → caller
    // must fail before reserving, so the user's quota isn't held unnecessarily.
    mocks.safeFetchMock.mockResolvedValueOnce(
      makeResponse({ chunks: [new Uint8Array(0)], headerLength: 5000 }),
    )

    await expect(
      uploadToR2("https://src.example/x.png", "job-r6", "image", "user-r6", {
        remainingQuotaBytes: 800,
        reserveQuota: true,
      }),
    ).rejects.toThrow(/size|limit|exceed/i)

    expect(reserveMock).not.toHaveBeenCalled()
    expect(refundMock).not.toHaveBeenCalled()
    expect(trackMock).not.toHaveBeenCalled()
  })
})
