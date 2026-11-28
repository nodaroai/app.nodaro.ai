/**
 * The daily run (run.ts) over an in-memory store: a sitemap's first read is
 * the baseline (no candidates), its next read makes a candidate of each new
 * template page; every open candidate gets one search, one reading, a status
 * and a label; the first reading at the creator threshold announces on
 * Slack; the search budget and a missing runner skip, never throw; a failed
 * source or search is noted and the run goes on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { SocialPost } from "@nodaro/shared/social"

const mem = vi.hoisted(() => ({
  settings: {
    thresholds: { minCreators: 5, windowDays: 21, risingPct: 15, slowingPct: 1, maxClipSec: 30, dailySearchBudget: 60 },
    alerts: { slackNewCandidate: true, slackDailySummary: false },
    retentionDays: 90,
    runAt: "06:00",
    runnerUserId: "runner" as string | null,
    lastRun: null as unknown,
    lastRunDate: null as string | null,
    searchesDate: null as string | null,
    searchesToday: 0,
  },
  sources: [] as Array<Record<string, unknown>>,
  candidates: new Map<string, Record<string, unknown>>(),
  readings: new Map<string, Array<{ date: string; creators: number; plays: number; posts: number; growthPct: number | null }>>(),
  pruned: 0,
  apply(id: string, update: Record<string, unknown>) {
    const row = [...mem.candidates.values()].find((c) => c.id === id)!
    const { event, ...rest } = update
    // The real store writes snake_case columns; mirror the ones the run reads back.
    const columns: Record<string, string> = { soundName: "sound_name", durationSec: "duration_sec", dayChangePct: "day_change_pct", topPost: "top_post", passedAt: "passed_at", rejectReason: "reject_reason", trendId: "trend_id", creatorsCapped: "creators_capped", firstPostedAt: "first_posted_at", lastReadAt: "last_read_at" }
    for (const [k, v] of Object.entries(rest)) row[columns[k] ?? k] = v
    if (event) row.history = [...(row.history as unknown[]), event]
    return row
  },
}))

vi.mock("../store.js", () => ({
  readSettings: vi.fn(async () => ({ ...mem.settings })),
  writeSettings: vi.fn(async (patch: Record<string, unknown>) => {
    Object.assign(mem.settings, patch)
    return { ...mem.settings }
  }),
  countSearch: vi.fn(async (today: string) => {
    mem.settings.searchesToday = mem.settings.searchesDate === today ? mem.settings.searchesToday + 1 : 1
    mem.settings.searchesDate = today
    return mem.settings.searchesToday
  }),
  listSources: vi.fn(async () => mem.sources.map((s) => ({ ...s }))),
  markSourceRead: vi.fn(async (id: string, read: Record<string, unknown>) => {
    const s = mem.sources.find((x) => x.id === id)!
    Object.assign(s, { lastReadAt: new Date().toISOString(), pages: read.pages, newToday: read.newToday, lastError: read.lastError, ...(read.seenSlugs ? { seenSlugs: read.seenSlugs } : {}) })
  }),
  upsertCandidate: vi.fn(async (input: { name: string; slug: string; firstSeen: { name: string } }) => {
    const existing = mem.candidates.get(input.slug)
    if (existing) return existing
    const row = { id: `id-${input.slug}`, name: input.name, slug: input.slug, status: "watching", label: "new", sound_name: null, duration_sec: null, search: null, first_seen_name: input.firstSeen.name, created_at: new Date().toISOString(), history: [] }
    mem.candidates.set(input.slug, row)
    return row
  }),
  listOpenCandidates: vi.fn(async () => [...mem.candidates.values()].filter((c) => ["watching", "candidate", "slowing"].includes(c.status as string))),
  writeReading: vi.fn(async (id: string, reading: { day: string; creators: number; plays: number; posts: number; growthPct?: number | null }) => {
    const list = (mem.readings.get(id) ?? []).filter((r) => r.date !== reading.day)
    list.push({ date: reading.day, creators: reading.creators, plays: reading.plays, posts: reading.posts, growthPct: reading.growthPct ?? null })
    list.sort((a, b) => a.date.localeCompare(b.date))
    mem.readings.set(id, list)
    return list
  }),
  listReadings: vi.fn(async (id: string) => [...(mem.readings.get(id) ?? [])]),
  updateCandidate: vi.fn(async (id: string, update: Record<string, unknown>) => mem.apply(id, update)),
  // The run's write lands only while the row is still open, like the real store's conditional update.
  updateOpenCandidate: vi.fn(async (id: string, update: Record<string, unknown>) => {
    const row = [...mem.candidates.values()].find((c) => c.id === id)
    if (!row || !["watching", "candidate", "slowing"].includes(row.status as string)) return null
    return mem.apply(id, update)
  }),
  pruneReadings: vi.fn(async () => {
    mem.pruned += 1
  }),
}))

import { OUT_OF_CREDITS_STOP, RADAR_SEARCHES, RunnerOutOfCreditsError, makeSearch, readingOrder, runDue, runTrendRadar } from "../run.js"
import { STILL_PREFIX, isKeptStill, keepStill, keptStills, stillKey, withKeptStill } from "../stills.js"
import { r2Url } from "../../../../lib/storage.js"

const SITEMAP = `<urlset><url><loc>https://a.test/templates/phone-on-train-ai-trend</loc><lastmod>2026-11-01</lastmod></url><url><loc>https://a.test/templates/tiny-desk</loc><lastmod>2026-10-30</lastmod></url><url><loc>https://a.test/blog/news</loc></url></urlset>`

function posts(creators: number, playsEach = 1000, platform: "tiktok" | "instagram" | "youtube" = "tiktok"): SocialPost[] {
  return Array.from({ length: creators }, (_, i) => ({
    id: `${platform}:${i}`,
    platform,
    url: platform === "tiktok" ? `https://www.tiktok.com/@u${i}/video/730000000000000000${i}` : platform === "instagram" ? `https://www.instagram.com/reel/C${i}/` : `https://www.youtube.com/shorts/s${i}`,
    text: "x",
    author: { handle: `u${i}`, name: `u${i}` },
    metrics: { views: playsEach },
    media: { kind: "video" as const, durationSec: 10 },
    hashtags: [],
    extra: { sound: "subway remix" },
  }))
}

/** A search that answers on TikTok only (Instagram and YouTube find nothing). */
function onTiktok(list: () => SocialPost[]) {
  return vi.fn(async (_query: string, _runner: string, platform: string) => (platform === "tiktok" ? list() : []))
}

