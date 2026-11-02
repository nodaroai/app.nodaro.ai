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
  readings: new Map<string, Array<{ date: string; creators: number; plays: number; posts: number }>>(),
  pruned: 0,
  apply(id: string, update: Record<string, unknown>) {
    const row = [...mem.candidates.values()].find((c) => c.id === id)!
    const { event, ...rest } = update
    // The real store writes snake_case columns; mirror the ones the run reads back.
    const columns: Record<string, string> = { soundName: "sound_name", durationSec: "duration_sec", dayChangePct: "day_change_pct", topPost: "top_post", passedAt: "passed_at", rejectReason: "reject_reason", trendId: "trend_id" }
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
  writeReading: vi.fn(async (id: string, reading: { day: string; creators: number; plays: number; posts: number }) => {
    const list = (mem.readings.get(id) ?? []).filter((r) => r.date !== reading.day)
    list.push({ date: reading.day, creators: reading.creators, plays: reading.plays, posts: reading.posts })
    list.sort((a, b) => a.date.localeCompare(b.date))
    mem.readings.set(id, list)
    return list
  }),
  listReadings: vi.fn(async (id: string) => mem.readings.get(id) ?? []),
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

import { runDue, runTrendRadar } from "../run.js"

const SITEMAP = `<urlset><url><loc>https://a.test/templates/phone-on-train-ai-trend</loc><lastmod>2026-11-01</lastmod></url><url><loc>https://a.test/templates/tiny-desk</loc><lastmod>2026-10-30</lastmod></url><url><loc>https://a.test/blog/news</loc></url></urlset>`

function posts(creators: number, playsEach = 1000): SocialPost[] {
  return Array.from({ length: creators }, (_, i) => ({
    id: `tiktok:${i}`,
    platform: "tiktok" as const,
    url: `https://www.tiktok.com/@u${i}/video/730000000000000000${i}`,
    text: "x",
    author: { handle: `u${i}`, name: `u${i}` },
    metrics: { views: playsEach },
    media: { kind: "video" as const, durationSec: 10 },
    hashtags: [],
    extra: { sound: "subway remix" },
  }))
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
    const search = vi.fn(async () => posts(3))
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
    expect(search).toHaveBeenCalledWith("dog bartender ai", "runner")
    expect(second.searchesUsed).toBe(1)
    expect(second.candidatesRead).toBe(1)
    const c = mem.candidates.get("dog-bartender")!
    expect(c.status).toBe("watching")
    expect(c.label).toBe("new")
    expect(c.creators).toBe(3)
    expect(c.plays).toBe(3000)
    expect(c.sound_name).toBe("subway remix")
    expect(mem.readings.get("id-dog-bartender")).toEqual([{ date: "2026-11-02", creators: 3, plays: 3000, posts: 3 }])
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
    mem.readings.set("id-tiny-desk", [{ date: "2026-11-01", creators: 4, plays: 1000, posts: 4 }])
    const notify = vi.fn<(text: string) => Promise<void>>(async () => undefined)
    const suggests = vi.fn(async () => true)
    const report = await runTrendRadar({ search: async () => posts(6, 250), notify, suggests, now })
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
    await runTrendRadar({ search: async () => posts(7, 260), notify, suggests, now: () => new Date("2026-11-03T04:30:00Z") })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(mem.candidates.get("tiny-desk")!.status).toBe("candidate")
  })

  it("a missing runner and a spent budget skip the searches; a failed source or search is noted and the run goes on", async () => {
    mem.candidates.set("a", { id: "id-a", name: "a", slug: "a", status: "watching", label: "new", sound_name: null, duration_sec: null, search: null, first_seen_name: "x", created_at: "2026-11-01T00:00:00Z", history: [] })
    mem.candidates.set("b", { id: "id-b", name: "b", slug: "b", status: "watching", label: "new", sound_name: null, duration_sec: null, search: null, first_seen_name: "x", created_at: "2026-11-01T00:00:01Z", history: [] })
    mem.settings.runnerUserId = null
    const search = vi.fn(async () => posts(1))
    let report = await runTrendRadar({ fetchText: async () => { throw new Error("HTTP 403") }, search, suggests: async () => null, notify: async () => undefined, now })
    expect(search).not.toHaveBeenCalled()
    expect(report.skipped.map((s) => s.why)).toEqual(["HTTP 403", "no runner: save the settings as an admin once", "no runner: save the settings as an admin once"])
    expect(mem.sources[0]!.lastError).toBe("HTTP 403")

    mem.candidates.set("c", { id: "id-c", name: "c", slug: "c", status: "watching", label: "new", sound_name: null, duration_sec: null, search: null, first_seen_name: "x", created_at: "2026-11-01T00:00:02Z", history: [] })
    mem.settings.runnerUserId = "runner"
    mem.settings.thresholds.dailySearchBudget = 1
    search.mockRejectedValueOnce(new Error("social search failed: provider down"))
    report = await runTrendRadar({ fetchText: async () => SITEMAP, search, suggests: async () => null, notify: async () => undefined, now })
    // Newest first: c's search fails (noted, and it spent the budget of one —
    // a failing provider must not read every candidate for free), so b and a
    // wait for tomorrow.
    expect(search).toHaveBeenCalledTimes(1)
    expect(report.searchesUsed).toBe(1)
    expect(mem.settings.searchesToday).toBe(1)
    expect(report.skipped.map((s) => s.what)).toEqual(["candidate c", "candidate b", "candidate a"])
    expect(report.skipped[0]!.why).toContain("provider down")
    expect(report.skipped[1]!.why).toBe("daily search budget spent")
    expect((mem.candidates.get("c")!.history as Array<{ event: string }>)[0]!.event).toBe("read_failed")
    expect(mem.readings.get("id-b")).toBeUndefined()
  })
})

describe("runDue", () => {
  it("is due once the run time has passed today and no run was recorded today", () => {
    expect(runDue({ runAt: "06:00", lastRunDate: null }, new Date("2026-11-02T04:30:00Z"))).toBe(true)
    expect(runDue({ runAt: "06:00", lastRunDate: "2026-11-02" }, new Date("2026-11-02T04:30:00Z"))).toBe(false)
    expect(runDue({ runAt: "06:00", lastRunDate: "2026-11-01" }, new Date("2026-11-02T03:30:00Z"))).toBe(false)
    expect(runDue({ runAt: "06:00", lastRunDate: "2026-11-01" }, new Date("2026-11-02T04:00:00Z"))).toBe(true)
  })
})
