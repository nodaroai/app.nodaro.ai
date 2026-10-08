import { describe, expect, it, vi } from "vitest"
import { inspectUrl, readSearchReport, searchWindow, siteUrlOf, urlBelongsToSite } from "../search-console.js"

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const SITE = "sc-domain:nodaro.ai"

describe("searchWindow", () => {
  it("is the N days ending yesterday on Search Console's clock (Pacific)", () => {
    // 05:00Z on Oct 8 is still Oct 7 in California: yesterday there is Oct 6.
    expect(searchWindow(7, new Date("2026-10-08T05:00:00Z"))).toEqual({ startDate: "2026-09-30", endDate: "2026-10-06" })
    // 12:00Z is already Oct 8 in California.
    expect(searchWindow(7, new Date("2026-10-08T12:00:00Z"))).toEqual({ startDate: "2026-10-01", endDate: "2026-10-07" })
    expect(searchWindow(28, new Date("2026-10-08T12:00:00Z")).startDate).toBe("2026-09-10")
  })
})

describe("urlBelongsToSite", () => {
  it("a domain property covers the domain and its subdomains, over http or https, and nothing else", () => {
    expect(urlBelongsToSite("https://nodaro.ai/docs/node/text-prompt", SITE)).toBe(true)
    expect(urlBelongsToSite("https://www.nodaro.ai/", SITE)).toBe(true)
    expect(urlBelongsToSite("http://studio.nodaro.ai/x", SITE)).toBe(true)
    expect(urlBelongsToSite("https://nodaro.ai.evil.com/", SITE)).toBe(false)
    expect(urlBelongsToSite("https://evilnodaro.ai/", SITE)).toBe(false)
    expect(urlBelongsToSite("https://nodaro.ai@evil.com/", SITE)).toBe(false)
    expect(urlBelongsToSite("https://user:pw@nodaro.ai/", SITE)).toBe(false)
    expect(urlBelongsToSite("ftp://nodaro.ai/file", SITE)).toBe(false)
    expect(urlBelongsToSite("javascript:alert(1)", SITE)).toBe(false)
    expect(urlBelongsToSite("not a url", SITE)).toBe(false)
  })

  it("a URL-prefix property covers what starts with it, scheme included", () => {
    const prefix = "https://nodaro.ai/"
    expect(urlBelongsToSite("https://nodaro.ai/docs", prefix)).toBe(true)
    expect(urlBelongsToSite("https://nodaro.ai", prefix)).toBe(true)
    expect(urlBelongsToSite("http://nodaro.ai/docs", prefix)).toBe(false)
    expect(urlBelongsToSite("https://nodaro.ai.evil.com/", prefix)).toBe(false)
  })
})

describe("siteUrlOf", () => {
  it("answers the parsed address — the one Google is asked about and the cache keeps — without its fragment", () => {
    expect(siteUrlOf("https://nodaro.ai/docs#models", SITE)).toBe("https://nodaro.ai/docs")
    expect(siteUrlOf("https://nodaro.ai/docs#", SITE)).toBe("https://nodaro.ai/docs")
    expect(siteUrlOf("HTTPS://Nodaro.AI/docs", SITE)).toBe("https://nodaro.ai/docs")
    // A backslash is a slash to a URL parser: the page is nodaro.ai's, and that is what is sent.
    expect(siteUrlOf("https://nodaro.ai\\@evil.com", SITE)).toBe("https://nodaro.ai/@evil.com")
    expect(siteUrlOf("https://nodaro.ai.evil.com/docs", SITE)).toBeNull()
  })
})

