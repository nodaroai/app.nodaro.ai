import { describe, it, expect, vi } from "vitest"
import {
  createClient,
  StaticTokenAuth,
  CallbackAuth,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  InsufficientCreditsError,
  NodaroError,
} from "../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response)
}

function mockErr(status: number, body: unknown) {
  return Promise.resolve({
    ok: false,
    status,
    json: async () => body,
  } as unknown as Response)
}

describe("createClient", () => {
  it("returns a NodaroClient", () => {
    const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t") })
    expect(c.baseUrl).toBe("https://api.example.com")
  })

  it("strips trailing slash from baseUrl", () => {
    const c = createClient({ baseUrl: "https://api.example.com/", auth: new StaticTokenAuth("t") })
    expect(c.baseUrl).toBe("https://api.example.com")
  })
})

describe("request", () => {
  it("includes Authorization header when token is present", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: "ok" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("test_token_123"),
      fetch: fetchMock,
    })
    await c.request("GET", "/v1/health")
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/v1/health",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer test_token_123" }),
      }),
    )
  })

  it("omits Authorization when no token", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: "ok" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new CallbackAuth(() => null),
      fetch: fetchMock,
    })
    await c.request("GET", "/v1/health")
    const headers = fetchMock.mock.calls[0][1].headers
    expect(headers.Authorization).toBeUndefined()
  })

  it("appends query params", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.request("GET", "/v1/workflows", { query: { limit: 10, projectId: "abc" } })
    const url = fetchMock.mock.calls[0][0]
    expect(url).toContain("limit=10")
    expect(url).toContain("projectId=abc")
  })

  it("throws UnauthorizedError on 401", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(401, { error: { code: "unauthorized", message: "Token expired" } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(c.request("GET", "/v1/workflows")).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it("throws ForbiddenError with missingScope on 403 insufficient_scope", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(403, { error: { code: "insufficient_scope", message: "Missing required scope: workflows:write", missingScope: "workflows:write" } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(c.request("POST", "/v1/workflows")).rejects.toMatchObject({
      name: "ForbiddenError",
      missingScope: "workflows:write",
    })
  })

  it("throws NotFoundError on 404", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockErr(404, { error: { code: "not_found" } }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(c.request("GET", "/v1/workflows/abc")).rejects.toBeInstanceOf(NotFoundError)
  })

  it("throws RateLimitedError on 429", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockErr(429, { error: { code: "rate_limited" } }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(c.request("GET", "/v1/workflows")).rejects.toBeInstanceOf(RateLimitedError)
  })

  it("throws InsufficientCreditsError on 402 with required/available", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(402, { error: { code: "insufficient_credits", required: 100, available: 50 } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(c.request("POST", "/v1/workflows/abc/run")).rejects.toMatchObject({
      name: "InsufficientCreditsError",
      required: 100,
      available: 50,
    })
  })

  it("throws generic NodaroError on 500", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockErr(500, { error: { code: "internal_error" } }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(c.request("GET", "/v1/workflows")).rejects.toBeInstanceOf(NodaroError)
  })

  it("returns undefined for 204 No Content", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      Promise.resolve({ ok: true, status: 204, json: async () => undefined } as unknown as Response),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.request("DELETE", "/v1/workflows/abc")
    expect(result).toBeUndefined()
  })
})
