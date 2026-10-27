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
 *  - "Show prompt" returns the Seedance child's prompt, and the trend's prompt
 *    parts for a Full or a 4 s preview run (each preview part falling back to
 *    the full run's);
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
import type { TrendFaceMask, TrendRow, TrendVersionData } from "../../lib/trends/types.js"

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
  /** Every ffmpeg run's arguments: the source's display copy, and the preview input clip's cuts (`-ss` before `-i`). */
  ffmpegRuns: [] as string[][],
  /** When set, the next ffmpeg run fails with it. */
  ffmpegFails: null as null | Error,
  /** The frame count a cut reads, by its output path (the preview clip's `clip.mp4`, its mask's `mask-clip.mp4`): one number for both when a number. */
  frames: 150 as number | ((path: string) => number),
  /** When set, the next ffprobe of a video fails with it. */
  probeFails: null as null | Error,
  /** When set, the frame rate every ffprobe of a video reads. */
  fps: undefined as number | undefined,
  /** Every `req.log.warn` the routes write: [object, message]. */
  warns: [] as unknown[][],
  /** The store fails as on a database without migration 549's tables. */
  missingTables: false,
  /** This many draft saves lose to a concurrent write (DraftConflictError), as if someone always saved first. */
  conflictSaves: 0,
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
      if (mem.conflictSaves > 0) {
        mem.conflictSaves -= 1
        throw new actual.DraftConflictError(id)
      }
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
    archive: async (id: string) => {
      const t = find(id)
      if (t.status !== "archived") t.status = "archived"
      touch(t)
    },
    restore: async (id: string) => {
      const t = find(id)
      if (t.status === "archived") t.status = t.publishedVersion != null ? "unpublished" : "draft"
      touch(t)
    },
    favoriteIds: async () => new Set<string>(),
  }
})

// The run delete itself (its order, its fences) is pinned in
// lib/trends/__tests__/run-delete.test.ts; here only what the route asks of it.
const runDelete = vi.hoisted(() => ({
  calls: [] as Array<{ runId: string; ownerId: string; actorUserId: string }>,
  inFlight: false,
}))
vi.mock("../../lib/trends/run-delete.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/trends/run-delete.js")>()
  return {
    ...actual,
    deleteTrendTestRun: async (args: { runId: string; ownerId: string; actorUserId: string }) => {
      if (runDelete.inFlight) throw new actual.TrendRunInFlightError(args.runId)
      runDelete.calls.push({ runId: args.runId, ownerId: args.ownerId, actorUserId: args.actorUserId })
      return { deleted: true, libraryRows: 1, filesDeleted: 2, filesKept: 0 }
    },
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
    uploadBufferToR2: async (_buffer: Buffer, key: string, contentType: string) => {
      mem.uploads.push({ key, contentType })
      return `https://cdn.test/${key}`
    },
  }
})

vi.mock("../../../utils/thumbnail.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../utils/thumbnail.js")>()
  return { ...actual, thumbnailFromLocalVideo: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }
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
    // The display copy's re-encode: writes a stand-in file where ffmpeg would.
    runFfmpeg: async (args: readonly string[]) => {
      mem.ffmpegRuns.push([...args])
      const fail = mem.ffmpegFails
      mem.ffmpegFails = null
      if (fail) throw fail
      await writeFile(args.at(-1)!, MP4)
      return ""
    },
    probeVideoSource: async (path: string) => {
      const fail = mem.probeFails
      mem.probeFails = null
      if (fail) throw fail
      return probed(path)
    },
    // The preview clip's (and its mask's) frame count: the stand-in file has none to read.
    probeVideoFrameCount: async (path: string) => (typeof mem.frames === "number" ? mem.frames : mem.frames(path)),
  }
})

/** What the stubbed ffprobe reads: 720×1280, the length set for the downloaded URL (else 12 s). */
function probed(path: string) {
  return { width: 720, height: 1280, durationSeconds: mem.durations.get(mem.downloads.get(path) ?? "") ?? 12, ...(mem.fps ? { fps: mem.fps } : {}) }
}

import { adminTrendsRoutes } from "../admin-trends.js"
import { trendRoutes } from "../trends.js"
import { resolveRequestOrigin } from "../../../lib/client-origin-scope.js"
import { resolveRequestSession } from "../../../lib/generation-session-scope.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../lib/private-plugins/supports-registry.js"
import { withResolvedZone } from "../../../lib/cast-swap-face-masking.js"
import { faceMaskBaseKey, faceMaskSettingsKey } from "../../lib/trends/face-mask.js"
import { VIDEO_MASK_RECIPE } from "@nodaro/shared/media"

// ── fixtures ───────────────────────────────────────────────────────────────

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const ADMIN2 = "00000000-0000-4000-8000-0000000000ae"
const USER = "00000000-0000-4000-8000-000000000001"
const SECRET = "0".repeat(64) // src/test/setup.ts
const T1 = "00000000-0000-4000-8000-0000000000a1"
const RUN = "00000000-0000-4000-8000-0000000000b1"
const CHILD = "00000000-0000-4000-8000-0000000000c1"
const FACE_MASK_JOB = "00000000-0000-4000-8000-0000000000f1"

const CAST_SWAP_ALL = {
  roleKinds: ["person", "location", "product", "pet"] as Array<"person" | "location" | "product" | "pet">,
  fixedReferences: true,
  fullQuality: true,
  resolutions: ["480p", "720p", "1080p"] as Array<"480p" | "720p" | "1080p">,
  trendRun: true,
  faceMasking: true,
  trendPrePrompt: true,
}

/** The source's browser-safe copy, as the source upload makes it. */
const DISPLAY = {
  videoUrl: `https://cdn.test/trends/${T1}/display.mp4`,
  posterUrl: `https://cdn.test/trends/${T1}/display.png`,
  width: 720,
  height: 1280,
  durationSec: 12,
}

