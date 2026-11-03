// @test-watches backend/src/app.ts
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { CREDIT_BASE_USD } from "@nodaro/shared/models"
import { LOCAL_ROUTES } from "../../lib/motion-price-check/steps.js"

const ADMIN_UUID = "00000000-0000-4000-8000-000000000002"
const USER_UUID = "00000000-0000-4000-8000-000000000001"
const RUN = "00000000-0000-4000-8000-0000000000a1"
const RENDER_JOB = "00000000-0000-4000-8000-0000000000c3"
const TOKEN = "kie-session-token-SECRET-0123456789"
const FROM = "2026-10-01T00:00:00.000Z"
const TO = "2026-10-08T00:00:00.000Z"

const state = vi.hoisted(() => ({
  kieUniqueId: "kie-account",
  rpc: vi.fn(),
  fetchLogs: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { rpc: (...args: unknown[]) => state.rpc(...args) },
}))

vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: async (
    req: { userId?: string },
    reply: { status: (code: number) => { send: (body: unknown) => unknown } },
  ) => {
    if (req.userId !== ADMIN_UUID) {
      return reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
    }
  },
}))

vi.mock("@/lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/config.js")>()
  return {
    ...actual,
    config: { ...actual.config, get KIE_UNIQUE_ID() { return state.kieUniqueId } },
  }
})

vi.mock("@/providers/kie/credit-lookup.js", () => ({
  fetchAllKieLogs: (...args: unknown[]) => state.fetchLogs(...args),
}))

import { adminMotionPriceCheckRoutes } from "../admin-motion-price-check.js"

/** A run as admin_motion_runs answers it. */
function runRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: RUN, created_at: "2026-10-02T10:00:00+00:00", user_id: USER_UUID, email: "person@example.test", status: "completed",
    full_quality: true, draft_job_id: null, kind: "hand", trend_name: null, engine: "prism", style: "precise",
    resolution: "1080p", draft: false, length_sec: 8, held: 40, taken: 40, settled: true,
    taken_usd: 0.08, recorded_usd: null, kie_usd: null, paid_usd: 0, margin_usd: 0.08, margin_pct: 100,
    steps: 0, steps_without_cost: 0, quote: null, quote_total: null, reuse: null, extras: null, quote_allowed: null,
    flag_paid_above_taken: false, flag_missing_cost: false, flag_above_quote: false, flagged: false,
    ...over,
  }
}

const TOTAL_ROW = {
  dimension: "all", value: null, runs: 1, unsettled: 0, held: 40, taken: 40, taken_usd: 0.08, paid_usd: 0,
  margin_usd: 0.08, margin_pct: 100,
}

const missing = (code: string) => ({ data: null, error: { code, message: "Could not find the function public.admin_motion_run_list" } })

let app: FastifyInstance
/** What the routes logged at warn and above, one JSON line each. */
let logLines: string[] = []

