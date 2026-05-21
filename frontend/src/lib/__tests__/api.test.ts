import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock: Supabase client
// ---------------------------------------------------------------------------

const mockGetSession = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: { getSession: mockGetSession },
  }),
}))

// ---------------------------------------------------------------------------
// Mock: sse-client (for generateAIWriterStream tests)
// ---------------------------------------------------------------------------

const mockStreamRequest = vi.fn()

vi.mock("@/lib/sse-client", () => ({
  streamRequest: (...args: unknown[]) => mockStreamRequest(...args),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks are declared)
// ---------------------------------------------------------------------------

import {
  getAuthHeaders,
  StorageExceededError,
  ConcurrentModificationError,
  getImageProxyUrl,
  generateImage,
  uploadFile,
  saveToStorageApi,
  getBatchJobStatus,
  getJobStatus,
  subscribeToDownloadProgress,
  generateAIWriterStream,
  saveLocation,
  approveLocationMainImage,
  recaptionLocation,
  restoreLocation,
  getJobStatusBatch,
  executeCollect,
} from "../api"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchJson(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  })
}

function mockFetchError(status: number, errBody: unknown) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(errBody),
    text: () => Promise.resolve(JSON.stringify(errBody)),
  })
}

function sessionWith(token: string) {
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: token } },
  })
}

function noSession() {
  mockGetSession.mockResolvedValue({ data: { session: null } })
}

/** Build an async generator that yields the given items. */
async function* fakeStream<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockGetSession.mockReset()
  mockStreamRequest.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---- getAuthHeaders -------------------------------------------------------

describe("getAuthHeaders", () => {
  it("returns Authorization header when session has access_token", async () => {
    sessionWith("tok-abc")
    const headers = await getAuthHeaders()
    expect(headers).toEqual({ Authorization: "Bearer tok-abc" })
  })

  it("returns empty object when no session", async () => {
    noSession()
    const headers = await getAuthHeaders()
    expect(headers).toEqual({})
  })

  it("returns empty object when getSession throws", async () => {
    mockGetSession.mockRejectedValue(new Error("network"))
    const headers = await getAuthHeaders()
    expect(headers).toEqual({})
  })
})

// ---- StorageExceededError -------------------------------------------------

describe("StorageExceededError", () => {
  it("has correct name and properties", () => {
    const err = new StorageExceededError("Full", 100, 200, 0, "pro")
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe("StorageExceededError")
    expect(err.message).toBe("Full")
    expect(err.usedBytes).toBe(100)
    expect(err.quotaBytes).toBe(200)
    expect(err.remainingBytes).toBe(0)
    expect(err.tier).toBe("pro")
  })
})

// ---- getImageProxyUrl -----------------------------------------------------

describe("getImageProxyUrl", () => {
  it("returns URL-encoded proxy path", () => {
    const url = getImageProxyUrl("https://example.com/img?w=100&h=200")
    expect(url).toBe(
      "/v1/image-proxy?url=https%3A%2F%2Fexample.com%2Fimg%3Fw%3D100%26h%3D200",
    )
  })
})

// ---- generateImage --------------------------------------------------------

describe("generateImage", () => {
  it("sends correct URL, method, headers, and body", async () => {
    sessionWith("my-token")
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    const result = await generateImage("a cat", undefined, "flux")

    expect(mock).toHaveBeenCalledWith(
      "/v1/generate-image",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer my-token",
        },
      }),
    )
    // Verify body
    const callBody = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(callBody).toEqual({ prompt: "a cat", provider: "flux" })
    expect(result).toEqual({ jobId: "j1" })
  })

  it("only includes optional fields when provided", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j2" })
    vi.stubGlobal("fetch", mock)

    await generateImage("hello")

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body).toEqual({ prompt: "hello" })
    expect(body).not.toHaveProperty("provider")
    expect(body).not.toHaveProperty("referenceImageUrls")
    expect(body).not.toHaveProperty("userId")
  })

  it("throws Error on non-ok response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(400, { error: { message: "Bad prompt" } }),
    )

    await expect(generateImage("bad")).rejects.toThrow("Bad prompt")
  })

  it("throws StorageExceededError on storage limit error", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(413, {
        error: {
          code: "storage_limit_exceeded",
          message: "No space",
          usedBytes: 500,
          quotaBytes: 500,
          remainingBytes: 0,
          tier: "free",
        },
      }),
    )

    await expect(generateImage("test")).rejects.toThrow(StorageExceededError)
  })
})

