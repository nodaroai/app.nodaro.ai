/**
 * /v1/trends (ee/routes/trends.ts) — the public trend catalog and trend runs.
 *
 * What must hold:
 *  - only PUBLISHED trends are visible: a draft or unpublished slug is a 404
 *    on get, estimate, run and favorite (Review Focus 5);
 *  - nothing hidden leaves the server: the source clip, a slot's roleName,
 *    the fixed references, the trend prompt, an example's sourceJobId, and any
 *    `__` key of a trend run's input_data (Review Focus 1);
 *  - a run is composed server-side and dispatched to Cast Swap as an internal
 *    request as the caller, only when the engine supports what it needs.
 *
 * The store is an in-memory stand-in honouring the store's contract (its own
 * filters are pinned in lib/trends/__tests__/store.test.ts); the jobs, profile,
 * usage-log and session reads go through the recording fake Supabase; Cast
 * Swap is a stub route on the same app that records what it receives.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { argOf, has, type QueryResult, type RecordedQuery } from "../../../lib/__tests__/fake-supabase-query.js"
import type { TrendRow, TrendVersionData } from "../../lib/trends/types.js"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  respond: null as null | ((q: RecordedQuery) => QueryResult),
}))

vi.mock("../../../lib/supabase.js", async () => {
  const { makeFakeFrom } = await import("../../../lib/__tests__/fake-supabase-query.js")
  return { supabase: { from: makeFakeFrom(db.log, (q) => db.respond!(q)) } }
})

const mem = vi.hoisted(() => ({
  trends: [] as Array<TrendRow & { versions: Record<number, TrendVersionData> }>,
  favorites: new Set<string>(),
  listCalls: [] as unknown[],
  /** Every store read fails as on a database without migration 549's tables. */
  missingTables: false,
}))

vi.mock("../../lib/trends/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/trends/store.js")>()
  const strip = (t: (typeof mem.trends)[number]): TrendRow => {
    const { versions: _v, ...row } = t
    return row
  }
  return {
    ...actual,
    getTrendBySlug: async (slug: string) => {
      if (mem.missingTables) throw new actual.TrendsUnavailableError()
      const t = mem.trends.find((x) => x.slug === slug)
      return t ? strip(t) : null
    },
    getVersion: async (id: string, version: number) => mem.trends.find((x) => x.id === id)?.versions[version] ?? null,
    listPublished: async (q: { q?: string; tag?: string; favoritesOf?: string; cursor?: string; limit: number }) => {
      mem.listCalls.push(q)
      if (mem.missingTables) throw new actual.TrendsUnavailableError()
      if (q.cursor === "forged") throw new actual.InvalidTrendCursorError()
      const rows = mem.trends
        .filter((t) => t.status === "published" && t.publishedVersion !== null)
        .filter((t) => !q.favoritesOf || mem.favorites.has(`${q.favoritesOf}:${t.id}`))
        .filter((t) => !q.tag || t.tags.includes(q.tag))
        .slice(0, q.limit)
        .map((t) => ({ ...strip(t), data: t.versions[t.publishedVersion!]! }))
      return { rows, next: null }
    },
    setFavorite: async (userId: string, trendId: string, on: boolean) => {
      if (on) mem.favorites.add(`${userId}:${trendId}`)
      else mem.favorites.delete(`${userId}:${trendId}`)
    },
    favoriteIds: async (userId: string, ids: string[]) =>
      new Set(ids.filter((id) => mem.favorites.has(`${userId}:${id}`))),
  }
})

import { trendRoutes } from "../trends.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../lib/private-plugins/supports-registry.js"

// ── fixtures ───────────────────────────────────────────────────────────────

const USER = "00000000-0000-4000-8000-000000000001"
const SESSION = "00000000-0000-4000-8000-000000000020"
const SECRET = "0".repeat(64) // src/test/setup.ts

const SOURCE = "https://cdn.example/trends/t1/HIDDEN-SOURCE.mp4"
const ROLE = "HIDDEN-ROLE the woman on the left"
const REF_IMAGE = "https://cdn.example/trends/t1/HIDDEN-REF.png"
const REF_LINE = "HIDDEN-REF-LINE keep the neon sign"
const PROMPT = "HIDDEN-PROMPT dance like nobody watches"
const SOURCE_JOB = "HIDDEN-SOURCE-JOB-1"
const HIDDEN = [SOURCE, ROLE, REF_IMAGE, REF_LINE, PROMPT, SOURCE_JOB, "roleName", "trendPrompt", "sourceJobId", "__"]

const T_PUB = "00000000-0000-4000-8000-0000000000a1"
const T_DRAFT = "00000000-0000-4000-8000-0000000000a2"
const T_UNPUB = "00000000-0000-4000-8000-0000000000a3"
const T_PET = "00000000-0000-4000-8000-0000000000a4"

function versionData(over: Partial<TrendVersionData> = {}): TrendVersionData {
  return {
    name: { en: "Neon Dance", he: "ריקוד ניאון" },
    description: { en: "Dance under neon." },
    source: { videoUrl: SOURCE, durationSec: 12, width: 720, height: 1280 },
    previewStart: 2,
    slots: [
      { key: "lead", label: { en: "Lead dancer", he: "רקדנית" }, kind: "person", required: true, hint: { en: "A clear face" }, roleName: ROLE, defaults: { hair: "original" } },
      { key: "place", label: { en: "Place" }, kind: "location", required: false, roleName: "HIDDEN-ROLE the street" },
    ],
    references: [{ images: [REF_IMAGE], line: REF_LINE }],
    trendPrompt: PROMPT,
    examples: [
      {
        videoUrl: "https://cdn.example/ex1.mp4",
        posterUrl: "https://cdn.example/ex1.jpg",
        width: 720,
        height: 1280,
        durationSec: 12,
        slots: { lead: ["https://cdn.example/ex1-lead.png"], place: ["https://cdn.example/ex1-place.png"] },
        sourceJobId: SOURCE_JOB,
      },
    ],
    ...over,
  }
}

