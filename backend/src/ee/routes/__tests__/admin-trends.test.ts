/**
 * /v1/admin/trends (ee/routes/admin-trends.ts) — building, testing, promoting
 * and publishing trends.
 *
 * What must hold:
 *  - copy-on-write (Review Focus 3): a new trend is draft v1; editing a
 *    published trend writes v2 while the public route keeps showing v1 until
 *    the next publish;
 *  - publish refuses with EVERY reason at once, including the engine check of
 *    each environment (D17): a missing row is `engine_unknown`, a missing
 *    capability `engine_unsupported` with `env` and `need`;
 *  - only a finished run by an ADMIN account, with pictures for every slot,
 *    becomes an example (D16), and its media is COPIED into trend storage;
 *  - a source clip outside 4–30 s is refused before anything is stored;
 *  - a test run is composed from the DRAFT version and dispatched as the admin;
 *  - "Show prompt" returns the Seedance child's prompt;
 *  - every route is admin-only.
 *
 * The store is an in-memory stand-in honouring the store's contract
 * (copy-on-write included; the store's own queries are pinned in
 * lib/trends/__tests__/store.test.ts); jobs, profiles and engine environments
 * go through the recording fake Supabase; downloads, ffprobe and the storage
 * upload are stubbed; Cast Swap is a stub route that records what it receives.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { has, type QueryResult, type RecordedQuery } from "../../../lib/__tests__/fake-supabase-query.js"
import type { TrendRow, TrendVersionData } from "../../lib/trends/types.js"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  respond: null as null | ((q: RecordedQuery) => QueryResult),
}))

vi.mock("../../../lib/supabase.js", async () => {
  const { makeFakeFrom } = await import("../../../lib/__tests__/fake-supabase-query.js")
  return { supabase: { from: makeFakeFrom(db.log, (q) => db.respond!(q)) } }
})

type MemVersion = { data: TrendVersionData; published: boolean; revision?: string }
type MemTrend = TrendRow & { versions: Record<number, MemVersion> }

const mem = vi.hoisted(() => ({
  revs: 0,
  /** Called once per upload, before it lands: a hook for "meanwhile, someone else wrote". */
  onUpload: null as null | (() => void | Promise<void>),
  /** Called when the engine environments are read (during publish's checks). */
  onEnvRead: null as null | (() => void),
  trends: [] as MemTrend[],
  admins: new Set<string>(),
  uploads: [] as Array<{ key: string; contentType: string }>,
  downloads: new Map<string, string>(),
  durations: new Map<string, number>(),
  /** The store fails as on a database without migration 549's tables. */
  missingTables: false,
}))

vi.mock("../../lib/trends/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/trends/store.js")>()
  const strip = (t: MemTrend): TrendRow => {
    const { versions: _v, ...row } = t
    return { ...row, tags: [...row.tags], badges: [...row.badges] }
  }
  const find = (id: string) => {
    const t = mem.trends.find((x) => x.id === id)
    if (!t) throw new actual.TrendNotFoundError(id)
    return t
  }
  const touch = (t: MemTrend) => {
    t.updatedAt = new Date().toISOString()
  }
  /** A version's revision: a new one on every write of its data (assigned on first read for seeded rows). */
  const rev = (v: MemVersion) => (v.revision ??= `rev-${++mem.revs}`)
  return {
    ...actual,
    getTrendById: async (id: string) => {
      const t = mem.trends.find((x) => x.id === id)
      return t ? strip(t) : null
    },
    getTrendBySlug: async (slug: string) => {
      const t = mem.trends.find((x) => x.slug === slug)
      return t ? strip(t) : null
    },
    getVersion: async (id: string, version: number) => {
      const v = mem.trends.find((x) => x.id === id)?.versions[version]
      return v ? structuredClone(v.data) : null
    },
    getDraftState: async (id: string) => {
      const t = mem.trends.find((x) => x.id === id)
      if (!t) return null
      const v = t.versions[t.draftVersion]!
      return { trend: strip(t), data: structuredClone(v.data), revision: rev(v) }
    },
    createTrend: async (input: { slug: string; data: TrendVersionData; createdBy?: string }) => {
      if (mem.trends.some((t) => t.slug === input.slug)) throw new actual.TrendSlugTakenError(input.slug)
      const id = `00000000-0000-4000-8000-${String(mem.trends.length + 1).padStart(12, "0")}`
      mem.trends.push({
        id, slug: input.slug, status: "draft", tags: [], badges: [], sortOrder: 0,
        draftVersion: 1, publishedVersion: null, createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z",
        versions: { 1: { data: structuredClone(input.data), published: false } },
      })
      return { id }
    },
    listAllTrends: async () => {
      if (mem.missingTables) throw new actual.TrendsUnavailableError()
      return mem.trends.map((t) => ({ ...strip(t), draft: structuredClone(t.versions[t.draftVersion]?.data ?? null) }))
    },
    updateTrendMeta: async (id: string, patch: { slug?: string; tags?: string[]; badges?: TrendRow["badges"]; sortOrder?: number }) => {
      const t = mem.trends.find((x) => x.id === id)
      if (!t) return null
      Object.assign(t, patch)
      touch(t)
      return strip(t)
    },
    saveDraft: async (id: string, data: TrendVersionData, opts: { expectedRevision?: string } = {}) => {
      const t = find(id)
      const cur = t.versions[t.draftVersion]!
      if (opts.expectedRevision !== undefined && rev(cur) !== opts.expectedRevision) throw new actual.DraftConflictError(id)
      const revision = `rev-${++mem.revs}`
      if (t.publishedVersion === t.draftVersion || cur.published) {
        t.draftVersion += 1
        t.versions[t.draftVersion] = { data: structuredClone(data), published: false, revision }
      } else {
        cur.data = structuredClone(data)
        cur.revision = revision
      }
      touch(t)
      return { version: t.draftVersion, revision }
    },
    publish: async (id: string, expected?: { version: number; revision: string }) => {
      const t = find(id)
      if (expected && (expected.version !== t.draftVersion || rev(t.versions[t.draftVersion]!) !== expected.revision)) {
        throw new actual.DraftConflictError(id)
      }
      t.versions[t.draftVersion]!.published = true
      t.publishedVersion = t.draftVersion
      t.status = "published"
      touch(t)
    },
    unpublish: async (id: string) => {
      const t = find(id)
      if (t.status === "published") t.status = "unpublished"
      touch(t)
    },
    favoriteIds: async () => new Set<string>(),
  }
})

vi.mock("../../../lib/admin-check.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/admin-check.js")>()
  return { ...actual, checkIsAdmin: async (userId: string) => mem.admins.has(userId) }
})

vi.mock("../../../lib/storage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/storage.js")>()
  return {
    ...actual,
    uploadFileWithKeyToR2: async (_file: string, key: string, contentType: string) => {
      const hook = mem.onUpload
      mem.onUpload = null
      await hook?.()
      mem.uploads.push({ key, contentType })
      return `https://cdn.test/${key}`
    },
  }
})

vi.mock("../../../providers/video/ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../providers/video/ffmpeg-utils.js")>()
  const { writeFile } = await import("node:fs/promises")
  const MP4 = Buffer.from([0, 0, 0, 0x18, ...Buffer.from("ftypisom"), 0, 0, 0, 0])
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return {
    ...actual,
    downloadFile: async (url: string, dest: string) => {
      mem.downloads.set(dest, url)
      if (url.endsWith(".mp4")) await writeFile(dest, MP4)
      else if (url.endsWith(".png")) await writeFile(dest, PNG)
      else await writeFile(dest, "not media at all")
    },
    probeVideoSource: async (path: string) => ({
      width: 720,
      height: 1280,
      durationSeconds: mem.durations.get(mem.downloads.get(path) ?? "") ?? 12,
    }),
  }
})

import { adminTrendsRoutes } from "../admin-trends.js"
import { trendRoutes } from "../trends.js"
import { resolveRequestOrigin } from "../../../lib/client-origin-scope.js"
import { resolveRequestSession } from "../../../lib/generation-session-scope.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../lib/private-plugins/supports-registry.js"

// ── fixtures ───────────────────────────────────────────────────────────────

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const ADMIN2 = "00000000-0000-4000-8000-0000000000ae"
const USER = "00000000-0000-4000-8000-000000000001"
const SECRET = "0".repeat(64) // src/test/setup.ts
const T1 = "00000000-0000-4000-8000-0000000000a1"
const RUN = "00000000-0000-4000-8000-0000000000b1"
const CHILD = "00000000-0000-4000-8000-0000000000c1"

const CAST_SWAP_ALL = {
  roleKinds: ["person", "location", "product", "pet"] as Array<"person" | "location" | "product" | "pet">,
  fixedReferences: true,
  fullQuality: true,
  resolutions: ["480p", "720p", "1080p"] as Array<"480p" | "720p" | "1080p">,
  trendRun: true,
  faceMasking: true,
  trendPrePrompt: true,
}

