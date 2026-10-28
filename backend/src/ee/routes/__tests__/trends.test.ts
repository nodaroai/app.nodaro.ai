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
import type { TrendRow, TrendSlot, TrendVersionData } from "../../lib/trends/types.js"

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
import { resolveRequestOrigin } from "../../../lib/client-origin-scope.js"
import { resolveRequestSession } from "../../../lib/generation-session-scope.js"
import { withJobProvenance } from "../../../lib/insert-job.js"
import { callerGrantOf } from "../../../lib/job-submission-context.js"
import { mcpInject } from "../../../lib/mcp/internal-request.js"
import { newSession } from "../../../lib/mcp/session.js"
import type { Scope } from "../../../lib/scopes.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../lib/private-plugins/supports-registry.js"
import { faceMaskSettingsKey } from "../../lib/trends/face-mask.js"

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
const PRE = "HIDDEN-PRE-PROMPT open on the stage"
/** The 4 s preview's own prompt parts: hidden like the full run's. */
const PREVIEW_ROLE = "HIDDEN-PREVIEW-ROLE the woman"
const PREVIEW_REF_LINE = "HIDDEN-PREVIEW-REF-LINE the sign"
const PREVIEW_PROMPT = "HIDDEN-PREVIEW-PROMPT dance"
const PREVIEW_PRE = "HIDDEN-PREVIEW-PRE on stage"
const HIDDEN = [
  SOURCE, ROLE, REF_IMAGE, REF_LINE, PROMPT, SOURCE_JOB, PRE, PREVIEW_ROLE, PREVIEW_REF_LINE, PREVIEW_PROMPT, PREVIEW_PRE,
  "roleName", "trendPrompt", "sourceJobId", "prePrompt", "faceMasking", "previewRoleName", "previewLine", "previewTrendPrompt", "previewPrePrompt", "__",
]
/** The published trend's masking (hidden like the rest). */
const MASKING = { mode: "auto" as const, fill: "depth" as const, minFaceHeightPct: 12, zone: { topPct: 4 }, threshold: 0.4 }

/** The source's public display copy (its own file, never the source's URL). */
const DISPLAY = {
  videoUrl: "https://cdn.example/trends/t1/display-copy.mp4",
  posterUrl: "https://cdn.example/trends/t1/display-poster.png",
  width: 720,
  height: 1280,
  durationSec: 12.04,
}

const T_PUB = "00000000-0000-4000-8000-0000000000a1"
const T_DRAFT = "00000000-0000-4000-8000-0000000000a2"
const T_UNPUB = "00000000-0000-4000-8000-0000000000a3"
const T_PET = "00000000-0000-4000-8000-0000000000a4"

function versionData(over: Partial<TrendVersionData> = {}): TrendVersionData {
  return {
    name: { en: "Neon Dance", he: "ריקוד ניאון" },
    description: { en: "Dance under neon." },
    source: { videoUrl: SOURCE, durationSec: 12, width: 720, height: 1280, display: DISPLAY },
    previewStart: 2,
    slots: [
      { key: "lead", label: { en: "Lead dancer", he: "רקדנית" }, kind: "person", required: true, hint: { en: "A clear face" }, roleName: ROLE, previewRoleName: PREVIEW_ROLE, defaults: { hair: "original" } },
      { key: "place", label: { en: "Place" }, kind: "location", required: false, roleName: "HIDDEN-ROLE the street" },
    ],
    references: [{ images: [REF_IMAGE], line: REF_LINE, previewLine: PREVIEW_REF_LINE }],
    trendPrompt: PROMPT,
    prePrompt: PRE,
    previewTrendPrompt: PREVIEW_PROMPT,
    previewPrePrompt: PREVIEW_PRE,
    faceMasking: MASKING,
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
  faceMasking: true,
  trendPrePrompt: true,
}

/** What the job funnel would stamp on the engine's job for this request. */
interface Stamps { origin: string | null; sessionId: string | null; source: unknown; sourceDetail: unknown; grant: unknown }

const engine = {
  calls: [] as Array<{ url: string; headers: Record<string, unknown>; body: Record<string, unknown>; stamps?: Stamps }>,
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
    const scopes = req.headers["x-app-scopes"]
    // As the auth hook leaves a request: a signed-in one by default, an OAuth
    // app's when it carries scopes.
    if (typeof user === "string") req.authKind = typeof kind === "string" ? kind as never : typeof scopes === "string" ? "app_token" : "jwt"
    if (typeof scopes === "string") req.appAuthorization = { scopes: scopes.split(" ") } as never
  })
  const record = (url: string) => (req: { headers: Record<string, unknown>; body: unknown }) => {
    engine.calls.push({ url, headers: { ...req.headers }, body: req.body as Record<string, unknown> })
  }
  app.post("/v1/cast-swap", async (req, reply) => {
    record("/v1/cast-swap")(req)
    const row = withJobProvenance(req, {})
    engine.calls[engine.calls.length - 1]!.stamps = {
      origin: resolveRequestOrigin(req),
      sessionId: await resolveRequestSession(req),
      source: row.source,
      sourceDetail: row.source_detail,
      grant: callerGrantOf(req),
    }
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
      original: { videoUrl: DISPLAY.videoUrl, posterUrl: DISPLAY.posterUrl, width: 720, height: 1280 },
      examples: [{ videoUrl: "https://cdn.example/ex1.mp4", posterUrl: "https://cdn.example/ex1.jpg", width: 720, height: 1280 }],
      needs: { person: 1, location: 1, product: 0, pet: 0 },
      durationSec: 12,
      isFavorite: false,
    })
    expectNoHidden(res.body)
  })

  it("a card carries every example's video in order, without its slots, length or source job", async () => {
    const [ex1] = versionData().examples
    mem.trends[0]!.versions[2] = versionData({
      examples: [
        ex1!,
        { videoUrl: "https://cdn.example/ex2.mp4", width: 1280, height: 720, durationSec: 12, slots: { lead: ["https://cdn.example/ex2-lead.png"] }, sourceJobId: SOURCE_JOB },
      ],
    })
    const res = await app.inject({ method: "GET", url: "/v1/trends", headers: as() })
    expect(res.statusCode).toBe(200)
    const [card] = res.json().data
    expect(card.examples).toEqual([
      { videoUrl: "https://cdn.example/ex1.mp4", posterUrl: "https://cdn.example/ex1.jpg", width: 720, height: 1280 },
      { videoUrl: "https://cdn.example/ex2.mp4", width: 1280, height: 720 },
    ])
    for (const ex of card.examples) {
      expect(ex).not.toHaveProperty("slots")
      expect(ex).not.toHaveProperty("durationSec")
    }
    expect(res.body).not.toContain("ex1-lead.png")
    expect(res.body).not.toContain("ex2-lead.png")
    expect(card.cover.videoUrl).toBe("https://cdn.example/ex1.mp4")
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
      engine: "motion-prism", engineName: "Nodaro Motion Prism", resolutions: ["480p", "720p", "1080p"], durationSec: 12, isFavorite: false,
    })
    expect(d.slots).toEqual([
      { key: "lead", label: "Lead dancer", kind: "person", required: true, hint: "A clear face", chips: ["body", "outfit", "hair"], defaults: { hair: "original" } },
      { key: "place", label: "Place", kind: "location", required: false, chips: [] },
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

  it("lists only the chips a slot shows, with the defaults of those only", async () => {
    const [lead, place] = versionData().slots
    mem.trends[0]!.versions[2] = versionData({
      slots: [{ ...lead!, defaults: { hair: "original", outfit: "original" }, chips: ["outfit"] } as TrendSlot, place!],
    })
    const res = await app.inject({ method: "GET", url: "/v1/trends/neon-dance", headers: as() })
    expect(res.json().data.slots[0]).toEqual({
      key: "lead", label: "Lead dancer", kind: "person", required: true, hint: "A clear face", chips: ["outfit"], defaults: { outfit: "original" },
    })

    mem.trends[0]!.versions[2] = versionData({ slots: [{ ...lead!, chips: [] } as TrendSlot, place!] })
    const none = await app.inject({ method: "GET", url: "/v1/trends/neon-dance", headers: as() })
    expect(none.json().data.slots[0]).toEqual({ key: "lead", label: "Lead dancer", kind: "person", required: true, hint: "A clear face", chips: [] })
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

// ── the original (the source's display copy) ──────────────────────────────

describe("GET /v1/trends/:slug — the original", () => {
  const ORIGINAL = { videoUrl: DISPLAY.videoUrl, posterUrl: DISPLAY.posterUrl, width: 720, height: 1280, durationSec: 12.04 }
  const noDisplay = () => ({ videoUrl: SOURCE, durationSec: 12, width: 720, height: 1280 })

  it("returns the display copy as `original`, with the preview's start, and never the source clip", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/trends/neon-dance", headers: as() })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.original).toEqual({ ...ORIGINAL, previewStartSec: 2 })
    expectNoHidden(res.body)
  })

  it("sends previewStartSec 0 when the preview starts at 0, and none when the trend has no preview", async () => {
    mem.trends[0]!.versions[2] = versionData({ previewStart: 0 })
    let d = (await app.inject({ method: "GET", url: "/v1/trends/neon-dance", headers: as() })).json().data
    expect(d.previewSec).toBe(4)
    expect(d.original).toEqual({ ...ORIGINAL, previewStartSec: 0 })

    mem.trends[0]!.versions[2] = versionData({ previewStart: null })
    d = (await app.inject({ method: "GET", url: "/v1/trends/neon-dance", headers: as() })).json().data
    expect(d.previewSec).toBeNull()
    expect(d.original).toEqual(ORIGINAL)
    expect(d.original).not.toHaveProperty("previewStartSec")
  })

  it("leaves out `original` on a version whose source has no display copy (its cover stays Example 1)", async () => {
    mem.trends[0]!.versions[2] = versionData({ source: noDisplay() })
    const res = await app.inject({ method: "GET", url: "/v1/trends/neon-dance", headers: as() })
    expect(res.statusCode).toBe(200)
    const d = res.json().data
    expect(d).not.toHaveProperty("original")
    expect(d.cover.videoUrl).toBe("https://cdn.example/ex1.mp4")
    expectNoHidden(res.body)

    const list = await app.inject({ method: "GET", url: "/v1/trends", headers: as() })
    const [card] = list.json().data
    expect(card).not.toHaveProperty("original")
    expect(card.cover.videoUrl).toBe("https://cdn.example/ex1.mp4")
    expect(card.examples).toEqual([{ videoUrl: "https://cdn.example/ex1.mp4", posterUrl: "https://cdn.example/ex1.jpg", width: 720, height: 1280 }])
    expectNoHidden(list.body)
  })

  it("the card's `original` is the page's display copy, without its length or preview start", async () => {
    const [card] = (await app.inject({ method: "GET", url: "/v1/trends", headers: as() })).json().data
    const d = (await app.inject({ method: "GET", url: "/v1/trends/neon-dance", headers: as() })).json().data
    expect(card.original).toEqual({ videoUrl: d.original.videoUrl, posterUrl: d.original.posterUrl, width: d.original.width, height: d.original.height })
    expect(card.original).not.toHaveProperty("durationSec")
    expect(card.original).not.toHaveProperty("previewStartSec")
  })

  it("a trend with no example has a card and a page, the cover being the original's display copy", async () => {
    mem.trends[0]!.versions[2] = versionData({ examples: [] })
    const list = await app.inject({ method: "GET", url: "/v1/trends", headers: as() })
    expect(list.statusCode).toBe(200)
    const [card] = list.json().data
    expect(card.slug).toBe("neon-dance")
    expect(card.cover).toEqual({ videoUrl: DISPLAY.videoUrl, posterUrl: DISPLAY.posterUrl, width: 720, height: 1280 })
    expect(card.original).toEqual(card.cover)
    expect(card.examples).toEqual([])
    expect(card.durationSec).toBe(12)
    expectNoHidden(list.body)

    const res = await app.inject({ method: "GET", url: "/v1/trends/neon-dance", headers: as() })
    expect(res.statusCode).toBe(200)
    const d = res.json().data
    expect(d.examples).toEqual([])
    expect(d.cover).toEqual(card.cover)
    expect(d.original).toEqual({ ...ORIGINAL, previewStartSec: 2 })
    expectNoHidden(res.body)
  })

  it("a version with no example and no display copy has no card and no page", async () => {
    mem.trends[0]!.versions[2] = versionData({ examples: [], source: noDisplay() })
    const list = await app.inject({ method: "GET", url: "/v1/trends", headers: as() })
    expect(list.json().data).toEqual([])
    const res = await app.inject({ method: "GET", url: "/v1/trends/neon-dance", headers: as() })
    expect(res.statusCode).toBe(404)
  })

  it("passes a slot's hint picture through", async () => {
    const [lead, place] = versionData().slots
    mem.trends[0]!.versions[2] = versionData({
      slots: [{ ...lead!, hintImageUrl: "https://cdn.example/trends/t1/hint-lead.png" } as TrendSlot, place!],
    })
    const d = (await app.inject({ method: "GET", url: "/v1/trends/neon-dance", headers: as() })).json().data
    expect(d.slots[0].hintImageUrl).toBe("https://cdn.example/trends/t1/hint-lead.png")
    expect(d.slots[1]).not.toHaveProperty("hintImageUrl")
  })
})

describe("a run of a trend with no example", () => {
  beforeEach(() => {
    mem.trends[0]!.versions[2] = versionData({ examples: [] })
  })

  it("runs with an empty optional slot kept as in the original, and records example 0", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/trends/neon-dance/runs", headers: as(), payload: RUN_BODY })
    expect(res.statusCode).toBe(202)
    const call = engine.calls[0]!
    const roles = call.body.roles as Array<{ kind: string; images: string[] }>
    expect(roles.map((r) => [r.kind, r.images])).toEqual([
      ["person", ["https://u.example/me.png"]],
      ["location", []],
    ])
    const display = (call.body.trendRun as { display: Record<string, unknown> }).display
    expect(display.example).toBe(0)
    expect(display.slots).toMatchObject([
      { key: "lead", images: ["https://u.example/me.png"], fromExample: false },
      { key: "place", images: [], fromExample: false },
    ])
  })

  it("quotes the same run", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/trends/neon-dance/estimate", headers: as(), payload: RUN_BODY })
    expect(res.statusCode).toBe(200)
    expect((engine.calls[0]!.body.roles as Array<{ images: string[] }>)[1]!.images).toEqual([])
  })

  it("refuses an explicit example (the trend has none)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/trends/neon-dance/runs", headers: as(), payload: { ...RUN_BODY, example: 1 } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("example_out_of_range")
    expect(engine.calls).toHaveLength(0)
  })
})