function trend(id: string, slug: string, status: TrendRow["status"], publishedVersion: number | null, data = versionData()) {
  return {
    id, slug, status, tags: ["dance"], badges: ["trending" as const], sortOrder: 0,
    draftVersion: publishedVersion ?? 1, publishedVersion,
    createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
    versions: { [publishedVersion ?? 1]: data },
  }
}

const CAST_SWAP_ALL = {
  roleKinds: ["person", "location", "product", "pet"] as const,
  fixedReferences: true,
  fullQuality: true,
  resolutions: ["480p", "720p", "1080p"] as const,
  trendRun: true,
}

const engine = {
  calls: [] as Array<{ url: string; headers: Record<string, unknown>; body: Record<string, unknown> }>,
  runStatus: 202,
  runBody: { jobId: "00000000-0000-4000-8000-0000000000j1" } as unknown,
  estimateStatus: 200,
  estimateBody: { totalCredits: 120, breakdown: { castSwap: 40, seedance: 80 }, settlesLower: true } as unknown,
}

let app: FastifyInstance

beforeEach(async () => {
  db.log.length = 0
  db.respond = () => ({ data: null, error: null })
  mem.trends = [
    trend(T_PUB, "neon-dance", "published", 2),
    trend(T_DRAFT, "wip", "draft", null),
    trend(T_UNPUB, "old", "unpublished", 1),
  ]
  mem.favorites = new Set()
  mem.listCalls = []
  mem.missingTables = false
  engine.calls = []
  engine.runStatus = 202
  engine.runBody = { jobId: "00000000-0000-4000-8000-0000000000j1" }
  engine.estimateStatus = 200
  engine.estimateBody = { totalCredits: 120, breakdown: { castSwap: 40, seedance: 80 }, settlesLower: true }
  _resetPluginSupportsForTests()
  setPluginSupports({ castSwap: { ...CAST_SWAP_ALL, roleKinds: [...CAST_SWAP_ALL.roleKinds], resolutions: [...CAST_SWAP_ALL.resolutions] } })

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-internal-orchestrator-secret"] === SECRET) {
      req.authKind = "internal"
      req.userId = req.headers["x-internal-user-id"] as string
      return
    }
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
    const kind = req.headers["x-auth-kind"]
    if (typeof kind === "string") req.authKind = kind as never
    const scopes = req.headers["x-app-scopes"]
    if (typeof scopes === "string") req.appAuthorization = { scopes: scopes.split(" ") } as never
  })
  const record = (url: string) => (req: { headers: Record<string, unknown>; body: unknown }) => {
    engine.calls.push({ url, headers: { ...req.headers }, body: req.body as Record<string, unknown> })
  }
  app.post("/v1/cast-swap", async (req, reply) => {
    record("/v1/cast-swap")(req)
    return reply.status(engine.runStatus).send(engine.runBody)
  })
  app.post("/v1/cast-swap/estimate", async (req, reply) => {
    record("/v1/cast-swap/estimate")(req)
    return reply.status(engine.estimateStatus).send(engine.estimateBody)
  })
  await app.register(trendRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
  _resetPluginSupportsForTests()
})

const as = (headers: Record<string, string> = {}) => ({ "x-user-id": USER, ...headers })

function expectNoHidden(body: string) {
  for (const h of HIDDEN) expect(body, `leaked ${h}`).not.toContain(h)
}

const RUN_BODY = { slots: { lead: { images: ["https://u.example/me.png"] } } }

// ── list ───────────────────────────────────────────────────────────────────

describe("GET /v1/trends", () => {
  it("lists published trends as cards with nothing hidden", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/trends", headers: as() })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.map((c: { slug: string }) => c.slug)).toEqual(["neon-dance"])
    expect(body.next).toBeNull()
    expect(body.data[0]).toEqual({
      id: T_PUB,
      slug: "neon-dance",
      name: "Neon Dance",
      description: "Dance under neon.",
      tags: ["dance"],
      badges: ["trending"],
      cover: { videoUrl: "https://cdn.example/ex1.mp4", posterUrl: "https://cdn.example/ex1.jpg", width: 720, height: 1280 },
      needs: { person: 1, location: 1, product: 0, pet: 0 },
      durationSec: 12,
      isFavorite: false,
    })
    expectNoHidden(res.body)
  })

  it("defaults the limit to 30 and refuses one outside 1–60", async () => {
    await app.inject({ method: "GET", url: "/v1/trends", headers: as() })
    expect(mem.listCalls[0]).toMatchObject({ limit: 30 })
    for (const bad of ["0", "61", "abc"]) {
      const res = await app.inject({ method: "GET", url: `/v1/trends?limit=${bad}`, headers: as() })
      expect(res.statusCode).toBe(400)
    }
    const ok = await app.inject({ method: "GET", url: "/v1/trends?limit=60", headers: as() })
    expect(ok.statusCode).toBe(200)
    expect(mem.listCalls[1]).toMatchObject({ limit: 60 })
  })

  it("a cursor the store did not issue is a 400", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/trends?cursor=forged", headers: as() })
    expect(res.statusCode).toBe(400)
  })

  it("passes q and tag to the store", async () => {
    await app.inject({ method: "GET", url: "/v1/trends?q=neon&tag=dance", headers: as() })
    expect(mem.listCalls[0]).toMatchObject({ q: "neon", tag: "dance" })
    expect((mem.listCalls[0] as { favoritesOf?: string }).favoritesOf).toBeUndefined()
  })

  it("needs a signed-in caller, and jobs:read for an OAuth app", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/trends" })).statusCode).toBe(401)
    const res = await app.inject({ method: "GET", url: "/v1/trends", headers: as({ "x-app-scopes": "assets:write" }) })
    expect(res.statusCode).toBe(403)
    const ok = await app.inject({ method: "GET", url: "/v1/trends", headers: as({ "x-app-scopes": "jobs:read" }) })
    expect(ok.statusCode).toBe(200)
  })
})

