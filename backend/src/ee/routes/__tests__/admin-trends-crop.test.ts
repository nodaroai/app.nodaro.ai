/**
 * Cropping a trend's source clip to 16:9 or 9:16 (ee/routes/admin-trends-crop.ts).
 *
 * What must hold:
 *  - starting takes only the crop that trims (16:9 for a clip wider than 16:9,
 *    9:16 for one taller than 9:16, judged on the clip as shown), of the
 *    SAVED source; it marks the draft (`sourceCrop`, with the position,
 *    centered by default), audits it, answers 202 at once and works in the
 *    background: the source is replaced as a new clip is (its display copy,
 *    the preview kept inside it) and the record is cleared;
 *  - a stale revision, no source, a crop that would not trim and a second
 *    start while one runs are refused; a stale run may be started again;
 *  - a failure, and a source replaced meanwhile, are written on the record
 *    as its `error`; another write that landed meanwhile is kept;
 *  - dismissing removes a failed record; a draft save keeps the record;
 *  - every route is admin-only.
 *
 * The store is an in-memory stand-in honouring the store's contract (as in
 * admin-trends-upscale.test.ts); audit rows go through the recording fake
 * Supabase; the crop itself (`storeCroppedSource`, pinned in
 * lib/trends/__tests__/crop-media.e2e.test.ts) is stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { type QueryResult, type RecordedQuery } from "../../../lib/__tests__/fake-supabase-query.js"
import type { TrendRow, TrendSourceCrop, TrendVersionData } from "../../lib/trends/types.js"

const db = vi.hoisted(() => ({ log: [] as Array<{ table: string; ops: Array<{ m: string; a: unknown[] }> }> }))

vi.mock("../../../lib/supabase.js", async () => {
  const { makeFakeFrom } = await import("../../../lib/__tests__/fake-supabase-query.js")
  return { supabase: { from: makeFakeFrom(db.log as RecordedQuery[], (q: RecordedQuery): QueryResult => (q.table === "engine_environments" ? { data: [], error: null } : { data: null, error: null })) } }
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
  /** Every `storeCroppedSource` call. */
  cropped: [] as Array<{ trendId: string; sourceUrl: string; aspect: string; position: number }>,
  /** Called while the crop runs: a hook for "meanwhile, someone else wrote". */
  onCrop: null as null | (() => void),
  cropFails: null as null | Error,
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
      const t = mem.trends.find((x) => x.id === id)
      if (!t) throw new actual.TrendNotFoundError(id)
      const cur = t.versions[t.draftVersion]!
      if (opts.expectedRevision !== undefined && rev(cur) !== opts.expectedRevision) throw new actual.DraftConflictError(id)
      const revision = `rev-${++mem.revs}`
      cur.data = structuredClone(data)
      cur.revision = revision
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
    storeCroppedSource: async (trendId: string, args: { sourceUrl: string; aspect: string; position: number }) => {
      mem.cropped.push({ trendId, ...args })
      const hook = mem.onCrop
      mem.onCrop = null
      hook?.()
      if (mem.cropFails) throw mem.cropFails
      return {
        url: `https://cdn.test/trends/${trendId}/cropped.mp4`,
        width: 1920,
        height: 1080,
        durationSec: 9.5,
        sha256: "e".repeat(64),
        display: { videoUrl: `https://cdn.test/trends/${trendId}/cropped-display.mp4`, posterUrl: `https://cdn.test/trends/${trendId}/cropped-display.png`, width: 1920, height: 1080, durationSec: 9.5 },
      }
    },
  }
})

import { adminTrendsRoutes } from "../admin-trends.js"
import { _settledSourceCropsForTests } from "../admin-trends-crop.js"
import { _resetPluginSupportsForTests } from "../../../lib/private-plugins/supports-registry.js"
import { TrendMediaError } from "../../lib/trends/media.js"
import { CROP_STALE_MS } from "../../lib/trends/crop.js"

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const USER = "00000000-0000-4000-8000-000000000001"
const T1 = "00000000-0000-4000-8000-0000000000a1"
const SRC = `https://cdn.test/trends/${T1}/src.mp4`
const WIDE_DISPLAY = { videoUrl: `https://cdn.test/trends/${T1}/display.mp4`, posterUrl: `https://cdn.test/trends/${T1}/display.png`, width: 2568, height: 1080, durationSec: 12 }