describe("a trend whose example kept an optional slot as in the original", () => {
  beforeEach(() => {
    const [ex1] = versionData().examples
    mem.trends[0]!.versions[2] = versionData({ examples: [{ ...ex1!, slots: { lead: ex1!.slots.lead! } }] })
  })

  it("shows the example with no key for that slot", async () => {
    const d = (await app.inject({ method: "GET", url: "/v1/trends/neon-dance", headers: as() })).json().data
    expect(d.examples).toEqual([
      { videoUrl: "https://cdn.example/ex1.mp4", posterUrl: "https://cdn.example/ex1.jpg", width: 720, height: 1280, slots: { lead: ["https://cdn.example/ex1-lead.png"] } },
    ])
    expectNoHidden(JSON.stringify(d))
  })

  it("runs with that slot left empty sent with no pictures (kept as in the original), recording example 1", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/trends/neon-dance/runs", headers: as(), payload: RUN_BODY })
    expect(res.statusCode).toBe(202)
    const call = engine.calls[0]!
    expect((call.body.roles as Array<{ kind: string; images: string[] }>).map((r) => [r.kind, r.images])).toEqual([
      ["person", ["https://u.example/me.png"]],
      ["location", []],
    ])
    const display = (call.body.trendRun as { display: Record<string, unknown> }).display
    expect(display.example).toBe(1)
    expect(display.slots).toMatchObject([
      { key: "lead", images: ["https://u.example/me.png"], fromExample: false },
      { key: "place", images: [], fromExample: false },
    ])
  })

  it("quotes the same run", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/trends/neon-dance/estimate", headers: as(), payload: RUN_BODY })
    expect(res.statusCode).toBe(200)
    expect((engine.calls[0]!.body.roles as Array<{ images: string[] }>)[1]!.images).toEqual([])
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
    expect(call.headers["content-type"]).toBe("application/json")
    // Provenance never rides the relayed body: the job's origin and session
    // come from the server-side scope (a run is filed in no session).
    expect(call.body).not.toHaveProperty("origin")
    expect(call.body).not.toHaveProperty("sessionId")
    expect(call.stamps).toMatchObject({ origin: null, sessionId: null })
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

  it("a 4 s preview run sends the preview's own prompt parts to the engine, and none of them back", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/trends/neon-dance/runs", headers: as(), payload: { ...RUN_BODY, preview: true } })
    expect(res.statusCode).toBe(202)
    expectNoHidden(res.body)
    const body = engine.calls[0]!.body as { roles: Array<{ name: string }>; references: Array<{ line: string }>; prePrompt?: string; postPrompt?: string }
    // The lead's preview role name; the place has none of its own, so it keeps its role name.
    expect(body.roles.map((r) => r.name)).toEqual([PREVIEW_ROLE, "HIDDEN-ROLE the street"])
    expect(body.references.map((r) => r.line)).toEqual([PREVIEW_REF_LINE])
    expect(body.prePrompt).toBe(PREVIEW_PRE)
    expect(body.postPrompt).toBe(PREVIEW_PROMPT)
    expectNoHidden(JSON.stringify((body as { trendRun?: unknown }).trendRun))
  })

  it("a full run sends the full run's prompt parts only, even after a preview", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/trends/neon-dance/runs",
      headers: as(),
      payload: { ...RUN_BODY, resolution: "1080p", previewJobId: "00000000-0000-4000-8000-0000000000b9" },
    })
    expect(res.statusCode).toBe(202)
    const body = engine.calls.at(-1)!.body as { roles: Array<{ name: string }>; references: Array<{ line: string }>; prePrompt?: string; postPrompt?: string }
    expect(body.roles.map((r) => r.name)).toEqual([ROLE, "HIDDEN-ROLE the street"])
    expect(body.references.map((r) => r.line)).toEqual([REF_LINE])
    expect([body.prePrompt, body.postPrompt]).toEqual([PRE, PROMPT])
    expect(JSON.stringify(body)).not.toContain("HIDDEN-PREVIEW")
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

  describe("a chip the slot hides from the person", () => {
    beforeEach(() => {
      const [lead, place] = versionData().slots
      // hair shows; body is fixed at "new" (no default); outfit at its default.
      mem.trends[0]!.versions[2] = versionData({
        slots: [{ ...lead!, defaults: { outfit: "original" }, chips: ["hair"] } as TrendSlot, place!],
      })
    })

    it("is a 400 chip_not_offered naming the slot and the chip, with no dispatch", async () => {
      for (const url of ["/v1/trends/neon-dance/runs", "/v1/trends/neon-dance/estimate"]) {
        const res = await app.inject({
          method: "POST", url, headers: as(),
          payload: { slots: { lead: { images: ["https://u.example/me.png"], outfit: "new" } } },
        })
        expect(res.statusCode, url).toBe(400)
        const err = res.json().error
        expect(err).toMatchObject({ code: "chip_not_offered", slot: "lead", chip: "outfit" })
        expect(err.message).toMatch(/lead/)
        expect(err.message).toMatch(/outfit/)
      }
      expect(engine.calls).toHaveLength(0)
    })

    it("a shown chip still runs, and the engine gets the fixed values for the hidden ones", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/trends/neon-dance/runs", headers: as(),
        payload: { slots: { lead: { images: ["https://u.example/me.png"], hair: "new" } } },
      })
      expect(res.statusCode).toBe(202)
      const [role] = engine.calls[0]!.body.roles as Array<Record<string, unknown>>
      expect(role).toMatchObject({ body: "new", outfit: "original", hair: "new" })
    })
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

  it("a published trend with marks whose stored face mask does not match is a 409 trend_unavailable, with no internal POST", async () => {
    const mark = { label: "erased" as const, fromFrame: 0, toFrame: 10, leftPct: 0, topPct: 0, rightPct: 50, bottomPct: 50 }
    mem.trends[0]!.versions[2] = versionData({ faceMasking: { ...MASKING, marks: [mark] } })
    const res = await app.inject({ method: "POST", url: "/v1/trends/neon-dance/runs", headers: as(), payload: RUN_BODY })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toEqual({ code: "trend_unavailable", message: "This trend cannot run until it is updated." })
    expect(engine.calls).toHaveLength(0)
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

  it("the run's job carries the calling client's origin and surface, and no session", async () => {
    db.respond = (q) => (q.table === "generation_sessions" ? { data: { id: SESSION }, error: null } : { data: null, error: null })
    const res = await app.inject({
      method: "POST",
      url: "/v1/trends/neon-dance/runs",
      headers: as({ "x-auth-kind": "jwt", origin: "https://tools.nodaro.ai" }),
      payload: { ...RUN_BODY, origin: "trends-app", sessionId: SESSION },
    })
    expect(res.statusCode).toBe(202)
    expect(engine.calls[0]!.stamps).toEqual({ origin: "trends-app", sessionId: null, source: "web", sourceDetail: "tools.nodaro.ai", grant: null })
    // The session was still checked (a session you may not use is a 404).
    expect(db.log.filter((q) => q.table === "generation_sessions")).toHaveLength(1)
  })

  it("an origin that is not a slug is a 400, with no dispatch", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/trends/neon-dance/runs", headers: as(),
      payload: { ...RUN_BODY, origin: "Not A Slug" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
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

  it("the caller's grant rides the hop to Cast Swap (an OAuth app's scopes; none for a first-party caller)", async () => {
    await app.inject({
      method: "POST", url: "/v1/trends/neon-dance/runs", headers: as({ "x-app-scopes": "workflows:execute assets:write" }),
      payload: RUN_BODY,
    })
    await app.inject({ method: "POST", url: "/v1/trends/neon-dance/runs", headers: as(), payload: RUN_BODY })
    expect(engine.calls.map((c) => c.stamps?.grant)).toEqual([["workflows:execute", "assets:write"], null])
  })

  describe("over MCP (run_trend): the MCP session's grant decides, as an OAuth app's does", () => {
    const viaMcp = (scopes: Scope[]) =>
      mcpInject(app, newSession({ userId: USER, scopes, clientName: "test" }), {
        method: "POST", url: "/v1/trends/neon-dance/runs", payload: { ...RUN_BODY, sessionId: SESSION },
      })
    beforeEach(() => {
      db.respond = (q) => (q.table === "generation_sessions" ? { data: { id: SESSION }, error: null } : { data: null, error: null })
    })

    it("a session without assets:write is a 404, with no dispatch", async () => {
      const res = await viaMcp(["workflows:execute"])
      expect(res.statusCode).toBe(404)
      expect(engine.calls).toHaveLength(0)
    })

    it("with assets:write the run starts, and the grant rides on to Cast Swap", async () => {
      const res = await viaMcp(["workflows:execute", "assets:write"])
      expect(res.statusCode).toBe(202)
      expect(engine.calls[0]!.stamps?.grant).toEqual(["workflows:execute", "assets:write"])
    })

    it("an internal call no server-side scope vouches for cannot pass a session (404)", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/trends/neon-dance/runs",
        headers: { "x-internal-orchestrator-secret": SECRET, "x-internal-user-id": USER },
        payload: { ...RUN_BODY, sessionId: SESSION },
      })
      expect(res.statusCode).toBe(404)
      expect(engine.calls).toHaveLength(0)
    })
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
    expect(res.json()).toEqual({ data: { expectedCredits: 120, holdCredits: 120, breakdown: { base: 40, motion: 80 } } })
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
    expect(res.json().data.breakdown).toEqual({ base: 40, motion: 80 })
    expectNoHidden(res.body)
  })

  it("a slot error is a 400 here too", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/trends/neon-dance/estimate", headers: as(), payload: { slots: {} } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatchObject({ code: "missing_slot", slot: "lead" })
  })
})

