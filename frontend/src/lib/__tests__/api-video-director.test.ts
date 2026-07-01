import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock: Supabase client (mirrors api-video-audio.test.ts pattern)
// ---------------------------------------------------------------------------

const mockGetSession = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: { getSession: mockGetSession },
  }),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { runVideoDirector } from "../api"

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

beforeEach(() => {
  mockGetSession.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// runVideoDirector
// ---------------------------------------------------------------------------

describe("runVideoDirector", () => {
  it("POSTs to /v1/video-director/run with genre and brief", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "vd-job-1" })
    vi.stubGlobal("fetch", mock)

    const result = await runVideoDirector({ genre: "explainer", brief: "How DNS works" })

    expect(mock).toHaveBeenCalledOnce()
    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/v1/video-director/run")
    expect(init.method).toBe("POST")

    const body = JSON.parse(init.body as string)
    expect(body.genre).toBe("explainer")
    expect(body.brief).toBe("How DNS works")

    expect(result).toEqual({ jobId: "vd-job-1" })
  })

  it("POSTs correctly with product-launch genre", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "vd-job-2" })
    vi.stubGlobal("fetch", mock)

    const result = await runVideoDirector({
      genre: "product-launch",
      brief: "Launching our AI writing tool for marketers",
    })

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.genre).toBe("product-launch")
    expect(body.brief).toBe("Launching our AI writing tool for marketers")
    expect(result).toEqual({ jobId: "vd-job-2" })
  })

  it("includes Authorization header when session exists", async () => {
    sessionWith("tok-vd-123")
    const mock = mockFetchJson({ jobId: "vd-job-3" })
    vi.stubGlobal("fetch", mock)

    await runVideoDirector({ genre: "explainer", brief: "A brief" })

    const headers = mock.mock.calls[0][1].headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer tok-vd-123")
  })

  it("omits Authorization header when no session", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "vd-job-4" })
    vi.stubGlobal("fetch", mock)

    await runVideoDirector({ genre: "explainer", brief: "A brief" })

    const headers = mock.mock.calls[0][1].headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })

  it("throws on error response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(500, { error: { message: "Internal server error" } }),
    )

    await expect(
      runVideoDirector({ genre: "explainer", brief: "Some brief" }),
    ).rejects.toThrow("Internal server error")
  })

  it("throws with label when error body is malformed", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(503, null),
    )

    await expect(
      runVideoDirector({ genre: "product-launch", brief: "Some brief" }),
    ).rejects.toThrow(/Failed to start video director/)
  })
})
