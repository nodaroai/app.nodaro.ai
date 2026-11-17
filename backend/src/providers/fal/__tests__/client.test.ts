import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — the fal singleton + the reconcile hook are stubbed so the client is
// exercised against faithful stand-ins (no network, no real config load).
// ---------------------------------------------------------------------------

const { mockConfig, mockFalConfig, mockSubmit, mockStatus, mockResult, mockFire } =
  vi.hoisted(() => ({
    mockConfig: { FAL_KEY: "test-fal-key" },
    mockFalConfig: vi.fn(),
    mockSubmit: vi.fn(),
    mockStatus: vi.fn(),
    mockResult: vi.fn(),
    mockFire: vi.fn(async () => {}),
  }))

vi.mock("@/lib/config.js", () => ({ config: mockConfig }))

vi.mock("@fal-ai/client", () => ({
  fal: {
    config: mockFalConfig,
    queue: {
      submit: mockSubmit,
      status: mockStatus,
      result: mockResult,
    },
  },
}))

vi.mock("@/lib/reconcile/fire-on-task-created.js", () => ({ fireOnTaskCreated: mockFire }))

import {
  FalSubmitAmbiguousError,
  submitOnceFetch,
  runFalRequest,
  extractFalUrl,
  fetchFalRequestStatus,
  __resetFalConfiguredForTests,
} from "../client.js"

beforeEach(() => {
  mockFalConfig.mockReset()
  mockSubmit.mockReset()
  mockStatus.mockReset()
  mockResult.mockReset()
  mockFire.mockReset()
  mockFire.mockResolvedValue(undefined)
  // Reset the module's one-shot config guard so each spec starts unconfigured.
  __resetFalConfiguredForTests()
})

// ---------------------------------------------------------------------------
// submitOnceFetch — a submit that creates a billed run is sent once
// (decided 2026-11-17). The SDK re-sends a submit by itself after a 429 / 502
// / 503 / 504 or a network failure; for an endpoint a caller marked
// `submitOnce`, the transport turns an outcome it cannot read into an error
// the SDK does not retry.
// ---------------------------------------------------------------------------

describe("submitOnceFetch", () => {
  const ONCE = "google/once-model/v1/extend"
  const OTHER = "fal-ai/sync-lipsync/v3"
  const submitUrl = (endpoint: string) => `https://queue.fal.run/${endpoint}`
  const respond = (status: number) => new Response("{}", { status })
  /** Marks ONCE as a send-once endpoint, the way its caller does. */
  async function markOnce(): Promise<void> {
    mockSubmit.mockResolvedValue({ request_id: "req-once" })
    mockStatus.mockResolvedValue({ status: "COMPLETED" })
    mockResult.mockResolvedValue({ data: {} })
    await runFalRequest({ endpoint: ONCE, input: {}, label: "[fal:once]", pollIntervalMs: 0, submitOnce: true })
  }

  it.each([502, 503, 504])("a %s answered to a send-once submit becomes an error the SDK does not retry", async (status) => {
    await markOnce()
    const inner = vi.fn(async () => respond(status))
    const err = await submitOnceFetch(inner as never)(submitUrl(ONCE), { method: "POST" }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FalSubmitAmbiguousError)
    expect((err as FalSubmitAmbiguousError).status).toBe(status)
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it("a network failure of a send-once submit carries nothing the SDK's retry reads (no cause, no code, no TypeError)", async () => {
    await markOnce()
    const failure = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }) })
    const err = await submitOnceFetch((async () => { throw failure }) as never)(submitUrl(ONCE), { method: "POST" }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FalSubmitAmbiguousError)
    expect(err).not.toBeInstanceOf(TypeError)
    expect((err as Error).cause).toBeUndefined()
    expect((err as { code?: unknown }).code).toBeUndefined()
    expect((err as Error).message).not.toMatch(/^fetch failed$/i)
  })

  it("passes a 429 and a success of a send-once submit through (nothing was created on a 429: the SDK may retry it)", async () => {
    await markOnce()
    for (const status of [429, 200, 422]) {
      const res = await submitOnceFetch((async () => respond(status)) as never)(submitUrl(ONCE), { method: "POST" })
      expect(res.status).toBe(status)
    }
  })

  it("leaves every other call untouched: another endpoint's submit, and the send-once endpoint's status and result reads", async () => {
    await markOnce()
    const wrapped = submitOnceFetch((async () => respond(502)) as never)
    expect((await wrapped(submitUrl(OTHER), { method: "POST" })).status).toBe(502)
    expect((await wrapped(`${submitUrl(ONCE)}/requests/req-1/status`, { method: "GET" })).status).toBe(502)
    expect((await wrapped(`${submitUrl(ONCE)}/requests/req-1`, { method: "GET" })).status).toBe(502)
    const failure = new TypeError("fetch failed")
    await expect(submitOnceFetch((async () => { throw failure }) as never)(submitUrl(OTHER), { method: "POST" })).rejects.toBe(failure)
  })
})

