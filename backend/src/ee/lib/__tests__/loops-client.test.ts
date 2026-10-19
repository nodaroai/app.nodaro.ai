import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/config.js", () => ({ config: { LOOPS_API_KEY: "" } }))

import {
  updateContact,
  isLoopsConfigured,
  sendTransactional,
  findContact,
  listCustomContactProperties,
  createContactProperty,
  LOOPS_LANGUAGE_PROPERTY,
} from "../loops-client.js"
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

  it("carries the customer's language as a contact property", async () => {
    setKey("test-key")
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" })
    vi.stubGlobal("fetch", fetchMock)
    await updateContact("a@b.com", { subscribed: true, language: "ja" })
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(opts.body as string)).toMatchObject({ email: "a@b.com", subscribed: true, language: "ja" })
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

describe("findContact", () => {
  it("is not-ok without a key and never calls out", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const r = await findContact("a@b.com")
    expect(r.ok).toBe(false)
    expect(r.contact).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("GETs by email and reads the subscribed flag", async () => {
    setKey("test-key")
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: "c1", email: "a@b.com", subscribed: false }],
      text: async () => "",
    })
    vi.stubGlobal("fetch", fetchMock)
    const r = await findContact("a+tag@b.com")
    expect(r.ok).toBe(true)
    expect(r.contact).toEqual({ email: "a@b.com", subscribed: false })
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe("https://app.loops.so/api/v1/contacts/find?email=a%2Btag%40b.com")
    expect(opts.method).toBe("GET")
    expect(opts.headers.Authorization).toBe("Bearer test-key")
  })

  it("answers ok with a null contact when Loops has none", async () => {
    setKey("test-key")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [], text: async () => "" }))
    const r = await findContact("a@b.com")
    expect(r).toMatchObject({ ok: true, contact: null })
  })

  it("is not-ok on an HTTP error, an unexpected body, and a rejected fetch — never 'unsubscribed'", async () => {
    setKey("test-key")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" }))
    expect(await findContact("a@b.com")).toMatchObject({ ok: false, status: 500, contact: null })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ nope: true }), text: async () => "" }))
    expect(await findContact("a@b.com")).toMatchObject({ ok: false, contact: null })
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")))
    expect(await findContact("a@b.com")).toMatchObject({ ok: false, contact: null })
  })
})

describe("custom contact properties", () => {
  const PROPERTIES = [
    { key: "language", label: "Language", type: "string" },
    { key: "plan", label: "Plan", type: "string" },
  ]

  it("names the language property 'language'", () => {
    expect(LOOPS_LANGUAGE_PROPERTY).toBe("language")
  })

  describe("listCustomContactProperties", () => {
    it("is not-ok without a key and never calls out", async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal("fetch", fetchMock)
      const r = await listCustomContactProperties()
      expect(r).toMatchObject({ ok: false, error: "loops_not_configured", properties: null })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("GETs the account's custom properties", async () => {
      setKey("test-key")
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(PROPERTIES) })
      vi.stubGlobal("fetch", fetchMock)
      const r = await listCustomContactProperties()
      expect(r.ok).toBe(true)
      expect(r.properties).toEqual(PROPERTIES)
      const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
      expect(url).toBe("https://app.loops.so/api/v1/contacts/properties?list=custom")
      expect(opts.method).toBe("GET")
      expect(opts.headers.Authorization).toBe("Bearer test-key")
    })

    it("keeps only the entries that are properties", async () => {
      setKey("test-key")
      const body = JSON.stringify([PROPERTIES[0], null, "x", { label: "no key" }, { key: 7 }])
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => body }))
      const r = await listCustomContactProperties()
      expect(r.properties).toEqual([PROPERTIES[0]])
    })

    it("is not-ok — never an empty list — on an HTTP error, an unexpected body and a rejected fetch", async () => {
      setKey("test-key")
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" }))
      expect(await listCustomContactProperties()).toMatchObject({ ok: false, status: 500, properties: null })
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{"nope":true}' }))
      expect(await listCustomContactProperties()).toMatchObject({ ok: false, properties: null })
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "not json" }))
      expect(await listCustomContactProperties()).toMatchObject({ ok: false, properties: null })
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")))
      const r = await listCustomContactProperties()
      expect(r).toMatchObject({ ok: false, properties: null })
      expect(r.error).toContain("network down")
    })
  })

  describe("createContactProperty", () => {
    it("is not-ok without a key and never calls out", async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal("fetch", fetchMock)
      const r = await createContactProperty("language", "string")
      expect(r).toMatchObject({ ok: false, error: "loops_not_configured" })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("POSTs the property name and type", async () => {
      setKey("test-key")
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{"success":true}' })
      vi.stubGlobal("fetch", fetchMock)
      const r = await createContactProperty("language", "string")
      expect(r.ok).toBe(true)
      const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
      expect(url).toBe("https://app.loops.so/api/v1/contacts/properties")
      expect(opts.method).toBe("POST")
      expect(opts.headers.Authorization).toBe("Bearer test-key")
      expect(JSON.parse(opts.body as string)).toEqual({ name: "language", type: "string" })
    })

    it("returns Loops' reason on a refusal", async () => {
      setKey("test-key")
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => '{"success":false,"message":"Property already exists."}' }),
      )
      const r = await createContactProperty("language", "string")
      expect(r.ok).toBe(false)
      expect(r.status).toBe(400)
      expect(r.error).toContain("already exists")
    })

    it("treats an explicit success:false on a 200 as a refusal", async () => {
      setKey("test-key")
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{"success":false,"message":"nope"}' }))
      const r = await createContactProperty("language", "string")
      expect(r.ok).toBe(false)
      expect(r.error).toContain("nope")
    })

    it("returns not-ok (never throws) when fetch rejects", async () => {
      setKey("test-key")
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")))
      const r = await createContactProperty("language", "string")
      expect(r.ok).toBe(false)
      expect(r.error).toContain("network down")
    })
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
