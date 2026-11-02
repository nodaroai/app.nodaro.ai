/**
 * lib/edge-purge.ts: the edge is asked only where configured, by tag or by
 * URL (thirty at a time), and the answer says what happened; it never throws.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { PURGE_URLS_PER_CALL, edgePurgeConfigured, purgeEdgeTags, purgeEdgeUrls } from "../edge-purge.js"

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }))
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function configure() {
  vi.stubEnv("CLOUDFLARE_API_TOKEN", " token-1 ")
  vi.stubEnv("CLOUDFLARE_ZONE_ID", "zone-1")
}

describe("unconfigured", () => {
  it("asks nothing and says so", async () => {
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "")
    vi.stubEnv("CLOUDFLARE_ZONE_ID", "zone-1")
    expect(edgePurgeConfigured()).toBe(false)
    expect(await purgeEdgeUrls(["https://cdn.example.test/a.png"])).toEqual({ status: "not_configured" })
    expect(await purgeEdgeTags(["t"])).toEqual({ status: "not_configured" })
    expect(await purgeEdgeUrls([])).toEqual({ status: "not_configured" })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("configured", () => {
  it("purges by URL on the zone with the token, thirty addresses a call, each once", async () => {
    configure()
    const urls = Array.from({ length: PURGE_URLS_PER_CALL + 1 }, (_, i) => `https://cdn.example.test/${i}.png`)
    expect(await purgeEdgeUrls([...urls, urls[0]!])).toEqual({ status: "done" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.cloudflare.com/client/v4/zones/zone-1/purge_cache")
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-1")
    expect(JSON.parse(init.body as string).files).toHaveLength(PURGE_URLS_PER_CALL)
    expect(JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string).files).toEqual([urls[PURGE_URLS_PER_CALL]])
    expect(await purgeEdgeUrls([])).toEqual({ status: "done" })
  })

  it("purges by tag", async () => {
    configure()
    expect(await purgeEdgeTags(["trends-catalog"])).toEqual({ status: "done" })
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual({ tags: ["trends-catalog"] })
  })

  it("answers a refusal and a network failure as failed, with the reason, and never throws", async () => {
    configure()
    fetchMock.mockResolvedValueOnce(new Response("no such zone", { status: 403 }))
    expect(await purgeEdgeUrls(["https://cdn.example.test/a.png"])).toEqual({ status: "failed", error: "403: no such zone" })
    fetchMock.mockRejectedValueOnce(new Error("socket hang up"))
    expect(await purgeEdgeTags(["t"])).toEqual({ status: "failed", error: "socket hang up" })
  })
})
