/**
 * Meta Ad Library provider tests — input building (the actor's dotted keys
 * and the Ad Library search url), output projection (normalize, dedupe,
 * slice), and the run lifecycle (abort a still-running run, surface FAILED,
 * sanitize errors, let a missing key through untouched).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { callBackedRuns } from "./fake-actor-run.js"

const mocks = vi.hoisted(() => ({
  datasetListItems: vi.fn(),
  datasetFn: vi.fn(),
  actorCall: vi.fn(),
  actorFn: vi.fn(),
  runAbort: vi.fn(),
  runFn: vi.fn(),
  getApifyClient: vi.fn(),
  sanitizeApifyError: vi.fn(),
}))

vi.mock("../client.js", () => ({
  getApifyClient: mocks.getApifyClient,
  sanitizeApifyError: mocks.sanitizeApifyError,
}))

import { MissingProviderKeyError } from "../../provider-keys.js"
import {
  META_ADS_ACTOR,
  META_ADS_ACTOR_MIN_CHARGED_RESULTS,
  actorLimitPerSource,
  buildAdLibrarySearchUrl,
  buildMetaAdsActorInput,
  filterMetaAdsByPeriod,
  filterMetaAdsByPlatforms,
  projectMetaAds,
  runMetaAdsScrape,
  selectMetaAds,
  type MetaAdsScrapeArgs,
} from "../meta-ads.js"

const NOW = new Date("2026-09-17T12:00:00.000Z")

const searchArgs: MetaAdsScrapeArgs = {
  mode: "search",
  query: "running shoes",
  count: 20,
  period: "7d",
  activeStatus: "active",
  countryCode: "US",
}

const pagesArgs: MetaAdsScrapeArgs = {
  mode: "pages",
  pageUrls: ["https://www.facebook.com/nike", "https://www.facebook.com/adidas"],
  count: 10,
  period: "all",
  activeStatus: "all",
  countryCode: "ALL",
}

function rawAd(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ad_archive_id: "111",
    page_id: "999",
    page_name: "Nike",
    start_date: 1_757_980_800, // 2025-09-16T00:00:00Z
    end_date: null,
    is_active: true,
    publisher_platform: ["FACEBOOK", "INSTAGRAM"],
    collation_count: 3,
    snapshot: {
      body: { text: "Just do it." },
      title: "Air Max",
      caption: "nike.com",
      cta_text: "Shop now",
      link_url: "https://nike.com/airmax",
      images: [{ original_image_url: "https://img/1.jpg", resized_image_url: "https://img/1-small.jpg" }],
      videos: [{ video_hd_url: "https://vid/1-hd.mp4", video_sd_url: "https://vid/1-sd.mp4", video_preview_image_url: "https://vid/1.jpg" }],
      cards: [],
    },
    ...overrides,
  }
}

let runs: ReturnType<typeof callBackedRuns>

beforeEach(() => {
  vi.clearAllMocks()
  mocks.actorCall.mockResolvedValue({ id: "run-1", status: "SUCCEEDED", defaultDatasetId: "ds-1" })
  runs = callBackedRuns((input, opts) => mocks.actorCall(input, opts))
  mocks.actorFn.mockReturnValue({ call: mocks.actorCall, start: runs.start })
  mocks.datasetListItems.mockResolvedValue({ items: [rawAd()] })
  mocks.datasetFn.mockReturnValue({ listItems: mocks.datasetListItems })
  mocks.runAbort.mockResolvedValue(undefined)
  mocks.runFn.mockImplementation((id: string) => runs.runOf(id, { abort: mocks.runAbort }))
  mocks.getApifyClient.mockReturnValue({ actor: mocks.actorFn, dataset: mocks.datasetFn, run: mocks.runFn })
  mocks.sanitizeApifyError.mockImplementation((err: unknown, ctx: string) =>
    new Error(`[apify:${ctx}] ${err instanceof Error ? err.message : String(err)}`),
  )
})

describe("buildAdLibrarySearchUrl", () => {
  it("encodes the keyword search exactly like the Ad Library UI", () => {
    const url = new URL(buildAdLibrarySearchUrl(searchArgs, NOW))
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/ads/library/")
    expect(url.searchParams.get("q")).toBe("running shoes")
    expect(url.searchParams.get("active_status")).toBe("active")
    expect(url.searchParams.get("country")).toBe("US")
    expect(url.searchParams.get("search_type")).toBe("keyword_unordered")
    expect(url.searchParams.get("ad_type")).toBe("all")
    expect(url.searchParams.get("media_type")).toBe("all")
  })

  it("maps the period to the UI's start_date[min|max] window", () => {
    const url = new URL(buildAdLibrarySearchUrl(searchArgs, NOW))
    expect(url.searchParams.get("start_date[min]")).toBe("2026-09-10")
    expect(url.searchParams.get("start_date[max]")).toBe("2026-09-17")
  })

  it("omits the date window for 'all'", () => {
    const url = new URL(buildAdLibrarySearchUrl({ ...searchArgs, period: "all" }, NOW))
    expect(url.searchParams.has("start_date[min]")).toBe(false)
    expect(url.searchParams.has("start_date[max]")).toBe(false)
  })

  it("sorts a windowed search most-recent-first (fills the window), keeps relevance order for 'all'", () => {
    const windowed = new URL(buildAdLibrarySearchUrl(searchArgs, NOW))
    expect(windowed.searchParams.get("sort_data[direction]")).toBe("desc")
    expect(windowed.searchParams.get("sort_data[mode]")).toBe("relevancy_monthly_grouped")
    const all = new URL(buildAdLibrarySearchUrl({ ...searchArgs, period: "all" }, NOW))
    expect(all.searchParams.has("sort_data[direction]")).toBe(false)
  })

  it("adds the UI's publisher_platforms[] filter for a strict subset, nothing for none / all", () => {
    const some = new URL(buildAdLibrarySearchUrl({ ...searchArgs, platforms: ["INSTAGRAM", "FACEBOOK"] }, NOW))
    expect(some.searchParams.get("publisher_platforms[0]")).toBe("instagram")
    expect(some.searchParams.get("publisher_platforms[1]")).toBe("facebook")
    const none = new URL(buildAdLibrarySearchUrl({ ...searchArgs, platforms: [] }, NOW))
    expect(none.searchParams.has("publisher_platforms[0]")).toBe(false)
    const all = new URL(buildAdLibrarySearchUrl({ ...searchArgs, platforms: ["FACEBOOK", "INSTAGRAM", "AUDIENCE_NETWORK", "MESSENGER", "WHATSAPP", "THREADS"] }, NOW))
    expect(all.searchParams.has("publisher_platforms[0]")).toBe(false)
  })
})

describe("filterMetaAdsByPlatforms", () => {
  it("keeps ads delivered on at least one selected platform; empty / full selection keeps all", () => {
    const fb = projectMetaAds([rawAd({ ad_archive_id: "fb", publisher_platform: ["FACEBOOK"] })], 5)
    const ig = projectMetaAds([rawAd({ ad_archive_id: "ig", publisher_platform: ["INSTAGRAM", "THREADS"] })], 5)
    const ads = [...fb, ...ig]
    expect(filterMetaAdsByPlatforms(ads, ["THREADS"]).map((a) => a.adArchiveId)).toEqual(["ig"])
    expect(filterMetaAdsByPlatforms(ads, ["FACEBOOK", "INSTAGRAM"]).map((a) => a.adArchiveId)).toEqual(["fb", "ig"])
    expect(filterMetaAdsByPlatforms(ads, [])).toHaveLength(2)
    expect(filterMetaAdsByPlatforms(ads, undefined)).toHaveLength(2)
  })

  it("selectMetaAds applies the platform filter in pages mode too (the url hint only exists for search)", () => {
    const items = [
      rawAd({ ad_archive_id: "1", page_id: "A", publisher_platform: ["FACEBOOK"] }),
      rawAd({ ad_archive_id: "2", page_id: "A", publisher_platform: ["INSTAGRAM"] }),
    ]
    const picked = selectMetaAds(items, { count: 5, sources: 1, mode: "pages", period: "all", platforms: ["INSTAGRAM"] })
    expect(picked.map((a) => a.adArchiveId)).toEqual(["2"])
  })
})

describe("buildMetaAdsActorInput", () => {
  it("search mode → one Ad Library search url, over-fetched per-source cap for a period, dotted page keys", () => {
    const input = buildMetaAdsActorInput(searchArgs, NOW)
    expect(input.urls).toEqual([{ url: buildAdLibrarySearchUrl(searchArgs, NOW) }])
    // period = 7d → 5× over-fetch so the post-filter can still fill 20
    expect(input.limitPerSource).toBe(100)
    expect(input.scrapeAdDetails).toBe(false)
    expect(input["scrapePageAds.period"]).toBe("last7d")
    expect(input["scrapePageAds.activeStatus"]).toBe("active")
    expect(input["scrapePageAds.sortBy"]).toBe("most_recent")
    expect(input["scrapePageAds.countryCode"]).toBe("US")
    // The actor's TOTAL cap is deliberately not sent — we slice ourselves.
    expect(input).not.toHaveProperty("count")
  })

  it("pages mode → one url object per page, 'all' period is the empty enum member and no over-fetch", () => {
    const input = buildMetaAdsActorInput(pagesArgs, NOW)
    expect(input.urls).toEqual([
      { url: "https://www.facebook.com/nike" },
      { url: "https://www.facebook.com/adidas" },
    ])
    expect(input.limitPerSource).toBe(10)
    expect(input["scrapePageAds.period"]).toBe("")
    expect(input["scrapePageAds.countryCode"]).toBe("ALL")
  })

  it("over-fetches a keyword search by window (tighter = more), capped at the actor ceiling", () => {
    expect(actorLimitPerSource(20, "24h", "search")).toBe(160) // 20 × 8
    expect(actorLimitPerSource(20, "7d", "search")).toBe(100) // 20 × 5
    expect(actorLimitPerSource(20, "30d", "search")).toBe(60) // 20 × 3
    expect(actorLimitPerSource(100, "24h", "search")).toBe(300) // 800 capped at 300
    expect(actorLimitPerSource(100, "all", "search")).toBe(100)
    // pages honour scrapePageAds.period server-side — no headroom needed
    expect(actorLimitPerSource(100, "24h", "pages")).toBe(100)
  })
})

describe("filterMetaAdsByPeriod / selectMetaAds", () => {
  const inWindow = rawAd({ ad_archive_id: "new", start_date: Math.floor(new Date("2026-09-15T00:00:00Z").getTime() / 1000) })
  const outOfWindow = rawAd({ ad_archive_id: "old", start_date: Math.floor(new Date("2026-06-01T00:00:00Z").getTime() / 1000) })
  const undated = rawAd({ ad_archive_id: "undated", start_date: null })

  it("keeps only ads that started inside the window (a keyword search ignores the url's date filter)", () => {
    const ads = projectMetaAds([inWindow, outOfWindow, undated], 10)
    expect(filterMetaAdsByPeriod(ads, "7d", NOW).map((a) => a.adArchiveId)).toEqual(["new"])
    expect(filterMetaAdsByPeriod(ads, "all", NOW).map((a) => a.adArchiveId)).toEqual(["new", "old", "undated"])
  })

  it("search: filters THEN cuts to the paid-for count", () => {
    const items = [outOfWindow, inWindow, rawAd({ ad_archive_id: "new2", start_date: Math.floor(NOW.getTime() / 1000) })]
    const search = { mode: "search" as const, sources: 1, period: "30d" as const, now: NOW }
    expect(selectMetaAds(items, { ...search, count: 1 }).map((a) => a.adArchiveId)).toEqual(["new"])
    expect(selectMetaAds(items, { ...search, count: 5 })).toHaveLength(2)
  })

  it("pages: takes `count` PER PAGE so an over-delivering first page cannot eat the next page's quota", () => {
    const a = (id: string) => rawAd({ ad_archive_id: id, page_id: "A", page_name: "Page A" })
    const b = (id: string) => rawAd({ ad_archive_id: id, page_id: "B", page_name: "Page B" })
    const items = [a("a1"), a("a2"), a("a3"), a("a4"), a("a5"), b("b1"), b("b2"), b("b3")]
    const picked = selectMetaAds(items, { count: 2, sources: 2, mode: "pages", period: "all" })
    expect(picked.map((x) => x.adArchiveId)).toEqual(["a1", "a2", "b1", "b2"])
  })
})

describe("projectMetaAds", () => {
  it("normalizes one raw Ad Library record onto the output schema", () => {
    const [ad] = projectMetaAds([rawAd()], 10)
    expect(ad).toEqual({
      adArchiveId: "111",
      adLibraryUrl: "https://www.facebook.com/ads/library/?id=111",
      pageName: "Nike",
      pageId: "999",
      startDate: "2025-09-16T00:00:00.000Z",
      endDate: null,
      isActive: true,
      platforms: ["FACEBOOK", "INSTAGRAM"],
      text: "Just do it.",
      title: "Air Max",
      caption: "nike.com",
      ctaText: "Shop now",
      linkUrl: "https://nike.com/airmax",
      images: ["https://img/1.jpg"],
      videos: ["https://vid/1-hd.mp4"],
      videoPreviews: ["https://vid/1.jpg"],
      collationCount: 3,
    })
  })

  it("falls back to card creatives and tolerates a missing snapshot", () => {
    const carousel = rawAd({
      ad_archive_id: "222",
      snapshot: {
        body: {},
        cards: [
          { body: "Card copy", title: "Card title", cta_text: "Learn more", link_url: "https://x", original_image_url: "https://img/c1.jpg" },
          { video_sd_url: "https://vid/c2.mp4", video_preview_image_url: "https://vid/c2.jpg" },
        ],
      },
    })
    const bare = { ad_archive_id: 333, page_name: "Bare" }
    const [a, b] = projectMetaAds([carousel, bare], 10)
    expect(a.text).toBe("Card copy")
    expect(a.title).toBe("Card title")
    expect(a.ctaText).toBe("Learn more")
    expect(a.images).toEqual(["https://img/c1.jpg"])
    expect(a.videos).toEqual(["https://vid/c2.mp4"])
    expect(a.videoPreviews).toEqual(["https://vid/c2.jpg"])
    expect(b.adArchiveId).toBe("333")
    expect(b.text).toBe("")
    expect(b.images).toEqual([])
    expect(b.startDate).toBeNull()
    expect(b.isActive).toBe(false)
  })

  it("dedupes by archive id, drops records without one, and slices to the requested total", () => {
    const items = [
      rawAd({ ad_archive_id: "1" }),
      rawAd({ ad_archive_id: "1" }),
      { page_name: "no id" },
      rawAd({ ad_archive_id: "2" }),
      rawAd({ ad_archive_id: "3" }),
    ]
    expect(projectMetaAds(items, 2).map((a) => a.adArchiveId)).toEqual(["1", "2"])
  })
})

describe("runMetaAdsScrape", () => {
  it("calls the Meta actor with the built input and its waitSecs, then reads the dataset", async () => {
    // searchArgs has a 7-day window and the run uses the real clock → a fresh start date
    mocks.datasetListItems.mockResolvedValueOnce({ items: [rawAd({ start_date: Math.floor(Date.now() / 1000) - 3_600 })] })
    const result = await runMetaAdsScrape(searchArgs)
    expect(mocks.actorFn).toHaveBeenCalledWith(META_ADS_ACTOR.apifyActorId)
    expect(mocks.actorCall).toHaveBeenCalledWith(
      // searchArgs asks for 20 over a 7-day window → 5× over-fetch
      expect.objectContaining({ limitPerSource: 100, scrapeAdDetails: false }),
      // platform-side ceilings ride along: run timeout + the charged-items cap
      { waitSecs: META_ADS_ACTOR.timeoutSecs, timeout: META_ADS_ACTOR.timeoutSecs, maxItems: 100 },
    )
    expect(mocks.datasetFn).toHaveBeenCalledWith("ds-1")
    expect(result.json).toHaveLength(1)
    expect(result.json[0].adArchiveId).toBe("111")
  })

  it("pages mode: count per page, total capped at count × sources, charged items capped too", async () => {
    mocks.datasetListItems.mockResolvedValueOnce({
      // 15 ads per page from two pages — the actor over-delivered on both
      items: Array.from({ length: 30 }, (_, i) => rawAd({ ad_archive_id: String(i), page_id: i < 15 ? "p1" : "p2" })),
    })
    const result = await runMetaAdsScrape(pagesArgs) // 10 × 2 sources, period "all"
    expect(result.json).toHaveLength(20)
    expect(result.json.filter((a) => a.pageId === "p1")).toHaveLength(10)
    expect(mocks.actorCall).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ maxItems: 20 }))
  })

  it("a small request never sends a charged-items cap below the actor's floor (it would exit empty, credits spent)", async () => {
    mocks.datasetListItems.mockResolvedValueOnce({ items: [] })
    await runMetaAdsScrape({ ...searchArgs, count: 3, period: "all" }) // 3 × 1 source, no over-fetch → 3
    expect(mocks.actorCall).toHaveBeenCalledWith(
      expect.objectContaining({ limitPerSource: 3 }), // the actor still fetches only what was asked
      expect.objectContaining({ maxItems: META_ADS_ACTOR_MIN_CHARGED_RESULTS }),
    )
  })

  it("enforces the period on the fetched ads", async () => {
    const recent = Math.floor(Date.now() / 1000) - 3_600
    const stale = Math.floor(Date.now() / 1000) - 400 * 86_400
    mocks.datasetListItems.mockResolvedValueOnce({
      items: [rawAd({ ad_archive_id: "stale", start_date: stale }), rawAd({ ad_archive_id: "recent", start_date: recent })],
    })
    const result = await runMetaAdsScrape(searchArgs) // 7d
    expect(result.json.map((a) => a.adArchiveId)).toEqual(["recent"])
  })

  it("aborts a run that is still RUNNING at waitSecs and surfaces a timeout", async () => {
    mocks.actorCall.mockResolvedValueOnce({ id: "run-9", status: "RUNNING", defaultDatasetId: "ds-9" })
    await expect(runMetaAdsScrape(searchArgs)).rejects.toThrow(/timeout/)
    expect(mocks.runFn).toHaveBeenCalledWith("run-9")
    expect(mocks.runAbort).toHaveBeenCalledOnce()
    expect(mocks.datasetListItems).not.toHaveBeenCalled()
  })

  it("surfaces a FAILED run instead of returning an empty dataset as success", async () => {
    mocks.actorCall.mockResolvedValueOnce({ id: "run-2", status: "FAILED", defaultDatasetId: "ds-2" })
    await expect(runMetaAdsScrape(searchArgs)).rejects.toThrow(/FAILED/)
    expect(mocks.sanitizeApifyError).toHaveBeenCalledWith(expect.any(Error), "meta-ads-scrape")
    expect(mocks.datasetListItems).not.toHaveBeenCalled()
  })

  it("wraps SDK errors via sanitizeApifyError with the node context", async () => {
    mocks.actorCall.mockRejectedValueOnce(new Error("apify quota exceeded"))
    await expect(runMetaAdsScrape(searchArgs)).rejects.toThrow(/\[apify:meta-ads-scrape\] apify quota exceeded/)
  })

  it("lets a missing-key error through untouched", async () => {
    mocks.getApifyClient.mockImplementationOnce(() => {
      throw new MissingProviderKeyError("APIFY_API_TOKEN")
    })
    await expect(runMetaAdsScrape(searchArgs)).rejects.toBeInstanceOf(MissingProviderKeyError)
    expect(mocks.sanitizeApifyError).not.toHaveBeenCalled()
  })
})