// ---------------------------------------------------------------------------
// runFalRequest — happy path
// ---------------------------------------------------------------------------

describe("runFalRequest", () => {
  it("keyCoverage reaches the missing-key message (a lane with no nodaro.ai relay never offers the connection)", async () => {
    const saved = mockConfig.FAL_KEY
    mockConfig.FAL_KEY = ""
    try {
      const err = await runFalRequest({ endpoint: "fal-ai/x", input: {}, label: "t", keyCoverage: { coveredByConnection: false } }).catch((e: Error) => e)
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toMatch(/needs FAL_KEY \(your own\)/i)
      expect((err as Error).message).not.toContain("which covers it")
      expect(mockSubmit).not.toHaveBeenCalled()
    } finally {
      mockConfig.FAL_KEY = saved
    }
  })

  it("submit → fireOnTaskCreated(request_id) BEFORE polling → result → {output, requestId}", async () => {
    const order: string[] = []
    mockSubmit.mockImplementation(async () => {
      order.push("submit")
      return { request_id: "req-123" }
    })
    mockFire.mockImplementation(async () => {
      order.push("fire")
    })
    // First poll IN_PROGRESS, then COMPLETED.
    mockStatus
      .mockImplementationOnce(async () => {
        order.push("status:in_progress")
        return { status: "IN_PROGRESS" }
      })
      .mockImplementationOnce(async () => {
        order.push("status:completed")
        return { status: "COMPLETED" }
      })
    mockResult.mockImplementation(async () => {
      order.push("result")
      return { data: { video: { url: "https://fal.media/out.mp4" } }, requestId: "req-123" }
    })

    const res = await runFalRequest({
      endpoint: "fal-ai/sync-lipsync/v3",
      input: { video_url: "https://x/v.mp4", audio_url: "https://x/a.mp3" },
      label: "[fal:lipsync]",
      reconcileOpts: {} as never,
      pollIntervalMs: 0, // make the test fast
    })

    // submit args
    expect(mockSubmit).toHaveBeenCalledWith("fal-ai/sync-lipsync/v3", {
      input: { video_url: "https://x/v.mp4", audio_url: "https://x/a.mp3" },
    })
    // fireOnTaskCreated called with the request id, before any poll
    expect(mockFire).toHaveBeenCalledWith(expect.anything(), "req-123", "[fal:lipsync]")
    expect(order[0]).toBe("submit")
    expect(order[1]).toBe("fire")
    expect(order.indexOf("fire")).toBeLessThan(order.indexOf("status:in_progress"))
    // status polled, result fetched after COMPLETED
    expect(mockStatus).toHaveBeenCalledWith("fal-ai/sync-lipsync/v3", { requestId: "req-123" })
    expect(mockResult).toHaveBeenCalledWith("fal-ai/sync-lipsync/v3", { requestId: "req-123" })
    // return shape
    expect(res.requestId).toBe("req-123")
    expect(res.output).toEqual({ video: { url: "https://fal.media/out.mp4" } })
  })

  it("configures the fal client with credentials exactly once across calls", async () => {
    mockSubmit.mockResolvedValue({ request_id: "r1" })
    mockStatus.mockResolvedValue({ status: "COMPLETED" })
    mockResult.mockResolvedValue({ data: { image: { url: "https://x/i.png" } }, requestId: "r1" })

    await runFalRequest({ endpoint: "ep", input: {}, label: "l", pollIntervalMs: 0 })
    await runFalRequest({ endpoint: "ep", input: {}, label: "l", pollIntervalMs: 0 })

    expect(mockFalConfig).toHaveBeenCalledTimes(1)
    expect(mockFalConfig).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: "test-fal-key", fetch: expect.any(Function) }),
    )
  })

  it("throws a prefixed error when the queue reports a failed status", async () => {
    mockSubmit.mockResolvedValue({ request_id: "req-err" })
    mockStatus.mockResolvedValue({ status: "ERROR", error: "model exploded" })

    await expect(
      runFalRequest({ endpoint: "ep", input: {}, label: "[fal:x]", pollIntervalMs: 0 }),
    ).rejects.toThrow("fal request failed (req-err): model exploded")
  })

  // Decided 2026-11-17: resuming a request and retrying a failed status read
  // are opt-in (Gemini Omni Flash 1.2 Extend). A caller that passes neither
  // (lip-sync, SAM3, video depth) keeps the path it always had.
  it("with no resume or retry option: always submits, and the first failed status read throws", async () => {
    mockSubmit.mockResolvedValue({ request_id: "req-plain" })
    mockStatus.mockRejectedValue(new Error("socket hang up"))

    await expect(
      runFalRequest({ endpoint: "ep", input: { a: 1 }, label: "[fal:x]", pollIntervalMs: 0 }),
    ).rejects.toThrow("socket hang up")
    expect(mockSubmit).toHaveBeenCalledTimes(1)
    expect(mockSubmit).toHaveBeenCalledWith("ep", { input: { a: 1 } })
    expect(mockFire).toHaveBeenCalledTimes(1)
    expect(mockStatus).toHaveBeenCalledTimes(1)
  })

  it("resumeRequestId polls and fetches that request: nothing is submitted, no task is recorded again", async () => {
    mockStatus.mockResolvedValue({ status: "COMPLETED" })
    mockResult.mockResolvedValue({ data: { video: { url: "https://fal.media/o.mp4" } } })
    const onSubmitted = vi.fn(async () => {})

    const out = await runFalRequest({ endpoint: "ep", input: {}, label: "[fal:x]", pollIntervalMs: 0, resumeRequestId: "req-old", onSubmitted })
    expect(out.requestId).toBe("req-old")
    expect(mockSubmit).not.toHaveBeenCalled()
    expect(mockFire).not.toHaveBeenCalled()
    expect(onSubmitted).not.toHaveBeenCalled()
    expect(mockStatus).toHaveBeenCalledWith("ep", { requestId: "req-old" })
  })

  it("statusErrorRetries tolerates that many failed status reads in a row, and no more", async () => {
    mockSubmit.mockResolvedValue({ request_id: "req-blip" })
    mockStatus
      .mockRejectedValueOnce(new Error("blip 1"))
      .mockRejectedValueOnce(new Error("blip 2"))
      .mockResolvedValueOnce({ status: "IN_PROGRESS" })
      .mockRejectedValueOnce(new Error("blip 3"))
      .mockRejectedValueOnce(new Error("blip 4"))
      .mockRejectedValueOnce(new Error("blip 5"))
    await expect(
      runFalRequest({ endpoint: "ep", input: {}, label: "[fal:x]", pollIntervalMs: 0, statusErrorRetries: 2 }),
    ).rejects.toThrow("blip 5")
    expect(mockSubmit).toHaveBeenCalledTimes(1)
  })

  it("maxPolls bounds the wait of one call; absent, the cap is the client's own", async () => {
    mockSubmit.mockResolvedValue({ request_id: "req-slow" })
    mockStatus.mockResolvedValue({ status: "IN_PROGRESS" })
    await expect(
      runFalRequest({ endpoint: "ep", input: {}, label: "[fal:x]", pollIntervalMs: 0, maxPolls: 4 }),
    ).rejects.toThrow("fal request failed (req-slow): timed out after 4 polls")
    expect(mockStatus).toHaveBeenCalledTimes(4)
  })

  it("propagates a result() failure wrapped with the request id", async () => {
    mockSubmit.mockResolvedValue({ request_id: "req-boom" })
    mockStatus.mockResolvedValue({ status: "COMPLETED" })
    mockResult.mockRejectedValue(new Error("422 Unprocessable Entity"))

    await expect(
      runFalRequest({ endpoint: "ep", input: {}, label: "[fal:x]", pollIntervalMs: 0 }),
    ).rejects.toThrow("fal request failed (req-boom): 422 Unprocessable Entity")
  })

  it("surfaces fal ApiError status + body.detail when the message is empty", async () => {
    // fal's ApiError frequently throws with an EMPTY .message and the real
    // cause carried only in .status + .body.detail. Reading .message alone
    // produced a useless "fal request failed (id): " (observed live).
    mockSubmit.mockResolvedValue({ request_id: "req-sparse" })
    mockStatus.mockResolvedValue({ status: "COMPLETED" })
    mockResult.mockRejectedValue(
      Object.assign(new Error(""), {
        status: 422,
        body: { detail: "video_url could not be fetched" },
      }),
    )

    // Reason must NOT be empty after the colon — it must carry the HTTP status
    // and the body detail (the regex requires content after the colon).
    await expect(
      runFalRequest({ endpoint: "ep", input: {}, label: "[fal:x]", pollIntervalMs: 0 }),
    ).rejects.toThrow(
      /fal request failed \(req-sparse\): HTTP 422: .*video_url could not be fetched/,
    )
  })
})