// ── the trend's engine ─────────────────────────────────────────────────────

describe("a Kling 4 trend", () => {
  const T_KLING = "00000000-0000-4000-8000-0000000000a5"
  const KLING_ENGINE = { ...CAST_SWAP_ALL, roleKinds: [...CAST_SWAP_ALL.roleKinds], resolutions: [...CAST_SWAP_ALL.resolutions], engines: ["seedance-2-5", "kling-4"] as Array<"seedance-2-5" | "kling-4" | "motion-prism" | "motion-pulse" | "motion-pro" | "motion-lite"> }
  beforeEach(() => {
    mem.trends.push(trend(T_KLING, "kling-dance", "published", 1, versionData({ engine: "kling-4" })))
    setPluginSupports({ castSwap: KLING_ENGINE })
  })

  it("its page names the engine and offers 720p and 1080p only, and never shows its length fit", async () => {
    mem.trends[mem.trends.length - 1] = trend(T_KLING, "kling-dance", "published", 1, versionData({ engine: "kling-4", klingLength: "cut-start" }))
    const res = await app.inject({ method: "GET", url: "/v1/trends/kling-dance", headers: as() })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ engine: "motion-pulse", engineName: "Nodaro Motion Pulse", resolutions: ["720p", "1080p"] })
    expect(res.body).not.toContain("klingLength")
    expectNoHidden(res.body)
  })

  it("estimates and runs on Kling 4 at 720p by default, with no draft", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/trends/kling-dance/estimate", headers: as(), payload: RUN_BODY })).statusCode).toBe(200)
    expect((await app.inject({ method: "POST", url: "/v1/trends/kling-dance/runs", headers: as(), payload: RUN_BODY })).statusCode).toBe(202)
    for (const c of engine.calls) expect(c.body).toMatchObject({ engine: "kling-4", resolution: "720p", draft: false })
  })

  it("sends a Pulse trend's length fit as klingLength to an older engine, and as motionLength where the engine takes Nodaro Motion's names", async () => {
    mem.trends[mem.trends.length - 1] = trend(T_KLING, "kling-dance", "published", 1, versionData({ engine: "kling-4", klingLength: "cut-start" }))
    expect((await app.inject({ method: "POST", url: "/v1/trends/kling-dance/estimate", headers: as(), payload: RUN_BODY })).statusCode).toBe(200)
    expect(engine.calls.at(-1)!.body).toMatchObject({ klingLength: "cut-start" })
    expect(engine.calls.at(-1)!.body).not.toHaveProperty("motionLength")
    setPluginSupports({ castSwap: { ...KLING_ENGINE, engines: ["motion-pro", "motion-lite", "seedance-2-5", "kling-4"], engineAliases: true } })
    expect((await app.inject({ method: "POST", url: "/v1/trends/kling-dance/runs", headers: as(), payload: RUN_BODY })).statusCode).toBe(202)
    expect(engine.calls.at(-1)!.body).toMatchObject({ motionLength: "cut-start" })
    expect(engine.calls.at(-1)!.body).not.toHaveProperty("klingLength")
  })

  for (const engines of [["motion-pro", "motion-lite"], ["motion-prism", "motion-pulse"]] as const) {
    it(`still runs where the engine declares Nodaro Motion's public ids (${engines.join(" + ")}), and sends it the internal id it takes`, async () => {
      setPluginSupports({ castSwap: { ...KLING_ENGINE, engines: [...engines], engineAliases: true } })
      expect((await app.inject({ method: "POST", url: "/v1/trends/kling-dance/estimate", headers: as(), payload: RUN_BODY })).statusCode).toBe(200)
      expect((await app.inject({ method: "POST", url: "/v1/trends/kling-dance/runs", headers: as(), payload: RUN_BODY })).statusCode).toBe(202)
      expect(engine.calls.length).toBeGreaterThan(0)
      for (const c of engine.calls) expect(c.body).toMatchObject({ engine: "kling-4" })
    })
  }

  it("is held back (engine_unsupported) where the engine declares Prism alone, in any vocabulary", async () => {
    for (const engines of [["seedance-2-5"], ["motion-pro"], ["motion-prism"]] as const) {
      setPluginSupports({ castSwap: { ...KLING_ENGINE, engines: [...engines] } })
      const res = await app.inject({ method: "POST", url: "/v1/trends/kling-dance/estimate", headers: as(), payload: RUN_BODY })
      expect(res.statusCode).toBe(503)
      expect(res.json().error.code).toBe("engine_unsupported")
    }
    expect(engine.calls).toHaveLength(0)
  })

  it("refuses a draft (draft_unsupported) and 480p (resolution_unsupported), before the engine is asked", async () => {
    for (const url of ["/v1/trends/kling-dance/estimate", "/v1/trends/kling-dance/runs"]) {
      const draft = await app.inject({ method: "POST", url, headers: as(), payload: { ...RUN_BODY, draft: true } })
      expect(draft.statusCode).toBe(400)
      expect(draft.json().error.code).toBe("draft_unsupported")
      const low = await app.inject({ method: "POST", url, headers: as(), payload: { ...RUN_BODY, resolution: "480p" } })
      expect(low.statusCode).toBe(400)
      expect(low.json().error.code).toBe("resolution_unsupported")
    }
    expect(engine.calls).toHaveLength(0)
  })

  it("refuses a run that would send more than 10 pictures (too_many_images), without telling the count", async () => {
    const three = ["https://u.example/1.png", "https://u.example/2.png", "https://u.example/3.png"]
    // lead 3 + place 3 + the trend's reference 1 = 7: fine. The trend here has two slots, so add a third via the version.
    mem.trends[mem.trends.length - 1] = trend(T_KLING, "kling-dance", "published", 1, versionData({
      engine: "kling-4",
      // lead 1 (prepared) + place 3 + 3 × 3 references = 13.
      references: [1, 2, 3].map(() => ({ images: [REF_IMAGE, REF_IMAGE, REF_IMAGE], line: REF_LINE })),
    }))
    const res = await app.inject({ method: "POST", url: "/v1/trends/kling-dance/runs", headers: as(), payload: { slots: { lead: { images: three }, place: { images: three } } } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("too_many_images")
    expect(res.json().error.message).not.toMatch(/\b13\b/)
    expect(engine.calls).toHaveLength(0)
    expectNoHidden(res.body)
  })

  it("is held back (503 engine_unsupported) on an engine that does not declare Kling 4", async () => {
    setPluginSupports({ castSwap: { ...CAST_SWAP_ALL, roleKinds: [...CAST_SWAP_ALL.roleKinds], resolutions: [...CAST_SWAP_ALL.resolutions] } })
    const res = await app.inject({ method: "POST", url: "/v1/trends/kling-dance/runs", headers: as(), payload: RUN_BODY })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("engine_unsupported")
    expect(engine.calls).toHaveLength(0)
  })

  it("a Seedance 2.5 trend sends no engine key", async () => {
    await app.inject({ method: "POST", url: "/v1/trends/neon-dance/runs", headers: as(), payload: RUN_BODY })
    expect(engine.calls[0]!.body).not.toHaveProperty("engine")
  })
})

describe("a trend's prompt style", () => {
  const T_STYLE = "00000000-0000-4000-8000-0000000000a6"
  beforeEach(() => {
    mem.trends.push(trend(T_STYLE, "style-dance", "published", 1, versionData({ promptStyle: "flexible" })))
  })

  it("never shows on its page", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/trends/style-dance", headers: as() })
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain("promptStyle")
    expect(res.body).not.toContain("flexible")
    expectNoHidden(res.body)
  })

  it("is sent resolved to an engine that declares prompt styles, and never to one that does not", async () => {
    await app.inject({ method: "POST", url: "/v1/trends/style-dance/runs", headers: as(), payload: RUN_BODY })
    expect(engine.calls.at(-1)!.body).not.toHaveProperty("promptStyle")
    setPluginSupports({ castSwap: { ...CAST_SWAP_ALL, roleKinds: [...CAST_SWAP_ALL.roleKinds], resolutions: [...CAST_SWAP_ALL.resolutions], promptStyles: ["precise", "flexible"] } as never })
    await app.inject({ method: "POST", url: "/v1/trends/style-dance/estimate", headers: as(), payload: RUN_BODY })
    await app.inject({ method: "POST", url: "/v1/trends/style-dance/runs", headers: as(), payload: RUN_BODY })
    for (const c of engine.calls.slice(-2)) expect(c.body).toMatchObject({ promptStyle: "flexible" })
  })
})

describe("a Prism trend's reference audio", () => {
  const T_AUDIO = "00000000-0000-4000-8000-0000000000a7"
  const WITH_AUDIO = { ...CAST_SWAP_ALL, roleKinds: [...CAST_SWAP_ALL.roleKinds], resolutions: [...CAST_SWAP_ALL.resolutions], prismReferenceAudio: true }

  it("never shows on its page", async () => {
    mem.trends.push(trend(T_AUDIO, "voice-dance", "published", 1, versionData({ prismReferenceAudio: "voice" })))
    const res = await app.inject({ method: "GET", url: "/v1/trends/voice-dance", headers: as() })
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain("prismReferenceAudio")
    expectNoHidden(res.body)
  })

  it("is sent to the estimate exactly as to the run (so the quote prices the voice split), and only to an engine that declares it", async () => {
    for (const value of ["voice", "none"] as const) {
      mem.trends = mem.trends.filter((t) => t.id !== T_AUDIO)
      mem.trends.push(trend(T_AUDIO, "voice-dance", "published", 1, versionData({ prismReferenceAudio: value })))
      setPluginSupports({ castSwap: WITH_AUDIO })
      engine.calls = []
      expect((await app.inject({ method: "POST", url: "/v1/trends/voice-dance/estimate", headers: as(), payload: RUN_BODY })).statusCode).toBe(200)
      expect((await app.inject({ method: "POST", url: "/v1/trends/voice-dance/runs", headers: as(), payload: RUN_BODY })).statusCode).toBe(202)
      expect(engine.calls.map((c) => c.url)).toEqual(["/v1/cast-swap/estimate", "/v1/cast-swap"])
      for (const c of engine.calls) expect(c.body, value).toMatchObject({ prismReferenceAudio: value })

      setPluginSupports({ castSwap: { ...WITH_AUDIO, prismReferenceAudio: false } })
      engine.calls = []
      await app.inject({ method: "POST", url: "/v1/trends/voice-dance/estimate", headers: as(), payload: RUN_BODY })
      await app.inject({ method: "POST", url: "/v1/trends/voice-dance/runs", headers: as(), payload: RUN_BODY })
      expect(engine.calls).toHaveLength(2)
      for (const c of engine.calls) expect(c.body).not.toHaveProperty("prismReferenceAudio")
    }
  })

  it("sends no key for the full audio, set or left out", async () => {
    setPluginSupports({ castSwap: WITH_AUDIO })
    mem.trends.push(trend(T_AUDIO, "voice-dance", "published", 1, versionData({ prismReferenceAudio: "full" })))
    await app.inject({ method: "POST", url: "/v1/trends/voice-dance/estimate", headers: as(), payload: RUN_BODY })
    await app.inject({ method: "POST", url: "/v1/trends/neon-dance/estimate", headers: as(), payload: RUN_BODY })
    expect(engine.calls).toHaveLength(2)
    for (const c of engine.calls) expect(c.body).not.toHaveProperty("prismReferenceAudio")
  })
})