function draftData(over: Partial<TrendVersionData> = {}): TrendVersionData {
  return {
    name: { en: "Neon Dance" },
    source: { videoUrl: `https://cdn.test/trends/${T1}/src.mp4`, durationSec: 12, width: 720, height: 1280 },
    previewStart: 2,
    slots: [
      { key: "lead", label: { en: "Lead dancer" }, kind: "person", required: true, roleName: "the woman on the left" },
      { key: "dog", label: { en: "Dog" }, kind: "pet", required: false, roleName: "the dog" },
    ],
    references: [],
    trendPrompt: "DRAFT-PROMPT neon lights",
    examples: [],
    ...over,
  }
}

const EXAMPLE = {
  videoUrl: `https://cdn.test/trends/${T1}/ex1.mp4`,
  width: 720,
  height: 1280,
  durationSec: 12,
  slots: { lead: [`https://cdn.test/trends/${T1}/ex1-lead.png`], dog: [`https://cdn.test/trends/${T1}/ex1-dog.png`] },
  sourceJobId: "00000000-0000-4000-8000-0000000000b0",
}

function seed(over: Partial<MemTrend> = {}, data = draftData()) {
  const t: MemTrend = {
    id: T1, slug: "neon-dance", status: "draft", tags: [], badges: [], sortOrder: 0,
    draftVersion: 1, publishedVersion: null, createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z",
    versions: { 1: { data, published: false } },
    ...over,
  }
  mem.trends.push(t)
  return t
}

/** An environment row; `castSwap: null` = an engine that records no Cast Swap supports at all. */
function envRow(env: string, castSwap: unknown = { ...CAST_SWAP_ALL }) {
  return { env, plugin_build_id: "b1", supports: castSwap === null ? {} : { castSwap }, updated_at: "2026-10-20T00:00:00Z" }
}

function runInput(over: Record<string, unknown> = {}) {
  return {
    type: "cast-swap",
    trend: { id: T1, slug: "neon-dance", version: 1, name: "Neon Dance" },
    example: 1,
    slots: [
      { key: "lead", label: "Lead dancer", kind: "person", images: ["https://u.example/lead.png"], fromExample: false, body: "new", outfit: "new", hair: "new" },
      { key: "dog", label: "Dog", kind: "pet", images: ["https://u.example/dog.png"], fromExample: false, body: "new", coat: "new" },
    ],
    preview: false,
    resolution: "480p",
    draft: true,
    __videoUrl: "https://cdn.test/trends/x/src.mp4",
    ...over,
  }
}

function jobRow(id: string, userId: string, over: Record<string, unknown> = {}) {
  return {
    id,
    user_id: userId,
    status: "completed",
    progress: 100,
    input_data: runInput(),
    output_data: { videoUrl: "https://out.example/run.mp4", thumbnailUrl: "https://out.example/run.png", __castSwapChildJobId: CHILD },
    error_message: null,
    error_hint: null,
    created_at: "2026-10-20T10:00:00.000000+00:00",
    started_at: "2026-10-20T09:58:00.000000+00:00",
    completed_at: "2026-10-20T10:00:00.000000+00:00",
    usage_log_id: null,
    ...over,
  }
}

const world = {
  jobs: new Map<string, Record<string, unknown>>(),
  envs: [] as unknown[],
  /** trend_tags: tag → labels (null = the table is missing, as before migration 555). */
  tagLabels: new Map<string, Record<string, string>>() as Map<string, Record<string, string>> | null,
}

const engine = {
  calls: [] as Array<{ url: string; headers: Record<string, unknown>; body: Record<string, unknown>; stamps?: { origin: string | null; sessionId: string | null } }>,
}

function respondTrendTags(q: RecordedQuery): QueryResult {
  if (!world.tagLabels) return { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.trend_tags'" } }
  const upsert = q.ops.find((op) => op.m === "upsert")
  if (upsert) {
    const row = upsert.a[0] as { tag: string; labels: Record<string, string> }
    world.tagLabels.set(row.tag, row.labels)
    return { data: null, error: null }
  }
  if (q.ops.some((op) => op.m === "delete")) {
    world.tagLabels.delete(q.ops.find((op) => op.m === "eq" && op.a[0] === "tag")!.a[1] as string)
    return { data: null, error: null }
  }
  return { data: [...world.tagLabels].map(([tag, labels]) => ({ tag, labels })), error: null }
}

function respond(q: RecordedQuery): QueryResult {
  if (q.table === "trend_tags") return respondTrendTags(q)
  // The tag usage reads go to the trends table itself (the store is in memory).
  if (q.table === "trends") return { data: mem.trends.map((t) => ({ status: t.status, tags: t.tags })), error: null }
  if (q.table === "engine_environments") {
    const hook = mem.onEnvRead
    mem.onEnvRead = null
    hook?.()
    return { data: world.envs, error: null }
  }
  if (q.table === "profiles") {
    // adminUserIds(): every admin account by role.
    if (q.ops.some((op) => op.m === "in" && op.a[0] === "role")) return { data: [...mem.admins].map((id) => ({ id })), error: null }
    return { data: null, error: null }
  }
  if (q.table === "jobs") {
    const byId = q.ops.find((op) => op.m === "eq" && op.a[0] === "id")
    if (byId) return { data: world.jobs.get(byId.a[1] as string) ?? null, error: null }
    // Newest first (created_at, then id), as the routes order them.
    const all = [...world.jobs.values()].sort((a, b) => {
      const [x, y] = [String(a.created_at) + String(a.id), String(b.created_at) + String(b.id)]
      return x < y ? 1 : x > y ? -1 : 0
    })
    const owners = q.ops.find((op) => op.m === "in" && op.a[0] === "user_id")?.a[1] as string[] | undefined
    const own = all.filter((r) => !owners || owners.includes(r.user_id as string))
    const fq = q.ops.find((op) => op.m === "in" && op.a[0] === "input_data->>fullQualityOf")
    if (fq) {
      const drafts = fq.a[1] as string[]
      return { data: own.filter((r) => drafts.includes((r.input_data as { fullQualityOf?: string })?.fullQualityOf ?? "")), error: null }
    }
    const trend = q.ops.find((op) => op.m === "filter" && op.a[0] === "input_data->trend->>id")?.a[2]
    let rows = own.filter((r) => (r.input_data as { trend?: { id?: string } })?.trend?.id === trend)
    const after = q.ops.find((op) => op.m === "or")?.a[0] as string | undefined
    if (after) {
      const m = /^created_at\.lt\."([^"]+)",and\(created_at\.eq\."[^"]+",id\.lt\."([^"]+)"\)$/.exec(after)!
      rows = rows.filter((r) => String(r.created_at) < m[1]! || (r.created_at === m[1] && String(r.id) < m[2]!))
    }
    const limit = q.ops.find((op) => op.m === "limit")?.a[0] as number | undefined
    return { data: limit === undefined ? rows : rows.slice(0, limit), error: null }
  }
  return { data: null, error: null }
}

let app: FastifyInstance

beforeEach(async () => {
  db.log.length = 0
  db.respond = respond
  mem.revs = 0
  mem.onUpload = null
  mem.onEnvRead = null
  mem.trends = []
  mem.admins = new Set([ADMIN, ADMIN2])
  mem.uploads = []
  mem.downloads = new Map()
  mem.durations = new Map()
  mem.missingTables = false
  world.jobs = new Map()
  world.tagLabels = new Map()
  world.envs = [envRow("production"), envRow("staging")]
  engine.calls = []
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
  })
  app.post("/v1/cast-swap", async (req, reply) => {
    engine.calls.push({
      url: "/v1/cast-swap",
      headers: { ...req.headers },
      body: req.body as Record<string, unknown>,
      stamps: { origin: resolveRequestOrigin(req), sessionId: await resolveRequestSession(req) },
    })
    return reply.status(202).send({ jobId: RUN })
  })
  await app.register(trendRoutes)
  await app.register(adminTrendsRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
  _resetPluginSupportsForTests()
})

const as = (userId = ADMIN) => ({ "x-user-id": userId })

function call(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown, userId = ADMIN) {
  return app.inject({ method, url, headers: as(userId), ...(payload !== undefined ? { payload: payload as object } : {}) })
}

/** The current draft revision, as `GET /:id` returns it. */
async function revisionOf(id = T1): Promise<string> {
  return (await call("GET", `/v1/admin/trends/${id}`)).json().data.revision as string
}

const reasonsOf = (res: { json: () => { error: { code: string; reasons: unknown[] } } }) => res.json().error.reasons

// ── copy-on-write ──────────────────────────────────────────────────────────

