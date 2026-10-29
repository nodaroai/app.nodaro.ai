import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, NodaroError, StorageExceededError } from "../index.js"
import type { ImportUrlResult } from "../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}

const IMPORTED: ImportUrlResult = {
  url: "https://cdn.example.com/uploads/images/abc.jpg",
  thumbnailUrl: "https://cdn.example.com/uploads/images/abc_thumb.jpg",
  assetId: "asset_123",
  mimeType: "image/jpeg",
  sizeBytes: 48_213,
  filename: "photo.jpg",
  width: 1200,
  height: 800,
}

const SOURCE = "https://example.org/pictures/photo.jpg"

function client(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock as unknown as typeof fetch })
}

describe("uploads.importUrl", () => {
  it("POSTs { url } as JSON to /v1/media/import-url and unwraps `data`", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: IMPORTED }))

    const result = await client(fetchMock).uploads.importUrl(SOURCE)

    expect((fetchMock.mock.calls[0][0] as string).endsWith("/v1/media/import-url")).toBe(true)
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string; headers: Record<string, string> }
    expect(init.method).toBe("POST")
    expect(init.headers["Content-Type"]).toBe("application/json")
    expect(JSON.parse(init.body)).toEqual({ url: SOURCE })
    expect(result).toEqual(IMPORTED)
  })

  it("rejects a 422 fetch_failed with a NodaroError carrying that code", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(422, { error: { code: "fetch_failed", message: "The URL responded with HTTP 404" } }),
    )

    const err = await client(fetchMock).uploads.importUrl(SOURCE).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(NodaroError)
    expect((err as NodaroError).code).toBe("fetch_failed")
    expect((err as NodaroError).status).toBe(422)
  })

  it("rejects a 400 validation_error with a NodaroError carrying that code", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(400, { error: { code: "validation_error", message: "That URL doesn't point to a decodable image" } }),
    )

    const err = await client(fetchMock).uploads.importUrl(SOURCE).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(NodaroError)
    expect((err as NodaroError).code).toBe("validation_error")
    expect((err as NodaroError).status).toBe(400)
  })

  it("rejects a 413 storage_limit_exceeded with a StorageExceededError, the quota in its details", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(413, {
        error: {
          code: "storage_limit_exceeded",
          message: "Storage limit exceeded",
          usedBytes: 9_990_000,
          quotaBytes: 10_000_000,
          remainingBytes: 10_000,
          tier: "free",
        },
      }),
    )

    const err = await client(fetchMock).uploads.importUrl(SOURCE).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(StorageExceededError)
    expect(err).toBeInstanceOf(NodaroError)
    expect((err as StorageExceededError).reason).toBe("storage_limit_exceeded")
    expect((err as StorageExceededError).code).toBe("storage_exceeded")
    expect((err as StorageExceededError).details.quotaBytes).toBe(10_000_000)
    expect((err as StorageExceededError).details.remainingBytes).toBe(10_000)
  })

  it("rejects a 413 file_too_large with a StorageExceededError whose reason is file_too_large", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(413, { error: { code: "file_too_large", message: "Images up to 20MB can be imported" } }),
    )

    const err = await client(fetchMock).uploads.importUrl(SOURCE).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(StorageExceededError)
    expect((err as StorageExceededError).reason).toBe("file_too_large")
    expect((err as StorageExceededError).code).toBe("storage_exceeded")
    expect((err as StorageExceededError).status).toBe(413)
  })

  it("leaves reason undefined on a 413 that carries no code", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockErr(413, { error: { message: "Too large" } }))

    const err = await client(fetchMock).uploads.importUrl(SOURCE).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(StorageExceededError)
    expect((err as StorageExceededError).reason).toBeUndefined()
    expect((err as StorageExceededError).code).toBe("storage_exceeded")
  })
})
