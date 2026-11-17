import { describe, it, expect, vi } from "vitest"
import {
  createClient,
  StaticTokenAuth,
  LargeUploadUnavailableError,
  MediaTooLongError,
  NodaroError,
  StorageExceededError,
  UPLOAD_MAX_BYTES,
} from "../../index.js"
import type { UploadResult } from "../../index.js"

const RESULT: UploadResult = {
  url: "https://cdn.example.com/uploads/videos/v.mp4",
  assetId: "asset_1",
  thumbnailUrl: "https://cdn.example.com/uploads/videos/v_thumb.png",
  category: "video",
  filename: "talk.mp4",
  mimeType: "video/mp4",
  sizeBytes: 10,
  r2Key: "uploads/videos/v.mp4",
}

/** A file just over the /v1/upload cap, in three parts. Its slices carry only a size (the fake store reads nothing else). */
const BIG = UPLOAD_MAX_BYTES + 3
const PART = Math.ceil(BIG / 3)
function bigFile(size = BIG): Blob {
  return {
    size,
    type: "video/mp4",
    name: "talk.mp4",
    slice: (start: number, end: number) => ({ size: end - start }) as unknown as Blob,
  } as unknown as Blob
}

const json = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response

/** A fake server: the API routes answer by path, part PUTs by `part`. */
function server(opts: {
  start?: () => Response
  complete?: () => Response
  part?: (partNumber: number, attempt: number) => Response | Promise<Response>
} = {}) {
  const attempts = new Map<number, number>()
  const puts: Array<{ part: number; size: number }> = []
  const calls: string[] = []
  const fetch = vi.fn(async (url: string, init: { method: string; body?: unknown }) => {
    if (url.startsWith("https://store.test/part/")) {
      const n = Number(url.split("/").pop())
      const attempt = (attempts.get(n) ?? 0) + 1
      attempts.set(n, attempt)
      const res = await (opts.part?.(n, attempt) ?? json(200, {}))
      if (res.ok) puts.push({ part: n, size: (init.body as Blob).size })
      return res
    }
    calls.push(new URL(url).pathname)
    if (url.endsWith("/v1/uploads/large/start")) {
      return opts.start?.() ?? json(200, { token: "tok", partSize: PART, partUrls: [1, 2, 3].map((i) => `https://store.test/part/${i}`) })
    }
    if (url.endsWith("/v1/uploads/large/complete")) return opts.complete?.() ?? json(200, { data: RESULT })
    if (url.endsWith("/v1/uploads/large/abort")) return json(200, { data: { aborted: true } })
    if (url.endsWith("/v1/upload")) return json(200, { data: RESULT })
    return json(404, {})
  })
  const client = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetch as unknown as typeof globalThis.fetch })
  return { client, fetch, puts, calls, attempts }
}

describe("uploads.uploadLarge — a file within 500 MB keeps today's path", () => {
  it("UPLOAD_MAX_BYTES is /v1/upload's 500 MB", () => {
    expect(UPLOAD_MAX_BYTES).toBe(500 * 1024 * 1024)
  })

  it("sends a small file with POST /v1/upload and never touches the large lane", async () => {
    const s = server()
    const progress: Array<[number, number]> = []
    const small = new File([new Uint8Array(10)], "talk.mp4", { type: "video/mp4" })
    await expect(s.client.uploads.uploadLarge(small, { onProgress: (a, b) => progress.push([a, b]) })).resolves.toEqual(RESULT)
    expect(s.calls).toEqual(["/v1/upload"])
    expect(((s.fetch.mock.calls[0]![1] as { body: FormData }).body.get("file") as File).name).toBe("talk.mp4")
    expect(progress).toEqual([[10, 10]])
  })

  it("exactly 500 MB still takes /v1/upload", async () => {
    const s = server()
    // FormData needs a real Blob; it reports the cap as its size (the route is what is tested).
    const atCap = new Blob([new Uint8Array(1)], { type: "video/mp4" })
    Object.defineProperty(atCap, "size", { value: UPLOAD_MAX_BYTES })
    await expect(s.client.uploads.uploadLarge(atCap, { filename: "cap.mp4" })).resolves.toEqual(RESULT)
    expect(s.calls).toEqual(["/v1/upload"])
  })
})