// ── face masking, pre prompt and the preview a full run follows ────────────

describe("trend face masking and pre prompt", () => {
  const PREVIEW_JOB = "00000000-0000-4000-8000-0000000000f1"
  const OTHER_USER = "00000000-0000-4000-8000-000000000002"

  /** A completed preview run of the published trend, by the caller, that ran masked. */
  function previewRow(over: { user_id?: string; status?: string; input?: Record<string, unknown>; output?: Record<string, unknown> } = {}) {
    return {
      id: PREVIEW_JOB,
      user_id: over.user_id ?? USER,
      status: over.status ?? "completed",
      input_data: { type: "cast-swap", preview: true, trend: { id: T_PUB, slug: "neon-dance", version: 2, name: "Neon Dance" }, ...over.input },
      output_data: { videoUrl: "https://cdn.example/p.mp4", faceMasking: { applied: true, reason: "input_refused" }, ...over.output },
    }
  }
  const answerJobs = (row: unknown, error: unknown = null) => {
    db.respond = (q) => (q.table === "jobs" ? { data: row, error } : { data: null, error: null })
  }
  const run = (payload: Record<string, unknown>, path = "runs") =>
    app.inject({ method: "POST", url: `/v1/trends/neon-dance/${path}`, headers: as(), payload })

  it("sends the trend's pre prompt and masking at the top level, never in the display", async () => {
    const res = await run(RUN_BODY)
    expect(res.statusCode).toBe(202)
    const body = engine.calls[0]!.body
    expect(body.prePrompt).toBe(PRE)
    expect(body.faceMasking).toEqual(MASKING)
    const display = JSON.stringify((body.trendRun as { display: unknown }).display)
    expect(display).not.toContain(PRE)
    expect(display).not.toContain("faceMasking")
    expectNoHidden(res.body)
  })

  it("an upscale in the making a version carries never reaches a public reply or the engine", async () => {
    const upscale = { jobId: "HIDDEN-UPSCALE-JOB", target: "example" as const, fromUrl: "https://cdn.example/trends/t1/HIDDEN-UPSCALE-FROM.mp4", startedAt: "2026-10-25T10:00:00.000Z" }
    mem.trends[0]!.versions[2] = { ...versionData(), upscaleJobs: [upscale] }
    const page = await app.inject({ method: "GET", url: "/v1/trends/neon-dance", headers: as() })
    const list = await app.inject({ method: "GET", url: "/v1/trends", headers: as() })
    for (const res of [page, list]) {
      expect(res.statusCode).toBe(200)
      expect(res.body).not.toContain("HIDDEN-UPSCALE")
      expect(res.body).not.toContain("upscaleJobs")
    }
    const ran = await run(RUN_BODY, "runs")
    expect(ran.statusCode).toBeLessThan(300)
    expect(JSON.stringify(engine.calls)).not.toContain("HIDDEN-UPSCALE")
  })

  it("a stored face mask made from the trend's settings rides estimate and run, and never a public reply", async () => {
    const data = versionData()
    const mask = {
      url: "https://cdn.example/trends/t1/HIDDEN-MASK.mp4",
      frames: 360,
      recipe: { core: "2026-10-25", plugin: "1" },
      settingsKey: faceMaskSettingsKey(data)!,
      jobId: "HIDDEN-MASK-JOB",
      stats: { shots: 1, heldFrames: 0, coverage: 0.01, droppedRegions: 0 },
      approvedAt: "2026-10-25T10:00:00.000Z",
      approvedBy: "admin",
    }
    mem.trends[0]!.versions[2] = { ...data, faceMask: mask }
    setPluginSupports({ castSwap: { ...CAST_SWAP_ALL, roleKinds: [...CAST_SWAP_ALL.roleKinds], resolutions: [...CAST_SWAP_ALL.resolutions], storedFaceMask: true } })
    for (const path of ["estimate", "runs"]) {
      engine.calls = []
      const res = await run(RUN_BODY, path)
      expect(res.statusCode, path).toBeLessThan(300)
      expect(engine.calls[0]!.body.storedFaceMask, path).toEqual({ url: mask.url, frames: 360 })
      expect(res.body).not.toContain("HIDDEN-MASK")
    }
    const page = await app.inject({ method: "GET", url: "/v1/trends/neon-dance", headers: as() })
    expect(page.body).not.toContain("HIDDEN-MASK")
    expect(page.body).not.toContain("faceMask")

    // An engine that does not take one: the run masks per run, and the quote says so.
    setPluginSupports({ castSwap: { ...CAST_SWAP_ALL, roleKinds: [...CAST_SWAP_ALL.roleKinds], resolutions: [...CAST_SWAP_ALL.resolutions] } })
    for (const path of ["estimate", "runs"]) {
      engine.calls = []
      await run(RUN_BODY, path)
      expect(engine.calls[0]!.body, path).not.toHaveProperty("storedFaceMask")
    }
  })

  it("masking off sends no faceMasking key, and needs no masking engine", async () => {
    mem.trends[0]!.versions[2] = versionData({ faceMasking: { mode: "off" } })
    setPluginSupports({ castSwap: { ...CAST_SWAP_ALL, roleKinds: [...CAST_SWAP_ALL.roleKinds], resolutions: [...CAST_SWAP_ALL.resolutions], faceMasking: false } })
    const res = await run(RUN_BODY)
    expect(res.statusCode).toBe(202)
    expect(engine.calls[0]!.body).not.toHaveProperty("faceMasking")
  })

  it("an engine without face masking is engine_unsupported for a masked trend, with no dispatch", async () => {
    const { faceMasking: _f, ...noMasking } = CAST_SWAP_ALL
    setPluginSupports({ castSwap: { ...noMasking, roleKinds: [...CAST_SWAP_ALL.roleKinds], resolutions: [...CAST_SWAP_ALL.resolutions] } })
    for (const path of ["runs", "estimate"]) {
      const res = await run(RUN_BODY, path)
      expect(res.statusCode, path).toBe(503)
      expect(res.json().error.code).toBe("engine_unsupported")
    }
    expect(engine.calls).toHaveLength(0)
  })

  it("an engine without trend pre prompts is engine_unsupported for a trend with one, and fine for one without", async () => {
    const { trendPrePrompt: _p, ...noPre } = CAST_SWAP_ALL
    setPluginSupports({ castSwap: { ...noPre, roleKinds: [...CAST_SWAP_ALL.roleKinds], resolutions: [...CAST_SWAP_ALL.resolutions] } })
    for (const path of ["runs", "estimate"]) {
      const res = await run(RUN_BODY, path)
      expect(res.statusCode, path).toBe(503)
      expect(res.json().error.code).toBe("engine_unsupported")
    }
    expect(engine.calls).toHaveLength(0)

    mem.trends[0]!.versions[2] = versionData({ prePrompt: undefined })
    const res = await run(RUN_BODY)
    expect(res.statusCode).toBe(202)
    expect(engine.calls[0]!.body).not.toHaveProperty("prePrompt")
  })

  it("a full run whose own preview ran masked is sent as always, keeping the other settings", async () => {
    answerJobs(previewRow())
    for (const path of ["runs", "estimate"]) {
      const res = await run({ ...RUN_BODY, previewJobId: PREVIEW_JOB }, path)
      expect(res.statusCode, path).toBeLessThan(300)
    }
    for (const call of engine.calls) {
      expect(call.body.faceMasking).toEqual({ ...MASKING, mode: "always" })
      expect(call.body).not.toHaveProperty("previewJobId")
    }
    const [read] = db.log.filter((q) => q.table === "jobs")
    expect(has(read!, "eq", "id", PREVIEW_JOB)).toBe(true)
    expect(has(read!, "eq", "user_id", USER)).toBe(true)
    // The trend's own setting is not changed by a run.
    expect(mem.trends[0]!.versions[2]!.faceMasking).toEqual(MASKING)
  })

  it("a trend that leaves the zone out sends the default margins on the estimate and the run", async () => {
    const DEFAULT_ZONE = { leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 }
    const { zone: _zone, ...noZone } = MASKING
    mem.trends[0]!.versions[2] = versionData({ faceMasking: noZone })
    for (const path of ["estimate", "runs"]) {
      engine.calls = []
      expect((await run(RUN_BODY, path)).statusCode, path).toBeLessThan(300)
      expect(engine.calls[0]!.body.faceMasking, path).toEqual({ ...noZone, zone: DEFAULT_ZONE })
    }
    // The trend's own setting keeps its zone left out.
    expect(mem.trends[0]!.versions[2]!.faceMasking).not.toHaveProperty("zone")
  })

  it("a trend that leaves the zone out follows the zone its masked preview ran with, estimate and run alike", async () => {
    const DEFAULT_ZONE = { leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 }
    const NONE = { leftPct: 0, rightPct: 0, topPct: 0, bottomPct: 0 }
    const OWN = { leftPct: 5, rightPct: 7, topPct: 0, bottomPct: 2 }
    const { zone: _zone, ...noZone } = MASKING
    mem.trends[0]!.versions[2] = versionData({ faceMasking: noZone })
    const stored = { mode: "auto", fill: "depth", minFaceHeightPct: 12, threshold: 0.4 }
    const cases: Array<[string, unknown, unknown]> = [
      ["a preview with its own margins", { ...stored, zone: OWN }, OWN],
      ["a preview with the default margins", { ...stored, zone: DEFAULT_ZONE }, DEFAULT_ZONE],
      ["a preview with no margins (null)", { ...stored, zone: null }, NONE],
      ["a preview with no margins (all 0)", { ...stored, zone: NONE }, NONE],
      ["a preview from before the default margins (no zone)", stored, NONE],
      ["a preview with no stored masking", undefined, NONE],
      ["a stored zone that is not one", { ...stored, zone: { leftPct: 80 } }, DEFAULT_ZONE],
    ]
    for (const [name, masking, zone] of cases) {
      answerJobs(previewRow({ input: { __faceMasking: masking } }))
      for (const path of ["estimate", "runs"]) {
        engine.calls = []
        expect((await run({ ...RUN_BODY, previewJobId: PREVIEW_JOB }, path)).statusCode, `${name} ${path}`).toBeLessThan(300)
        expect(engine.calls[0]!.body.faceMasking, `${name} ${path}`).toEqual({ ...noZone, zone, mode: "always" })
      }
    }
    // The trend's own setting keeps its zone left out.
    expect(mem.trends[0]!.versions[2]!.faceMasking).not.toHaveProperty("zone")
  })

  it("a trend with its own zone keeps it when it follows a preview that ran with other margins", async () => {
    const NONE = { leftPct: 0, rightPct: 0, topPct: 0, bottomPct: 0 }
    const OWN = { leftPct: 5, rightPct: 7, topPct: 0, bottomPct: 2 }
    const cases: Array<[unknown, unknown]> = [
      [{ topPct: 4 }, { topPct: 4 }],
      [null, NONE],
      [NONE, NONE],
    ]
    for (const [zone, sent] of cases) {
      mem.trends[0]!.versions[2] = versionData({ faceMasking: { ...MASKING, zone } as typeof MASKING })
      answerJobs(previewRow({ input: { __faceMasking: { ...MASKING, zone: OWN } } }))
      for (const path of ["estimate", "runs"]) {
        engine.calls = []
        expect((await run({ ...RUN_BODY, previewJobId: PREVIEW_JOB }, path)).statusCode, path).toBeLessThan(300)
        expect(engine.calls[0]!.body.faceMasking, `${JSON.stringify(zone)} ${path}`).toEqual({ ...MASKING, zone: sent, mode: "always" })
      }
    }
  })

  it("a trend whose zone is null or all 0 sends no margins, on its own and when it follows its preview", async () => {
    const NONE = { leftPct: 0, rightPct: 0, topPct: 0, bottomPct: 0 }
    for (const zone of [null, NONE]) {
      mem.trends[0]!.versions[2] = versionData({ faceMasking: { ...MASKING, zone } })
      engine.calls = []
      db.respond = () => ({ data: null, error: null })
      await run(RUN_BODY)
      expect(engine.calls[0]!.body.faceMasking, String(zone)).toEqual({ ...MASKING, zone: NONE })
      engine.calls = []
      answerJobs(previewRow())
      await run({ ...RUN_BODY, previewJobId: PREVIEW_JOB })
      expect(engine.calls[0]!.body.faceMasking, String(zone)).toEqual({ ...MASKING, zone: NONE, mode: "always" })
    }
  })

  it("a trend that leaves the fill out follows the fill its masked preview was made with", async () => {
    const { fill: _fill, ...noFill } = MASKING
    mem.trends[0]!.versions[2] = versionData({ faceMasking: noFill })
    const cases: Array<[string, unknown, string | undefined]> = [
      ["a blur preview", { ...MASKING, fill: "blur" }, "blur"],
      ["a depth preview", { ...MASKING, fill: "depth" }, "depth"],
      ["no stored masking", undefined, undefined],
      ["a fill that is not one", { ...MASKING, fill: "mosaic" }, undefined],
    ]
    for (const [name, stored, fill] of cases) {
      engine.calls = []
      answerJobs(previewRow({ input: { __faceMasking: stored } }))
      expect((await run({ ...RUN_BODY, previewJobId: PREVIEW_JOB })).statusCode, name).toBe(202)
      expect(engine.calls[0]!.body.faceMasking, name).toEqual({ ...noFill, mode: "always", ...(fill ? { fill } : {}) })
    }
    // The trend's own fill wins over the preview's.
    mem.trends[0]!.versions[2] = versionData({ faceMasking: MASKING })
    engine.calls = []
    answerJobs(previewRow({ input: { __faceMasking: { ...MASKING, fill: "blur" } } }))
    await run({ ...RUN_BODY, previewJobId: PREVIEW_JOB })
    expect(engine.calls[0]!.body.faceMasking).toEqual({ ...MASKING, mode: "always" })
  })

  it("ignores a preview job that does not qualify, with no error and the trend's own mode", async () => {
    const cases: Array<[string, unknown]> = [
      ["absent", null],
      ["another user's", previewRow({ user_id: OTHER_USER })],
      ["not completed", previewRow({ status: "processing" })],
      ["a full run", previewRow({ input: { preview: false } })],
      ["another trend's", previewRow({ input: { trend: { id: T_UNPUB, slug: "old", version: 1, name: "Old" } } })],
      ["not a Cast Swap job", previewRow({ input: { type: "image-to-video" } })],
      ["a Full Quality job", previewRow({ input: { fullQualityOf: "00000000-0000-4000-8000-0000000000aa" } })],
      ["not masked", previewRow({ output: { faceMasking: { applied: false, reason: "no_faces" } } })],
      ["no masking record", previewRow({ output: { faceMasking: undefined } })],
    ]
    for (const [name, row] of cases) {
      engine.calls = []
      answerJobs(row)
      const res = await run({ ...RUN_BODY, previewJobId: PREVIEW_JOB })
      expect(res.statusCode, name).toBe(202)
      expect(engine.calls[0]!.body.faceMasking, name).toEqual(MASKING)
    }
  })

  it("a database error reading the preview leaves the run as it is", async () => {
    answerJobs(null, { message: "boom", code: "XX000" })
    const res = await run({ ...RUN_BODY, previewJobId: PREVIEW_JOB })
    expect(res.statusCode).toBe(202)
    expect(engine.calls[0]!.body.faceMasking).toEqual(MASKING)
  })

  it("reads no job for a preview run, a trend that is not auto, or no previewJobId", async () => {
    answerJobs(previewRow())
    await run({ ...RUN_BODY, previewJobId: PREVIEW_JOB, preview: true })
    await run(RUN_BODY)
    mem.trends[0]!.versions[2] = versionData({ faceMasking: { ...MASKING, mode: "always" } })
    await run({ ...RUN_BODY, previewJobId: PREVIEW_JOB })
    mem.trends[0]!.versions[2] = versionData({ faceMasking: undefined })
    await run({ ...RUN_BODY, previewJobId: PREVIEW_JOB })
    expect(db.log.filter((q) => q.table === "jobs")).toHaveLength(0)
    expect(engine.calls.map((c) => (c.body.faceMasking as { mode?: string } | undefined)?.mode)).toEqual(["auto", "auto", "always", undefined])
  })

  it("a previewJobId that is not a uuid is a 400", async () => {
    const res = await run({ ...RUN_BODY, previewJobId: "job-1" })
    expect(res.statusCode).toBe(400)
    expect(engine.calls).toHaveLength(0)
  })

  it("the estimate answers the engine's privacy credits and parts by their neutral names, whichever names the engine sent", async () => {
    const answered = { expectedCredits: 120, holdCredits: 120, breakdown: { base: 40, motion: 80, privacy: 30 }, privacyCredits: 30 }
    for (const body of [
      // An engine before 0.394.0: the old names only.
      { totalCredits: 120, breakdown: { castSwap: 40, seedance: 80, masking: 30 }, maskingCredits: 30 },
      // 0.394.0: both (the new ones win).
      { totalCredits: 120, breakdown: { castSwap: 40, seedance: 99, motion: 80, masking: 9, privacy: 30 }, maskingCredits: 9, privacyCredits: 30 },
      // 0.395.0: the new ones only.
      { totalCredits: 120, breakdown: { castSwap: 40, motion: 80, privacy: 30 }, privacyCredits: 30 },
      // 0.396.0: base beside castSwap (base wins).
      { totalCredits: 120, breakdown: { castSwap: 99, base: 40, motion: 80, privacy: 30 }, privacyCredits: 30 },
      // 0.397.0: base only.
      { totalCredits: 120, breakdown: { base: 40, motion: 80, privacy: 30 }, privacyCredits: 30 },
    ]) {
      engine.estimateBody = body
      const res = await run(RUN_BODY, "estimate")
      expect(res.json().data).toEqual(answered)
      expect(res.body).not.toMatch(/seedance|kling|masking|castSwap|Motion (Pro|Lite)\b|motion-(pro|lite)\b/i)
    }
    engine.estimateBody = { totalCredits: 120, breakdown: { castSwap: 40, seedance: 80 }, privacyCredits: "30" }
    const bad = await run(RUN_BODY, "estimate")
    expect(bad.json().data).not.toHaveProperty("privacyCredits")
    expect(bad.json().data).not.toHaveProperty("maskingCredits")
  })
})