// ── locale ─────────────────────────────────────────────────────────────────

describe("locale", () => {
  it("?locale=he gives the Hebrew text and falls back to English where there is none", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/trends/neon-dance?locale=he", headers: as() })
    expect(res.statusCode).toBe(200)
    const d = res.json().data
    expect(d.name).toBe("ריקוד ניאון")
    expect(d.description).toBe("Dance under neon.") // no he → en
    expect(d.slots[0].label).toBe("רקדנית")
    expect(d.slots[1].label).toBe("Place")
    // ?locale= wins: the profile is not read.
    expect(db.log.filter((q) => q.table === "profiles")).toHaveLength(0)
  })

  it("without ?locale= the profile's preferredLocale is used", async () => {
    db.respond = (q) => (q.table === "profiles" ? { data: { preferred_locale: "he" }, error: null } : { data: null, error: null })
    const res = await app.inject({ method: "GET", url: "/v1/trends", headers: as() })
    expect(res.json().data[0].name).toBe("ריקוד ניאון")
    const [profile] = db.log.filter((q) => q.table === "profiles")
    expect(has(profile!, "eq", "id", USER)).toBe(true)
  })

  it("no ?locale= and no profile preference (or a failed read) is English", async () => {
    db.respond = (q) => (q.table === "profiles" ? { data: null, error: { message: "down" } } : { data: null, error: null })
    const res = await app.inject({ method: "GET", url: "/v1/trends", headers: as() })
    expect(res.statusCode).toBe(200)
    expect(res.json().data[0].name).toBe("Neon Dance")
  })
})

// ── detail ─────────────────────────────────────────────────────────────────

describe("GET /v1/trends/:slug", () => {
  it("returns the published version's page with nothing hidden", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/trends/neon-dance", headers: as() })
    expect(res.statusCode).toBe(200)
    const d = res.json().data
    expect(d).toMatchObject({
      id: T_PUB, slug: "neon-dance", version: 2, previewSec: 4,
      resolutions: ["480p", "720p", "1080p"], durationSec: 12, isFavorite: false,
    })
    expect(d.slots).toEqual([
      { key: "lead", label: "Lead dancer", kind: "person", required: true, hint: "A clear face", defaults: { hair: "original" } },
      { key: "place", label: "Place", kind: "location", required: false },
    ])
    expect(d.examples).toEqual([
      {
        videoUrl: "https://cdn.example/ex1.mp4",
        posterUrl: "https://cdn.example/ex1.jpg",
        width: 720,
        height: 1280,
        slots: { lead: ["https://cdn.example/ex1-lead.png"], place: ["https://cdn.example/ex1-place.png"] },
      },
    ])
    expectNoHidden(res.body)
  })

  it("previewSec is null when the trend offers no preview", async () => {
    mem.trends[0]!.versions[2] = versionData({ previewStart: null })
    const res = await app.inject({ method: "GET", url: "/v1/trends/neon-dance", headers: as() })
    expect(res.json().data.previewSec).toBeNull()
  })

  it("a draft, an unpublished or an unknown slug is a 404", async () => {
    for (const slug of ["wip", "old", "nope", "Bad_Slug"]) {
      const res = await app.inject({ method: "GET", url: `/v1/trends/${slug}`, headers: as() })
      expect(res.statusCode, slug).toBe(404)
      expect(res.json().error.code).toBe("not_found")
    }
  })
})

// ── favorites ──────────────────────────────────────────────────────────────

describe("favorites", () => {
  it("PUT then GET gives isFavorite: true; favorites=1 lists only the caller's favorites", async () => {
    mem.trends.push(trend(T_PET, "pet-party", "published", 1))
    const put = await app.inject({ method: "PUT", url: "/v1/trends/neon-dance/favorite", headers: as() })
    expect(put.statusCode).toBe(204)

    const detail = await app.inject({ method: "GET", url: "/v1/trends/neon-dance", headers: as() })
    expect(detail.json().data.isFavorite).toBe(true)

    const all = await app.inject({ method: "GET", url: "/v1/trends", headers: as() })
    expect(all.json().data.map((c: { slug: string; isFavorite: boolean }) => [c.slug, c.isFavorite])).toEqual([
      ["neon-dance", true],
      ["pet-party", false],
    ])

    const favs = await app.inject({ method: "GET", url: "/v1/trends?favorites=1", headers: as() })
    expect(favs.json().data.map((c: { slug: string }) => c.slug)).toEqual(["neon-dance"])
    expect(favs.json().data[0].isFavorite).toBe(true)
    expect(mem.listCalls.at(-1)).toMatchObject({ favoritesOf: USER })
  })

  it("DELETE removes it", async () => {
    await app.inject({ method: "PUT", url: "/v1/trends/neon-dance/favorite", headers: as() })
    const del = await app.inject({ method: "DELETE", url: "/v1/trends/neon-dance/favorite", headers: as() })
    expect(del.statusCode).toBe(204)
    const detail = await app.inject({ method: "GET", url: "/v1/trends/neon-dance", headers: as() })
    expect(detail.json().data.isFavorite).toBe(false)
  })

  it("a draft or unpublished trend cannot be favorited (404)", async () => {
    for (const slug of ["wip", "old"]) {
      const res = await app.inject({ method: "PUT", url: `/v1/trends/${slug}/favorite`, headers: as() })
      expect(res.statusCode).toBe(404)
    }
    expect(mem.favorites.size).toBe(0)
  })

  it("an OAuth app needs assets:write", async () => {
    const res = await app.inject({ method: "PUT", url: "/v1/trends/neon-dance/favorite", headers: as({ "x-app-scopes": "jobs:read" }) })
    expect(res.statusCode).toBe(403)
    expect(mem.favorites.size).toBe(0)
  })
})

