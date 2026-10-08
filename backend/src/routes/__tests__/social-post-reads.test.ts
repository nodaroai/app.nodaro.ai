import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: vi.fn(async () => undefined) }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://t.co", SUPABASE_SERVICE_ROLE_KEY: "k", INTERNAL_ORCHESTRATOR_SECRET: "s".repeat(40) },
  isCloud: () => true,
  hasCredits: () => false,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => false,
}))
vi.mock("@/middleware/credit-guard.js", () => ({ creditGuard: () => async () => undefined }))
const JOB = "00000000-0000-4000-8000-00000000000a"
vi.mock("@/lib/insert-job.js", () => ({ insertJob: vi.fn(async () => ({ data: { id: JOB }, error: null })) }))

import { socialPostReadRoutes } from "../social-post-reads.js"
import { supabase } from "../../lib/supabase.js"
import { insertJob } from "../../lib/insert-job.js"

const USER = "00000000-0000-4000-8000-000000000001"
const BRAND = "00000000-0000-4000-8000-0000000000b1"
const SECRET = "s".repeat(40)

type Result = { data?: unknown; error?: { code?: string; message?: string } | null }

function makeQB(result: Result = {}) {
  const resolved = { data: result.data ?? null, error: result.error ?? null }
  const qb: Record<string, unknown> = {}
  for (const name of ["select", "insert", "update", "delete", "eq", "gte", "lt", "in", "or", "filter", "order", "limit"]) {
    qb[name] = vi.fn(() => qb)
  }
  qb.single = vi.fn(() => Promise.resolve({ data: resolved.data, error: resolved.error }))
  qb.maybeSingle = vi.fn(() => Promise.resolve({ data: resolved.data, error: resolved.error }))
  qb.then = (resolve: (v: unknown) => unknown) => resolve(resolved)
  return qb
}
type QB = ReturnType<typeof makeQB>
/** A table that answers as the database would: only a row matching every `.eq` of the chain. */
function rowsQB(rows: ReadonlyArray<Record<string, unknown>>) {
  let filters: ReadonlyArray<readonly [string, unknown]> = []
  const qb = makeQB()
  qb.select = vi.fn(() => {
    filters = []
    return qb
  })
  qb.eq = vi.fn((column: string, value: unknown) => {
    filters = [...filters, [column, value] as const]
    return qb
  })
  qb.maybeSingle = vi.fn(() => Promise.resolve({ data: rows.find((row) => filters.every(([c, v]) => row[c] === v)) ?? null, error: null }))
  return qb
}
/** The jobs table answering the completion CAS: the job was live, so it completes. */
const jobsQB = () => makeQB({ data: [{ id: JOB }] })
const fromMock = supabase.from as ReturnType<typeof vi.fn>
const insertJobMock = insertJob as ReturnType<typeof vi.fn>

function tables(queues: Record<string, QB[]>): Record<string, QB[]> {
  const used: Record<string, QB[]> = {}
  fromMock.mockImplementation((table: string) => {
    const queue = queues[table]
    const next = queue && queue.length > 0 ? (queue.length > 1 ? queue.shift()! : queue[0]!) : makeQB()
    ;(used[table] ??= []).push(next)
    return next
  })
  return used
}

function jobUpdate(used: Record<string, QB[]>): Record<string, unknown> {
  const jobs = used.jobs ?? []
  const last = jobs[jobs.length - 1]!
  return (last.update as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>
}

function socialPost(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    platform: "instagram",
    url: `https://www.instagram.com/p/${id}/`,
    text: `post ${id}`,
    author: { handle: "acme", name: "Acme" },
    metrics: { views: 10 },
    media: { kind: "image", thumbnailUrl: `https://cdn.example/${id}.jpg` },
    hashtags: [],
    extra: {},
    ...over,
  }
}

function savedRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id: `s-${id}`,
    post_id: id,
    platform: "instagram",
    url: `https://www.instagram.com/p/${id}/`,
    post: socialPost(id),
    thumbnail_asset_id: "a1",
    thumbnail_url: null,
    note: "",
    tags: ["hooks"],
    source: "picker",
    created_at: "2026-10-06T10:00:00Z",
    updated_at: "2026-10-06T10:00:00Z",
    still: { r2_url: `https://media.nodaro.ai/stills/${id}.jpg`, r2_key: `stills/${id}.jpg` },
    ...over,
  }
}

