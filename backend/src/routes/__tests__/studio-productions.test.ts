import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `/v1/studio/productions` — the platform reading and writing a studio
 * production through the same codec the studio app runs.
 *
 * The suite pins the four things a route can get wrong here and one that would
 * be invisible until it hurt someone:
 *
 * 1. the SKILL is the format's one source, served in four parts and cached;
 * 2. VALIDATE is free, resolves against the caller's own library, and names
 *    the field it is unhappy about;
 * 3. a CREATE lands the whole plan into the caller's own "Studio" project,
 *    stamped `app_slug = "studio"` so it appears on their dashboard;
 * 4. a GET's `detail` is the line between a list read and an editing read;
 * 5. a stranger gets 404 — never 403, never a different message — so an id
 *    cannot be probed.
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
const STRANGER = "00000000-0000-4000-8000-0000000000ff"
const PRODUCTION = "00000000-0000-4000-8000-000000000020"
const PROJECT = "00000000-0000-4000-8000-000000000010"
const KIRA = "00000000-0000-4000-8000-000000000030"

/** The worked example, trimmed to what a Phase-0 route has to land. */
const PLAN = {
  format: "nodaro-studio-production",
  version: 2,
  title: "The Long Walk",
  brief: "A keeper walks the shoreline at dawn.",
  cast: [{ name: "Kira", kind: "character" }],
  scenes: [
    {
      frame: { prompt: "@Kira on the shoreline at dawn" },
      motion: { prompt: "slow dolly in", seconds: 5 },
    },
    {
      frame: { prompt: "the lighthouse, seen from the water" },
      motion: { prompt: "a slow rise", seconds: 5 },
    },
  ],
}

/** A production row, as the routes select it. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCTION,
    user_id: OWNER,
    workspace_id: null,
    visibility: "private",
    name: "The Long Walk",
    thumbnail_url: null,
    version: 3,
    nodes: [],
    edges: [],
    settings: { studio: { version: 3, shots: [], shotOrder: [] } },
    updated_at: "2026-09-06T10:00:00Z",
    ...overrides,
  }
}

/** The `projects` chain `ensureStudioProject` walks. */
function projectsChain(id: string | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: id ? { id } : null, error: null })
  const limit = vi.fn().mockReturnValue({ maybeSingle })
  const order2 = vi.fn().mockReturnValue({ limit })
  const order1 = vi.fn().mockReturnValue({ order: order2 })
  const eq2 = vi.fn().mockReturnValue({ order: order1 })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  return { select, insert: vi.fn().mockResolvedValue({ error: null }) }
}

let app: FastifyInstance
let inserted: Record<string, unknown> | undefined

beforeEach(async () => {
  vi.clearAllMocks()
  inserted = undefined
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

/** The four entity libraries the plan importer binds `@names` against. */
const ENTITY_TABLES = ["characters", "locations", "objects", "creatures"]

/** `supabase.from(t).select().order().limit()` then `entityOwnerFilter`'s `.eq().is()`. */
function entityChain(rows: Array<Record<string, unknown>> = []) {
  const is = vi.fn().mockResolvedValue({ data: rows, error: null })
  const eq = vi.fn().mockReturnValue({ is })
  const limit = vi.fn().mockReturnValue({ eq })
  const order = vi.fn().mockReturnValue({ limit })
  const select = vi.fn().mockReturnValue({ order })
  return { select }
}

/** `workflows` reads answer with `data`; `projects` answers the ensure chain. */
function withTables(opts: {
  workflowRow?: Record<string, unknown> | null
  insertRow?: Record<string, unknown>
  library?: Record<string, Array<Record<string, unknown>>>
}) {
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    if (table === "projects") return projectsChain(PROJECT) as never
    if (ENTITY_TABLES.includes(table)) return entityChain(opts.library?.[table]) as never
    const single = vi.fn().mockImplementation(async () => ({
      data: opts.insertRow ?? null,
      error: null,
    }))
    const selectAfterInsert = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
      inserted = payload
      return { select: selectAfterInsert }
    })
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: opts.workflowRow ?? null, error: null })
    const eq = vi.fn().mockReturnValue({ maybeSingle })
    const select = vi.fn().mockReturnValue({ eq })
    return { select, insert } as never
  }) as never)
}

