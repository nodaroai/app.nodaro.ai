/**
 * callCloudRoute — the synchronous cousin of createCloudJob, for cloud routes
 * that answer with the result rather than a job to poll (web-scrape). What it
 * must guarantee:
 *   - it POSTs the body through nodaroCloudFetch (the instance token rides
 *     that) and returns the parsed JSON;
 *   - a refusal becomes a NodaroCloudError carrying the cloud's own message;
 *   - the call carries a long-deadline dispatcher — a site crawl can run for
 *     ~10 minutes with no response headers, past undici's 300 s default,
 *     which would drop the socket while the cloud finishes and bills.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockFetch = vi.fn()
vi.mock("../../../lib/nodaro-connect.js", () => ({
  nodaroCloudFetch: (...a: unknown[]) => mockFetch(...a),
  getNodaroConnection: vi.fn(),
  nodaroCloudBase: () => "https://cloud.test",
}))

const { callCloudRoute, NodaroCloudError } = await import("../client.js")

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe("callCloudRoute", () => {
  it("POSTs the body and returns the cloud's JSON", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { jobId: "cloud-1", json: [{ title: "T" }] }))
    const out = await callCloudRoute("/v1/web-scrape", { actor: "google-search", query: "ai" })
    expect(out).toEqual({ jobId: "cloud-1", json: [{ title: "T" }] })
    const [path, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(path).toBe("/v1/web-scrape")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({ actor: "google-search", query: "ai" })
  })

  it("carries a dispatcher whose deadlines outlast a 600 s crawl (undici's default would cut at 300 s)", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { ok: true }))
    await callCloudRoute("/v1/web-scrape", { actor: "content-crawler", url: "https://x", mode: "site" })
    const init = mockFetch.mock.calls[0]?.[1] as { dispatcher?: unknown }
    expect(init.dispatcher, "no dispatcher — the call would die at undici's 300 s headers timeout").toBeTruthy()
    // undici Agent exposes its options through the symbol-keyed internals; the
    // public contract we can assert without reaching in: it is an undici Agent.
    const { Agent } = await import("undici")
    expect(init.dispatcher).toBeInstanceOf(Agent)
  })

  it("turns a refusal into NodaroCloudError with the cloud's own message", async () => {
    mockFetch.mockResolvedValue(jsonResponse(402, { error: { code: "insufficient_credits", message: "Insufficient nodaro.ai credits — top up." } }))
    await expect(callCloudRoute("/v1/web-scrape", { actor: "google-search", query: "ai" })).rejects.toMatchObject({
      name: "NodaroCloudError",
      statusCode: 402,
      code: "insufficient_credits",
      message: expect.stringContaining("Insufficient nodaro.ai credits"),
    })
    expect(NodaroCloudError).toBeDefined()
  })

  it("fails loudly on a 200 with no JSON body", async () => {
    mockFetch.mockResolvedValue(new Response("", { status: 200 }))
    await expect(callCloudRoute("/v1/web-scrape", {})).rejects.toThrow(/returned no body/)
  })
})