function draftData(over: Partial<TrendVersionData> = {}): TrendVersionData {
  return {
    name: { en: "Neon Dance" },
    source: { videoUrl: `https://cdn.test/trends/${T1}/src.mp4`, durationSec: 12, width: 720, height: 1280, display: DISPLAY },
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
  /** Called once while the face mask route answers: a hook for "meanwhile, someone else wrote". */
  onFaceMask: null as null | (() => void),
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

/** `admin_actions`: a read answers the rows this test's own inserts wrote, filtered as asked. */
function respondAdminActions(q: RecordedQuery): QueryResult {
  if (q.ops.some((op) => op.m === "insert")) return { data: null, error: null }
  const rows = db.log
    .filter((r) => r.table === "admin_actions")
    .flatMap((r) => r.ops.filter((op) => op.m === "insert").map((op) => op.a[0] as Record<string, unknown>))
  const matches = rows.filter((row) =>
    q.ops.every((op) => {
      if (op.m === "eq") return row[op.a[0] as string] === op.a[1]
      if (op.m === "filter" && op.a[0] === "payload->>jobId") return (row.payload as { jobId?: unknown })?.jobId === op.a[2]
      return true
    }),
  )
  return { data: matches.map((row) => ({ payload: row.payload })), error: null }
}

function respond(q: RecordedQuery): QueryResult {
  if (q.table === "trend_tags") return respondTrendTags(q)
  if (q.table === "admin_actions") return respondAdminActions(q)
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
  mem.ffmpegRuns = []
  mem.ffmpegFails = null
  mem.frames = 150
  mem.probeFails = null
  mem.warns = []
  mem.missingTables = false
  mem.conflictSaves = 0
  world.jobs = new Map()
  world.tagLabels = new Map()
  world.envs = [envRow("production"), envRow("staging")]
  engine.calls = []
  engine.onFaceMask = null
  runDelete.calls = []
  runDelete.inFlight = false
  _resetPluginSupportsForTests()
  setPluginSupports({ castSwap: { ...CAST_SWAP_ALL, roleKinds: [...CAST_SWAP_ALL.roleKinds], resolutions: [...CAST_SWAP_ALL.resolutions] } })

  app = Fastify({ logger: false })
  app.addHook("onRequest", async (req) => {
    req.log = Object.assign(Object.create(req.log), { warn: (...a: unknown[]) => void mem.warns.push(a) })
  })
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
  // The plugin's face mask route: internal only, as the plugin answers it.
  app.post("/v1/cast-swap/face-mask", async (req, reply) => {
    if (req.authKind !== "internal") return reply.status(403).send({ error: { code: "forbidden", message: "Internal only" } })
    engine.calls.push({ url: "/v1/cast-swap/face-mask", headers: { ...req.headers }, body: req.body as Record<string, unknown> })
    const hook = engine.onFaceMask
    engine.onFaceMask = null
    hook?.()
    return reply.status(202).send({ data: { jobId: FACE_MASK_JOB } })
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
    expect(codes).toEqual(expect.arrayContaining(["source_missing", "no_required_slot"]))
    // A trend may publish with no example (S10): only its original.
    expect(codes).not.toContain("no_example")
    // No source at all is `source_missing` alone, never also "its display copy is missing".
    expect(codes).not.toContain("source_display_missing")
    expect(mem.trends[0]!.status).toBe("draft")
  })

  it("a draft with a source and its display copy but no example publishes (S10)", async () => {
    seed()
    const res = await call("POST", `/v1/admin/trends/${T1}/publish`)
    expect(res.statusCode, JSON.stringify(res.json())).toBe(200)
    expect(mem.trends[0]!.status).toBe("published")
  })

  it("a source with no display copy is a source_display_missing blocker, and nothing is published", async () => {
    const { display: _d, ...bare } = draftData().source!
    seed({}, draftData({ source: bare, examples: [EXAMPLE] }))
    const res = await call("POST", `/v1/admin/trends/${T1}/publish`)
    expect(res.statusCode).toBe(409)
    expect(reasonsOf(res)).toEqual([{ code: "source_display_missing" }])
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
    // With the draft's face mask state after the save (none: it does not mask).
    expect(saved.json().data).toEqual({ version: 1, revision: expect.any(String), faceMaskState: { status: "none", reasons: [] } })
    expect(mem.trends[0]!.versions[1]!.data.examples).toEqual([])
    expect(mem.trends[0]!.versions[1]!.data.trendPrompt).toBe("DRAFT-PROMPT neon lights")

    // The 4 s preview's prompt parts are saved and read back as written, and kept when the preview is turned off.
    const withPreview = {
      ...draftData(),
      previewStart: null,
      previewPrePrompt: "PREVIEW-PRE",
      previewTrendPrompt: "PREVIEW-PROMPT",
      slots: [{ ...draftData().slots[0]!, previewRoleName: "the woman" }, draftData().slots[1]!],
      references: [{ images: [`https://cdn.test/trends/${id}/r.png`], line: "the sign", previewLine: "a sign" }],
    }
    expect((await call("PUT", `/v1/admin/trends/${id}/draft`, { data: withPreview, revision: await revisionOf(id) })).statusCode).toBe(200)
    expect(((await call("GET", `/v1/admin/trends/${id}`)).json().data as { draft: TrendVersionData }).draft).toMatchObject({
      previewStart: null,
      previewPrePrompt: "PREVIEW-PRE",
      previewTrendPrompt: "PREVIEW-PROMPT",
      slots: [{ previewRoleName: "the woman" }, { roleName: "the dog" }],
      references: [{ line: "the sign", previewLine: "a sign" }],
    })
    const tooLong = { ...withPreview, slots: [{ ...withPreview.slots[0]!, previewRoleName: "r".repeat(201) }, withPreview.slots[1]!] }
    expect((await call("PUT", `/v1/admin/trends/${id}/draft`, { data: tooLong, revision: await revisionOf(id) })).statusCode).toBe(400)

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
    expect(edit.json().data).toEqual({ version: 2, revision: expect.any(String), faceMaskState: { status: "none", reasons: [] } })
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

  it("a save naming the SAME clip without its display copy keeps the stored one (an older tab, a builder before the field)", async () => {
    seed()
    const { display: _d, ...bare } = draftData().source!
    const res = await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: { ...draftData(), source: bare, name: { en: "Renamed" } }, revision: await revisionOf() })
    expect(res.statusCode).toBe(200)
    expect(mem.trends[0]!.versions[1]!.data.source).toEqual({ ...bare, display: DISPLAY })
    expect(mem.trends[0]!.versions[1]!.data.name.en).toBe("Renamed")
    // ...so it still publishes.
    expect((await call("POST", `/v1/admin/trends/${T1}/publish`)).statusCode).toBe(200)
  })

  it("a save naming ANOTHER clip never keeps the old clip's display copy", async () => {
    seed()
    const source = { videoUrl: `https://cdn.test/trends/${T1}/other.mp4`, durationSec: 10, width: 720, height: 1280 }
    const res = await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: { ...draftData(), source }, revision: await revisionOf() })
    expect(res.statusCode).toBe(200)
    expect(mem.trends[0]!.versions[1]!.data.source).toEqual(source)
    expect(reasonsOf(await call("POST", `/v1/admin/trends/${T1}/publish`))).toEqual([{ code: "source_display_missing" }])
  })

  it("a save whose slot leaves out its hint picture removes it (that is how the builder removes one: never carried over)", async () => {
    const [lead, dog] = draftData().slots
    seed({}, draftData({ slots: [{ ...lead!, hintImageUrl: `https://cdn.test/trends/${T1}/hint.png` }, dog!] }))
    const res = await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: { ...draftData(), slots: [lead!, dog!] }, revision: await revisionOf() })
    expect(res.statusCode).toBe(200)
    expect(mem.trends[0]!.versions[1]!.data.slots[0]).not.toHaveProperty("hintImageUrl")
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

describe("the admin list's cover", () => {
  it("is the original's display poster when the draft has no example yet, and absent with neither", async () => {
    seed({}, draftData({ examples: [] }))
    expect((await call("GET", "/v1/admin/trends")).json().data[0].coverUrl).toBe(DISPLAY.posterUrl)
    mem.trends.length = 0
    seed({}, draftData({ examples: [], source: { videoUrl: `https://cdn.test/trends/${T1}/source.mp4`, durationSec: 12 } }))
    expect((await call("GET", "/v1/admin/trends")).json().data[0]).not.toHaveProperty("coverUrl")
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

  it("a source clip also gets its display copy and poster: NEW files under the trend's key, never the upload (S7)", async () => {
    seed()
    const res = await call("POST", `/v1/admin/trends/${T1}/media`, { url: "https://u.example/clip.mp4", kind: "source" })
    expect(res.statusCode).toBe(200)
    const { url, display } = res.json().data
    const key = (ext: string) => new RegExp(`^https://cdn\\.test/trends/${T1}/[0-9a-f-]{36}\\.${ext}$`)
    expect(display).toEqual({
      videoUrl: expect.stringMatching(key("mp4")),
      posterUrl: expect.stringMatching(key("png")),
      width: 720,
      height: 1280,
      durationSec: 12,
    })
    expect(display.videoUrl).not.toBe(url)
    // One re-encode with the browser-safe args (pinned in lib/trends/__tests__/media.test.ts).
    expect(mem.ffmpegRuns).toHaveLength(1)
    expect(mem.ffmpegRuns[0]!.join(" ")).toContain("-c:v libx264")
    expect(mem.uploads.map((u) => u.contentType).sort()).toEqual(["image/png", "video/mp4", "video/mp4"])
  })

  it("a clip ffmpeg cannot re-encode is a 400 media_unreadable, its cause logged, and nothing is stored", async () => {
    seed()
    const cause = Object.assign(new Error("ffmpeg failed: moov atom not found"), { killed: false, timedOut: false })
    mem.ffmpegFails = cause
    const res = await call("POST", `/v1/admin/trends/${T1}/media`, { url: "https://u.example/clip.mp4", kind: "source" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("media_unreadable")
    expect(mem.uploads).toEqual([])
    expect(mem.warns).toContainEqual([expect.objectContaining({ err: cause, trendId: T1 }), expect.any(String)])
  })

  it("an ffmpeg the platform killed (its time budget, the slot's backstop) is a 503 media_busy, never media_unreadable", async () => {
    seed()
    for (const flags of [{ killed: true, timedOut: true }, { killed: true, timedOut: false }]) {
      mem.ffmpegFails = Object.assign(new Error("ffmpeg held its ffmpeg slot past 635 s; the slot was released"), flags)
      const res = await call("POST", `/v1/admin/trends/${T1}/media`, { url: "https://u.example/clip.mp4", kind: "source" })
      expect(res.statusCode, JSON.stringify(flags)).toBe(503)
      expect(res.json().error.code).toBe("media_busy")
    }
    expect(mem.uploads).toEqual([])
  })

  it("a source clip out of range makes no display copy either", async () => {
    seed()
    mem.durations.set("https://u.example/short.mp4", 3)
    expect((await call("POST", `/v1/admin/trends/${T1}/media`, { url: "https://u.example/short.mp4", kind: "source" })).statusCode).toBe(400)
    expect(mem.ffmpegRuns).toEqual([])
  })

  it("a slot's hint picture is stored like a reference: a picture, named by its bytes, with no display copy", async () => {
    seed()
    const ok = await call("POST", `/v1/admin/trends/${T1}/media`, { url: "https://u.example/hint.png", kind: "hint" })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().data.url).toMatch(new RegExp(`^https://cdn\\.test/trends/${T1}/[0-9a-f-]{36}\\.png$`))
    expect(ok.json().data).not.toHaveProperty("display")
    expect(mem.uploads).toEqual([{ key: expect.stringMatching(/\.png$/), contentType: "image/png" }])
    const video = await call("POST", `/v1/admin/trends/${T1}/media`, { url: "https://u.example/clip.mp4", kind: "hint" })
    expect(video.json().error.code).toBe("unsupported_media")
    expect(mem.ffmpegRuns).toEqual([])
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
    // An example's video is copied as it is: only the source gets a display copy.
    expect(mem.ffmpegRuns).toEqual([])
  })

  it("an ffprobe the platform killed while copying the run's video is a 503 media_busy, not media_unreadable", async () => {
    seed()
    world.jobs.set(RUN, jobRow(RUN, ADMIN2))
    mem.probeFails = Object.assign(new Error("ffprobe timed out"), { killed: true, timedOut: true })
    const res = await call("POST", `/v1/admin/trends/${T1}/examples`, { jobId: RUN })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("media_busy")
    expect(mem.trends[0]!.versions[1]!.data.examples).toEqual([])
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
      { code: "face_mask_missing", message: expect.any(String) },
      { code: "engine_unsupported", env: "staging", need: "faceMasking" },
      { code: "engine_unsupported", env: "staging", need: "storedFaceMask" },
      { code: "engine_unsupported", env: "production", need: "faceMasking" },
      { code: "engine_unsupported", env: "production", need: "storedFaceMask" },
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

  it("a preview test run edits the draft's prepared preview input clip where the engine takes one, and the source as today elsewhere", async () => {
    const CLIP = {
      videoUrl: `https://cdn.test/trends/${T1}/preview.mp4`,
      durationSec: 5,
      width: 720,
      height: 1280,
      frames: 150,
      sha256: "b".repeat(64),
      sourceVideoUrl: `https://cdn.test/trends/${T1}/src.mp4`,
      startSec: 2,
      recipe: "1",
      madeAt: "2026-10-27T10:00:00.000Z",
    }
    seed({}, draftData({ previewClip: CLIP, examples: [EXAMPLE] }))
    const slots = { lead: { images: ["https://u.example/me.png"] } }

    // Today's engine: the whole source from previewStart, and neither new field.
    expect((await call("POST", `/v1/admin/trends/${T1}/test-runs`, { slots, preview: true })).statusCode).toBe(202)
    expect(engine.calls[0]!.body).toMatchObject({ videoUrl: `https://cdn.test/trends/${T1}/src.mp4`, previewStart: 2, preview: true })
    expect(engine.calls[0]!.body).not.toHaveProperty("preparedPreview")
    expect(engine.calls[0]!.body).not.toHaveProperty("sourceAsset")

    setPluginSupports({ castSwap: { ...CAST_SWAP_ALL, preparedPreview: true } })
    expect((await call("POST", `/v1/admin/trends/${T1}/test-runs`, { slots, preview: true })).statusCode).toBe(202)
    expect(engine.calls[1]!.body).toMatchObject({
      videoUrl: CLIP.videoUrl,
      previewStart: 0,
      preview: true,
      preparedPreview: true,
      sourceAsset: { kind: "preview", sha256: CLIP.sha256, startSec: 2, durationSec: 5, recipe: "1" },
    })
    // A full test run on that engine edits the source and says so.
    expect((await call("POST", `/v1/admin/trends/${T1}/test-runs`, { slots })).statusCode).toBe(202)
    expect(engine.calls[2]!.body).toMatchObject({ videoUrl: `https://cdn.test/trends/${T1}/src.mp4`, previewStart: 2, preview: false, sourceAsset: { kind: "full", durationSec: 12 } })
    expect(engine.calls[2]!.body).not.toHaveProperty("preparedPreview")
  })

  it("a 4 s preview test runs the draft's preview prompt parts; a full test run the full run's", async () => {
    seed({}, draftData({
      slots: [
        { key: "lead", label: { en: "Lead dancer" }, kind: "person", required: true, roleName: "the woman on the left", previewRoleName: "PREVIEW the woman" },
        { key: "dog", label: { en: "Dog" }, kind: "pet", required: false, roleName: "the dog" },
      ],
      prePrompt: "DRAFT-PRE",
      previewPrePrompt: "PREVIEW-PRE",
      previewTrendPrompt: "PREVIEW-PROMPT",
      examples: [EXAMPLE],
    }))
    const slots = { lead: { images: ["https://u.example/me.png"] } }
    expect((await call("POST", `/v1/admin/trends/${T1}/test-runs`, { slots, preview: true })).statusCode).toBe(202)
    expect((await call("POST", `/v1/admin/trends/${T1}/test-runs`, { slots })).statusCode).toBe(202)
    const [preview, full] = engine.calls.map((c) => c.body as { roles: Array<{ name: string }>; prePrompt?: string; postPrompt?: string })
    expect(preview!.roles.map((r) => r.name)).toEqual(["PREVIEW the woman", "the dog"])
    expect([preview!.prePrompt, preview!.postPrompt]).toEqual(["PREVIEW-PRE", "PREVIEW-PROMPT"])
    expect(full!.roles.map((r) => r.name)).toEqual(["the woman on the left", "the dog"])
    expect([full!.prePrompt, full!.postPrompt]).toEqual(["DRAFT-PRE", "DRAFT-PROMPT neon lights"])
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
    // A child job (a run's step) is never listed as a run of its own.
    expect(has(q, "is", "parent_job_id", null)).toBe(true)
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

  /** A draft that words its 4 s preview's prompt parts its own way. */
  const previewDraft = () =>
    draftData({
      slots: [
        { key: "lead", label: { en: "Lead dancer" }, kind: "person", required: true, roleName: "the woman on the left", previewRoleName: "the woman" },
        { key: "dog", label: { en: "Dog" }, kind: "pet", required: false, roleName: "the dog" },
      ],
      references: [{ images: ["https://cdn.test/r.png"], line: "the neon sign", previewLine: "the sign" }],
      prePrompt: "FULL-PRE",
      previewTrendPrompt: "PREVIEW-PROMPT neon",
    })

  it("Show prompt returns the Seedance child's prompt and the full run's prompt parts", async () => {
    seed({}, previewDraft())
    world.jobs.set(RUN, jobRow(RUN, ADMIN))
    world.jobs.set(CHILD, { id: CHILD, input_data: { prompt: "ENGINE PROMPT: the woman on the left dances" } })
    const res = await call("GET", `/v1/admin/trends/test-runs/${RUN}/prompt`)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      data: {
        mode: "full",
        runMode: "full",
        prompt: "ENGINE PROMPT: the woman on the left dances",
        previewOffered: true,
        parts: {
          mode: "full",
          prePrompt: { text: "FULL-PRE", fromFullRun: false },
          roles: [
            { key: "lead", label: "Lead dancer", kind: "person", roleName: { text: "the woman on the left", fromFullRun: false } },
            { key: "dog", label: "Dog", kind: "pet", roleName: { text: "the dog", fromFullRun: false } },
          ],
          references: [{ line: { text: "the neon sign", fromFullRun: false } }],
          trendPrompt: { text: "DRAFT-PROMPT neon lights", fromFullRun: false },
        },
      },
    })
  })

  it("Show prompt switched to the 4 s preview: the preview's parts, and no engine prompt for a full run", async () => {
    seed({}, previewDraft())
    world.jobs.set(RUN, jobRow(RUN, ADMIN))
    world.jobs.set(CHILD, { id: CHILD, input_data: { prompt: "ENGINE PROMPT full" } })
    const res = await call("GET", `/v1/admin/trends/test-runs/${RUN}/prompt?mode=preview`)
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data).toMatchObject({ mode: "preview", runMode: "full", prompt: null, previewOffered: true })
    expect(data.parts.prePrompt).toEqual({ text: "FULL-PRE", fromFullRun: true })
    expect(data.parts.roles.map((r: { roleName: unknown }) => r.roleName)).toEqual([
      { text: "the woman", fromFullRun: false },
      { text: "the dog", fromFullRun: true },
    ])
    expect(data.parts.references).toEqual([{ line: { text: "the sign", fromFullRun: false } }])
    expect(data.parts.trendPrompt).toEqual({ text: "PREVIEW-PROMPT neon", fromFullRun: false })
  })

  it("Show prompt of a preview run opens on the preview, with its engine prompt; switched to Full, the full run's parts", async () => {
    seed({}, previewDraft())
    world.jobs.set(RUN, jobRow(RUN, ADMIN, { input_data: runInput({ preview: true }) }))
    world.jobs.set(CHILD, { id: CHILD, input_data: { prompt: "ENGINE PROMPT preview" } })
    const own = (await call("GET", `/v1/admin/trends/test-runs/${RUN}/prompt`)).json().data
    expect(own).toMatchObject({ mode: "preview", runMode: "preview", prompt: "ENGINE PROMPT preview" })
    expect(own.parts.trendPrompt).toEqual({ text: "PREVIEW-PROMPT neon", fromFullRun: false })
    const full = (await call("GET", `/v1/admin/trends/test-runs/${RUN}/prompt?mode=full`)).json().data
    expect(full).toMatchObject({ mode: "full", runMode: "preview", prompt: null })
    expect(full.parts.trendPrompt).toEqual({ text: "DRAFT-PROMPT neon lights", fromFullRun: false })
    expect(full.parts.roles[0].roleName).toEqual({ text: "the woman on the left", fromFullRun: false })
  })

  it("Show prompt says when the trend offers no preview, and has no parts when the run's version is gone", async () => {
    seed({}, draftData({ previewStart: null }))
    world.jobs.set(RUN, jobRow(RUN, ADMIN))
    world.jobs.set(CHILD, { id: CHILD, input_data: { prompt: "P" } })
    expect((await call("GET", `/v1/admin/trends/test-runs/${RUN}/prompt`)).json().data).toMatchObject({ previewOffered: false, prompt: "P" })
    world.jobs.set(RUN, jobRow(RUN, ADMIN, { input_data: runInput({ trend: { id: T1, slug: "neon-dance", version: 9, name: "Neon Dance" } }) }))
    expect((await call("GET", `/v1/admin/trends/test-runs/${RUN}/prompt`)).json().data).toMatchObject({ prompt: "P", parts: null, previewOffered: false })
  })

  it("Show prompt has no engine prompt for a run with no child yet; a job that is not a trend run is a 404; a bad mode a 400", async () => {
    seed()
    world.jobs.set(RUN, jobRow(RUN, ADMIN, { output_data: { videoUrl: null } }))
    const res = await call("GET", `/v1/admin/trends/test-runs/${RUN}/prompt`)
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ mode: "full", runMode: "full", prompt: null })
    expect(res.json().data.parts.trendPrompt).toEqual({ text: "DRAFT-PROMPT neon lights", fromFullRun: false })
    expect((await call("GET", `/v1/admin/trends/test-runs/${RUN}/prompt?mode=both`)).statusCode).toBe(400)
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

// ── the preview's input clip ───────────────────────────────────────────────

describe("the preview's input clip (prepared on save and publish)", () => {
  const CLIP_RE = new RegExp(`^https://cdn\\.test/trends/${T1}/[0-9a-f-]{36}\\.mp4$`)
  const draftNow = () => mem.trends[0]!.versions[mem.trends[0]!.draftVersion]!.data
  /** The ffmpeg runs that cut a preview clip (an input seek before the input). */
  const cuts = () => mem.ffmpegRuns.filter((args) => args.indexOf("-ss") !== -1 && args.indexOf("-ss") < args.indexOf("-i"))
  /** A clip current for the fixture draft (source src.mp4, start 2). */
  const CLIP = {
    videoUrl: `https://cdn.test/trends/${T1}/preview.mp4`, durationSec: 5, width: 720, height: 1280, frames: 150, sha256: "b".repeat(64),
    sourceVideoUrl: `https://cdn.test/trends/${T1}/src.mp4`, startSec: 2, recipe: "1", madeAt: "2026-10-27T10:00:00.000Z",
  }

  it("a draft save cuts the clip from the saved source at previewStart (4 s + 1 s tail, frame-accurate args, no scaling), stores it under the trend's key and records it on the draft", async () => {
    seed()
    const res = await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: draftData(), revision: await revisionOf() })
    expect(res.statusCode, JSON.stringify(res.json())).toBe(200)
    expect(cuts()).toHaveLength(1)
    const args = cuts()[0]!.join(" ")
    expect(args).toContain("-y -ss 2.000 -i ")
    expect(args).toContain("-t 5.000 -map 0:v:0 -map 0:a:0? -c:v libx264 -preset medium -crf 16 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart")
    expect(args).not.toMatch(/scale|-vf|-r /)
    // Cut from the hidden source clip, never its display copy.
    expect(mem.downloads.get(cuts()[0]![cuts()[0]!.indexOf("-i") + 1]!)).toBe(`https://cdn.test/trends/${T1}/src.mp4`)
    expect(draftNow().previewClip).toEqual({
      videoUrl: expect.stringMatching(CLIP_RE),
      durationSec: 12, // the stubbed probe's
      width: 720,
      height: 1280,
      frames: 150,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      sourceVideoUrl: `https://cdn.test/trends/${T1}/src.mp4`,
      startSec: 2,
      recipe: "1",
      madeAt: expect.any(String),
    })
    expect(mem.uploads).toEqual([{ key: expect.stringMatching(/\.mp4$/), contentType: "video/mp4" }])
    // The clip is server-owned: the detail shows it, and the next save (same window) keeps it without cutting again.
    const detail = (await call("GET", `/v1/admin/trends/${T1}`)).json().data as { draft: TrendVersionData; revision: string }
    expect(detail.draft.previewClip).toEqual(draftNow().previewClip)
    const again = await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: { ...draftData(), name: { en: "Renamed" } }, revision: detail.revision })
    expect(again.statusCode).toBe(200)
    expect(cuts()).toHaveLength(1)
    expect(draftNow().previewClip).toEqual(detail.draft.previewClip)
    expect(draftNow().name.en).toBe("Renamed")
  })

  it("a moved previewStart re-cuts; a body carrying a previewClip of its own is ignored; previewStart null drops the clip without cutting", async () => {
    seed({}, draftData({ previewClip: CLIP }))
    const moved = await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: { ...draftData(), previewStart: 5, previewClip: { ...CLIP, startSec: 5 } }, revision: await revisionOf() })
    expect(moved.statusCode).toBe(200)
    expect(cuts()).toHaveLength(1)
    expect(cuts()[0]!.join(" ")).toContain("-ss 5.000 -i ")
    expect(draftNow().previewClip).toMatchObject({ startSec: 5, videoUrl: expect.stringMatching(CLIP_RE) })
    expect(draftNow().previewClip!.videoUrl).not.toBe(CLIP.videoUrl)

    const off = await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: { ...draftData(), previewStart: null }, revision: await revisionOf() })
    expect(off.statusCode).toBe(200)
    expect(draftNow()).not.toHaveProperty("previewClip")
    expect(draftNow().previewStart).toBeNull()
    expect(cuts()).toHaveLength(1)

    // Offered again: cut again.
    expect((await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: draftData(), revision: await revisionOf() })).statusCode).toBe(200)
    expect(cuts()).toHaveLength(2)
    expect(draftNow().previewClip).toMatchObject({ startSec: 2 })
  })

  it("a save naming ANOTHER source clip cuts from it (the old clip's cut is never kept)", async () => {
    seed({}, draftData({ previewClip: CLIP }))
    const source = { videoUrl: `https://cdn.test/trends/${T1}/other.mp4`, durationSec: 10, width: 720, height: 1280 }
    expect((await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: { ...draftData(), source }, revision: await revisionOf() })).statusCode).toBe(200)
    expect(cuts()).toHaveLength(1)
    expect(mem.downloads.get(cuts()[0]![cuts()[0]!.indexOf("-i") + 1]!)).toBe(source.videoUrl)
    expect(draftNow().previewClip).toMatchObject({ sourceVideoUrl: source.videoUrl, startSec: 2 })
  })

  it("an invalid draft is refused BEFORE anything is cut; a cut that fails never loses the save: the draft is saved without the clip and the answer says why (a stopped launch too)", async () => {
    seed()
    const bad = await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: { ...draftData(), source: { videoUrl: "https://x.example/a.mp4", durationSec: 3 } }, revision: await revisionOf() })
    expect(bad.statusCode).toBe(400)
    expect(cuts()).toHaveLength(0)

    mem.ffmpegFails = new Error("ffmpeg failed: Invalid data found when processing input")
    const unreadable = await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: { ...draftData(), name: { en: "Saved anyway" } }, revision: await revisionOf() })
    expect(unreadable.statusCode, JSON.stringify(unreadable.json())).toBe(200)
    expect(unreadable.json().data.previewClipError).toMatch(/Could not cut the preview's input clip/)
    expect(draftNow().name.en).toBe("Saved anyway")
    expect(draftNow()).not.toHaveProperty("previewClip")
    expect(mem.uploads).toEqual([])

    mem.ffmpegFails = Object.assign(new Error("ffmpeg failed: killed"), { killed: true, timedOut: true })
    const busy = await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: draftData({ name: { en: "Saved too" } }), revision: await revisionOf() })
    expect(busy.statusCode).toBe(200)
    expect(busy.json().data.previewClipError).toMatch(/could not be processed right now/)
    expect(draftNow().name.en).toBe("Saved too")

    // The clip a save could not cut blocks publish, not the save.
    const publish = await call("POST", `/v1/admin/trends/${T1}/publish`, { revision: await revisionOf() })
    expect([200, 409]).toContain(publish.statusCode)
  })

  it("the stored source clip's hash is the server's: a save naming the same clip keeps it whatever the body says; a new clip takes the body's", async () => {
    seed({}, draftData({ source: { ...draftData().source!, sha256: "a".repeat(64) } }))
    const dropped = await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: draftData(), revision: await revisionOf() })
    expect(dropped.statusCode, JSON.stringify(dropped.json())).toBe(200)
    expect(draftNow().source?.sha256).toBe("a".repeat(64))

    const forged = await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: draftData({ source: { ...draftData().source!, sha256: "f".repeat(64) } }), revision: await revisionOf() })
    expect(forged.statusCode).toBe(200)
    expect(draftNow().source?.sha256).toBe("a".repeat(64))

    const other = await call("PUT", `/v1/admin/trends/${T1}/draft`, {
      data: draftData({ source: { videoUrl: `https://cdn.test/trends/${T1}/other.mp4`, durationSec: 12, sha256: "c".repeat(64) } }),
      revision: await revisionOf(),
    })
    expect(other.statusCode, JSON.stringify(other.json())).toBe(200)
    expect(draftNow().source?.sha256).toBe("c".repeat(64))
  })

  it("publish self-heals: a draft with no clip (or a stale one) gets it cut and saved, then publishes that revision; the stored clip is what publishes", async () => {
    seed({}, draftData({ examples: [EXAMPLE] }))
    const res = await call("POST", `/v1/admin/trends/${T1}/publish`, { revision: await revisionOf() })
    expect(res.statusCode, JSON.stringify(res.json())).toBe(200)
    expect(cuts()).toHaveLength(1)
    const published = mem.trends[0]!.versions[1]!
    expect(published.published).toBe(true)
    expect(published.data.previewClip).toMatchObject({ sourceVideoUrl: `https://cdn.test/trends/${T1}/src.mp4`, startSec: 2 })

    // On a published trend, the self-heal writes a NEW version (the published row is never touched) and publishes it.
    mem.trends = []
    mem.ffmpegRuns = []
    seed({ status: "published", publishedVersion: 1 }, draftData({ examples: [EXAMPLE], previewClip: { ...CLIP, startSec: 7 } }))
    mem.trends[0]!.versions[1]!.published = true
    const again = await call("POST", `/v1/admin/trends/${T1}/publish`)
    expect(again.statusCode, JSON.stringify(again.json())).toBe(200)
    expect(again.json().data).toMatchObject({ publishedVersion: 2, draftVersion: 2 })
    expect(mem.trends[0]!.versions[1]!.data.previewClip).toEqual({ ...CLIP, startSec: 7 })
    expect(mem.trends[0]!.versions[2]!.data.previewClip).toMatchObject({ startSec: 2 })
    expect(cuts()).toHaveLength(1)
  })

  it("publish with a current clip cuts nothing; without a preview offered, needs none", async () => {
    seed({}, draftData({ examples: [EXAMPLE], previewClip: CLIP }))
    expect((await call("POST", `/v1/admin/trends/${T1}/publish`)).statusCode).toBe(200)
    expect(cuts()).toHaveLength(0)
    mem.trends = []
    seed({}, draftData({ examples: [EXAMPLE], previewStart: null }))
    expect((await call("POST", `/v1/admin/trends/${T1}/publish`)).statusCode).toBe(200)
    expect(cuts()).toHaveLength(0)
  })

  it("publish is blocked with preview_clip_missing (why the cut failed) when the clip cannot be cut, leaving the draft as it was; a stale one that cannot be re-cut is preview_clip_out_of_date with why", async () => {
    seed({}, draftData({ examples: [EXAMPLE] }))
    mem.ffmpegFails = new Error("ffmpeg failed: moov atom not found")
    const res = await call("POST", `/v1/admin/trends/${T1}/publish`)
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("publish_blocked")
    expect(reasonsOf(res)).toEqual([{ code: "preview_clip_missing", message: expect.stringMatching(/not prepared yet.*Making it failed: Could not cut/) }])
    expect(mem.trends[0]!.status).toBe("draft")
    expect(draftNow()).not.toHaveProperty("previewClip")

    mem.trends = []
    seed({}, draftData({ examples: [EXAMPLE], previewClip: { ...CLIP, startSec: 7 } }))
    mem.ffmpegFails = new Error("ffmpeg failed: moov atom not found")
    const stale = await call("POST", `/v1/admin/trends/${T1}/publish`)
    expect(stale.statusCode).toBe(409)
    expect(reasonsOf(stale)).toEqual([{ code: "preview_clip_out_of_date", why: "start", message: expect.stringMatching(/preview start moved.*Making it failed/) }])
    expect(draftNow().previewClip).toEqual({ ...CLIP, startSec: 7 })
  })

  it("the source upload (POST /:id/media) does not cut it: the clip is cut on save, from the saved source", async () => {
    seed()
    expect((await call("POST", `/v1/admin/trends/${T1}/media`, { url: "https://u.example/clip.mp4", kind: "source" })).statusCode).toBe(200)
    expect(cuts()).toHaveLength(0)
  })

  it("the stored source clip records its hash (a full run's provenance)", async () => {
    seed()
    const res = await call("POST", `/v1/admin/trends/${T1}/media`, { url: "https://u.example/clip.mp4", kind: "source" })
    expect(res.statusCode).toBe(200)
    // The media route answers what the builder saves on `source`: its hash rides along (a picture has none).
    const { url, durationSec, width, height, sha256 } = res.json().data
    expect(sha256).toMatch(/^[0-9a-f]{64}$/)
    expect((await call("POST", `/v1/admin/trends/${T1}/media`, { url: "https://u.example/ref.png", kind: "reference" })).json().data).not.toHaveProperty("sha256")
    const saved = await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: { ...draftData(), source: { videoUrl: url, durationSec, width, height, sha256 } }, revision: await revisionOf() })
    expect(saved.statusCode, JSON.stringify(saved.json())).toBe(200)
    expect(draftNow().source).toMatchObject({ videoUrl: url, sha256 })
    // The same clip's hash is the server's: whatever the body says, the stored one stays. A NEW clip's that is not a hash: refused.
    const same = await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: { ...draftData(), source: { videoUrl: url, durationSec, width, height, sha256: "nope" } }, revision: await revisionOf() })
    expect(same.statusCode).toBe(200)
    expect(draftNow().source?.sha256).toBe(sha256)
    const bad = await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: { ...draftData(), source: { videoUrl: `https://cdn.test/trends/${T1}/new.mp4`, durationSec, width, height, sha256: "nope" } }, revision: await revisionOf() })
    expect(bad.statusCode).toBe(400)
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
    ["POST", `/v1/admin/trends/${T1}/archive`],
    ["POST", `/v1/admin/trends/${T1}/restore`],
    ["DELETE", `/v1/admin/trends/${T1}/test-runs/${RUN}`],
    ["POST", `/v1/admin/trends/${T1}/face-mask`, { revision: "rev-1" }],
    ["POST", `/v1/admin/trends/${T1}/face-mask/approve`, { jobId: RUN, revision: "rev-1" }],
    ["DELETE", `/v1/admin/trends/${T1}/face-mask?revision=rev-1`],
    ["PUT", `/v1/admin/trends/${T1}/face-mask/scene-description`, { which: "full", text: "A kitchen.", revision: "rev-1" }],
    ["POST", `/v1/admin/trends/${T1}/upscale`, { target: "source", revision: "rev-1" }],
    ["POST", `/v1/admin/trends/${T1}/upscale/apply`, { jobId: RUN, revision: "rev-1" }],
    ["DELETE", `/v1/admin/trends/${T1}/upscale/${RUN}?revision=rev-1`],
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
    expect(runDelete.calls).toEqual([])
  })
})