describe("uploads.uploadLarge — a file over 500 MB goes straight to storage", () => {
  it("starts, PUTs every part of partSize, then completes and returns the stored file", async () => {
    const s = server()
    const progress: Array<[number, number]> = []
    const result = await s.client.uploads.uploadLarge(bigFile(), { onProgress: (a, b) => progress.push([a, b]) })

    expect(result).toEqual(RESULT)
    const startInit = s.fetch.mock.calls[0]![1] as { body: string }
    expect(JSON.parse(startInit.body)).toEqual({ filename: "talk.mp4", mimeType: "video/mp4", sizeBytes: BIG })
    expect([...s.puts].sort((a, b) => a.part - b.part)).toEqual([
      { part: 1, size: PART },
      { part: 2, size: PART },
      { part: 3, size: BIG - 2 * PART },
    ])
    expect(s.calls).toEqual(["/v1/uploads/large/start", "/v1/uploads/large/complete"])
    const complete = s.fetch.mock.calls.find((c) => (c[0] as string).endsWith("/complete"))!
    expect(JSON.parse((complete[1] as { body: string }).body)).toEqual({ token: "tok" })
    expect(progress.at(-1)).toEqual([BIG, BIG])
  })

  it("sends at most `concurrency` parts at once", async () => {
    let inFlight = 0
    let peak = 0
    const s = server({
      part: async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight--
        return json(200, {})
      },
    })
    await s.client.uploads.uploadLarge(bigFile(), { concurrency: 2 })
    expect(peak).toBe(2)
  })

  it("retries a failed part, and aborts the upload when it keeps failing", async () => {
    const flaky = server({ part: (n, attempt) => (n === 2 && attempt < 3 ? json(503, {}) : json(200, {})) })
    await expect(flaky.client.uploads.uploadLarge(bigFile())).resolves.toEqual(RESULT)
    expect(flaky.attempts.get(2)).toBe(3)

    const broken = server({ part: (n) => (n === 2 ? json(500, {}) : json(200, {})) })
    const err = await broken.client.uploads.uploadLarge(bigFile()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NodaroError)
    expect((err as NodaroError).code).toBe("upload_part_failed")
    expect(broken.attempts.get(2)).toBe(3)
    expect(broken.calls).toContain("/v1/uploads/large/abort")
    expect(broken.calls).not.toContain("/v1/uploads/large/complete")
  })

  it("does not retry a refused part (an expired link)", async () => {
    const s = server({ part: (n) => (n === 1 ? json(403, {}) : json(200, {})) })
    await expect(s.client.uploads.uploadLarge(bigFile())).rejects.toBeInstanceOf(NodaroError)
    expect(s.attempts.get(1)).toBe(1)
  })

  it("a cancel aborts the upload on the server", async () => {
    const controller = new AbortController()
    const s = server({
      part: async (n) => {
        if (n === 1) controller.abort()
        return json(200, {})
      },
    })
    await expect(s.client.uploads.uploadLarge(bigFile(), { signal: controller.signal, concurrency: 1 })).rejects.toBeDefined()
    expect(s.calls).toContain("/v1/uploads/large/abort")
    expect(s.calls).not.toContain("/v1/uploads/large/complete")
  })

  it("a file over 30 minutes rejects with MediaTooLongError", async () => {
    const s = server({ complete: () => json(422, { error: { code: "media_too_long", message: "This video is longer than 30 minutes." } }) })
    const err = await s.client.uploads.uploadLarge(bigFile()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MediaTooLongError)
    expect((err as MediaTooLongError).status).toBe(422)
  })

  it("a full storage at start rejects with StorageExceededError and sends no part", async () => {
    const s = server({ start: () => json(413, { error: { code: "storage_limit_exceeded", message: "full" } }) })
    const err = await s.client.uploads.uploadLarge(bigFile()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StorageExceededError)
    expect((err as StorageExceededError).reason).toBe("storage_limit_exceeded")
    expect(s.puts).toEqual([])
  })

  it("a server without the lane (409 or 404) throws LargeUploadUnavailableError and never tries /v1/upload", async () => {
    for (const [start, status] of [
      [() => json(409, { error: { code: "large_upload_unavailable", message: "no" } }), 409],
      [() => json(404, { statusCode: 404, error: "Not Found", message: "Route POST:/v1/uploads/large/start not found" }), 404],
    ] as const) {
      const s = server({ start })
      const err = await s.client.uploads.uploadLarge(bigFile()).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(LargeUploadUnavailableError)
      expect((err as LargeUploadUnavailableError).code).toBe("large_upload_unavailable")
      expect((err as LargeUploadUnavailableError).status).toBe(status)
      expect(s.calls).toEqual(["/v1/uploads/large/start"])
    }
  })
})