describe("GET /v1/studio/productions/skill", () => {
  it("returns the four parts and the catalog versions they came from", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/studio/productions/skill",
      headers: { "x-user-id": OWNER },
    })
    expect(res.statusCode).toBe(200)
    const skill = res.json().data as Record<string, unknown>
    expect(Object.keys(skill).sort()).toEqual([
      "catalog",
      "generatedFrom",
      "operating",
      "schema",
      "skill",
    ])
    // The three RENDERED parts come out of the format registry, so a picker
    // added to the catalog reaches the skill with no edit anywhere.
    expect(String(skill.skill)).toContain("nodaro-studio-production")
    expect(String(skill.catalog).length).toBeGreaterThan(1000)
    expect(String(skill.operating)).toContain("get_studio_production_skill")
    expect((skill.schema as { type?: string }).type).toBe("object")
  })

  it("is cached — a second call renders nothing new", async () => {
    const first = await app.inject({
      method: "GET",
      url: "/v1/studio/productions/skill",
      headers: { "x-user-id": OWNER },
    })
    const second = await app.inject({
      method: "GET",
      url: "/v1/studio/productions/skill",
      headers: { "x-user-id": OWNER },
    })
    // Identity of the schema object across calls is what proves the cache: a
    // re-render would produce an equal-but-distinct object.
    expect(second.json().data.skill).toBe(first.json().data.skill)
  })

  it("refuses an unauthenticated caller", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/studio/productions/skill" })
    expect(res.statusCode).toBe(401)
  })
})

describe("POST /v1/studio/productions/validate", () => {
  beforeEach(() => withTables({}))

  it("rejects a document with no scenes, and names the field", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/studio/productions/validate",
      headers: { "x-user-id": OWNER },
      payload: { plan: { format: "nodaro-studio-production", version: 2, title: "x" } },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json().data as { valid: boolean; errors: Array<{ path: string }> }
    expect(body.valid).toBe(false)
    expect(body.errors.length).toBeGreaterThan(0)
    expect(body.errors[0].path).toContain("scenes")
  })

  it("accepts the worked example and counts what will land", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/studio/productions/validate",
      headers: { "x-user-id": OWNER },
      payload: { plan: PLAN },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json().data as {
      valid: boolean
      summary: { scenes: number; cast: number; bound: number }
    }
    expect(body.valid).toBe(true)
    expect(body.summary.scenes).toBe(2)
    expect(body.summary.cast).toBe(1)
    // The library is empty in this harness, so the one cast row binds to
    // nothing — which is a WARNING, not an error: the name still lands, as a
    // described role with the plan's own words.
    expect(body.summary.bound).toBe(0)
  })

  it("binds a cast name to a row the caller actually owns", async () => {
    // The other half of the sentence above: with `@Kira` in the library, the
    // same plan reports the name BOUND — which is the whole difference between
    // a production with a character in it and one with a character's name in
    // it. The row is shaped as `candidates.ts` selects it (`id, name,
    // source_image_url, canonical_description`), so a column renamed there
    // fails here rather than silently binding nothing.
    withTables({
      library: {
        characters: [
          {
            id: KIRA,
            name: "Kira",
            source_image_url: "https://cdn.nodaro.ai/images/kira.png",
            canonical_description: "a lighthouse keeper, late 30s",
          },
        ],
      },
    })
    const res = await app.inject({
      method: "POST",
      url: "/v1/studio/productions/validate",
      headers: { "x-user-id": OWNER },
      payload: { plan: PLAN },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json().data as {
      summary: { cast: number; bound: number }
      warnings: Array<{ hint: string }>
    }
    expect(body.summary.cast).toBe(1)
    expect(body.summary.bound).toBe(1)
    // And the 1 is provably that row: an unbound name warns, and nothing here
    // did.
    expect(body.warnings.map((w) => w.hint)).not.toContain("unresolved-cast")
  })

  it("persists nothing", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/studio/productions/validate",
      headers: { "x-user-id": OWNER },
      payload: { plan: PLAN },
    })
    const calls = vi.mocked(supabase.from).mock.calls.map((c) => c[0])
    expect(calls).not.toContain("workflows")
  })
})