function draftData(over: Partial<TrendVersionData> = {}): TrendVersionData {
  return {
    name: { en: "Office Attack" },
    source: { videoUrl: SRC, durationSec: 12, width: 2568, height: 1080, display: WIDE_DISPLAY },
    previewStart: 8,
    slots: [{ key: "lead", label: { en: "Lead" }, kind: "person", required: true, roleName: "the man with the keyboard" }],
    references: [],
    examples: [],
    ...over,
  }
}

function seed(data = draftData()) {
  const t: MemTrend = {
    id: T1, slug: "office-attack", status: "draft", tags: [], badges: [], sortOrder: 0,
    draftVersion: 1, publishedVersion: null, createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z",
    versions: { 1: { data, published: false } },
  }
  mem.trends.push(t)
  return t
}

let app: FastifyInstance

beforeEach(async () => {
  db.log.length = 0
  mem.revs = 0
  mem.trends = []
  mem.clips = []
  mem.clipFails = null
  mem.admins = new Set([ADMIN])
  mem.cropped = []
  mem.onCrop = null
  mem.cropFails = null
  _resetPluginSupportsForTests()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
  })
  await app.register(adminTrendsRoutes)
  await app.ready()
})

afterEach(async () => {
  await _settledSourceCropsForTests()
  await app.close()
  _resetPluginSupportsForTests()
})

function call(method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown, userId = ADMIN) {
  return app.inject({ method, url, headers: { "x-user-id": userId }, ...(payload !== undefined ? { payload: payload as object } : {}) })
}
const revisionOf = async () => (await call("GET", `/v1/admin/trends/${T1}`)).json().data.revision as string
const draftNow = () => mem.trends[0]!.versions[1]!.data
const audits = () =>
  db.log.filter((q) => q.table === "admin_actions" && q.ops.some((op) => op.m === "insert")).map((q) => q.ops.find((op) => op.m === "insert")!.a[0] as Record<string, unknown>)

async function start(body: Record<string, unknown>, userId = ADMIN) {
  return call("POST", `/v1/admin/trends/${T1}/crop`, { revision: await revisionOf(), ...body }, userId)
}
const viewOf = async () => (await call("GET", `/v1/admin/trends/${T1}`)).json().data.sourceCrop as Record<string, unknown> | null

