import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/config.js", () => ({ config: { LOOPS_API_KEY: "" } }))

import { updateContact, isLoopsConfigured } from "../loops-client.js"
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