// ── archive, restore, deleting a test run ─────────────────────────────────

describe("archive and restore", () => {
  const audits = () =>
    db.log.filter((q) => q.table === "admin_actions").map((q) => q.ops.find((op) => op.m === "insert")!.a[0] as Record<string, unknown>)

  it("archiving a published trend takes it off the catalog, refuses a publish, and is audited", async () => {
    seed({ status: "published", publishedVersion: 1, versions: { 1: { data: draftData({ examples: [EXAMPLE] }), published: true } } })
    const res = await call("POST", `/v1/admin/trends/${T1}/archive`)
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ status: "archived", publishedVersion: 1 })
    expect((await app.inject({ method: "GET", url: "/v1/trends/neon-dance", headers: as(USER) })).statusCode).toBe(404)
    const publish = await call("POST", `/v1/admin/trends/${T1}/publish`)
    expect(publish.statusCode).toBe(409)
    expect(publish.json().error.code).toBe("archived")
    expect(audits()).toEqual([
      expect.objectContaining({ admin_user_id: ADMIN, action: "archive_trend", target_type: "trend", target_id: T1, payload: { slug: "neon-dance", from: "published", to: "archived" } }),
    ])
  })

  it("restoring brings it back unpublished when it was ever published, else as a draft", async () => {
    seed({ status: "archived", publishedVersion: 1, versions: { 1: { data: draftData({ examples: [EXAMPLE] }), published: true } } })
    const res = await call("POST", `/v1/admin/trends/${T1}/restore`)
    expect(res.statusCode).toBe(200)
    expect(res.json().data.status).toBe("unpublished")

    mem.trends = []
    seed({ status: "archived" })
    expect((await call("POST", `/v1/admin/trends/${T1}/restore`)).json().data.status).toBe("draft")
  })

  it("archiving an archived trend changes nothing and writes no audit row", async () => {
    seed({ status: "archived" })
    const res = await call("POST", `/v1/admin/trends/${T1}/archive`)
    expect(res.statusCode).toBe(200)
    expect(res.json().data.status).toBe("archived")
    expect(audits()).toEqual([])
  })

  it("an unknown or malformed trend is a 404", async () => {
    expect((await call("POST", `/v1/admin/trends/${T1}/archive`)).statusCode).toBe(404)
    expect((await call("POST", "/v1/admin/trends/not-a-uuid/restore")).statusCode).toBe(404)
  })
})