// ── engine refusals (never relayed verbatim) ───────────────────────────────

describe("the preview's prepared input clip", () => {
  const PREVIEW_CLIP = "https://cdn.example/trends/t1/HIDDEN-PREVIEW-CLIP.mp4"
  const PREVIEW_MASK = "https://cdn.example/trends/t1/HIDDEN-PREVIEW-MASK.mp4"
  const MASK_URL = "https://cdn.example/trends/t1/HIDDEN-MASK.mp4"
  const CLIP = {
    videoUrl: PREVIEW_CLIP,
    durationSec: 5,
    width: 720,
    height: 1280,
    frames: 150,
    sha256: "b".repeat(64),
    sourceVideoUrl: SOURCE,
    startSec: 2,
    recipe: "1",
    madeAt: "2026-10-27T10:00:00.000Z",
  }
  const CLIP_MASK = { url: PREVIEW_MASK, frames: 150, sha256: "c".repeat(64), sourceMaskUrl: MASK_URL }
  const supports = (over: Record<string, unknown> = {}) =>
    setPluginSupports({ castSwap: { ...CAST_SWAP_ALL, roleKinds: [...CAST_SWAP_ALL.roleKinds], resolutions: [...CAST_SWAP_ALL.resolutions], ...over } })
  const run = (payload: Record<string, unknown>, path = "runs") =>
    app.inject({ method: "POST", url: `/v1/trends/neon-dance/${path}`, headers: as(), payload })
  const maskOf = (data: TrendVersionData) => ({
    url: MASK_URL,
    frames: 360,
    recipe: { core: "2026-10-25", plugin: "1" },
    settingsKey: faceMaskSettingsKey(data)!,
    jobId: "HIDDEN-MASK-JOB",
    stats: { shots: 1, heldFrames: 0, coverage: 0.01, droppedRegions: 0 },
    approvedAt: "2026-10-25T10:00:00.000Z",
    approvedBy: "admin",
  })

  it("an engine without the capability gets today's body on estimate and run alike: the whole source, previewStart, no new field", async () => {
    mem.trends[0]!.versions[2] = versionData({ previewClip: CLIP })
    supports()
    for (const path of ["estimate", "runs"]) {
      engine.calls = []
      const res = await run({ ...RUN_BODY, preview: true }, path)
      expect(res.statusCode, path).toBeLessThan(300)
      const body = engine.calls[0]!.body
      expect(body.videoUrl, path).toBe(SOURCE)
      expect(body.previewStart, path).toBe(2)
      expect(body.preview, path).toBe(true)
      expect(body, path).not.toHaveProperty("preparedPreview")
      expect(body, path).not.toHaveProperty("sourceAsset")
      expect(JSON.stringify(body), path).not.toContain("HIDDEN-PREVIEW-CLIP")
      expectNoHidden(res.body)
    }
    // A full run on such an engine carries no sourceAsset either.
    engine.calls = []
    await run(RUN_BODY)
    expect(engine.calls[0]!.body).not.toHaveProperty("sourceAsset")
  })

  it("an engine with the capability is sent the clip from 0 on estimate and run alike, with sourceAsset naming it; a full run names the source", async () => {
    mem.trends[0]!.versions[2] = versionData({ previewClip: CLIP, source: { videoUrl: SOURCE, durationSec: 12, width: 720, height: 1280, display: DISPLAY, sha256: "a".repeat(64) } })
    supports({ preparedPreview: true })
    for (const path of ["estimate", "runs"]) {
      engine.calls = []
      const res = await run({ ...RUN_BODY, preview: true }, path)
      expect(res.statusCode, path).toBeLessThan(300)
      const body = engine.calls[0]!.body
      expect(body.videoUrl, path).toBe(PREVIEW_CLIP)
      expect(body.previewStart, path).toBe(0)
      expect(body.preview, path).toBe(true)
      expect(body.preparedPreview, path).toBe(true)
      expect(body.sourceAsset, path).toEqual({ kind: "preview", sha256: "b".repeat(64), startSec: 2, durationSec: 5, recipe: "1" })
      // The preview's own prompt parts still ride.
      expect(body.prePrompt, path).toBe(PREVIEW_PRE)
      expectNoHidden(res.body)
    }
    engine.calls = []
    const full = await run(RUN_BODY)
    expect(full.statusCode).toBe(202)
    const body = engine.calls[0]!.body
    expect(body.videoUrl).toBe(SOURCE)
    expect(body.previewStart).toBe(2)
    expect(body).not.toHaveProperty("preparedPreview")
    expect(body.sourceAsset).toEqual({ kind: "full", sha256: "a".repeat(64), durationSec: 12 })
    // The page never shows any of it.
    const page = await app.inject({ method: "GET", url: "/v1/trends/neon-dance", headers: as() })
    expect(page.body).not.toContain("previewClip")
    expect(page.body).not.toContain("HIDDEN-PREVIEW")
    expect(page.body).not.toContain("sha256")
  })

  it("a stale clip (the window moved since) is not sent even where the engine takes one", async () => {
    mem.trends[0]!.versions[2] = versionData({ previewClip: { ...CLIP, startSec: 1 } })
    supports({ preparedPreview: true })
    const res = await run({ ...RUN_BODY, preview: true })
    expect(res.statusCode).toBe(202)
    const body = engine.calls[0]!.body
    expect(body.videoUrl).toBe(SOURCE)
    expect(body.previewStart).toBe(2)
    expect(body).not.toHaveProperty("preparedPreview")
    expect(body.sourceAsset).toEqual({ kind: "full", durationSec: 12 })
  })

  it("a masked trend sends the clip's own cut of its stored mask with the clip; without that cut the whole source rides as today", async () => {
    const data = versionData({ faceMasking: { mode: "always" } })
    const mask = maskOf(data)
    mem.trends[0]!.versions[2] = { ...data, faceMask: mask, previewClip: { ...CLIP, faceMask: CLIP_MASK } }
    supports({ preparedPreview: true, storedFaceMask: true })
    for (const path of ["estimate", "runs"]) {
      engine.calls = []
      const res = await run({ ...RUN_BODY, preview: true }, path)
      expect(res.statusCode, path).toBeLessThan(300)
      const body = engine.calls[0]!.body
      expect(body.videoUrl, path).toBe(PREVIEW_CLIP)
      expect(body.storedFaceMask, path).toEqual({ url: PREVIEW_MASK, frames: 150 })
      expect(body.preparedPreview, path).toBe(true)
      expect(res.body, path).not.toContain("HIDDEN-PREVIEW")
    }
    // The same trend, its clip cut before the mask was approved: out of date, so the source and the whole mask.
    mem.trends[0]!.versions[2] = { ...data, faceMask: mask, previewClip: CLIP }
    engine.calls = []
    await run({ ...RUN_BODY, preview: true })
    const body = engine.calls[0]!.body
    expect(body.videoUrl).toBe(SOURCE)
    expect(body.storedFaceMask).toEqual({ url: MASK_URL, frames: 360 })
    expect(body).not.toHaveProperty("preparedPreview")
  })

  it("an engine that takes prepared previews but no stored mask is sent the clip without any mask", async () => {
    const data = versionData({ faceMasking: { mode: "always" } })
    mem.trends[0]!.versions[2] = { ...data, faceMask: maskOf(data), previewClip: { ...CLIP, faceMask: CLIP_MASK } }
    supports({ preparedPreview: true })
    const res = await run({ ...RUN_BODY, preview: true })
    expect(res.statusCode).toBe(202)
    const body = engine.calls[0]!.body
    expect(body.videoUrl).toBe(PREVIEW_CLIP)
    expect(body).not.toHaveProperty("storedFaceMask")
    expect(body.preparedPreview).toBe(true)
  })
})

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

    it(`${route.name}: a Kling 4 refusal (too_many_images, …) keeps its code with the platform's own text`, async () => {
      for (const code of ["too_many_images", "draft_unsupported", "resolution_unsupported"]) {
        route.set(400, { error: { code, message: `${PROMPT} ${SOURCE}`, issues: [{ path: ["roles"], message: ROLE }] } })
        const res = await app.inject({ method: "POST", url: route.url, headers: as(), payload: RUN_BODY })
        expect(res.statusCode, code).toBe(400)
        expect(res.json().error.code).toBe(code)
        expect(Object.keys(res.json().error).sort()).toEqual(["code", "message"])
        expectNoHidden(res.body)
      }
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

function feed(rows: unknown[], fq: unknown[] = [], usage: Array<Record<string, unknown>> = [], steps: Array<{ id: string; parent_job_id: string; usage_log_id: string | null; credits: number | null }> = []) {
  db.respond = (q) => {
    if (q.table === "usage_logs") return { data: usage, error: null }
    if (q.table !== "jobs") return { data: null, error: null }
    // A run's steps (child jobs by parent_job_id), for its charge.
    const stepsOf = q.ops.find((op) => op.m === "in" && op.a[0] === "parent_job_id")
    if (stepsOf) return { data: steps.filter((st) => (stepsOf.a[1] as string[]).includes(st.parent_job_id)), error: null }
    const isFq = q.ops.some((op) => op.m === "in" && op.a[0] === "input_data->>fullQualityOf")
    return { data: isFq ? fq : rows, error: null }
  }
}

/** The step lookup a run page makes for its charge: the page's job ids. */
const stepsLookup = (ids: string[]) => ["parent_job_id", ids]

describe("GET /v1/trends/runs", () => {
  it("is not captured by /:slug", async () => {
    feed([])
    const res = await app.inject({ method: "GET", url: "/v1/trends/runs", headers: as() })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [], next: null })
  })

  it("reads the caller's trend runs, Full Quality ones included, newest first", async () => {
    feed([])
    await app.inject({ method: "GET", url: "/v1/trends/runs?trend=neon-dance&limit=5", headers: as() })
    const [q] = db.log.filter((x) => x.table === "jobs")
    expect(has(q!, "eq", "user_id", USER)).toBe(true)
    expect(has(q!, "filter", "input_data->>type", "eq", "cast-swap")).toBe(true)
    expect(has(q!, "not", "input_data->trend", "is", null)).toBe(true)
    // A child job (a run's step) is never listed as a run of its own.
    expect(has(q!, "is", "parent_job_id", null)).toBe(true)
    // A Full Quality version is its own run: never filtered out.
    expect(q!.ops.some((op) => op.a[0] === "input_data->>fullQualityOf")).toBe(false)
    expect(has(q!, "filter", "input_data->trend->>slug", "eq", "neon-dance")).toBe(true)
    expect(has(q!, "order", "created_at", { ascending: false })).toBe(true)
    expect(argOf(q!, "limit")).toEqual([6])
  })

  it("maps runs to the public whitelist: no __ key, no source clip; a Full Quality version is its own run", async () => {
    const fqRow = jobRow(FQ_JOB, {
      status: "processing", progress: 10, output_data: { __checkpoint: { child: "x" } }, completed_at: null,
      input_data: runInput({ fullQualityOf: DRAFT_JOB, resolution: "1080p", draft: false, __draftJobId: DRAFT_JOB }),
      created_at: "2026-10-21T10:00:00.000000+00:00",
    })
    // The engine's provenance stamp (`sourceAsset`, `preparedPreview`: visible keys, read as-is
    // on GET /v1/jobs/:id) is not part of the run shape: the whitelist below leaves it out.
    const provenance = { preparedPreview: true, sourceAsset: { kind: "preview", sha256: "b".repeat(64), startSec: 2, durationSec: 5, recipe: "1" } }
    feed(
      [
        fqRow,
        jobRow(DRAFT_JOB, { input_data: runInput(provenance), output_data: { videoUrl: `https://out.example/${DRAFT_JOB}.mp4`, preview: false, sourceAsset: provenance.sourceAsset } }),
        jobRow(HD_JOB, { input_data: runInput({ resolution: "720p", draft: false }), created_at: "2026-10-19T10:00:00.000000+00:00" }),
        jobRow(FAILED_JOB, {
          status: "failed", progress: 40, output_data: null, completed_at: null,
          error_message: "Seedance refused the clip.", created_at: "2026-10-18T10:00:00.000000+00:00",
        }),
      ],
      [fqRow],
      [{ id: `ul-${DRAFT_JOB}`, status: "committed", credits_used: 120, credits_charged: 95 }],
    )
    const res = await app.inject({ method: "GET", url: "/v1/trends/runs", headers: as() })
    expect(res.statusCode).toBe(200)
    const runs = res.json().data
    expect(runs.map((r: { jobId: string }) => r.jobId)).toEqual([FQ_JOB, DRAFT_JOB, HD_JOB, FAILED_JOB])

    // The Full Quality version, as its own item: its own status and output.
    expect(runs[0]).toEqual({
      jobId: FQ_JOB,
      status: "processing",
      progress: 10,
      error: null,
      createdAt: "2026-10-21T10:00:00.000000+00:00",
      completedAt: null,
      trend: { id: T_PUB, slug: "neon-dance", version: 2, name: "Neon Dance" },
      example: 1,
      slots: runInput().slots,
      details: "wave at {slot:lead}",
      preview: false,
      resolution: "1080p",
      draft: false,
      engine: "motion-prism",
      engineName: "Nodaro Motion Prism",
      videoUrl: null,
      posterUrl: null,
      creditsCharged: null,
      creditsHeld: null,
      creditsReleased: null,
      fullQualityOf: DRAFT_JOB,
      fullQuality: null,
      fullQualityUntil: null,
    })

    expect(runs[1]).toEqual({
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
      engine: "motion-prism",
      engineName: "Nodaro Motion Prism",
      videoUrl: `https://out.example/${DRAFT_JOB}.mp4`,
      posterUrl: null,
      creditsCharged: 95,
      creditsHeld: null,
      creditsReleased: null,
      fullQualityOf: null,
      // The draft only points at its newest upgrade try; the upgrade's
      // result and charge are on its own run, never copied here.
      fullQuality: { jobId: FQ_JOB, status: "processing" },
      fullQualityUntil: "2026-10-27T10:00:00.000Z",
    })
    expect(runs[2]).toMatchObject({ jobId: HD_JOB, draft: false, fullQualityOf: null, fullQuality: null, fullQualityUntil: null })
    expect(runs[3]).toMatchObject({
      jobId: FAILED_JOB, status: "failed", progress: 40, videoUrl: null, fullQualityUntil: null,
      error: { code: "failed", message: "This run didn't finish." },
    })
    expect(res.body).not.toContain("Seedance refused the clip.")

    // Nothing hidden leaks (the Full Quality job's `__draftJobId` included).
    expectNoHidden(res.body)
    for (const r of runs) expect(r.videoUrl).not.toBe(SOURCE)
    expect(res.body).not.toContain("sourceAsset")
    expect(res.body).not.toContain("preparedPreview")

    // Two lookups, both the caller's own: whether the page's Full Quality try
    // is its draft's newest (by the try's draft), then the page's drafts'
    // upgrades (not the 720p run, not the Full Quality one).
    const lookups = db.log.filter((q) => q.table === "jobs" && q.ops.some((op) => op.m === "in"))
    for (const q of lookups) expect(has(q, "eq", "user_id", USER)).toBe(true)
    expect(lookups.map((q) => argOf(q, "in"))).toEqual([
      ["input_data->>fullQualityOf", [DRAFT_JOB]],
      ["input_data->>fullQualityOf", [DRAFT_JOB, FAILED_JOB]],
      // The page's steps, for each run's charge (the caller's own, as above).
      stepsLookup([FQ_JOB, DRAFT_JOB, HD_JOB, FAILED_JOB]),
    ])
  })

  // The job stores the engine as the engine recorded it: the internal id, or (an engine that knows them) a public one, earlier or current.
  for (const stored of ["kling-4", "motion-lite", "motion-pulse"]) it(`a completed Nodaro Motion Pulse run at 720p (stored as ${stored}) can be redone in Full Quality (a new take); at 1080p it cannot`, async () => {
    const KLING_720 = "00000000-0000-4000-8000-0000000000e7"
    const KLING_1080 = "00000000-0000-4000-8000-0000000000e8"
    const fqRow = jobRow(FQ_JOB, {
      status: "processing", completed_at: null,
      input_data: runInput({ engine: stored, fullQualityOf: KLING_720, resolution: "1080p", draft: false }),
      created_at: "2026-10-21T10:00:00.000000+00:00",
    })
    feed(
      [
        fqRow,
        jobRow(KLING_720, { input_data: runInput({ engine: stored, resolution: "720p", draft: false }) }),
        jobRow(KLING_1080, { input_data: runInput({ engine: stored, resolution: "1080p", draft: false }), created_at: "2026-10-19T10:00:00.000000+00:00" }),
      ],
      [fqRow],
    )
    const res = await app.inject({ method: "GET", url: "/v1/trends/runs", headers: as() })
    expect(res.statusCode).toBe(200)
    const runs = res.json().data
    expect(runs[0]).toMatchObject({ jobId: FQ_JOB, engine: "motion-pulse", engineName: "Nodaro Motion Pulse", fullQualityOf: KLING_720, fullQuality: null, fullQualityUntil: null })
    expect(runs[1]).toMatchObject({
      jobId: KLING_720, engine: "motion-pulse", resolution: "720p", draft: false,
      fullQuality: { jobId: FQ_JOB, status: "processing" },
      fullQualityUntil: "2026-10-27T10:00:00.000Z",
    })
    expect(runs[2]).toMatchObject({ jobId: KLING_1080, engine: "motion-pulse", fullQuality: null, fullQualityUntil: null })
    // The upgrades looked up are the 720p run's only.
    const lookups = db.log.filter((q) => q.table === "jobs" && q.ops.some((op) => op.m === "in"))
    expect(lookups.map((q) => argOf(q, "in"))).toEqual([
      ["input_data->>fullQualityOf", [KLING_720]],
      ["input_data->>fullQualityOf", [KLING_720]],
      stepsLookup([FQ_JOB, KLING_720, KLING_1080]),
    ])
  })

  it("a Full Quality version whose draft was deleted is still listed, with its own result and charge", async () => {
    feed(
      [jobRow(FQ_JOB, { input_data: runInput({ fullQualityOf: DRAFT_JOB, resolution: "1080p", draft: false, __draftJobId: DRAFT_JOB }) })],
      [],
      [{ id: `ul-${FQ_JOB}`, status: "committed", credits_used: 300, credits_charged: 260 }],
    )
    const res = await app.inject({ method: "GET", url: "/v1/trends/runs", headers: as() })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([
      expect.objectContaining({
        jobId: FQ_JOB,
        status: "completed",
        fullQualityOf: DRAFT_JOB,
        resolution: "1080p",
        draft: false,
        videoUrl: `https://out.example/${FQ_JOB}.mp4`,
        creditsCharged: 260,
        fullQuality: null,
        fullQualityUntil: null,
      }),
    ])
    // No draft on the page: the only lookup is whether the try is its draft's newest.
    const lookups = db.log.filter((q) => q.table === "jobs" && q.ops.some((op) => op.m === "in"))
    expect(lookups.map((q) => argOf(q, "in"))).toEqual([["input_data->>fullQualityOf", [DRAFT_JOB]], stepsLookup([FQ_JOB])])
    expectNoHidden(res.body)
  })

  it("a run's charge includes every step it ran (child jobs), and only settled ones", async () => {
    // The production Nodaro Motion preview of 2026-10-26: Cast Swap 44, two
    // reference preps at 66, a mask at 33, the video held 3,564 and charged 854.
    const RUN = HD_JOB
    feed(
      [jobRow(RUN, { input_data: runInput({ resolution: "720p", draft: false, preview: true }), credits: 44 })],
      [],
      [
        { id: `ul-${RUN}`, status: "committed", credits_used: 44, credits_charged: 44 },
        { id: "ul-ref-1", status: "committed", credits_used: 66, credits_charged: 66 },
        { id: "ul-ref-2", status: "committed", credits_used: 66, credits_charged: 66 },
        { id: "ul-mask", status: "committed", credits_used: 33, credits_charged: 33 },
        { id: "ul-video", status: "committed", credits_used: 3564, credits_charged: 854 },
      ],
      [
        { id: "ref-1", parent_job_id: RUN, usage_log_id: "ul-ref-1", credits: 66 },
        { id: "ref-2", parent_job_id: RUN, usage_log_id: "ul-ref-2", credits: 66 },
        { id: "mask", parent_job_id: RUN, usage_log_id: "ul-mask", credits: 33 },
        { id: "video", parent_job_id: RUN, usage_log_id: "ul-video", credits: 3564 },
      ],
    )
    const res = await app.inject({ method: "GET", url: "/v1/trends/runs", headers: as() })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([expect.objectContaining({ jobId: RUN, creditsCharged: 1063, creditsHeld: 3773, creditsReleased: 2710 })])
    const steps = db.log.filter((q) => q.table === "jobs" && q.ops.some((op) => op.m === "in" && op.a[0] === "parent_job_id"))
    expect(steps.length).toBeGreaterThan(0)
    for (const q of steps) expect(has(q, "eq", "user_id", USER)).toBe(true)
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

describe("GET /v1/trends/runs — only the newest Full Quality try of a draft is listed", () => {
  type Row = ReturnType<typeof jobRow>
  const at = (n: number) => `2026-10-20T10:${String(n).padStart(2, "0")}:00.000000+00:00`
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
  const fqOf = (r: Row) => (r.input_data as { fullQualityOf?: string }).fullQualityOf
  const tryOf = (n: number, draft: string, status = "failed") =>
    jobRow(id(n), { status, created_at: at(n), input_data: runInput({ fullQualityOf: draft, resolution: "1080p", draft: false }) })

  /**
   * An in-memory jobs table, newest first: the list read honours the keyset
   * `or` and `limit`; the Full Quality lookup answers every try of the asked
   * drafts, from the same rows.
   */
  function feedTable(rows: Row[]) {
    const sorted = [...rows].sort((a, b) =>
      a.created_at !== b.created_at ? (a.created_at < b.created_at ? 1 : -1) : a.id < b.id ? 1 : a.id > b.id ? -1 : 0,
    )
    db.respond = (q) => {
      if (q.table === "usage_logs") return { data: [], error: null }
      if (q.table !== "jobs") return { data: null, error: null }
      const fq = q.ops.find((op) => op.m === "in" && op.a[0] === "input_data->>fullQualityOf")
      if (fq) return { data: sorted.filter((r) => (fq.a[1] as string[]).includes(fqOf(r) ?? "")), error: null }
      let out = sorted
      const or = argOf(q, "or")?.[0] as string | undefined
      if (or) {
        const m = /^created_at\.lt\."([^"]+)",and\(created_at\.eq\."[^"]+",id\.lt\."([^"]+)"\)$/.exec(or)!
        out = out.filter((r) => r.created_at < m[1]! || (r.created_at === m[1]! && r.id < m[2]!))
      }
      const limit = argOf(q, "limit")?.[0] as number | undefined
      return { data: limit === undefined ? out : out.slice(0, limit), error: null }
    }
  }

  /** Every page of `/v1/trends/runs?limit=` (bounded, so a cursor that never moves fails the test). */
  async function allPages(limit: number) {
    const pages: string[][] = []
    let cursor: string | null = null
    for (let i = 0; i < 20; i++) {
      const res = await app.inject({ method: "GET", url: `/v1/trends/runs?limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`, headers: as() })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { data: Array<{ jobId: string }>; next: string | null }
      pages.push(body.data.map((r) => r.jobId))
      cursor = body.next
      if (!cursor) return pages
    }
    throw new Error("the cursor never ran out")
  }

  it("hides a draft's older tries; the draft points at the newest", async () => {
    const draft = jobRow(DRAFT_JOB, { created_at: at(1) })
    feedTable([draft, tryOf(2, DRAFT_JOB), tryOf(3, DRAFT_JOB, "cancelled"), tryOf(4, DRAFT_JOB, "processing")])
    const res = await app.inject({ method: "GET", url: "/v1/trends/runs", headers: as() })
    const runs = res.json().data as Array<{ jobId: string; fullQuality: unknown }>
    expect(runs.map((r) => r.jobId)).toEqual([id(4), DRAFT_JOB])
    expect(runs[1]!.fullQuality).toEqual({ jobId: id(4), status: "processing" })
  })

  it("the newest try is listed whatever its status: its last failure stays", async () => {
    feedTable([jobRow(DRAFT_JOB, { created_at: at(1) }), tryOf(2, DRAFT_JOB, "cancelled"), tryOf(3, DRAFT_JOB, "failed")])
    const runs = (await app.inject({ method: "GET", url: "/v1/trends/runs", headers: as() })).json().data
    expect(runs.map((r: { jobId: string; status: string }) => [r.jobId, r.status])).toEqual([[id(3), "failed"], [DRAFT_JOB, "completed"]])
  })

  it("a try is hidden on a later page when the newest one was on an earlier page", async () => {
    // Newest first: try 9 (newest of draft A), other runs, then try 2 (older, of A) on page 2.
    const draftA = jobRow(DRAFT_JOB, { created_at: at(1) })
    const others = [3, 4, 5, 6].map((n) => jobRow(id(n), { created_at: at(n), input_data: runInput({ draft: false, resolution: "720p" }) }))
    feedTable([draftA, tryOf(2, DRAFT_JOB), ...others, tryOf(9, DRAFT_JOB)])
    const pages = await allPages(2)
    expect(pages.flat()).toEqual([id(9), id(6), id(5), id(4), id(3), DRAFT_JOB])
    expect(pages.flat()).not.toContain(id(2))
  })

  it("more hidden tries in a row than a page holds: no visible run is lost or repeated, and the cursor moves on", async () => {
    // Draft A's tries 2–40 (39 of them, all superseded by try 41), between two visible runs.
    const tries = Array.from({ length: 39 }, (_, i) => tryOf(i + 2, DRAFT_JOB))
    const before = jobRow(id(50), { created_at: at(50), input_data: runInput({ draft: false, resolution: "720p" }) })
    // The draft and its newest try sit at the very start and end of the list.
    const rows = [jobRow(DRAFT_JOB, { created_at: at(1) }), ...tries, tryOf(41, DRAFT_JOB, "completed"), before]
    feedTable(rows)
    const pages = await allPages(2)
    expect(pages.flat()).toEqual([id(50), id(41), DRAFT_JOB])
    for (const p of pages) expect(p.length).toBeLessThanOrEqual(2)
  })

  it("?trend= hides superseded tries too", async () => {
    feedTable([jobRow(DRAFT_JOB, { created_at: at(1) }), tryOf(2, DRAFT_JOB), tryOf(3, DRAFT_JOB, "completed")])
    const res = await app.inject({ method: "GET", url: "/v1/trends/runs?trend=neon-dance", headers: as() })
    expect(res.json().data.map((r: { jobId: string }) => r.jobId)).toEqual([id(3), DRAFT_JOB])
  })

  it("GET /v1/trends/runs/:jobId still reads a superseded try by its id", async () => {
    const old = tryOf(2, DRAFT_JOB)
    db.respond = (q) => {
      if (q.table !== "jobs") return { data: q.table === "usage_logs" ? [] : null, error: null }
      if (q.ops.some((op) => op.m === "in")) return { data: [tryOf(3, DRAFT_JOB, "completed"), old], error: null }
      return { data: old, error: null }
    }
    const res = await app.inject({ method: "GET", url: `/v1/trends/runs/${id(2)}`, headers: as() })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ jobId: id(2), status: "failed", fullQualityOf: DRAFT_JOB })
  })
})