// ── run ────────────────────────────────────────────────────────────────────

describe("POST /v1/trends/:slug/runs", () => {
  it("dispatches Cast Swap as an internal request as the caller and answers 202 { data: { jobId } }", async () => {
    db.respond = (q) => (q.table === "generation_sessions" ? { data: { id: SESSION }, error: null } : { data: null, error: null })
    const res = await app.inject({
      method: "POST",
      url: "/v1/trends/neon-dance/runs",
      headers: as({ "idempotency-key": "tools-run-42" }),
      payload: { ...RUN_BODY, details: "wave at {slot:lead}", sessionId: SESSION },
    })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ data: { jobId: "00000000-0000-4000-8000-0000000000j1" } })

    expect(engine.calls).toHaveLength(1)
    const call = engine.calls[0]!
    expect(call.url).toBe("/v1/cast-swap")
    expect(call.headers["x-internal-orchestrator-secret"]).toBe(SECRET)
    expect(call.headers["x-internal-user-id"]).toBe(USER)
    expect(call.headers["idempotency-key"]).toBe("tools-run-42")
    expect(call.body.origin).toBe("trends")
    expect(call.body.sessionId).toBe(SESSION)
    expect(call.body).not.toHaveProperty("userId")
    // The engine gets the hidden parts; the display is the public record.
    expect(call.body.videoUrl).toBe(SOURCE)
    expect(call.body.postPrompt).toBe(`${PROMPT}\n\nwave at {role:1}`)
    const display = (call.body.trendRun as { display: Record<string, unknown> }).display
    expect(display).toMatchObject({
      trend: { id: T_PUB, slug: "neon-dance", version: 2, name: "Neon Dance" },
      example: 1,
      details: "wave at {slot:lead}",
    })
    expect(JSON.stringify(display)).not.toContain(SOURCE)
    expect(JSON.stringify(display)).not.toContain(ROLE)

    // The session was checked as the caller's own before the dispatch.
    const [session] = db.log.filter((q) => q.table === "generation_sessions")
    expect(has(session!, "eq", "id", SESSION)).toBe(true)
    expect(has(session!, "eq", "user_id", USER)).toBe(true)
  })

  it("a missing required slot is a 400 missing_slot naming the slot, with no dispatch", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/trends/neon-dance/runs", headers: as(), payload: { slots: {} } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatchObject({ code: "missing_slot", slot: "lead" })
    expect(engine.calls).toHaveLength(0)
  })

  it("an unknown slot is a 400 unknown_slot", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/trends/neon-dance/runs", headers: as(),
      payload: { slots: { ...RUN_BODY.slots, ghost: { images: ["https://u.example/x.png"] } } },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatchObject({ code: "unknown_slot", slot: "ghost" })
  })

  it("4 images in one slot is a 400 before anything else", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/trends/neon-dance/runs", headers: as(),
      payload: { slots: { lead: { images: [1, 2, 3, 4].map((i) => `https://u.example/${i}.png`) } } },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(engine.calls).toHaveLength(0)
  })

  it("prompt_too_long says the details are too long without revealing the composed length", async () => {
    mem.trends[0]!.versions[2] = versionData({ trendPrompt: "p".repeat(3000) })
    const res = await app.inject({
      method: "POST", url: "/v1/trends/neon-dance/runs", headers: as(),
      payload: { ...RUN_BODY, details: "d".repeat(1000) },
    })
    expect(res.statusCode).toBe(400)
    const err = res.json().error
    expect(err.code).toBe("prompt_too_long")
    expect(err.message).not.toMatch(/\d/)
    expect(engine.calls).toHaveLength(0)
  })

  it("a published trend with no source clip is a 503 trend_unavailable", async () => {
    mem.trends[0]!.versions[2] = versionData({ source: null })
    const res = await app.inject({ method: "POST", url: "/v1/trends/neon-dance/runs", headers: as(), payload: RUN_BODY })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("trend_unavailable")
  })

  it("an engine lacking pet is a 503 engine_unsupported, with no internal POST", async () => {
    mem.trends.push(trend(T_PET, "pet-party", "published", 1, versionData({
      slots: [{ key: "dog", label: { en: "Dog" }, kind: "pet", required: true, roleName: "HIDDEN-ROLE the dog" }],
      examples: [{ ...versionData().examples[0]!, slots: { dog: ["https://cdn.example/dog.png"] } }],
    })))
    setPluginSupports({ castSwap: { ...CAST_SWAP_ALL, roleKinds: ["person", "location", "product"], resolutions: [...CAST_SWAP_ALL.resolutions] } })
    const res = await app.inject({
      method: "POST", url: "/v1/trends/pet-party/runs", headers: as(),
      payload: { slots: { dog: { images: ["https://u.example/dog.png"] } } },
    })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("engine_unsupported")
    expect(engine.calls).toHaveLength(0)
  })

  it("an engine without trendRun, fixed references or the resolution is engine_unsupported", async () => {
    const cases: Array<[Record<string, unknown>, Record<string, unknown>]> = [
      [{ trendRun: false }, {}],
      [{ fixedReferences: false }, {}],
      [{ resolutions: ["480p"] }, { resolution: "1080p" }],
    ]
    for (const [over, req] of cases) {
      setPluginSupports({ castSwap: { ...CAST_SWAP_ALL, roleKinds: [...CAST_SWAP_ALL.roleKinds], resolutions: [...CAST_SWAP_ALL.resolutions], ...over } as never })
      const res = await app.inject({ method: "POST", url: "/v1/trends/neon-dance/runs", headers: as(), payload: { ...RUN_BODY, ...req } })
      expect(res.statusCode, JSON.stringify(over)).toBe(503)
      expect(res.json().error.code).toBe("engine_unsupported")
    }
    _resetPluginSupportsForTests() // no castSwap declared at all (production before Phase 1)
    const none = await app.inject({ method: "POST", url: "/v1/trends/neon-dance/runs", headers: as(), payload: RUN_BODY })
    expect(none.statusCode).toBe(503)
    expect(engine.calls).toHaveLength(0)
  })

  it("a draft or unpublished trend is a 404 on run and estimate", async () => {
    for (const slug of ["wip", "old", "nope"]) {
      for (const path of ["runs", "estimate"]) {
        const res = await app.inject({ method: "POST", url: `/v1/trends/${slug}/${path}`, headers: as(), payload: RUN_BODY })
        expect(res.statusCode, `${slug}/${path}`).toBe(404)
      }
    }
    expect(engine.calls).toHaveLength(0)
  })

  it("a session that is not the caller's is a 404, with no dispatch", async () => {
    db.respond = () => ({ data: null, error: null })
    const res = await app.inject({
      method: "POST", url: "/v1/trends/neon-dance/runs", headers: as(),
      payload: { ...RUN_BODY, sessionId: SESSION },
    })
    expect(res.statusCode).toBe(404)
    expect(engine.calls).toHaveLength(0)
  })

  it("a session id that is not a session id is a 404 too, without a query", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/trends/neon-dance/runs", headers: as(),
      payload: { ...RUN_BODY, sessionId: "not-a-uuid" },
    })
    expect(res.statusCode).toBe(404)
    expect(db.log.filter((q) => q.table === "generation_sessions")).toHaveLength(0)
    expect(engine.calls).toHaveLength(0)
  })

  it("an OAuth app filing into a session needs assets:write (404 without it)", async () => {
    db.respond = (q) => (q.table === "generation_sessions" ? { data: { id: SESSION }, error: null } : { data: null, error: null })
    const res = await app.inject({
      method: "POST", url: "/v1/trends/neon-dance/runs", headers: as({ "x-app-scopes": "workflows:execute" }),
      payload: { ...RUN_BODY, sessionId: SESSION },
    })
    expect(res.statusCode).toBe(404)
    expect(engine.calls).toHaveLength(0)
  })

  it("passes a credit refusal (402) on as the engine gave it", async () => {
    engine.runStatus = 402
    engine.runBody = { error: { code: "insufficient_credits", message: "Not enough credits." } }
    const res = await app.inject({ method: "POST", url: "/v1/trends/neon-dance/runs", headers: as(), payload: RUN_BODY })
    expect(res.statusCode).toBe(402)
    expect(res.json()).toEqual({ error: { code: "insufficient_credits", message: "Not enough credits." } })
  })

  it("an Idempotency-Key outside 8–200 characters is a 400 here, with no dispatch", async () => {
    for (const key of ["short", "k".repeat(201)]) {
      const res = await app.inject({ method: "POST", url: "/v1/trends/neon-dance/runs", headers: as({ "idempotency-key": key }), payload: RUN_BODY })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect(engine.calls).toHaveLength(0)
  })

  it("an OAuth app needs workflows:execute", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/trends/neon-dance/runs", headers: as({ "x-app-scopes": "jobs:read" }), payload: RUN_BODY })
    expect(res.statusCode).toBe(403)
    expect(engine.calls).toHaveLength(0)
  })
})