describe("deleting a test run", () => {
  it("deletes an admin's run of this trend, as the admin, and audits it", async () => {
    seed()
    world.jobs.set(RUN, jobRow(RUN, ADMIN2))
    const res = await call("DELETE", `/v1/admin/trends/${T1}/test-runs/${RUN}`)
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ deleted: true, libraryRows: 1, filesDeleted: 2, filesKept: 0 })
    expect(runDelete.calls).toEqual([{ runId: RUN, ownerId: ADMIN2, actorUserId: ADMIN }])
    const audit = db.log.find((q) => q.table === "admin_actions")!.ops.find((op) => op.m === "insert")!.a[0]
    expect(audit).toMatchObject({ action: "delete_trend_test_run", target_type: "job", target_id: RUN, payload: { trendId: T1, ownerId: ADMIN2 } })
  })

  it("a run of another trend, or no run, is a 404 and deletes nothing", async () => {
    seed()
    world.jobs.set(RUN, jobRow(RUN, ADMIN, { input_data: runInput({ trend: { id: "00000000-0000-4000-8000-0000000000a2", slug: "other", version: 1, name: "Other" } }) }))
    expect((await call("DELETE", `/v1/admin/trends/${T1}/test-runs/${RUN}`)).statusCode).toBe(404)
    expect((await call("DELETE", `/v1/admin/trends/${T1}/test-runs/${CHILD}`)).statusCode).toBe(404)
    expect(runDelete.calls).toEqual([])
  })

  it("a user's own run of the trend is refused: it is theirs to delete", async () => {
    seed()
    world.jobs.set(RUN, jobRow(RUN, USER))
    const res = await call("DELETE", `/v1/admin/trends/${T1}/test-runs/${RUN}`)
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("not_admin_run")
    expect(runDelete.calls).toEqual([])
  })

  it("a run still in flight is a 409 run_in_progress", async () => {
    seed()
    world.jobs.set(RUN, jobRow(RUN, ADMIN))
    runDelete.inFlight = true
    const res = await call("DELETE", `/v1/admin/trends/${T1}/test-runs/${RUN}`)
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("run_in_progress")
  })
})

// ── the stored face mask ───────────────────────────────────────────────────

