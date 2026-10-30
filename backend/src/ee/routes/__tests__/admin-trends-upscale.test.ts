/**
 * Upscaling a trend's source clip or an example to 720p or 1080p
 * (ee/routes/admin-trends-upscale.ts).
 *
 * What must hold:
 *  - starting asks the core Video Upscale (Topaz, 2x) AS THE ADMIN, for the
 *    saved draft's video, records the job on the draft (named by that video)
 *    and audits it; a stale revision, a missing target, a video already 1080p
 *    and a draft that could not record the job are refused before anything
 *    is paid for; a job paid for is recorded even when another write landed;
 *  - starting asks Topaz for 1080p (the short side), is refused while an
 *    upscale of the same video still runs, passes on the core route's own
 *    refusal (a clip too long), and a failure after the job was paid for
 *    still answers with the job id;
 *  - applying takes only the draft's own pending upscale, the caller's
 *    finished, unwatermarked Topaz job of exactly that video, while the video
 *    is still the target's; it answers 202 at once, marks the record
 *    `applying` and works in the background: an example gets the 1080p
 *    video, a fresh poster and its size and length, the source is replaced
 *    as a new clip is (its display copy and the preview kept inside it),
 *    which leaves a stored face mask out of date; a failure is written on
 *    the record as its `error`;
 *  - a second "Use it" while one runs is 409 `apply_in_progress`, a stale one
 *    may be retried, and one applied already reports success;
 *  - the resize's wait never undoes another write; a published version is
 *    never touched;
 *  - discarding removes the record only; a draft save keeps the records;
 *  - every route is admin-only.
 *
 * The store is an in-memory stand-in honouring the store's contract (as in
 * admin-trends.test.ts); jobs and audit rows go through the recording fake
 * Supabase; the 1080p resize (`storeUpscaledVideo`, pinned in
 * lib/trends/__tests__/upscale-media.test.ts) is stubbed; Video Upscale is a
 * stub route that records what it receives.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { type QueryResult, type RecordedQuery } from "../../../lib/__tests__/fake-supabase-query.js"
import type { TrendExample, TrendRow, TrendUpscaleJob, TrendVersionData } from "../../lib/trends/types.js"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  respond: null as null | ((q: RecordedQuery) => QueryResult),
}))

// A publish's background web copies (web-copy.ts, pinned in its own tests): never made here.
vi.mock("../../lib/trends/web-copy.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/trends/web-copy.js")>()),
  startWebCopies: () => Promise.resolve(),
}))

vi.mock("../../../lib/supabase.js", async () => {
  const { makeFakeFrom } = await import("../../../lib/__tests__/fake-supabase-query.js")
  return { supabase: { from: makeFakeFrom(db.log, (q) => db.respond!(q)) } }
})

type MemVersion = { data: TrendVersionData; published: boolean; revision?: string }
type MemTrend = TrendRow & { versions: Record<number, MemVersion> }

const mem = vi.hoisted(() => ({
  revs: 0,
  trends: [] as MemTrend[],
  /** Every preview input clip cut (`makePreviewClip`): what it was cut from, at which start, for how long, with which mask. */
  clips: [] as Array<{ trendId: string; sourceUrl: string; startSec: number; durationSec: number; faceMask?: { url: string } }>,
  /** When set, the next cut fails with it. */
  clipFails: null as null | Error,
  admins: new Set<string>(),
  /** This many draft saves lose to a concurrent write, as if someone always saved first. */
  conflictSaves: 0,
  /** The next draft save fails with this (a database error, not a conflict). */
  saveFails: null as null | Error,
  /** Every `storeUpscaledVideo` call. */
  stored: [] as Array<{ trendId: string; upscaledUrl: string; originalUrl: string; durationSec: number; asSource: boolean; resolution: "720p" | "1080p"; shownAs?: { width: number; height: number } }>,
  /** Called while the resize runs: a hook for "meanwhile, someone else wrote". */
  onStore: null as null | (() => void),
  storeFails: null as null | Error,
}))

vi.mock("../../lib/trends/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/trends/store.js")>()
  const strip = (t: MemTrend): TrendRow => {
    const { versions: _v, ...row } = t
    return { ...row, tags: [...row.tags], badges: [...row.badges] }
  }
  const rev = (v: MemVersion) => (v.revision ??= `rev-${++mem.revs}`)
  return {
    ...actual,
    getTrendById: async (id: string) => {
      const t = mem.trends.find((x) => x.id === id)
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
    saveDraft: async (id: string, data: TrendVersionData, opts: { expectedRevision?: string } = {}) => {
      const fails = mem.saveFails
      mem.saveFails = null
      if (fails) throw fails
      if (mem.conflictSaves > 0) {
        mem.conflictSaves -= 1
        throw new actual.DraftConflictError(id)
      }
      const t = mem.trends.find((x) => x.id === id)
      if (!t) throw new actual.TrendNotFoundError(id)
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
      return { version: t.draftVersion, revision }
    },
  }
})

vi.mock("../../lib/trends/preview-clip-media.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/trends/preview-clip-media.js")>()
  const { PREVIEW_CLIP_RECIPE, previewClipDurationSec, previewClipState, withoutPreviewClip } = await import("../../lib/trends/preview-clip.js")
  const { storedFaceMaskFor } = await import("../../lib/trends/face-mask.js")
  // The cut itself is stubbed (preview-clip-media.test.ts pins it); the preparation runs as it is.
  const makePreviewClip = async (trendId: string, args: { sourceUrl: string; startSec: number; durationSec: number; faceMask?: { url: string } }) => {
    mem.clips.push({ trendId, ...args })
    const fail = mem.clipFails
    mem.clipFails = null
    if (fail) throw fail
    const n = mem.clips.length
    return {
      videoUrl: `https://cdn.test/trends/${trendId}/preview-${n}.mp4`, durationSec: args.durationSec, width: 1080, height: 1920, frames: Math.round(args.durationSec * 30),
      sha256: String(n).padStart(64, "0"), sourceVideoUrl: args.sourceUrl, startSec: args.startSec, recipe: PREVIEW_CLIP_RECIPE,
      ...(args.faceMask ? { faceMask: { url: `https://cdn.test/trends/${trendId}/preview-mask-${n}.mp4`, frames: Math.round(args.durationSec * 30), sha256: String(n).padStart(64, "1"), sourceMaskUrl: args.faceMask.url } } : {}),
      madeAt: "2026-10-27T12:00:00.000Z",
    }
  }
  const ensurePreviewClip: typeof actual.ensurePreviewClip = async (trendId, data, opts = {}) => {
    const state = previewClipState(data)
    if (state.kind === "not_offered") return withoutPreviewClip(data)
    if (state.kind === "current") return data
    if (opts.reuse && previewClipState({ ...data, previewClip: opts.reuse }).kind === "current") return { ...data, previewClip: opts.reuse }
    const mask = storedFaceMaskFor(data)
    const previewClip = await makePreviewClip(trendId, {
      sourceUrl: data.source!.videoUrl, startSec: data.previewStart!, durationSec: previewClipDurationSec(data.source!.durationSec, data.previewStart!),
      ...(mask ? { faceMask: { url: mask.url } } : {}),
    })
    return { ...data, previewClip }
  }
  return { ...actual, makePreviewClip, ensurePreviewClip }
})

