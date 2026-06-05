import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — must be registered before the module under test is imported
// ---------------------------------------------------------------------------

vi.mock("@/lib/config.js", () => ({
  config: { HEYGEN_API_KEY: "test-heygen-key", NODE_ENV: "test" },
}))

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import { heygenFetch, HeygenError, isHeygenConfigured } from "../client.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("isHeygenConfigured", () => {
  it("returns true when HEYGEN_API_KEY is set", () => {
    expect(isHeygenConfigured()).toBe(true)
  })
})

describe("heygenFetch", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("sends X-Api-Key header with the configured key", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ code: 0, data: { voices: [] } }))

    await heygenFetch("/v2/voices")

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.heygen.com/v2/voices")
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("test-heygen-key")
  })

  it("sends Content-Type: application/json header", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ code: 0, data: {} }))

    await heygenFetch("/v2/voices")

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json")
  })

  it("returns parsed JSON on a successful 200 response", async () => {
    const responseBody = { code: 0, data: { foo: "bar" } }
    fetchMock.mockResolvedValueOnce(makeResponse(responseBody))

    const result = await heygenFetch<typeof responseBody>("/some/path")

    expect(result).toEqual(responseBody)
  })

  it("throws HeygenError with status on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ error: { code: "UNAUTHORIZED", message: "Invalid API key" } }, 401),
    )

    await expect(heygenFetch("/v2/voices")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof HeygenError &&
        err.status === 401 &&
        err.message === "Invalid API key",
    )
  })

  it("throws HeygenError on a 400 non-JSON body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("Bad Request", { status: 400 }),
    )

    await expect(heygenFetch("/v2/voices")).rejects.toSatisfy(
      (err: unknown) => err instanceof HeygenError && err.status === 400,
    )
  })

  it("throws HeygenError on HTTP 200 with { error: { code, message } } body", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        code: 400,
        error: { code: "AVATAR_NOT_SUPPORTED", message: "Avatar does not support Avatar V" },
      }),
    )

    const err = await heygenFetch("/v3/videos").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HeygenError)
    expect((err as HeygenError).message).toBe("Avatar does not support Avatar V")
    expect((err as HeygenError).code).toBe("AVATAR_NOT_SUPPORTED")
  })

  it("preserves an absolute URL unchanged", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ code: 0, data: {} }))

    await heygenFetch("https://other.example.com/api")

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://other.example.com/api")
  })
})

describe("HeygenError", () => {
  it("is an instance of Error and HeygenError", () => {
    const err = new HeygenError("test message", { code: "TEST", status: 422 })
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(HeygenError)
    expect(err.name).toBe("HeygenError")
    expect(err.message).toBe("test message")
    expect(err.code).toBe("TEST")
    expect(err.status).toBe(422)
  })

  it("works without optional args", () => {
    const err = new HeygenError("plain error")
    expect(err.code).toBeUndefined()
    expect(err.status).toBeUndefined()
  })
})