describe("the stored face mask", () => {
  const MASKING = { mode: "always" as const, threshold: 0.4 }
  const MASKED = "https://out.example/face-mask.mp4"
  const FM_SUPPORTS = { ...CAST_SWAP_ALL, storedFaceMask: true, faceMaskRecipe: "1" }
  const KEY = () => faceMaskSettingsKey(draftData({ faceMasking: MASKING }))!
  const audits = () =>
    db.log.filter((q) => q.table === "admin_actions").map((q) => q.ops.find((op) => op.m === "insert")!.a[0] as Record<string, unknown>)

  /** The engine's job. Its input carries the setting as the ENGINE stored it: defaults filled in. */
  function fmJob(over: Record<string, unknown> = {}, input: Record<string, unknown> = {}, output: Record<string, unknown> = {}) {
    return {
      id: FACE_MASK_JOB,
      user_id: ADMIN,
      status: "completed",
      input_data: {
        type: "cast-swap-face-mask",
        videoUrl: `https://cdn.test/trends/${T1}/src.mp4`,
        faceMasking: { ...withResolvedZone(MASKING), fill: "blur", minFaceHeightPct: 15, maxFaceHeightPct: 0, blurStrengthPct: 2 },
        ...input,
      },
      output_data: {
        maskedUrl: MASKED,
        frames: 360,
        recipe: { core: VIDEO_MASK_RECIPE, plugin: "1" },
        stats: { shots: 3, heldFrames: 12, coverage: 0.031 },
        ...output,
      },
      ...over,
    }
  }
  const pendingJob = (over: Record<string, unknown> = {}) => ({ jobId: FACE_MASK_JOB, settingsKey: KEY(), startedAt: "2026-10-25T09:00:00.000Z", ...over })
  /** A masked draft whose face mask job was started (and recorded) for these settings. */
  const making = (over: Partial<TrendVersionData> = {}) => draftData({ faceMasking: MASKING, faceMaskJob: pendingJob(), ...over })

  function supportStored(on = true) {
    setPluginSupports({ castSwap: { ...FM_SUPPORTS, roleKinds: [...CAST_SWAP_ALL.roleKinds], resolutions: [...CAST_SWAP_ALL.resolutions], storedFaceMask: on } })
  }

  beforeEach(() => {
    supportStored()
    world.envs = [envRow("production", FM_SUPPORTS), envRow("staging", FM_SUPPORTS)]
  })

  async function approve(over: Record<string, unknown> = {}) {
    return call("POST", `/v1/admin/trends/${T1}/face-mask/approve`, { jobId: FACE_MASK_JOB, revision: await revisionOf(), ...over })
  }

  describe("making one", () => {
    it("asks the engine, as the admin, for the saved draft's source and settings, records the job on the draft, and audits it", async () => {
      seed({}, draftData({ faceMasking: MASKING }))
      const revision = await revisionOf()
      const res = await call("POST", `/v1/admin/trends/${T1}/face-mask`, { revision })
      expect(res.statusCode).toBe(202)
      const draft = mem.trends[0]!.versions[1]!
      expect(res.json()).toEqual({ data: { jobId: FACE_MASK_JOB, version: 1, revision: draft.revision, recorded: true, draftMoved: false } })
      expect(draft.data.faceMaskJob).toEqual({ jobId: FACE_MASK_JOB, settingsKey: KEY(), startedAt: expect.any(String) })
      expect(engine.calls).toHaveLength(1)
      expect(engine.calls[0]!.body).toEqual({ videoUrl: `https://cdn.test/trends/${T1}/src.mp4`, faceMasking: withResolvedZone(MASKING) })
      expect(engine.calls[0]!.headers["x-internal-user-id"]).toBe(ADMIN)
      expect(audits()).toEqual([
        expect.objectContaining({ admin_user_id: ADMIN, action: "make_trend_face_mask", target_id: T1, payload: { slug: "neon-dance", jobId: FACE_MASK_JOB, settingsKey: KEY() } }),
      ])
      const detail = (await call("GET", `/v1/admin/trends/${T1}`)).json().data
      expect(detail.faceMaskJob).toEqual({ jobId: FACE_MASK_JOB, startedAt: expect.any(String), current: true })
    })

    it("refuses a stale revision before the engine is asked (nothing is paid for)", async () => {
      seed({}, draftData({ faceMasking: MASKING }))
      const res = await call("POST", `/v1/admin/trends/${T1}/face-mask`, { revision: "rev-stale" })
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe("draft_conflict")
      expect(engine.calls).toEqual([])
    })

    it("still records the paid job when another write lands meanwhile, keeping that write, and says the draft moved", async () => {
      seed({}, draftData({ faceMasking: MASKING }))
      const revision = await revisionOf()
      engine.onFaceMask = () => {
        const v = mem.trends[0]!.versions[1]!
        v.revision = "rev-elsewhere"
        v.data = { ...v.data, trendPrompt: "edited elsewhere" }
      }
      const res = await call("POST", `/v1/admin/trends/${T1}/face-mask`, { revision })
      expect(res.statusCode).toBe(202)
      expect(res.json().data).toMatchObject({ jobId: FACE_MASK_JOB, draftMoved: true })
      const data = mem.trends[0]!.versions[1]!.data
      expect(data.trendPrompt).toBe("edited elsewhere")
      expect(data.faceMaskJob).toMatchObject({ jobId: FACE_MASK_JOB, settingsKey: KEY() })
    })

    it("refuses, before the engine is asked, a draft that could not record the job", async () => {
      // A stored draft the schema no longer accepts (an unknown key): its save would fail after the job is paid for.
      seed({}, { ...draftData({ faceMasking: MASKING }), legacyField: true } as unknown as TrendVersionData)
      const res = await call("POST", `/v1/admin/trends/${T1}/face-mask`, { revision: await revisionOf() })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
      expect(engine.calls).toEqual([])
    })

    it("when the job can never be recorded, says so, and the job is still approvable from its audited start", async () => {
      seed({}, draftData({ faceMasking: MASKING }))
      const revision = await revisionOf()
      mem.conflictSaves = 100
      const res = await call("POST", `/v1/admin/trends/${T1}/face-mask`, { revision })
      expect(res.statusCode).toBe(202)
      expect(res.json()).toEqual({ data: { jobId: FACE_MASK_JOB, recorded: false, draftMoved: true } })
      expect(mem.conflictSaves).toBe(100 - 6)
      expect(mem.trends[0]!.versions[1]!.data.faceMaskJob).toBeUndefined()

      mem.conflictSaves = 0
      world.jobs.set(FACE_MASK_JOB, fmJob())
      const approved = await approve()
      expect(approved.statusCode).toBe(200)
      expect(mem.trends[0]!.versions[1]!.data.faceMask).toMatchObject({ jobId: FACE_MASK_JOB, settingsKey: KEY() })

      // Another admin's audited start is not the caller's: refused.
      mem.trends = []
      seed({}, draftData({ faceMasking: MASKING }))
      const other = await call("POST", `/v1/admin/trends/${T1}/face-mask/approve`, { jobId: FACE_MASK_JOB, revision: await revisionOf() }, ADMIN2)
      expect(other.json().error.code).toBe("not_pending_face_mask")
    })

    it("refuses a trend that does not mask, one with no source clip, and an engine that makes no stored masks", async () => {
      seed({}, draftData({ faceMasking: { mode: "off" } }))
      const start = async () => call("POST", `/v1/admin/trends/${T1}/face-mask`, { revision: await revisionOf() })
      expect((await start()).json().error.code).toBe("face_masking_off")
      mem.trends = []
      seed({}, draftData({ source: null, faceMasking: MASKING }))
      expect((await start()).json().error.code).toBe("source_missing")
      mem.trends = []
      seed({}, draftData({ faceMasking: MASKING }))
      supportStored(false)
      const res = await start()
      expect(res.statusCode).toBe(503)
      expect(res.json().error.code).toBe("engine_unsupported")
      expect(engine.calls).toEqual([])
    })

    it("sends the target, and refuses a face-only mask on an engine that would strip it and mask heads", async () => {
      const FACE = { ...MASKING, target: "face" as const }
      seed({}, draftData({ faceMasking: FACE }))
      // This engine declares no `faceMaskTargets`: it masks heads only.
      const held = await call("POST", `/v1/admin/trends/${T1}/face-mask`, { revision: await revisionOf() })
      expect(held.statusCode).toBe(503)
      expect(held.json().error.code).toBe("engine_unsupported")
      expect(engine.calls).toEqual([])

      setPluginSupports({ castSwap: { ...FM_SUPPORTS, roleKinds: [...CAST_SWAP_ALL.roleKinds], resolutions: [...CAST_SWAP_ALL.resolutions], faceMaskTargets: ["face", "head"] } })
      const res = await call("POST", `/v1/admin/trends/${T1}/face-mask`, { revision: await revisionOf() })
      expect(res.statusCode).toBe(202)
      expect(engine.calls[0]!.body).toEqual({ videoUrl: `https://cdn.test/trends/${T1}/src.mp4`, faceMasking: withResolvedZone(FACE) })
      expect(mem.trends[0]!.versions[1]!.data.faceMaskJob!.settingsKey).toBe(faceMaskSettingsKey(draftData({ faceMasking: FACE })))
      expect(mem.trends[0]!.versions[1]!.data.faceMaskJob!.settingsKey).not.toBe(KEY())
    })

    it("makes a head mask (the default, named or not) on an engine that declares no targets", async () => {
      seed({}, draftData({ faceMasking: { ...MASKING, target: "head" } }))
      const res = await call("POST", `/v1/admin/trends/${T1}/face-mask`, { revision: await revisionOf() })
      expect(res.statusCode).toBe(202)
      // Head named is the same mask as head left out: the same settings key.
      expect(mem.trends[0]!.versions[1]!.data.faceMaskJob!.settingsKey).toBe(KEY())
    })

    describe("a depth clip (`source`)", () => {
      const FULL = { mode: "always" as const, source: "full-depth" as const, threshold: 0.4 }
      const KEEP = { mode: "always" as const, source: "keep-people" as const, fill: "blur" as const }
      const MAIN = { label: "main" as const, fromFrame: 0, toFrame: 359, leftPct: 10, topPct: 10, rightPct: 50, bottomPct: 90 }
      const DEPTH = { sourceModes: ["faces", "full-depth", "keep-people"], faceMaskTargets: ["face", "head", "body"], faceMaskMarkLabels: ["erased", "main"], faceMaskErase: true }
      const supports = (extra: Record<string, unknown>) =>
        setPluginSupports({ castSwap: { ...FM_SUPPORTS, roleKinds: [...CAST_SWAP_ALL.roleKinds], resolutions: [...CAST_SWAP_ALL.resolutions], ...extra } as never })
      const start = async () => call("POST", `/v1/admin/trends/${T1}/face-mask`, { revision: await revisionOf() })

      it("is refused, before the engine is asked, on an engine that does not declare the mode", async () => {
        for (const faceMasking of [FULL, KEEP]) {
          mem.trends = []
          seed({}, draftData({ faceMasking }))
          supports({ ...DEPTH, sourceModes: undefined })
          const res = await start()
          expect(res.statusCode).toBe(503)
          expect(res.json().error.code).toBe("engine_unsupported")
        }
        expect(engine.calls).toEqual([])
      })

      it("full depth asks the engine for the mode alone", async () => {
        seed({}, draftData({ faceMasking: FULL }))
        supports(DEPTH)
        const res = await start()
        expect(res.statusCode).toBe(202)
        expect(engine.calls[0]!.body).toEqual({ videoUrl: `https://cdn.test/trends/${T1}/src.mp4`, faceMasking: { mode: "always", source: "full-depth" } })
        expect(mem.trends[0]!.versions[1]!.data.faceMaskJob!.settingsKey).toBe(faceMaskSettingsKey(draftData({ faceMasking: FULL })))
      })

      it("keep people sends its target named, no fill, and its main marks", async () => {
        seed({}, draftData({ faceMasking: { ...KEEP, marks: [MAIN] } }))
        supports(DEPTH)
        const res = await start()
        expect(res.statusCode).toBe(202)
        expect(engine.calls[0]!.body).toEqual({
          videoUrl: `https://cdn.test/trends/${T1}/src.mp4`,
          faceMasking: { mode: "always", source: "keep-people", target: "body", zone: { leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 }, marks: [MAIN] },
        })
      })

      it("keep people is refused on an engine without the whole-person target, or without main marks", async () => {
        seed({}, draftData({ faceMasking: KEEP }))
        supports({ ...DEPTH, faceMaskTargets: ["face", "head"] })
        expect((await start()).statusCode).toBe(503)
        mem.trends = []
        seed({}, draftData({ faceMasking: { ...KEEP, marks: [MAIN] } }))
        supports({ ...DEPTH, faceMaskMarkLabels: undefined })
        const res = await start()
        expect(res.statusCode).toBe(503)
        expect(res.json().error.message).toMatch(/main character/)
        expect(engine.calls).toEqual([])
      })

      it("full depth on an engine that stores a scene description also sends the roles and the preview's start", async () => {
        seed({}, draftData({ faceMasking: FULL }))
        supports({ ...DEPTH, storedSceneDescription: true })
        const res = await start()
        expect(res.statusCode).toBe(202)
        expect(engine.calls[0]!.body).toEqual({
          videoUrl: `https://cdn.test/trends/${T1}/src.mp4`,
          faceMasking: { mode: "always", source: "full-depth" },
          roles: [
            { name: "the woman on the left", kind: "person" },
            { name: "the dog", kind: "pet" },
          ],
          previewStart: 2,
        })
        // The roles never reach the settings key: the clip is the same clip.
        expect(mem.trends[0]!.versions[1]!.data.faceMaskJob!.settingsKey).toBe(faceMaskSettingsKey(draftData({ faceMasking: FULL })))
      })

      it("a trend with no preview sends no previewStart; keep people and faces get no roles even on such an engine", async () => {
        seed({}, draftData({ faceMasking: FULL, previewStart: null }))
        supports({ ...DEPTH, storedSceneDescription: true })
        await start()
        expect(engine.calls[0]!.body).toHaveProperty("roles")
        expect(engine.calls[0]!.body).not.toHaveProperty("previewStart")
        for (const faceMasking of [KEEP, MASKING]) {
          mem.trends = []
          engine.calls.length = 0
          seed({}, draftData({ faceMasking }))
          await start()
          expect(engine.calls[0]!.body).not.toHaveProperty("roles")
          expect(engine.calls[0]!.body).not.toHaveProperty("previewStart")
        }
      })

      it("a face mask needs none of the new declarations", async () => {
        seed({}, draftData({ faceMasking: { ...MASKING, source: "faces" } }))
        const res = await start()
        expect(res.statusCode).toBe(202)
        expect(engine.calls[0]!.body).toEqual({ videoUrl: `https://cdn.test/trends/${T1}/src.mp4`, faceMasking: withResolvedZone(MASKING) })
        expect(mem.trends[0]!.versions[1]!.data.faceMaskJob!.settingsKey).toBe(KEY())
      })
    })
  })

  describe("approving one", () => {
    it("takes the draft's pending job (whatever defaults the engine filled into its copy), stores the clip and clears the pending job", async () => {
      seed({}, making())
      world.jobs.set(FACE_MASK_JOB, fmJob())
      const res = await approve()
      expect(res.statusCode).toBe(200)
      const data = mem.trends[0]!.versions[1]!.data
      expect(data.faceMaskJob).toBeUndefined()
      expect(data.faceMask).toEqual({
        url: expect.stringMatching(new RegExp(`^https://cdn\\.test/trends/${T1}/[0-9a-f-]+\\.mp4$`)),
        frames: 360,
        recipe: { core: VIDEO_MASK_RECIPE, plugin: "1" },
        settingsKey: KEY(),
        jobId: FACE_MASK_JOB,
        // A stat the engine left out is 0.
        stats: { shots: 3, heldFrames: 12, coverage: 0.031, droppedRegions: 0 },
        approvedAt: expect.any(String),
        approvedBy: ADMIN,
      })
      // The masked clip, then the preview input clip cut again with the mask's cut beside it.
      expect(mem.uploads).toEqual([
        expect.objectContaining({ contentType: "video/mp4" }),
        expect.objectContaining({ contentType: "video/mp4" }),
        expect.objectContaining({ contentType: "video/mp4" }),
      ])
      expect(data.previewClip).toMatchObject({ sourceVideoUrl: data.source!.videoUrl, startSec: 2, faceMask: { sourceMaskUrl: data.faceMask!.url, frames: 150 } })
      expect(res.json().data).toMatchObject({ faceMask: data.faceMask, faceMaskState: { status: "approved", reasons: [] } })
      expect(res.json().data.revision).toBe(mem.trends[0]!.versions[1]!.revision)
      expect(audits()).toEqual([expect.objectContaining({ action: "approve_trend_face_mask", target_id: T1 })])
      const detail = (await call("GET", `/v1/admin/trends/${T1}`)).json().data
      expect(detail.faceMaskState).toEqual({ status: "approved", reasons: [] })
      expect(detail.faceMaskJob).toBeNull()
    })

    it.each([
      ["a job that is not the draft's pending one", making({ faceMaskJob: pendingJob({ jobId: RUN }) }), fmJob(), 409, "not_pending_face_mask"],
      ["a draft with no pending job", draftData({ faceMasking: MASKING }), fmJob(), 409, "not_pending_face_mask"],
      ["a job started for settings changed since", making({ faceMasking: { ...MASKING, threshold: 0.6 } }), fmJob(), 409, "face_mask_settings_changed"],
      ["a job started for another source clip", making({ faceMaskJob: pendingJob({ settingsKey: "v2:other" }) }), fmJob(), 409, "face_mask_settings_changed"],
      ["another user's job", making(), fmJob({ user_id: ADMIN2 }), 404, "not_found"],
      ["a job of another type", making(), fmJob({}, { type: "video-mask" }), 409, "not_a_face_mask"],
      ["a job still running", making(), fmJob({ status: "processing" }), 409, "not_completed"],
      ["a job that found no face", making(), fmJob({}, {}, { maskedUrl: null, reason: "no_faces" }), 409, "no_mask"],
      ["a job with no frame count", making(), fmJob({}, {}, { frames: 0 }), 409, "no_mask"],
      ["a mask under an older Video Mask recipe", making(), fmJob({}, {}, { recipe: { core: "2026-01-01", plugin: "1" } }), 409, "face_mask_out_of_date"],
      ["a mask with no Video Mask recipe", making(), fmJob({}, {}, { recipe: { core: null, plugin: "1" } }), 409, "face_mask_out_of_date"],
      ["a mask under another engine recipe than an environment's", making(), fmJob({}, {}, { recipe: { core: VIDEO_MASK_RECIPE, plugin: "0" } }), 409, "face_mask_out_of_date"],
    ])("refuses %s, storing nothing", async (_what, data, job, status, code) => {
      seed({}, data as TrendVersionData)
      world.jobs.set(FACE_MASK_JOB, job as Record<string, unknown>)
      const res = await approve()
      expect(res.statusCode).toBe(status)
      expect(res.json().error.code).toBe(code)
      expect(mem.uploads).toEqual([])
      expect(mem.trends[0]!.versions[1]!.data.faceMask).toBeUndefined()
    })

    it("refuses a stale revision with draft_conflict before reading the job", async () => {
      seed({}, making())
      world.jobs.set(FACE_MASK_JOB, fmJob())
      const res = await approve({ revision: "rev-stale" })
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe("draft_conflict")
      expect(mem.uploads).toEqual([])
    })

    it("a pending job made from older settings reads as not current", async () => {
      seed({}, making({ faceMasking: { ...MASKING, threshold: 0.6 } }))
      expect((await call("GET", `/v1/admin/trends/${T1}`)).json().data.faceMaskJob).toMatchObject({ jobId: FACE_MASK_JOB, current: false })
    })

    describe("a depth clip", () => {
      const FULL = { mode: "always" as const, source: "full-depth" as const }
      const FKEY = () => faceMaskSettingsKey(draftData({ faceMasking: FULL }))!
      const DEPTH = { ...FM_SUPPORTS, sourceModes: ["faces", "full-depth", "keep-people"] as Array<"faces" | "full-depth" | "keep-people"> }
      beforeEach(() => {
        setPluginSupports({ castSwap: { ...DEPTH, roleKinds: [...CAST_SWAP_ALL.roleKinds], resolutions: [...CAST_SWAP_ALL.resolutions] } })
        world.envs = [envRow("production", DEPTH), envRow("staging", DEPTH)]
      })
      /** A full-depth make, as the engine completes it: no Video Mask step (`core: null`), no raw mask kept. */
      const fullDepthJob = (input: Record<string, unknown> = {}) =>
        fmJob({}, { faceMasking: FULL, ...input }, { recipe: { core: null, plugin: "1" }, stats: { coverage: 1 }, baseStats: { coverage: 1 }, maskUrl: "https://out.example/raw.mp4" })

      it("a full-depth clip with no Video Mask recipe approves, and reads as up to date", async () => {
        seed({}, draftData({ faceMasking: FULL, faceMaskJob: pendingJob({ settingsKey: FKEY() }) }))
        world.jobs.set(FACE_MASK_JOB, fullDepthJob())
        const res = await approve()
        expect(res.statusCode).toBe(200)
        const stored = mem.trends[0]!.versions[1]!.data.faceMask!
        expect(stored.recipe).toEqual({ core: null, plugin: "1" })
        // Always made whole: no raw mask is kept to start a later make from.
        expect(stored).not.toHaveProperty("rawMaskUrl")
        expect(stored).not.toHaveProperty("baseKey")
        expect(res.json().data.faceMaskState).toEqual({ status: "approved", reasons: [] })
      })

      it("a make the engine recorded in another clip preparation is refused (an older engine stripped `source`)", async () => {
        seed({}, draftData({ faceMasking: FULL, faceMaskJob: pendingJob({ settingsKey: FKEY() }) }))
        world.jobs.set(FACE_MASK_JOB, fullDepthJob({ faceMasking: { mode: "always" } }))
        const res = await approve()
        expect(res.statusCode).toBe(409)
        expect(res.json().error.code).toBe("face_mask_source_mismatch")
        expect(mem.uploads).toEqual([])

        // And the other way: a face mask trend sent a depth clip.
        mem.trends = []
        seed({}, making())
        world.jobs.set(FACE_MASK_JOB, fmJob({}, { faceMasking: { ...withResolvedZone(MASKING), source: "keep-people" } }))
        expect((await approve()).json().error.code).toBe("face_mask_source_mismatch")
        expect(mem.trends[0]!.versions[1]!.data.faceMask).toBeUndefined()
      })

      it("stores the make's two scene descriptions, trimmed and capped, beside the clip", async () => {
        seed({}, draftData({ faceMasking: FULL, faceMaskJob: pendingJob({ settingsKey: FKEY() }) }))
        const job = fullDepthJob()
        world.jobs.set(FACE_MASK_JOB, {
          ...job,
          input_data: { ...job.input_data, previewStart: 2 },
          output_data: { ...job.output_data, sceneDescription: `  A neon kitchen. ${"x".repeat(5000)}`, previewSceneDescription: "\n0-4 s: the woman on the left spins.\n" },
        })
        const res = await approve()
        expect(res.statusCode).toBe(200)
        const stored = mem.trends[0]!.versions[1]!.data.faceMask!
        expect(stored.sceneDescription).toHaveLength(4000)
        expect(stored.sceneDescription!.startsWith("A neon kitchen.")).toBe(true)
        expect(stored.previewSceneDescription).toBe("0-4 s: the woman on the left spins.")
        // The preview start the make recorded: a preview run uses the text only while it is still the trend's.
        expect(stored.previewSceneDescriptionStart).toBe(2)
        expect(res.json().data.faceMask.previewSceneDescription).toBe("0-4 s: the woman on the left spins.")
      })

      it("a make with no (or an empty, or a non-text) description stores none", async () => {
        seed({}, draftData({ faceMasking: FULL, faceMaskJob: pendingJob({ settingsKey: FKEY() }) }))
        const job = fullDepthJob()
        world.jobs.set(FACE_MASK_JOB, { ...job, output_data: { ...job.output_data, sceneDescription: "   ", previewSceneDescription: 42 } })
        expect((await approve()).statusCode).toBe(200)
        const stored = mem.trends[0]!.versions[1]!.data.faceMask!
        expect(stored).not.toHaveProperty("sceneDescription")
        expect(stored).not.toHaveProperty("previewSceneDescription")
      })

      it("a face mask never stores a description, whatever its job says", async () => {
        seed({}, making())
        world.jobs.set(FACE_MASK_JOB, fmJob({}, {}, { sceneDescription: "A kitchen." }))
        expect((await approve()).statusCode).toBe(200)
        expect(mem.trends[0]!.versions[1]!.data.faceMask).not.toHaveProperty("sceneDescription")
      })

      it("a face mask that recorded `source: \"faces\"` is the trend's own", async () => {
        seed({}, making())
        world.jobs.set(FACE_MASK_JOB, fmJob({}, { faceMasking: { ...withResolvedZone(MASKING), source: "faces" } }))
        expect((await approve()).statusCode).toBe(200)
      })
    })
  })

  describe("the stored scene description (full depth)", () => {
    const FULL = { mode: "always" as const, source: "full-depth" as const }
    const DEPTH = { ...FM_SUPPORTS, sourceModes: ["faces", "full-depth", "keep-people"] as Array<"faces" | "full-depth" | "keep-people"> }
    const fullMask = (d: TrendVersionData): TrendFaceMask => ({
      url: `https://cdn.test/trends/${T1}/depth.mp4`,
      frames: 360,
      recipe: { core: null, plugin: "1" },
      settingsKey: faceMaskSettingsKey(d)!,
      jobId: FACE_MASK_JOB,
      stats: { shots: 0, heldFrames: 0, coverage: 1, droppedRegions: 0 },
      approvedAt: "2026-10-28T09:00:00.000Z",
      approvedBy: ADMIN,
      sceneDescription: "A neon kitchen.",
      previewSceneDescriptionStart: 2,
    })
    const withMask = (over: Partial<TrendVersionData> = {}) => {
      const d = draftData({ faceMasking: FULL, ...over })
      return { ...d, faceMask: fullMask(d) }
    }
    const edit = async (body: Record<string, unknown>, user = ADMIN) =>
      call("PUT", `/v1/admin/trends/${T1}/face-mask/scene-description`, { revision: await revisionOf(), ...body }, user)

    beforeEach(() => {
      setPluginSupports({ castSwap: { ...DEPTH, roleKinds: [...CAST_SWAP_ALL.roleKinds], resolutions: [...CAST_SWAP_ALL.resolutions] } })
      world.envs = [envRow("production", DEPTH), envRow("staging", DEPTH)]
    })

    it("writes either text on the draft, audits it, and leaves the clip up to date", async () => {
      seed({}, withMask())
      const before = mem.trends[0]!.versions[1]!.data.faceMask!
      const full = await edit({ which: "full", text: "  A rainy rooftop.  " })
      expect(full.statusCode).toBe(200)
      const preview = await edit({ which: "preview", text: "0-4 s: the woman spins." })
      expect(preview.statusCode).toBe(200)
      const stored = mem.trends[0]!.versions[1]!.data.faceMask!
      expect(stored).toEqual({ ...before, sceneDescription: "A rainy rooftop.", previewSceneDescription: "0-4 s: the woman spins." })
      expect(preview.json().data).toMatchObject({ revision: mem.trends[0]!.versions[1]!.revision, faceMaskState: { status: "approved", reasons: [] } })
      expect(preview.json().data.faceMask.previewSceneDescription).toBe("0-4 s: the woman spins.")
      expect(audits()).toEqual([
        expect.objectContaining({ admin_user_id: ADMIN, action: "edit_trend_scene_description", target_id: T1, payload: { slug: "neon-dance", jobId: FACE_MASK_JOB, which: "full", chars: 16 } }),
        expect.objectContaining({ action: "edit_trend_scene_description", payload: expect.objectContaining({ which: "preview" }) }),
      ])
      const detail = (await call("GET", `/v1/admin/trends/${T1}`)).json().data
      expect(detail.faceMaskState).toEqual({ status: "approved", reasons: [] })
    })

    it("a stale revision is a draft conflict, and nothing is written", async () => {
      seed({}, withMask())
      const res = await call("PUT", `/v1/admin/trends/${T1}/face-mask/scene-description`, { which: "full", text: "A rooftop.", revision: "rev-stale" })
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe("draft_conflict")
      expect(mem.trends[0]!.versions[1]!.data.faceMask!.sceneDescription).toBe("A neon kitchen.")
      expect(audits()).toEqual([])
    })

    it("is a 409 without an approved full-depth clip", async () => {
      seed({}, draftData({ faceMasking: FULL }))
      expect((await edit({ which: "full", text: "A rooftop." })).json().error.code).toBe("no_full_depth_mask")
      mem.trends = []
      const faces = draftData({ faceMasking: MASKING })
      seed({}, { ...faces, faceMask: { ...fullMask(faces), recipe: { core: VIDEO_MASK_RECIPE, plugin: "1" } } })
      const res = await edit({ which: "preview", text: "A rooftop." })
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe("no_full_depth_mask")
      expect(mem.trends[0]!.versions[1]!.data.faceMask).not.toHaveProperty("previewSceneDescription")
      expect(audits()).toEqual([])
    })

    it("refuses an empty text, one over 4000 characters, and an unknown `which`", async () => {
      seed({}, withMask())
      for (const body of [{ which: "full", text: "   " }, { which: "full", text: "x".repeat(4001) }, { which: "both", text: "A rooftop." }]) {
        const res = await edit(body)
        expect(res.statusCode, JSON.stringify(body).slice(0, 40)).toBe(400)
      }
      expect(mem.trends[0]!.versions[1]!.data.faceMask!.sceneDescription).toBe("A neon kitchen.")
    })

    it("a draft save never overwrites it (the face mask is server-owned)", async () => {
      seed({}, withMask())
      const body = { ...withMask(), faceMask: { ...fullMask(withMask()), sceneDescription: "Hijacked." } }
      const res = await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: body, revision: await revisionOf() })
      expect(res.statusCode).toBe(200)
      expect(mem.trends[0]!.versions[1]!.data.faceMask!.sceneDescription).toBe("A neon kitchen.")
    })
  })

  describe("marks (faces left unmasked)", () => {
    const MARK = { label: "erased" as const, fromFrame: 0, toFrame: 359, leftPct: 60, topPct: 10, rightPct: 90, bottomPct: 50 }
    const MARKED = { ...MASKING, marks: [MARK] }
    const MKEY = () => faceMaskSettingsKey(draftData({ faceMasking: MARKED }))!
    const BASE_KEY = () => faceMaskBaseKey(draftData({ faceMasking: MARKED }))!
    const RAW = `https://cdn.test/trends/${T1}/raw.mp4`
    const BASE_STATS = { shots: 3, heldFrames: 12, coverage: 0.05, droppedRegions: 0 }
    function supportErase(over: Record<string, unknown> = {}) {
      setPluginSupports({ castSwap: { ...FM_SUPPORTS, roleKinds: [...CAST_SWAP_ALL.roleKinds], resolutions: [...CAST_SWAP_ALL.resolutions], faceMaskErase: true, ...over } })
    }
    /** The approved mask: made without marks, its raw mask kept (the base of the next edit). */
    const approvedBase = (over: Partial<TrendFaceMask> = {}): TrendFaceMask => ({
      url: `https://cdn.test/trends/${T1}/mask.mp4`,
      frames: 360,
      recipe: { core: VIDEO_MASK_RECIPE, plugin: "1" },
      settingsKey: KEY(),
      jobId: "fm-old",
      stats: { shots: 3, heldFrames: 12, coverage: 0.05, droppedRegions: 0 },
      approvedAt: "2026-10-25T10:00:00.000Z",
      approvedBy: ADMIN,
      rawMaskUrl: RAW,
      baseKey: BASE_KEY(),
      baseStats: BASE_STATS,
      ...over,
    })
    const start = async () => call("POST", `/v1/admin/trends/${T1}/face-mask`, { revision: await revisionOf() })

    it("holds back a make with marks on an engine that does not declare faceMaskErase (it would mask every face)", async () => {
      seed({}, draftData({ faceMasking: MARKED }))
      const res = await start()
      expect(res.statusCode).toBe(503)
      expect(res.json().error.code).toBe("engine_unsupported")
      expect(engine.calls).toEqual([])
    })

    it("sends the marks, and the approved mask as fromMask (recipe and raw stats) when it is a current base", async () => {
      supportErase()
      seed({}, draftData({ faceMasking: MARKED, faceMask: approvedBase() }))
      const res = await start()
      expect(res.statusCode).toBe(202)
      expect(engine.calls[0]!.body).toEqual({
        videoUrl: `https://cdn.test/trends/${T1}/src.mp4`,
        faceMasking: { ...withResolvedZone(MASKING), marks: [MARK] },
        fromMask: { maskUrl: RAW, recipe: VIDEO_MASK_RECIPE, stats: BASE_STATS },
      })
      expect(mem.trends[0]!.versions[1]!.data.faceMaskJob!.settingsKey).toBe(MKEY())
      expect(audits()[0]!.payload).toMatchObject({ fromMask: true, settingsKey: MKEY() })
    })

    it("makes it whole (no fromMask) when the approved mask kept no raw mask, was made from other base settings, or by another engine recipe", async () => {
      for (const [faceMask, supports] of [
        [approvedBase({ rawMaskUrl: undefined, baseKey: undefined, baseStats: undefined }), {}],
        [approvedBase({ baseKey: "v2:other" }), {}],
        [approvedBase(), { faceMaskRecipe: "2" }],
        // Approved before baseStats, with faces erased: its stats are not the raw mask's.
        [approvedBase({ baseStats: undefined, stats: { ...BASE_STATS, coverage: 0.02, erasedRegions: 2 } }), {}],
      ] as const) {
        supportErase(supports)
        mem.trends = []
        engine.calls.length = 0
        seed({}, draftData({ faceMasking: MARKED, faceMask }))
        expect((await start()).statusCode).toBe(202)
        expect(engine.calls[0]!.body).not.toHaveProperty("fromMask")
        expect(engine.calls[0]!.body.faceMasking).toMatchObject({ marks: [MARK] })
      }
    })

    it("sends no marks key and no fromMask for a draft without marks on an engine without the capability (exactly as before)", async () => {
      seed({}, draftData({ faceMasking: { ...MASKING, marks: [] }, faceMask: approvedBase() }))
      expect((await start()).statusCode).toBe(202)
      expect(engine.calls[0]!.body).toEqual({ videoUrl: `https://cdn.test/trends/${T1}/src.mp4`, faceMasking: withResolvedZone(MASKING) })
    })

    it("approving keeps the raw mask, its base key and raw stats; a raw mask re-used from the approved one is kept as it is", async () => {
      supportErase()
      const job = fmJob({}, { faceMasking: { ...withResolvedZone(MASKING), fill: "blur", marks: [MARK] } }, {
        maskUrl: "https://out.example/raw.mp4",
        stats: { shots: 3, heldFrames: 12, coverage: 0.03, droppedRegions: 0, erasedRegions: 1 },
        baseStats: BASE_STATS,
      })
      seed({}, draftData({ faceMasking: MARKED, faceMaskJob: pendingJob({ settingsKey: MKEY() }) }))
      world.jobs.set(FACE_MASK_JOB, job)
      const res = await approve()
      expect(res.statusCode).toBe(200)
      const fm = mem.trends[0]!.versions[1]!.data.faceMask!
      expect(fm).toMatchObject({
        settingsKey: MKEY(),
        baseKey: BASE_KEY(),
        baseStats: BASE_STATS,
        stats: { coverage: 0.03, erasedRegions: 1 },
        rawMaskUrl: expect.stringMatching(new RegExp(`^https://cdn\\.test/trends/${T1}/[0-9a-f-]+\\.mp4$`)),
      })
      expect(fm.depthUrl).toBeUndefined()
      // The masked clip and the raw mask, both copied into the trend's storage; then the preview clip and its mask cut.
      expect(mem.uploads).toHaveLength(4)

      // A make from that mask echoes its raw mask back: kept, not copied again.
      mem.trends = []
      mem.uploads.length = 0
      seed({}, draftData({ faceMasking: MARKED, faceMask: approvedBase(), faceMaskJob: pendingJob({ settingsKey: MKEY() }) }))
      world.jobs.set(FACE_MASK_JOB, { ...job, output_data: { ...job.output_data, maskUrl: RAW } })
      expect((await approve()).statusCode).toBe(200)
      expect(mem.trends[0]!.versions[1]!.data.faceMask).toMatchObject({ rawMaskUrl: RAW, baseKey: BASE_KEY() })
      // The masked clip, then the preview clip and its mask cut.
      expect(mem.uploads).toHaveLength(3)
    })

    it("refuses, with marks, a mask whose job reports no raw mask or no count of faces left unmasked (an older engine)", async () => {
      supportErase()
      const recorded = { faceMasking: { ...withResolvedZone(MASKING), fill: "blur", marks: [MARK] } }
      for (const output of [
        { stats: { shots: 3, heldFrames: 12, coverage: 0.03, droppedRegions: 0, erasedRegions: 1 } },
        { maskUrl: "https://out.example/raw.mp4", stats: { shots: 3, heldFrames: 12, coverage: 0.03, droppedRegions: 0 } },
      ]) {
        mem.trends = []
        seed({}, draftData({ faceMasking: MARKED, faceMaskJob: pendingJob({ settingsKey: MKEY() }) }))
        world.jobs.set(FACE_MASK_JOB, fmJob({}, recorded, output))
        const res = await approve()
        expect([res.statusCode, res.json().error.code]).toEqual([409, "face_mask_not_erased"])
        expect(mem.uploads).toEqual([])
      }
    })

    it("approving keeps the masked clip's video frame rate when the probe reads one", async () => {
      supportErase()
      mem.fps = 29.97
      try {
        seed({}, making())
        world.jobs.set(FACE_MASK_JOB, fmJob())
        expect((await approve()).statusCode).toBe(200)
        expect(mem.trends[0]!.versions[1]!.data.faceMask!.fps).toBe(29.97)
      } finally {
        mem.fps = undefined
      }
    })

    it("a draft save with a new source clip clears the marks and says so; the same clip keeps them", async () => {
      seed({}, draftData({ faceMasking: MARKED }))
      const loaded = (await call("GET", `/v1/admin/trends/${T1}`)).json().data as { draft: TrendVersionData; revision: string }
      const same = await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: { ...loaded.draft, trendPrompt: "edited" }, revision: loaded.revision })
      expect(same.statusCode).toBe(200)
      expect(same.json().data).not.toHaveProperty("marksCleared")
      expect(mem.trends[0]!.versions[1]!.data.faceMasking).toEqual(MARKED)

      const again = (await call("GET", `/v1/admin/trends/${T1}`)).json().data as { draft: TrendVersionData; revision: string }
      const moved = { ...again.draft, source: { videoUrl: `https://cdn.test/trends/${T1}/other.mp4`, durationSec: 10 } }
      const res = await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: moved, revision: again.revision })
      expect(res.statusCode).toBe(200)
      expect(res.json().data).toMatchObject({ marksCleared: true })
      expect(mem.trends[0]!.versions[1]!.data.faceMasking).toEqual(MASKING)
    })

    it("the trend detail says whether this engine makes a mask with marks", async () => {
      seed({}, draftData({ faceMasking: MARKED }))
      expect((await call("GET", `/v1/admin/trends/${T1}`)).json().data.faceMaskMarksSupported).toBe(false)
      supportErase()
      expect((await call("GET", `/v1/admin/trends/${T1}`)).json().data.faceMaskMarksSupported).toBe(true)
    })

    it("refuses a job made without the draft's marks (an engine that dropped them), storing nothing", async () => {
      supportErase()
      seed({}, draftData({ faceMasking: MARKED, faceMaskJob: pendingJob({ settingsKey: MKEY() }) }))
      world.jobs.set(FACE_MASK_JOB, fmJob())
      const res = await approve()
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe("face_mask_settings_changed")
      expect(mem.uploads).toEqual([])
      expect(mem.trends[0]!.versions[1]!.data.faceMask).toBeUndefined()
    })

    it("a test run of a draft with marks on an engine that takes no stored mask is refused, never masked per run", async () => {
      const MARKED_KEY = faceMaskSettingsKey(draftData({ faceMasking: MARKED }))!
      seed({}, draftData({ faceMasking: MARKED, faceMask: approvedBase({ settingsKey: MARKED_KEY }) }))
      supportStored(false)
      const held = await call("POST", `/v1/admin/trends/${T1}/test-runs`, { slots: { lead: { images: ["https://u.example/me.png"] } } })
      expect([held.statusCode, held.json().error?.code]).toEqual([503, "engine_unsupported"])
      expect(engine.calls.filter((c) => c.url === "/v1/cast-swap")).toEqual([])
      // An engine that takes the stored mask but would strip `required` (and mask per run): refused too.
      supportStored(true)
      const stripped = await call("POST", `/v1/admin/trends/${T1}/test-runs`, { slots: { lead: { images: ["https://u.example/me.png"] } } })
      expect([stripped.statusCode, stripped.json().error?.code]).toEqual([503, "engine_unsupported"])
      expect(engine.calls.filter((c) => c.url === "/v1/cast-swap")).toEqual([])
      // With the engine honouring `required`: the run goes out on the stored mask, required, without the marks.
      setPluginSupports({ castSwap: { ...FM_SUPPORTS, roleKinds: [...CAST_SWAP_ALL.roleKinds], resolutions: [...CAST_SWAP_ALL.resolutions], storedFaceMaskRequired: true } })
      const ran = await call("POST", `/v1/admin/trends/${T1}/test-runs`, { slots: { lead: { images: ["https://u.example/me.png"] } } })
      expect(ran.statusCode).toBe(202)
      const sent = engine.calls.find((c) => c.url === "/v1/cast-swap")!.body
      expect(sent.storedFaceMask).toEqual({ url: `https://cdn.test/trends/${T1}/mask.mp4`, frames: 360, required: true })
      expect(sent.faceMasking).not.toHaveProperty("marks")
    })

    it("a test run of a draft with marks and no matching approved mask is refused 409", async () => {
      seed({}, draftData({ faceMasking: MARKED, faceMask: approvedBase() }))
      const res = await call("POST", `/v1/admin/trends/${T1}/test-runs`, { slots: { lead: { images: ["https://u.example/me.png"] } } })
      expect([res.statusCode, res.json().error?.code]).toEqual([409, "face_mask_required"])
      expect(engine.calls.filter((c) => c.url === "/v1/cast-swap")).toEqual([])
    })
  })

  describe("on the draft", () => {
    async function approved() {
      seed({}, making({ examples: [EXAMPLE] }))
      world.jobs.set(FACE_MASK_JOB, fmJob())
      expect((await approve()).statusCode).toBe(200)
      return mem.trends[0]!.versions[1]!.data.faceMask!
    }

    it("a draft save keeps the stored mask and the pending job, and ignores ones sent in the body", async () => {
      const mask = await approved()
      mem.trends[0]!.versions[1]!.data.faceMaskJob = pendingJob()
      const { faceMask: _f, ...edited } = draftData({ faceMasking: MASKING, trendPrompt: "edited" })
      let res = await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: edited, revision: await revisionOf() })
      expect(res.statusCode).toBe(200)
      expect(mem.trends[0]!.versions[1]!.data.faceMask).toEqual(mask)
      expect(mem.trends[0]!.versions[1]!.data.faceMaskJob).toEqual(pendingJob())
      res = await call("PUT", `/v1/admin/trends/${T1}/draft`, {
        data: { ...edited, faceMask: { ...mask, url: "https://evil.example/x.mp4" }, faceMaskJob: pendingJob({ jobId: RUN }) },
        revision: await revisionOf(),
      })
      expect(res.statusCode).toBe(200)
      expect(mem.trends[0]!.versions[1]!.data.faceMask).toEqual(mask)
      expect(mem.trends[0]!.versions[1]!.data.faceMaskJob).toEqual(pendingJob())
    })

    it("stays approved when only the mode changes (always and auto mask the same clip)", async () => {
      await approved()
      await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: draftData({ faceMasking: { ...MASKING, mode: "auto" } }), revision: await revisionOf() })
      expect((await call("GET", `/v1/admin/trends/${T1}`)).json().data.faceMaskState).toEqual({ status: "approved", reasons: [] })
    })

    it("is out of date once the settings change, Video Mask's recipe moves, or an environment's engine recipe does", async () => {
      const mask = await approved()
      const state = async () => (await call("GET", `/v1/admin/trends/${T1}`)).json().data.faceMaskState
      await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: draftData({ faceMasking: { ...MASKING, threshold: 0.6 } }), revision: await revisionOf() })
      expect(await state()).toEqual({ status: "out_of_date", reasons: [{ why: "settings" }] })

      mem.trends[0]!.versions[1]!.data = { ...draftData({ faceMasking: MASKING }), faceMask: { ...mask, recipe: { core: "2026-01-01", plugin: "1" } } }
      world.envs = [envRow("production", { ...FM_SUPPORTS, faceMaskRecipe: "2" }), envRow("staging", FM_SUPPORTS)]
      expect(await state()).toEqual({ status: "out_of_date", reasons: [{ why: "core_recipe" }, { why: "plugin_recipe", env: "production" }] })
    })

    it("publishing a masked trend needs its mask approved and up to date", async () => {
      await approved()
      expect((await call("POST", `/v1/admin/trends/${T1}/publish`)).statusCode).toBe(200)

      mem.trends = []
      seed({}, draftData({ faceMasking: MASKING, examples: [EXAMPLE] }))
      let res = await call("POST", `/v1/admin/trends/${T1}/publish`)
      expect(reasonsOf(res)).toEqual([{ code: "face_mask_missing", message: expect.any(String) }])

      mem.trends = []
      await approved()
      world.envs = [envRow("production", { ...FM_SUPPORTS, faceMaskRecipe: "2" }), envRow("staging", FM_SUPPORTS)]
      res = await call("POST", `/v1/admin/trends/${T1}/publish`)
      expect(reasonsOf(res)).toEqual([{ code: "face_mask_out_of_date", why: "plugin_recipe", env: "production", message: expect.any(String) }])
    })

    it("a test run sends the stored mask, and not to an engine that does not take one", async () => {
      const mask = await approved()
      const body = { slots: { lead: { images: ["https://u.example/me.png"] } } }
      expect((await call("POST", `/v1/admin/trends/${T1}/test-runs`, body)).statusCode).toBe(202)
      expect(engine.calls.at(-1)!.body.storedFaceMask).toEqual({ url: mask.url, frames: 360 })

      supportStored(false)
      expect((await call("POST", `/v1/admin/trends/${T1}/test-runs`, body)).statusCode).toBe(202)
      expect(engine.calls.at(-1)!.body).not.toHaveProperty("storedFaceMask")
      expect(engine.calls.at(-1)!.body.faceMasking).toEqual(withResolvedZone(MASKING))
    })

    it("clearing removes the pointer (never the file), guarded on the revision, and is audited", async () => {
      await approved()
      expect((await call("DELETE", `/v1/admin/trends/${T1}/face-mask?revision=rev-stale`)).json().error.code).toBe("draft_conflict")
      const res = await call("DELETE", `/v1/admin/trends/${T1}/face-mask?revision=${await revisionOf()}`)
      expect(res.statusCode).toBe(200)
      expect(res.json().data.faceMaskState).toEqual({ status: "none", reasons: [] })
      expect(mem.trends[0]!.versions[1]!.data).not.toHaveProperty("faceMask")
      expect(audits().map((a) => a.action)).toEqual(["approve_trend_face_mask", "clear_trend_face_mask"])
    })

    it("approving cuts the preview input clip again WITH the mask's cut (identical arguments, the mask fetched from the stored copy); clearing cuts it again WITHOUT", async () => {
      const cuts = () => mem.ffmpegRuns.filter((args) => args.indexOf("-ss") !== -1 && args.indexOf("-ss") < args.indexOf("-i"))
      const input = (args: string[]) => mem.downloads.get(args[args.indexOf("-i") + 1]!)
      // A clip cut before the mask was approved: current for the source and start, no mask cut.
      const before = {
        videoUrl: `https://cdn.test/trends/${T1}/preview-before.mp4`, durationSec: 5, width: 720, height: 1280, frames: 150, sha256: "b".repeat(64),
        sourceVideoUrl: `https://cdn.test/trends/${T1}/src.mp4`, startSec: 2, recipe: "1", madeAt: "2026-10-27T10:00:00.000Z",
      }
      seed({}, making({ examples: [EXAMPLE], previewClip: before }))
      world.jobs.set(FACE_MASK_JOB, fmJob())
      expect((await approve()).statusCode).toBe(200)
      const data = mem.trends[0]!.versions[1]!.data
      expect(cuts()).toHaveLength(2)
      const [clipCut, maskCut] = cuts()
      expect(input(clipCut!)).toBe(`https://cdn.test/trends/${T1}/src.mp4`)
      // The mask is cut from the copy in the trend's storage, never the engine's own file.
      expect(input(maskCut!)).toBe(data.faceMask!.url)
      expect(input(maskCut!)).not.toBe(MASKED)
      const shape = (args: string[]) => args.map((a, i) => (i === args.indexOf("-i") + 1 || i === args.length - 1 ? "<path>" : a))
      expect(shape(maskCut!)).toEqual(shape(clipCut!))
      expect(data.previewClip).toMatchObject({
        startSec: 2,
        faceMask: { url: expect.stringMatching(new RegExp(`^https://cdn\\.test/trends/${T1}/[0-9a-f-]{36}\\.mp4$`)), frames: 150, sha256: expect.stringMatching(/^[0-9a-f]{64}$/), sourceMaskUrl: data.faceMask!.url },
      })
      expect(data.previewClip!.videoUrl).not.toBe(before.videoUrl)
      expect(data.previewClip!.faceMask!.url).not.toBe(data.previewClip!.videoUrl)

      // Clear: the mask's cut goes, the clip is cut again from the source alone.
      mem.ffmpegRuns = []
      const cleared = await call("DELETE", `/v1/admin/trends/${T1}/face-mask?revision=${await revisionOf()}`)
      expect(cleared.statusCode).toBe(200)
      expect(cuts()).toHaveLength(1)
      const after = mem.trends[0]!.versions[1]!.data
      expect(after).not.toHaveProperty("faceMask")
      expect(after.previewClip).toMatchObject({ startSec: 2 })
      expect(after.previewClip).not.toHaveProperty("faceMask")
      expect(after.previewClip!.videoUrl).not.toBe(data.previewClip!.videoUrl)
    })

    it("approving refuses a mask whose cut does not match the clip's frames (a mask made from another clip), storing no clip and no mask", async () => {
      seed({}, making({ examples: [EXAMPLE] }))
      world.jobs.set(FACE_MASK_JOB, fmJob())
      mem.frames = (path) => (path.endsWith("mask-clip.mp4") ? 149 : 150)
      const res = await approve()
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("media_unreadable")
      expect(res.json().error.message).toMatch(/149 frames.*150/)
      expect(mem.trends[0]!.versions[1]!.data).not.toHaveProperty("faceMask")
      expect(mem.trends[0]!.versions[1]!.data).not.toHaveProperty("previewClip")
      // The masked clip was copied before the cut; the cuts themselves were not stored.
      expect(mem.uploads).toHaveLength(1)
    })
  })
})
