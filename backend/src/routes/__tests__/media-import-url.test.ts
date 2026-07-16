import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  reserveStorageIfWithinLimit: vi.fn(),
  refundStorage: vi.fn(),
  checkStorageQuota: vi.fn(),
  uploadBufferToR2: vi.fn(),
  processImage: vi.fn(),
  insertSingle: vi.fn(),
  sharpMetadata: vi.fn(),
  sharpToBuffer: vi.fn(),
}))

vi.mock("@/lib/safe-fetch.js", () => ({
  safeFetch: h.safeFetch,
  isPrivateOrReservedIP: (ip: string) =>
    /^(10\.|127\.|192\.168\.|169\.254\.|::1$|fe80:)/.test(ip),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      insert: () => ({ select: () => ({ single: h.insertSingle }) }),
    }),
  },
}))

vi.mock("@/lib/storage.js", () => ({
  uploadBufferToR2: h.uploadBufferToR2,
}))

vi.mock("@/utils/file-validation.js", () => ({
  reserveStorageIfWithinLimit: h.reserveStorageIfWithinLimit,
  refundStorage: h.refundStorage,
  checkStorageQuota: h.checkStorageQuota,
}))

vi.mock("@/utils/thumbnail.js", () => ({
  processImage: h.processImage,
}))

vi.mock("sharp", () => ({
  default: () => ({ metadata: h.sharpMetadata, jpeg: () => ({ toBuffer: h.sharpToBuffer }) }),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { mediaImportUrlRoutes } from "../media-import-url.js"

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let app: FastifyInstance

function makeApp(userId: string | null = "user-1") {
  const instance = Fastify({ logger: false })
  // Bypass auth — the platform's request type already declares `userId`;
  // assign it in a hook exactly like the sibling media-delete suite.
  instance.addHook("preHandler", async (req) => {
    if (userId) req.userId = userId
  })
  instance.register(mediaImportUrlRoutes)
  return instance
}

/** A fetch Response whose body streams `bytes` in one chunk. */
function fetchResponse(bytes: Buffer, init: { status?: number; contentType?: string } = {}) {
  return new Response(new Uint8Array(bytes), {
    status: init.status ?? 200,
    headers: { "content-type": init.contentType ?? "image/jpeg" },
  })
}

const IMPORT_URL = "https://images.example.com/face.jpg"

beforeEach(() => {
  vi.clearAllMocks()
  h.safeFetch.mockResolvedValue(fetchResponse(Buffer.from("jpeg-bytes")))
  h.sharpMetadata.mockResolvedValue({ format: "jpeg" })
  h.reserveStorageIfWithinLimit.mockResolvedValue(true)
  h.uploadBufferToR2.mockImplementation((_buf: Buffer, key: string) =>
    Promise.resolve(`https://pub-test.r2.dev/${key}`),
  )
  h.processImage.mockResolvedValue({ metadata: { width: 800, height: 600 }, thumbnail: Buffer.from("t") })
  h.insertSingle.mockResolvedValue({ data: { id: "asset-1" }, error: null })
})

afterEach(async () => {
  await app?.close()
})

async function post(body: unknown, userId: string | null = "user-1") {
  app = makeApp(userId)
  return app.inject({ method: "POST", url: "/v1/media/import-url", payload: body as object })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/media/import-url", () => {
  it("401s without auth", async () => {
    const res = await post({ url: IMPORT_URL }, null)
    expect(res.statusCode).toBe(401)
  })

  it("rejects a private-network URL at the zod boundary (no fetch made)", async () => {
    const res = await post({ url: "http://192.168.1.10/pic.jpg" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(h.safeFetch).not.toHaveBeenCalled()
  })

  it("imports an image: fetch → reserve → R2 → asset, /v1/upload response shape", async () => {
    const res = await post({ url: IMPORT_URL })
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data.url).toMatch(/^https:\/\/pub-test\.r2\.dev\/uploads\/images\/.+\.jpg$/)
    expect(data.thumbnailUrl).toMatch(/_thumb\.jpg$/)
    expect(data.assetId).toBe("asset-1")
    expect(data.mimeType).toBe("image/jpeg")
    expect(data.filename).toBe("face.jpg")
    // Reservation happened BEFORE upload, and upload doesn't double-track.
    expect(h.reserveStorageIfWithinLimit).toHaveBeenCalledWith("user-1", expect.any(Number))
    expect(h.uploadBufferToR2).toHaveBeenCalledWith(expect.any(Buffer), expect.any(String), "image/jpeg")
  })

  it("422s when the origin is unreachable", async () => {
    h.safeFetch.mockRejectedValue(new Error("connect ECONNREFUSED"))
    const res = await post({ url: IMPORT_URL })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("fetch_failed")
  })

  it("422s on a non-2xx origin response", async () => {
    h.safeFetch.mockResolvedValue(fetchResponse(Buffer.from(""), { status: 403 }))
    const res = await post({ url: IMPORT_URL })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.message).toContain("403")
  })

  it("400s fast on an obvious non-image content-type without reading the body", async () => {
    h.safeFetch.mockResolvedValue(fetchResponse(Buffer.from("<html>"), { contentType: "text/html" }))
    const res = await post({ url: IMPORT_URL })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain("text/html")
    expect(h.sharpMetadata).not.toHaveBeenCalled()
  })

  it("400s when the bytes don't decode as an image (header lied)", async () => {
    h.sharpMetadata.mockRejectedValue(new Error("unsupported image format"))
    const res = await post({ url: IMPORT_URL })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(h.reserveStorageIfWithinLimit).not.toHaveBeenCalled()
  })

  it("413s over the byte cap, aborting mid-stream", async () => {
    const big = Buffer.alloc(21 * 1024 * 1024)
    h.safeFetch.mockResolvedValue(fetchResponse(big))
    const res = await post({ url: IMPORT_URL })
    expect(res.statusCode).toBe(413)
    expect(res.json().error.code).toBe("file_too_large")
  })

  it("413s with quota details when the storage reservation is refused", async () => {
    h.reserveStorageIfWithinLimit.mockResolvedValue(false)
    h.checkStorageQuota.mockResolvedValue({
      error: "Storage limit exceeded",
      usedBytes: 100,
      quotaBytes: 100,
      remainingBytes: 0,
      tier: "free",
    })
    const res = await post({ url: IMPORT_URL })
    expect(res.statusCode).toBe(413)
    expect(res.json().error.code).toBe("storage_limit_exceeded")
    expect(res.json().error.remainingBytes).toBe(0)
  })

  it("refunds the reservation when the R2 upload throws", async () => {
    h.uploadBufferToR2.mockRejectedValueOnce(new Error("r2 down"))
    const res = await post({ url: IMPORT_URL })
    expect(res.statusCode).toBe(500)
    expect(h.refundStorage).toHaveBeenCalledWith("user-1", expect.any(Number))
  })

  it("transcodes HEIC to JPEG like the upload route", async () => {
    h.sharpMetadata.mockResolvedValue({ format: "heif" })
    h.sharpToBuffer.mockResolvedValue(Buffer.from("jpeg-transcoded"))
    const res = await post({ url: IMPORT_URL })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.mimeType).toBe("image/jpeg")
    expect(h.sharpToBuffer).toHaveBeenCalled()
  })
})
