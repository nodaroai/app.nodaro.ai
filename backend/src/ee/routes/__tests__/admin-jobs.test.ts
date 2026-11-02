import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ADMIN_UUID = "00000000-0000-4000-8000-000000000002"
const VALID_UUID = "00000000-0000-4000-8000-000000000001"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route/lib import
// ---------------------------------------------------------------------------

const mockFrom = vi.fn()
const mockRpc = vi.fn()
const cfg = vi.hoisted(() => ({ credits: false }))

vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/config.js")>()),
  hasCredits: () => cfg.credits,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}))

vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: async (
    req: { userId?: string },
    reply: { status: (code: number) => { send: (body: unknown) => void } },
  ) => {
    if (req.userId !== ADMIN_UUID) {
      reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
    }
  },
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { adminJobsRoutes } from "../admin-jobs.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A fluent jobs query whose terminal `await` resolves to `result`, exposing
 * the `range` spy so a test can assert offset paging.
 */
function jobsChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const self = () => chain
  chain.select = vi.fn().mockReturnValue(self())
  chain.order = vi.fn().mockReturnValue(self())
  chain.range = vi.fn().mockReturnValue(self())
  chain.eq = vi.fn().mockReturnValue(self())
  chain.not = vi.fn().mockReturnValue(self())
  chain.in = vi.fn().mockReturnValue(self())
  chain.ilike = vi.fn().mockReturnValue(self())
  chain.limit = vi.fn().mockReturnValue(self())
  chain.then = vi.fn().mockImplementation((resolve: (v: unknown) => void) => resolve(result))
  return chain
}

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let app: FastifyInstance
let warns: unknown[][] = []