describe("create → build → publish → edit (copy-on-write, Review Focus 3)", () => {
  it("a new trend is draft v1 with no source, slots or examples, and publishing it says why not", async () => {
    const created = await call("POST", "/v1/admin/trends", { slug: "neon-dance", name: { en: "Neon Dance" } })
    expect(created.statusCode).toBe(201)
    const id = created.json().data.id as string

    const read = await call("GET", `/v1/admin/trends/${id}`)
    expect(read.statusCode).toBe(200)
    const { trend, draft, published } = read.json().data
    expect(trend).toMatchObject({ id, slug: "neon-dance", status: "draft", draftVersion: 1, publishedVersion: null })
    expect(draft).toEqual({ name: { en: "Neon Dance" }, source: null, previewStart: 0, slots: [], references: [], examples: [] })
    expect(published).toBeNull()

    const blocked = await call("POST", `/v1/admin/trends/${id}/publish`)
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().error.code).toBe("publish_blocked")
    const codes = reasonsOf(blocked).map((r) => (r as { code: string }).code)
    expect(codes).toEqual(expect.arrayContaining(["source_missing", "no_required_slot", "no_example"]))
    expect(mem.trends[0]!.status).toBe("draft")
  })

  it("refuses a taken slug, a malformed one, and a name without English", async () => {
    seed()
    expect((await call("POST", "/v1/admin/trends", { slug: "neon-dance", name: { en: "Again" } })).json().error.code).toBe("slug_taken")
    expect((await call("POST", "/v1/admin/trends", { slug: "runs", name: { en: "Runs" } })).statusCode).toBe(400)
    expect((await call("POST", "/v1/admin/trends", { slug: "tags", name: { en: "Tags" } })).statusCode).toBe(400)
    expect((await call("PATCH", `/v1/admin/trends/${T1}`, { slug: "tags" })).statusCode).toBe(400)
    expect((await call("POST", "/v1/admin/trends", { slug: "Bad Slug", name: { en: "x" } })).statusCode).toBe(400)
    expect((await call("POST", "/v1/admin/trends", { slug: "ok", name: { he: "רק עברית" } })).statusCode).toBe(400)
  })

  it("the draft saves; after publish a save makes v2 while the public page stays on v1 until republished", async () => {
    const id = (await call("POST", "/v1/admin/trends", { slug: "neon-dance", name: { en: "Neon Dance" } })).json().data.id as string

    // Save the draft: the body's examples are ignored (examples come only from runs).
    const saved = await call("PUT", `/v1/admin/trends/${id}/draft`, { data: { ...draftData(), examples: [EXAMPLE] }, revision: await revisionOf(id) })
    expect(saved.statusCode).toBe(200)
    expect(saved.json().data).toEqual({ version: 1, revision: expect.any(String) })
    expect(mem.trends[0]!.versions[1]!.data.examples).toEqual([])
    expect(mem.trends[0]!.versions[1]!.data.trendPrompt).toBe("DRAFT-PROMPT neon lights")

    // Pre prompt and face masking are saved and read back as written.
    const MASK = { mode: "always" as const, fill: "depth" as const, maxFaceHeightPct: 0, zone: { leftPct: 10 } }
    const masked = await call("PUT", `/v1/admin/trends/${id}/draft`, {
      data: { ...draftData(), prePrompt: "PRE words", faceMasking: MASK },
      revision: await revisionOf(id),
    })
    expect(masked.statusCode).toBe(200)
    const maskedRead = (await call("GET", `/v1/admin/trends/${id}`)).json().data as { draft: TrendVersionData }
    expect(maskedRead.draft).toMatchObject({ prePrompt: "PRE words", faceMasking: MASK })
    const badMask = await call("PUT", `/v1/admin/trends/${id}/draft`, {
      data: { ...draftData(), faceMasking: { mode: "always", threshold: 2 } },
      revision: await revisionOf(id),
    })
    expect(badMask.statusCode).toBe(400)

    // The engine is saved as chosen; a draft that names none keeps no key (Seedance 2.5).
    expect(maskedRead.draft).not.toHaveProperty("engine")
    const kling = await call("PUT", `/v1/admin/trends/${id}/draft`, { data: { ...draftData(), engine: "kling-4" }, revision: await revisionOf(id) })
    expect(kling.statusCode).toBe(200)
    expect(((await call("GET", `/v1/admin/trends/${id}`)).json().data as { draft: TrendVersionData }).draft.engine).toBe("kling-4")
    const badEngine = await call("PUT", `/v1/admin/trends/${id}/draft`, { data: { ...draftData(), engine: "veo" }, revision: await revisionOf(id) })
    expect(badEngine.statusCode).toBe(400)

    // The chips each slot shows to people are saved as written; only the kind's own.
    const [lead, dog] = draftData().slots
    const shown = await call("PUT", `/v1/admin/trends/${id}/draft`, {
      data: { ...draftData(), slots: [{ ...lead!, chips: ["outfit"] }, { ...dog!, chips: [] }] },
      revision: await revisionOf(id),
    })
    expect(shown.statusCode).toBe(200)
    const shownRead = (await call("GET", `/v1/admin/trends/${id}`)).json().data as { draft: TrendVersionData }
    expect(shownRead.draft.slots.map((s) => s.chips)).toEqual([["outfit"], []])
    const badChips = await call("PUT", `/v1/admin/trends/${id}/draft`, {
      data: { ...draftData(), slots: [{ ...lead!, chips: ["coat"] }, dog!] },
      revision: await revisionOf(id),
    })
    expect(badChips.statusCode).toBe(400)

    // Promote an admin run to Example 1, then publish v1.
    world.jobs.set(RUN, jobRow(RUN, ADMIN, { input_data: runInput({ trend: { id, slug: "neon-dance", version: 1, name: "Neon Dance" } }) }))
    expect((await call("POST", `/v1/admin/trends/${id}/examples`, { jobId: RUN })).statusCode).toBe(201)
    const pub = await call("POST", `/v1/admin/trends/${id}/publish`)
    expect(pub.statusCode).toBe(200)
    expect(pub.json().data).toMatchObject({ status: "published", publishedVersion: 1, draftVersion: 1 })

    const pageV1 = await app.inject({ method: "GET", url: "/v1/trends/neon-dance", headers: as(USER) })
    expect(pageV1.statusCode).toBe(200)
    expect(pageV1.json().data).toMatchObject({ name: "Neon Dance", version: 1 })

    // Edit the published trend: a NEW version; the published row is untouched.
    const loaded = (await call("GET", `/v1/admin/trends/${id}`)).json().data as { draft: TrendVersionData; revision: string }
    const edit = await call("PUT", `/v1/admin/trends/${id}/draft`, { data: { ...loaded.draft, name: { en: "Neon Dance II" } }, revision: loaded.revision })
    expect(edit.json().data).toEqual({ version: 2, revision: expect.any(String) })
    expect(mem.trends[0]!.versions[1]!.data.name.en).toBe("Neon Dance")
    expect(mem.trends[0]!.versions[2]!.data.examples).toHaveLength(1) // examples carried into v2

    const read = (await call("GET", `/v1/admin/trends/${id}`)).json().data
    expect(read.trend).toMatchObject({ draftVersion: 2, publishedVersion: 1 })
    expect(read.draft.name.en).toBe("Neon Dance II")
    expect(read.published.name.en).toBe("Neon Dance")

    const stillV1 = await app.inject({ method: "GET", url: "/v1/trends/neon-dance", headers: as(USER) })
    expect(stillV1.json().data).toMatchObject({ name: "Neon Dance", version: 1 })

    expect((await call("POST", `/v1/admin/trends/${id}/publish`)).statusCode).toBe(200)
    const v2 = await app.inject({ method: "GET", url: "/v1/trends/neon-dance", headers: as(USER) })
    expect(v2.json().data).toMatchObject({ name: "Neon Dance II", version: 2 })
  })

  it("an invalid draft is a 400 and is not saved", async () => {
    seed()
    const res = await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: { ...draftData(), source: { videoUrl: "https://x.example/a.mp4", durationSec: 3 } }, revision: await revisionOf() })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(mem.trends[0]!.versions[1]!.data.source?.durationSec).toBe(12)
  })

  it("unpublish takes it off the public catalog and keeps the published version", async () => {
    seed({ status: "published", publishedVersion: 1, versions: { 1: { data: draftData({ examples: [EXAMPLE] }), published: true } } })
    const res = await call("POST", `/v1/admin/trends/${T1}/unpublish`)
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ status: "unpublished", publishedVersion: 1 })
    expect((await app.inject({ method: "GET", url: "/v1/trends/neon-dance", headers: as(USER) })).statusCode).toBe(404)
  })

  it("PATCH changes the catalog fields only", async () => {
    seed()
    const res = await call("PATCH", `/v1/admin/trends/${T1}`, { tags: ["dance", "dance", "neon"], badges: ["new"], sortOrder: 5 })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ tags: ["dance", "neon"], badges: ["new"], sortOrder: 5 })
    expect((await call("PATCH", `/v1/admin/trends/${T1}`, {})).statusCode).toBe(400)
    expect((await call("PATCH", `/v1/admin/trends/${T1}`, { badges: ["hot"] })).statusCode).toBe(400)
  })

  it("PATCH takes tags of letters, digits, spaces, - and _ in any script, and refuses any other character with a 400", async () => {
    seed()
    const ok = await call("PATCH", `/v1/admin/trends/${T1}`, { tags: ["street dance", "k-pop", "pets_2", "ריקוד", "नृत्य", "ダンス"] })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().data.tags).toEqual(["street dance", "k-pop", "pets_2", "ריקוד", "नृत्य", "ダンス"])
    for (const bad of ['say "hi"', "it's", "a,b", "(x)", "back\\slash", "a.b", "a/b"]) {
      const res = await call("PATCH", `/v1/admin/trends/${T1}`, { tags: ["dance", bad] })
      expect(res.statusCode, bad).toBe(400)
      expect(res.json().error).toMatchObject({ code: "validation_error", message: "tags.1: A tag is letters, digits, spaces, - and _ only." })
    }
    expect(mem.trends[0]!.tags).toEqual(["street dance", "k-pop", "pets_2", "ריקוד", "नृत्य", "ダンス"])
  })

  it("lists every trend with its draft's name, cover and slot count", async () => {
    seed({}, draftData({ examples: [{ ...EXAMPLE, posterUrl: "https://cdn.test/p.png" }] }))
    const res = await call("GET", "/v1/admin/trends")
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([
      {
        id: T1, slug: "neon-dance", status: "draft", name: "Neon Dance", coverUrl: "https://cdn.test/p.png", slotCount: 2,
        draftVersion: 1, publishedVersion: null, tags: [], badges: [], sortOrder: 0, updatedAt: "2026-10-20T00:00:00Z",
      },
    ])
  })
})

