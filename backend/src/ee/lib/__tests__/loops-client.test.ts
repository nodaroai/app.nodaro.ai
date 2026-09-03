import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/config.js", () => ({ config: { LOOPS_API_KEY: "" } }))

import { updateContact, isLoopsConfigured, sendTransactional } from "../loops-client.js"
import { config } from "../../../lib/config.js"

function setKey(key: string) {
  ;(config as { LOOPS_API_KEY: string }).LOOPS_API_KEY = key
}

beforeEach(() => setKey(""))
afterEach(() => vi.unstubAllGlobals())

describe("loops-client", () => {
  it("is not configured and no-ops when the key is empty", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    expect(isLoopsConfigured()).toBe(false)
    const r = await updateContact("a@b.com", { subscribed: true })
    expect(r.ok).toBe(false)
    expect(r.error).toBe("loops_not_configured")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("PUTs the contact with the bearer key and returns ok on 200", async () => {
    setKey("test-key")
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" })
    vi.stubGlobal("fetch", fetchMock)
    const r = await updateContact("a@b.com", { subscribed: true, firstName: "A" })
    expect(r.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toContain("/contacts/update")
    expect(opts.method).toBe("PUT")
    expect(opts.headers.Authorization).toBe("Bearer test-key")
    expect(JSON.parse(opts.body as string)).toMatchObject({ email: "a@b.com", subscribed: true, firstName: "A" })
  })

  it("returns not-ok with the status on an HTTP error", async () => {
    setKey("test-key")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "rate limited" }))
    const r = await updateContact("a@b.com", {})
    expect(r.ok).toBe(false)
    expect(r.status).toBe(429)
  })

  it("returns not-ok (never throws) when fetch rejects", async () => {
    setKey("test-key")
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")))
    const r = await updateContact("a@b.com", {})
    expect(r.ok).toBe(false)
    expect(r.error).toContain("network down")
  })
})

describe("sendTransactional", () => {
  it("no-ops without a key — a keyless install never calls out", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const r = await sendTransactional("tpl_1", "a@b.com", { x: "1" })
    expect(r.ok).toBe(false)
    expect(r.error).toBe("loops_not_configured")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("POSTs the transactional id, recipient and variables", async () => {
    setKey("test-key")
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{"success":true,"id":"m_1"}' }),
    )
    const r = await sendTransactional("tpl_1", "a@b.com", { whatHappened: "x" })
    expect(r.ok).toBe(true)
    expect(r.messageId).toBe("m_1")
    const [url, opts] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ]
    expect(url).toContain("/transactional")
    expect(opts.method).toBe("POST")
    expect(opts.headers.Authorization).toBe("Bearer test-key")
    expect(JSON.parse(opts.body as string)).toMatchObject({
      transactionalId: "tpl_1",
      email: "a@b.com",
      dataVariables: { whatHappened: "x" },
    })
  })

  it("NEVER adds the recipient to the marketing audience", async () => {
    // A service email must not grow the marketing list as a side effect, and
    // the Loops default is not ours to rely on — it is pinned on every send.
    setKey("test-key")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "{}" }))
    await sendTransactional("tpl_1", "a@b.com", {})
    const [, opts] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(opts.body as string).addToAudience).toBe(false)
  })

  it("treats a 2xx with no id as sent — a missing id is not a failure", async () => {
    setKey("test-key")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "{}" }))
    const r = await sendTransactional("tpl_1", "a@b.com", {})
    expect(r.ok).toBe(true)
    expect(r.messageId).toBeUndefined()
  })

  it("treats a non-JSON 2xx as sent", async () => {
    setKey("test-key")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "OK" }))
    expect((await sendTransactional("tpl_1", "a@b.com", {})).ok).toBe(true)
  })

  it("treats an explicit success:false as a failure even on a 200", async () => {
    setKey("test-key")
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{"success":false}' }),
    )
    const r = await sendTransactional("tpl_1", "a@b.com", {})
    expect(r.ok).toBe(false)
  })

  it("returns the provider's reason on an HTTP error", async () => {
    setKey("test-key")
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "unknown transactionalId" }),
    )
    const r = await sendTransactional("tpl_1", "a@b.com", {})
    expect(r.ok).toBe(false)
    expect(r.status).toBe(400)
    expect(r.error).toContain("unknown transactionalId")
  })

  it("bounds a huge provider body instead of carrying it around", async () => {
    setKey("test-key")
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "e".repeat(9000) }),
    )
    const r = await sendTransactional("tpl_1", "a@b.com", {})
    expect(r.error?.length).toBe(1000)
  })

  it("returns not-ok (never throws) when fetch rejects", async () => {
    setKey("test-key")
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")))
    const r = await sendTransactional("tpl_1", "a@b.com", {})
    expect(r.ok).toBe(false)
    expect(r.error).toContain("network down")
  })
})

describe("sendTransactional failure kinds", () => {
  it("labels an HTTP rejection 'provider' — the message did not go", async () => {
    setKey("test-key")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => "nope" }))
    expect((await sendTransactional("t", "a@b.com", {})).failureKind).toBe("provider")
  })

  it("labels an explicit success:false 'provider' too", async () => {
    setKey("test-key")
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{"success":false}' }),
    )
    expect((await sendTransactional("t", "a@b.com", {})).failureKind).toBe("provider")
  })

  it("labels a timeout 'timeout' — the message may well have been delivered", async () => {
    // This is the distinction the whole outcome model rests on: Loops accepting
    // a send and taking longer than our patience is NOT a rejection, and must
    // not be recorded as one.
    setKey("test-key")
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const err = new Error("This operation was aborted")
            err.name = "AbortError"
            reject(err)
          })
        }),
      ),
    )
    vi.useFakeTimers()
    const promise = sendTransactional("t", "a@b.com", {})
    await vi.advanceTimersByTimeAsync(11_000)
    const r = await promise
    vi.useRealTimers()
    expect(r.ok).toBe(false)
    expect(r.failureKind).toBe("timeout")
  })

  it("labels a socket error 'network', not 'timeout'", async () => {
    setKey("test-key")
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")))
    expect((await sendTransactional("t", "a@b.com", {})).failureKind).toBe("network")
  })

  it("labels a missing key 'not_configured'", async () => {
    vi.stubGlobal("fetch", vi.fn())
    expect((await sendTransactional("t", "a@b.com", {})).failureKind).toBe("not_configured")
  })
})