// ---- uploadFile -----------------------------------------------------------

describe("uploadFile", () => {
  it("sends FormData with file and optional userId", async () => {
    noSession()
    const mock = mockFetchJson({ data: { url: "https://r2/file.png", thumbnailUrl: null, assetId: "a1", category: "image", filename: "f.png", mimeType: "image/png", sizeBytes: 1024, metadata: null, r2Key: "key" } })
    vi.stubGlobal("fetch", mock)

    const file = new File(["data"], "test.png", { type: "image/png" })
    const result = await uploadFile(file, "user-1")

    expect(mock).toHaveBeenCalledWith(
      "/v1/upload",
      expect.objectContaining({ method: "POST" }),
    )
    // Should NOT have Content-Type (browser sets multipart boundary)
    const headers = mock.mock.calls[0][1].headers as Record<string, string>
    expect(headers["Content-Type"]).toBeUndefined()
    // Body should be FormData
    const body = mock.mock.calls[0][1].body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect(body.get("file")).toBeInstanceOf(File)
    expect(body.get("userId")).toBe("user-1")
    expect(result.url).toBe("https://r2/file.png")
  })

  it("throws StorageExceededError for storage_limit_exceeded", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(413, {
        error: {
          code: "storage_limit_exceeded",
          message: "Limit",
          usedBytes: 10,
          quotaBytes: 10,
          remainingBytes: 0,
          tier: "free",
        },
      }),
    )

    const file = new File(["x"], "f.png", { type: "image/png" })
    await expect(uploadFile(file)).rejects.toThrow(StorageExceededError)
  })

  it("throws plain Error for other errors", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(500, { error: { message: "Server down" } }),
    )

    const file = new File(["x"], "f.png", { type: "image/png" })
    await expect(uploadFile(file)).rejects.toThrow("Server down")
  })
})

// ---- saveToStorageApi -----------------------------------------------------

describe("saveToStorageApi", () => {
  it("sends mediaType when provided", async () => {
    sessionWith("tok-save")
    const mock = mockFetchJson({ jobId: "job-1", url: "https://r2/video" })
    vi.stubGlobal("fetch", mock)

    await saveToStorageApi({
      mediaUrl: "https://cdn.example.com/media",
      filename: "clip.mp4",
      mediaType: "video",
    })

    expect(mock).toHaveBeenCalledWith(
      "/v1/save-to-storage",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer tok-save",
        },
      }),
    )
    expect(JSON.parse(mock.mock.calls[0][1].body as string)).toEqual({
      mediaUrl: "https://cdn.example.com/media",
      filename: "clip.mp4",
      mediaType: "video",
    })
  })

  it("throws StorageExceededError for storage_limit_exceeded", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(413, {
        error: {
          code: "storage_limit_exceeded",
          message: "Storage limit exceeded",
          usedBytes: 512,
          quotaBytes: 1024,
          remainingBytes: 0,
          tier: "pro",
        },
      }),
    )

    await expect(
      saveToStorageApi({ mediaUrl: "https://cdn.example.com/media", mediaType: "video" }),
    ).rejects.toThrow(StorageExceededError)
  })
})

// ---- getBatchJobStatus ----------------------------------------------------

