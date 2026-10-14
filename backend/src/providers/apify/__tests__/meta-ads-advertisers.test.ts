/**
 * Advertiser lookup provider — the actor's rows projected into our
 * vocabulary, the per-query cache (hits, empty answers, expiry, single-flight),
 * and the run lifecycle (abort a still-running run, surface FAILED, sanitize
 * errors, let a missing key through untouched).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

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

import { META_ADS_ADVERTISER_MAX_RESULTS } from "@nodaro/shared/social"
import { MissingProviderKeyError } from "../../provider-keys.js"
import {
  META_ADS_ADVERTISER_ACTOR,
  _resetMetaAdvertiserCacheForTests,
  normalizeAdvertiserQuery,
  projectMetaAdvertisers,
  searchMetaAdvertisers,
} from "../meta-ads-advertisers.js"

/** A row exactly as data-slayer/facebook-search-pages emits it (live capture 2026-09-17). */
function rawPage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "page",
    profile_url: "https://www.facebook.com/people/OpenArt-AI/61562658466287/",
    url: "https://www.facebook.com/people/OpenArt-AI/61562658466287/",
    image: { uri: "https://scontent.fbcdn.net/v/t39/451180718.png", width: 60, height: 60 },
    name: "OpenArt AI",
    facebook_id: "61562658466287",
    is_verified: true,
    ...overrides,
  }
}

describe("projectMetaAdvertisers", () => {
  it("maps the actor's row shape, keeps relevance order, drops non-pages and dupes, caps for the picker", () => {
    const rows = [
      rawPage(),
      rawPage({ facebook_id: "2", name: "Openart AI", is_verified: false, profile_url: "https://www.facebook.com/people/Openart-AI/2/" }),
      rawPage({ type: "person", facebook_id: "3", name: "A Person" }),
      rawPage({ facebook_id: "61562658466287", name: "dup of the first" }),
      rawPage({ facebook_id: "4", name: "Off-site", profile_url: "https://www.instagram.com/x", url: "https://www.instagram.com/x" }),
      ...Array.from({ length: 12 }, (_, i) => rawPage({ facebook_id: `1${i}`, name: `Page ${i}`, is_verified: false })),
    ]
    const out = projectMetaAdvertisers(rows)
    expect(out).toHaveLength(META_ADS_ADVERTISER_MAX_RESULTS)
    expect(out[0]).toEqual({
      pageId: "61562658466287",
      name: "OpenArt AI",
      url: "https://www.facebook.com/people/OpenArt-AI/61562658466287/",
      imageUrl: "https://scontent.fbcdn.net/v/t39/451180718.png",
      verified: true,
    })
    expect(out[1]).toEqual({ pageId: "2", name: "Openart AI", url: "https://www.facebook.com/people/Openart-AI/2/", imageUrl: "https://scontent.fbcdn.net/v/t39/451180718.png" })
    expect(out.map((a) => a.name)).not.toContain("A Person")
    expect(out.map((a) => a.name)).not.toContain("Off-site")
    expect(out.map((a) => a.name)).not.toContain("dup of the first")
  })

  it("normalizes the cache key", () => {
    expect(normalizeAdvertiserQuery("  OpenArt   AI ")).toBe("openart ai")
  })
})