// ---------------------------------------------------------------------------
// fetchFalRequestStatus — single non-blocking status check for the reconcile path
// ---------------------------------------------------------------------------

describe("fetchFalRequestStatus", () => {
  it("COMPLETED → fetches result and returns { status: COMPLETED, output }", async () => {
    mockStatus.mockResolvedValue({ status: "COMPLETED" })
    mockResult.mockResolvedValue({
      data: { video: { url: "https://fal.media/r.mp4" } },
      requestId: "rid-1",
    })

    const res = await fetchFalRequestStatus("fal-ai/sync-lipsync/v3", "rid-1")

    expect(mockStatus).toHaveBeenCalledWith("fal-ai/sync-lipsync/v3", { requestId: "rid-1" })
    expect(mockResult).toHaveBeenCalledWith("fal-ai/sync-lipsync/v3", { requestId: "rid-1" })
    expect(res.status).toBe("COMPLETED")
    expect(res.output).toEqual({ video: { url: "https://fal.media/r.mp4" } })
    expect(res.error).toBeUndefined()
  })

  it("ERROR status → { status: ERROR, error }, no result fetch", async () => {
    mockStatus.mockResolvedValue({ status: "ERROR", error: "model exploded" })

    const res = await fetchFalRequestStatus("ep", "rid-err")

    expect(res.status).toBe("ERROR")
    expect(res.error).toContain("model exploded")
    expect(mockResult).not.toHaveBeenCalled()
  })

  it("IN_QUEUE / IN_PROGRESS → { status: pending }", async () => {
    mockStatus.mockResolvedValueOnce({ status: "IN_QUEUE" })
    expect((await fetchFalRequestStatus("ep", "q")).status).toBe("pending")

    mockStatus.mockResolvedValueOnce({ status: "IN_PROGRESS" })
    expect((await fetchFalRequestStatus("ep", "p")).status).toBe("pending")
  })

  it("status() throws (network blip) → { status: pending, error } so caller bumps (not refund)", async () => {
    mockStatus.mockRejectedValue(new Error("ECONNRESET"))

    const res = await fetchFalRequestStatus("ep", "rid-net")

    expect(res.status).toBe("pending")
    expect(res.error).toContain("ECONNRESET")
    expect(mockResult).not.toHaveBeenCalled()
  })

  it("COMPLETED but result() throws → { status: ERROR, error } (terminal — output is gone)", async () => {
    mockStatus.mockResolvedValue({ status: "COMPLETED" })
    mockResult.mockRejectedValue(new Error("422 Unprocessable Entity"))

    const res = await fetchFalRequestStatus("ep", "rid-bad")

    expect(res.status).toBe("ERROR")
    expect(res.error).toContain("422")
  })

  it("COMPLETED but result() throws a sparse ApiError → error carries status + detail", async () => {
    mockStatus.mockResolvedValue({ status: "COMPLETED" })
    mockResult.mockRejectedValue(
      Object.assign(new Error(""), { status: 500, body: { detail: "internal model error" } }),
    )

    const res = await fetchFalRequestStatus("ep", "rid-sparse")

    expect(res.status).toBe("ERROR")
    expect(res.error).toBeTruthy()
    expect(res.error).toContain("500")
    expect(res.error).toContain("internal model error")
  })
})

// ---------------------------------------------------------------------------
// extractFalUrl
// ---------------------------------------------------------------------------

describe("extractFalUrl", () => {
  it("reads { video: { url } }", () => {
    expect(extractFalUrl({ video: { url: "https://x/v.mp4" } })).toBe("https://x/v.mp4")
  })

  it("reads { images: [{ url }] } (first image)", () => {
    expect(
      extractFalUrl({ images: [{ url: "https://x/a.png" }, { url: "https://x/b.png" }] }),
    ).toBe("https://x/a.png")
  })

  it("reads { image: { url } }", () => {
    expect(extractFalUrl({ image: { url: "https://x/i.png" } })).toBe("https://x/i.png")
  })

  it("reads { audio: { url } }", () => {
    expect(extractFalUrl({ audio: { url: "https://x/a.mp3" } })).toBe("https://x/a.mp3")
  })

  it("throws on an unrecognized output shape", () => {
    expect(() => extractFalUrl({ foo: "bar" })).toThrow(/Unexpected fal output/)
  })
})