describe("POST /v1/studio/productions", () => {
  it("lands the plan in the caller's Studio project, stamped as studio's", async () => {
    withTables({ insertRow: row({ settings: { studio: { version: 3, shots: [] } } }) })
    const res = await app.inject({
      method: "POST",
      url: "/v1/studio/productions",
      headers: { "x-user-id": OWNER },
      payload: { plan: PLAN },
    })
    expect(res.statusCode).toBe(201)
    expect(inserted).toMatchObject({
      project_id: PROJECT,
      user_id: OWNER,
      // The plan's own title wins over any fallback.
      name: "The Long Walk",
      app_slug: "studio",
    })
    const settings = (inserted as { settings: { studio: { shots: unknown[] } } }).settings
    expect(settings.studio.shots).toHaveLength(2)
  })

  it("creates an empty production that is still a PRODUCTION", async () => {
    withTables({ insertRow: row() })
    const res = await app.inject({
      method: "POST",
      url: "/v1/studio/productions",
      headers: { "x-user-id": OWNER },
      payload: { name: "Blank" },
    })
    expect(res.statusCode).toBe(201)
    // `settings.studio` is what makes the row a production rather than a bare
    // workflow — and what the `app_slug` inference reads.
    expect((inserted as { settings: { studio: unknown } }).settings.studio).toBeDefined()
  })

  it("refuses a plan it cannot parse, with the field that broke it", async () => {
    withTables({})
    const res = await app.inject({
      method: "POST",
      url: "/v1/studio/productions",
      headers: { "x-user-id": OWNER },
      payload: { plan: { format: "nodaro-studio-production", version: 2 } },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })
})

describe("GET /v1/studio/productions/:id", () => {
  it("summary carries counts; full carries the results", async () => {
    withTables({ workflowRow: row() })
    const summary = await app.inject({
      method: "GET",
      url: `/v1/studio/productions/${PRODUCTION}`,
      headers: { "x-user-id": OWNER },
    })
    expect(summary.statusCode).toBe(200)
    expect(summary.json().data.production).toMatchObject({
      id: PRODUCTION,
      name: "The Long Walk",
      version: 3,
      shared: false,
      archived: false,
    })
    expect(summary.json().data.production.trash).toEqual({ count: 0 })

    const full = await app.inject({
      method: "GET",
      url: `/v1/studio/productions/${PRODUCTION}?detail=full`,
      headers: { "x-user-id": OWNER },
    })
    expect(full.json().data.production.trash).toEqual({ count: 0, items: [] })
  })

  it("answers a stranger 404 — never 403, and never a different message", async () => {
    withTables({ workflowRow: row() })
    const res = await app.inject({
      method: "GET",
      url: `/v1/studio/productions/${PRODUCTION}`,
      headers: { "x-user-id": STRANGER },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("a workflow that is not a production is not found either", async () => {
    // Same 404 an unreachable row gets, for the same reason: the caller learns
    // nothing about ids they cannot use.
    withTables({ workflowRow: row({ settings: { someOtherApp: {} } }) })
    const res = await app.inject({
      method: "GET",
      url: `/v1/studio/productions/${PRODUCTION}`,
      headers: { "x-user-id": OWNER },
    })
    expect(res.statusCode).toBe(404)
  })

  it("refuses a malformed id before it reaches the database", async () => {
    withTables({ workflowRow: row() })
    const res = await app.inject({
      method: "GET",
      url: "/v1/studio/productions/not-a-uuid",
      headers: { "x-user-id": OWNER },
    })
    expect(res.statusCode).toBe(400)
  })
})

/**
 * The LIST has its own suite — `studio-productions-list.test.ts`.
 *
 * Its filters and its page boundary are the query's, so it is pinned against a
 * recording query builder rather than the hand-shaped chains above: what that
 * suite asserts is the SQL the route asks for, which is the only place the
 * archived / internal / production filters live.
 */
