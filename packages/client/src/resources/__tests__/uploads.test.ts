import { describe, it, expect, vi } from "vitest"
import {
  createClient,
  StaticTokenAuth,
  NodaroError,
  StorageExceededError,
} from "../../index.js"
import type { UploadResult } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}

const UPLOADED: UploadResult = {
  url: "https://cdn.example.com/uploads/images/abc.png",
  assetId: "asset_123",
  thumbnailUrl: "https://cdn.example.com/uploads/images/abc_thumb.png",
  category: "image",
  filename: "a.png",
  mimeType: "image/png",
  sizeBytes: 5,
  r2Key: "uploads/images/abc.png",
}

// Node ≥18 ships `File` as a global; fall back to a cast `Blob` if it isn't.
function makeFile(): File {
  if (typeof File !== "undefined") {
    return new File(["hello"], "a.png", { type: "image/png" })
  }
  return new Blob(["hello"], { type: "image/png" }) as unknown as File
}

describe("uploads resource", () => {
  it("upload() POSTs /v1/upload, sends the file as multipart, and unwraps `data`", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: UPLOADED }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.uploads.upload(makeFile())

    expect((fetchMock.mock.calls[0][0] as string).endsWith("/v1/upload")).toBe(true)
    const init = fetchMock.mock.calls[0][1] as { method: string; body: unknown }
    expect(init.method).toBe("POST")
    // The body is a real FormData (not a JSON string), carrying the file under `file`.
    expect(init.body).toBeInstanceOf(FormData)
    const sentFile = (init.body as FormData).get("file")
    expect(sentFile).toBeInstanceOf(Blob) // File extends Blob; covers the cast-Blob fallback too

    expect(result).toEqual(UPLOADED)
    expect(result.url).toBe(UPLOADED.url)
    expect(result.assetId).toBe("asset_123")
  })

  it("sends NO JSON content-type for a FormData body, but still applies the auth header", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: UPLOADED }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.uploads.upload(makeFile())

    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
    // The runtime sets `Content-Type: multipart/form-data; boundary=…` itself —
    // the SDK must not inject a JSON content-type (it would corrupt the boundary).
    expect(init.headers["Content-Type"]).toBeUndefined()
    // Auth is still applied on the multipart path.
    expect(init.headers["Authorization"]).toBe("Bearer t")
  })

  it("regression: a non-FormData body still JSON-stringifies and sets the JSON content-type", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { ok: true } }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.request("POST", "/v1/whatever", { body: { a: 1 } })

    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string>; body: unknown }
    expect(init.headers["Content-Type"]).toBe("application/json")
    expect(typeof init.body).toBe("string")
    expect(JSON.parse(init.body as string)).toEqual({ a: 1 })
  })

  it("rejects with StorageExceededError on 413 (also a NodaroError, carries limitBytes)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(413, { error: { code: "storage_limit_exceeded", limitBytes: 10_000_000 } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const err = await c.uploads.upload(makeFile()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StorageExceededError)
    expect(err).toBeInstanceOf(NodaroError)
    expect((err as StorageExceededError).limitBytes).toBe(10_000_000)
  })
})