describe("before migration 549 reaches the database", () => {
  it("the admin list answers 503 not_available, not 500", async () => {
    mem.missingTables = true
    const res = await call("GET", "/v1/admin/trends")
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("not_available")
  })
})

// ── media ──────────────────────────────────────────────────────────────────

describe("POST /:id/media", () => {
  it("a 3 s source clip is a 400 clip_out_of_range, and nothing is stored", async () => {
    seed()
    mem.durations.set("https://u.example/short.mp4", 3)
    const res = await call("POST", `/v1/admin/trends/${T1}/media`, { url: "https://u.example/short.mp4", kind: "source" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("clip_out_of_range")
    expect(mem.uploads).toEqual([])
  })

  it("a 31 s source clip is refused too; 4 and 30 s are kept", async () => {
    seed()
    mem.durations.set("https://u.example/long.mp4", 31)
    expect((await call("POST", `/v1/admin/trends/${T1}/media`, { url: "https://u.example/long.mp4", kind: "source" })).json().error.code)
      .toBe("clip_out_of_range")
    for (const s of [4, 30]) {
      mem.durations.set(`https://u.example/${s}.mp4`, s)
      expect((await call("POST", `/v1/admin/trends/${T1}/media`, { url: `https://u.example/${s}.mp4`, kind: "source" })).statusCode).toBe(200)
    }
  })

  it("copies a source clip into trend storage and reports its size and length", async () => {
    seed()
    const res = await call("POST", `/v1/admin/trends/${T1}/media`, { url: "https://u.example/clip.mp4", kind: "source" })
    expect(res.statusCode).toBe(200)
    const { url, durationSec, width, height } = res.json().data
    expect(url).toMatch(new RegExp(`^https://cdn\\.test/trends/${T1}/[0-9a-f-]{36}\\.mp4$`))
    expect({ durationSec, width, height }).toEqual({ durationSec: 12, width: 720, height: 1280 })
    expect(mem.uploads[0]).toMatchObject({ contentType: "video/mp4" })
  })

  it("a reference must be a picture, named by its bytes", async () => {
    seed()
    const ok = await call("POST", `/v1/admin/trends/${T1}/media`, { url: "https://u.example/ref.png", kind: "reference" })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().data.url).toMatch(new RegExp(`^https://cdn\\.test/trends/${T1}/[0-9a-f-]{36}\\.png$`))
    const video = await call("POST", `/v1/admin/trends/${T1}/media`, { url: "https://u.example/clip.mp4", kind: "reference" })
    expect(video.json().error.code).toBe("unsupported_media")
    const junk = await call("POST", `/v1/admin/trends/${T1}/media`, { url: "https://u.example/clip.txt", kind: "source" })
    expect(junk.json().error.code).toBe("unsupported_media")
  })

  it("an unknown trend is a 404", async () => {
    const res = await call("POST", `/v1/admin/trends/${T1}/media`, { url: "https://u.example/clip.mp4", kind: "source" })
    expect(res.statusCode).toBe(404)
  })
})

// ── examples ───────────────────────────────────────────────────────────────

describe("POST /:id/examples (D16)", () => {
  it("a run owned by a non-admin is 409 not_admin_run, and nothing is copied", async () => {
    seed()
    world.jobs.set(RUN, jobRow(RUN, USER))
    const res = await call("POST", `/v1/admin/trends/${T1}/examples`, { jobId: RUN })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("not_admin_run")
    expect(mem.uploads).toEqual([])
    expect(mem.trends[0]!.versions[1]!.data.examples).toEqual([])
  })

  it("a run missing a slot of the draft is 409 slots_incomplete", async () => {
    seed()
    world.jobs.set(RUN, jobRow(RUN, ADMIN, { input_data: runInput({ slots: [runInput().slots[0]] }) }))
    const res = await call("POST", `/v1/admin/trends/${T1}/examples`, { jobId: RUN })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({ code: "slots_incomplete", slots: ["dog"] })
  })

  it("an unfinished run is 409 not_completed; another trend's run is a 404", async () => {
    seed()
    world.jobs.set(RUN, jobRow(RUN, ADMIN, { status: "processing" }))
    expect((await call("POST", `/v1/admin/trends/${T1}/examples`, { jobId: RUN })).json().error.code).toBe("not_completed")
    world.jobs.set(RUN, jobRow(RUN, ADMIN, { input_data: runInput({ trend: { id: "other", slug: "x", version: 1, name: "X" } }) }))
    expect((await call("POST", `/v1/admin/trends/${T1}/examples`, { jobId: RUN })).statusCode).toBe(404)
  })

  it("a valid run (another admin's) becomes an example whose media is all COPIED into trend storage", async () => {
    seed()
    world.jobs.set(RUN, jobRow(RUN, ADMIN2))
    const res = await call("POST", `/v1/admin/trends/${T1}/examples`, { jobId: RUN })
    expect(res.statusCode).toBe(201)
    const [example] = mem.trends[0]!.versions[1]!.data.examples
    const prefix = `https://cdn.test/trends/${T1}/`
    expect(example!.videoUrl.startsWith(prefix)).toBe(true)
    expect(example!.posterUrl!.startsWith(prefix)).toBe(true)
    expect(Object.keys(example!.slots)).toEqual(["lead", "dog"])
    for (const urls of Object.values(example!.slots)) for (const u of urls) expect(u.startsWith(prefix)).toBe(true)
    expect(JSON.stringify(example)).not.toContain("out.example")
    expect(JSON.stringify(example)).not.toContain("u.example")
    expect(example).toMatchObject({ width: 720, height: 1280, durationSec: 12, sourceJobId: RUN })
  })

  it("reorders (a permutation of indexes) and removes examples", async () => {
    const a = { ...EXAMPLE, sourceJobId: "a" }, b = { ...EXAMPLE, sourceJobId: "b" }, c = { ...EXAMPLE, sourceJobId: "c" }
    seed({}, draftData({ examples: [a, b, c] }))
    const order = async (o: number[]) => call("PUT", `/v1/admin/trends/${T1}/examples/order`, { order: o, revision: await revisionOf() })
    expect((await order([0, 0, 1])).statusCode).toBe(400)
    expect((await order([1, 0])).statusCode).toBe(400)
    expect((await order([2, 0, 1])).statusCode).toBe(200)
    expect(mem.trends[0]!.versions[1]!.data.examples.map((e) => e.sourceJobId)).toEqual(["c", "a", "b"])
    const remove = async (i: number) => call("DELETE", `/v1/admin/trends/${T1}/examples/${i}?revision=${await revisionOf()}`)
    expect((await remove(1)).statusCode).toBe(200)
    expect(mem.trends[0]!.versions[1]!.data.examples.map((e) => e.sourceJobId)).toEqual(["c", "b"])
    expect((await remove(5)).statusCode).toBe(404)
  })
})

// ── concurrency: the draft's revision ──────────────────────────────────────

describe("draft revisions (concurrent writes are never silently undone)", () => {
  const RUN2 = "00000000-0000-4000-8000-0000000000b2"

  it("a draft PUT landing during a promotion's copy is preserved, and the example is appended", async () => {
    seed()
    world.jobs.set(RUN, jobRow(RUN, ADMIN))
    mem.onUpload = async () => {
      const put = await call("PUT", `/v1/admin/trends/${T1}/draft`, {
        data: { ...draftData(), trendPrompt: "EDITED WHILE COPYING" },
        revision: await revisionOf(),
      })
      expect(put.statusCode).toBe(200)
    }
    const res = await call("POST", `/v1/admin/trends/${T1}/examples`, { jobId: RUN })
    expect(res.statusCode).toBe(201)
    const draft = mem.trends[0]!.versions[1]!.data
    expect(draft.trendPrompt).toBe("EDITED WHILE COPYING")
    expect(draft.examples.map((e) => e.sourceJobId)).toEqual([RUN])
    expect(res.json().data).toMatchObject({ version: 1, revision: mem.trends[0]!.versions[1]!.revision, index: 0 })
  })

  it("a slot added during the copy that the run has no picture for is slots_incomplete, not a broken example", async () => {
    seed()
    world.jobs.set(RUN, jobRow(RUN, ADMIN))
    mem.onUpload = async () => {
      const slots = [...draftData().slots, { key: "car", label: { en: "Car" }, kind: "product" as const, required: false, roleName: "the car" }]
      await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: { ...draftData(), slots }, revision: await revisionOf() })
    }
    const res = await call("POST", `/v1/admin/trends/${T1}/examples`, { jobId: RUN })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({ code: "slots_incomplete", slots: ["car"] })
    expect(mem.trends[0]!.versions[1]!.data.examples).toEqual([])
  })

  it("two concurrent promotions both land", async () => {
    seed()
    world.jobs.set(RUN, jobRow(RUN, ADMIN))
    world.jobs.set(RUN2, jobRow(RUN2, ADMIN2))
    const [a, b] = await Promise.all([
      call("POST", `/v1/admin/trends/${T1}/examples`, { jobId: RUN }),
      call("POST", `/v1/admin/trends/${T1}/examples`, { jobId: RUN2 }),
    ])
    expect([a.statusCode, b.statusCode]).toEqual([201, 201])
    expect(mem.trends[0]!.versions[1]!.data.examples.map((e) => e.sourceJobId).sort()).toEqual([RUN, RUN2].sort())
  })

  it("a PUT with a stale revision is 409 draft_conflict and saves nothing", async () => {
    seed()
    const stale = await revisionOf()
    expect((await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: { ...draftData(), trendPrompt: "first" }, revision: stale })).statusCode).toBe(200)
    const res = await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: { ...draftData(), trendPrompt: "second" }, revision: stale })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("draft_conflict")
    expect(mem.trends[0]!.versions[1]!.data.trendPrompt).toBe("first")
    // The revision is required.
    expect((await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: draftData() })).statusCode).toBe(400)
  })

  it("a PUT never drops an example promoted since the client's load", async () => {
    seed()
    const loadedAt = await revisionOf()
    world.jobs.set(RUN, jobRow(RUN, ADMIN))
    expect((await call("POST", `/v1/admin/trends/${T1}/examples`, { jobId: RUN })).statusCode).toBe(201)

    const stale = await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: { ...draftData(), examples: [] }, revision: loadedAt })
    expect(stale.json().error.code).toBe("draft_conflict")
    expect(mem.trends[0]!.versions[1]!.data.examples).toHaveLength(1)

    // Even with the fresh revision, the body's examples are ignored: the row's are kept.
    const fresh = await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: { ...draftData(), examples: [] }, revision: await revisionOf() })
    expect(fresh.statusCode).toBe(200)
    expect(mem.trends[0]!.versions[1]!.data.examples.map((e) => e.sourceJobId)).toEqual([RUN])
  })

  it("reorder and remove with a stale revision are 409 draft_conflict", async () => {
    seed({}, draftData({ examples: [{ ...EXAMPLE, sourceJobId: "a" }, { ...EXAMPLE, sourceJobId: "b" }] }))
    const stale = await revisionOf()
    expect((await call("PUT", `/v1/admin/trends/${T1}/examples/order`, { order: [1, 0], revision: stale })).statusCode).toBe(200)
    expect((await call("PUT", `/v1/admin/trends/${T1}/examples/order`, { order: [1, 0], revision: stale })).json().error.code).toBe("draft_conflict")
    expect((await call("DELETE", `/v1/admin/trends/${T1}/examples/0?revision=${stale}`)).json().error.code).toBe("draft_conflict")
    expect((await call("DELETE", `/v1/admin/trends/${T1}/examples/0`)).statusCode).toBe(400)
    expect(mem.trends[0]!.versions[1]!.data.examples.map((e) => e.sourceJobId)).toEqual(["b", "a"])
  })

  it("a stale reorder whose example count changed is 409 draft_conflict, not a 400", async () => {
    seed({}, draftData({ examples: [{ ...EXAMPLE, sourceJobId: "a" }, { ...EXAMPLE, sourceJobId: "b" }] }))
    const stale = await revisionOf()
    expect((await call("DELETE", `/v1/admin/trends/${T1}/examples/0?revision=${stale}`)).statusCode).toBe(200)
    // The client still shows two examples and sends a permutation of them.
    const res = await call("PUT", `/v1/admin/trends/${T1}/examples/order`, { order: [1, 0], revision: stale })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("draft_conflict")
    expect(mem.trends[0]!.versions[1]!.data.examples.map((e) => e.sourceJobId)).toEqual(["b"])
  })

  it("publish refuses when the draft changed after its checks ran", async () => {
    seed({}, draftData({ examples: [EXAMPLE] }))
    // An edit lands while publish reads the engine environments (after it loaded the draft).
    mem.onEnvRead = () => {
      const v = mem.trends[0]!.versions[1]!
      v.data = { ...v.data, trendPrompt: "UNCHECKED EDIT" }
      v.revision = "rev-edited-meanwhile"
    }
    const res = await call("POST", `/v1/admin/trends/${T1}/publish`)
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("draft_conflict")
    expect(mem.trends[0]!).toMatchObject({ status: "draft", publishedVersion: null })
    expect(mem.trends[0]!.versions[1]!.published).toBe(false)
  })

  it("publish with the client's revision refuses a stale one", async () => {
    seed({}, draftData({ examples: [EXAMPLE] }))
    expect((await call("POST", `/v1/admin/trends/${T1}/publish`, { revision: "stale" })).json().error.code).toBe("draft_conflict")
    expect((await call("POST", `/v1/admin/trends/${T1}/publish`, { revision: await revisionOf() })).statusCode).toBe(200)
  })
})