// ── estimate ───────────────────────────────────────────────────────────────

describe("POST /v1/trends/:slug/estimate", () => {
  it("posts the composed body to the Cast Swap estimate and maps hold and expected", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/trends/neon-dance/estimate", headers: as(), payload: RUN_BODY })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { expectedCredits: 120, holdCredits: 120, breakdown: { castSwap: 40, seedance: 80 } } })
    expect(engine.calls[0]!.url).toBe("/v1/cast-swap/estimate")
    expect(engine.calls[0]!.headers["x-internal-user-id"]).toBe(USER)
    expect(engine.calls[0]!.body.videoUrl).toBe(SOURCE)
    expectNoHidden(res.body)
  })

  it("uses the engine's expectedCredits when it gives one", async () => {
    engine.estimateBody = { totalCredits: 120, expectedCredits: 70, breakdown: { castSwap: 40, seedance: 80 }, settlesLower: true }
    const res = await app.inject({ method: "POST", url: "/v1/trends/neon-dance/estimate", headers: as(), payload: RUN_BODY })
    expect(res.json().data).toMatchObject({ expectedCredits: 70, holdCredits: 120 })
  })

  it("keeps only the breakdown's numeric entries", async () => {
    engine.estimateBody = {
      totalCredits: 120,
      breakdown: { castSwap: 40, seedance: 80, note: PROMPT, nested: { x: 1 }, nothing: null, text: "12" },
    }
    const res = await app.inject({ method: "POST", url: "/v1/trends/neon-dance/estimate", headers: as(), payload: RUN_BODY })
    expect(res.json().data.breakdown).toEqual({ castSwap: 40, seedance: 80 })
    expectNoHidden(res.body)
  })

  it("a slot error is a 400 here too", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/trends/neon-dance/estimate", headers: as(), payload: { slots: {} } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatchObject({ code: "missing_slot", slot: "lead" })
  })
})

// ── engine refusals (never relayed verbatim) ───────────────────────────────

