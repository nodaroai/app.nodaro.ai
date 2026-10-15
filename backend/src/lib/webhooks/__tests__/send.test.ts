/**
 * One webhook POST (lib/webhooks/send.ts): through safeFetch with redirects
 * NOT followed and a 10 s limit; a 2xx is a delivery, anything else a failed
 * attempt; at most 2 KB of the receiver's answer is read and kept; a
 * transport failure is recorded as a short fixed word, never the raw error
 * (which can name an internal address the URL resolved to).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }))
vi.mock("../../safe-fetch.js", () => ({ safeFetch: safeFetchMock }))

import { RESPONSE_BODY_MAX, SEND_TIMEOUT_MS, classifySendError, postWebhook, storableText } from "../send.js"

const HEADERS = { "Content-Type": "application/json", "Nodaro-Event": "ping" }

/** How fetch (undici) reports what its connector threw: a TypeError, the real error on `cause`. */
const fetchFailed = (cause: Error) => Object.assign(new TypeError("fetch failed"), { cause })

beforeEach(() => {
  safeFetchMock.mockReset()
  delete process.env.R2_PUBLIC_URL
  delete process.env.PUBLIC_URL
  delete process.env.MCP_PUBLIC_URL
})

afterEach(() => {
  delete process.env.R2_PUBLIC_URL
  delete process.env.PUBLIC_URL
  delete process.env.MCP_PUBLIC_URL
})

describe("postWebhook", () => {
  it("POSTs the exact body with the headers, unredirected, within 10 s", async () => {
    safeFetchMock.mockResolvedValueOnce(new Response("thanks", { status: 200 }))
    const out = await postWebhook("https://hooks.example.com/in", '{"a":1}', HEADERS)
    expect(out).toMatchObject({ ok: true, status: 200, body: "thanks", error: null })
    expect(out.durationMs).toBeGreaterThanOrEqual(0)
    const [url, init] = safeFetchMock.mock.calls[0]!
    expect(url).toBe("https://hooks.example.com/in")
    expect(init).toMatchObject({ method: "POST", body: '{"a":1}', headers: HEADERS, followRedirects: false, timeoutMs: SEND_TIMEOUT_MS })
    expect(SEND_TIMEOUT_MS).toBe(10_000)
  })

  it("counts any 2xx as delivered", async () => {
    safeFetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    expect((await postWebhook("https://hooks.example.com/in", "{}", HEADERS)).ok).toBe(true)
  })

  it("a 3xx is a failed attempt, not followed", async () => {
    safeFetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://elsewhere.example.com/" } }))
    const out = await postWebhook("https://hooks.example.com/in", "{}", HEADERS)
    expect(out).toMatchObject({ ok: false, status: 302, error: "http_302" })
  })

  it("a 4xx or 5xx is a failed attempt carrying the receiver's answer", async () => {
    safeFetchMock.mockResolvedValueOnce(new Response("bad signature", { status: 401 }))
    const out = await postWebhook("https://hooks.example.com/in", "{}", HEADERS)
    expect(out).toMatchObject({ ok: false, status: 401, body: "bad signature", error: "http_401" })
  })

  it("keeps at most 2 KB of the answer", async () => {
    safeFetchMock.mockResolvedValueOnce(new Response("x".repeat(50_000), { status: 500 }))
    const out = await postWebhook("https://hooks.example.com/in", "{}", HEADERS)
    expect(out.body).toHaveLength(RESPONSE_BODY_MAX)
    expect(RESPONSE_BODY_MAX).toBe(2048)
  })

  it("stops reading a long answer after the cap (the rest is never pulled)", async () => {
    let pulls = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++
        if (pulls > 1000) {
          controller.close()
          return
        }
        controller.enqueue(new Uint8Array(1024).fill(0x61))
      },
    })
    safeFetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }))
    const out = await postWebhook("https://hooks.example.com/in", "{}", HEADERS)
    expect(out.ok).toBe(true)
    expect(out.body).toHaveLength(RESPONSE_BODY_MAX)
    expect(pulls).toBeLessThan(20)
  })

  it("refuses an address that is not https before sending anything", async () => {
    const out = await postWebhook("http://hooks.example.com/in", "{}", HEADERS)
    expect(out).toMatchObject({ ok: false, status: null, error: "not_https" })
    expect(safeFetchMock).not.toHaveBeenCalled()
  })

  it("refuses this install's own storage before sending anything", async () => {
    process.env.R2_PUBLIC_URL = "https://media.example.com/bucket"
    const out = await postWebhook("https://media.example.com/bucket/x", "{}", HEADERS)
    expect(out).toMatchObject({ ok: false, error: "blocked_address" })
    expect(safeFetchMock).not.toHaveBeenCalled()
  })

  it("refuses an address of this Nodaro server itself before sending anything", async () => {
    process.env.PUBLIC_URL = "https://app.example.com"
    process.env.MCP_PUBLIC_URL = "https://mcp.example.com"
    for (const url of ["https://app.example.com/v1/webhooks/abc", "https://APP.example.com.:8443/x", "https://mcp.example.com/"]) {
      expect(await postWebhook(url, "{}", HEADERS)).toMatchObject({ ok: false, error: "blocked_address" })
    }
    expect(safeFetchMock).not.toHaveBeenCalled()
  })

  it("records a name that resolves to a private address as blocked, without naming the address", async () => {
    // The shape fetch really throws: safeFetch's refusal only on `cause`.
    safeFetchMock.mockRejectedValueOnce(
      fetchFailed(new Error("safeFetch: refusing connection — DNS resolution includes private/reserved IP 10.1.2.3")),
    )
    const out = await postWebhook("https://internal.example.com/in", "{}", HEADERS)
    expect(out).toMatchObject({ ok: false, status: null, body: null, error: "blocked_address" })
    expect(JSON.stringify(out)).not.toContain("10.1.2.3")
  })

  it("keeps an answer the database can store: no NUL, no half of a character pair", async () => {
    safeFetchMock.mockResolvedValueOnce(new Response("a\u0000b\uD83D", { status: 500 }))
    const out = await postWebhook("https://hooks.example.com/in", "{}", HEADERS)
    expect(out.body).toBe("ab�")
  })
})