describe("starting a source crop", () => {
  it("marks the draft, answers 202 at once, then puts the 16:9 crop in as a new source clip and clears the record", async () => {
    seed()
    let seenWhileRunning: Record<string, unknown> | null = null
    mem.onCrop = () => {
      seenWhileRunning = structuredClone(draftNow().sourceCrop ?? null) as Record<string, unknown> | null
    }
    const res = await start({ aspect: "16:9" })
    expect(res.statusCode).toBe(202)
    expect(res.json().data.sourceCrop).toMatchObject({ aspect: "16:9", position: 0.5, fromUrl: SRC, current: true, running: true, stale: false })
    await _settledSourceCropsForTests()

    expect(mem.cropped).toEqual([{ trendId: T1, sourceUrl: SRC, aspect: "16:9", position: 0.5 }])
    expect(seenWhileRunning).toMatchObject({ aspect: "16:9", position: 0.5, fromUrl: SRC, by: ADMIN })
    const d = draftNow()
    expect(d.source).toEqual({
      videoUrl: `https://cdn.test/trends/${T1}/cropped.mp4`,
      durationSec: 9.5,
      width: 1920,
      height: 1080,
      display: { videoUrl: `https://cdn.test/trends/${T1}/cropped-display.mp4`, posterUrl: `https://cdn.test/trends/${T1}/cropped-display.png`, width: 1920, height: 1080, durationSec: 9.5 },
      // The stored clip's hash, recorded for a full run's provenance.
      sha256: "e".repeat(64),
    })
    // The preview kept inside the shorter clip (9.5 − 4).
    expect(d.previewStart).toBe(5.5)
    // The preview input clip, cut again from the crop at the kept start (the window ends the clip: 4 s, no tail).
    expect(mem.clips).toEqual([{ trendId: T1, sourceUrl: `https://cdn.test/trends/${T1}/cropped.mp4`, startSec: 5.5, durationSec: 4 }])
    expect(d.previewClip).toMatchObject({ sourceVideoUrl: `https://cdn.test/trends/${T1}/cropped.mp4`, startSec: 5.5, recipe: "1" })
    expect(d.sourceCrop).toBeUndefined()
    expect(audits().map((a) => a.action)).toEqual(["start_trend_source_crop", "crop_trend_source"])
    expect(await viewOf()).toBeNull()
  })

  it("replaces a stale preview clip in the draft (one cut from the old source is never kept), and a failed cut is the record's error", async () => {
    const stale = {
      videoUrl: `https://cdn.test/trends/${T1}/preview-old.mp4`, durationSec: 4, width: 2568, height: 1080, frames: 120, sha256: "b".repeat(64),
      sourceVideoUrl: SRC, startSec: 8, recipe: "1", madeAt: "2026-10-27T10:00:00.000Z",
    }
    seed(draftData({ previewClip: stale }))
    expect((await start({ aspect: "16:9" })).statusCode).toBe(202)
    await _settledSourceCropsForTests()
    expect(draftNow().previewClip!.videoUrl).not.toBe(stale.videoUrl)
    expect(draftNow().previewClip!.sourceVideoUrl).toBe(`https://cdn.test/trends/${T1}/cropped.mp4`)

    mem.trends = []
    mem.clips = []
    seed(draftData({ previewClip: stale }))
    mem.clipFails = new TrendMediaError("media_unreadable", "Could not cut the preview's input clip from the source clip.")
    expect((await start({ aspect: "16:9" })).statusCode).toBe(202)
    await _settledSourceCropsForTests()
    // The draft is as it was: the old source, the old clip, the record carrying why.
    expect(draftNow().source!.videoUrl).toBe(SRC)
    expect(draftNow().previewClip).toEqual(stale)
    expect(draftNow().sourceCrop?.error).toMatchObject({ code: "media_unreadable" })
  })

  it("carries the admin's position (the share of the cut from the left / top)", async () => {
    seed()
    expect((await start({ aspect: "16:9", position: 0.2 })).statusCode).toBe(202)
    await _settledSourceCropsForTests()
    expect(mem.cropped[0]).toMatchObject({ position: 0.2 })
  })

  it("takes 9:16 only for a clip taller than 9:16, judged on the clip as shown (a rotation applied)", async () => {
    // Stored landscape with a rotation tag; shown portrait 1080×2568.
    seed(draftData({ source: { videoUrl: SRC, durationSec: 12, width: 2568, height: 1080, display: { ...WIDE_DISPLAY, width: 1080, height: 2568 } } }))
    const wrong = await start({ aspect: "16:9" })
    expect(wrong.statusCode).toBe(409)
    expect(wrong.json().error.code).toBe("crop_not_needed")
    expect((await start({ aspect: "9:16" })).statusCode).toBe(202)
  })

  it("refuses a crop that would not trim, no source, a position out of range, a stale revision and a non-admin", async () => {
    seed(draftData({ source: { videoUrl: SRC, durationSec: 12, width: 1920, height: 1080, display: { ...WIDE_DISPLAY, width: 1920, height: 1080 } } }))
    expect((await start({ aspect: "16:9" })).json().error.code).toBe("crop_not_needed")
    expect((await start({ aspect: "9:16" })).json().error.code).toBe("crop_not_needed")
    expect((await start({ aspect: "16:9", position: 1.5 })).statusCode).toBe(400)
    expect((await call("POST", `/v1/admin/trends/${T1}/crop`, { aspect: "16:9", revision: "rev-old" })).statusCode).toBe(409)
    expect((await start({ aspect: "16:9" }, USER)).statusCode).toBe(403)
    mem.trends = []
    seed(draftData({ source: null }))
    expect((await start({ aspect: "16:9" })).json().error.code).toBe("source_missing")
    expect(mem.cropped).toEqual([])
  })

  it("refuses a second start while one runs, and lets a stale one be started again", async () => {
    const running: TrendSourceCrop = { aspect: "16:9", position: 0.5, fromUrl: SRC, startedAt: new Date().toISOString(), by: ADMIN }
    seed(draftData({ sourceCrop: running }))
    const busy = await start({ aspect: "16:9" })
    expect(busy.statusCode).toBe(409)
    expect(busy.json().error.code).toBe("crop_in_progress")
    draftNow().sourceCrop = { ...running, startedAt: new Date(Date.now() - CROP_STALE_MS - 1000).toISOString() }
    expect((await viewOf())).toMatchObject({ running: false, stale: true })
    expect((await start({ aspect: "16:9" })).statusCode).toBe(202)
  })
})