describe("readSearchReport", () => {
  const NOW = new Date("2026-10-08T12:00:00Z")
  const SITEMAP = {
    path: "https://nodaro.ai/sitemap.xml",
    lastSubmitted: "2026-10-01T10:00:00Z",
    lastDownloaded: "2026-10-07T03:00:00Z",
    isPending: false,
    warnings: "1",
    errors: "0",
    contents: [{ type: "web", submitted: "120", indexed: "0" }, { type: "video", submitted: "14" }],
  }

  function searchApi(opts: { sitemaps?: () => Response; pages?: number } = {}) {
    return vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/sitemaps")) return opts.sitemaps ? opts.sitemaps() : ok({ sitemap: [SITEMAP] })
      const body = JSON.parse(String(init.body)) as { dimensions: string[] }
      const dimension = body.dimensions[0]
      if (!dimension) return ok({ rows: [{ clicks: 50, impressions: 2000, ctr: 0.025, position: 18.4 }] })
      if (dimension === "date") return ok({ rows: [{ keys: ["2026-10-07"], clicks: 5, impressions: 90, ctr: 0.05, position: 20 }, { keys: ["2026-10-04"], clicks: 7, impressions: 80, ctr: 0.0875, position: 19 }] })
      if (dimension === "page") {
        const count = opts.pages ?? 1
        return ok({ rows: Array.from({ length: count }, (_, i) => ({ keys: [`https://nodaro.ai/p${i}`], clicks: 30, impressions: 900, ctr: 0.033, position: 9.2 })) })
      }
      return ok({ rows: [{ keys: ["nodaro"], clicks: 25, impressions: 100, ctr: 0.25, position: 1.1 }] })
    })
  }

  it("sends exactly these four queries over the window with Google's newest data, plus the sitemaps", async () => {
    const fetch = searchApi()
    await readSearchReport({ site: SITE, days: 7, token: "tok", fetch, now: NOW })
    const queryUrl = "https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Anodaro.ai/searchAnalytics/query"
    const bodies = fetch.mock.calls.filter(([url]) => url === queryUrl).map(([, init]) => JSON.parse(String(init.body)) as Record<string, unknown>)
    const window = { startDate: "2026-10-01", endDate: "2026-10-07", dataState: "all" }
    expect(bodies).toEqual(
      expect.arrayContaining([
        { ...window, dimensions: [] },
        { ...window, dimensions: ["date"], rowLimit: 100 },
        { ...window, dimensions: ["page"], rowLimit: 250 },
        { ...window, dimensions: ["query"], rowLimit: 250 },
      ]),
    )
    expect(bodies).toHaveLength(4)
    expect(fetch.mock.calls.some(([url]) => url === "https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Anodaro.ai/sitemaps")).toBe(true)
  })

  it("reads totals, pages, searches and each sitemap's counts; every day of the window is there", async () => {
    const report = await readSearchReport({ site: SITE, days: 7, token: "tok", fetch: searchApi(), now: NOW })
    expect(report.window).toEqual({ startDate: "2026-10-01", endDate: "2026-10-07" })
    expect(report.totals).toEqual({ clicks: 50, impressions: 2000, ctr: 0.025, position: 18.4 })
    expect(report.daily).toHaveLength(7)
    expect(report.daily[0]).toEqual({ date: "2026-10-01", clicks: 0, impressions: 0 })
    expect(report.daily[3]).toEqual({ date: "2026-10-04", clicks: 7, impressions: 80 })
    expect(report.daily[6]).toEqual({ date: "2026-10-07", clicks: 5, impressions: 90 })
    expect(report.pages).toEqual([{ key: "https://nodaro.ai/p0", clicks: 30, impressions: 900, ctr: 0.033, position: 9.2 }])
    expect(report.pagesCapped).toBe(false)
    expect(report.queries[0]?.key).toBe("nodaro")
    expect(report.sitemaps).toEqual([
      {
        path: "https://nodaro.ai/sitemap.xml",
        lastSubmitted: "2026-10-01T10:00:00Z",
        lastDownloaded: "2026-10-07T03:00:00Z",
        isPending: false,
        warnings: 1,
        errors: 0,
        contents: [{ type: "web", submitted: 120 }, { type: "video", submitted: 14 }],
      },
    ])
  })

  it("says when Google gave only its top rows", async () => {
    const report = await readSearchReport({ site: SITE, days: 7, token: "tok", fetch: searchApi({ pages: 250 }), now: NOW })
    expect(report.pagesCapped).toBe(true)
  })

  it("the sitemaps failing keeps every search number", async () => {
    const report = await readSearchReport({
      site: SITE,
      days: 7,
      token: "tok",
      fetch: searchApi({ sitemaps: () => new Response(JSON.stringify({ error: { code: 500, message: "Backend Error" } }), { status: 500 }) }),
      now: NOW,
    })
    expect(report.totals.clicks).toBe(50)
    expect(report.sitemaps).toBeNull()
    expect(report.sitemapsError).toBe("Backend Error")
  })

  it("a site with no search data yet reads as zeros", async () => {
    const report = await readSearchReport({ site: SITE, days: 7, token: "tok", fetch: async () => ok({}), now: NOW })
    expect(report.totals).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: 0 })
    expect(report.pages).toEqual([])
    expect(report.sitemaps).toEqual([])
    expect(report.daily.every((d) => d.clicks === 0)).toBe(true)
  })
})

describe("inspectUrl", () => {
  it("asks about one page of the site and reads the verdict, the coverage, the last crawl and the report link", async () => {
    const fetch = vi.fn(async () =>
      ok({
        inspectionResult: {
          inspectionResultLink: "https://search.google.com/search-console/inspect?resource_id=sc-domain:nodaro.ai&id=abc",
          indexStatusResult: {
            verdict: "PASS",
            coverageState: "Submitted and indexed",
            indexingState: "INDEXING_ALLOWED",
            pageFetchState: "SUCCESSFUL",
            lastCrawlTime: "2026-10-05T08:00:00Z",
            googleCanonical: "https://nodaro.ai/docs",
          },
        },
      }),
    )
    const status = await inspectUrl({ site: SITE, url: "https://nodaro.ai/docs", token: "tok", fetch, now: new Date("2026-10-08T12:00:00Z") })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect")
    expect(JSON.parse(String(init.body))).toEqual({ inspectionUrl: "https://nodaro.ai/docs", siteUrl: SITE, languageCode: "en-US" })
    expect(status).toEqual({
      url: "https://nodaro.ai/docs",
      verdict: "PASS",
      coverageState: "Submitted and indexed",
      indexingState: "INDEXING_ALLOWED",
      pageFetchState: "SUCCESSFUL",
      lastCrawlTime: "2026-10-05T08:00:00Z",
      googleCanonical: "https://nodaro.ai/docs",
      inspectionLink: "https://search.google.com/search-console/inspect?resource_id=sc-domain:nodaro.ai&id=abc",
      checkedAt: "2026-10-08T12:00:00.000Z",
    })
  })
})