/** An open candidate row as the store lists it (with migration 735's columns). */
function openRow(slug: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: `id-${slug}`, name: slug, slug, status: "watching", label: "new", sound_name: null, duration_sec: null, search: null, first_seen_name: "x", created_at: "2026-11-01T00:00:00Z", history: [], last_read_at: null, panel: null, first_posted_at: null, ...over }
}

const now = () => new Date("2026-11-02T04:30:00Z") // 06:30 Israel time

beforeEach(() => {
  mem.settings.runnerUserId = "runner"
  mem.settings.thresholds.dailySearchBudget = 60
  mem.settings.alerts.slackNewCandidate = true
  mem.settings.searchesDate = null
  mem.settings.searchesToday = 0
  mem.settings.lastRunDate = null
  mem.sources = [{ id: "s1", name: "Site A", kind: "sitemap", url: "https://a.test/sitemap.xml", enabled: true, lastReadAt: null, seenSlugs: [] }]
  mem.candidates = new Map()
  mem.readings = new Map()
  mem.pruned = 0
})

describe("runTrendRadar", () => {
  it("the first read of a source is the baseline; the next read makes candidates of new pages and reads them", async () => {
    const fetchText = vi.fn(async () => SITEMAP)
    const search = onTiktok(() => posts(3))
    const notify = vi.fn(async () => undefined)
    const first = await runTrendRadar({ fetchText, search, notify, suggests: async () => null, now })
    expect(first.sourcesRead).toBe(1)
    expect(mem.candidates.size).toBe(0)
    expect(mem.sources[0]!.newToday).toBe(0)
    // Only template pages are remembered: the blog page is not one.
    expect(mem.sources[0]!.seenSlugs).toEqual(["phone-on-train-ai-trend", "tiny-desk"])
    expect(search).not.toHaveBeenCalled()

    // A new page appears on the next read.
    fetchText.mockResolvedValue(`${SITEMAP.replace("</urlset>", "")}<url><loc>https://a.test/templates/dog-bartender-ai-trend</loc><lastmod>2026-11-02</lastmod></url></urlset>`)
    const second = await runTrendRadar({ fetchText, search, notify, suggests: async () => null, now })
    expect([...mem.candidates.keys()]).toEqual(["dog-bartender"])
    expect(mem.sources[0]!.newToday).toBe(1)
    // One search per platform, each for as many posts as it may return.
    expect(search.mock.calls).toEqual([
      ["dog bartender ai", "runner", "tiktok", 60, "popular"],
      ["dog bartender ai", "runner", "instagram", 60, "popular"],
      ["dog bartender ai", "runner", "youtube", 20, "popular"],
    ])
    expect(second.searchesUsed).toBe(3)
    expect(second.candidatesRead).toBe(1)
    const c = mem.candidates.get("dog-bartender")!
    expect(c.status).toBe("watching")
    expect(c.label).toBe("new")
    expect(c.creators).toBe(3)
    expect(c.plays).toBe(3000)
    expect(c.sound_name).toBe("subway remix")
    expect(mem.readings.get("id-dog-bartender")).toEqual([{ date: "2026-11-02", creators: 3, plays: 3000, posts: 3, growthPct: null }])
    expect(c.platforms).toEqual({ tiktok: { posts: 3, creators: 3, plays: 3000, capped: false, top: expect.objectContaining({ platform: "tiktok" }) } })
    expect(c.creators_capped).toBe(false)
    expect(c.last_read_at).toBe(now().toISOString())
    expect(c.panel).toEqual({ "tiktok:0": 1000, "tiktok:1": 1000, "tiktok:2": 1000 })
    expect(notify).not.toHaveBeenCalled()
    expect(mem.settings.lastRunDate).toBe("2026-11-02")
    expect(mem.pruned).toBe(2)
    // The latest listing comes first in what is remembered.
    expect(mem.sources[0]!.seenSlugs).toEqual(["phone-on-train-ai-trend", "tiny-desk", "dog-bartender-ai-trend"])
  })

  it("a source that lists more new pages than the day's share leaves the rest for the next read", async () => {
    const page = (i: number) => `<url><loc>https://a.test/templates/cat-dance-${String(i).padStart(3, "0")}</loc></url>`
    const urls = (n: number) => `<urlset>${Array.from({ length: n }, (_, i) => page(i)).join("")}</urlset>`
    mem.sources[0]!.seenSlugs = ["baseline-done"]
    const search = vi.fn(async () => posts(1))
    await runTrendRadar({ fetchText: async () => urls(30), search, suggests: async () => null, notify: async () => undefined, now })
    expect(mem.candidates.size).toBe(25)
    expect(mem.sources[0]!.newToday).toBe(25)
    const seen = mem.sources[0]!.seenSlugs as string[]
    expect(seen).toHaveLength(26)
    expect(seen).not.toContain("cat-dance-025")
    expect(seen).toContain("cat-dance-024")
    // The next read takes the five that waited, and nothing twice.
    await runTrendRadar({ fetchText: async () => urls(30), search, suggests: async () => null, notify: async () => undefined, now })
    expect(mem.candidates.size).toBe(30)
    expect(mem.sources[0]!.newToday).toBe(5)
    expect((mem.sources[0]!.seenSlugs as string[]).filter((s) => s.startsWith("cat-dance-"))).toHaveLength(30)
  })

  it("a catalog larger than the memory cap forgets only pages it no longer lists", async () => {
    // What was remembered before is placed after today's listing, so the
    // oldest-remembered-but-still-listed pages are never evicted into "new".
    const page = (i: number) => `<url><loc>https://a.test/templates/t-${i}</loc></url>`
    const listing = `<urlset>${Array.from({ length: 10 }, (_, i) => page(i)).join("")}</urlset>`
    mem.sources[0]!.seenSlugs = Array.from({ length: 10 }, (_, i) => `t-${i}`)
    await runTrendRadar({ fetchText: async () => listing, search: async () => posts(1), suggests: async () => null, notify: async () => undefined, now })
    expect(mem.candidates.size).toBe(0)
    expect((mem.sources[0]!.seenSlugs as string[]).slice(0, 10)).toEqual(Array.from({ length: 10 }, (_, i) => `t-${i}`))
  })

  it("an admin's decision during the run stays: the run's write lands only on an open candidate", async () => {
    mem.sources = []
    mem.candidates.set("a", { id: "id-a", name: "a", slug: "a", status: "watching", label: "new", sound_name: null, duration_sec: null, search: null, first_seen_name: "x", created_at: "2026-11-01T00:00:00Z", history: [] })
    // The admin approves while the search is out.
    const search = vi.fn(async () => {
      mem.candidates.get("a")!.status = "approved"
      mem.candidates.get("a")!.trend_id = "trend-a"
      return posts(2)
    })
    const report = await runTrendRadar({ search, suggests: async () => null, notify: async () => undefined, now })
    expect(mem.candidates.get("a")!.status).toBe("approved")
    expect(mem.candidates.get("a")!.trend_id).toBe("trend-a")
    expect(report.candidatesRead).toBe(0)
    expect(report.skipped).toEqual([{ what: "candidate a", why: "decided by an admin during the run" }])
    // The day's reading was still kept.
    expect(mem.readings.get("id-a")).toHaveLength(1)
  })

  it("the first reading at the threshold passes the candidate, checks search and announces once", async () => {
    mem.sources = []
    mem.candidates.set("tiny-desk", { id: "id-tiny-desk", name: "tiny desk", slug: "tiny-desk", status: "watching", label: "new", sound_name: null, duration_sec: null, search: null, first_seen_name: "Site A", created_at: "2026-11-01T00:00:00Z", history: [] })
    mem.readings.set("id-tiny-desk", [{ date: "2026-11-01", creators: 4, plays: 1000, posts: 4, growthPct: null }])
    const notify = vi.fn<(text: string) => Promise<void>>(async () => undefined)
    const suggests = vi.fn(async () => true)
    const report = await runTrendRadar({ search: onTiktok(() => posts(6, 250)), notify, suggests, now })
    expect(report.skipped).toEqual([])
    const c = mem.candidates.get("tiny-desk")!
    expect(c.status).toBe("candidate")
    expect(c.label).toBe("rising")
    expect(c.passed_at).toBeTruthy()
    expect(c.search).toEqual({ suggest: true, interest7d: null, checkedAt: now().toISOString() })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(String(notify.mock.calls[0]![0])).toContain("tiny desk")
    expect(String(notify.mock.calls[0]![0])).toContain("6 creators")

    // The next day it is still over the threshold: no second announcement.
    await runTrendRadar({ search: onTiktok(() => posts(7, 260)), notify, suggests, now: () => new Date("2026-11-03T04:30:00Z") })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(mem.candidates.get("tiny-desk")!.status).toBe("candidate")
  })

  it("a missing runner and a spent budget skip the searches; a failed source or search is noted and the run goes on", async () => {
    mem.candidates.set("a", { id: "id-a", name: "a", slug: "a", status: "watching", label: "new", sound_name: null, duration_sec: null, search: null, first_seen_name: "x", created_at: "2026-11-01T00:00:00Z", history: [] })
    mem.candidates.set("b", { id: "id-b", name: "b", slug: "b", status: "watching", label: "new", sound_name: null, duration_sec: null, search: null, first_seen_name: "x", created_at: "2026-11-01T00:00:01Z", history: [] })
    mem.settings.runnerUserId = null
    const search = vi.fn(async (_q: string, _r: string, _p: string) => posts(1))
    let report = await runTrendRadar({ fetchText: async () => { throw new Error("HTTP 403") }, search, suggests: async () => null, notify: async () => undefined, now })
    expect(search).not.toHaveBeenCalled()
    expect(report.skipped.map((s) => s.why)).toEqual(["HTTP 403", "no runner: save the settings as an admin once", "no runner: save the settings as an admin once"])
    expect(mem.sources[0]!.lastError).toBe("HTTP 403")

    mem.candidates.set("c", { id: "id-c", name: "c", slug: "c", status: "watching", label: "new", sound_name: null, duration_sec: null, search: null, first_seen_name: "x", created_at: "2026-11-01T00:00:02Z", history: [] })
    mem.settings.runnerUserId = "runner"
    mem.settings.thresholds.dailySearchBudget = 5
    search.mockRejectedValueOnce(new Error("social search failed: provider down"))
    search.mockRejectedValueOnce(new Error("social search failed: provider down"))
    search.mockRejectedValueOnce(new Error("social search failed: provider down"))
    report = await runTrendRadar({ fetchText: async () => SITEMAP, search, suggests: async () => null, notify: async () => undefined, now })
    // Newest first: c's three searches all fail (noted, and they spent the
    // budget — a failing provider must not read every candidate for free);
    // the two searches left cannot read b whole, so b and a wait for tomorrow.
    expect(search).toHaveBeenCalledTimes(3)
    expect(report.searchesUsed).toBe(3)
    expect(mem.settings.searchesToday).toBe(3)
    expect(report.skipped.map((s) => s.what)).toEqual(["candidate c", "candidate b", "candidate a"])
    expect(report.skipped[0]!.why).toContain("provider down")
    expect(report.skipped[1]!.why).toBe("daily search budget spent")
    expect((mem.candidates.get("c")!.history as Array<{ event: string }>)[0]!.event).toBe("read_failed")
    expect(mem.readings.get("id-b")).toBeUndefined()
  })

  it("searches TikTok and Instagram for 60 posts and YouTube for 20, the counts of the shared table", () => {
    expect(RADAR_SEARCHES).toEqual([
      { platform: "tiktok", count: 60 },
      { platform: "instagram", count: 60 },
      { platform: "youtube", count: 20 },
    ])
  })

  it("reads a candidate only when the budget covers all of its searches", async () => {
    mem.sources = []
    mem.candidates.set("a", openRow("a", { created_at: "2026-11-01T00:00:00Z" }))
    mem.candidates.set("b", openRow("b", { created_at: "2026-11-01T00:00:01Z" }))
    mem.settings.thresholds.dailySearchBudget = 5
    const search = onTiktok(() => posts(2))
    const report = await runTrendRadar({ search, suggests: async () => null, notify: async () => undefined, now })
    expect(search).toHaveBeenCalledTimes(3)
    expect(report.candidatesRead).toBe(1)
    expect(report.skipped).toEqual([{ what: "candidate a", why: "daily search budget spent" }])
  })

  it("reads never-read candidates first, newest first, then the longest unread", async () => {
    mem.sources = []
    mem.candidates.set("old-read", openRow("old-read", { created_at: "2026-10-01T00:00:00Z", last_read_at: "2026-10-30T04:00:00Z" }))
    mem.candidates.set("new-read", openRow("new-read", { created_at: "2026-10-02T00:00:00Z", last_read_at: "2026-10-31T04:00:00Z" }))
    mem.candidates.set("never-old", openRow("never-old", { created_at: "2026-10-20T00:00:00Z" }))
    mem.candidates.set("never-new", openRow("never-new", { created_at: "2026-10-25T00:00:00Z" }))
    mem.settings.thresholds.dailySearchBudget = 9
    const search = onTiktok(() => posts(1))
    const report = await runTrendRadar({ search, suggests: async () => null, notify: async () => undefined, now })
    const read = search.mock.calls.filter((call) => call[2] === "tiktok").map((call) => call[0])
    expect(read).toEqual(["never-new ai", "never-old ai", "old-read ai"])
    expect(report.skipped).toEqual([{ what: "candidate new-read", why: "daily search budget spent" }])
  })

  it("readingOrder keeps newest first for rows without last_read_at (a database before migration 735)", () => {
    const rows = [
      { slug: "a", created_at: "2026-10-01T00:00:00Z" },
      { slug: "b", created_at: "2026-10-03T00:00:00Z" },
      { slug: "c", created_at: "2026-10-02T00:00:00Z" },
    ]
    expect(readingOrder(rows).map((r) => r.slug)).toEqual(["b", "c", "a"])
    expect(readingOrder([])).toEqual([])
  })

  it("measures growth on the same posts across readings two days apart, not on the summed search answer", async () => {
    mem.sources = []
    mem.candidates.set("cat", openRow("cat"))
    await runTrendRadar({ search: onTiktok(() => posts(3, 1000)), suggests: async () => null, notify: async () => undefined, now })
    expect(mem.candidates.get("cat")!.panel).toEqual({ "tiktok:0": 1000, "tiktok:1": 1000, "tiktok:2": 1000 })
    // Two days later the same three posts have 1,440 plays each (+20% a day,
    // compounded) and the search also answers a big unrelated post: the summed
    // plays jump, the growth on the same posts does not.
    const later = () => [...posts(3, 1440), { ...posts(1, 5_000_000)[0]!, id: "tiktok:big", url: "https://www.tiktok.com/@big/video/7399999999999999999", author: { handle: "big", name: "big" } }]
    await runTrendRadar({ search: onTiktok(later), suggests: async () => null, notify: async () => undefined, now: () => new Date("2026-11-04T04:30:00Z") })
    const readings = mem.readings.get("id-cat")!
    expect(readings.map((r) => [r.date, r.growthPct])).toEqual([
      ["2026-11-02", null],
      ["2026-11-04", 20],
    ])
    const c = mem.candidates.get("cat")!
    expect(c.day_change_pct).toBe(20)
    expect(c.label).toBe("rising")
    expect(c.panel).toEqual({ "tiktok:0": 1440, "tiktok:1": 1440, "tiktok:2": 1440, "tiktok:big": 5_000_000 })
  })

  it("a second read on the same day keeps the growth the first one measured", async () => {
    mem.sources = []
    mem.candidates.set("cat", openRow("cat", { last_read_at: "2026-11-01T04:30:00Z", panel: { "tiktok:0": 1000 } }))
    mem.readings.set("id-cat", [{ date: "2026-11-01", creators: 1, plays: 1000, posts: 1, growthPct: null }])
    await runTrendRadar({ search: onTiktok(() => posts(1, 1100)), suggests: async () => null, notify: async () => undefined, now })
    expect(mem.readings.get("id-cat")!.at(-1)).toEqual(expect.objectContaining({ date: "2026-11-02", growthPct: 10 }))
    // "Run now" later that day: the stored panel is today's own.
    await runTrendRadar({ search: onTiktok(() => posts(1, 1101)), suggests: async () => null, notify: async () => undefined, now: () => new Date("2026-11-02T10:00:00Z") })
    expect(mem.readings.get("id-cat")!.at(-1)).toEqual(expect.objectContaining({ date: "2026-11-02", growthPct: 10 }))
  })

  it("one platform failing keeps the others; the failure is noted with its platform", async () => {
    mem.sources = []
    mem.candidates.set("a", openRow("a"))
    const search = vi.fn(async (_q: string, _r: string, platform: string) => {
      if (platform === "instagram") throw new Error("instagram is down")
      return platform === "tiktok" ? posts(2, 100) : posts(1, 50, "youtube")
    })
    const report = await runTrendRadar({ search, suggests: async () => null, notify: async () => undefined, now })
    expect(report.candidatesRead).toBe(1)
    expect(report.searchesUsed).toBe(3)
    expect(report.skipped).toEqual([{ what: "candidate a (instagram)", why: "instagram is down" }])
    const c = mem.candidates.get("a")!
    expect(Object.keys(c.platforms as object)).toEqual(["tiktok", "youtube"])
    expect(c.creators).toBe(3)
    expect(c.plays).toBe(250)
    expect(c.history).toEqual([])
  })

  it("a search that returns its most posts marks the platform, and the candidate, capped", async () => {
    mem.sources = []
    mem.candidates.set("a", openRow("a"))
    const notify = vi.fn<(text: string) => Promise<void>>(async () => undefined)
    const search = vi.fn(async (_q: string, _r: string, platform: string, _count?: number, _sort?: string) => (platform === "tiktok" ? posts(60, 10) : platform === "youtube" ? posts(5, 10, "youtube") : []))
    await runTrendRadar({ search, suggests: async () => null, notify, now })
    const c = mem.candidates.get("a")!
    expect((c.platforms as Record<string, { capped: boolean }>).tiktok!.capped).toBe(true)
    expect((c.platforms as Record<string, { capped: boolean }>).youtube!.capped).toBe(false)
    expect(c.creators_capped).toBe(true)
    expect(c.creators).toBe(65)
    // Passing the threshold says the count is a floor.
    expect(String(notify.mock.calls[0]![0])).toContain("65+ creators")
    // The deeper count asked TikTok once more, found nothing new, and stopped there.
    expect(search.mock.calls.map((call) => [call[2], call[4]])).toEqual([
      ["tiktok", "popular"],
      ["instagram", "popular"],
      ["youtube", "popular"],
      ["tiktok", "newest"],
    ])
  })

  it("counts a big trend's people past one search's ceiling: a full platform is searched again in other orders, each post counted once", async () => {
    mem.sources = []
    mem.candidates.set("a", openRow("a"))
    const search = vi.fn(async (_q: string, _r: string, platform: string, _count: number, sort: string) => {
      if (platform !== "tiktok") return []
      if (sort === "popular") return from(0, 60)
      if (sort === "newest") return from(40, 60) // 20 seen already, 40 new
      return from(90, 30) // the last order is not full: the count is whole
    })
    const report = await runTrendRadar({ search, suggests: async () => null, notify: async () => undefined, now })
    expect(report.searchesUsed).toBe(5)
    const c = mem.candidates.get("a")!
    expect(c.creators).toBe(120)
    expect(c.creators_capped).toBe(false)
    expect((c.platforms as Record<string, { posts: number; capped: boolean }>).tiktok).toEqual(expect.objectContaining({ posts: 120, capped: false }))
    expect(mem.readings.get("id-a")!.at(-1)).toEqual(expect.objectContaining({ creators: 120, posts: 120 }))
  })

  it("the deeper count spends only what the day's budget has left", async () => {
    mem.sources = []
    mem.candidates.set("a", openRow("a"))
    mem.settings.thresholds.dailySearchBudget = 4
    const search = vi.fn(async (_q: string, _r: string, platform: string, _count: number, sort: string) => (platform === "tiktok" ? from(sort === "popular" ? 0 : 60, 60) : []))
    const report = await runTrendRadar({ search, suggests: async () => null, notify: async () => undefined, now })
    expect(report.searchesUsed).toBe(4)
    const c = mem.candidates.get("a")!
    expect(c.creators).toBe(120)
    expect(c.creators_capped).toBe(true)
  })
})