beforeEach(async () => {
  vi.clearAllMocks()
  warns = []
  mockRpc.mockResolvedValue({ data: [], error: null })
  app = Fastify({ logger: false })
  app.addHook("onRequest", async (req) => {
    req.log = Object.assign(Object.create(req.log), { warn: (...a: unknown[]) => void warns.push(a) })
  })
  app.addHook("preHandler", async (req) => {
    const userId = req.headers["x-user-id"]
    if (typeof userId === "string") req.userId = userId
  })
  await app.register(async (instance) => {
    await adminJobsRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function adminGet(url: string, userId = ADMIN_UUID) {
  return app.inject({ method: "GET", url, headers: { "x-user-id": userId } })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /v1/admin/jobs", () => {
  it("returns 403 for a non-admin", async () => {
    const res = await adminGet("/v1/admin/jobs", VALID_UUID)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
  })

  it("rejects pageSize > 200 with 400", async () => {
    const res = await adminGet("/v1/admin/jobs?pageSize=999")
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("rejects a non-uuid in excludeUserIds with 400 (server validates what the browser used to interpolate raw)", async () => {
    const res = await adminGet("/v1/admin/jobs?excludeUserIds=not-a-uuid")
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns rows including the cost fields (admin route keeps cost, like sanitizeJobForPublic's admin branch)", async () => {
    const rows = [
      {
        id: "job-1",
        status: "completed",
        job_type: "generate-image",
        provider: "kie",
        provider_cost: 0.004,
        display_cost: 0.01,
        user_id: VALID_UUID,
      },
    ]
    mockRpc.mockResolvedValue({ data: [{ id: "job-1" }], error: null })
    mockFrom.mockReturnValue(jobsChain({ data: rows, error: null }))

    const res = await adminGet("/v1/admin/jobs?page=0&pageSize=50")
    expect(res.statusCode).toBe(200)
    const body = res.json()
    // No usage log, no hold: every credit figure is unknown.
    expect(body.data).toEqual(rows.map((r) => ({ ...r, credit: { status: null, charged: null, held: null, released: null, run: null } })))
    expect(body.data[0].provider_cost).toBe(0.004)
    expect(body.data[0].display_cost).toBe(0.01)
  })

  it("times the wait before the handler and each read in a Server-Timing header", async () => {
    mockRpc.mockResolvedValue({ data: [{ id: "job-1" }], error: null })
    mockFrom.mockReturnValue(jobsChain({ data: [{ id: "job-1", status: "completed", user_id: VALID_UUID }], error: null }))

    const res = await adminGet("/v1/admin/jobs?page=0&pageSize=50")
    expect(res.statusCode).toBe(200)
    const names = String(res.headers["server-timing"]).split(", ").map((entry) => {
      expect(entry).toMatch(/^[a-z]+;dur=\d+\.\d$/)
      return entry.split(";")[0]
    })
    expect(names).toEqual(["auth", "page", "rows", "steps", "logs", "side", "total"])
  })

  it("times an empty page and an address lookup too", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })
    mockFrom.mockReturnValue(jobsChain({ data: [{ id: VALID_UUID, email: "a@b.co" }], error: null }))

    const res = await adminGet("/v1/admin/jobs?userEmail=a@b.co")
    expect(res.statusCode).toBe(200)
    expect(String(res.headers["server-timing"]).split(", ").map((e) => e.split(";")[0])).toEqual(["auth", "user", "page", "total"])
  })

  it("pages by offset — page=2 pageSize=50 asks admin_job_page for offset 100, limit 50", async () => {
    const res = await adminGet("/v1/admin/jobs?page=2&pageSize=50")
    expect(res.statusCode).toBe(200)
    expect(mockRpc).toHaveBeenCalledWith("admin_job_page", expect.objectContaining({ p_offset: 100, p_limit: 50 }))
  })

  it("shows each job's settled charge beside its hold, and a parent's run total with its steps (never jobs.credits alone)", async () => {
    cfg.credits = true
    // The production Nodaro Motion preview: the parent and its video step,
    // both on the page (an admin list shows child jobs too).
    const page = [
      { id: "run", status: "completed", credits: 44, usage_log_id: "ul-run", user_id: VALID_UUID },
      { id: "video", status: "completed", credits: 3564, usage_log_id: "ul-video", user_id: VALID_UUID },
      { id: "live", status: "processing", credits: 120, usage_log_id: "ul-live", user_id: VALID_UUID },
    ]
    mockRpc.mockResolvedValue({ data: page.map((r) => ({ id: r.id })), error: null })
    const steps = [{ id: "video", parent_job_id: "run", usage_log_id: "ul-video", credits: 3564 }]
    const logs = [
      { id: "ul-run", status: "committed", credits_used: 44, credits_charged: 44 },
      { id: "ul-video", status: "committed", credits_used: 3564, credits_charged: 854 },
      { id: "ul-live", status: "reserved", credits_used: 120, credits_charged: null },
    ]
    mockFrom.mockImplementation((table: string) => {
      let inArgs: [string, unknown[]] | null = null
      const chain: Record<string, unknown> = {}
      for (const op of ["select", "order", "range", "eq", "not", "limit"]) chain[op] = () => chain
      chain.in = (column: string, ids: unknown[]) => ((inArgs = [column, ids]), chain)
      chain.then = (resolve: (v: unknown) => unknown) => {
        if (table === "usage_logs") return resolve({ data: logs.filter((l) => inArgs![1].includes(l.id)), error: null })
        if (table === "jobs" && inArgs?.[0] === "parent_job_id") return resolve({ data: steps.filter((st) => inArgs![1].includes(st.parent_job_id)), error: null })
        if (table === "jobs") return resolve({ data: page, error: null })
        return resolve({ data: [], error: null })
      }
      return chain
    })

    const res = await adminGet("/v1/admin/jobs")
    expect(res.statusCode).toBe(200)
    const [run, video, live] = res.json().data
    expect(run.credit).toEqual({
      status: "committed", charged: 44, held: 44, released: 0,
      run: { steps: 1, charged: 898, held: 3608, released: 2710, settled: true },
    })
    expect(video.credit).toEqual({ status: "committed", charged: 854, held: 3564, released: 2710, run: null })
    expect(live.credit).toEqual({ status: "reserved", charged: null, held: 120, released: null, run: null })
    // The usage-log id is read for the charge only.
    expect(run).not.toHaveProperty("usage_log_id")
    cfg.credits = false
  })

  it("returns 500 when the rows lookup errors", async () => {
    mockRpc.mockResolvedValue({ data: [{ id: "job-1" }], error: null })
    mockFrom.mockReturnValue(jobsChain({ data: null, error: { message: "boom" } }))
    const res = await adminGet("/v1/admin/jobs")
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })

  it("returns 500 when admin_job_page errors", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } })
    const res = await adminGet("/v1/admin/jobs")
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
    expect(mockFrom).not.toHaveBeenCalledWith("jobs")
  })

  it("a coded RPC error that is not a missing function stays a 500 (no fallback)", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } })
    const res = await adminGet("/v1/admin/jobs")
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
    expect(mockFrom).not.toHaveBeenCalledWith("jobs")
  })

  describe("before migration 575 reaches the database (admin_job_page missing)", () => {
    // What PostgREST answers when the function is not in its schema cache at all.
    const MISSING = {
      code: "PGRST202",
      message: "Could not find the function public.admin_job_page(p_exclude_user_ids, p_from, p_limit, p_offset) in the schema cache",
      details: "Searched for the function public.admin_job_page with parameters p_exclude_user_ids, p_from, p_limit, p_offset or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.",
      hint: null,
    }
    const EXCLUDE = "00000000-0000-4000-8000-0000000000aa,00000000-0000-4000-8000-0000000000bb"

    beforeEach(() => {
      mockRpc.mockImplementation(async (fn: string) =>
        fn === "admin_job_page" ? { data: null, error: MISSING } : { data: [], error: null },
      )
    })

    it.each([
      ["PGRST202", MISSING],
      ["42883", { code: "42883", message: "function public.admin_job_page(...) does not exist" }],
    ])("serves the page the old way on %s: status, user and exclude applied, newest first, offset paged", async (_code, error) => {
      mockRpc.mockImplementation(async (fn: string) => (fn === "admin_job_page" ? { data: null, error } : { data: [], error: null }))
      const rows = [
        { id: "job-2", status: "failed", user_id: VALID_UUID, usage_log_id: null },
        { id: "job-1", status: "failed", user_id: VALID_UUID, usage_log_id: null },
      ]
      const chain = jobsChain({ data: rows, error: null })
      mockFrom.mockReturnValue(chain)
      const res = await adminGet(`/v1/admin/jobs?page=1&pageSize=20&status=failed&userId=${VALID_UUID}&excludeUserIds=${EXCLUDE}`)
      expect(res.statusCode).toBe(200)
      expect(mockFrom).toHaveBeenCalledWith("jobs")
      expect(chain.order).toHaveBeenCalledWith("created_at", { ascending: false })
      expect(chain.range).toHaveBeenCalledWith(20, 39)
      expect(chain.eq).toHaveBeenCalledWith("status", "failed")
      expect(chain.eq).toHaveBeenCalledWith("user_id", VALID_UUID)
      expect(chain.not).toHaveBeenCalledWith("user_id", "in", `(${EXCLUDE})`)
      expect(chain.in).not.toHaveBeenCalledWith("id", expect.anything())
      const body = res.json()
      expect(body.data.map((r: { id: string }) => r.id)).toEqual(["job-2", "job-1"])
      expect(body.data[0]).not.toHaveProperty("usage_log_id")
      expect(body.data[0].credit).toEqual({ status: null, charged: null, held: null, released: null, run: null })
      // No new filter was asked for, so nothing went unapplied.
      expect(body).not.toHaveProperty("filtersUnavailable")
      // Every fallback is logged, so a post-release defect cannot hide in it.
      expect(warns).toEqual([[{ err: error }, "admin_job_page is not in the database yet (migration 575) — serving the pre-575 page"]])
    })

    it.each([
      [
        "PGRST202 for arguments no signature of the existing function takes",
        {
          code: "PGRST202",
          message: "Could not find the function public.admin_job_page(p_exclude_user_ids, p_limit) in the schema cache",
          details: "Searched for the function public.admin_job_page with parameters p_exclude_user_ids, p_limit or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.",
          hint: "Perhaps you meant to call the function public.admin_job_page(p_from, p_limit, p_offset, p_to)",
        },
      ],
      [
        "PGRST202 naming a different function",
        { code: "PGRST202", message: "Could not find the function public.admin_job_pages(p_limit) in the schema cache", hint: null },
      ],
      ["42883 for an operator inside the body", { code: "42883", message: "operator does not exist: text = uuid" }],
      ["42883 for a function the body calls", { code: "42883", message: "function public.unaccent_lower(text) does not exist" }],
    ])("a %s is a 500, never the unfiltered fallback", async (_what, error) => {
      mockRpc.mockImplementation(async (fn: string) => (fn === "admin_job_page" ? { data: null, error } : { data: [], error: null }))
      const res = await adminGet("/v1/admin/jobs?types=generate-image")
      expect(res.statusCode).toBe(500)
      expect(res.json().error.code).toBe("internal_error")
      expect(mockFrom).not.toHaveBeenCalledWith("jobs")
      expect(warns).toEqual([])
    })

    it("applies the user an address resolved to", async () => {
      const profiles = jobsChain({ data: [{ id: ADMIN_UUID, email: "a@example.com" }], error: null })
      const jobs = jobsChain({ data: [], error: null })
      mockFrom.mockImplementation((table: string) => (table === "profiles" ? profiles : jobs))
      const res = await adminGet("/v1/admin/jobs?userEmail=a@example.com")
      expect(res.statusCode).toBe(200)
      expect(jobs.eq).toHaveBeenCalledWith("user_id", ADMIN_UUID)
    })

    it.each([
      "types=generate-image",
      "models=gpt-image",
      "sources=web:studio",
      "minCredits=10",
      "from=2026-06-01",
      "to=2026-06-30",
      "q=fox",
    ])("says the new filters were not applied when one was asked for (%s)", async (query) => {
      mockFrom.mockReturnValue(jobsChain({ data: [{ id: "job-1", status: "completed", user_id: VALID_UUID }], error: null }))
      const res = await adminGet(`/v1/admin/jobs?${query}`)
      expect(res.statusCode).toBe(200)
      expect(res.json().filtersUnavailable).toBe(true)
      expect(res.json().data).toHaveLength(1)
    })

    it("says so on an empty page too", async () => {
      mockFrom.mockReturnValue(jobsChain({ data: [], error: null }))
      const res = await adminGet("/v1/admin/jobs?types=generate-image")
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ data: [], filtersUnavailable: true })
    })

    it("a blank search is no filter", async () => {
      mockFrom.mockReturnValue(jobsChain({ data: [], error: null }))
      const res = await adminGet("/v1/admin/jobs?q=%20%20")
      expect(res.json()).toEqual({ data: [] })
    })

    it("returns 500 when the fallback read errors", async () => {
      mockFrom.mockReturnValue(jobsChain({ data: null, error: { message: "boom" } }))
      const res = await adminGet("/v1/admin/jobs")
      expect(res.statusCode).toBe(500)
      expect(res.json().error.code).toBe("internal_error")
    })
  })

  it("passes every filter to admin_job_page", async () => {
    const exclude = "00000000-0000-4000-8000-0000000000aa,00000000-0000-4000-8000-0000000000bb"
    const res = await adminGet(
      `/v1/admin/jobs?page=1&pageSize=20&status=failed&userId=${VALID_UUID}&excludeUserIds=${exclude}` +
        "&types=generate-image,llm-chat&models=gpt-image,kling-3.0&sources=web:studio,app:7A1E,mcp" +
        "&minCredits=50&from=2026-06-01&to=2026-06-30&q=red%20fox",
    )
    expect(res.statusCode).toBe(200)
    expect(mockRpc).toHaveBeenCalledTimes(1)
    const [fn, args] = mockRpc.mock.calls[0]!
    expect(fn).toBe("admin_job_page")
    expect(args).toEqual({
      p_offset: 20,
      p_limit: 20,
      p_status: "failed",
      p_user_id: VALID_UUID,
      p_exclude_user_ids: ["00000000-0000-4000-8000-0000000000aa", "00000000-0000-4000-8000-0000000000bb"],
      p_types: ["generate-image", "llm-chat"],
      p_models: ["gpt-image", "kling-3.0"],
      p_sources: ["web:studio", "app:7A1E", "mcp"],
      p_min_credits: 50,
      p_from: "2026-06-01T00:00:00.000Z",
      // `to` names a whole day: the bound is the start of the next one.
      p_to: "2026-07-01T00:00:00.000Z",
      p_q: "red fox",
      p_q_is_id: false,
    })
  })

  it("sends no filter it was not given", async () => {
    await adminGet("/v1/admin/jobs")
    const [, args] = mockRpc.mock.calls[0]!
    expect(args).toEqual({
      p_offset: 0, p_limit: 50, p_status: null, p_user_id: null, p_exclude_user_ids: null,
      p_types: null, p_models: null, p_sources: null, p_min_credits: null,
      p_from: null, p_to: null, p_q: null, p_q_is_id: null,
    })
  })

  it("an empty minCredits is no filter, not zero", async () => {
    await adminGet("/v1/admin/jobs?minCredits=")
    expect(mockRpc.mock.calls[0]![1]).toMatchObject({ p_min_credits: null })
  })

  it("unknown userEmail returns no rows", async () => {
    // An ilike hit that is not the same address (an `_` matched any character) is no match.
    mockFrom.mockReturnValue(jobsChain({ data: [{ id: VALID_UUID, email: "aXb@example.com" }], error: null }))
    const res = await adminGet("/v1/admin/jobs?userEmail=a_b@example.com")
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [], userNotFound: true })
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("userEmail matches case-insensitively and exactly, with LIKE wildcards escaped, and wins over userId", async () => {
    const chain = jobsChain({ data: [{ id: ADMIN_UUID, email: "A_B@Example.com" }], error: null })
    mockFrom.mockReturnValue(chain)
    const res = await adminGet(`/v1/admin/jobs?userEmail=a_b@EXAMPLE.com&userId=${VALID_UUID}`)
    expect(res.statusCode).toBe(200)
    expect(mockFrom).toHaveBeenCalledWith("profiles")
    expect(chain.ilike).toHaveBeenCalledWith("email", "a\\_b@example.com")
    expect(mockRpc.mock.calls[0]![1]).toMatchObject({ p_user_id: ADMIN_UUID })
  })

  it("rejects a userEmail that is not an address", async () => {
    const res = await adminGet("/v1/admin/jobs?userEmail=not-an-email")
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 500 when the email lookup errors", async () => {
    mockFrom.mockReturnValue(jobsChain({ data: null, error: { message: "boom" } }))
    const res = await adminGet("/v1/admin/jobs?userEmail=a@example.com")
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("q without from looks back 7 days from the start of today (UTC), as the editor shows it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-01T10:30:00Z"))
    try {
      await adminGet("/v1/admin/jobs?q=fox")
    } finally {
      vi.useRealTimers()
    }
    expect(mockRpc.mock.calls[0]![1]).toMatchObject({ p_from: "2026-10-25T00:00:00.000Z", p_to: null, p_q: "fox", p_q_is_id: false })
  })

  it("q without from looks back 7 days from `to`, so the window never starts after it", async () => {
    await adminGet("/v1/admin/jobs?q=fox&to=2026-03-10")
    expect(mockRpc.mock.calls[0]![1]).toMatchObject({ p_from: "2026-03-03T00:00:00.000Z", p_to: "2026-03-11T00:00:00.000Z" })
  })

  it("q with from keeps the given from", async () => {
    await adminGet("/v1/admin/jobs?q=fox&from=2026-01-02")
    expect(mockRpc.mock.calls[0]![1]).toMatchObject({ p_from: "2026-01-02T00:00:00.000Z" })
  })

  it("uuid q sets p_q_is_id and no date default", async () => {
    const id = "ABCDEF01-2345-6789-abcd-ef0123456789" // not a v4 id: any Postgres uuid is a job id
    await adminGet(`/v1/admin/jobs?q=%20${id}%20`)
    expect(mockRpc.mock.calls[0]![1]).toMatchObject({ p_q: id, p_q_is_id: true, p_from: null, p_to: null })
  })

  it("a uuid q covers every date: a given from / to is ignored", async () => {
    const id = "ABCDEF01-2345-6789-abcd-ef0123456789"
    await adminGet(`/v1/admin/jobs?q=${id}&from=2026-01-01&to=2026-01-31`)
    expect(mockRpc.mock.calls[0]![1]).toMatchObject({ p_q: id, p_q_is_id: true, p_from: null, p_to: null })
  })

  it("a blank q is no search and sets no date default", async () => {
    await adminGet("/v1/admin/jobs?q=%20%20")
    expect(mockRpc.mock.calls[0]![1]).toMatchObject({ p_q: null, p_q_is_id: null, p_from: null })
  })

  it("rejects a source with a space", async () => {
    const res = await adminGet("/v1/admin/jobs?sources=web:studio,bad%20key")
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("rejects more than 200 types", async () => {
    const types = Array.from({ length: 201 }, (_, i) => `t${i}`).join(",")
    const res = await adminGet(`/v1/admin/jobs?types=${types}`)
    expect(res.statusCode).toBe(400)
  })

  it.each([
    ["from=2026-02-30", "a day that does not exist"],
    ["to=2026-6-01", "not YYYY-MM-DD"],
    ["minCredits=-1", "a negative minimum"],
    ["minCredits=2147483648", "a minimum past the database's integer"],
    ["page=42949673&pageSize=50", "an offset past the database's integer"],
    ["page=1e30", "a page past the database's integer"],
    [`q=${"x".repeat(201)}`, "a search over 200 characters"],
  ])("rejects %s (%s)", async (query) => {
    const res = await adminGet(`/v1/admin/jobs?${query}`)
    expect(res.statusCode).toBe(400)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("keeps order of the ids the RPC returned", async () => {
    mockRpc.mockResolvedValue({ data: [{ id: "c" }, { id: "a" }, { id: "gone" }, { id: "b" }], error: null })
    const chain = jobsChain({
      data: [
        { id: "a", user_id: VALID_UUID },
        { id: "b", user_id: VALID_UUID },
        { id: "c", user_id: VALID_UUID },
      ],
      error: null,
    })
    mockFrom.mockReturnValue(chain)
    const res = await adminGet("/v1/admin/jobs")
    expect(res.statusCode).toBe(200)
    expect(chain.in).toHaveBeenCalledWith("id", ["c", "a", "gone", "b"])
    // A job deleted between the two reads is simply not on the page.
    expect(res.json().data.map((r: { id: string }) => r.id)).toEqual(["c", "a", "b"])
  })

  it("takes the largest minimum and offset the database's integer holds", async () => {
    const res = await adminGet("/v1/admin/jobs?minCredits=2147483647&page=42949672&pageSize=50")
    expect(res.statusCode).toBe(200)
    expect(mockRpc.mock.calls[0]![1]).toMatchObject({ p_min_credits: 2147483647, p_offset: 2147483600 })
  })

  it("an empty page reads no rows", async () => {
    const res = await adminGet("/v1/admin/jobs")
    expect(res.json()).toEqual({ data: [] })
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

describe("GET /v1/admin/jobs/sources", () => {
  it("returns 403 for a non-admin", async () => {
    const res = await adminGet("/v1/admin/jobs/sources", VALID_UUID)
    expect(res.statusCode).toBe(403)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("sources lists keys with counts", async () => {
    mockRpc.mockResolvedValue({
      data: [
        { key: "web:studio", source: "web", source_detail: "next.studio.nodaro.ai", count: 12 },
        { key: "app:7a1e", source: "app", source_detail: "7a1e", count: "3" },
        { key: "unknown", source: null, source_detail: null, count: 1 },
      ],
      error: null,
    })
    const before = Date.now()
    const res = await adminGet("/v1/admin/jobs/sources")
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      data: [
        { key: "web:studio", source: "web", sourceDetail: "next.studio.nodaro.ai", count: 12 },
        { key: "app:7a1e", source: "app", sourceDetail: "7a1e", count: 3 },
        { key: "unknown", source: null, sourceDetail: null, count: 1 },
      ],
    })
    const [fn, args] = mockRpc.mock.calls[0]!
    expect(fn).toBe("admin_job_sources")
    const ninetyDays = 90 * 24 * 60 * 60 * 1000
    const since = Date.parse((args as { p_since: string }).p_since)
    expect(since).toBeGreaterThanOrEqual(before - ninetyDays - 1000)
    expect(since).toBeLessThanOrEqual(Date.now() - ninetyDays + 1000)
  })

  it("answers no choices before migration 575 reaches the database (admin_job_sources missing)", async () => {
    const error = { code: "PGRST202", message: "Could not find the function public.admin_job_sources(p_since) in the schema cache", hint: null }
    mockRpc.mockResolvedValue({ data: null, error })
    const res = await adminGet("/v1/admin/jobs/sources")
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [] })
    expect(warns).toEqual([[{ err: error }, "admin_job_sources is not in the database yet (migration 575) — serving no choices"]])
  })

  it("a call the existing admin_job_sources does not take is a 500", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        code: "PGRST202",
        message: "Could not find the function public.admin_job_sources(p_since) in the schema cache",
        hint: "Perhaps you meant to call the function public.admin_job_sources(p_from)",
      },
    })
    const res = await adminGet("/v1/admin/jobs/sources")
    expect(res.statusCode).toBe(500)
    expect(warns).toEqual([])
  })

  it("returns 500 when admin_job_sources errors", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } })
    const res = await adminGet("/v1/admin/jobs/sources")
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})
