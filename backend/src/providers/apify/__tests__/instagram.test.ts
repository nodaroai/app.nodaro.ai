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
vi.mock("../client.js", () => ({ getApifyClient: mocks.getApifyClient, sanitizeApifyError: mocks.sanitizeApifyError }))

import { MissingProviderKeyError } from "../../provider-keys.js"
import {
  INSTAGRAM_ACTOR,
  buildInstagramActorInput,
  instagramTargetUrl,
  projectInstagramPosts,
  selectInstagramPosts,
  runInstagramScrape,
} from "../instagram.js"

const NOW = new Date("2026-09-18T12:00:00.000Z")

function rawPost(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "p1",
    shortCode: "AbC",
    type: "Image",
    url: "https://www.instagram.com/p/AbC/",
    caption: "hello",
    ownerUsername: "nike",
    ownerFullName: "Nike",
    timestamp: "2026-09-17T00:00:00.000Z",
    likesCount: 100,
    commentsCount: 5,
    displayUrl: "https://cdn/i.jpg",
    videoUrl: null,
    dimensionsWidth: 1080,
    dimensionsHeight: 1350,
    inputUrl: "https://www.instagram.com/nike/",
    ...over,
  }
}

describe("instagramTargetUrl / buildInstagramActorInput", () => {
  it("profile → profile url, hashtag → explore/tags url, @ and # stripped", () => {
    expect(instagramTargetUrl("profile", "@nike")).toBe("https://www.instagram.com/nike/")
    expect(instagramTargetUrl("hashtag", "#running")).toBe("https://www.instagram.com/explore/tags/running/")
  })
  it("maps the period to onlyPostsNewerThan (server-side), omits for 'all'", () => {
    const week = buildInstagramActorInput({ mode: "profile", targets: ["nike"], count: 20, period: "7d" })
    expect(week.directUrls).toEqual(["https://www.instagram.com/nike/"])
    expect(week.resultsType).toBe("posts")
    expect(week.resultsLimit).toBe(20)
    expect(week.onlyPostsNewerThan).toBe("7 days")
    const all = buildInstagramActorInput({ mode: "hashtag", targets: ["running"], count: 10, period: "all" })
    expect(all.onlyPostsNewerThan).toBeUndefined()
    expect(all.directUrls).toEqual(["https://www.instagram.com/explore/tags/running/"])
  })
})

describe("projectInstagramPosts", () => {
  it("trims to the needed fields, maps type, flattens a carousel's children into images/videos", () => {
    const [img] = projectInstagramPosts([rawPost()], 10)
    expect(img).toMatchObject({ postId: "p1", type: "image", caption: "hello", ownerUsername: "nike", images: ["https://cdn/i.jpg"], videos: [], dimsWidth: 1080, dimsHeight: 1350 })
    const [vid] = projectInstagramPosts([rawPost({ id: "v", type: "Video", videoUrl: "https://cdn/v.mp4", displayUrl: "https://cdn/poster.jpg" })], 10)
    expect(vid).toMatchObject({ type: "video", videos: ["https://cdn/v.mp4"], videoPreviews: ["https://cdn/poster.jpg"], images: [] })
    const [car] = projectInstagramPosts([rawPost({
      id: "c", type: "Sidecar",
      childPosts: [{ displayUrl: "https://cdn/c1.jpg" }, { videoUrl: "https://cdn/c2.mp4", displayUrl: "https://cdn/c2poster.jpg" }],
    })], 10)
    expect(car.type).toBe("carousel")
    expect(car.images).toEqual(["https://cdn/c1.jpg"])
    expect(car.videos).toEqual(["https://cdn/c2.mp4"])
    expect(car.videoPreviews).toEqual(["https://cdn/c2poster.jpg"])
  })
  it("dedupes by post id", () => {
    expect(projectInstagramPosts([rawPost(), rawPost()], 10)).toHaveLength(1)
  })
})