describe("getBatchJobStatus", () => {
  it("returns [] for empty jobIds (no fetch)", async () => {
    const mock = vi.fn()
    vi.stubGlobal("fetch", mock)

    const result = await getBatchJobStatus([])

    expect(result).toEqual([])
    expect(mock).not.toHaveBeenCalled()
  })

  it("returns [] on network error", async () => {
    noSession()
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))

    const result = await getBatchJobStatus(["j1"])

    expect(result).toEqual([])
  })

  it("returns body.data on success", async () => {
    noSession()
    const data = [{ id: "j1", status: "completed", output_data: null, error_message: null }]
    vi.stubGlobal("fetch", mockFetchJson({ data }))

    const result = await getBatchJobStatus(["j1"])

    expect(result).toEqual(data)
  })

  it("throws on non-ok response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(500, { error: { message: "Batch fail" } }),
    )

    await expect(getBatchJobStatus(["j1"])).rejects.toThrow("Batch fail")
  })
})

// ---- getJobStatus ---------------------------------------------------------

describe("getJobStatus", () => {
  it("sends GET with auth headers and returns body.data", async () => {
    sessionWith("tok-xyz")
    const jobData = { id: "j1", status: "completed" }
    const mock = mockFetchJson({ data: jobData })
    vi.stubGlobal("fetch", mock)

    const result = await getJobStatus("j1")

    // Delegates to nodaroClient.jobs.get, which sets method explicitly.
    expect(mock.mock.calls[0][0]).toBe("/v1/jobs/j1")
    expect(mock.mock.calls[0][1].method).toBe("GET")
    expect(mock.mock.calls[0][1].headers).toMatchObject({
      Authorization: "Bearer tok-xyz",
    })
    expect(result).toEqual(jobData)
  })
})

// ---- subscribeToDownloadProgress ------------------------------------------

describe("subscribeToDownloadProgress", () => {
  let instances: MockEventSource[]

  class MockEventSource {
    url: string
    onmessage: ((event: { data: string }) => void) | null = null
    onerror: (() => void) | null = null
    close = vi.fn()
    constructor(url: string) {
      this.url = url
      instances.push(this)
    }
  }

  beforeEach(() => {
    instances = []
    vi.stubGlobal("EventSource", MockEventSource)
  })

  it("creates EventSource with correct URL", () => {
    subscribeToDownloadProgress("dl-42", vi.fn())
    expect(instances[0].url).toBe("/v1/download-video/progress/dl-42")
  })

  it("calls onProgress with parsed event data", () => {
    const onProgress = vi.fn()
    subscribeToDownloadProgress("dl-1", onProgress)
    const es = instances[0]

    es.onmessage!({ data: '{"phase":"downloading","percent":50}' })

    expect(onProgress).toHaveBeenCalledWith({ phase: "downloading", percent: 50 })
  })

  it("closes EventSource on completed phase", () => {
    const onProgress = vi.fn()
    subscribeToDownloadProgress("dl-1", onProgress)
    const es = instances[0]

    es.onmessage!({ data: '{"phase":"completed","percent":100,"videoUrl":"v.mp4"}' })

    expect(es.close).toHaveBeenCalled()
  })

  it("closes EventSource on failed phase", () => {
    const onProgress = vi.fn()
    subscribeToDownloadProgress("dl-1", onProgress)
    const es = instances[0]

    es.onmessage!({ data: '{"phase":"failed","percent":0,"error":"timeout"}' })

    expect(es.close).toHaveBeenCalled()
  })

  it("calls onProgress with Connection lost on EventSource error", () => {
    const onProgress = vi.fn()
    subscribeToDownloadProgress("dl-1", onProgress)
    const es = instances[0]

    es.onerror!()

    expect(es.close).toHaveBeenCalled()
    expect(onProgress).toHaveBeenCalledWith({
      phase: "failed",
      percent: 0,
      error: "Connection lost",
    })
  })

  it("returns unsubscribe function that closes EventSource", () => {
    const unsub = subscribeToDownloadProgress("dl-1", vi.fn())
    const es = instances[0]

    unsub()

    expect(es.close).toHaveBeenCalled()
  })
})

