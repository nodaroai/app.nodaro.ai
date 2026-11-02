import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"
import type { TrendCandidateCard, TrendRadarSettings } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}

function client(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
}

const card: TrendCandidateCard = {
  id: "0f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01",
  name: "phone on train",
  slug: "phone-on-train",
  status: "candidate",
  label: "hot",
  soundName: "subway remix",
  durationSec: 10,
  creators: 14,
  plays: 430_000_000,
  dayChangePct: 3.1,
  firstSeen: { kind: "template-site", name: "Site A", url: "https://a.test/templates/phone-on-train", firstSeenAt: "2026-10-23T06:00:00Z" },
  topPost: null,
  passedAt: "2026-10-27T06:00:00Z",
  trendId: null,
  createdAt: "2026-10-23T06:00:00Z",
  updatedAt: "2026-11-01T06:00:00Z",
}

const settings: TrendRadarSettings = {
  sources: [],
  thresholds: { minCreators: 5, windowDays: 21, risingPct: 15, slowingPct: 1, maxClipSec: 30, dailySearchBudget: 60 },
  alerts: { slackNewCandidate: true, slackDailySummary: false },
  retentionDays: 90,
  runAt: "06:00",
}

const call = (fetchMock: ReturnType<typeof vi.fn>, i = 0) => ({ url: fetchMock.mock.calls[i]![0] as string, init: fetchMock.mock.calls[i]![1] as { method: string; body?: string } })

describe("trendRadar resource", () => {
  it("candidates() GETs the queue, serializing every filter", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [card], next: "50" }))
    const out = await client(fetchMock).trendRadar.candidates({ status: "candidate", sort: "dayChange", cursor: "0", limit: 50 })
    expect(call(fetchMock).url).toBe("https://api.example.com/v1/trend-radar/candidates?status=candidate&sort=dayChange&cursor=0&limit=50")
    expect(call(fetchMock).init.method).toBe("GET")
    expect(out).toEqual({ data: [card], next: "50" })
  })

  it("candidates() with no params sends no query", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [], next: null }))
    await client(fetchMock).trendRadar.candidates()
    expect(call(fetchMock).url).toBe("https://api.example.com/v1/trend-radar/candidates")
  })

  it("summary() and candidate(id) unwrap `data`", async () => {
    const summary = { lastRun: null, counts: { candidates: 1, watching: 2, slowing: 0 }, searchesToday: 3, dailySearchBudget: 60 }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: summary })).mockReturnValueOnce(mockOk({ data: { ...card, posts: [], readings: [], templatesElsewhere: [], search: null, history: [], checklist: [], summary: null, rejectReason: null } }))
    const c = client(fetchMock)
    expect(await c.trendRadar.summary()).toEqual(summary)
    const one = await c.trendRadar.candidate(card.id)
    expect(call(fetchMock, 1).url).toBe(`https://api.example.com/v1/trend-radar/candidates/${card.id}`)
    expect(one.id).toBe(card.id)
  })

  it("approve(), watch() and reject() POST to the candidate's actions", async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockOk({ data: { trendId: "t1", clip: "attaching" } }))
      .mockReturnValueOnce(mockOk({ data: { ...card, status: "watching" } }))
      .mockReturnValueOnce(mockOk({ data: { ...card, status: "rejected" } }))
    const c = client(fetchMock)
    expect(await c.trendRadar.approve(card.id)).toEqual({ trendId: "t1", clip: "attaching" })
    expect(call(fetchMock, 0).url).toBe(`https://api.example.com/v1/trend-radar/candidates/${card.id}/approve`)
    expect(call(fetchMock, 0).init.method).toBe("POST")
    expect((await c.trendRadar.watch(card.id)).status).toBe("watching")
    expect(call(fetchMock, 1).url).toBe(`https://api.example.com/v1/trend-radar/candidates/${card.id}/watch`)
    expect((await c.trendRadar.reject(card.id, { reason: "a filter, not a clip" })).status).toBe("rejected")
    expect(call(fetchMock, 2).url).toBe(`https://api.example.com/v1/trend-radar/candidates/${card.id}/reject`)
    expect(JSON.parse(call(fetchMock, 2).init.body!)).toEqual({ reason: "a filter, not a clip" })
  })

  it("settings(), updateSettings() and run() use the settings and run routes", async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockOk({ data: settings }))
      .mockReturnValueOnce(mockOk({ data: { ...settings, runAt: "07:00" } }))
      .mockReturnValueOnce(mockOk({ data: { runId: "r", startedAt: "2026-11-02T06:00:00Z" } }))
    const c = client(fetchMock)
    expect(await c.trendRadar.settings()).toEqual(settings)
    expect(call(fetchMock, 0).url).toBe("https://api.example.com/v1/trend-radar/settings")
    expect((await c.trendRadar.updateSettings({ runAt: "07:00" })).runAt).toBe("07:00")
    expect(call(fetchMock, 1).init.method).toBe("PUT")
    expect(JSON.parse(call(fetchMock, 1).init.body!)).toEqual({ runAt: "07:00" })
    expect(await c.trendRadar.run()).toEqual({ runId: "r", startedAt: "2026-11-02T06:00:00Z" })
    expect(call(fetchMock, 2).url).toBe("https://api.example.com/v1/trend-radar/run")
  })
})
