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
  throwFromResponse,
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

  it("keeps the server's own 404 message when the body has no error object (an unregistered route)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockErr(404, { message: "Route GET:/v1/nope not found", error: "Not Found", statusCode: 404 }))
    const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
    await expect(c.request("GET", "/v1/nope")).rejects.toMatchObject({ name: "NotFoundError", message: "Route GET:/v1/nope not found" })
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

  it("reads an older route's bare-string error as its code (no more internal_error)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockErr(409, { error: "already_training_or_not_found" }))
    const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
    await expect(c.request("POST", "/v1/characters/abc/train")).rejects.toMatchObject({
      name: "NodaroError",
      code: "already_training_or_not_found",
      status: 409,
    })
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

/**
 * Not every route answers with the `{ error: { code, message } }` envelope. A
 * few older ones (character training, the OAuth token endpoint, some billing
 * and profile routes) send `{ error: "<code>", message? }`, a validation
 * refusal can be a bare `{ message, issues }`, and the server framework answers
 * a route it does not have with `{ statusCode, error: "<reason phrase>", message }`.
 * The editor reads those bodies as they are, so they stay; the SDK reads them
 * too, instead of reporting every one as `internal_error` / "Request failed".
 */
describe("throwFromResponse — the error bodies older routes send", () => {
  function thrown(status: number, body: unknown): NodaroError {
    try {
      throwFromResponse(status, body as Parameters<typeof throwFromResponse>[1])
    } catch (err) {
      return err as NodaroError
    }
    throw new Error("throwFromResponse returned")
  }

  it("a bare snake_case `error` is the code, and a top-level `message` is the message", () => {
    const err = thrown(400, {
      error: "insufficient_training_images",
      count: 2,
      message: "Need at least 4 reference photos to train (have 2).",
    })
    expect(err).toBeInstanceOf(NodaroError)
    expect(err.code).toBe("insufficient_training_images")
    expect(err.status).toBe(400)
    expect(err.message).toBe("Need at least 4 reference photos to train (have 2).")
  })

  it("with no message, the code is what a caller reads instead of 'Request failed'", () => {
    const busy = thrown(409, { error: "already_training_or_not_found" })
    expect(busy).toMatchObject({ code: "already_training_or_not_found", status: 409, message: "already_training_or_not_found" })
    const unconfigured = thrown(503, { error: "public_url_not_configured" })
    expect(unconfigured).toMatchObject({ code: "public_url_not_configured", status: 503 })
  })

  // At HTTP 500 and above, text outside the envelope can be anything the
  // server failed with — the framework's default answer to an uncaught throw is
  // `{ statusCode: 500, error: "Internal Server Error", message: <raw> }`, and
  // the server's sanitizer only rewrites `internal_error` envelopes. So from a
  // 5xx only the code is read; the envelope's own message (a route's curated
  // sentence) still is.
  it("at 500 and above, keeps the code but never the text outside the envelope", () => {
    const uncaught = thrown(500, {
      statusCode: 500,
      error: "Internal Server Error",
      message: 'duplicate key value violates unique constraint "characters_pkey"',
    })
    expect(uncaught).toMatchObject({ code: "internal_error", status: 500, message: "Request failed" })
    expect(thrown(502, { error: "training_dispatch_failed", message: "Replicate 422: destination model does not exist" })).toMatchObject({
      code: "training_dispatch_failed",
      message: "training_dispatch_failed",
    })
    expect(thrown(500, { error: "Database connection lost while saving" }).message).toBe("Request failed")
    expect(thrown(503, { error: "temporarily_unavailable", error_description: "upstream pool exhausted at 10.0.0.4" }).message).toBe(
      "temporarily_unavailable",
    )
  })

  it("at 500 and above, the envelope's own message is still read", () => {
    expect(
      thrown(503, { error: { code: "price_not_configured", message: "Pricing is not configured for this model." } }),
    ).toMatchObject({ code: "price_not_configured", message: "Pricing is not configured for this model." })
  })

  // The credit guard sends the figures BESIDE the envelope:
  // `{ error: { code: "insufficient_credits", message }, required, balance }`.
  it("402: required / available are read from beside the envelope too", () => {
    const err = thrown(402, { error: { code: "insufficient_credits", message: "Insufficient credits" }, required: 1650, balance: 400 })
    expect(err).toBeInstanceOf(InsufficientCreditsError)
    expect(err).toMatchObject({ required: 1650, available: 400, message: "Insufficient credits" })
    // A deployment-paid instance withholds the balance: only `required` is there.
    expect(thrown(402, { error: { code: "insufficient_credits" }, required: 1650 })).toMatchObject({ required: 1650, available: undefined })
  })

  it("still picks the typed class by status, with its own default message", () => {
    const unauthorized = thrown(401, { error: "unauthorized" })
    expect(unauthorized).toBeInstanceOf(UnauthorizedError)
    expect(unauthorized.message).toBe("Authentication required")
    const missing = thrown(404, { error: "not_found" })
    expect(missing).toBeInstanceOf(NotFoundError)
    expect(missing.message).toBe("Not found")
    // The envelope with no message: the class's default too, not "Request failed".
    expect(thrown(409, { error: { code: "workflow_conflict" } }).message).toBe("Workflow was updated by another writer")
    expect(thrown(429, { error: { code: "rate_limit_exceeded" } }).message).toBe("Rate limited")
  })

  it("a sentence in `error` is the message, never a code", () => {
    const err = thrown(404, { error: "Profile not found" })
    expect(err).toBeInstanceOf(NotFoundError)
    expect(err.message).toBe("Profile not found")
    expect(thrown(400, { error: "No valid fields to update" })).toMatchObject({
      code: "internal_error",
      message: "No valid fields to update",
    })
  })

  it("a bare validation answer ({ message, issues }) is a validation_error with its message", () => {
    const err = thrown(400, { message: "id: Invalid uuid", issues: [{ path: "id", message: "Invalid uuid" }] })
    expect(err).toMatchObject({ code: "validation_error", status: 400, message: "id: Invalid uuid" })
  })

  it("the framework's own reason phrase is not read as a code; its message is kept", () => {
    const err = thrown(400, { statusCode: 400, error: "Bad Request", message: "body must be object" })
    expect(err).toMatchObject({ code: "internal_error", status: 400, message: "body must be object" })
  })

  it("an OAuth error body: `error` is the code, `error_description` the message", () => {
    expect(thrown(400, { error: "invalid_grant", error_description: "Code expired, used, or redirect_uri mismatch" })).toMatchObject({
      code: "invalid_grant",
      message: "Code expired, used, or redirect_uri mismatch",
    })
  })

  it("the envelope still wins: its code and message are read as before", () => {
    expect(thrown(409, { error: { code: "name_taken", message: "Name already used" }, message: "ignored" })).toMatchObject({
      code: "name_taken",
      message: "Name already used",
    })
  })

  it("a body that is not an object still throws by status", () => {
    expect(thrown(500, null)).toMatchObject({ code: "internal_error", status: 500, message: "Request failed" })
    expect(thrown(404, "nope")).toBeInstanceOf(NotFoundError)
  })
})

describe("voices.recast", () => {
  it("POSTs /v1/voice-changer-pro with the correct body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job_recast_123" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.voices.recast({
      audioUrl: "https://cdn.example.com/dialogue.mp3",
      orderedVoices: ["Rachel", "Aria"],
      model: "eleven_multilingual_v2",
      preserveBackground: true,
      removeBackgroundNoise: false,
    })
    expect(result).toEqual({ jobId: "job_recast_123" })
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/v1/voice-changer-pro",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          audioUrl: "https://cdn.example.com/dialogue.mp3",
          orderedVoices: ["Rachel", "Aria"],
          model: "eleven_multilingual_v2",
          preserveBackground: true,
          removeBackgroundNoise: false,
        }),
      }),
    )
  })

  // Keep-slot: a null entry means "keep this speaker's original voice"
  // (requires a platform running cloud-plugins with keep-slot support). The
  // request body forwards it as-is, positionally — this is a type-acceptance
  // test as much as a runtime one (orderedVoices must type-check with null).
  it("accepts a null keep-original slot in orderedVoices and POSTs it positionally", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job_recast_456" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.voices.recast({
      audioUrl: "https://cdn.example.com/dialogue.mp3",
      orderedVoices: [null, "Aria"],
    })
    expect(result).toEqual({ jobId: "job_recast_456" })
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/v1/voice-changer-pro",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          audioUrl: "https://cdn.example.com/dialogue.mp3",
          orderedVoices: [null, "Aria"],
        }),
      }),
    )
  })
})