// ---- generateAIWriterStream -----------------------------------------------

describe("generateAIWriterStream", () => {
  const baseParams = {
    systemPrompt: "You are helpful",
    userInput: "Write a poem",
    model: "claude-sonnet",
    temperature: 0.7,
    maxTokens: 1000,
    userId: "u1",
  }

  it("calls onToken for each token event and returns done result", async () => {
    noSession()
    mockStreamRequest.mockReturnValue(
      fakeStream([
        { type: "metadata", data: { jobId: "j-meta" } },
        { type: "token", data: "Hello " },
        { type: "token", data: "world" },
        { type: "done", data: { jobId: "j-done", generatedText: "Hello world" } },
      ]),
    )

    const tokens: string[] = []
    const result = await generateAIWriterStream({
      ...baseParams,
      onToken: (t) => tokens.push(t),
    })

    expect(tokens).toEqual(["Hello ", "world"])
    expect(result).toEqual({ jobId: "j-done", generatedText: "Hello world" })
  })

  it("throws on error event", async () => {
    noSession()
    mockStreamRequest.mockReturnValue(
      fakeStream([
        { type: "error", data: { code: "rate_limit", message: "Too fast" } },
      ]),
    )

    await expect(
      generateAIWriterStream({ ...baseParams, onToken: vi.fn() }),
    ).rejects.toThrow("Too fast")
  })

  it("returns collected text gracefully on AbortError", async () => {
    noSession()
    const abortError = new DOMException("Aborted", "AbortError")
    mockStreamRequest.mockImplementation(async function* () {
      yield { type: "token", data: "partial" }
      throw abortError
    })

    const tokens: string[] = []
    const result = await generateAIWriterStream({
      ...baseParams,
      onToken: (t) => tokens.push(t),
    })

    expect(result).toEqual({ jobId: "", generatedText: "partial" })
  })

  it("throws 'Stream ended without completion' when no done event", async () => {
    noSession()
    mockStreamRequest.mockReturnValue(
      fakeStream([
        { type: "token", data: "some text" },
      ]),
    )

    await expect(
      generateAIWriterStream({ ...baseParams, onToken: vi.fn() }),
    ).rejects.toThrow("Stream ended without completion")
  })
})

// ---- ConcurrentModificationError ------------------------------------------

describe("ConcurrentModificationError", () => {
  it("has correct name and updatedAt property", () => {
    const err = new ConcurrentModificationError("Stale token", "2026-05-18T10:00:00.000Z")
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe("ConcurrentModificationError")
    expect(err.message).toBe("Stale token")
    expect(err.updatedAt).toBe("2026-05-18T10:00:00.000Z")
  })
})

// ---- saveLocation ---------------------------------------------------------

