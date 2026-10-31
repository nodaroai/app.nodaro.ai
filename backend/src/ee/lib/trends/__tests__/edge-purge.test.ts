/**
 * edge-purge.ts: Cloudflare is asked to drop the guest catalog's copies only
 * where it is configured, twice per burst of changes, and never throws.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  TRENDS_CATALOG_CACHE_TAG,
  _resetTrendCatalogEdgePurgeForTests,
  requestTrendCatalogEdgePurge,
  trendCatalogEdgeConfigured,
} from "../edge-purge.js"

const fetchMock = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }))
  vi.stubGlobal("fetch", fetchMock)
  _resetTrendCatalogEdgePurgeForTests()
})

afterEach(() => {
  _resetTrendCatalogEdgePurgeForTests()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function configure() {
  vi.stubEnv("CLOUDFLARE_API_TOKEN", " token-1 ")
  vi.stubEnv("CLOUDFLARE_ZONE_ID", "zone-1")
}

describe("unconfigured", () => {
  it("does nothing, and says the edge may not keep the catalog", async () => {
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "")
    vi.stubEnv("CLOUDFLARE_ZONE_ID", "zone-1")
    expect(trendCatalogEdgeConfigured()).toBe(false)
    requestTrendCatalogEdgePurge(5_000)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).not.toHaveBeenCalled()

    vi.stubEnv("CLOUDFLARE_API_TOKEN", "token-1")
    vi.stubEnv("CLOUDFLARE_ZONE_ID", "")
    expect(trendCatalogEdgeConfigured()).toBe(false)
  })
})

describe("configured", () => {
  it("purges the catalog's tag on the zone, with the token, at once and again after the burst settles", async () => {
    configure()
    expect(trendCatalogEdgeConfigured()).toBe(true)
    requestTrendCatalogEdgePurge(5_000)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.cloudflare.com/client/v4/zones/zone-1/purge_cache")
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-1")
    expect(JSON.parse(init.body as string)).toEqual({ tags: [TRENDS_CATALOG_CACHE_TAG] })

    await vi.advanceTimersByTimeAsync(4_999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("a burst of changes is two purges: the first at once, the second after the LAST change settles", async () => {
    configure()
    requestTrendCatalogEdgePurge(5_000)
    await vi.advanceTimersByTimeAsync(3_000)
    requestTrendCatalogEdgePurge(5_000)
    await vi.advanceTimersByTimeAsync(3_000)
    requestTrendCatalogEdgePurge(5_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // The burst is over: the next change purges at once again.
    requestTrendCatalogEdgePurge(5_000)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("never throws: a refusal or a network failure is logged", async () => {
    configure()
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    fetchMock.mockResolvedValueOnce(new Response("{\"success\":false}", { status: 403 }))
    fetchMock.mockRejectedValueOnce(new Error("offline"))
    expect(() => requestTrendCatalogEdgePurge(5_000)).not.toThrow()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(logged).toHaveBeenCalledTimes(2)
  })
})