interface PluginFixture {
  readonly brands?: unknown[] | null
  readonly historyMonths?: number
  readonly scans?: Array<{ id: string; at: string; posts: unknown[]; status?: number }>
}

/** The app under test, plus stand-ins for the competitors plugin's own routes when a fixture is given. */
async function buildApp(plugin?: PluginFixture, appScopes?: readonly string[]): Promise<{ app: FastifyInstance; pluginCalls: Array<{ url: string; user: unknown; secret: unknown }> }> {
  const app = Fastify()
  const pluginCalls: Array<{ url: string; user: unknown; secret: unknown }> = []
  app.addHook("preHandler", async (req) => {
    const internalUser = req.headers["x-internal-user-id"]
    ;(req as { userId?: string }).userId = typeof internalUser === "string" ? internalUser : USER
    if (appScopes && !internalUser) (req as { appAuthorization?: unknown }).appAuthorization = { appId: "app1", authorizationId: "auth1", scopes: [...appScopes] }
  })
  if (plugin) {
    const record = (req: { url: string; headers: Record<string, unknown> }) =>
      pluginCalls.push({ url: req.url, user: req.headers["x-internal-user-id"], secret: req.headers["x-internal-orchestrator-secret"] })
    app.get("/v1/competitors", async (req) => {
      record(req)
      return { data: plugin.brands ?? [{ id: BRAND, brand: "Acme" }], historyMonths: plugin.historyMonths ?? 12 }
    })
    app.get("/v1/competitors/:id/history", async (req) => {
      record(req)
      return { scans: (plugin.scans ?? []).map(({ id, at }) => ({ id, at, platforms: [] })) }
    })
    app.get("/v1/competitors/:id", async (req, reply) => {
      record(req)
      const scanId = (req.query as { scan?: string }).scan
      const scan = (plugin.scans ?? []).find((s) => s.id === scanId)
      if (scan?.status) return reply.status(scan.status).send({ error: { code: "x" } })
      return { id: BRAND, latestScan: scan ? { id: scan.id, at: scan.at, counts: {}, posts: scan.posts, cards: [] } : null, scans: [] }
    })
  }
  await app.register(socialPostReadRoutes)
  return { app, pluginCalls }
}

beforeEach(() => {
  vi.resetAllMocks()
  insertJobMock.mockResolvedValue({ data: { id: JOB }, error: null })
})