vi.mock("../../../lib/admin-check.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/admin-check.js")>()
  return { ...actual, checkIsAdmin: async (userId: string) => mem.admins.has(userId) }
})

vi.mock("../../lib/trends/media.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/trends/media.js")>()
  return {
    ...actual,
    storeUpscaledVideo: async (trendId: string, args: { upscaledUrl: string; originalUrl: string; durationSec: number; asSource: boolean; resolution: "720p" | "1080p"; shownAs?: { width: number; height: number } }) => {
      mem.stored.push({ trendId, ...args })
      const hook = mem.onStore
      mem.onStore = null
      hook?.()
      if (mem.storeFails) throw mem.storeFails
      const n = mem.stored.length
      // Stored at its target, portrait.
      const [width, height] = args.resolution === "720p" ? [720, 1280] : [1080, 1920]
      return args.asSource
        ? {
            url: `https://cdn.test/trends/${trendId}/up-src-${n}.mp4`,
            width,
            height,
            durationSec: 11.96,
            sha256: "d".repeat(64),
            display: { videoUrl: `https://cdn.test/trends/${trendId}/up-display-${n}.mp4`, posterUrl: `https://cdn.test/trends/${trendId}/up-display-${n}.png`, width, height, durationSec: 11.96 },
          }
        : { url: `https://cdn.test/trends/${trendId}/up-ex-${n}.mp4`, posterUrl: `https://cdn.test/trends/${trendId}/up-ex-${n}.png`, width, height, durationSec: 10 }
    },
  }
})

import { adminTrendsRoutes } from "../admin-trends.js"
import { _settledUpscaleAppliesForTests } from "../admin-trends-upscale.js"
import { _resetPluginSupportsForTests } from "../../../lib/private-plugins/supports-registry.js"
import { TrendMediaError } from "../../lib/trends/media.js"
import { faceMaskSettingsKey } from "../../lib/trends/face-mask.js"
import { VIDEO_MASK_RECIPE } from "@nodaro/shared/media"

// ── fixtures ───────────────────────────────────────────────────────────────

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const ADMIN2 = "00000000-0000-4000-8000-0000000000ae"
const USER = "00000000-0000-4000-8000-000000000001"
const SECRET = "0".repeat(64) // src/test/setup.ts
const T1 = "00000000-0000-4000-8000-0000000000a1"
const UP_JOB = "00000000-0000-4000-8000-0000000000d1"
const SRC = `https://cdn.test/trends/${T1}/src.mp4`
const UPSCALED = "https://cdn.test/jobs/up/upscaled.mp4"

const ex = (n: number, over: Partial<TrendExample> = {}): TrendExample => ({
  videoUrl: `https://cdn.test/trends/${T1}/ex${n}.mp4`,
  posterUrl: `https://cdn.test/trends/${T1}/ex${n}.png`,
  width: 720,
  height: 1280,
  durationSec: 10,
  slots: { lead: [`https://cdn.test/trends/${T1}/ex${n}-lead.png`] },
  sourceJobId: `00000000-0000-4000-8000-0000000000b${n}`,
  ...over,
})

const DISPLAY = { videoUrl: `https://cdn.test/trends/${T1}/display.mp4`, posterUrl: `https://cdn.test/trends/${T1}/display.png`, width: 720, height: 1280, durationSec: 12 }