describe("an engine refusal on estimate and run", () => {
  const ROUTES = [
    { name: "estimate", url: "/v1/trends/neon-dance/estimate", set: (status: number, body: unknown) => { engine.estimateStatus = status; engine.estimateBody = body } },
    { name: "run", url: "/v1/trends/neon-dance/runs", set: (status: number, body: unknown) => { engine.runStatus = status; engine.runBody = body } },
  ]

  for (const route of ROUTES) {
    it(`${route.name}: a 400 is trend_run_rejected, without the engine's message or issues`, async () => {
      route.set(400, {
        error: {
          code: "validation_error",
          message: `roles.0.name: "${ROLE}" is too long; videoUrl ${SOURCE} rejected (${PROMPT})`,
          issues: [{ path: ["roles", 0, "name"], message: ROLE }, { path: ["videoUrl"], message: SOURCE }],
        },
      })
      const res = await app.inject({ method: "POST", url: route.url, headers: as(), payload: RUN_BODY })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: { code: "trend_run_rejected", message: "This trend couldn't run with these inputs." } })
      expect(res.body).not.toContain("issues")
      expect(res.body).not.toContain("roles.0.name")
      expectNoHidden(res.body)
    })

    it(`${route.name}: an allowlisted 400 keeps its code with the platform's own text`, async () => {
      route.set(400, { error: { code: "clip_out_of_range", message: `${SOURCE} is 41 s`, issues: [{ path: ["videoUrl"] }] } })
      const res = await app.inject({ method: "POST", url: route.url, headers: as(), payload: RUN_BODY })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("clip_out_of_range")
      expect(Object.keys(res.json().error).sort()).toEqual(["code", "message"])
      expectNoHidden(res.body)
    })

    it(`${route.name}: 503 host_too_old is engine_unsupported`, async () => {
      route.set(503, { error: { code: "host_too_old", message: `host build 12 cannot run ${SOURCE}` } })
      const res = await app.inject({ method: "POST", url: route.url, headers: as(), payload: RUN_BODY })
      expect(res.statusCode).toBe(503)
      expect(res.json()).toEqual({ error: { code: "engine_unsupported", message: "Trends are not available on this platform version yet." } })
    })

    it(`${route.name}: 422 job_blocked keeps its code with fixed text`, async () => {
      route.set(422, { error: { code: "job_blocked", message: `Blocked: ${ROLE}`, reason: ROLE } })
      const res = await app.inject({ method: "POST", url: route.url, headers: as(), payload: RUN_BODY })
      expect(res.statusCode).toBe(422)
      expect(res.json()).toEqual({ error: { code: "job_blocked", message: "This run was blocked by the job policy." } })
      expectNoHidden(res.body)
    })

    it(`${route.name}: any other engine 5xx is a 502 engine_error`, async () => {
      route.set(500, { error: { code: "internal_error", message: `failed on ${SOURCE}` } })
      const res = await app.inject({ method: "POST", url: route.url, headers: as(), payload: RUN_BODY })
      expect(res.statusCode).toBe(502)
      expect(res.json().error.code).toBe("engine_error")
      expectNoHidden(res.body)
    })
  }
})

// ── a database without the trend tables (staging ahead of main) ──────────

describe("before migration 549 reaches the database", () => {
  it("the catalog and a trend's routes answer 503 not_available, not 500", async () => {
    mem.missingTables = true
    for (const [method, url] of [["GET", "/v1/trends"], ["GET", "/v1/trends/neon-dance"], ["POST", "/v1/trends/neon-dance/estimate"], ["PUT", "/v1/trends/neon-dance/favorite"]] as const) {
      const res = await app.inject({ method, url, headers: as(), ...(method === "POST" ? { payload: RUN_BODY } : {}) })
      expect(res.statusCode, `${method} ${url}`).toBe(503)
      expect(res.json().error.code).toBe("not_available")
    }
  })
})

// ── runs ───────────────────────────────────────────────────────────────────

const DRAFT_JOB = "00000000-0000-4000-8000-0000000000d1"
const FQ_JOB = "00000000-0000-4000-8000-0000000000f1"
const HD_JOB = "00000000-0000-4000-8000-0000000000e1"
const FAILED_JOB = "00000000-0000-4000-8000-0000000000e2"

function runInput(over: Record<string, unknown> = {}) {
  return {
    type: "cast-swap",
    origin: "trends",
    trend: { id: T_PUB, slug: "neon-dance", version: 2, name: "Neon Dance" },
    example: 1,
    slots: [
      { key: "lead", label: "Lead dancer", kind: "person", images: ["https://u.example/me.png"], fromExample: false, body: "new", outfit: "new", hair: "original" },
      { key: "place", label: "Place", kind: "location", images: ["https://cdn.example/ex1-place.png"], fromExample: true },
    ],
    details: "wave at {slot:lead}",
    preview: false,
    previewStart: 2,
    resolution: "480p",
    draft: true,
    sourceDurationSec: 12,
    __videoUrl: SOURCE,
    __roles: [{ kind: "person", name: ROLE, images: ["https://u.example/me.png"] }],
    __references: [{ images: [REF_IMAGE], line: REF_LINE }],
    __postPrompt: PROMPT,
    ...over,
  }
}

function jobRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    status: "completed",
    progress: 100,
    input_data: runInput(),
    output_data: { videoUrl: `https://out.example/${id}.mp4`, preview: false, __castSwapChildJobId: "child-1" },
    error_message: null,
    error_hint: null,
    created_at: "2026-10-20T10:00:00.000000+00:00",
    started_at: "2026-10-20T09:58:00.000000+00:00",
    completed_at: "2026-10-20T10:00:00.000000+00:00",
    usage_log_id: `ul-${id}`,
    ...over,
  }
}

function feed(rows: unknown[], fq: unknown[] = [], usage: Array<Record<string, unknown>> = []) {
  db.respond = (q) => {
    if (q.table === "usage_logs") return { data: usage, error: null }
    if (q.table !== "jobs") return { data: null, error: null }
    const isFq = q.ops.some((op) => op.m === "in" && op.a[0] === "input_data->>fullQualityOf")
    return { data: isFq ? fq : rows, error: null }
  }
}