describe("POST /v1/inspiration-read", () => {
  it("reads the caller's saved posts in the window, with the copied still, and ends the job with posts and digest", async () => {
    const { app } = await buildApp()
    const posts = makeQB({ data: [savedRow("p1"), savedRow("p2")] })
    const used = tables({ saved_posts: [posts], jobs: [jobsQB()] })
    const res = await app.inject({ method: "POST", url: "/v1/inspiration-read", payload: { windowAmount: 3, windowUnit: "days" } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe(JOB)
    expect(body.count).toBe(2)
    expect(body.posts[0].media.thumbnailUrl).toBe("https://media.nodaro.ai/stills/p1.jpg")
    expect(body.posts[0].savedAt).toBe("2026-10-06T10:00:00Z")
    expect(body.text).toContain("post p1")
    expect(posts.eq).toHaveBeenCalledWith("user_id", USER)
    expect(posts.gte).toHaveBeenCalledWith("created_at", expect.any(String))
    expect(posts.lt).toHaveBeenCalledWith("created_at", expect.any(String))
    expect(posts.limit).toHaveBeenCalledWith(20)
    const done = jobUpdate(used)
    expect(done.status).toBe("completed")
    expect((done.output_data as { json: unknown[] }).json).toHaveLength(2)
    expect((done.output_data as { text: string }).text).toBe(body.text)
  })

  it("narrows to one platform and one tag, normalized", async () => {
    const { app } = await buildApp()
    const posts = makeQB({ data: [] })
    tables({ saved_posts: [posts], jobs: [jobsQB()] })
    await app.inject({ method: "POST", url: "/v1/inspiration-read", payload: { platform: "x", tag: "#Hooks", order: "oldest", limit: 5 } })
    expect(posts.eq).toHaveBeenCalledWith("platform", "x")
    expect(posts.filter).toHaveBeenCalledWith("tags", "cs", "{\"hooks\"}")
    expect(posts.order).toHaveBeenCalledWith("created_at", { ascending: true })
    expect(posts.limit).toHaveBeenCalledWith(5)
  })

  it("all platforms and an empty tag filter nothing", async () => {
    const { app } = await buildApp()
    const posts = makeQB({ data: [] })
    tables({ saved_posts: [posts], jobs: [jobsQB()] })
    await app.inject({ method: "POST", url: "/v1/inspiration-read", payload: { platform: "all", tag: "" } })
    expect(posts.eq).not.toHaveBeenCalledWith("platform", expect.anything())
    expect(posts.filter).not.toHaveBeenCalled()
  })

  it("a day reads that calendar day in the node's timezone; an empty day field outside day mode is ignored", async () => {
    const { app } = await buildApp()
    const posts = makeQB({ data: [] })
    tables({ saved_posts: [posts], jobs: [jobsQB()] })
    const res = await app.inject({ method: "POST", url: "/v1/inspiration-read", payload: { period: "day", day: "2026-10-06", timezone: "Asia/Jerusalem" } })
    expect(res.statusCode).toBe(200)
    expect(posts.gte).toHaveBeenCalledWith("created_at", "2026-10-05T21:00:00.000Z")
    expect(posts.lt).toHaveBeenCalledWith("created_at", "2026-10-06T21:00:00.000Z")
    expect((await app.inject({ method: "POST", url: "/v1/inspiration-read", payload: { period: "window", day: "" } })).statusCode).toBe(200)
  })

  it("refuses a day mode with no day, a day that is not a date, and a window past a year — before any job", async () => {
    const { app } = await buildApp()
    tables({})
    expect((await app.inject({ method: "POST", url: "/v1/inspiration-read", payload: { period: "day" } })).statusCode).toBe(400)
    expect((await app.inject({ method: "POST", url: "/v1/inspiration-read", payload: { period: "day", day: "2026-02-30" } })).statusCode).toBe(400)
    expect((await app.inject({ method: "POST", url: "/v1/inspiration-read", payload: { windowAmount: 400, windowUnit: "days" } })).statusCode).toBe(400)
    expect((await app.inject({ method: "POST", url: "/v1/inspiration-read", payload: { platform: "myspace" } })).statusCode).toBe(400)
    expect(insertJobMock).not.toHaveBeenCalled()
  })

  it("an empty period ends with no posts and empty text (the text nodes behind it are skipped)", async () => {
    const { app } = await buildApp()
    const used = tables({ saved_posts: [makeQB({ data: [] })], jobs: [jobsQB()] })
    const res = await app.inject({ method: "POST", url: "/v1/inspiration-read", payload: {} })
    expect(res.json()).toMatchObject({ count: 0, text: "", posts: [] })
    expect((jobUpdate(used).output_data as { text: string }).text).toBe("")
  })

  it("a server without the saved-posts table reads nothing instead of failing", async () => {
    const { app } = await buildApp()
    tables({ saved_posts: [makeQB({ error: { code: "42P01", message: "relation does not exist" } })], jobs: [jobsQB()] })
    const res = await app.inject({ method: "POST", url: "/v1/inspiration-read", payload: {} })
    expect(res.statusCode).toBe(200)
    expect(res.json().count).toBe(0)
  })

  it("a read that fails fails the run — never an empty result", async () => {
    const { app } = await buildApp()
    const used = tables({ saved_posts: [makeQB({ error: { code: "57014", message: "canceling statement due to statement timeout" } })], jobs: [jobsQB()] })
    const res = await app.inject({ method: "POST", url: "/v1/inspiration-read", payload: {} })
    expect(res.statusCode).toBe(500)
    expect(jobUpdate(used).status).toBe("failed")
  })

  it("an app token needs assets:read; a run's internal call carries no app token", async () => {
    const { app } = await buildApp(undefined, ["workflows:execute"])
    tables({})
    expect((await app.inject({ method: "POST", url: "/v1/inspiration-read", payload: {} })).statusCode).toBe(403)
    expect(insertJobMock).not.toHaveBeenCalled()
  })
})

describe("POST /v1/competitor-read", () => {
  const recent = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString()

  it("reads the brand's scans through the plugin as the caller, and emits the posts of the period", async () => {
    const { app, pluginCalls } = await buildApp({
      scans: [
        { id: "scan-old", at: recent(40), posts: [socialPost("ancient", { publishedAt: recent(45), role: "own" })] },
        { id: "scan-new", at: recent(1), posts: [socialPost("fresh", { publishedAt: recent(2), role: "own" }), socialPost("about", { publishedAt: recent(3), role: "about" })] },
      ],
    })
    const used = tables({ jobs: [jobsQB()] })
    const res = await app.inject({ method: "POST", url: "/v1/competitor-read", payload: { competitorId: BRAND, windowAmount: 7, windowUnit: "days" } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.posts.map((p: { id: string }) => p.id)).toEqual(["fresh", "about"])
    expect(body.posts[0].role).toBe("own")
    expect(pluginCalls.every((c) => c.user === USER && c.secret === SECRET)).toBe(true)
    expect(pluginCalls.map((c) => c.url)).toEqual(["/v1/competitors", `/v1/competitors/${BRAND}/history`, `/v1/competitors/${BRAND}?scan=scan-new`])
    expect((jobUpdate(used).output_data as { json: unknown[] }).json).toHaveLength(2)
  })

  it("narrows to the brand's own posts on one platform", async () => {
    const { app } = await buildApp({
      scans: [
        {
          id: "s1",
          at: recent(1),
          posts: [
            socialPost("own-ig", { publishedAt: recent(2), role: "own" }),
            socialPost("own-x", { platform: "x", url: "https://x.com/acme/status/1", publishedAt: recent(2), role: "own" }),
            socialPost("about-x", { platform: "x", url: "https://x.com/b/status/2", publishedAt: recent(2), role: "about" }),
          ],
        },
      ],
    })
    tables({ jobs: [jobsQB()] })
    const res = await app.inject({ method: "POST", url: "/v1/competitor-read", payload: { competitorId: BRAND, role: "own", platform: "x" } })
    expect(res.json().posts.map((p: { id: string }) => p.id)).toEqual(["own-x"])
  })

  it("a brand that is not the caller's is a 404, before any job", async () => {
    const { app } = await buildApp({ brands: [{ id: "00000000-0000-4000-8000-0000000000b2" }] })
    tables({})
    const res = await app.inject({ method: "POST", url: "/v1/competitor-read", payload: { competitorId: BRAND } })
    expect(res.statusCode).toBe(404)
    expect(insertJobMock).not.toHaveBeenCalled()
  })

  it("without the competitors plugin it answers 503 not_available", async () => {
    const { app } = await buildApp()
    tables({})
    const res = await app.inject({ method: "POST", url: "/v1/competitor-read", payload: { competitorId: BRAND } })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("not_available")
    expect(insertJobMock).not.toHaveBeenCalled()
  })

  it("the period is held to the plan's history: a window older than it reads nothing", async () => {
    const { app, pluginCalls } = await buildApp({ historyMonths: 1, scans: [{ id: "s1", at: recent(100), posts: [socialPost("old", { publishedAt: recent(101) })] }] })
    tables({ jobs: [jobsQB()] })
    const res = await app.inject({ method: "POST", url: "/v1/competitor-read", payload: { competitorId: BRAND, period: "day", day: recent(101).slice(0, 10) } })
    expect(res.statusCode).toBe(200)
    expect(res.json().count).toBe(0)
    expect(pluginCalls.map((c) => c.url)).toEqual(["/v1/competitors"])
  })

  it("an unconfigured node (no competitor) is a 400 that says to pick one", async () => {
    const { app } = await buildApp({})
    tables({})
    const res = await app.inject({ method: "POST", url: "/v1/competitor-read", payload: { competitorId: "" } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/pick a competitor/i)
  })
})

describe("owner only — a run of someone else's workflow never reads the runner's library", () => {
  const OTHER = "00000000-0000-4000-8000-0000000000ff"
  const WF = "00000000-0000-4000-8000-0000000000f1"
  const MINE = "00000000-0000-4000-8000-0000000000f2"
  /** Someone else's workflow, beside one of the caller's own. */
  const workflows = () => rowsQB([{ id: WF, user_id: OTHER }, { id: MINE, user_id: USER }])

  it("refuses a published app's or a shared workflow's run (the workflow is not the caller's), before any job", async () => {
    const { app } = await buildApp({})
    tables({ workflows: [workflows()] })
    const insp = await app.inject({ method: "POST", url: "/v1/inspiration-read", payload: { workflowId: WF } })
    expect(insp.statusCode).toBe(403)
    expect(insp.json().error.code).toBe("owner_only")
    const comp = await app.inject({ method: "POST", url: "/v1/competitor-read", payload: { workflowId: WF, competitorId: BRAND } })
    expect(comp.statusCode).toBe(403)
    expect(insertJobMock).not.toHaveBeenCalled()
  })

  it("refuses a run whose workflow is gone — deleted, with the app published from it, while the run was under way", async () => {
    const { app } = await buildApp({})
    tables({ workflows: [rowsQB([])] })
    const res = await app.inject({ method: "POST", url: "/v1/inspiration-read", payload: { workflowId: WF } })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("owner_only")
    expect(insertJobMock).not.toHaveBeenCalled()
  })

  it("the owner's own workflow runs", async () => {
    const { app } = await buildApp()
    tables({ workflows: [workflows()], saved_posts: [makeQB({ data: [] })], jobs: [jobsQB()] })
    expect((await app.inject({ method: "POST", url: "/v1/inspiration-read", payload: { workflowId: MINE } })).statusCode).toBe(200)
  })
})

describe("refusals name the field", () => {
  it("an unknown timezone and a window past a year say which field", async () => {
    const { app } = await buildApp()
    tables({})
    const tz = await app.inject({ method: "POST", url: "/v1/inspiration-read", payload: { period: "day", day: "2026-10-06", timezone: "Mars/Olympus" } })
    expect(tz.statusCode).toBe(400)
    expect(tz.json().error.message).toMatch(/^timezone: /)
    const win = await app.inject({ method: "POST", url: "/v1/inspiration-read", payload: { windowAmount: 800, windowUnit: "days" } })
    expect(win.json().error.message).toMatch(/^windowAmount: /)
  })
})

describe("reading a competitor's scans", () => {
  const recent = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString()

  it("a scan that fails to read fails the read — never part of the period", async () => {
    const { app } = await buildApp({ scans: [{ id: "s1", at: recent(1), posts: [], status: 500 }] })
    const used = tables({ jobs: [jobsQB()] })
    const res = await app.inject({ method: "POST", url: "/v1/competitor-read", payload: { competitorId: BRAND } })
    expect(res.statusCode).toBe(500)
    expect(jobUpdate(used).status).toBe("failed")
  })

  it("a scan gone since the history was read is skipped", async () => {
    const { app } = await buildApp({
      scans: [
        { id: "gone", at: recent(2), posts: [], status: 404 },
        { id: "ok", at: recent(1), posts: [socialPost("p", { publishedAt: recent(1), role: "own" })] },
      ],
    })
    tables({ jobs: [jobsQB()] })
    const res = await app.inject({ method: "POST", url: "/v1/competitor-read", payload: { competitorId: BRAND } })
    expect(res.statusCode).toBe(200)
    expect(res.json().posts.map((p: { id: string }) => p.id)).toEqual(["p"])
  })

  it("an undated post the scan before the period held is not the period's — that scan is read only when needed", async () => {
    const { app, pluginCalls } = await buildApp({
      scans: [
        { id: "before", at: recent(10), posts: [socialPost("old-undated")] },
        { id: "inside", at: recent(1), posts: [socialPost("old-undated"), socialPost("new-undated"), socialPost("dated", { publishedAt: recent(2) })] },
      ],
    })
    tables({ jobs: [jobsQB()] })
    const res = await app.inject({ method: "POST", url: "/v1/competitor-read", payload: { competitorId: BRAND, windowAmount: 7, windowUnit: "days" } })
    expect(res.json().posts.map((p: { id: string }) => p.id).sort()).toEqual(["dated", "new-undated"])
    expect(pluginCalls.map((c) => c.url)).toContain(`/v1/competitors/${BRAND}?scan=before`)

    const { app: app2, pluginCalls: calls2 } = await buildApp({
      scans: [
        { id: "before", at: recent(10), posts: [] },
        { id: "inside", at: recent(1), posts: [socialPost("dated", { publishedAt: recent(2) })] },
      ],
    })
    tables({ jobs: [jobsQB()] })
    await app2.inject({ method: "POST", url: "/v1/competitor-read", payload: { competitorId: BRAND, windowAmount: 7, windowUnit: "days" } })
    expect(calls2.map((c) => c.url)).not.toContain(`/v1/competitors/${BRAND}?scan=before`)
  })
})

describe("a completion the job did not get", () => {
  it("answers with the job alone — never the posts (a cancelled run, a result policy that held or blocked them)", async () => {
    const { app } = await buildApp()
    tables({ saved_posts: [makeQB({ data: [savedRow("p1")] })], jobs: [makeQB({ data: [] })] })
    const res = await app.inject({ method: "POST", url: "/v1/inspiration-read", payload: {} })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: JOB })
  })
})