function draftData(over: Partial<TrendVersionData> = {}): TrendVersionData {
  return {
    name: { en: "Neon Dance" },
    source: { videoUrl: SRC, durationSec: 12, width: 720, height: 1280, display: DISPLAY },
    previewStart: 8,
    slots: [{ key: "lead", label: { en: "Lead dancer" }, kind: "person", required: true, roleName: "the woman on the left" }],
    references: [],
    examples: [ex(1), ex(2)],
    ...over,
  }
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

const pending = (over: Partial<TrendUpscaleJob> = {}): TrendUpscaleJob => ({
  jobId: UP_JOB,
  target: "example",
  fromUrl: ex(2).videoUrl,
  startedAt: "2026-10-25T09:00:00.000Z",
  ...over,
})

/** The admin's finished Topaz job of `videoUrl`. */
function upJob(videoUrl: string, over: Record<string, unknown> = {}, input: Record<string, unknown> = {}) {
  return {
    id: UP_JOB,
    user_id: ADMIN,
    status: "completed",
    should_watermark: false,
    input_data: { type: "video-upscale", videoUrl, upscaleFactor: "2", provider: "topaz", ...input },
    output_data: { videoUrl: UPSCALED, thumbnailUrl: "https://cdn.test/jobs/up/thumb.png" },
    ...over,
  }
}

const world = { jobs: new Map<string, Record<string, unknown>>() }
const upscaler = {
  calls: [] as Array<{ headers: Record<string, unknown>; body: Record<string, unknown> }>,
  /** Called once while Video Upscale answers: a hook for "meanwhile, someone else wrote". */
  onCall: null as null | (() => void),
  /** When set, Video Upscale answers with this. */
  refuse: null as null | { status: number; body: unknown },
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
  if (q.table === "admin_actions") return respondAdminActions(q)
  if (q.table === "engine_environments") return { data: [], error: null }
  if (q.table === "jobs") {
    const id = q.ops.find((op) => op.m === "eq" && op.a[0] === "id")?.a[1] as string | undefined
    const user = q.ops.find((op) => op.m === "eq" && op.a[0] === "user_id")?.a[1] as string | undefined
    const row = id ? world.jobs.get(id) : undefined
    return { data: row && (user === undefined || row.user_id === user) ? row : null, error: null }
  }
  return { data: null, error: null }
}

let app: FastifyInstance

beforeEach(async () => {
  db.log.length = 0
  db.respond = respond
  mem.revs = 0
  mem.trends = []
  mem.clips = []
  mem.clipFails = null
  mem.admins = new Set([ADMIN, ADMIN2])
  mem.conflictSaves = 0
  mem.saveFails = null
  mem.stored = []
  mem.onStore = null
  mem.storeFails = null
  world.jobs = new Map()
  upscaler.calls = []
  upscaler.onCall = null
  upscaler.refuse = null
  _resetPluginSupportsForTests()

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
  // The core route, as the trend route reaches it: injected as the admin.
  app.post("/v1/video-upscale", async (req, reply) => {
    if (req.authKind !== "internal") return reply.status(403).send({ error: { code: "forbidden", message: "Internal only" } })
    upscaler.calls.push({ headers: { ...req.headers }, body: req.body as Record<string, unknown> })
    const hook = upscaler.onCall
    upscaler.onCall = null
    hook?.()
    if (upscaler.refuse) return reply.status(upscaler.refuse.status).send(upscaler.refuse.body)
    return { jobId: UP_JOB }
  })
  await app.register(adminTrendsRoutes)
  await app.ready()
})

afterEach(async () => {
  await _settledUpscaleAppliesForTests()
  await app.close()
  _resetPluginSupportsForTests()
})

function call(method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown, userId = ADMIN) {
  return app.inject({ method, url, headers: { "x-user-id": userId }, ...(payload !== undefined ? { payload: payload as object } : {}) })
}

async function revisionOf(): Promise<string> {
  return (await call("GET", `/v1/admin/trends/${T1}`)).json().data.revision as string
}

const draftNow = () => mem.trends[0]!.versions[mem.trends[0]!.draftVersion]!.data
const audits = () =>
  db.log.filter((q) => q.table === "admin_actions" && q.ops.some((op) => op.m === "insert")).map((q) => q.ops.find((op) => op.m === "insert")!.a[0] as Record<string, unknown>)

async function start(body: Record<string, unknown>, userId = ADMIN) {
  return call("POST", `/v1/admin/trends/${T1}/upscale`, { revision: await revisionOf(), ...body }, userId)
}

async function apply(over: Record<string, unknown> = {}, userId = ADMIN) {
  return call("POST", `/v1/admin/trends/${T1}/upscale/apply`, { jobId: UP_JOB, revision: await revisionOf(), ...over }, userId)
}

/** "Use it", then the background work to its end. */
async function applyAndSettle(over: Record<string, unknown> = {}, userId = ADMIN) {
  const res = await apply(over, userId)
  await _settledUpscaleAppliesForTests()
  return res
}

/** The draft's record of the upscale, as the editor reads it. */
async function viewOf(jobId = UP_JOB) {
  return ((await call("GET", `/v1/admin/trends/${T1}`)).json().data.upscaleJobs as Array<Record<string, unknown>>).find((u) => u.jobId === jobId)
}

// ── starting ───────────────────────────────────────────────────────────────

describe("starting an upscale", () => {
  it("asks Video Upscale, as the admin, for Topaz at 1080p of the example's video, records the job on the draft by that video, and audits it", async () => {
    seed()
    const res = await start({ target: "example", index: 1 })
    expect(res.statusCode).toBe(202)
    const v = mem.trends[0]!.versions[1]!
    expect(res.json()).toEqual({ data: { jobId: UP_JOB, version: 1, revision: v.revision, recorded: true, draftMoved: false } })
    expect(upscaler.calls).toHaveLength(1)
    // 1080p is Topaz's short side: a portrait clip stays portrait. The frame rate is the clip's own.
    expect(upscaler.calls[0]!.body).toEqual({ videoUrl: ex(2).videoUrl, provider: "topaz", targetResolution: "1080p" })
    expect(upscaler.calls[0]!.headers["x-internal-user-id"]).toBe(ADMIN)
    // No target named: 1080p, as before the choice, and the record says so.
    expect(v.data.upscaleJobs).toEqual([{ jobId: UP_JOB, target: "example", resolution: "1080p", fromUrl: ex(2).videoUrl, startedAt: expect.any(String) }])
    expect(audits()).toEqual([
      expect.objectContaining({ admin_user_id: ADMIN, action: "upscale_trend_video", target_type: "trend", target_id: T1, payload: { slug: "neon-dance", jobId: UP_JOB, target: "example", resolution: "1080p", fromUrl: ex(2).videoUrl } }),
    ])
    const detail = (await call("GET", `/v1/admin/trends/${T1}`)).json().data
    expect(detail.upscaleJobs).toEqual([{ jobId: UP_JOB, target: "example", resolution: "1080p", fromUrl: ex(2).videoUrl, startedAt: expect.any(String), current: true, index: 1 }])
  })

  it.each([
    ["a source clip at 1080p", { target: "source" }, draftData({ source: { videoUrl: SRC, durationSec: 12, width: 1920, height: 1080, display: DISPLAY } })],
    ["a portrait example at 1080p", { target: "example", index: 0 }, draftData({ examples: [ex(1, { width: 1080, height: 1920 })] })],
  ])("enhances %s: the same Topaz ask at 1080p, at the same size", async (_what, body, data) => {
    seed({}, data as TrendVersionData)
    expect((await start(body as Record<string, unknown>)).statusCode).toBe(202)
    expect(upscaler.calls[0]!.body).toEqual(expect.objectContaining({ provider: "topaz", targetResolution: "1080p" }))
    expect(draftNow().upscaleJobs).toHaveLength(1)
  })

  it("asks Topaz for 720p when 720p is named, and records and audits that target", async () => {
    seed({}, draftData({ examples: [ex(1, { width: 540, height: 960 })] }))
    expect((await start({ target: "example", index: 0, resolution: "720p" })).statusCode).toBe(202)
    expect(upscaler.calls[0]!.body).toEqual({ videoUrl: ex(1).videoUrl, provider: "topaz", targetResolution: "720p" })
    expect(draftNow().upscaleJobs).toEqual([{ jobId: UP_JOB, target: "example", resolution: "720p", fromUrl: ex(1).videoUrl, startedAt: expect.any(String) }])
    expect(audits()).toEqual([expect.objectContaining({ action: "upscale_trend_video", payload: expect.objectContaining({ jobId: UP_JOB, resolution: "720p" }) })])
    const detail = (await call("GET", `/v1/admin/trends/${T1}`)).json().data
    expect(detail.upscaleJobs).toEqual([expect.objectContaining({ jobId: UP_JOB, resolution: "720p", current: true, index: 0 })])
  })

  it.each([
    ["a portrait example at 720p", { target: "example", index: 1, resolution: "720p" }, draftData()],
    ["a landscape source clip at 720p", { target: "source", resolution: "720p" }, draftData({ source: { videoUrl: SRC, durationSec: 12, width: 1280, height: 720, display: { ...DISPLAY, width: 1280, height: 720 } } })],
  ])("enhances %s: the same Topaz ask at 720p, at the same size (never refused as already 720p)", async (_what, body, data) => {
    seed({}, data as TrendVersionData)
    expect((await start(body as Record<string, unknown>)).statusCode).toBe(202)
    expect(upscaler.calls[0]!.body).toEqual(expect.objectContaining({ provider: "topaz", targetResolution: "720p" }))
    expect(draftNow().upscaleJobs).toEqual([expect.objectContaining({ resolution: "720p" })])
  })

  it("a 1080p clip is still offered 1080p (an enhance) when 720p is refused for it", async () => {
    seed({}, draftData({ examples: [ex(1, { width: 1080, height: 1920 })] }))
    expect((await start({ target: "example", index: 0, resolution: "720p" })).json().error.code).toBe("above_720p")
    expect((await start({ target: "example", index: 0, resolution: "1080p" })).statusCode).toBe(202)
    expect(upscaler.calls.map((c) => c.body.targetResolution)).toEqual(["1080p"])
  })

  it("upscales the source clip's uploaded video (what runs edit), not its display copy", async () => {
    seed()
    expect((await start({ target: "source" })).statusCode).toBe(202)
    expect(upscaler.calls[0]!.body.videoUrl).toBe(SRC)
    expect(draftNow().upscaleJobs).toEqual([expect.objectContaining({ target: "source", fromUrl: SRC })])
  })

  it.each([
    ["a stale revision", { target: "example", index: 0, revision: "rev-stale" }, draftData(), 409, "draft_conflict"],
    ["an example that is not there", { target: "example", index: 2 }, draftData(), 404, "not_found"],
    ["a draft with no source clip", { target: "source" }, draftData({ source: null }), 409, "source_missing"],
    ["an example above 1080p", { target: "example", index: 0 }, draftData({ examples: [ex(1, { width: 1440, height: 2560 })] }), 409, "above_1080p"],
    ["a landscape example at 4K", { target: "example", index: 0 }, draftData({ examples: [ex(1, { width: 3840, height: 2160 })] }), 409, "above_1080p"],
    ["a source above 1080p", { target: "source" }, draftData({ source: { videoUrl: SRC, durationSec: 12, width: 1440, height: 2560, display: DISPLAY } }), 409, "above_1080p"],
    ["an example above 720p asked for 720p", { target: "example", index: 0, resolution: "720p" }, draftData({ examples: [ex(1, { width: 1080, height: 1920 })] }), 409, "above_720p"],
    ["a source above 720p asked for 720p", { target: "source", resolution: "720p" }, draftData({ source: { videoUrl: SRC, durationSec: 12, width: 1920, height: 1080, display: DISPLAY } }), 409, "above_720p"],
    ["an example above 1080p asked for 720p", { target: "example", index: 0, resolution: "720p" }, draftData({ examples: [ex(1, { width: 1440, height: 2560 })] }), 409, "above_720p"],
    ["a target Topaz is not offered here (4k)", { target: "source", resolution: "4k" }, draftData(), 400, "validation_error"],
    ["a body with a stray field", { target: "source", index: 0 }, draftData(), 400, "validation_error"],
    ["an unknown target", { target: "poster" }, draftData(), 400, "validation_error"],
  ])("refuses %s before Video Upscale is asked (nothing is paid for)", async (_what, body, data, status, code) => {
    seed({}, data as TrendVersionData)
    const res = await start(body as Record<string, unknown>)
    expect(res.statusCode).toBe(status)
    expect(res.json().error.code).toBe(code)
    expect(upscaler.calls).toEqual([])
    expect(draftNow().upscaleJobs).toBeUndefined()
  })

  it("refuses, before Video Upscale is asked, a draft that could not record the job", async () => {
    seed({}, { ...draftData(), legacyField: true } as unknown as TrendVersionData)
    const res = await start({ target: "source" })
    expect(res.statusCode).toBe(400)
    expect(upscaler.calls).toEqual([])
  })

  it("passes on Video Upscale's own refusal (insufficient credits) and records nothing", async () => {
    seed()
    upscaler.refuse = { status: 402, body: { error: { code: "insufficient_credits", message: "Not enough credits" } } }
    const res = await start({ target: "example", index: 0 })
    expect(res.statusCode).toBe(402)
    expect(res.json().error.code).toBe("insufficient_credits")
    expect(draftNow().upscaleJobs).toBeUndefined()
    expect(audits()).toEqual([])
  })

  it("passes on the core route's refusal of a clip Topaz cannot take (too long) before anything is held, recording nothing", async () => {
    seed()
    upscaler.refuse = { status: 400, body: { error: { code: "video_too_long", message: "This clip is too long to upscale to 1080p at 30 fps — up to 200 seconds can be upscaled at those settings." } } }
    const res = await start({ target: "source" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatchObject({ code: "video_too_long", message: expect.stringContaining("too long to upscale") })
    expect(draftNow().upscaleJobs).toBeUndefined()
  })

  it("refuses a second upscale of a video whose upscale still runs (before paying), and allows one once it ended", async () => {
    seed({}, draftData({ upscaleJobs: [pending()] }))
    world.jobs.set(UP_JOB, upJob(ex(2).videoUrl, { status: "processing" }))
    const res = await start({ target: "example", index: 1 })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("upscale_in_progress")
    expect(upscaler.calls).toEqual([])
    // Another video is not held back by it.
    expect((await start({ target: "example", index: 0 })).statusCode).toBe(202)
    // Once that job failed, the same video may be upscaled again.
    world.jobs.set(UP_JOB, upJob(ex(2).videoUrl, { status: "failed" }))
    upscaler.calls = []
    expect((await start({ target: "example", index: 1 })).statusCode).toBe(202)
    expect(upscaler.calls).toHaveLength(1)
  })

  it("refuses an upscale of a video whose last one is being put in the draft", async () => {
    seed({}, draftData({ upscaleJobs: [pending({ applying: { startedAt: new Date().toISOString(), by: ADMIN } })] }))
    world.jobs.set(UP_JOB, upJob(ex(2).videoUrl))
    const res = await start({ target: "example", index: 1 })
    expect(res.json().error.code).toBe("apply_in_progress")
    expect(upscaler.calls).toEqual([])
  })

  it("a database failure after the job was paid for still answers 202 with the job id (recorded: false)", async () => {
    seed()
    mem.saveFails = new Error("connection reset")
    const res = await start({ target: "example", index: 0 })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ data: { jobId: UP_JOB, recorded: false, draftMoved: true } })
    expect(upscaler.calls).toHaveLength(1)
  })

  it("still records the paid job when another write lands meanwhile, keeping that write, and says the draft moved", async () => {
    seed()
    upscaler.onCall = () => {
      const v = mem.trends[0]!.versions[1]!
      v.revision = "rev-elsewhere"
      v.data = { ...v.data, trendPrompt: "edited elsewhere" }
    }
    const res = await start({ target: "example", index: 0 })
    expect(res.statusCode).toBe(202)
    expect(res.json().data).toMatchObject({ jobId: UP_JOB, recorded: true, draftMoved: true })
    expect(draftNow().trendPrompt).toBe("edited elsewhere")
    expect(draftNow().upscaleJobs).toEqual([expect.objectContaining({ jobId: UP_JOB, fromUrl: ex(1).videoUrl })])
  })

  it("a newer upscale of the same video replaces the older record; another video's stays", async () => {
    seed({}, draftData({ upscaleJobs: [pending({ jobId: "00000000-0000-4000-8000-0000000000d0" }), pending({ jobId: "00000000-0000-4000-8000-0000000000d9", target: "source", fromUrl: SRC })] }))
    expect((await start({ target: "example", index: 1 })).statusCode).toBe(202)
    expect(draftNow().upscaleJobs!.map((j) => j.jobId)).toEqual(["00000000-0000-4000-8000-0000000000d9", UP_JOB])
  })

  it("when the job can never be recorded, says so, and it is still applicable from its audited start (the caller's only)", async () => {
    seed()
    const revision = await revisionOf()
    mem.conflictSaves = 100
    const res = await call("POST", `/v1/admin/trends/${T1}/upscale`, { target: "example", index: 1, revision })
    expect(res.json()).toEqual({ data: { jobId: UP_JOB, recorded: false, draftMoved: true } })
    expect(mem.conflictSaves).toBe(100 - 6)
    mem.conflictSaves = 0
    world.jobs.set(UP_JOB, upJob(ex(2).videoUrl))
    const other = await apply({}, ADMIN2)
    expect(other.json().error.code).toBe("not_pending_upscale")
    const applied = await applyAndSettle()
    expect(applied.statusCode).toBe(202)
    expect(draftNow().examples[1]!.videoUrl).toMatch(/up-ex-1\.mp4$/)
    expect(draftNow()).not.toHaveProperty("upscaleJobs")
  })
})

// ── applying ───────────────────────────────────────────────────────────────

describe("using an upscale", () => {
  it("answers 202 at once with the record marked applying, then (in the background) puts the example's 1080p video, a fresh poster, its size and length in; pictures and run kept; the record cleared; audited", async () => {
    seed({}, draftData({ upscaleJobs: [pending()] }))
    world.jobs.set(UP_JOB, upJob(ex(2).videoUrl))
    mem.onStore = () => {
      // While the resize runs, the record reads as applying, and the example is still the old one.
      const d = mem.trends[0]!.versions[1]!.data
      expect(d.upscaleJobs).toEqual([{ ...pending(), resolution: "1080p", applying: { startedAt: expect.any(String), by: ADMIN } }])
      expect(d.examples[1]).toEqual(ex(2))
    }
    const res = await apply()
    expect(res.statusCode).toBe(202)
    expect(res.json().data).toMatchObject({ jobId: UP_JOB, applying: true, revision: expect.any(String), upscaleJobs: [expect.objectContaining({ jobId: UP_JOB, applying: { startedAt: expect.any(String), stale: false } })] })
    await _settledUpscaleAppliesForTests()
    expect(mem.stored).toEqual([{ trendId: T1, upscaledUrl: UPSCALED, originalUrl: ex(2).videoUrl, durationSec: 10, asSource: false, resolution: "1080p", shownAs: { width: 720, height: 1280 } }])
    const d = draftNow()
    expect(d.examples[0]).toEqual(ex(1))
    expect(d.examples[1]).toEqual({
      ...ex(2),
      videoUrl: `https://cdn.test/trends/${T1}/up-ex-1.mp4`,
      posterUrl: `https://cdn.test/trends/${T1}/up-ex-1.png`,
      width: 1080,
      height: 1920,
      durationSec: 10,
    })
    expect(d).not.toHaveProperty("upscaleJobs")
    expect(audits()).toEqual([
      expect.objectContaining({ action: "apply_trend_upscale", target_id: T1, payload: expect.objectContaining({ jobId: UP_JOB, target: "example", fromUrl: ex(2).videoUrl, width: 1080, height: 1920 }) }),
    ])
  })

  it("an example's upscale cuts no preview clip (the source did not change), and keeps a current one", async () => {
    const CLIP = {
      videoUrl: `https://cdn.test/trends/${T1}/preview.mp4`, durationSec: 4, width: 720, height: 1280, frames: 120, sha256: "b".repeat(64),
      sourceVideoUrl: SRC, startSec: 8, recipe: "1", madeAt: "2026-10-27T10:00:00.000Z",
    }
    seed({}, draftData({ upscaleJobs: [pending()], previewClip: CLIP }))
    world.jobs.set(UP_JOB, upJob(ex(2).videoUrl))
    expect((await applyAndSettle()).statusCode).toBe(202)
    expect(mem.clips).toEqual([])
    expect(draftNow().previewClip).toEqual(CLIP)
    expect(draftNow().examples[1]!.width).toBe(1080)
  })

  it("a source upscale whose stale preview clip survives in the draft (a save that forgot) is still replaced: a new clip never keeps the old one's cut", async () => {
    const stale = {
      videoUrl: `https://cdn.test/trends/${T1}/preview-old.mp4`, durationSec: 4, width: 720, height: 1280, frames: 120, sha256: "b".repeat(64),
      sourceVideoUrl: SRC, startSec: 8, recipe: "1", madeAt: "2026-10-27T10:00:00.000Z",
    }
    seed({}, draftData({ upscaleJobs: [pending({ target: "source", fromUrl: SRC })], previewClip: stale }))
    world.jobs.set(UP_JOB, upJob(SRC))
    expect((await applyAndSettle()).statusCode).toBe(202)
    expect(mem.clips).toHaveLength(1)
    expect(draftNow().previewClip!.videoUrl).not.toBe(stale.videoUrl)
    expect(draftNow().previewClip!.sourceVideoUrl).toBe(`https://cdn.test/trends/${T1}/up-src-1.mp4`)
  })

  it("a cut that fails after the resize is written on the record as its error (the draft untouched), and a retry after a lost race re-uses the clip cut once", async () => {
    seed({}, draftData({ upscaleJobs: [pending({ target: "source", fromUrl: SRC })] }))
    world.jobs.set(UP_JOB, upJob(SRC))
    mem.clipFails = new TrendMediaError("media_unreadable", "Could not cut the preview's input clip from the source clip.")
    expect((await applyAndSettle()).statusCode).toBe(202)
    expect(draftNow().source!.videoUrl).toBe(SRC)
    expect(draftNow().upscaleJobs![0]!.error).toMatchObject({ code: "media_unreadable" })
    expect(draftNow().upscaleJobs![0]).not.toHaveProperty("applying")

    // Tried again, with another write landing while the resize ran (the first put-in loses): one cut, re-used.
    mem.trends = []
    mem.clips = []
    mem.stored = []
    seed({}, draftData({ upscaleJobs: [pending({ target: "source", fromUrl: SRC })] }))
    // Once the record is marked and the resize runs: the first put-in's save loses (a write landed under it).
    mem.onStore = () => {
      mem.conflictSaves = 1
    }
    expect((await applyAndSettle()).statusCode).toBe(202)
    expect(draftNow().source!.videoUrl).toBe(`https://cdn.test/trends/${T1}/up-src-1.mp4`)
    expect(mem.clips).toHaveLength(1)
    expect(draftNow().previewClip).toMatchObject({ videoUrl: `https://cdn.test/trends/${T1}/preview-1.mp4`, sourceVideoUrl: `https://cdn.test/trends/${T1}/up-src-1.mp4` })
  })

  it("follows its example through a reorder made after it started", async () => {
    seed({}, draftData({ examples: [ex(2), ex(1)], upscaleJobs: [pending()] }))
    world.jobs.set(UP_JOB, upJob(ex(2).videoUrl))
    expect((await applyAndSettle()).statusCode).toBe(202)
    expect(draftNow().examples[0]!.videoUrl).toMatch(/up-ex-1\.mp4$/)
    expect(draftNow().examples[1]).toEqual(ex(1))
  })

  it("the source: replaced as a new source clip is (its display copy, size and length), the preview kept inside it, a stored face mask now out of date", async () => {
    const MASKING = { mode: "always" as const, threshold: 0.4 }
    const before = draftData({ faceMasking: MASKING })
    const faceMask = {
      url: `https://cdn.test/trends/${T1}/mask.mp4`, frames: 288, recipe: { core: VIDEO_MASK_RECIPE, plugin: "1" },
      settingsKey: faceMaskSettingsKey(before)!, jobId: "00000000-0000-4000-8000-0000000000f1",
      stats: { shots: 1, heldFrames: 0, coverage: 0.02, droppedRegions: 0 }, approvedAt: "2026-10-25T08:00:00Z", approvedBy: ADMIN,
    }
    seed({}, { ...before, faceMask, upscaleJobs: [pending({ target: "source", fromUrl: SRC })] })
    world.jobs.set(UP_JOB, upJob(SRC))
    expect((await applyAndSettle()).statusCode).toBe(202)
    // Its orientation is checked against the display copy's (the rotation applied), not the upload's raw size.
    expect(mem.stored).toEqual([{ trendId: T1, upscaledUrl: UPSCALED, originalUrl: SRC, durationSec: 12, asSource: true, resolution: "1080p", shownAs: { width: 720, height: 1280 } }])
    const d = draftNow()
    expect(d.source).toEqual({
      videoUrl: `https://cdn.test/trends/${T1}/up-src-1.mp4`,
      durationSec: 11.96,
      width: 1080,
      height: 1920,
      display: { videoUrl: `https://cdn.test/trends/${T1}/up-display-1.mp4`, posterUrl: `https://cdn.test/trends/${T1}/up-display-1.png`, width: 1080, height: 1920, durationSec: 11.96 },
      // The stored clip's hash, recorded for a full run's provenance.
      sha256: "d".repeat(64),
    })
    // 8 + 4 s no longer fits 11.96 s: the preview moved to the latest start that does.
    expect(d.previewStart).toBeCloseTo(7.96)
    expect(d.examples).toEqual(draftData().examples)
    // The mask stays stored, out of date by design (it names the old clip).
    expect(d.faceMask).toEqual(faceMask)
    // The preview input clip is cut again from the NEW clip at the kept start — without the (now stale) mask's cut.
    expect(mem.clips).toEqual([{ trendId: T1, sourceUrl: `https://cdn.test/trends/${T1}/up-src-1.mp4`, startSec: d.previewStart, durationSec: 4 }])
    expect(d.previewClip).toMatchObject({ sourceVideoUrl: `https://cdn.test/trends/${T1}/up-src-1.mp4`, startSec: d.previewStart, recipe: "1" })
    expect(d.previewClip).not.toHaveProperty("faceMask")
    const detail = (await call("GET", `/v1/admin/trends/${T1}`)).json().data
    expect(detail.faceMaskState).toEqual({ status: "out_of_date", reasons: [{ why: "settings" }] })
  })

  it("the source upscaled to 1080p keeps the face mask's marks: the same clip, the same frames and picture", async () => {
    const MARK = { label: "erased" as const, fromFrame: 0, toFrame: 99, leftPct: 10, topPct: 10, rightPct: 40, bottomPct: 40 }
    seed({}, { ...draftData({ faceMasking: { mode: "always", marks: [MARK] } }), upscaleJobs: [pending({ target: "source", fromUrl: SRC })] })
    world.jobs.set(UP_JOB, upJob(SRC))
    expect((await applyAndSettle()).statusCode).toBe(202)
    const d = draftNow()
    expect(d.source!.videoUrl).toBe(`https://cdn.test/trends/${T1}/up-src-1.mp4`)
    expect(d.faceMasking).toEqual({ mode: "always", marks: [MARK] })
  })

  it("on a published trend, writes a new draft version and leaves the published one as it was", async () => {
    const data = draftData({ upscaleJobs: [pending()] })
    seed({ status: "published", publishedVersion: 1 }, data)
    mem.trends[0]!.versions[1]!.published = true
    world.jobs.set(UP_JOB, upJob(ex(2).videoUrl))
    expect((await applyAndSettle()).statusCode).toBe(202)
    expect(mem.trends[0]!.draftVersion).toBe(2)
    expect(mem.trends[0]!.versions[1]!.data).toEqual(data)
    expect(mem.trends[0]!.versions[2]!.data.examples[1]!.width).toBe(1080)
  })

  it("keeps a write that landed while the resize ran", async () => {
    seed({}, draftData({ upscaleJobs: [pending()] }))
    world.jobs.set(UP_JOB, upJob(ex(2).videoUrl))
    mem.onStore = () => {
      const v = mem.trends[0]!.versions[1]!
      v.revision = "rev-elsewhere"
      v.data = { ...v.data, trendPrompt: "edited meanwhile", examples: [ex(2), ex(1)] }
    }
    await applyAndSettle()
    expect(draftNow().trendPrompt).toBe("edited meanwhile")
    expect(draftNow().examples[0]!.width).toBe(1080)
    expect(draftNow().examples[1]).toEqual(ex(1))
    expect(draftNow()).not.toHaveProperty("upscaleJobs")
  })

  it("writes upscale_target_changed on the record when the example was removed while the resize ran", async () => {
    seed({}, draftData({ upscaleJobs: [pending()] }))
    world.jobs.set(UP_JOB, upJob(ex(2).videoUrl))
    mem.onStore = () => {
      const v = mem.trends[0]!.versions[1]!
      v.revision = "rev-elsewhere"
      v.data = { ...v.data, examples: [ex(1)] }
    }
    expect((await applyAndSettle()).statusCode).toBe(202)
    expect(draftNow().examples).toEqual([ex(1)])
    expect(await viewOf()).toMatchObject({ current: false, error: { code: "upscale_target_changed" } })
    expect(await viewOf()).not.toHaveProperty("applying")
  })

  it("a video that cannot be resized, or a stopped ffmpeg, is written on the record as its error; the draft is untouched, and Use it may be tried again", async () => {
    seed({}, draftData({ upscaleJobs: [pending()] }))
    world.jobs.set(UP_JOB, upJob(ex(2).videoUrl))
    mem.storeFails = new TrendMediaError("media_unreadable", "Could not resize the upscaled video to 1080p.")
    expect((await applyAndSettle()).statusCode).toBe(202)
    expect(await viewOf()).toMatchObject({ current: true, error: { code: "media_unreadable", message: "Could not resize the upscaled video to 1080p." } })
    expect(await viewOf()).not.toHaveProperty("applying")
    expect(draftNow().examples).toEqual(draftData().examples)
    expect(audits().map((a) => a.action)).toEqual(["apply_trend_upscale_failed"])

    mem.storeFails = Object.assign(new Error("ffmpeg failed: killed"), { killed: true, timedOut: true })
    expect((await applyAndSettle()).statusCode).toBe(202)
    expect(await viewOf()).toMatchObject({ error: { code: "media_busy" } })

    // The next try clears the error, and works.
    mem.storeFails = null
    expect((await applyAndSettle()).statusCode).toBe(202)
    expect(draftNow()).not.toHaveProperty("upscaleJobs")
    expect(draftNow().examples[1]!.width).toBe(1080)
  })

  it("a second Use it while one runs is 409 apply_in_progress; one stale past 15 minutes (a restart) may be tried again", async () => {
    const fresh = { startedAt: new Date(Date.now() - 60_000).toISOString(), by: ADMIN }
    seed({}, draftData({ upscaleJobs: [pending({ applying: fresh })] }))
    world.jobs.set(UP_JOB, upJob(ex(2).videoUrl))
    expect(await viewOf()).toMatchObject({ applying: { stale: false } })
    const res = await apply()
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("apply_in_progress")
    expect(mem.stored).toEqual([])
    // Discarding it meanwhile is refused too.
    expect((await call("DELETE", `/v1/admin/trends/${T1}/upscale/${UP_JOB}?revision=${await revisionOf()}`)).json().error.code).toBe("apply_in_progress")

    mem.trends = []
    seed({}, draftData({ upscaleJobs: [pending({ applying: { startedAt: new Date(Date.now() - 16 * 60_000).toISOString(), by: ADMIN } })] }))
    expect(await viewOf()).toMatchObject({ applying: { stale: true } })
    expect((await applyAndSettle()).statusCode).toBe(202)
    expect(draftNow().examples[1]!.width).toBe(1080)
  })

  it("a run whose mark was taken over by a retry does not write its result", async () => {
    seed({}, draftData({ upscaleJobs: [pending()] }))
    world.jobs.set(UP_JOB, upJob(ex(2).videoUrl))
    mem.onStore = () => {
      // Meanwhile (this run gone stale), another try took the record over.
      const v = mem.trends[0]!.versions[1]!
      v.revision = "rev-elsewhere"
      v.data = { ...v.data, upscaleJobs: [pending({ applying: { startedAt: "2026-10-25T23:59:00.000Z", by: ADMIN2 } })] }
    }
    await applyAndSettle()
    expect(draftNow().examples).toEqual(draftData().examples)
    expect(draftNow().upscaleJobs).toEqual([pending({ applying: { startedAt: "2026-10-25T23:59:00.000Z", by: ADMIN2 } })])
  })

  it("one applied already (a late second click) reports success, not upscale_target_changed", async () => {
    seed()
    expect((await start({ target: "example", index: 1 })).statusCode).toBe(202)
    world.jobs.set(UP_JOB, upJob(ex(2).videoUrl))
    await applyAndSettle()
    expect(draftNow()).not.toHaveProperty("upscaleJobs")
    const again = await apply()
    expect(again.statusCode).toBe(200)
    expect(again.json().data).toMatchObject({ applied: true, target: "example", index: 1, revision: mem.trends[0]!.versions[1]!.revision })
    // Another job whose video is gone is still refused.
    const ANOTHER = "00000000-0000-4000-8000-0000000000d5"
    db.log.push({ table: "admin_actions", ops: [{ m: "insert", a: [{ admin_user_id: ADMIN, action: "upscale_trend_video", target_type: "trend", target_id: T1, payload: { slug: "neon-dance", jobId: ANOTHER, target: "example", fromUrl: ex(2).videoUrl } }] }] } as unknown as RecordedQuery)
    expect((await apply({ jobId: ANOTHER })).json().error.code).toBe("upscale_target_changed")
  })

  it.each([
    ["a job that is not the draft's pending one", draftData({ upscaleJobs: [pending({ jobId: "00000000-0000-4000-8000-0000000000d7" })] }), upJob(ex(2).videoUrl), 409, "not_pending_upscale"],
    ["a draft with no pending upscale", draftData(), upJob(ex(2).videoUrl), 409, "not_pending_upscale"],
    ["an example whose video was replaced since", draftData({ examples: [ex(1), ex(2, { videoUrl: `https://cdn.test/trends/${T1}/other.mp4` })], upscaleJobs: [pending()] }), upJob(ex(2).videoUrl), 409, "upscale_target_changed"],
    ["an example removed since", draftData({ examples: [ex(1)], upscaleJobs: [pending()] }), upJob(ex(2).videoUrl), 409, "upscale_target_changed"],
    ["a source clip replaced since", draftData({ upscaleJobs: [pending({ target: "source", fromUrl: `https://cdn.test/trends/${T1}/old-src.mp4` })] }), upJob(`https://cdn.test/trends/${T1}/old-src.mp4`), 409, "upscale_target_changed"],
    ["another user's job", draftData({ upscaleJobs: [pending()] }), upJob(ex(2).videoUrl, { user_id: ADMIN2 }), 404, "not_found"],
    ["a job of another type", draftData({ upscaleJobs: [pending()] }), upJob(ex(2).videoUrl, {}, { type: "video-mask" }), 409, "not_an_upscale"],
    ["an upscale by another provider", draftData({ upscaleJobs: [pending()] }), upJob(ex(2).videoUrl, {}, { provider: "veo-1080p" }), 409, "not_an_upscale"],
    ["an upscale of another video", draftData({ upscaleJobs: [pending()] }), upJob(ex(1).videoUrl), 409, "not_an_upscale"],
    ["a job still running", draftData({ upscaleJobs: [pending()] }), upJob(ex(2).videoUrl, { status: "processing" }), 409, "not_completed"],
    ["a watermarked upscale", draftData({ upscaleJobs: [pending()] }), upJob(ex(2).videoUrl, { should_watermark: true }), 409, "watermarked"],
    ["a job with no video", draftData({ upscaleJobs: [pending()] }), upJob(ex(2).videoUrl, { output_data: {} }), 409, "no_video"],
  ])("refuses %s, storing nothing", async (_what, data, job, status, code) => {
    seed({}, data as TrendVersionData)
    world.jobs.set(UP_JOB, job as Record<string, unknown>)
    const res = await applyAndSettle()
    expect(res.statusCode).toBe(status)
    expect(res.json().error.code).toBe(code)
    expect(mem.stored).toEqual([])
    expect(draftNow()).toEqual(data)
  })

  it("a 720p upscale is stored at 720p: the example takes the 720p video and its size; audited with its target", async () => {
    seed({}, draftData({ upscaleJobs: [pending({ resolution: "720p" })] }))
    world.jobs.set(UP_JOB, upJob(ex(2).videoUrl, {}, { targetResolution: "720p" }))
    expect((await applyAndSettle()).statusCode).toBe(202)
    expect(mem.stored).toEqual([expect.objectContaining({ asSource: false, resolution: "720p" })])
    expect(draftNow().examples[1]).toMatchObject({ videoUrl: `https://cdn.test/trends/${T1}/up-ex-1.mp4`, width: 720, height: 1280 })
    expect(draftNow()).not.toHaveProperty("upscaleJobs")
    expect(audits()).toEqual([expect.objectContaining({ action: "apply_trend_upscale", payload: expect.objectContaining({ resolution: "720p", width: 720, height: 1280 }) })])
  })

  it("a 720p source upscale replaces the source at 720p, and the preview's input clip is cut again from it", async () => {
    seed({}, draftData({ upscaleJobs: [pending({ target: "source", fromUrl: SRC, resolution: "720p" })] }))
    world.jobs.set(UP_JOB, upJob(SRC, {}, { targetResolution: "720p" }))
    expect((await applyAndSettle()).statusCode).toBe(202)
    expect(mem.stored).toEqual([expect.objectContaining({ asSource: true, resolution: "720p" })])
    const d = draftNow()
    expect(d.source).toMatchObject({ videoUrl: `https://cdn.test/trends/${T1}/up-src-1.mp4`, width: 720, height: 1280 })
    expect(mem.clips).toEqual([{ trendId: T1, sourceUrl: `https://cdn.test/trends/${T1}/up-src-1.mp4`, startSec: d.previewStart, durationSec: 4 }])
    expect(d.previewClip).toMatchObject({ sourceVideoUrl: `https://cdn.test/trends/${T1}/up-src-1.mp4` })
  })

  it("stores at the target the JOB was made at (what Topaz was asked), over a record that says otherwise", async () => {
    seed({}, draftData({ upscaleJobs: [pending()] }))
    world.jobs.set(UP_JOB, upJob(ex(2).videoUrl, {}, { targetResolution: "720p" }))
    expect((await applyAndSettle()).statusCode).toBe(202)
    expect(mem.stored).toEqual([expect.objectContaining({ resolution: "720p" })])
  })

  it("an audited start that never got recorded is applied at the target it was asked for", async () => {
    seed({}, draftData({ examples: [ex(1, { width: 540, height: 960 }), ex(2)] }))
    mem.conflictSaves = 100
    const started = await start({ target: "example", index: 0, resolution: "720p" })
    expect(started.json().data).toMatchObject({ jobId: UP_JOB, recorded: false })
    mem.conflictSaves = 0
    // The job carries no target of its own here: the audited start's is read.
    world.jobs.set(UP_JOB, upJob(ex(1).videoUrl))
    expect((await applyAndSettle()).statusCode).toBe(202)
    expect(mem.stored).toEqual([expect.objectContaining({ originalUrl: ex(1).videoUrl, resolution: "720p" })])
  })

  it("refuses a Topaz job made at a target this route does not store (4k), storing nothing", async () => {
    seed({}, draftData({ upscaleJobs: [pending()] }))
    world.jobs.set(UP_JOB, upJob(ex(2).videoUrl, {}, { targetResolution: "4k" }))
    const res = await applyAndSettle()
    expect(res.json().error.code).toBe("not_an_upscale")
    expect(mem.stored).toEqual([])
  })

  it("refuses a stale revision with draft_conflict before reading the job", async () => {
    seed({}, draftData({ upscaleJobs: [pending()] }))
    world.jobs.set(UP_JOB, upJob(ex(2).videoUrl))
    const res = await apply({ revision: "rev-stale" })
    expect(res.json().error.code).toBe("draft_conflict")
    expect(mem.stored).toEqual([])
    expect(db.log.some((q) => q.table === "jobs")).toBe(false)
  })
})

// ── discarding, and the draft's own saves ──────────────────────────────────

describe("discarding an upscale, and saving the draft", () => {
  it("discarding removes the record only, guarded on the revision, and is audited", async () => {
    seed({}, draftData({ upscaleJobs: [pending()] }))
    expect((await call("DELETE", `/v1/admin/trends/${T1}/upscale/${UP_JOB}?revision=rev-stale`)).json().error.code).toBe("draft_conflict")
    const res = await call("DELETE", `/v1/admin/trends/${T1}/upscale/${UP_JOB}?revision=${await revisionOf()}`)
    expect(res.statusCode).toBe(200)
    expect(res.json().data.upscaleJobs).toEqual([])
    expect(draftNow()).not.toHaveProperty("upscaleJobs")
    expect(draftNow().examples).toEqual(draftData().examples)
    expect(audits().map((a) => a.action)).toEqual(["discard_trend_upscale"])
    // Discarding one that is not there changes nothing.
    const again = await call("DELETE", `/v1/admin/trends/${T1}/upscale/${UP_JOB}?revision=${await revisionOf()}`)
    expect(again.statusCode).toBe(200)
    expect(audits()).toHaveLength(1)
  })

  it("a draft save keeps the records and ignores ones sent in the body", async () => {
    seed({}, draftData({ upscaleJobs: [pending()] }))
    const { upscaleJobs: _u, ...edited } = draftData({ trendPrompt: "edited" })
    let res = await call("PUT", `/v1/admin/trends/${T1}/draft`, { data: edited, revision: await revisionOf() })
    expect(res.statusCode).toBe(200)
    expect(draftNow().upscaleJobs).toEqual([pending()])
    res = await call("PUT", `/v1/admin/trends/${T1}/draft`, {
      data: { ...edited, upscaleJobs: [pending({ jobId: "00000000-0000-4000-8000-0000000000d7" })] },
      revision: await revisionOf(),
    })
    expect(res.statusCode).toBe(200)
    expect(draftNow().upscaleJobs).toEqual([pending()])
  })

  it("a record whose video the admin replaced reads as not current", async () => {
    seed({}, draftData({ upscaleJobs: [pending({ target: "source", fromUrl: `https://cdn.test/trends/${T1}/old-src.mp4` })] }))
    expect((await call("GET", `/v1/admin/trends/${T1}`)).json().data.upscaleJobs).toEqual([expect.objectContaining({ target: "source", current: false })])
  })
})

describe("access", () => {
  it("every upscale route is 401 without a user and 403 for a non-admin, and does nothing", async () => {
    seed({}, draftData({ upscaleJobs: [pending()] }))
    world.jobs.set(UP_JOB, upJob(ex(2).videoUrl))
    const routes: Array<["POST" | "DELETE", string, unknown?]> = [
      ["POST", `/v1/admin/trends/${T1}/upscale`, { target: "source", revision: "rev-1" }],
      ["POST", `/v1/admin/trends/${T1}/upscale/apply`, { jobId: UP_JOB, revision: "rev-1" }],
      ["DELETE", `/v1/admin/trends/${T1}/upscale/${UP_JOB}?revision=rev-1`],
    ]
    for (const [method, url, payload] of routes) {
      const anon = await app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}) })
      expect(anon.statusCode, `${method} ${url} anon`).toBe(401)
      expect((await call(method, url, payload, USER)).statusCode, `${method} ${url} user`).toBe(403)
    }
    expect(upscaler.calls).toEqual([])
    expect(mem.stored).toEqual([])
    expect(draftNow()).toEqual(draftData({ upscaleJobs: [pending()] }))
  })
})