describe("POST /:id/examples — a preview run", () => {
  it("is 409 preview_run, and nothing is copied", async () => {
    seed()
    world.jobs.set(RUN, jobRow(RUN, ADMIN, { input_data: runInput({ preview: true }) }))
    const res = await call("POST", `/v1/admin/trends/${T1}/examples`, { jobId: RUN })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({ code: "preview_run", message: "A 4-second preview can't be an example; use a full-length run." })
    expect(mem.uploads).toEqual([])
  })

  it("a full-length run at any resolution, draft or not, is allowed", async () => {
    seed()
    world.jobs.set(RUN, jobRow(RUN, ADMIN, { input_data: runInput({ preview: false, resolution: "1080p", draft: false }) }))
    expect((await call("POST", `/v1/admin/trends/${T1}/examples`, { jobId: RUN })).statusCode).toBe(201)
  })
})

// ── publish: the engine check (D17) ────────────────────────────────────────

describe("POST /:id/publish — engine check", () => {
  it("production without pet → engine_unsupported { env: production, need: pet }", async () => {
    seed({}, draftData({ examples: [EXAMPLE] }))
    world.envs = [envRow("production", { ...CAST_SWAP_ALL, roleKinds: ["person", "location", "product"] }), envRow("staging")]
    const res = await call("POST", `/v1/admin/trends/${T1}/publish`)
    expect(res.statusCode).toBe(409)
    expect(reasonsOf(res)).toEqual([{ code: "engine_unsupported", env: "production", need: "pet" }])
    expect(mem.trends[0]!.status).toBe("draft")
  })

  it("no staging row → engine_unknown { env: staging }", async () => {
    seed({}, draftData({ examples: [EXAMPLE] }))
    world.envs = [envRow("production")]
    const res = await call("POST", `/v1/admin/trends/${T1}/publish`)
    expect(res.statusCode).toBe(409)
    expect(reasonsOf(res)).toEqual([{ code: "engine_unknown", env: "staging" }])
  })

  it("needs fixed references, every resolution, Full Quality and trend runs where the trend uses them", async () => {
    seed({}, draftData({ examples: [EXAMPLE], references: [{ images: ["https://cdn.test/r.png"], line: "the sign" }] }))
    world.envs = [
      envRow("production", { ...CAST_SWAP_ALL, fixedReferences: false, resolutions: ["480p", "720p"], fullQuality: false, trendRun: false }),
      envRow("staging", null),
    ]
    const res = await call("POST", `/v1/admin/trends/${T1}/publish`)
    expect(reasonsOf(res)).toEqual([
      { code: "engine_unsupported", env: "staging", need: "castSwap" },
      { code: "engine_unsupported", env: "production", need: "trendRun" },
      { code: "engine_unsupported", env: "production", need: "fixedReferences" },
      { code: "engine_unsupported", env: "production", need: "1080p" },
      { code: "engine_unsupported", env: "production", need: "fullQuality" },
    ])
  })

  it("needs face masking only where the trend masks", async () => {
    const { faceMasking: _f, ...noMasking } = CAST_SWAP_ALL
    world.envs = [envRow("production", noMasking), envRow("staging", { ...CAST_SWAP_ALL, faceMasking: false })]
    seed({}, draftData({ examples: [EXAMPLE], faceMasking: { mode: "auto" } }))
    const res = await call("POST", `/v1/admin/trends/${T1}/publish`)
    expect(res.statusCode).toBe(409)
    expect(reasonsOf(res)).toEqual([
      { code: "engine_unsupported", env: "staging", need: "faceMasking" },
      { code: "engine_unsupported", env: "production", need: "faceMasking" },
    ])
    expect(mem.trends[0]!.status).toBe("draft")

    // Masking off: nothing to support.
    mem.trends = []
    seed({}, draftData({ examples: [EXAMPLE], faceMasking: { mode: "off", fill: "depth" } }))
    expect((await call("POST", `/v1/admin/trends/${T1}/publish`)).statusCode).toBe(200)
  })

  it("needs Kling 4 where the trend runs on it, and only its 720p and 1080p", async () => {
    seed({}, draftData({ examples: [EXAMPLE], engine: "kling-4" }))
    world.envs = [
      envRow("production", { ...CAST_SWAP_ALL, engines: ["seedance-2-5"] }),
      envRow("staging"), // predates the choice: Seedance 2.5 only
    ]
    const res = await call("POST", `/v1/admin/trends/${T1}/publish`)
    expect(res.statusCode).toBe(409)
    expect(reasonsOf(res)).toEqual([
      { code: "engine_unsupported", env: "staging", need: "kling-4" },
      { code: "engine_unsupported", env: "production", need: "kling-4" },
    ])
    expect(mem.trends[0]!.status).toBe("draft")

    // Engines that run Kling 4 publish it, with no 480p needed.
    const kling = { ...CAST_SWAP_ALL, resolutions: ["720p", "1080p"], engines: ["seedance-2-5", "kling-4"] }
    world.envs = [envRow("production", kling), envRow("staging", kling)]
    expect((await call("POST", `/v1/admin/trends/${T1}/publish`)).statusCode).toBe(200)
  })

  it("blocks a Kling 4 trend whose prompts do not fit Kling 4's cap, naming its most", async () => {
    const kling = { ...CAST_SWAP_ALL, engines: ["seedance-2-5", "kling-4"] }
    world.envs = [envRow("production", kling), envRow("staging", kling)]
    // Two long reference lines add to the engine's own text, which Kling 4's 8,000 cannot also hold.
    const references = [1, 2].map((i) => ({ images: [`https://cdn.test/r${i}.png`], line: "l".repeat(500) }))
    seed({}, draftData({ examples: [EXAMPLE], engine: "kling-4", references, prePrompt: "p".repeat(3000), trendPrompt: "t".repeat(2998) }))
    const res = await call("POST", `/v1/admin/trends/${T1}/publish`)
    expect(res.statusCode).toBe(409)
    const reasons = reasonsOf(res) as Array<{ code: string; message?: string }>
    expect(reasons.map((r) => r.code)).toEqual(["prompt_budget"])
    expect(reasons[0]!.message).toContain("on Kling 4")
    expect(mem.trends[0]!.status).toBe("draft")

    // The same prompts publish on Seedance 2.5.
    mem.trends = []
    seed({}, draftData({ examples: [EXAMPLE], references, prePrompt: "p".repeat(3000), trendPrompt: "t".repeat(2998) }))
    const seedance = await call("POST", `/v1/admin/trends/${T1}/publish`)
    expect(seedance.statusCode, JSON.stringify(seedance.json())).toBe(200)
  })

  it("publishes a 5-person Kling 4 trend (each prepared picture counts as one), and blocks one that can send more than 10", async () => {
    const kling = { ...CAST_SWAP_ALL, resolutions: ["720p", "1080p"], engines: ["seedance-2-5", "kling-4"] }
    world.envs = [envRow("production", kling), envRow("staging", kling)]
    const slots = Array.from({ length: 5 }, (_, i) => ({ key: `p${i}`, label: { en: `P${i}` }, kind: "person" as const, required: i === 0, roleName: `person ${i}` }))
    const example = { ...EXAMPLE, slots: Object.fromEntries(slots.map((s) => [s.key, [`https://cdn.test/trends/${T1}/ex1-${s.key}.png`]])) }
    const refs = (n: number) => [1, 2].map((r) => ({ images: Array.from({ length: n }, (_, i) => `https://cdn.test/r${r}-${i}.png`), line: "the sign" }))
    // 5 prepared + 2 × 2 references = 9.
    seed({}, draftData({ examples: [example], engine: "kling-4", slots, references: refs(2) }))
    expect((await call("POST", `/v1/admin/trends/${T1}/publish`)).statusCode).toBe(200)

    // 5 prepared + 2 × 3 references = 11.
    mem.trends = []
    seed({}, draftData({ examples: [example], engine: "kling-4", slots, references: refs(3) }))
    const res = await call("POST", `/v1/admin/trends/${T1}/publish`)
    expect(res.statusCode).toBe(409)
    const reasons = reasonsOf(res) as Array<{ code: string; message?: string }>
    expect(reasons.map((r) => r.code)).toEqual(["too_many_images"])
    expect(reasons[0]!.message).toContain("11 images")
  })

  it("a Seedance 2.5 trend needs nothing new of an engine that predates the choice", async () => {
    seed({}, draftData({ examples: [EXAMPLE], engine: "seedance-2-5" }))
    expect((await call("POST", `/v1/admin/trends/${T1}/publish`)).statusCode).toBe(200)
  })

  it("blocks a trend prompt that leaves no room for the user's details, and names the limit", async () => {
    const { TREND_DETAILS_MAX } = await import("../../lib/trends/prompt-budget.js")
    const most = 4000 - 2 - TREND_DETAILS_MAX
    seed({}, draftData({ examples: [EXAMPLE], trendPrompt: "t".repeat(most + 1) }))
    const res = await call("POST", `/v1/admin/trends/${T1}/publish`)
    expect(res.statusCode).toBe(409)
    const [reason, ...rest] = reasonsOf(res) as Array<{ code: string; message?: string }>
    expect(rest).toEqual([])
    expect(reason!.code).toBe("prompt_budget")
    expect(reason!.message).toContain(String(most))
    expect(mem.trends[0]!.status).toBe("draft")

    mem.trends = []
    seed({}, draftData({ examples: [EXAMPLE], trendPrompt: "t".repeat(most), prePrompt: "p".repeat(3000) }))
    expect((await call("POST", `/v1/admin/trends/${T1}/publish`)).statusCode).toBe(200)
  })

  it("needs trend pre prompts only where the trend has one", async () => {
    const { trendPrePrompt: _p, ...noPre } = CAST_SWAP_ALL
    world.envs = [envRow("production", noPre), envRow("staging", { ...CAST_SWAP_ALL, trendPrePrompt: false })]
    seed({}, draftData({ examples: [EXAMPLE], prePrompt: "Open on the stage." }))
    const res = await call("POST", `/v1/admin/trends/${T1}/publish`)
    expect(res.statusCode).toBe(409)
    expect(reasonsOf(res)).toEqual([
      { code: "engine_unsupported", env: "staging", need: "trendPrePrompt" },
      { code: "engine_unsupported", env: "production", need: "trendPrePrompt" },
    ])
    expect(mem.trends[0]!.status).toBe("draft")

    // The same engines publish a trend without a pre prompt (it needs nothing new).
    mem.trends = []
    seed({}, draftData({ examples: [EXAMPLE] }))
    expect((await call("POST", `/v1/admin/trends/${T1}/publish`)).statusCode).toBe(200)
  })

  it("publishes a trend with a pre prompt where every engine declares trendPrePrompt", async () => {
    seed({}, draftData({ examples: [EXAMPLE], prePrompt: "Open on the stage." }))
    const res = await call("POST", `/v1/admin/trends/${T1}/publish`)
    expect(res.statusCode).toBe(200)
    expect(mem.trends[0]!.status).toBe("published")
  })

  it("an example without pictures for a slot blocks publishing", async () => {
    seed({}, draftData({ examples: [{ ...EXAMPLE, slots: { lead: EXAMPLE.slots.lead } }] }))
    const res = await call("POST", `/v1/admin/trends/${T1}/publish`)
    expect(reasonsOf(res)).toEqual([{ code: "example_slots_incomplete", example: 1, slots: ["dog"] }])
  })

  it("an engine-environments read failure is a 500, never 'unknown'", async () => {
    seed({}, draftData({ examples: [EXAMPLE] }))
    db.respond = (q) => (q.table === "engine_environments" ? { data: null, error: { message: "down" } } : respond(q))
    expect((await call("POST", `/v1/admin/trends/${T1}/publish`)).statusCode).toBe(500)
    expect(mem.trends[0]!.status).toBe("draft")
  })

  it("GET /engine-environments lists the recorded environments", async () => {
    const res = await call("GET", "/v1/admin/trends/engine-environments")
    expect(res.statusCode).toBe(200)
    expect(res.json().data.map((e: { env: string }) => e.env)).toEqual(["production", "staging"])
  })
})

