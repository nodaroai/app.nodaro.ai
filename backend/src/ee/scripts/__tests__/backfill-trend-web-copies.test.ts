/**
 * The web copy backfill: every PUBLISHED trend's shown videos without a
 * current web copy get one, attached by `attachWebCopies` (the store's third
 * exception to "a published version is never written"). Dry run by default:
 * nothing is downloaded, encoded, uploaded or written.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const fx = vi.hoisted(() => ({
  published: [] as Array<{ trendId: string; slug: string; version: number; data: unknown }>,
  attach: vi.fn(),
  download: vi.fn(),
  storage: { configured: true, publicUrl: "https://cdn.example.com" },
}))

vi.mock("@/ee/lib/trends/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ee/lib/trends/store.js")>()),
  listPublishedTrendVersions: async () => fx.published,
  attachWebCopies: fx.attach,
}))
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/ffmpeg-utils.js")>()),
  downloadFile: fx.download,
  runFfmpeg: () => {
    throw new Error("a dry run never encodes; an apply here encodes through the injected maker")
  },
}))
vi.mock("@/lib/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage.js")>()),
  isStorageConfigured: () => fx.storage.configured,
  r2Url: (key: string) => `${fx.storage.publicUrl}/${key}`,
  uploadFileWithKeyToR2: () => {
    throw new Error("nothing is uploaded here")
  },
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: () => { throw new Error("the script reaches the database only through the store") } } }))

import { TrendMediaError } from "@/ee/lib/trends/media.js"
import { WebCopyAttachConflictError } from "@/ee/lib/trends/store.js"
import type { TrendVersionData } from "@/ee/lib/trends/types.js"
import { parseWebCopyArgs, runWebCopyBackfill } from "../backfill-trend-web-copies.js"

const T1 = "00000000-0000-4000-8000-0000000000a1"
const T2 = "00000000-0000-4000-8000-0000000000a2"
const T3 = "00000000-0000-4000-8000-0000000000a3"
const SRC = "https://cdn.example.com/trends/t1/src.mov"
const DISPLAY = { videoUrl: "https://cdn.example.com/trends/t1/display.mp4", posterUrl: "https://cdn.example.com/trends/t1/d.png", width: 720, height: 1280, durationSec: 12 }
const EX = (n: number) => ({ videoUrl: `https://cdn.example.com/trends/ex${n}.mp4`, width: 720, height: 1280, durationSec: 12, slots: {}, sourceJobId: `job-${n}` })
const web = (from: string) => ({ videoUrl: `${from}.web.mp4`, sizeBytes: 7_340_032, madeFrom: from })
const data = (over: Partial<TrendVersionData> = {}): TrendVersionData => ({
  name: { en: "Neon" },
  source: { videoUrl: SRC, durationSec: 12, display: DISPLAY },
  previewStart: null,
  slots: [],
  references: [],
  examples: [EX(1)],
  ...over,
})

let logs: string[] = []
beforeEach(() => {
  fx.published = [
    { trendId: T1, slug: "dance-off", version: 3, data: data() },
    // Every shown video already has its copy: not listed.
    {
      trendId: T2, slug: "done", version: 1,
      data: data({ source: { videoUrl: SRC, durationSec: 12, display: { ...DISPLAY, web: web(DISPLAY.videoUrl) } }, examples: [{ ...EX(2), web: web(EX(2).videoUrl) }] }),
    },
    // Hides its original: its examples only.
    { trendId: T3, slug: "jump", version: 2, data: data({ hideOriginal: true, examples: [EX(3), EX(4)] }) },
  ]
  fx.attach.mockReset().mockImplementation(async (_t: string, _v: number, copies: unknown[]) => ({ set: copies.length, already: 0, stale: 0 }))
  fx.download.mockReset()
  fx.storage = { configured: true, publicUrl: "https://cdn.example.com" }
  logs = []
  for (const m of ["log", "warn", "error"] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      logs.push(a.join(" "))
    })
  }
})

describe("parseWebCopyArgs", () => {
  it("is a dry run unless --apply; --limit N caps the trends", () => {
    expect(parseWebCopyArgs([])).toEqual({ apply: false, limit: null })
    expect(parseWebCopyArgs(["--apply", "--limit", "2"])).toEqual({ apply: true, limit: 2 })
  })
  it("refuses a --limit that is not a positive whole number", () => {
    for (const bad of [["--limit"], ["--limit", "0"], ["--limit", "-1"], ["--limit", "2.5"], ["--limit", "x"]]) {
      expect(() => parseWebCopyArgs(bad)).toThrow(/--limit/)
    }
  })
})

describe("runWebCopyBackfill — dry run (the default)", () => {
  it("lists each published trend's videos lacking a web copy and touches nothing", async () => {
    const r = await runWebCopyBackfill({ apply: false, limit: null })
    expect(r).toEqual({ ok: true, trends: 2, videos: 4, set: 0, already: 0, stale: 0, failed: 0 })
    expect(logs).toContain(`dance-off (${T1}) v3 · original · would make a web copy`)
    expect(logs).toContain(`dance-off (${T1}) v3 · example 1 · would make a web copy`)
    expect(logs).toContain(`jump (${T3}) v2 · example 1 · would make a web copy`)
    expect(logs).toContain(`jump (${T3}) v2 · example 2 · would make a web copy`)
    expect(logs.some((l) => l.includes("done ("))).toBe(false)
    expect(logs.at(-1)).toMatch(/2 trend\(s\), 4 video\(s\) \(dry run — nothing written\)/)
    expect(fx.download).not.toHaveBeenCalled()
    expect(fx.attach).not.toHaveBeenCalled()
  })

  it("--limit takes the first N trends lacking a copy", async () => {
    const r = await runWebCopyBackfill({ apply: false, limit: 1 })
    expect(r).toMatchObject({ trends: 1, videos: 2 })
    expect(logs.some((l) => l.startsWith("jump"))).toBe(false)
  })

  it("a dry run needs no storage; an apply refuses to start without it", async () => {
    fx.storage = { configured: false, publicUrl: "https://cdn.example.com" }
    expect((await runWebCopyBackfill({ apply: false, limit: null })).ok).toBe(true)
    const r = await runWebCopyBackfill({ apply: true, limit: null })
    expect(r.ok).toBe(false)
    expect(logs.some((l) => l.startsWith("Refusing: storage is not configured"))).toBe(true)
    fx.storage = { configured: true, publicUrl: "" }
    expect((await runWebCopyBackfill({ apply: true, limit: null })).ok).toBe(false)
    expect(fx.attach).not.toHaveBeenCalled()
  })
})

describe("runWebCopyBackfill — --apply", () => {
  const make = vi.fn(async (_trend: string, from: string) => ({ videoUrl: `${from}.web.mp4`, sizeBytes: 7_340_032 }))
  beforeEach(() => {
    make.mockClear()
  })

  it("makes each copy (the original from its uploaded clip) and attaches them per trend", async () => {
    const r = await runWebCopyBackfill({ apply: true, limit: null }, { make })
    expect(r).toEqual({ ok: true, trends: 2, videos: 4, set: 4, already: 0, stale: 0, failed: 0 })
    expect(make.mock.calls.map((c) => c[1])).toEqual([SRC, EX(1).videoUrl, EX(3).videoUrl, EX(4).videoUrl])
    expect(fx.attach).toHaveBeenCalledWith(T1, 3, [
      { videoUrl: `${SRC}.web.mp4`, sizeBytes: 7_340_032, madeFrom: DISPLAY.videoUrl },
      { videoUrl: `${EX(1).videoUrl}.web.mp4`, sizeBytes: 7_340_032, madeFrom: EX(1).videoUrl },
    ])
    expect(logs).toContain(`dance-off (${T1}) v3 · original · web copy made (7.0 MB)`)
    expect(logs).toContain(`dance-off (${T1}) v3 · 2 attached, 0 already had one, 0 stale (the video was replaced meanwhile)`)
  })

  it("a video whose copy fails is reported and skipped; the rest are attached and the run is not ok", async () => {
    make.mockImplementationOnce(async () => {
      throw new TrendMediaError("media_unreadable", "Could not make a web copy of the video.", { cause: new Error("moov atom not found") })
    })
    const r = await runWebCopyBackfill({ apply: true, limit: null }, { make })
    expect(r).toMatchObject({ ok: false, set: 3, failed: 1 })
    expect(logs).toContain(`dance-off (${T1}) v3 · original · FAILED (media_unreadable: Could not make a web copy of the video. (moov atom not found))`)
  })

  it("a trend whose row kept moving is reported and skipped; a database error stops the run", async () => {
    fx.attach.mockRejectedValueOnce(new WebCopyAttachConflictError(T1, 3, "concurrent_write"))
    const r = await runWebCopyBackfill({ apply: true, limit: null }, { make })
    expect(r).toMatchObject({ ok: false, failed: 1, set: 2 })
    expect(logs.some((l) => l.startsWith(`dance-off (${T1}) v3 · FAILED (concurrent_write`))).toBe(true)

    fx.attach.mockRejectedValueOnce(new Error("database down"))
    await expect(runWebCopyBackfill({ apply: true, limit: null }, { make })).rejects.toThrow("database down")
  })

  it("a second run lists nothing once every copy is attached", async () => {
    fx.published = fx.published.filter((v) => v.slug === "done")
    const r = await runWebCopyBackfill({ apply: true, limit: null }, { make })
    expect(r).toEqual({ ok: true, trends: 0, videos: 0, set: 0, already: 0, stale: 0, failed: 0 })
    expect(make).not.toHaveBeenCalled()
  })
})
