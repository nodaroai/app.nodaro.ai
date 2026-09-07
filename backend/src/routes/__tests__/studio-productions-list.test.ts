import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `GET /v1/studio/productions` — the page, and who decides where it ends.
 *
 * The list is the one route here that PAGES, and paging is where a list route
 * lies quietly. Three ways it can, all pinned below:
 *
 * 1. **Filtering in memory ends the page early.** A page built by fetching
 *    `limit + 1` rows and THEN dropping the archived ones answers with fewer
 *    rows than it promised and, worse, mints no cursor once the survivors fit
 *    under the limit — 30 productions, 10 of them archived, `limit = 25` and
 *    four are unreachable forever. So every filter is the QUERY's: the row the
 *    probe returns is a row on the page.
 * 2. **A single-key cursor drops rows tied on it.** `updated_at` is bumped by a
 *    trigger, and one bulk write stamps an identical `now()` on every row it
 *    touched; `updated_at.lt.<ts>` then skips every row sharing the boundary
 *    timestamp. The cursor is composite — `(updated_at, id)`, opaque on the
 *    wire — exactly as `lib/keyset-cursor.ts` is for `created_at`.
 * 3. **A cursor the caller made up must not reach Postgres.** It is a 400, not
 *    a 500 and not a silent page one (which a rolling client appends forever).
 *
 * The list is also the caller's PERSONAL library: the tenant-scope lint wants
 * `workspace_id IS NULL` on it in so many words, because a list that says
 * nothing about workspaces silently mixes them once workspaces exist.
 */

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "x",
    SUPABASE_SERVICE_ROLE_KEY: "x",
    STUDIO_PRODUCTIONS_API: true,
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => false,
}))

vi.mock("@/lib/private-plugins/load.js", () => ({
  getPluginServices: vi.fn(() => ({})),
  loadPrivatePlugins: vi.fn(),
}))

import { studioProductionRoutes } from "../studio-productions.js"
import { supabase } from "../../lib/supabase.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const PROJECT = "00000000-0000-4000-8000-000000000010"

/** A production row as `SUMMARY_COLS` selects it. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000020",
    user_id: OWNER,
    workspace_id: null,
    visibility: "private",
    name: "The Long Walk",
    thumbnail_url: null,
    version: 3,
    settings: { studio: { version: 3, shots: [], shotOrder: [] } },
    updated_at: "2026-09-06T10:00:00Z",
    ...overrides,
  }
}

/** The `projects` chain `ensureStudioProject` walks. */
function projectsChain(id: string) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: { id }, error: null })
  const limit = vi.fn().mockReturnValue({ maybeSingle })
  const order2 = vi.fn().mockReturnValue({ limit })
  const order1 = vi.fn().mockReturnValue({ order: order2 })
  const eq2 = vi.fn().mockReturnValue({ order: order1 })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  return { select }
}

type Call = [string, ...unknown[]]

/**
 * A self-recording PostgREST builder.
 *
 * Every method records its name and arguments and hands the builder back, and
 * the builder is thenable, so `await q` yields the rows the test staged. A
 * hand-shaped chain (`select → eq → eq → order → limit`) would have to be
 * rewritten by anyone who adds a filter and — the reason it is not used here —
 * pins the ORDER the route happens to call them in, which is not a contract.
 */
function recordingChain(rows: Array<Record<string, unknown>>, calls: Call[]) {
  const builder: Record<string, unknown> = {}
  for (const method of ["select", "eq", "is", "not", "or", "order", "limit", "lt", "filter"]) {
    builder[method] = vi.fn((...args: unknown[]) => {
      calls.push([method, ...args])
      return builder
    })
  }
  builder.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve)
  return builder
}

let app: FastifyInstance
let calls: Call[]

