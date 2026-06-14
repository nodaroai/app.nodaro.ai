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
// runFalRequest — happy path
// ---------------------------------------------------------------------------

describe("runFalRequest", () => {
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
    expect(mockFalConfig).toHaveBeenCalledWith({ credentials: "test-fal-key" })
  })

  it("throws a prefixed error when the queue reports a failed status", async () => {
    mockSubmit.mockResolvedValue({ request_id: "req-err" })
    mockStatus.mockResolvedValue({ status: "ERROR", error: "model exploded" })

    await expect(
      runFalRequest({ endpoint: "ep", input: {}, label: "[fal:x]", pollIntervalMs: 0 }),
    ).rejects.toThrow("fal request failed (req-err): model exploded")
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