describe("saveLocation", () => {
  it("posts the full payload (new fields + expectedUpdatedAt) and returns id + updatedAt", async () => {
    sessionWith("tok-sl")
    const mock = mockFetchJson({ id: "loc-1", updatedAt: "2026-05-18T11:00:00.000Z" })
    vi.stubGlobal("fetch", mock)

    const result = await saveLocation({
      id: "loc-1",
      nodeId: "node_1",
      name: "Forest",
      lighting: [{ name: "golden hour", url: "https://x/golden.png" }],
      seasons: [{ name: "winter", url: "https://x/winter.png" }],
      atmosphereMotions: [{ name: "fog drift", url: "https://x/fog.mp4" }],
      referencePhotos: [{ kind: "wide", url: "https://x/wide.png" }],
      canonicalDescription: "A misty pine forest",
      styleLock: false,
      expectedUpdatedAt: "2026-05-18T10:00:00.000Z",
    })

    expect(mock).toHaveBeenCalledWith(
      "/v1/locations",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer tok-sl" },
      }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body).toMatchObject({
      id: "loc-1",
      nodeId: "node_1",
      name: "Forest",
      lighting: [{ name: "golden hour", url: "https://x/golden.png" }],
      seasons: [{ name: "winter", url: "https://x/winter.png" }],
      atmosphereMotions: [{ name: "fog drift", url: "https://x/fog.mp4" }],
      referencePhotos: [{ kind: "wide", url: "https://x/wide.png" }],
      canonicalDescription: "A misty pine forest",
      styleLock: false,
      expectedUpdatedAt: "2026-05-18T10:00:00.000Z",
    })
    expect(result).toEqual({ id: "loc-1", updatedAt: "2026-05-18T11:00:00.000Z" })
  })

  it("throws ConcurrentModificationError on 409 concurrent_modification", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(409, {
        error: {
          code: "concurrent_modification",
          updatedAt: "2026-05-18T11:30:00.000Z",
          message: "Location was modified concurrently",
        },
      }),
    )

    await expect(
      saveLocation({
        id: "loc-1",
        nodeId: "node_1",
        name: "Forest",
        expectedUpdatedAt: "2026-05-18T10:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(ConcurrentModificationError)
  })

  it("exposes updatedAt on the thrown ConcurrentModificationError", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(409, {
        error: {
          code: "concurrent_modification",
          updatedAt: "2026-05-18T11:30:00.000Z",
          message: "Location was modified concurrently",
        },
      }),
    )

    try {
      await saveLocation({
        id: "loc-1",
        nodeId: "node_1",
        name: "Forest",
        expectedUpdatedAt: "2026-05-18T10:00:00.000Z",
      })
      throw new Error("did not throw")
    } catch (err) {
      expect(err).toBeInstanceOf(ConcurrentModificationError)
      expect((err as ConcurrentModificationError).updatedAt).toBe(
        "2026-05-18T11:30:00.000Z",
      )
    }
  })

  it("falls back to a plain Error on other failures", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(500, { error: { message: "DB down" } }),
    )
    await expect(
      saveLocation({ nodeId: "node_1", name: "Forest" }),
    ).rejects.toThrow("DB down")
  })
})

// ---- approveLocationMainImage --------------------------------------------

describe("approveLocationMainImage", () => {
  it("posts candidateJobId and returns sourceImageUrl + canonicalDescription", async () => {
    sessionWith("tok-approve")
    const mock = mockFetchJson({
      sourceImageUrl: "https://x/loc.png",
      canonicalDescription: "A pine forest",
    })
    vi.stubGlobal("fetch", mock)

    const result = await approveLocationMainImage("loc-1", "job-1")

    expect(mock.mock.calls[0][0]).toBe("/v1/locations/loc-1/approve-main-image")
    expect(mock.mock.calls[0][1].method).toBe("POST")
    expect(JSON.parse(mock.mock.calls[0][1].body as string)).toEqual({
      candidateJobId: "job-1",
    })
    expect(result).toEqual({
      sourceImageUrl: "https://x/loc.png",
      canonicalDescription: "A pine forest",
    })
  })

  it("URL-encodes the location id", async () => {
    noSession()
    const mock = mockFetchJson({ sourceImageUrl: "u", canonicalDescription: "" })
    vi.stubGlobal("fetch", mock)
    await approveLocationMainImage("loc/with slash", "job-1")
    expect(mock.mock.calls[0][0]).toBe(
      "/v1/locations/loc%2Fwith%20slash/approve-main-image",
    )
  })

  it("throws on non-ok response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(404, { error: { message: "Candidate not found" } }),
    )
    await expect(
      approveLocationMainImage("loc-1", "job-1"),
    ).rejects.toThrow("Candidate not found")
  })
})

// ---- recaptionLocation ----------------------------------------------------