beforeEach(async () => {
  vi.clearAllMocks()
  state.kieUniqueId = "kie-account"
  state.rpc.mockResolvedValue({ data: { total: 1, runs: [runRow()], totals: [TOTAL_ROW] }, error: null })
  logLines = []
  app = Fastify({ logger: { level: "warn", stream: { write: (line: string) => { logLines.push(line) } } } })
  app.addHook("preHandler", async (req) => {
    const userId = req.headers["x-user-id"]
    if (typeof userId === "string") req.userId = userId
  })
  await app.register(async (instance) => {
    await adminMotionPriceCheckRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const post = (url: string, payload: unknown, userId = ADMIN_UUID) =>
  app.inject({ method: "POST", url: `/v1/admin/motion-price-check${url}`, headers: { "x-user-id": userId }, payload: payload as object })

const listCall = () => state.rpc.mock.calls.find((c) => c[0] === "admin_motion_run_list")?.[1]

describe("admins only", () => {
  it("a non-admin gets 403 on all three routes, and nothing is read", async () => {
    for (const [url, body] of [["/runs", { from: FROM, to: TO }], [`/runs/${RUN}`, {}], ["/kie-real", { token: TOKEN, from: FROM, to: TO }]] as const) {
      const res = await post(url, body, USER_UUID)
      expect(res.statusCode, url).toBe(403)
    }
    expect(state.rpc).not.toHaveBeenCalled()
    expect(state.fetchLogs).not.toHaveBeenCalled()
  })
})

describe("POST /runs", () => {
  it("the default list call: the range, the credit's price, no KIE figures, the local routes, no filter, margin_usd ascending", async () => {
    const res = await post("/runs", { from: FROM, to: TO })
    expect(res.statusCode).toBe(200)
    expect(state.rpc).toHaveBeenCalledTimes(1)
    expect(state.rpc).toHaveBeenCalledWith("admin_motion_run_list", {
      p_from: FROM, p_to: TO, p_credit_usd: CREDIT_BASE_USD, p_kie_usd: {}, p_local_routes: LOCAL_ROUTES,
      p_engine: null, p_style: null, p_kind: null, p_resolution: null, p_flagged: false,
      p_sort: "margin_usd", p_dir: "asc", p_offset: 0, p_limit: 50,
    })
    const body = res.json() as { data: Record<string, unknown> }
    expect(body.data.kieApplied).toBe(false)
    expect(body.data.total).toBe(1)
    expect(body.data.runs).toEqual([expect.objectContaining({ id: RUN, createdAt: "2026-10-02T10:00:00+00:00", fullQuality: true, paidUsd: 0 })])
    expect(body.data.totals).toEqual([{ dimension: "all", value: null, runs: 1, unsettled: 0, held: 40, taken: 40, takenUsd: 0.08, paidUsd: 0, marginUsd: 0.08, marginPct: 100 }])
  })

  it("passes a sent kieUsd through, and answers kieApplied: true", async () => {
    const kieUsd = { "kie-task-1": 1.4, "kie-task-2": 0 }
    const res = await post("/runs", { from: FROM, to: TO, kieUsd })
    expect(res.statusCode).toBe(200)
    expect(listCall()).toMatchObject({ p_kie_usd: kieUsd })
    expect((res.json() as { data: { kieApplied: boolean } }).data.kieApplied).toBe(true)
  })

  it("passes the filters, the page and the sort through", async () => {
    await post("/runs", { from: FROM, to: TO, engine: "pulse", style: "flex", kind: "trend", resolution: "720p", flaggedOnly: true, sort: "paid_usd", dir: "asc", offset: 50, limit: 25 })
    expect(listCall()).toMatchObject({
      p_engine: "pulse", p_style: "flex", p_kind: "trend", p_resolution: "720p", p_flagged: true,
      p_sort: "paid_usd", p_dir: "asc", p_offset: 50, p_limit: 25,
    })
  })

  it("sorts descending by default for every sort but the two margins", async () => {
    for (const [sort, dir] of [["taken", "desc"], ["paid_usd", "desc"], ["created_at", "desc"], ["margin_pct", "asc"], ["margin_usd", "asc"]] as const) {
      state.rpc.mockClear()
      await post("/runs", { from: FROM, to: TO, sort })
      expect(listCall(), sort).toMatchObject({ p_sort: sort, p_dir: dir })
    }
  })

  it("takes a range of exactly 31 days, with any offset", async () => {
    expect((await post("/runs", { from: "2026-10-01T00:00:00+02:00", to: "2026-11-01T00:00:00+02:00" })).statusCode).toBe(200)
  })

  it.each<[string, Record<string, unknown>]>([
    ["from equal to to", { from: FROM, to: FROM }],
    ["from after to", { from: TO, to: FROM }],
    ["a 32-day range", { from: "2026-10-01T00:00:00Z", to: "2026-11-02T00:00:00Z" }],
    ["sort: price", { from: FROM, to: TO, sort: "price" }],
    ["dir: up", { from: FROM, to: TO, dir: "up" }],
    ["limit: 0", { from: FROM, to: TO, limit: 0 }],
    ["limit: 201", { from: FROM, to: TO, limit: 201 }],
    ["a negative offset", { from: FROM, to: TO, offset: -1 }],
    ["a kieUsd with 10,001 entries", { from: FROM, to: TO, kieUsd: Object.fromEntries(Array.from({ length: 10_001 }, (_, i) => [`t-${i}`, 1])) }],
    ["a negative kieUsd value", { from: FROM, to: TO, kieUsd: { "t-1": -0.5 } }],
    ["a date that is not ISO", { from: "yesterday", to: TO }],
    ["a date with no offset", { from: "2026-10-01T00:00:00", to: TO }],
    ["an engine it does not know", { from: FROM, to: TO, engine: "kling" }],
    ["no range", {}],
  ])("400 for %s", async (_label, body) => {
    const res = await post("/runs", body)
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: { code: string } }).error.code).toBe("validation_error")
    expect(state.rpc).not.toHaveBeenCalled()
  })
})

describe("answers 503 motion_price_check_unavailable while the functions are not in the database", () => {
  const UNAVAILABLE = {
    code: "motion_price_check_unavailable",
    message: "Motion price check needs the database update that ships with the next production release.",
  }

  it.each(["PGRST202", "42883"])("%s on each route", async (code) => {
    state.rpc.mockResolvedValue({ data: null, error: { code } })
    for (const [url, body] of [["/runs", { from: FROM, to: TO }], [`/runs/${RUN}`, {}], ["/kie-real", { token: TOKEN, from: FROM, to: TO }]] as const) {
      const res = await post(url, body)
      expect(res.statusCode, url).toBe(503)
      expect((res.json() as { error: unknown }).error, url).toEqual(UNAVAILABLE)
    }
    expect(state.fetchLogs).not.toHaveBeenCalled()
  })

  it("logs each 503 once, with its route and the database's cause, never the token", async () => {
    const cause = { code: "PGRST202", message: "Could not find the function public.admin_motion_run_list in the schema cache" }
    state.rpc.mockResolvedValue({ data: null, error: cause })
    for (const [url, body, route] of [
      ["/runs", { from: FROM, to: TO }, "/v1/admin/motion-price-check/runs"],
      [`/runs/${RUN}`, {}, "/v1/admin/motion-price-check/runs/:jobId"],
      ["/kie-real", { token: TOKEN, from: FROM, to: TO }, "/v1/admin/motion-price-check/kie-real"],
    ] as const) {
      logLines = []
      expect((await post(url, body)).statusCode, url).toBe(503)
      expect(logLines, url).toHaveLength(1)
      expect(JSON.parse(logLines[0]!), url).toMatchObject({ level: 40, route, err: cause })
      expect(logLines.join(""), url).not.toContain(TOKEN)
    }
  })

  it("the detail is 503 when only its tree function is missing", async () => {
    state.rpc.mockImplementation(async (name: string) => (name === "admin_motion_tree" ? missing("PGRST202") : { data: [runRow()], error: null }))
    expect((await post(`/runs/${RUN}`, {})).statusCode).toBe(503)
  })

  it("a generic database error is a 500 that says only Failed to read the Motion price check", async () => {
    const raw = { code: "57014", message: "canceling statement due to statement timeout on public.jobs" }
    state.rpc.mockResolvedValue({ data: null, error: raw })
    for (const [url, body] of [["/runs", { from: FROM, to: TO }], [`/runs/${RUN}`, {}], ["/kie-real", { token: TOKEN, from: FROM, to: TO }]] as const) {
      const res = await post(url, body)
      expect(res.statusCode, url).toBe(500)
      expect((res.json() as { error: unknown }).error).toEqual({ code: "internal_error", message: "Failed to read the Motion price check" })
      expect(res.body).not.toContain("statement timeout")
    }
  })

  it("a call that throws is the same 500", async () => {
    state.rpc.mockRejectedValue(new Error("socket hang up"))
    const res = await post("/runs", { from: FROM, to: TO })
    expect(res.statusCode).toBe(500)
    expect(res.body).not.toContain("socket hang up")
  })
})

describe("POST /runs/:jobId", () => {
  const detailRpc = (run: Record<string, unknown> | null, tree: Record<string, unknown>[] = []) =>
    state.rpc.mockImplementation(async (name: string) => {
      if (name === "admin_motion_runs") return { data: run ? [run] : [], error: null }
      if (name === "admin_motion_tree") return { data: tree, error: null }
      return { data: null, error: { code: "XX000", message: "unexpected" } }
    })

  it("404 when admin_motion_runs answers no run", async () => {
    detailRpc(null)
    const res = await post(`/runs/${RUN}`, {})
    expect(res.statusCode).toBe(404)
    expect((res.json() as { error: { code: string } }).error.code).toBe("not_found")
  })

  it("reads the run by its id, the range ignored, and its tree, in parallel, each with the KIE figures sent", async () => {
    detailRpc(runRow())
    const kieUsd = { "kie-task-1": 1.4 }
    expect((await post(`/runs/${RUN}`, { kieUsd })).statusCode).toBe(200)
    expect(state.rpc).toHaveBeenCalledWith("admin_motion_runs", {
      p_from: null, p_to: null, p_run_id: RUN, p_credit_usd: CREDIT_BASE_USD, p_kie_usd: kieUsd, p_local_routes: LOCAL_ROUTES,
    })
    expect(state.rpc).toHaveBeenCalledWith("admin_motion_tree", { p_run_ids: [RUN], p_kie_usd: kieUsd, p_local_routes: LOCAL_ROUTES })
  })

  it("with no KIE figures sent, both read with an empty map", async () => {
    detailRpc(runRow())
    await post(`/runs/${RUN}`, undefined)
    expect(state.rpc).toHaveBeenCalledWith("admin_motion_runs", expect.objectContaining({ p_kie_usd: {} }))
    expect(state.rpc).toHaveBeenCalledWith("admin_motion_tree", expect.objectContaining({ p_kie_usd: {} }))
  })

  it("a reused render: the run's reuse names it with its job, and the run has no render step", async () => {
    const quote = { v: 1, totalCredits: 640, breakdown: { base: 40, motionHd: 600 } }
    const reuse = { v: 1, entries: [{ step: "render", jobId: RENDER_JOB }] }
    detailRpc(runRow({ quote, reuse }), [{
      run_id: RUN, job_id: RUN, parent_job_id: null, depth: 0, route: "cast-swap", step_key: null, provider: null, model: null,
      provider_task_id: null, status: "completed", created_at: "2026-10-02T10:00:00+00:00", held: 40, log_status: "committed",
      taken: 40, recorded_usd: null, kie_usd: null, paid_usd: 0, is_local: true, no_cost: false,
    }])
    const res = await post(`/runs/${RUN}`, {})
    expect(res.statusCode).toBe(200)
    const { data } = res.json() as { data: { reuse: unknown; steps: Array<{ name: string }>; run: { paidUsd: number } } }
    expect(data.reuse).toEqual({
      recorded: "yes",
      entries: [{ step: "render", name: "1080p render (an earlier try's)", role: null, jobId: RENDER_JOB, count: 1, quoteLine: "motionHd" }],
    })
    expect(data.steps.map((s) => s.name)).toEqual(["Full Quality"])
    expect(data.run.paidUsd).toBe(0)
  })

  it("400 for a job id that is not a uuid, and for a bad kieUsd; nothing is read", async () => {
    expect((await post("/runs/not-a-uuid", {})).statusCode).toBe(400)
    expect((await post(`/runs/${RUN}`, { kieUsd: { "t-1": -1 } })).statusCode).toBe(400)
    expect(state.rpc).not.toHaveBeenCalled()
  })
})

describe("POST /kie-real", () => {
  const records = [
    { taskId: "kie-task-1", consumeCredits: 280, remainedCredits: 0, model: "m", state: "success", createTime: 0, completeTime: 0, costTime: 0 },
    { taskId: "kie-task-2", consumeCredits: 12, remainedCredits: 0, model: "m", state: "fail", createTime: 0, completeTime: 0, costTime: 0 },
    { taskId: "someone-else", consumeCredits: 99, remainedCredits: 0, model: "m", state: "success", createTime: 0, completeTime: 0, costTime: 0 },
  ]
  const taskIds = (ids: unknown) =>
    state.rpc.mockImplementation(async (name: string) => (name === "admin_motion_task_ids" ? { data: ids, error: null } : { data: null, error: { code: "XX000" } }))

  it("KIE_UNIQUE_ID unset: 503 kie_not_configured, and nothing is read", async () => {
    state.kieUniqueId = ""
    const res = await post("/kie-real", { token: TOKEN, from: FROM, to: TO })
    expect(res.statusCode).toBe(503)
    expect((res.json() as { error: { code: string } }).error.code).toBe("kie_not_configured")
    expect(state.fetchLogs).not.toHaveBeenCalled()
    expect(state.rpc).not.toHaveBeenCalled()
  })

  it("reads the range's Motion task ids, then KIE's logs, and answers the matched map", async () => {
    taskIds(["kie-task-1", "kie-task-2"])
    state.fetchLogs.mockResolvedValue({ records, sources: { generic: 3 }, errors: {}, rawSamples: {} })
    const res = await post("/kie-real", { token: TOKEN, from: FROM, to: TO })
    expect(res.statusCode).toBe(200)
    expect(state.rpc).toHaveBeenCalledWith("admin_motion_task_ids", { p_from: FROM, p_to: TO })
    expect(state.fetchLogs).toHaveBeenCalledWith(TOKEN, Date.parse(FROM), Date.parse(TO) + 3 * 3600_000)
    const { data } = res.json() as { data: { kieUsd: Record<string, number>; motionTasks: number; matched: number } }
    expect(Object.keys(data.kieUsd)).toEqual(["kie-task-1", "kie-task-2"])
    expect(data).toMatchObject({ motionTasks: 2, matched: 2 })
  })

  it("zero task ids: an empty map, and KIE is never asked", async () => {
    taskIds([])
    const res = await post("/kie-real", { token: TOKEN, from: FROM, to: TO })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { data: unknown }).data).toMatchObject({ kieUsd: {}, motionTasks: 0, matched: 0, kieRecords: 0, errors: {} })
    expect(state.fetchLogs).not.toHaveBeenCalled()
  })

  it("1,001 task ids (one array, past PostgREST's row cap) are all looked up", async () => {
    taskIds(Array.from({ length: 1_001 }, (_, i) => `kie-task-${i + 1}`))
    state.fetchLogs.mockResolvedValue({ records, sources: { generic: 3 }, errors: {}, rawSamples: {} })
    const { data } = (await post("/kie-real", { token: TOKEN, from: FROM, to: TO })).json() as { data: { motionTasks: number; matched: number } }
    expect(data).toMatchObject({ motionTasks: 1_001, matched: 2 })
  })

  it("a fetch that fails everywhere: 502 kie_fetch_failed with details.errors", async () => {
    taskIds(["kie-task-1"])
    const errors = { generic: "401 — session token expired", "veo-generate": "401 — session token expired" }
    state.fetchLogs.mockResolvedValue({ records: [], sources: {}, errors, rawSamples: {} })
    const res = await post("/kie-real", { token: TOKEN, from: FROM, to: TO })
    expect(res.statusCode).toBe(502)
    const { error } = res.json() as { error: { code: string; message: string; details: { errors: unknown } } }
    expect(error.code).toBe("kie_fetch_failed")
    // Every endpoint refused the token: the sentence says so.
    expect(error.message).toMatch(/token/i)
    expect(error.details.errors).toEqual(errors)
  })

  it("a 502 that is not the token's names its cause and never blames the token", async () => {
    taskIds(["kie-task-1"])
    const errors = { generic: "HTTP 500", "veo-generate": "This operation was aborted due to timeout" }
    state.fetchLogs.mockResolvedValue({ records: [], sources: {}, errors, rawSamples: {} })
    const res = await post("/kie-real", { token: TOKEN, from: FROM, to: TO })
    expect(res.statusCode).toBe(502)
    const { error } = res.json() as { error: { code: string; message: string; details: { errors: unknown } } }
    expect(error).toEqual({
      code: "kie_fetch_failed",
      message: "KIE's logs could not be read: HTTP 500; This operation was aborted due to timeout",
      details: { errors },
    })
  })

  it("trims a token pasted with whitespace around it: KIE gets it trimmed, and no answer or log carries it", async () => {
    taskIds(["kie-task-1", "kie-task-2"])
    const quoting = { "suno-audio": `Headers.append: "${TOKEN}" is an invalid header value.` }
    state.fetchLogs.mockResolvedValue({ records, sources: { generic: 3 }, errors: quoting, rawSamples: {} })
    const ok = await post("/kie-real", { token: `  ${TOKEN}\n`, from: FROM, to: TO })
    expect(ok.statusCode).toBe(200)
    expect(state.fetchLogs).toHaveBeenCalledWith(TOKEN, Date.parse(FROM), Date.parse(TO) + 3 * 3600_000)
    expect(ok.body).not.toContain(TOKEN)

    state.fetchLogs.mockResolvedValue({ records: [], sources: {}, errors: quoting, rawSamples: {} })
    const failed = await post("/kie-real", { token: `\t${TOKEN} `, from: FROM, to: TO })
    expect(failed.statusCode).toBe(502)
    expect(failed.body).not.toContain(TOKEN)
    expect(logLines.join("")).not.toContain(TOKEN)
  })

  it("the answer body never contains the token", async () => {
    taskIds(["kie-task-1", "kie-task-2"])
    const quoting = { "suno-audio": `Headers.append: "${TOKEN}" is an invalid header value.` }
    state.fetchLogs.mockResolvedValue({ records, sources: { generic: 3 }, errors: quoting, rawSamples: { generic: { authorization: TOKEN } } })
    const ok = await post("/kie-real", { token: TOKEN, from: FROM, to: TO })
    expect(ok.statusCode).toBe(200)
    expect(ok.body).not.toContain(TOKEN)

    state.fetchLogs.mockResolvedValue({ records: [], sources: {}, errors: quoting, rawSamples: {} })
    const failed = await post("/kie-real", { token: TOKEN, from: FROM, to: TO })
    expect(failed.statusCode).toBe(502)
    expect(failed.body).not.toContain(TOKEN)

    state.rpc.mockResolvedValue({ data: null, error: { code: "57014", message: "timeout" } })
    const broken = await post("/kie-real", { token: TOKEN, from: FROM, to: TO })
    expect(broken.statusCode).toBe(500)
    expect(broken.body).not.toContain(TOKEN)
  })

  it.each<[string, Record<string, unknown>]>([
    ["no token", { from: FROM, to: TO }],
    ["an empty token", { token: "", from: FROM, to: TO }],
    ["a token of whitespace only", { token: " \n\t ", from: FROM, to: TO }],
    ["a token past 4,000 characters", { token: "t".repeat(4_001), from: FROM, to: TO }],
    ["from after to", { token: TOKEN, from: TO, to: FROM }],
    ["a 32-day range", { token: TOKEN, from: "2026-10-01T00:00:00Z", to: "2026-11-02T00:00:00Z" }],
  ])("400 for %s, and nothing is read", async (_label, body) => {
    const res = await post("/kie-real", body)
    expect(res.statusCode).toBe(400)
    expect(res.body).not.toContain(TOKEN)
    expect(state.rpc).not.toHaveBeenCalled()
    expect(state.fetchLogs).not.toHaveBeenCalled()
  })
})

describe("app.ts", () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "app.ts"), "utf8")

  it("registers the routes for admins on an edition with credits, once", () => {
    expect(source).toContain('import { adminMotionPriceCheckRoutes } from "./ee/routes/admin-motion-price-check.js"')
    expect(source).toContain("if (hasAdmin() && hasCredits()) await app.register(adminMotionPriceCheckRoutes)")
    expect(source.match(/app\.register\(adminMotionPriceCheckRoutes\)/g) ?? []).toHaveLength(1)
  })
})
