import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — must be registered before the module under test is imported.
// The mock object is mutable so individual tests can toggle BEEBLE_API_KEY
// (the client reads `config.BEEBLE_API_KEY` lazily at call time).
// ---------------------------------------------------------------------------

const mockConfig = { BEEBLE_API_KEY: "test-beeble-key", NODE_ENV: "test" }

vi.mock("@/lib/config.js", () => ({
  get config() {
    return mockConfig
  },
}))

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import { beebleFetch, BeebleError, isBeebleConfigured } from "../client.js"

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
// isBeebleConfigured
// ---------------------------------------------------------------------------

describe("isBeebleConfigured", () => {
  afterEach(() => {
    mockConfig.BEEBLE_API_KEY = "test-beeble-key"
  })

  it("returns false when BEEBLE_API_KEY is an empty string", () => {
    mockConfig.BEEBLE_API_KEY = ""
    expect(isBeebleConfigured()).toBe(false)
  })

  it("returns true when BEEBLE_API_KEY is set", () => {
    mockConfig.BEEBLE_API_KEY = "some-key"
    expect(isBeebleConfigured()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// beebleFetch
// ---------------------------------------------------------------------------

describe("beebleFetch", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockConfig.BEEBLE_API_KEY = "test-beeble-key"
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("sends x-api-key header with the configured key", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ id: "gen_123" }))

    await beebleFetch("/v1/switchx/generations", { method: "POST", body: "{}" })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.beeble.ai/v1/switchx/generations")
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("test-beeble-key")
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json")
  })

  it("returns parsed JSON on a successful 200 response", async () => {
    const responseBody = { id: "gen_456", status: "in_queue" }
    fetchMock.mockResolvedValueOnce(makeResponse(responseBody))

    const result = await beebleFetch<typeof responseBody>("/v1/switchx/generations/gen_456")

    expect(result).toEqual(responseBody)
  })

  it("returns {} for an empty (no-content) body", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }))

    const result = await beebleFetch("/v1/switchx/generations")

    expect(result).toEqual({})
  })

  it("throws BeebleError carrying .code on a { error: { code, message } } body", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(
        { error: { code: "INSUFFICIENT_BALANCE", message: "Not enough credits" } },
        402,
      ),
    )

    const err = await beebleFetch("/v1/switchx/generations").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BeebleError)
    expect((err as BeebleError).code).toBe("INSUFFICIENT_BALANCE")
    expect((err as BeebleError).message).toBe("Not enough credits")
    expect((err as BeebleError).status).toBe(402)
  })

  it("throws BeebleError on a non-2xx response with no error body", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({}, 500))

    const err = await beebleFetch("/v1/switchx/generations").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BeebleError)
    expect((err as BeebleError).status).toBe(500)
    expect((err as BeebleError).code).toBe("HTTP_500")
  })

  it("throws BeebleError on a 200 response whose body carries an error", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ error: { code: "INVALID_INPUT", message: "bad source_uri" } }),
    )

    const err = await beebleFetch("/v1/switchx/generations").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BeebleError)
    expect((err as BeebleError).code).toBe("INVALID_INPUT")
  })

  it("merges caller-supplied headers with the auth header", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ id: "gen_789" }))

    await beebleFetch("/v1/switchx/generations", {
      method: "POST",
      headers: { "Idempotency-Key": "abc" },
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers["x-api-key"]).toBe("test-beeble-key")
    expect(headers["Idempotency-Key"]).toBe("abc")
  })
})

// ---------------------------------------------------------------------------
// BeebleError
// ---------------------------------------------------------------------------

describe("BeebleError", () => {
  it("is an instance of Error and BeebleError and carries code + status", () => {
    const err = new BeebleError("test message", "TEST_CODE", 422)
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(BeebleError)
    expect(err.name).toBe("BeebleError")
    expect(err.message).toBe("test message")
    expect(err.code).toBe("TEST_CODE")
    expect(err.status).toBe(422)
  })
})
