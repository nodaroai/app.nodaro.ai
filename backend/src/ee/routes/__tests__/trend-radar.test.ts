/**
 * /v1/trend-radar/* (trend-radar.ts): admin session only — an API key, an
 * app token, a signed-out or non-admin caller is refused before anything is
 * read; the queue, one candidate, the three decisions (approve creates a
 * draft trend), the settings (saving names the runner) and "Run now"; the
 * cron's tick runs only on the internal secret and only when due.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const state = vi.hoisted(() => ({
  admin: true,
  candidates: new Map<string, Record<string, unknown>>(),
  settingsPatches: [] as unknown[],
  audits: [] as unknown[],
  createdTrends: [] as unknown[],
  attached: [] as unknown[],
  runs: 0,
  due: true,
  claimedDay: null as string | null,
}))

vi.mock("../../../lib/admin-check.js", () => ({ checkIsAdmin: vi.fn(async () => state.admin), ADMIN_ROLES: ["admin", "super_admin"] }))
vi.mock("../admin-trends-lifecycle.js", () => ({
  audit: vi.fn(async (_req: unknown, ...rest: unknown[]) => {
    state.audits.push(rest)
  }),
}))
vi.mock("../../lib/trends/store.js", () => ({
  TrendSlugTakenError: class TrendSlugTakenError extends Error {},
  createTrend: vi.fn(async (input: { slug: string }) => {
    state.createdTrends.push(input)
    return { id: `trend-for-${input.slug}` }
  }),
}))
vi.mock("../../lib/trends/schemas.js", () => ({
  trendVersionDataSchema: { safeParse: (v: unknown) => ({ success: true, data: v }) },
}))
vi.mock("../../lib/trend-radar/attach-clip.js", () => ({
  attachTopPostClip: vi.fn(async (input: unknown) => {
    state.attached.push(input)
    return { ok: true, durationSec: 10 }
  }),
}))
vi.mock("../../lib/trend-radar/run.js", () => ({
  makeSearch: vi.fn(() => vi.fn()),
  runTrendRadar: vi.fn(async () => {
    state.runs += 1
    return {}
  }),
  runDue: vi.fn(() => state.due),
}))
vi.mock("../../lib/trend-radar/store.js", () => {
  const card = (row: Record<string, unknown>) => ({ id: row.id, name: row.name, slug: row.slug, status: row.status, trendId: row.trend_id ?? null })
  const apply = (id: string, update: Record<string, unknown>) => {
    const row = { ...state.candidates.get(id)!, ...(update.status ? { status: update.status } : {}), ...(update.trendId ? { trend_id: update.trendId } : {}), ...(update.rejectReason !== undefined ? { reject_reason: update.rejectReason } : {}) }
    state.candidates.set(id, row)
    return row
  }
  return {
    TrendRadarUnavailableError: class TrendRadarUnavailableError extends Error {},
    toCard: card,
    readSummary: vi.fn(async () => ({ lastRun: null, counts: { candidates: 1, watching: 0, slowing: 0 }, searchesToday: 0, dailySearchBudget: 60 })),
    listCandidates: vi.fn(async (params: unknown) => ({ data: [{ params }], next: null })),
    readSettings: vi.fn(async () => ({ thresholds: { minCreators: 5, windowDays: 21, risingPct: 15, slowingPct: 1, maxClipSec: 30, dailySearchBudget: 60 }, runnerUserId: null, runAt: "06:00", lastRunDate: null })),
    readCandidate: vi.fn(async (id: string) => (state.candidates.has(id) ? { ...card(state.candidates.get(id)!), posts: [], readings: [] } : null)),
    readCandidateRow: vi.fn(async (id: string) => state.candidates.get(id) ?? null),
    updateCandidate: vi.fn(async (id: string, update: Record<string, unknown>) => apply(id, update)),
    updateOpenCandidate: vi.fn(async (id: string, update: Record<string, unknown>) => {
      const row = state.candidates.get(id)
      if (!row || !["watching", "candidate", "slowing"].includes(row.status as string)) return null
      return apply(id, update)
    }),
    claimRunDay: vi.fn(async (today: string) => {
      if (state.claimedDay === today) return false
      state.claimedDay = today
      return true
    }),
    readPublicSettings: vi.fn(async () => ({ sources: [], thresholds: {}, alerts: {}, retentionDays: 90, runAt: "06:00" })),
    writeSettings: vi.fn(async (patch: unknown) => {
      state.settingsPatches.push(patch)
      return {}
    }),
    replaceSources: vi.fn(async () => undefined),
  }
})

import { trendRadarRoutes } from "../trend-radar.js"

const USER = "00000000-0000-4000-8000-000000000001"
const CANDIDATE = "0f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01"
let app: FastifyInstance

beforeEach(async () => {
  state.admin = true
  state.candidates = new Map([[CANDIDATE, { id: CANDIDATE, name: "phone on train", slug: "phone-on-train", status: "candidate", trend_id: null, history: [], top_post: { platform: "tiktok", url: "https://www.tiktok.com/@a/video/7300000000000000001", author: "a" } }]])
  state.settingsPatches = []
  state.audits = []
  state.createdTrends = []
  state.attached = []
  state.runs = 0
  state.due = true
  state.claimedDay = null
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
    if (req.headers["x-app-token"] === "1") req.appAuthorization = { appId: "a", authorizationId: "b", scopes: [] } as never
    if (req.headers["x-api-token"] === "1") req.apiToken = { id: "k" } as never
    if (req.headers["x-internal"] === "1") req.authKind = "internal"
  })
  await app.register(trendRadarRoutes)
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

const asAdmin = { "x-user-id": USER }

describe("the admin-session gate", () => {
  it("refuses a signed-out caller (401), a non-admin (403), an app token and an API key (403) before any read", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/trend-radar/candidates" })).statusCode).toBe(401)
    state.admin = false
    expect((await app.inject({ method: "GET", url: "/v1/trend-radar/candidates", headers: asAdmin })).statusCode).toBe(403)
    state.admin = true
    expect((await app.inject({ method: "GET", url: "/v1/trend-radar/candidates", headers: { ...asAdmin, "x-app-token": "1" } })).statusCode).toBe(403)
    expect((await app.inject({ method: "GET", url: "/v1/trend-radar/summary", headers: { ...asAdmin, "x-api-token": "1" } })).statusCode).toBe(403)
  })
})

describe("the queue and one candidate", () => {
  it("lists with the query's filters, and reads one by id", async () => {
    const list = await app.inject({ method: "GET", url: "/v1/trend-radar/candidates?status=candidate&sort=dayChange&limit=10&cursor=20", headers: asAdmin })
    expect(list.statusCode).toBe(200)
    expect(list.json().data[0].params).toEqual({ status: "candidate", sort: "dayChange", limit: 10, cursor: "20" })
    const bad = await app.inject({ method: "GET", url: "/v1/trend-radar/candidates?status=nope", headers: asAdmin })
    expect(bad.statusCode).toBe(400)
    const one = await app.inject({ method: "GET", url: `/v1/trend-radar/candidates/${CANDIDATE}`, headers: asAdmin })
    expect(one.statusCode).toBe(200)
    expect(one.json().data.slug).toBe("phone-on-train")
    expect((await app.inject({ method: "GET", url: "/v1/trend-radar/candidates/0f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e02", headers: asAdmin })).statusCode).toBe(404)
  })

  it("summary answers the counts", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/trend-radar/summary", headers: asAdmin })
    expect(res.json().data.counts).toEqual({ candidates: 1, watching: 0, slowing: 0 })
  })
})

describe("the decisions", () => {
  it("approve creates a draft trend named after the candidate, once, and attaches the top post's clip as the admin", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/trend-radar/candidates/${CANDIDATE}/approve`, headers: asAdmin })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { trendId: "trend-for-phone-on-train", clip: "attaching" } })
    expect(state.createdTrends).toEqual([{ slug: "phone-on-train", data: expect.objectContaining({ name: { en: "phone on train" }, source: null, slots: [] }), createdBy: USER }])
    expect(state.candidates.get(CANDIDATE)!.status).toBe("approved")
    expect(state.audits[0]).toEqual(["approve_trend_candidate", "trend_radar_candidate", CANDIDATE, { trendId: "trend-for-phone-on-train", slug: "phone-on-train" }])
    await new Promise((r) => setTimeout(r, 0))
    expect(state.attached).toEqual([{ trendId: "trend-for-phone-on-train", candidateId: CANDIDATE, post: expect.objectContaining({ url: "https://www.tiktok.com/@a/video/7300000000000000001" }), userId: USER }])
    // Again: the same trend, no second draft, no second download.
    const again = await app.inject({ method: "POST", url: `/v1/trend-radar/candidates/${CANDIDATE}/approve`, headers: asAdmin })
    expect(again.json()).toEqual({ data: { trendId: "trend-for-phone-on-train", clip: "none" } })
    expect(state.createdTrends).toHaveLength(1)
    expect(state.attached).toHaveLength(1)
  })

  it("approve without a top post creates the draft and attaches nothing", async () => {
    state.candidates.get(CANDIDATE)!.top_post = null
    const res = await app.inject({ method: "POST", url: `/v1/trend-radar/candidates/${CANDIDATE}/approve`, headers: asAdmin })
    expect(res.json()).toEqual({ data: { trendId: "trend-for-phone-on-train", clip: "none" } })
    await new Promise((r) => setTimeout(r, 0))
    expect(state.attached).toEqual([])
  })

  it("reject needs a reason and keeps it; watch puts it back", async () => {
    expect((await app.inject({ method: "POST", url: `/v1/trend-radar/candidates/${CANDIDATE}/reject`, headers: asAdmin, payload: {} })).statusCode).toBe(400)
    const rejected = await app.inject({ method: "POST", url: `/v1/trend-radar/candidates/${CANDIDATE}/reject`, headers: asAdmin, payload: { reason: "a filter, not a clip" } })
    expect(rejected.statusCode).toBe(200)
    expect(rejected.json().data.status).toBe("rejected")
    expect(state.candidates.get(CANDIDATE)!.reject_reason).toBe("a filter, not a clip")
    const watched = await app.inject({ method: "POST", url: `/v1/trend-radar/candidates/${CANDIDATE}/watch`, headers: asAdmin })
    expect(watched.json().data.status).toBe("watching")
    expect(state.candidates.get(CANDIDATE)!.reject_reason).toBeNull()
  })

  it("an approved candidate is decided: watch and reject answer 409, and approve answers the same draft", async () => {
    await app.inject({ method: "POST", url: `/v1/trend-radar/candidates/${CANDIDATE}/approve`, headers: asAdmin })
    const watched = await app.inject({ method: "POST", url: `/v1/trend-radar/candidates/${CANDIDATE}/watch`, headers: asAdmin })
    expect(watched.statusCode).toBe(409)
    expect(watched.json().error.code).toBe("already_approved")
    const rejected = await app.inject({ method: "POST", url: `/v1/trend-radar/candidates/${CANDIDATE}/reject`, headers: asAdmin, payload: { reason: "x" } })
    expect(rejected.statusCode).toBe(409)
    expect(state.candidates.get(CANDIDATE)!.status).toBe("approved")
    expect(state.createdTrends).toHaveLength(1)
  })

  it("approve claims the row before creating the draft: a row decided meanwhile makes no trend", async () => {
    state.candidates.get(CANDIDATE)!.status = "rejected"
    const res = await app.inject({ method: "POST", url: `/v1/trend-radar/candidates/${CANDIDATE}/approve`, headers: asAdmin })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("not_open")
    expect(state.createdTrends).toEqual([])
    expect(state.candidates.get(CANDIDATE)!.status).toBe("rejected")
  })
})

describe("settings and the run", () => {
  it("saving the settings validates, names the saver as the runner, and audits", async () => {
    const bad = await app.inject({ method: "PUT", url: "/v1/trend-radar/settings", headers: asAdmin, payload: { runAt: "25:00" } })
    expect(bad.statusCode).toBe(400)
    const ok = await app.inject({ method: "PUT", url: "/v1/trend-radar/settings", headers: asAdmin, payload: { thresholds: { minCreators: 7 }, runAt: "07:30", sources: [{ name: "Site A", kind: "sitemap", url: "https://a.test/sitemap.xml", enabled: true }] } })
    expect(ok.statusCode).toBe(200)
    expect(state.settingsPatches).toEqual([{ thresholds: { minCreators: 7 }, runAt: "07:30", runnerUserId: USER }])
    expect(state.audits[0]).toEqual(["update_trend_radar_settings", "trend_radar_settings", "1", { keys: ["runAt", "sources", "thresholds"] }])
    const http = await app.inject({ method: "PUT", url: "/v1/trend-radar/settings", headers: asAdmin, payload: { sources: [{ name: "Site A", kind: "sitemap", url: "http://a.test/sitemap.xml", enabled: true }] } })
    expect(http.statusCode).toBe(400)
  })

  it("Run now answers 202, names the runner and starts one run", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/trend-radar/run", headers: asAdmin })
    expect(res.statusCode).toBe(202)
    expect(res.json().data.startedAt).toBeTruthy()
    expect(state.settingsPatches).toEqual([{ runnerUserId: USER }])
    await new Promise((r) => setTimeout(r, 0))
    expect(state.runs).toBe(1)
  })

  it("the tick runs only on the internal secret and only when due", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/trend-radar/internal/tick", headers: asAdmin, payload: {} })).statusCode).toBe(403)
    state.due = false
    const notDue = await app.inject({ method: "POST", url: "/v1/trend-radar/internal/tick", headers: { "x-internal": "1" }, payload: {} })
    expect(notDue.json()).toEqual({ data: { ran: false } })
    state.due = true
    const due = await app.inject({ method: "POST", url: "/v1/trend-radar/internal/tick", headers: { "x-internal": "1" }, payload: {} })
    expect(due.json()).toEqual({ data: { ran: true } })
    await new Promise((r) => setTimeout(r, 0))
    expect(state.runs).toBe(1)
    // The day was claimed before the run: a second tick the same day (another
    // process, or after a failed run) does not run again.
    expect(state.claimedDay).toBeTruthy()
    const again = await app.inject({ method: "POST", url: "/v1/trend-radar/internal/tick", headers: { "x-internal": "1" }, payload: {} })
    expect(again.json()).toEqual({ data: { ran: false } })
    await new Promise((r) => setTimeout(r, 0))
    expect(state.runs).toBe(1)
  })
})