describe("GET /v1/trends/runs/:jobId", () => {
  /** The one-row read answers `row`; the upgrade lookup answers `fq`. */
  function feedOne(row: unknown, fq: unknown[] = [], usage: Array<Record<string, unknown>> = []) {
    db.respond = (q) => {
      if (q.table === "usage_logs") return { data: usage, error: null }
      if (q.table !== "jobs") return { data: null, error: null }
      // The run's steps (child jobs): none here.
      if (q.ops.some((op) => op.m === "in" && op.a[0] === "parent_job_id")) return { data: [], error: null }
      const isFq = q.ops.some((op) => op.m === "in" && op.a[0] === "input_data->>fullQualityOf")
      return { data: isFq ? fq : row, error: null }
    }
  }

  it("reads back a run of a trend with no example: example 0, the kept slot with no pictures", async () => {
    const slots = [
      { key: "lead", label: "Lead dancer", kind: "person", images: ["https://u.example/me.png"], fromExample: false, body: "new", outfit: "new", hair: "original" },
      { key: "place", label: "Place", kind: "location", images: [], fromExample: false },
    ]
    feedOne(jobRow(DRAFT_JOB, { input_data: runInput({ example: 0, slots }) }))
    const res = await app.inject({ method: "GET", url: `/v1/trends/runs/${DRAFT_JOB}`, headers: as() })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ example: 0, slots })
    expectNoHidden(res.body)
  })

  it("reads one of the caller's top-level trend runs, in the list's shape", async () => {
    const fq = jobRow(FQ_JOB, { status: "completed", input_data: runInput({ fullQualityOf: DRAFT_JOB, resolution: "1080p", draft: false }) })
    feedOne(jobRow(DRAFT_JOB), [fq], [{ id: `ul-${DRAFT_JOB}`, status: "committed", credits_used: 120, credits_charged: 95 }])
    const res = await app.inject({ method: "GET", url: `/v1/trends/runs/${DRAFT_JOB}`, headers: as() })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({
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
      engine: "motion-prism",
      engineName: "Nodaro Motion Prism",
      videoUrl: `https://out.example/${DRAFT_JOB}.mp4`,
      posterUrl: null,
      creditsCharged: 95,
      creditsHeld: null,
      creditsReleased: null,
      fullQualityOf: null,
      // A pointer only: the upgrade's video is read from its own run.
      fullQuality: { jobId: FQ_JOB, status: "completed" },
      fullQualityUntil: "2026-10-27T10:00:00.000Z",
    })
    expectNoHidden(res.body)

    const [q] = db.log.filter((x) => x.table === "jobs")
    expect(has(q!, "eq", "id", DRAFT_JOB)).toBe(true)
    expect(has(q!, "eq", "user_id", USER)).toBe(true)
    expect(has(q!, "filter", "input_data->>type", "eq", "cast-swap")).toBe(true)
    expect(has(q!, "not", "input_data->trend", "is", null)).toBe(true)
    // A step of another job (a child) is never a run.
    expect(has(q!, "is", "parent_job_id", null)).toBe(true)
  })

  it("a Full Quality version reads as its own run", async () => {
    feedOne(jobRow(FQ_JOB, { input_data: runInput({ fullQualityOf: DRAFT_JOB, resolution: "1080p", draft: false, __draftJobId: DRAFT_JOB }) }))
    const res = await app.inject({ method: "GET", url: `/v1/trends/runs/${FQ_JOB}`, headers: as() })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ jobId: FQ_JOB, fullQualityOf: DRAFT_JOB, draft: false, resolution: "1080p", fullQuality: null })
    expectNoHidden(res.body)
  })

  it("a failed run's error is the fixed public one", async () => {
    feedOne(jobRow(FAILED_JOB, { status: "failed", output_data: null, completed_at: null, error_message: `Could not download ${SOURCE}` }))
    const res = await app.inject({ method: "GET", url: `/v1/trends/runs/${FAILED_JOB}`, headers: as() })
    expect(res.json().data.error).toEqual({ code: "failed", message: "This run didn't finish." })
    expectNoHidden(res.body)
  })

  it("is a 404 for an id that is not a job id, without reading anything", async () => {
    feedOne(jobRow(DRAFT_JOB))
    const res = await app.inject({ method: "GET", url: "/v1/trends/runs/not-a-uuid", headers: as() })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(db.log.filter((q) => q.table === "jobs")).toHaveLength(0)
  })

  it("is a 404 for a job that is not the caller's trend run (not theirs, a child, or no trend stamp)", async () => {
    feedOne(null)
    const missing = await app.inject({ method: "GET", url: `/v1/trends/runs/${HD_JOB}`, headers: as() })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error.code).toBe("not_found")

    // A Cast Swap job whose stamp is not a trend's never maps to a run.
    feedOne(jobRow(HD_JOB, { input_data: { type: "cast-swap", trend: { slug: "x" } } }))
    const unstamped = await app.inject({ method: "GET", url: `/v1/trends/runs/${HD_JOB}`, headers: as() })
    expect(unstamped.statusCode).toBe(404)
  })

  it("needs a signed-in caller, and jobs:read for an OAuth app", async () => {
    feedOne(jobRow(DRAFT_JOB))
    expect((await app.inject({ method: "GET", url: `/v1/trends/runs/${DRAFT_JOB}` })).statusCode).toBe(401)
    const denied = await app.inject({ method: "GET", url: `/v1/trends/runs/${DRAFT_JOB}`, headers: as({ "x-app-scopes": "assets:write" }) })
    expect(denied.statusCode).toBe(403)
    const ok = await app.inject({ method: "GET", url: `/v1/trends/runs/${DRAFT_JOB}`, headers: as({ "x-app-scopes": "jobs:read" }) })
    expect(ok.statusCode).toBe(200)
  })

  it("a failed read is a 500", async () => {
    db.respond = (q) => (q.table === "jobs" ? { data: null, error: { message: "down" } } : { data: null, error: null })
    const res = await app.inject({ method: "GET", url: `/v1/trends/runs/${DRAFT_JOB}`, headers: as() })
    expect(res.statusCode).toBe(500)
  })
})