describe("searchMetaAdvertisers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetMetaAdvertiserCacheForTests()
    mocks.datasetFn.mockReturnValue({ listItems: mocks.datasetListItems })
    mocks.actorFn.mockReturnValue({ call: mocks.actorCall })
    mocks.runFn.mockReturnValue({ abort: mocks.runAbort })
    mocks.getApifyClient.mockReturnValue({ actor: mocks.actorFn, dataset: mocks.datasetFn, run: mocks.runFn })
    mocks.actorCall.mockResolvedValue({ id: "run-1", status: "SUCCEEDED", defaultDatasetId: "ds-1" })
    mocks.runAbort.mockResolvedValue(undefined)
    mocks.sanitizeApifyError.mockImplementation((err: unknown) => (err instanceof Error ? err : new Error(String(err))))
  })

  it("calls the page-search actor with the query, a charged-items cap of at least 10, and reads the dataset", async () => {
    mocks.datasetListItems.mockResolvedValueOnce({ items: [rawPage()] })
    const out = await searchMetaAdvertisers(" OpenArt AI ")
    expect(mocks.actorFn).toHaveBeenCalledWith(META_ADS_ADVERTISER_ACTOR.apifyActorId)
    const [input, opts] = mocks.actorCall.mock.calls[0]
    expect(input).toEqual({ query: "OpenArt AI", maxPages: 1 })
    expect(opts).toMatchObject({ waitSecs: META_ADS_ADVERTISER_ACTOR.timeoutSecs, timeout: META_ADS_ADVERTISER_ACTOR.timeoutSecs })
    expect(opts.maxItems).toBeGreaterThanOrEqual(10)
    expect(out.cached).toBe(false)
    expect(out.items.map((a) => a.pageId)).toEqual(["61562658466287"])
  })

  it("serves a repeat query from the cache (case / spacing insensitive) and expires it", async () => {
    let clock = 1_000_000
    const now = () => clock
    mocks.datasetListItems.mockResolvedValue({ items: [rawPage()] })
    await searchMetaAdvertisers("OpenArt AI", now)
    const again = await searchMetaAdvertisers("openart  ai", now)
    expect(again.cached).toBe(true)
    expect(mocks.actorCall).toHaveBeenCalledTimes(1)
    clock += 7 * 60 * 60 * 1000 // past the 6 h hit TTL
    await searchMetaAdvertisers("OpenArt AI", now)
    expect(mocks.actorCall).toHaveBeenCalledTimes(2)
  })

  it("keeps an EMPTY answer too, but only briefly", async () => {
    let clock = 5_000_000
    const now = () => clock
    mocks.datasetListItems.mockResolvedValue({ items: [] })
    expect((await searchMetaAdvertisers("zzqx", now)).items).toEqual([])
    await searchMetaAdvertisers("zzqx", now)
    expect(mocks.actorCall).toHaveBeenCalledTimes(1)
    clock += 11 * 60 * 1000
    await searchMetaAdvertisers("zzqx", now)
    expect(mocks.actorCall).toHaveBeenCalledTimes(2)
  })

  it("two concurrent callers of the same query share ONE actor run (single-flight)", async () => {
    let release: (v: { id: string; status: string; defaultDatasetId: string }) => void = () => {}
    mocks.actorCall.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    mocks.datasetListItems.mockResolvedValue({ items: [rawPage()] })
    const first = searchMetaAdvertisers("Nike")
    const second = searchMetaAdvertisers("nike")
    release({ id: "run-9", status: "SUCCEEDED", defaultDatasetId: "ds-9" })
    const [a, b] = await Promise.all([first, second])
    expect(mocks.actorCall).toHaveBeenCalledTimes(1)
    expect(a.cached).toBe(false)
    expect(b.cached).toBe(true)
    expect(b.items).toEqual(a.items)
  })

  it("aborts a run that is still RUNNING at waitSecs and surfaces a timeout (nothing cached)", async () => {
    mocks.actorCall.mockResolvedValueOnce({ id: "run-2", status: "RUNNING", defaultDatasetId: "ds-2" })
    await expect(searchMetaAdvertisers("nike")).rejects.toThrow(/timeout/)
    expect(mocks.runAbort).toHaveBeenCalledTimes(1)
    mocks.datasetListItems.mockResolvedValueOnce({ items: [rawPage()] })
    await searchMetaAdvertisers("nike")
    expect(mocks.actorCall).toHaveBeenCalledTimes(2)
  })

  it("surfaces a FAILED run through the sanitizer and lets a missing key through untouched", async () => {
    mocks.actorCall.mockResolvedValueOnce({ id: "run-3", status: "FAILED", defaultDatasetId: "ds-3" })
    await expect(searchMetaAdvertisers("nike")).rejects.toThrow(/actor run FAILED/)
    expect(mocks.sanitizeApifyError).toHaveBeenCalledWith(expect.any(Error), "meta-ads-advertisers")
    const missing = new MissingProviderKeyError("apify" as never)
    mocks.getApifyClient.mockImplementationOnce(() => { throw missing })
    await expect(searchMetaAdvertisers("adidas")).rejects.toBe(missing)
  })
})