describe("GET /v1/trends/runs", () => {
  it("is not captured by /:slug", async () => {
    feed([])
    const res = await app.inject({ method: "GET", url: "/v1/trends/runs", headers: as() })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [], next: null })
  })

  it("reads the caller's trend runs, excluding Full Quality rows, newest first", async () => {
    feed([])
    await app.inject({ method: "GET", url: "/v1/trends/runs?trend=neon-dance&limit=5", headers: as() })
    const [q] = db.log.filter((x) => x.table === "jobs")
    expect(has(q!, "eq", "user_id", USER)).toBe(true)
    expect(has(q!, "filter", "input_data->>type", "eq", "cast-swap")).toBe(true)
    expect(has(q!, "not", "input_data->trend", "is", null)).toBe(true)
    expect(has(q!, "is", "input_data->>fullQualityOf", null)).toBe(true)
    expect(has(q!, "filter", "input_data->trend->>slug", "eq", "neon-dance")).toBe(true)
    expect(has(q!, "order", "created_at", { ascending: false })).toBe(true)
    expect(argOf(q!, "limit")).toEqual([6])
  })

  it("maps runs to the public whitelist: no __ key, no source clip, FQ folded into its draft", async () => {
    feed(
      [
        jobRow(DRAFT_JOB),
        jobRow(HD_JOB, { input_data: runInput({ resolution: "720p", draft: false }), created_at: "2026-10-19T10:00:00.000000+00:00" }),
        jobRow(FAILED_JOB, {
          status: "failed", progress: 40, output_data: null, completed_at: null,
          error_message: "Seedance refused the clip.", created_at: "2026-10-18T10:00:00.000000+00:00",
        }),
      ],
      [
        jobRow(FQ_JOB, {
          status: "processing", progress: 10, output_data: { __checkpoint: { child: "x" } }, completed_at: null,
          input_data: runInput({ fullQualityOf: DRAFT_JOB, resolution: "1080p", draft: false }),
        }),
      ],
      [{ id: `ul-${DRAFT_JOB}`, status: "committed", credits_used: 120, credits_charged: 95 }],
    )
    const res = await app.inject({ method: "GET", url: "/v1/trends/runs", headers: as() })
    expect(res.statusCode).toBe(200)
    const runs = res.json().data
    expect(runs.map((r: { jobId: string }) => r.jobId)).toEqual([DRAFT_JOB, HD_JOB, FAILED_JOB])

    expect(runs[0]).toEqual({
      jobId: DRAFT_JOB,
      status: "completed",
      progress: 100,
      error: null,
      createdAt: "2026-10-20T10:00:00.000000+00:00",
      completedAt: "2026-10-20T10:00:00.000000+00:00",
      trend: { id: T_PUB, slug: "neon-dance", version: 2, name: "Neon Dance" },
      example: 1,
      slots: runInput().slots,
      details: "wave at {slot:lead}",
      preview: false,
      resolution: "480p",
      draft: true,
      videoUrl: `https://out.example/${DRAFT_JOB}.mp4`,
      posterUrl: null,
      creditsCharged: 95,
      fullQuality: { jobId: FQ_JOB, status: "processing", videoUrl: null },
      fullQualityUntil: "2026-10-27T10:00:00.000Z",
    })
    expect(runs[1]).toMatchObject({ jobId: HD_JOB, draft: false, fullQuality: null, fullQualityUntil: null })
    expect(runs[2]).toMatchObject({
      jobId: FAILED_JOB, status: "failed", progress: 40, videoUrl: null, fullQualityUntil: null,
      error: { code: "failed", message: "This run didn't finish." },
    })
    expect(res.body).not.toContain("Seedance refused the clip.")

    // The Full Quality job is never listed on its own, and nothing hidden leaks.
    expect(runs.some((r: { jobId: string }) => r.jobId === FQ_JOB)).toBe(false)
    expectNoHidden(res.body)
    for (const r of runs) expect(r.videoUrl).not.toBe(SOURCE)

    // The page's Full Quality rows were read for the drafts only.
    const fqQuery = db.log.find((q) => q.table === "jobs" && q.ops.some((op) => op.m === "in"))!
    expect(has(fqQuery, "eq", "user_id", USER)).toBe(true)
    expect(argOf(fqQuery, "in")).toEqual(["input_data->>fullQualityOf", [DRAFT_JOB, HD_JOB, FAILED_JOB]])
  })

  it("whitelists the stamp and each slot: an extra field in them never passes", async () => {
    const [lead, place] = runInput().slots
    feed([jobRow(DRAFT_JOB, {
      input_data: runInput({
        trend: { id: T_PUB, slug: "neon-dance", version: 2, name: "Neon Dance", source: SOURCE },
        slots: [{ ...lead, roleName: ROLE }, place],
        trendPrompt: PROMPT,
      }),
    })])
    const res = await app.inject({ method: "GET", url: "/v1/trends/runs", headers: as() })
    const run = res.json().data[0]
    expect(run.slots).toEqual(runInput().slots)
    expect(run.trend).toEqual({ id: T_PUB, slug: "neon-dance", version: 2, name: "Neon Dance" })
    expectNoHidden(res.body)
  })

  it("an error message that quotes a hidden input is replaced", async () => {
    feed([jobRow(FAILED_JOB, { status: "failed", output_data: null, completed_at: null, error_message: `Could not download ${SOURCE}` })])
    const res = await app.inject({ method: "GET", url: "/v1/trends/runs", headers: as() })
    expect(res.json().data[0].error.message).toBeTruthy()
    expectNoHidden(res.body)
  })

  it("a failure message is never passed on, even one quoting only part of a hidden input", async () => {
    feed([jobRow(FAILED_JOB, {
      status: "failed", output_data: null, completed_at: null,
      error_message: "Could not download HIDDEN-SOURCE.mp4 for HIDDEN-ROLE the woman",
      error_hint: { kind: "something-internal", detail: "x" },
    })])
    const res = await app.inject({ method: "GET", url: "/v1/trends/runs", headers: as() })
    expect(res.json().data[0].error).toEqual({ code: "failed", message: "This run didn't finish." })
    expect(res.body).not.toContain("HIDDEN")
  })

  it("a run that did not fail has no error, even with a stale error_message", async () => {
    feed([
      jobRow(DRAFT_JOB, { error_message: "transient: retried" }),
      jobRow(HD_JOB, { status: "processing", output_data: null, completed_at: null, error_message: "retrying" }),
    ])
    const res = await app.inject({ method: "GET", url: "/v1/trends/runs", headers: as() })
    expect(res.json().data.map((r: { error: unknown }) => r.error)).toEqual([null, null])
  })

  it("a known public failure kind is kept as the code", async () => {
    feed([jobRow(FAILED_JOB, {
      status: "failed", output_data: null, completed_at: null,
      error_message: "Blocked by the safety filter.", error_hint: { kind: "safety-block", class: "x", retried: false },
    })])
    const res = await app.inject({ method: "GET", url: "/v1/trends/runs", headers: as() })
    expect(res.json().data[0].error).toEqual({ code: "safety-block", message: "This run didn't finish." })
  })

  it("a run that ran out of credits partway has the code `credits` (the message stays the fixed sentence)", async () => {
    feed([jobRow(FAILED_JOB, {
      status: "failed", output_data: null, completed_at: null,
      error_message: "You don't have enough credits to finish this run. Top up and try again.",
      error_hint: { kind: "credits", code: "insufficient_credits" },
    })])
    const res = await app.inject({ method: "GET", url: "/v1/trends/runs", headers: as() })
    expect(res.json().data[0].error).toEqual({ code: "credits", message: "This run didn't finish." })
  })

  it("a run whose trend was unpublished since still reads back (the stamp, not the catalog)", async () => {
    mem.trends = []
    feed([jobRow(DRAFT_JOB)])
    const res = await app.inject({ method: "GET", url: "/v1/trends/runs", headers: as() })
    expect(res.json().data[0].trend).toEqual({ id: T_PUB, slug: "neon-dance", version: 2, name: "Neon Dance" })
  })

  it("pages with a keyset cursor over created_at, id", async () => {
    const rows = [1, 2, 3].map((i) => jobRow(`00000000-0000-4000-8000-00000000000${i}`, { created_at: `2026-10-2${i}T10:00:00.000000+00:00` }))
    feed(rows)
    const first = await app.inject({ method: "GET", url: "/v1/trends/runs?limit=2", headers: as() })
    const { next, data } = first.json()
    expect(data).toHaveLength(2)
    expect(typeof next).toBe("string")
    db.log.length = 0
    await app.inject({ method: "GET", url: `/v1/trends/runs?limit=2&cursor=${next}`, headers: as() })
    const [q] = db.log.filter((x) => x.table === "jobs")
    expect(argOf(q!, "or")![0]).toContain(`created_at.lt."2026-10-22T10:00:00.000000+00:00"`)

    const bad = await app.inject({ method: "GET", url: "/v1/trends/runs?cursor=nope", headers: as() })
    expect(bad.statusCode).toBe(400)
  })

  it("needs jobs:read for an OAuth app", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/trends/runs", headers: as({ "x-app-scopes": "assets:write" }) })
    expect(res.statusCode).toBe(403)
  })
})