describe("recaptionLocation", () => {
  it("posts with no body and returns canonicalDescription", async () => {
    sessionWith("tok-cap")
    const mock = mockFetchJson({ canonicalDescription: "A fresh caption" })
    vi.stubGlobal("fetch", mock)

    const result = await recaptionLocation("loc-1")

    expect(mock.mock.calls[0][0]).toBe("/v1/locations/loc-1/llm-caption")
    expect(mock.mock.calls[0][1].method).toBe("POST")
    expect(result).toEqual({ canonicalDescription: "A fresh caption" })
  })

  it("throws on 502 caption_failed", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(502, { error: { message: "Caption failed" } }),
    )
    await expect(recaptionLocation("loc-1")).rejects.toThrow("Caption failed")
  })
})

// ---- restoreLocation ------------------------------------------------------

describe("restoreLocation", () => {
  it("posts to restore endpoint and returns id + name", async () => {
    sessionWith("tok-rest")
    const mock = mockFetchJson({ id: "loc-1", name: "Forest" })
    vi.stubGlobal("fetch", mock)

    const result = await restoreLocation("loc-1")

    expect(mock.mock.calls[0][0]).toBe("/v1/locations/loc-1/restore")
    expect(mock.mock.calls[0][1].method).toBe("POST")
    expect(result).toEqual({ id: "loc-1", name: "Forest" })
  })

  it("throws on non-ok response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(404, { error: { message: "Not found" } }),
    )
    await expect(restoreLocation("loc-1")).rejects.toThrow("Not found")
  })
})

// ---- getJobStatusBatch ----------------------------------------------------

describe("getJobStatusBatch", () => {
  it("returns { jobs: [] } for empty ids without fetching", async () => {
    const mock = vi.fn()
    vi.stubGlobal("fetch", mock)

    const result = await getJobStatusBatch([])

    expect(result).toEqual({ jobs: [] })
    expect(mock).not.toHaveBeenCalled()
  })

  it("sends comma-joined ids in the ?ids= query and returns body", async () => {
    sessionWith("tok-batch")
    const jobs = [
      { id: "j1", status: "completed", output_data: { imageUrl: "u" } },
      { id: "j2", status: "pending", output_data: null },
    ]
    const mock = mockFetchJson({ jobs })
    vi.stubGlobal("fetch", mock)

    const result = await getJobStatusBatch(["j1", "j2"])

    expect(mock.mock.calls[0][0]).toBe("/v1/jobs/status?ids=j1%2Cj2")
    expect(mock.mock.calls[0][1].method).toBe("GET")
    expect(result).toEqual({ jobs })
  })

  it("throws on non-ok response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(400, { error: { message: "Bad ids" } }),
    )
    await expect(getJobStatusBatch(["j1"])).rejects.toThrow("Bad ids")
  })
})

// ---- executeCollect -------------------------------------------------------

describe("executeCollect", () => {
  it("POSTs to /v1/collect with the right body and headers", async () => {
    sessionWith("tok-collect")
    const mock = mockFetchJson({
      jobId: "j1",
      output: "a-b",
      meta: { summary: "Joined 2 of 2 inputs" },
    })
    vi.stubGlobal("fetch", mock)

    const res = await executeCollect({
      strategyId: "concat",
      strategyConfig: { separator: "-" },
      inputs: ["a", "b"],
    })

    expect(mock).toHaveBeenCalledWith(
      "/v1/collect",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer tok-collect",
        },
        body: expect.stringContaining(`"strategyId":"concat"`),
      }),
    )
    const callBody = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(callBody).toEqual({
      strategyId: "concat",
      strategyConfig: { separator: "-" },
      inputs: ["a", "b"],
    })
    expect(res.output).toBe("a-b")
    expect(res.jobId).toBe("j1")
    expect(res.meta.summary).toBe("Joined 2 of 2 inputs")
  })

  it("throws on non-ok response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(400, { error: { code: "no_valid_inputs", message: "All upstream iterations failed; nothing to collect." } }),
    )
    await expect(
      executeCollect({ strategyId: "concat", strategyConfig: {}, inputs: [] }),
    ).rejects.toThrow("All upstream iterations failed; nothing to collect.")
  })
})