/**
 * `X-Nodaro-Client` identifies non-browser callers (CLI, server-side
 * integrations) to the backend, which records it as job provenance.
 *
 * It is deliberately NOT sent from a browser: the browser already sends
 * `Origin`, which the backend prefers because it names the product rather than
 * the library — and, more importantly, a non-safelisted request header from a
 * browser must be echoed in the server's `Access-Control-Allow-Headers` or the
 * PREFLIGHT fails, breaking every call from that app. Suppressing it in
 * browsers removes that coupling entirely.
 */
describe("client identification header", () => {
  const capture = () => {
    const calls: RequestInit[] = []
    const fetchMock = vi.fn((_u: unknown, init: RequestInit) => {
      calls.push(init)
      return mockOk({ ok: true }) as unknown as Promise<Response>
    })
    return { calls, fetchMock: fetchMock as unknown as typeof fetch }
  }
  const headersOf = (init: RequestInit) => (init.headers ?? {}) as Record<string, string>

  it("sends sdk/<version> when there is no browser (Node, CLI, server)", async () => {
    const { calls, fetchMock } = capture()
    const c = createClient({ baseUrl: "https://x", auth: new StaticTokenAuth("t"), fetch: fetchMock })
    await c.request("GET", "/v1/ping")
    expect(headersOf(calls[0]!)["X-Nodaro-Client"]).toMatch(/^sdk\//)
  })

  it("an explicit clientLabel is used verbatim — this is how the CLI is distinguishable", async () => {
    const { calls, fetchMock } = capture()
    const c = createClient({ baseUrl: "https://x", auth: new StaticTokenAuth("t"), fetch: fetchMock, clientLabel: "cli/1.6.0" })
    await c.request("GET", "/v1/ping")
    expect(headersOf(calls[0]!)["X-Nodaro-Client"]).toBe("cli/1.6.0")
  })

  it("omits the DEFAULT label in a browser — Origin already says more, and a stale server allowlist would break the preflight", async () => {
    vi.stubGlobal("window", { document: {} })
    try {
      const { calls, fetchMock } = capture()
      const c = createClient({ baseUrl: "https://x", auth: new StaticTokenAuth("t"), fetch: fetchMock })
      await c.request("GET", "/v1/ping")
      expect(headersOf(calls[0]!)["X-Nodaro-Client"]).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("still sends an EXPLICIT label in a browser — naming yourself is deliberate", async () => {
    vi.stubGlobal("window", { document: {} })
    try {
      const { calls, fetchMock } = capture()
      const c = createClient({ baseUrl: "https://x", auth: new StaticTokenAuth("t"), fetch: fetchMock, clientLabel: "studio/2.0.0" })
      await c.request("GET", "/v1/ping")
      expect(headersOf(calls[0]!)["X-Nodaro-Client"]).toBe("studio/2.0.0")
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
