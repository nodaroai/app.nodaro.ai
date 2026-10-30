/**
 * Cropping one frame of a trend's original into a picture
 * (ee/routes/admin-trends-frame-crop.ts): "Take from the original", for a
 * slot's default picture in Full depth.
 *
 * What must hold:
 *  - the frame comes from the SAVED draft's original (`source.videoUrl`, never
 *    its display copy), at the time asked, and the box is cropped with ffmpeg
 *    (`crop=w:h:x:y`, one frame, PNG) and stored in the trend's storage; the
 *    answer is the stored address, the draft is not written, and the crop is
 *    audited;
 *  - a time outside the clip, a box leaving the frame as shown (or the decoded
 *    frame), a box too small, no source and an unknown size are refused before
 *    anything is stored;
 *  - the route is admin-only.
 *
 * The frame extraction, ffmpeg, the frame's size and the store are stubbed
 * (core's extract-frame and media tests pin them).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { type QueryResult, type RecordedQuery } from "../../../lib/__tests__/fake-supabase-query.js"
import type { TrendRow, TrendVersionData } from "../../lib/trends/types.js"

const db = vi.hoisted(() => ({ log: [] as Array<{ table: string; ops: Array<{ m: string; a: unknown[] }> }> }))

// A publish's background web copies (web-copy.ts, pinned in its own tests): never made here.
vi.mock("../../lib/trends/web-copy.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/trends/web-copy.js")>()),
  startWebCopies: () => Promise.resolve(),
}))

vi.mock("../../../lib/supabase.js", async () => {
  const { makeFakeFrom } = await import("../../../lib/__tests__/fake-supabase-query.js")
  return { supabase: { from: makeFakeFrom(db.log as RecordedQuery[], (_q: RecordedQuery): QueryResult => ({ data: null, error: null })) } }
})

type MemTrend = TrendRow & { data: TrendVersionData; revision: string; writes: number }

const mem = vi.hoisted(() => ({
  trends: [] as MemTrend[],
  admins: new Set<string>(),
  extracted: [] as Array<Record<string, unknown>>,
  ffmpeg: [] as string[][],
  cleaned: [] as string[],
  stored: [] as Array<{ trendId: string; file: string; kind: string }>,
  frameSize: { width: 1080, height: 1920 } as { width: number; height: number } | undefined,
}))

vi.mock("../../lib/trends/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/trends/store.js")>()
  const strip = (t: MemTrend): TrendRow => {
    const { data: _d, revision: _r, writes: _w, ...row } = t
    return { ...row, tags: [...row.tags], badges: [...row.badges] }
  }
  return {
    ...actual,
    getTrendById: async (id: string) => {
      const t = mem.trends.find((x) => x.id === id)
      return t ? strip(t) : null
    },
    getDraftState: async (id: string) => {
      const t = mem.trends.find((x) => x.id === id)
      return t ? { trend: strip(t), data: structuredClone(t.data), revision: t.revision } : null
    },
    saveDraft: async (id: string) => {
      const t = mem.trends.find((x) => x.id === id)!
      t.writes++
      return { version: t.draftVersion, revision: `${t.revision}+` }
    },
  }
})

vi.mock("../../../lib/admin-check.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/admin-check.js")>()
  return { ...actual, checkIsAdmin: async (userId: string) => mem.admins.has(userId) }
})

vi.mock("../../../providers/video/extract-frame.js", () => ({
  extractFrame: async (options: Record<string, unknown>) => {
    mem.extracted.push(options)
    return { imagePath: "/tmp/extract-frame-test/frame.png" }
  },
}))

vi.mock("../../../providers/video/ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../providers/video/ffmpeg-utils.js")>()
  return {
    ...actual,
    runFfmpeg: async (args: readonly string[]) => {
      mem.ffmpeg.push([...args])
      return ""
    },
    cleanupWorkDir: async (dir: string) => {
      mem.cleaned.push(dir)
    },
  }
})

vi.mock("../../../lib/image-dimensions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/image-dimensions.js")>()
  return { ...actual, imageDimensionsOf: async () => mem.frameSize }
})

vi.mock("../../lib/trends/media.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/trends/media.js")>()
  return {
    ...actual,
    storeLocalTrendMedia: async (trendId: string, file: string, kind: string) => {
      mem.stored.push({ trendId, file, kind })
      return { url: `https://cdn.test/trends/${trendId}/crop-${mem.stored.length}.png`, kind, width: 400, height: 600 }
    },
  }
})

import { adminTrendsRoutes } from "../admin-trends.js"
import { _resetPluginSupportsForTests } from "../../../lib/private-plugins/supports-registry.js"

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const USER = "00000000-0000-4000-8000-000000000001"
const T1 = "00000000-0000-4000-8000-0000000000a1"
const SRC = `https://cdn.test/trends/${T1}/src.mov`
const DISPLAY = { videoUrl: `https://cdn.test/trends/${T1}/display.mp4`, posterUrl: `https://cdn.test/trends/${T1}/display.png`, width: 1080, height: 1920, durationSec: 12 }

function draftData(over: Partial<TrendVersionData> = {}): TrendVersionData {
  return {
    name: { en: "Street" },
    // The original is stored landscape with a rotation tag: as shown (and decoded), it is portrait.
    source: { videoUrl: SRC, durationSec: 12, width: 1920, height: 1080, display: DISPLAY },
    previewStart: null,
    slots: [
      { key: "lead", label: { en: "Lead" }, kind: "person", required: true, roleName: "the woman" },
      { key: "guest", label: { en: "Guest" }, kind: "person", required: false, roleName: "the man" },
    ],
    references: [],
    examples: [],
    faceMasking: { mode: "always", source: "full-depth" },
    ...over,
  }
}

function seed(data = draftData()) {
  mem.trends.push({
    id: T1, slug: "street", status: "draft", tags: [], badges: [], sortOrder: 0,
    draftVersion: 1, publishedVersion: null, createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z",
    data, revision: "rev-1", writes: 0,
  })
}

let app: FastifyInstance

beforeEach(async () => {
  db.log.length = 0
  mem.trends = []
  mem.admins = new Set([ADMIN])
  mem.extracted = []
  mem.ffmpeg = []
  mem.cleaned = []
  mem.stored = []
  mem.frameSize = { width: 1080, height: 1920 }
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
  await app.close()
  _resetPluginSupportsForTests()
})

const crop = (payload: unknown, userId = ADMIN, id = T1) =>
  app.inject({ method: "POST", url: `/v1/admin/trends/${id}/frame-crop`, headers: { "x-user-id": userId }, payload: payload as object })
const audits = () =>
  db.log.filter((q) => q.table === "admin_actions" && q.ops.some((op) => op.m === "insert")).map((q) => q.ops.find((op) => op.m === "insert")!.a[0] as Record<string, unknown>)
const BOX = { x: 100, y: 200, w: 400, h: 600 }

describe("cropping a frame of the original", () => {
  it("extracts the frame of the saved ORIGINAL at that time, crops the box with ffmpeg, stores it and answers its address", async () => {
    seed()
    const res = await crop({ timeSec: 3.25, box: BOX })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ url: `https://cdn.test/trends/${T1}/crop-1.png`, width: 400, height: 600 })

    expect(mem.extracted).toEqual([{ videoUrl: SRC, mode: "timestamp", timestamp: 3.25 }])
    expect(mem.ffmpeg).toEqual([
      ["-y", "-i", "/tmp/extract-frame-test/frame.png", "-vf", "crop=400:600:100:200", "-frames:v", "1", "/tmp/extract-frame-test/crop.png"],
    ])
    expect(mem.stored).toEqual([{ trendId: T1, file: "/tmp/extract-frame-test/crop.png", kind: "image" }])
    // The frame's work dir is removed.
    expect(mem.cleaned).toEqual(["/tmp/extract-frame-test"])
    // The draft is not written: the builder saves the address in the slot.
    expect(mem.trends[0]!.writes).toBe(0)
    expect(audits()).toEqual([
      expect.objectContaining({
        action: "crop_trend_frame",
        target_id: T1,
        payload: { slug: "street", fromUrl: SRC, timeSec: 3.25, box: BOX, url: `https://cdn.test/trends/${T1}/crop-1.png` },
      }),
    ])
  })

  it("takes a box reaching the frame's edge", async () => {
    seed()
    const res = await crop({ timeSec: 0, box: { x: 0, y: 0, w: 1080, h: 1920 } })
    expect(res.statusCode).toBe(200)
  })

  it.each([
    ["at the clip's end", { timeSec: 12, box: BOX }, "time_out_of_range"],
    ["past it", { timeSec: 30, box: BOX }, "time_out_of_range"],
    ["wider than the frame as shown", { timeSec: 1, box: { x: 700, y: 0, w: 400, h: 600 } }, "box_out_of_frame"],
    ["taller than the frame as shown (the stored landscape size is not what is shown)", { timeSec: 1, box: { x: 0, y: 1500, w: 400, h: 600 } }, "box_out_of_frame"],
  ])("refuses a time or box %s, before anything is extracted", async (_name, body, code) => {
    seed()
    const res = await crop(body)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe(code)
    expect(mem.extracted).toEqual([])
    expect(mem.stored).toEqual([])
  })

  it.each([
    ["a negative time", { timeSec: -1, box: BOX }],
    ["a box too small", { timeSec: 1, box: { x: 0, y: 0, w: 8, h: 600 } }],
    ["a fractional pixel", { timeSec: 1, box: { ...BOX, x: 1.5 } }],
    ["a negative offset", { timeSec: 1, box: { ...BOX, y: -1 } }],
    ["an unknown key", { timeSec: 1, box: BOX, url: "https://evil.example/x.mp4" }],
    ["no box", { timeSec: 1 }],
  ])("refuses %s as a bad request", async (_name, body) => {
    seed()
    const res = await crop(body)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(mem.extracted).toEqual([])
  })

  it("refuses a box the decoded frame cannot hold, and stores nothing", async () => {
    seed()
    mem.frameSize = { width: 1078, height: 1920 }
    const res = await crop({ timeSec: 1, box: { x: 680, y: 0, w: 400, h: 600 } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("box_out_of_frame")
    expect(mem.ffmpeg).toEqual([])
    expect(mem.stored).toEqual([])
    expect(mem.cleaned).toEqual(["/tmp/extract-frame-test"])
  })

  it("refuses a draft with no source, or one whose size is unknown", async () => {
    seed(draftData({ source: null }))
    expect((await crop({ timeSec: 1, box: BOX })).json().error.code).toBe("source_missing")
    mem.trends = []
    seed(draftData({ source: { videoUrl: SRC, durationSec: 12 } }))
    const res = await crop({ timeSec: 1, box: BOX })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("source_size_unknown")
    expect(mem.extracted).toEqual([])
  })

  it("answers 404 for a trend that does not exist", async () => {
    seed()
    expect((await crop({ timeSec: 1, box: BOX }, ADMIN, "00000000-0000-4000-8000-0000000000ff")).statusCode).toBe(404)
  })

  it("is admin-only", async () => {
    seed()
    const res = await crop({ timeSec: 1, box: BOX }, USER)
    expect(res.statusCode).toBe(403)
    expect(mem.extracted).toEqual([])
  })
})