// ── tags ───────────────────────────────────────────────────────────────────

describe("GET /v1/trends/tags", () => {
  /** `trends` answers the published trends' tags; `trend_tags` the labels (or `labelsError`). */
  function feedTags(tagRows: Array<{ tags: string[] }>, labelRows: Array<{ tag: string; labels: unknown }>, labelsError: unknown = null) {
    db.respond = (q) => {
      if (q.table === "trends") return { data: tagRows, error: null }
      if (q.table === "trend_tags") return labelsError ? { data: null, error: labelsError } : { data: labelRows, error: null }
      return { data: null, error: null }
    }
  }

  it("is not captured by /:slug: the tags of published trends, most used first, labelled in ?locale=", async () => {
    feedTags(
      [{ tags: ["dance", "duo"] }, { tags: ["dance", "pets"] }],
      [
        { tag: "dance", labels: { en: "Dance", he: "ריקוד" } },
        { tag: "duo", labels: { en: "Duo" } },
      ],
    )
    const res = await app.inject({ method: "GET", url: "/v1/trends/tags?locale=he", headers: as() })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      data: [
        { tag: "dance", label: "ריקוד", count: 2 },
        { tag: "duo", label: "Duo", count: 1 }, // no Hebrew → English
        { tag: "pets", label: "pets", count: 1 }, // no label → the tag itself
      ],
    })
    const [trends] = db.log.filter((q) => q.table === "trends")
    expect(has(trends!, "eq", "status", "published")).toBe(true)
    // The labels table is small: read whole and matched in memory, never by an `in` of the tags.
    const [labels] = db.log.filter((q) => q.table === "trend_tags")
    expect(labels!.ops.some((op) => op.m === "in")).toBe(false)
  })

  it("a tag holding a quote, a comma or parentheses lists like any other (it never reaches a query)", async () => {
    const odd = ['say "hi"', "a,b", "(x)", "it's"]
    feedTags([{ tags: odd }], [{ tag: 'say "hi"', labels: { en: "Hi" } }])
    const res = await app.inject({ method: "GET", url: "/v1/trends/tags", headers: as() })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([
      { tag: "(x)", label: "(x)", count: 1 },
      { tag: "a,b", label: "a,b", count: 1 },
      { tag: "it's", label: "it's", count: 1 },
      { tag: 'say "hi"', label: "Hi", count: 1 },
    ])
    for (const q of db.log) expect(q.ops.some((op) => op.m === "in" || op.m === "or"), q.table).toBe(false)
  })

  it("without ?locale= uses the profile's language", async () => {
    db.respond = (q) => {
      if (q.table === "profiles") return { data: { preferred_locale: "he" }, error: null }
      if (q.table === "trends") return { data: [{ tags: ["dance"] }], error: null }
      if (q.table === "trend_tags") return { data: [{ tag: "dance", labels: { en: "Dance", he: "ריקוד" } }], error: null }
      return { data: null, error: null }
    }
    const res = await app.inject({ method: "GET", url: "/v1/trends/tags", headers: as() })
    expect(res.json().data).toEqual([{ tag: "dance", label: "ריקוד", count: 1 }])
  })

  it("no published trend: no tags, and no label read", async () => {
    feedTags([], [])
    const res = await app.inject({ method: "GET", url: "/v1/trends/tags", headers: as() })
    expect(res.json()).toEqual({ data: [] })
    expect(db.log.some((q) => q.table === "trend_tags")).toBe(false)
  })

  it("a database without the labels table still lists the tags, each labelled as itself", async () => {
    feedTags([{ tags: ["dance"] }], [], { code: "PGRST205", message: "Could not find the table 'public.trend_tags'" })
    const res = await app.inject({ method: "GET", url: "/v1/trends/tags?locale=he", headers: as() })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([{ tag: "dance", label: "dance", count: 1 }])
  })

  it("a database without the trend tables is 503 not_available", async () => {
    db.respond = (q) => (q.table === "trends" ? { data: null, error: { code: "42P01", message: "missing" } } : { data: null, error: null })
    const res = await app.inject({ method: "GET", url: "/v1/trends/tags", headers: as() })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("not_available")
  })

  it("needs a signed-in caller, and jobs:read for an OAuth app", async () => {
    feedTags([], [])
    expect((await app.inject({ method: "GET", url: "/v1/trends/tags" })).statusCode).toBe(401)
    const denied = await app.inject({ method: "GET", url: "/v1/trends/tags", headers: as({ "x-app-scopes": "assets:write" }) })
    expect(denied.statusCode).toBe(403)
    const ok = await app.inject({ method: "GET", url: "/v1/trends/tags", headers: as({ "x-app-scopes": "jobs:read" }) })
    expect(ok.statusCode).toBe(200)
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