// ── test runs ──────────────────────────────────────────────────────────────

describe("test runs", () => {
  it("a Kling 4 draft runs with engine kling-4 at 720p, only on an engine that declares it", async () => {
    seed({}, draftData({ engine: "kling-4", examples: [EXAMPLE] }))
    const slots = { lead: { images: ["https://u.example/me.png"] } }

    // The loaded engine predates the choice (no `engines`): held back, nothing sent.
    const held = await call("POST", `/v1/admin/trends/${T1}/test-runs`, { slots })
    expect(held.statusCode).toBe(503)
    expect(held.json().error.code).toBe("engine_unsupported")
    expect(engine.calls).toHaveLength(0)

    setPluginSupports({ castSwap: { ...CAST_SWAP_ALL, engines: ["seedance-2-5", "kling-4"] } })
    expect((await call("POST", `/v1/admin/trends/${T1}/test-runs`, { slots })).statusCode).toBe(202)
    expect(engine.calls[0]!.body).toMatchObject({ engine: "kling-4", resolution: "720p", draft: false })

    const draft = await call("POST", `/v1/admin/trends/${T1}/test-runs`, { slots, draft: true })
    expect(draft.statusCode).toBe(400)
    expect(draft.json().error.code).toBe("draft_unsupported")
    expect(engine.calls).toHaveLength(1)
  })

  it("compose from the DRAFT version and run as the admin", async () => {
    const published = draftData({ trendPrompt: "PUBLISHED-PROMPT", examples: [EXAMPLE] })
    const draft = draftData({ trendPrompt: "DRAFT-PROMPT v2", name: { en: "Neon Dance II" }, examples: [EXAMPLE] })
    seed({ status: "published", publishedVersion: 1, draftVersion: 2, versions: { 1: { data: published, published: true }, 2: { data: draft, published: false } } })

    const res = await call("POST", `/v1/admin/trends/${T1}/test-runs`, { slots: { lead: { images: ["https://u.example/me.png"] } }, preview: true })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ data: { jobId: RUN } })

    expect(engine.calls).toHaveLength(1)
    const { headers, body } = engine.calls[0]!
    expect(headers["x-internal-user-id"]).toBe(ADMIN)
    // The origin rides the server-side scope, never the relayed body.
    expect(body).not.toHaveProperty("origin")
    expect(body).not.toHaveProperty("sessionId")
    expect(engine.calls[0]!.stamps).toEqual({ origin: "trends-admin", sessionId: null })
    expect(body.postPrompt).toBe("DRAFT-PROMPT v2")
    expect(body.preview).toBe(true)
    expect((body.trendRun as { display: { trend: unknown } }).display.trend).toEqual({ id: T1, slug: "neon-dance", version: 2, name: "Neon Dance II" })
  })

  it("the draft's pre prompt and masking ride at the top level; a masked preview makes the full run always", async () => {
    const MASK = { mode: "auto" as const, blurStrengthPct: 3 }
    seed({}, draftData({ prePrompt: "DRAFT-PRE", faceMasking: MASK, examples: [EXAMPLE] }))
    const PREVIEW = "00000000-0000-4000-8000-0000000000b2"
    world.jobs.set(PREVIEW, jobRow(PREVIEW, ADMIN, {
      input_data: runInput({ preview: true }),
      output_data: { videoUrl: "https://out.example/p.mp4", faceMasking: { applied: true, reason: "input_refused" } },
    }))
    const slots = { lead: { images: ["https://u.example/me.png"] } }
    expect((await call("POST", `/v1/admin/trends/${T1}/test-runs`, { slots })).statusCode).toBe(202)
    expect((await call("POST", `/v1/admin/trends/${T1}/test-runs`, { slots, previewJobId: PREVIEW })).statusCode).toBe(202)
    const [plain, followed] = engine.calls
    // The draft leaves the zone out: the plain run sends the default margins (10 % left and
    // right); the run that follows a preview stored with no zone (from before the default
    // margins) sends none, as the preview ran.
    const ZONE = { leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 }
    const NONE = { leftPct: 0, rightPct: 0, topPct: 0, bottomPct: 0 }
    expect(plain!.body).toMatchObject({ prePrompt: "DRAFT-PRE", faceMasking: { ...MASK, zone: ZONE } })
    expect(followed!.body.faceMasking).toEqual({ ...MASK, zone: NONE, mode: "always" })
    // A preview that ran with its own margins: the full run keeps them.
    const OWN = { leftPct: 5, rightPct: 7, topPct: 0, bottomPct: 2 }
    world.jobs.set(PREVIEW, jobRow(PREVIEW, ADMIN, {
      input_data: runInput({ preview: true, __faceMasking: { mode: "auto", fill: "blur", zone: OWN } }),
      output_data: { videoUrl: "https://out.example/p.mp4", faceMasking: { applied: true, reason: "input_refused" } },
    }))
    expect((await call("POST", `/v1/admin/trends/${T1}/test-runs`, { slots, previewJobId: PREVIEW })).statusCode).toBe(202)
    expect(engine.calls[2]!.body.faceMasking).toEqual({ ...MASK, fill: "blur", zone: OWN, mode: "always" })
    for (const c of engine.calls) {
      expect((c.body.trendRun as { display: Record<string, unknown> }).display).not.toHaveProperty("faceMasking")
      expect(c.body).not.toHaveProperty("previewJobId")
    }
  })

  it("reads the preview job only after the session check passes", async () => {
    seed({}, draftData({ faceMasking: { mode: "auto" }, examples: [EXAMPLE] }))
    const PREVIEW = "00000000-0000-4000-8000-0000000000b2"
    const slots = { lead: { images: ["https://u.example/me.png"] } }
    for (const sessionId of ["not-a-session", "00000000-0000-4000-8000-0000000000c3"]) {
      db.log.length = 0
      const res = await call("POST", `/v1/admin/trends/${T1}/test-runs`, { slots, previewJobId: PREVIEW, sessionId })
      expect(res.statusCode, sessionId).toBe(404)
      expect(db.log.filter((q) => q.table === "jobs"), sessionId).toEqual([])
    }
    expect(engine.calls).toEqual([])
  })

  it("sets every chip of every slot, the ones hidden from people too", async () => {
    const [lead, dog] = draftData().slots
    seed({}, draftData({
      slots: [
        { ...lead!, defaults: { body: "original" }, chips: ["hair"] } as TrendVersionData["slots"][number],
        { ...dog!, chips: [] } as TrendVersionData["slots"][number],
      ],
      examples: [EXAMPLE],
    }))
    const res = await call("POST", `/v1/admin/trends/${T1}/test-runs`, {
      slots: {
        lead: { images: ["https://u.example/me.png"], body: "new", outfit: "original" },
        dog: { images: ["https://u.example/dog.png"], coat: "original" },
      },
    })
    expect(res.statusCode).toBe(202)
    const roles = engine.calls[0]!.body.roles as Array<Record<string, unknown>>
    expect(roles[0]).toMatchObject({ body: "new", outfit: "original", hair: "new" })
    expect(roles[1]).toMatchObject({ body: "new", coat: "original" })
  })

  it("a chip of another kind is still a 400 invalid_choice naming the slot", async () => {
    seed({}, draftData({ examples: [EXAMPLE] }))
    const res = await call("POST", `/v1/admin/trends/${T1}/test-runs`, { slots: { lead: { images: ["https://u.example/me.png"], coat: "new" } } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatchObject({ code: "invalid_choice", slot: "lead" })
    expect(engine.calls).toEqual([])
  })

  it("an admin sees the real compose error", async () => {
    seed({}, draftData({ source: null }))
    const res = await call("POST", `/v1/admin/trends/${T1}/test-runs`, { slots: { lead: { images: ["https://u.example/me.png"] } } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("source_missing")
    expect(engine.calls).toEqual([])
  })

  it("lists the trend's runs by admin accounts, newest first, with ownerIsAdmin", async () => {
    seed()
    world.jobs.set(RUN, jobRow(RUN, ADMIN2))
    world.jobs.set("u-run", jobRow("u-run", USER))
    const res = await call("GET", `/v1/admin/trends/${T1}/test-runs`)
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({ jobId: RUN, status: "completed", ownerIsAdmin: true, videoUrl: "https://out.example/run.mp4" })
    expect(JSON.stringify(data)).not.toContain("__")

    const q = db.log.find((x) => x.table === "jobs" && x.ops.some((op) => op.m === "in" && op.a[0] === "user_id"))!
    expect(has(q, "in", "user_id", [ADMIN, ADMIN2])).toBe(true)
    expect(has(q, "filter", "input_data->>type", "eq", "cast-swap")).toBe(true)
    expect(has(q, "filter", "input_data->trend->>id", "eq", T1)).toBe(true)
    // A Full Quality version is listed as its own run.
    expect(q.ops.some((op) => op.a[0] === "input_data->>fullQualityOf")).toBe(false)
    expect(has(q, "order", "created_at", { ascending: false })).toBe(true)
  })

  it("a Full Quality version is its own test run, marked with its draft", async () => {
    seed()
    world.jobs.set(RUN, jobRow(RUN, ADMIN))
    const fq = jobRow("fq-run", ADMIN, { created_at: "2026-10-21T10:00:00.000000+00:00" })
    world.jobs.set("fq-run", { ...fq, input_data: { ...(fq.input_data as object), fullQualityOf: RUN, resolution: "1080p", draft: false } })
    const res = await call("GET", `/v1/admin/trends/${T1}/test-runs`)
    const data = res.json().data as Array<{ jobId: string; fullQualityOf: string | null }>
    expect(data.map((r) => [r.jobId, r.fullQualityOf])).toEqual([["fq-run", RUN], [RUN, null]])
  })

  it("lists only a draft's newest Full Quality try; older tries do not use up the list's 50", async () => {
    seed()
    const at = (n: number) => `2026-10-21T${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}:00.000000+00:00`
    const fqTry = (n: number, status: string) => {
      const r = jobRow(`fq-${String(n).padStart(3, "0")}`, ADMIN, { status, created_at: at(n) })
      return { ...r, input_data: { ...(r.input_data as object), fullQualityOf: RUN, resolution: "1080p", draft: false } }
    }
    world.jobs.set(RUN, jobRow(RUN, ADMIN))
    // 60 superseded tries (failed, cancelled), then the newest one, still running.
    for (let n = 1; n <= 60; n++) world.jobs.set(`fq-${String(n).padStart(3, "0")}`, fqTry(n, n % 2 ? "failed" : "cancelled"))
    world.jobs.set("fq-061", fqTry(61, "processing"))
    world.jobs.set("other", jobRow("other", ADMIN2, { created_at: "2026-10-19T10:00:00.000000+00:00" }))
    const res = await call("GET", `/v1/admin/trends/${T1}/test-runs`)
    expect(res.statusCode).toBe(200)
    const data = res.json().data as Array<{ jobId: string; status: string; fullQuality: unknown }>
    expect(data.map((r) => [r.jobId, r.status])).toEqual([["fq-061", "processing"], [RUN, "completed"], ["other", "completed"]])
    expect(data[1]!.fullQuality).toEqual({ jobId: "fq-061", status: "processing" })
  })

  it("an admin sees a failed test run's real failure text (the public run list does not)", async () => {
    seed()
    world.jobs.set(RUN, jobRow(RUN, ADMIN, {
      status: "failed", output_data: null, completed_at: null,
      error_message: "Seedance refused the clip.", error_hint: { kind: "safety-block" },
    }))
    const res = await call("GET", `/v1/admin/trends/${T1}/test-runs`)
    expect(res.json().data[0].error).toEqual({ code: "safety-block", message: "Seedance refused the clip." })
  })

  it("Show prompt returns the Seedance child's prompt", async () => {
    world.jobs.set(RUN, jobRow(RUN, ADMIN))
    world.jobs.set(CHILD, { id: CHILD, input_data: { prompt: "ENGINE PROMPT: the woman on the left dances" } })
    const res = await call("GET", `/v1/admin/trends/test-runs/${RUN}/prompt`)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { prompt: "ENGINE PROMPT: the woman on the left dances" } })
  })

  it("Show prompt is a 404 for a run with no child yet, or a job that is not a trend run", async () => {
    world.jobs.set(RUN, jobRow(RUN, ADMIN, { output_data: { videoUrl: null } }))
    expect((await call("GET", `/v1/admin/trends/test-runs/${RUN}/prompt`)).json().error.code).toBe("prompt_unavailable")
    world.jobs.set(RUN, jobRow(RUN, ADMIN, { input_data: { type: "cast-swap" } }))
    expect((await call("GET", `/v1/admin/trends/test-runs/${RUN}/prompt`)).statusCode).toBe(404)
  })
})