describe("a crop and the face mask's marks", () => {
  const MASKING = { mode: "always" as const, threshold: 0.4 }
  const MARK = { label: "erased" as const, fromFrame: 0, toFrame: 359, leftPct: 60, topPct: 10, rightPct: 90, bottomPct: 50 }

  it("clears them when the crop goes in (they are % of the old frame), and the audit says so", async () => {
    seed(draftData({ faceMasking: { ...MASKING, marks: [MARK] } }))
    await start({ aspect: "16:9" })
    await _settledSourceCropsForTests()
    expect(draftNow().source?.videoUrl).toBe(`https://cdn.test/trends/${T1}/cropped.mp4`)
    expect(draftNow().faceMasking).toEqual(MASKING)
    expect(audits().find((a) => a.action === "crop_trend_source")?.payload).toMatchObject({ marksCleared: true })
  })

  it("keeps a masking setting without marks as it is", async () => {
    seed(draftData({ faceMasking: MASKING }))
    await start({ aspect: "16:9" })
    await _settledSourceCropsForTests()
    expect(draftNow().faceMasking).toEqual(MASKING)
    expect(audits().find((a) => a.action === "crop_trend_source")?.payload).not.toHaveProperty("marksCleared")
  })

  it("keeps them when the crop does not go in", async () => {
    seed(draftData({ faceMasking: { ...MASKING, marks: [MARK] } }))
    mem.cropFails = new TrendMediaError("media_unreadable", "Could not crop the source clip to 16:9.")
    await start({ aspect: "16:9" })
    await _settledSourceCropsForTests()
    expect(draftNow().faceMasking).toEqual({ ...MASKING, marks: [MARK] })
  })
})

describe("a crop that does not go in", () => {
  it("writes the media failure on the record, and the source stays", async () => {
    seed()
    mem.cropFails = new TrendMediaError("media_unreadable", "Could not crop the source clip to 16:9.")
    await start({ aspect: "16:9" })
    await _settledSourceCropsForTests()
    expect(draftNow().source?.videoUrl).toBe(SRC)
    expect(await viewOf()).toMatchObject({ running: false, stale: false, error: { code: "media_unreadable", message: "Could not crop the source clip to 16:9." } })
    expect(audits().map((a) => a.action)).toContain("crop_trend_source_failed")
  })

  it("is refused when the source was replaced meanwhile, keeping the new one", async () => {
    seed()
    const NEW = `https://cdn.test/trends/${T1}/new.mp4`
    mem.onCrop = () => {
      draftNow().source = { videoUrl: NEW, durationSec: 10, width: 1280, height: 720 }
      mem.trends[0]!.versions[1]!.revision = "rev-elsewhere"
    }
    await start({ aspect: "16:9" })
    await _settledSourceCropsForTests()
    expect(draftNow().source?.videoUrl).toBe(NEW)
    expect(await viewOf()).toMatchObject({ current: false, error: { code: "source_changed" } })
  })

  it("keeps another write that landed meanwhile", async () => {
    seed()
    mem.onCrop = () => {
      draftNow().trendPrompt = "written meanwhile"
      mem.trends[0]!.versions[1]!.revision = "rev-elsewhere"
    }
    await start({ aspect: "16:9" })
    await _settledSourceCropsForTests()
    expect(draftNow().trendPrompt).toBe("written meanwhile")
    expect(draftNow().source?.videoUrl).toBe(`https://cdn.test/trends/${T1}/cropped.mp4`)
  })
})

describe("the record", () => {
  it("a failed one is dismissed; a running one is not", async () => {
    const running: TrendSourceCrop = { aspect: "16:9", position: 0.5, fromUrl: SRC, startedAt: new Date().toISOString(), by: ADMIN }
    seed(draftData({ sourceCrop: running }))
    expect((await call("DELETE", `/v1/admin/trends/${T1}/crop?revision=${await revisionOf()}`)).json().error.code).toBe("crop_in_progress")
    draftNow().sourceCrop = { ...running, error: { code: "media_unreadable", message: "no", at: new Date().toISOString() } }
    const res = await call("DELETE", `/v1/admin/trends/${T1}/crop?revision=${await revisionOf()}`)
    expect(res.statusCode).toBe(200)
    expect(draftNow().sourceCrop).toBeUndefined()
    expect(audits().map((a) => a.action)).toContain("dismiss_trend_source_crop")
  })

  it("survives a draft save that does not carry it", async () => {
    const failed: TrendSourceCrop = { aspect: "16:9", position: 0.3, fromUrl: SRC, startedAt: "2026-10-26T09:00:00.000Z", by: ADMIN, error: { code: "x", message: "y", at: "2026-10-26T09:01:00.000Z" } }
    seed(draftData({ sourceCrop: failed }))
    const { sourceCrop: _c, ...edited } = draftNow()
    const res = await call("PUT", `/v1/admin/trends/${T1}/draft`, { revision: await revisionOf(), data: { ...edited, trendPrompt: "edited" } })
    expect(res.statusCode).toBe(200)
    expect(draftNow().sourceCrop).toEqual(failed)
    expect(draftNow().trendPrompt).toBe("edited")
  })
})