/** `n` TikTok posts by `n` creators, numbered from `start`. */
function from(start: number, n: number): SocialPost[] {
  return posts(n).map((p, i) => ({ ...p, id: `tiktok:${start + i}`, url: `https://www.tiktok.com/@u${start + i}/video/74${String(start + i).padStart(17, "0")}`, author: { handle: `u${start + i}`, name: `u${start + i}` } }))
}

describe("runDue", () => {
  it("is due once the run time has passed today and no run was recorded today", () => {
    expect(runDue({ runAt: "06:00", lastRunDate: null }, new Date("2026-11-02T04:30:00Z"))).toBe(true)
    expect(runDue({ runAt: "06:00", lastRunDate: "2026-11-02" }, new Date("2026-11-02T04:30:00Z"))).toBe(false)
    expect(runDue({ runAt: "06:00", lastRunDate: "2026-11-01" }, new Date("2026-11-02T03:30:00Z"))).toBe(false)
    expect(runDue({ runAt: "06:00", lastRunDate: "2026-11-01" }, new Date("2026-11-02T04:00:00Z"))).toBe(true)
  })
})

describe("kept stills", () => {
  it("the run keeps each top post's still and points the card, its posts and its platforms at the copy; a copy kept earlier is reused", async () => {
    const withStills = (): SocialPost[] => posts(3, 1000).map((p, i) => ({ ...p, metrics: { views: 1000 * (3 - i) }, media: { ...p.media, thumbnailUrl: `https://p16.tiktokcdn.test/still-${i}.jpeg` } }))
    const answers = withStills()
    const earlierUrl = answers[1]!.url
    const earlierKept = r2Url(`${STILL_PREFIX}earlier.jpg`)
    mem.candidates.set(
      "paws",
      openRow("paws", { posts: [{ platform: "tiktok", url: earlierUrl, author: "u1", postedAt: null, plays: 1, likes: null, soundName: null, stillUrl: earlierKept, embedUrl: null, durationSec: 10 }] }),
    )
    const keep = vi.fn(async (post: { url: string }) => r2Url(stillKey(post)))
    await runTrendRadar({ fetchText: async () => "<urlset></urlset>", search: onTiktok(() => answers), suggests: async () => null, notify: async () => undefined, keepStill: keep, now })

    const row = mem.candidates.get("paws")!
    const top = row.top_post as { url: string; stillUrl: string }
    expect(top.url).toBe(answers[0]!.url)
    expect(top.stillUrl).toBe(r2Url(stillKey(answers[0]!)))
    const stored = row.posts as Array<{ url: string; stillUrl: string }>
    expect(stored.every((p) => isKeptStill(p.stillUrl))).toBe(true)
    expect(stored.find((p) => p.url === earlierUrl)!.stillUrl).toBe(earlierKept)
    expect((row.platforms as { tiktok: { top: { stillUrl: string } } }).tiktok.top.stillUrl).toBe(top.stillUrl)
    // The post kept before is not fetched again.
    expect(keep.mock.calls.map(([p]) => p.url)).not.toContain(earlierUrl)
    expect(keep).toHaveBeenCalledTimes(2)
  })

  it("a still that cannot be kept leaves the platform's own link", async () => {
    const answers = posts(2).map((p, i) => ({ ...p, media: { ...p.media, thumbnailUrl: `https://p16.tiktokcdn.test/still-${i}.jpeg` } }))
    mem.candidates.set("paws", openRow("paws"))
    await runTrendRadar({ fetchText: async () => "<urlset></urlset>", search: onTiktok(() => answers), suggests: async () => null, notify: async () => undefined, keepStill: async () => null, now })
    expect((mem.candidates.get("paws")!.top_post as { stillUrl: string }).stillUrl).toMatch(/^https:\/\/p16\.tiktokcdn\.test\//)
  })
})

describe("keptStills", () => {
  const post = (url: string, stillUrl: string | null) => ({ platform: "tiktok" as const, url, author: "a", postedAt: null, plays: 1, likes: null, soundName: null, stillUrl, embedUrl: null, durationSec: 10 })

  it("names one object per post, recognises its own copies, and leaves out a post whose copy failed", async () => {
    expect(stillKey({ url: "https://x.test/1" })).toBe(stillKey({ url: "https://x.test/1" }))
    expect(stillKey({ url: "https://x.test/1" })).not.toBe(stillKey({ url: "https://x.test/2" }))
    expect(stillKey({ url: "https://x.test/1" })).toMatch(/^trend-radar\/stills\/[0-9a-f]{32}\.jpg$/)
    expect(isKeptStill(r2Url(stillKey({ url: "https://x.test/1" })))).toBe(true)
    expect(isKeptStill("https://p16.tiktokcdn.test/a.jpeg")).toBe(false)
    expect(isKeptStill(null)).toBe(false)

    const keep = vi.fn(async (p: { url: string }) => (p.url.endsWith("/bad") ? null : r2Url(stillKey(p))))
    const kept = await keptStills([post("https://x.test/1", "https://cdn.test/1"), post("https://x.test/bad", "https://cdn.test/2"), post("https://x.test/1", "https://cdn.test/1")], [], keep)
    expect([...kept.keys()]).toEqual(["https://x.test/1"])
    expect(keep).toHaveBeenCalledTimes(2)
    expect(withKeptStill(post("https://x.test/1", "https://cdn.test/1"), kept).stillUrl).toBe(r2Url(stillKey({ url: "https://x.test/1" })))
    expect(withKeptStill(post("https://x.test/bad", "https://cdn.test/2"), kept).stillUrl).toBe("https://cdn.test/2")
  })

  it("does not copy a link that is not https, or one already kept", async () => {
    expect(await keepStill(post("https://x.test/1", "http://cdn.test/1"))).toBeNull()
    expect(await keepStill(post("https://x.test/1", r2Url(stillKey({ url: "https://x.test/1" }))))).toBeNull()
    expect(await keepStill(post("https://x.test/1", null))).toBeNull()
  })
})

describe("out of credits", () => {
  it("a search the account cannot pay for stops the day's reading, keeps no partial reading, records why and says so on Slack", async () => {
    mem.settings.thresholds.dailySearchBudget = 900
    mem.candidates.set("a", openRow("a", { created_at: "2026-11-01T03:00:00Z" }))
    mem.candidates.set("b", openRow("b", { created_at: "2026-11-01T02:00:00Z" }))
    mem.candidates.set("c", openRow("c", { created_at: "2026-11-01T01:00:00Z" }))
    const search = vi.fn(async (query: string, _runner: string, platform: string) => {
      if (query.startsWith("b ") && platform === "instagram") throw new RunnerOutOfCreditsError("insufficient_credits")
      return platform === "tiktok" ? posts(3) : []
    })
    const notify = vi.fn(async () => undefined)
    const report = await runTrendRadar({ fetchText: async () => "<urlset></urlset>", search, suggests: async () => null, notify, now })

    expect(report.candidatesRead).toBe(1)
    expect(mem.readings.get("id-a")).toHaveLength(1)
    expect(mem.readings.get("id-b")).toBeUndefined()
    expect(mem.readings.get("id-c")).toBeUndefined()
    // c was never searched: nothing after the refusal is asked.
    expect(search.mock.calls.some(([q]) => q.startsWith("c "))).toBe(false)
    expect(report.skipped.map((s) => s.what)).toEqual(expect.arrayContaining(["candidate b", "candidate c"]))
    expect((mem.settings.lastRun as { stoppedEarly: string }).stoppedEarly).toBe(OUT_OF_CREDITS_STOP)
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("out of credits"))
  })

  it("a full run records that it did not stop early", async () => {
    mem.candidates.set("a", openRow("a"))
    await runTrendRadar({ fetchText: async () => "<urlset></urlset>", search: onTiktok(() => posts(3)), suggests: async () => null, notify: async () => undefined, now })
    expect((mem.settings.lastRun as { stoppedEarly: string | null }).stoppedEarly).toBeNull()
  })

  it("the search answers 402 as out of credits, and any other refusal as a plain failure", async () => {
    const answer = (statusCode: number) => ({ inject: async () => ({ statusCode, body: "nope" }) }) as unknown as Parameters<typeof makeSearch>[0]
    await expect(makeSearch(answer(402))("q", "runner", "tiktok", 60, "popular")).rejects.toBeInstanceOf(RunnerOutOfCreditsError)
    const other = makeSearch(answer(500))("q", "runner", "tiktok", 60, "popular")
    await expect(other).rejects.toThrow("social search refused: 500")
    await expect(makeSearch(answer(500))("q", "runner", "tiktok", 60, "popular")).rejects.not.toBeInstanceOf(RunnerOutOfCreditsError)
  })
})