// ── tag labels ─────────────────────────────────────────────────────────────

describe("tag labels", () => {
  it("lists every tag in use (any status) and every labelled one, with counts and labels, by tag", async () => {
    seed({ status: "published", tags: ["dance", "duo"] })
    mem.trends.push({ ...mem.trends[0]!, id: "00000000-0000-4000-8000-0000000000a2", slug: "wip", status: "draft", tags: ["dance", "wip"] })
    world.tagLabels!.set("dance", { en: "Dance", he: "ריקוד" })
    world.tagLabels!.set("retired", { en: "Retired" })
    const res = await call("GET", "/v1/admin/trends/tags")
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([
      { tag: "dance", labels: { en: "Dance", he: "ריקוד" }, trends: 2, published: 1 },
      { tag: "duo", labels: {}, trends: 1, published: 1 },
      { tag: "retired", labels: { en: "Retired" }, trends: 0, published: 0 },
      { tag: "wip", labels: {}, trends: 1, published: 0 },
    ])
  })

  it("saves a tag's labels (trimmed, empty ones dropped), and the public tag list shows them", async () => {
    seed({ status: "published", publishedVersion: 1, tags: ["dance"] })
    const saved = await call("PUT", "/v1/admin/trends/tags", { tag: " dance ", labels: { en: "Dance ", he: "ריקוד", ja: "" } })
    expect(saved.statusCode).toBe(200)
    expect(saved.json().data).toEqual({ tag: "dance", labels: { en: "Dance", he: "ריקוד" } })
    expect(world.tagLabels!.get("dance")).toEqual({ en: "Dance", he: "ריקוד" })

    const pub = await call("GET", "/v1/trends/tags?locale=he")
    expect(pub.json().data).toEqual([{ tag: "dance", label: "ריקוד", count: 1 }])
  })

  it("no label left removes the tag's labels (it reads as itself again)", async () => {
    world.tagLabels!.set("dance", { en: "Dance" })
    const res = await call("PUT", "/v1/admin/trends/tags", { tag: "dance", labels: { en: " " } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ tag: "dance", labels: {} })
    expect(world.tagLabels!.has("dance")).toBe(false)
  })

  it("refuses a tag outside 1–100 characters, an unknown language and a label over 100 characters", async () => {
    for (const body of [
      { tag: "", labels: { en: "x" } },
      { tag: "x".repeat(101), labels: { en: "x" } },
      { tag: "dance", labels: { xx: "x" } },
      { tag: "dance", labels: { en: "x".repeat(101) } },
      { tag: "dance" },
    ]) {
      const res = await call("PUT", "/v1/admin/trends/tags", body)
      expect(res.statusCode, JSON.stringify(body)).toBe(400)
    }
    expect(world.tagLabels!.size).toBe(0)
  })

  it("refuses a tag with a character outside letters, digits, spaces, - and _ (a 400 that says so)", async () => {
    for (const tag of ['say "hi"', "it's", "a,b", "(x)", "back\\slash"]) {
      const res = await call("PUT", "/v1/admin/trends/tags", { tag, labels: { en: "x" } })
      expect(res.statusCode, tag).toBe(400)
      expect(res.json().error).toMatchObject({ code: "validation_error", message: "tag: A tag is letters, digits, spaces, - and _ only." })
    }
    expect(world.tagLabels!.size).toBe(0)
    expect((await call("PUT", "/v1/admin/trends/tags", { tag: "ריקוד_2", labels: { en: "Dance 2" } })).statusCode).toBe(200)
  })

  it("a database without the labels table: the list shows no labels, a save is 503 not_available", async () => {
    seed({ tags: ["dance"] })
    world.tagLabels = null
    const list = await call("GET", "/v1/admin/trends/tags")
    expect(list.statusCode).toBe(200)
    expect(list.json().data).toEqual([{ tag: "dance", labels: {}, trends: 1, published: 0 }])
    const save = await call("PUT", "/v1/admin/trends/tags", { tag: "dance", labels: { en: "Dance" } })
    expect(save.statusCode).toBe(503)
    expect(save.json().error.code).toBe("not_available")
  })
})