// ── spend surface ──────────────────────────────────────────────────────────

describe("the spend surface rides the internal hop (x-web-free-mode)", () => {
  const WEB = { "x-auth-kind": "jwt", origin: "https://tools.nodaro.ai" }
  let before: string | undefined
  beforeEach(() => {
    before = process.env.PAYG_WEB_BLOCK_ENABLED
    process.env.PAYG_WEB_BLOCK_ENABLED = "true"
  })
  afterEach(() => {
    if (before === undefined) delete process.env.PAYG_WEB_BLOCK_ENABLED
    else process.env.PAYG_WEB_BLOCK_ENABLED = before
  })

  it("a browser-session request from the web forwards x-web-free-mode: true on estimate and run", async () => {
    const est = await app.inject({ method: "POST", url: "/v1/trends/neon-dance/estimate", headers: as(WEB), payload: RUN_BODY })
    const run = await app.inject({ method: "POST", url: "/v1/trends/neon-dance/runs", headers: as(WEB), payload: RUN_BODY })
    expect(est.statusCode).toBe(200)
    // Pool-aware, not a hard block (no paygSurfaceGuard, as on 3d-scene's paid
    // run): the run reaches the engine, whose credit guard applies the pool.
    expect(run.statusCode).toBe(202)
    expect(engine.calls.map((c) => [c.url, c.headers["x-web-free-mode"]])).toEqual([
      ["/v1/cast-swap/estimate", "true"],
      ["/v1/cast-swap", "true"],
    ])
  })

  it("an API-key request does not", async () => {
    const api = { "x-auth-kind": "api_token" }
    await app.inject({ method: "POST", url: "/v1/trends/neon-dance/estimate", headers: as(api), payload: RUN_BODY })
    await app.inject({ method: "POST", url: "/v1/trends/neon-dance/runs", headers: as(api), payload: RUN_BODY })
    expect(engine.calls).toHaveLength(2)
    for (const c of engine.calls) expect(c.headers).not.toHaveProperty("x-web-free-mode")
  })

  it("a caller cannot set it through its own header", async () => {
    const forged = { "x-auth-kind": "api_token", "x-web-free-mode": "true" }
    await app.inject({ method: "POST", url: "/v1/trends/neon-dance/runs", headers: as(forged), payload: RUN_BODY })
    expect(engine.calls[0]!.headers).not.toHaveProperty("x-web-free-mode")
  })

  it("with the block off, a web request does not either", async () => {
    process.env.PAYG_WEB_BLOCK_ENABLED = "false"
    await app.inject({ method: "POST", url: "/v1/trends/neon-dance/runs", headers: as(WEB), payload: RUN_BODY })
    expect(engine.calls[0]!.headers).not.toHaveProperty("x-web-free-mode")
  })
})