describe("storableText", () => {
  it("drops NUL characters", () => {
    expect(storableText("x\u0000y\u0000")).toBe("xy")
  })

  it("replaces a lone half of a surrogate pair, keeps whole pairs", () => {
    expect(storableText("😀 \uD83D \uDE00")).toBe("😀 � �")
  })

  it("cuts to the limit, never inside a pair", () => {
    expect(storableText("abc😀", 4)).toBe("abc")
    expect(storableText("abcdef", 4)).toBe("abcd")
    expect(storableText("x".repeat(50_000))).toHaveLength(RESPONSE_BODY_MAX)
  })
})

describe("classifySendError", () => {
  it("says the same word for a name that does not resolve and one that resolves to a private address (no oracle of internal names)", () => {
    const missing = classifySendError(fetchFailed(Object.assign(new Error("getaddrinfo ENOTFOUND db.internal.example"), { code: "ENOTFOUND" })))
    const internal = classifySendError(
      fetchFailed(new Error("safeFetch: refusing connection — DNS resolution includes private/reserved IP 10.0.0.9")),
    )
    expect(missing).toBe("blocked_address")
    expect(internal).toBe(missing)
  })

  const withCode = (code: string) => Object.assign(new Error("fetch failed"), { cause: Object.assign(new Error(code), { code }) })

  it.each([
    [Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }), "timeout"],
    [Object.assign(new Error("This operation was aborted"), { name: "AbortError" }), "timeout"],
    [new Error("safeFetch: blocked — 127.0.0.1 is a private/reserved IP"), "blocked_address"],
    [new Error("safeFetch: no DNS resolution for hooks.example.com"), "blocked_address"],
    [fetchFailed(new Error("safeFetch: refusing connection — DNS resolution includes private/reserved IP 10.0.0.1")), "blocked_address"],
    [fetchFailed(new Error("safeFetch: no DNS resolution for hooks.example.com")), "blocked_address"],
    [fetchFailed(new Error("safeFetch: DNS lookup failed for hooks.example.com")), "blocked_address"],
    [fetchFailed(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })), "timeout"],
    [withCode("ENOTFOUND"), "blocked_address"],
    [withCode("EAI_AGAIN"), "blocked_address"],
    [withCode("ECONNREFUSED"), "connection_refused"],
    [withCode("ECONNRESET"), "connection_reset"],
    [withCode("UND_ERR_SOCKET"), "connection_reset"],
    [withCode("CERT_HAS_EXPIRED"), "tls_error"],
    [withCode("UNABLE_TO_VERIFY_LEAF_SIGNATURE"), "tls_error"],
    [withCode("ERR_TLS_CERT_ALTNAME_INVALID"), "tls_error"],
    [new Error("something else entirely, at 10.0.0.7"), "network_error"],
    ["not even an error", "network_error"],
  ])("%s -> %s", (err, expected) => {
    expect(classifySendError(err)).toBe(expected)
  })
})