/** Stage the rows the QUERY returns — i.e. what the database already filtered. */
function listReturns(rows: Array<Record<string, unknown>>) {
  calls = []
  vi.mocked(supabase.from).mockImplementation(((table: string) =>
    table === "projects" ? projectsChain(PROJECT) : recordingChain(rows, calls)) as never)
}

/** Every `.or(...)` predicate the route put on the query. */
function orFilters(): string[] {
  return calls.filter((c) => c[0] === "or").map((c) => String(c[1]))
}

/** The cursor is opaque on the wire; the suite is allowed to look inside it. */
function decodeCursor(cursor: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(cursor, "base64").toString("utf8"))
}

async function list(url: string) {
  return app.inject({ method: "GET", url, headers: { "x-user-id": OWNER } })
}

beforeEach(async () => {
  vi.clearAllMocks()
  calls = []
  app = Fastify({ logger: false })
  app.addHook("onRequest", async (req) => {
    req.orgs = async () => ({ organizations: [], workspaces: [] })
  })
  app.addHook("preHandler", async (req) => {
    const h = req.headers["x-user-id"]
    if (typeof h === "string") req.userId = h
  })
  await app.register(async (i) => {
    await studioProductionRoutes(i)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("GET /v1/studio/productions — the query does the filtering", () => {
  it("scopes the read to the caller's own personal Studio project", async () => {
    listReturns([row()])
    await list("/v1/studio/productions")

    expect(calls).toContainEqual(["eq", "user_id", OWNER])
    expect(calls).toContainEqual(["eq", "project_id", PROJECT])
    // The "Studio" project is personal. A list that says nothing about
    // `workspace_id` mixes personal and workspace rows the day workspaces
    // exist — which is what the tenant-scope lint refuses to let happen.
    expect(calls).toContainEqual(["is", "workspace_id", null])
  })

  it("asks for productions only — a bare workflow never leaves the database", async () => {
    listReturns([row()])
    await list("/v1/studio/productions")
    expect(calls).toContainEqual(["not", "settings->>studio", "is", null])
  })

  it("hides the archived rows in the QUERY, and the internal ones always", async () => {
    listReturns([row()])
    await list("/v1/studio/productions")

    const filters = orFilters()
    // Both are "absent, or not true" — never `not.eq.true`, which is NULL for
    // a row without the key and so drops every ordinary production.
    expect(filters).toContain(
      "settings->studio->>archived.is.null,settings->studio->>archived.neq.true",
    )
    expect(filters).toContain(
      "settings->studio->>hidden.is.null,settings->studio->>hidden.neq.true",
    )
  })

  it("includeArchived drops the archived predicate and keeps the internal one", async () => {
    listReturns([row()])
    await list("/v1/studio/productions?includeArchived=true")

    const filters = orFilters()
    expect(filters.some((f) => f.includes("archived"))).toBe(false)
    // `hidden` is not a soft hide the user chose — it is the studio's own
    // favorites store, which is never a production at any detail level.
    expect(filters).toContain(
      "settings->studio->>hidden.is.null,settings->studio->>hidden.neq.true",
    )
  })

  it("returns every row the query returned — nothing is dropped in memory", async () => {
    // The database is the one filter. Were the route to re-filter here, the
    // `limit + 1` probe would stop deciding the page boundary and pages would
    // silently end early.
    listReturns([
      row({ id: "00000000-0000-4000-8000-00000000002a", name: "One" }),
      row({ id: "00000000-0000-4000-8000-00000000002b", name: "Two" }),
    ])
    const res = await list("/v1/studio/productions")
    expect((res.json().data.data as Array<{ name: string }>).map((p) => p.name)).toEqual([
      "One",
      "Two",
    ])
  })
})

describe("GET /v1/studio/productions — paging", () => {
  it("over-fetches by one and mints the cursor from the last row of the PAGE", async () => {
    listReturns([
      row({ id: "00000000-0000-4000-8000-00000000002a", updated_at: "2026-09-06T10:00:00Z" }),
      row({ id: "00000000-0000-4000-8000-00000000002b", updated_at: "2026-09-06T09:00:00Z" }),
      // The probe: it proves another page exists and never appears on this one.
      row({ id: "00000000-0000-4000-8000-00000000002c", updated_at: "2026-09-06T08:00:00Z" }),
    ])
    const res = await list("/v1/studio/productions?limit=2")

    expect(calls).toContainEqual(["limit", 3])
    const body = res.json().data as { data: unknown[]; nextCursor?: string }
    expect(body.data).toHaveLength(2)
    expect(decodeCursor(body.nextCursor!)).toEqual({
      updatedAt: "2026-09-06T09:00:00Z",
      id: "00000000-0000-4000-8000-00000000002b",
    })
  })

  it("mints no cursor on the last page", async () => {
    listReturns([row({ id: "00000000-0000-4000-8000-00000000002a" })])
    const res = await list("/v1/studio/productions?limit=2")
    expect(res.json().data.nextCursor).toBeUndefined()
  })

  it("orders by BOTH keys, so the cursor's tiebreak has an order to break", async () => {
    listReturns([row()])
    await list("/v1/studio/productions")
    expect(calls).toContainEqual(["order", "updated_at", { ascending: false }])
    expect(calls).toContainEqual(["order", "id", { ascending: false }])
  })

  it("a cursor resumes after the exact row it names, ties included", async () => {
    listReturns([row({ id: "00000000-0000-4000-8000-00000000002a" })])
    const cursor = Buffer.from(
      JSON.stringify({
        updatedAt: "2026-09-06T09:00:00Z",
        id: "00000000-0000-4000-8000-00000000002b",
      }),
    ).toString("base64")
    await list(`/v1/studio/productions?cursor=${encodeURIComponent(cursor)}`)

    // The composite predicate: strictly older, OR the same instant and a
    // strictly smaller id. A bare `updated_at.lt` would skip every row a bulk
    // update stamped with the boundary timestamp.
    expect(orFilters()).toContain(
      "updated_at.lt.2026-09-06T09:00:00Z,and(updated_at.eq.2026-09-06T09:00:00Z,id.lt.00000000-0000-4000-8000-00000000002b)",
    )
  })

  it("the cursor it mints is the cursor it accepts", async () => {
    listReturns([
      row({ id: "00000000-0000-4000-8000-00000000002a", updated_at: "2026-09-06T10:00:00Z" }),
      row({ id: "00000000-0000-4000-8000-00000000002b", updated_at: "2026-09-06T09:00:00Z" }),
    ])
    const first = await list("/v1/studio/productions?limit=1")
    const cursor = (first.json().data as { nextCursor?: string }).nextCursor!

    listReturns([row({ id: "00000000-0000-4000-8000-00000000002b" })])
    const second = await list(`/v1/studio/productions?cursor=${encodeURIComponent(cursor)}`)
    expect(second.statusCode).toBe(200)
    expect(orFilters().some((f) => f.startsWith("updated_at.lt.2026-09-06T10:00:00Z"))).toBe(true)
  })
})

describe("GET /v1/studio/productions — a cursor the caller invented", () => {
  it("refuses a malformed cursor with a 400, and never queries with it", async () => {
    listReturns([row()])
    const res = await list("/v1/studio/productions?cursor=not-a-cursor")

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    // Serving page one instead would be worse than the 400: a rolling-load
    // client appends the same rows forever.
    expect(vi.mocked(supabase.from).mock.calls.map((c) => c[0])).not.toContain("workflows")
  })

  it("refuses a cursor whose fields could break out of the filter string", async () => {
    listReturns([row()])
    const injected = Buffer.from(
      JSON.stringify({ updatedAt: "2026-09-06T09:00:00Z,id.gt.0", id: "x" }),
    ).toString("base64")
    const res = await list(`/v1/studio/productions?cursor=${encodeURIComponent(injected)}`)
    expect(res.statusCode).toBe(400)
  })
})