// ── access ─────────────────────────────────────────────────────────────────

describe("access", () => {
  const ROUTES: Array<["GET" | "POST" | "PUT" | "PATCH" | "DELETE", string, unknown?]> = [
    ["GET", "/v1/admin/trends"],
    ["POST", "/v1/admin/trends", { slug: "x", name: { en: "X" } }],
    ["GET", "/v1/admin/trends/engine-environments"],
    ["GET", "/v1/admin/trends/tags"],
    ["PUT", "/v1/admin/trends/tags", { tag: "dance", labels: { en: "Dance" } }],
    ["GET", `/v1/admin/trends/test-runs/${RUN}/prompt`],
    ["GET", `/v1/admin/trends/${T1}`],
    ["PATCH", `/v1/admin/trends/${T1}`, { sortOrder: 1 }],
    ["PUT", `/v1/admin/trends/${T1}/draft`, { data: draftData() }],
    ["POST", `/v1/admin/trends/${T1}/media`, { url: "https://u.example/clip.mp4", kind: "source" }],
    ["POST", `/v1/admin/trends/${T1}/test-runs`, { slots: { lead: { images: ["https://u.example/me.png"] } } }],
    ["GET", `/v1/admin/trends/${T1}/test-runs`],
    ["POST", `/v1/admin/trends/${T1}/examples`, { jobId: RUN }],
    ["PUT", `/v1/admin/trends/${T1}/examples/order`, { order: [] }],
    ["DELETE", `/v1/admin/trends/${T1}/examples/0`],
    ["POST", `/v1/admin/trends/${T1}/publish`],
    ["POST", `/v1/admin/trends/${T1}/unpublish`],
  ]

  it("every route is 401 without a user and 403 for a non-admin, and does nothing", async () => {
    seed()
    world.jobs.set(RUN, jobRow(RUN, ADMIN))
    for (const [method, url, payload] of ROUTES) {
      const anon = await app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}) })
      expect(anon.statusCode, `${method} ${url} anon`).toBe(401)
      const user = await call(method, url, payload, USER)
      expect(user.statusCode, `${method} ${url} user`).toBe(403)
    }
    expect(engine.calls).toEqual([])
    expect(mem.uploads).toEqual([])
    expect(mem.trends).toHaveLength(1)
    expect(mem.trends[0]!.versions[1]!.data).toEqual(draftData())
    expect(world.tagLabels!.size).toBe(0)
  })
})
