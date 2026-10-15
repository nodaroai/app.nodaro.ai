/**
 * `safeFetch(url, { followRedirects: false })` — for a caller that must not be
 * redirected (an outbound webhook: its receiver answers at the registered
 * address or the attempt fails). Hermetic: undici is replaced by a scripted
 * fetch, as in safe-fetch-credentials.test.ts.
 *
 * What is pinned: the 3xx comes back to the caller as it was answered, no
 * second hop is ever requested, and the default (follow) is unchanged.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))

vi.mock("undici", () => ({
  Agent: class {
    constructor(_opts?: unknown) {}
  },
  fetch: fetchMock,
}))

import { safeFetch } from "../safe-fetch.js"

function redirect(location: string, status = 302) {
  return new Response(null, { status, headers: { location } })
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe("safeFetch — followRedirects: false", () => {
  it("returns the redirect itself and never requests its target", async () => {
    fetchMock.mockResolvedValueOnce(redirect("https://elsewhere.example.com/in", 301))
    const res = await safeFetch("https://hooks.example.com/in", { method: "POST", body: "{}", followRedirects: false })
    expect(res.status).toBe(301)
    expect(res.headers.get("location")).toBe("https://elsewhere.example.com/in")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("does not pass its own option on to undici", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }))
    await safeFetch("https://hooks.example.com/in", { method: "POST", body: "{}", followRedirects: false })
    const init = fetchMock.mock.calls[0]![1] as Record<string, unknown>
    expect(init).not.toHaveProperty("followRedirects")
    expect(init.redirect).toBe("manual")
  })

  it("still refuses a private address before connecting", async () => {
    await expect(safeFetch("https://127.0.0.1/in", { followRedirects: false })).rejects.toThrow(/private\/reserved/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("leaves the default unchanged: a redirect is followed", async () => {
    fetchMock.mockResolvedValueOnce(redirect("https://elsewhere.example.com/in"))
    fetchMock.mockResolvedValueOnce(new Response("done", { status: 200 }))
    const res = await safeFetch("https://hooks.example.com/in")
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