describe("selectInstagramPosts", () => {
  it("drops posts outside the window and enforces a per-source (inputUrl) quota + total cap", () => {
    const stale = rawPost({ id: "s", shortCode: "S", timestamp: "2026-01-01T00:00:00.000Z" })
    const items = [
      rawPost({ id: "a", shortCode: "A", inputUrl: "u1" }),
      rawPost({ id: "b", shortCode: "B", inputUrl: "u1" }),
      rawPost({ id: "c", shortCode: "C", inputUrl: "u2" }),
      stale,
    ]
    // period 7d drops the January post; count 1 per source → one from u1, one from u2.
    const out = selectInstagramPosts(items, { count: 1, sources: 2, period: "7d", mode: "profile", now: NOW })
    expect(out.map((p) => p.postId)).toEqual(["a", "c"])
  })

  it("keys the per-source quota on OWNER in profile mode when inputUrl is missing (no under-delivery)", () => {
    // Two profiles, count 2 each, but the actor omitted inputUrl on every item.
    // Owner-keyed → the run delivers count × sources; the old inputUrl-only path
    // collapsed all four into one "?" bucket capped at count (2) and lost half.
    const items = [
      rawPost({ id: "n1", shortCode: "N1", ownerUsername: "nike", inputUrl: undefined }),
      rawPost({ id: "n2", shortCode: "N2", ownerUsername: "nike", inputUrl: undefined }),
      rawPost({ id: "a1", shortCode: "A1", ownerUsername: "adidas", inputUrl: undefined }),
      rawPost({ id: "a2", shortCode: "A2", ownerUsername: "adidas", inputUrl: undefined }),
    ]
    const out = selectInstagramPosts(items, { count: 2, sources: 2, period: "all", mode: "profile", now: NOW })
    expect(out.map((p) => p.postId).sort()).toEqual(["a1", "a2", "n1", "n2"])
  })

  it("hashtag mode leaves items unkeyed when inputUrl is missing (total cap only, still no under-delivery)", () => {
    // One dominant owner under a tag; hashtag mode must NOT owner-cap (that would
    // trim to count). Unkeyed → bounded only by count × sources.
    const items = [
      rawPost({ id: "h1", shortCode: "H1", ownerUsername: "acme", inputUrl: undefined }),
      rawPost({ id: "h2", shortCode: "H2", ownerUsername: "acme", inputUrl: undefined }),
      rawPost({ id: "h3", shortCode: "H3", ownerUsername: "acme", inputUrl: undefined }),
    ]
    const out = selectInstagramPosts(items, { count: 2, sources: 2, period: "all", mode: "hashtag", now: NOW })
    expect(out.map((p) => p.postId)).toEqual(["h1", "h2", "h3"])
  })
})

describe("runInstagramScrape", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.datasetFn.mockReturnValue({ listItems: mocks.datasetListItems })
    mocks.actorFn.mockReturnValue({ call: mocks.actorCall })
    mocks.runFn.mockReturnValue({ abort: mocks.runAbort })
    mocks.getApifyClient.mockReturnValue({ actor: mocks.actorFn, dataset: mocks.datasetFn, run: mocks.runFn })
    mocks.actorCall.mockResolvedValue({ id: "r1", status: "SUCCEEDED", defaultDatasetId: "ds-1" })
    mocks.runAbort.mockResolvedValue(undefined)
    mocks.sanitizeApifyError.mockImplementation((e: unknown) => (e instanceof Error ? e : new Error(String(e))))
  })

  it("calls the actor and returns projected posts", async () => {
    // A post from a day ago — inside "7d" on any date. A fixed date here aged
    // out of the window on 2026-09-25 and failed every run after it.
    const aDayAgo = new Date(Date.now() - 24 * 3_600_000).toISOString()
    mocks.datasetListItems.mockResolvedValueOnce({ items: [rawPost({ timestamp: aDayAgo })] })
    const res = await runInstagramScrape({ mode: "profile", targets: ["nike"], count: 3, period: "7d" })
    expect(mocks.actorFn).toHaveBeenCalledWith(INSTAGRAM_ACTOR.apifyActorId)
    expect(res.json).toHaveLength(1)
    expect(res.json[0].ownerUsername).toBe("nike")
  })
  it("aborts a still-RUNNING run and surfaces a timeout; lets a missing key through", async () => {
    mocks.actorCall.mockResolvedValueOnce({ id: "r2", status: "RUNNING", defaultDatasetId: "ds-2" })
    await expect(runInstagramScrape({ mode: "profile", targets: ["nike"], count: 3, period: "all" })).rejects.toThrow(/timeout/)
    expect(mocks.runAbort).toHaveBeenCalledTimes(1)
    const missing = new MissingProviderKeyError("apify" as never)
    mocks.getApifyClient.mockImplementationOnce(() => { throw missing })
    await expect(runInstagramScrape({ mode: "profile", targets: ["nike"], count: 3, period: "all" })).rejects.toBe(missing)
  })
})
