// @test-reads-none the store, the download and the transcode are fakes; it only checks that the temp dir it was handed is gone
/**
 * The display-copy backfill (trends "show the original", S7): every trend
 * version with a source clip and no display copy — published or draft — gets
 * one, written by `attachDisplayCopy` (the store's one exception to "a
 * published version is never written"). Dry run by default: nothing is
 * downloaded, transcoded, uploaded or written.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { existsSync } from "node:fs"
import { dirname } from "node:path"

const fx = vi.hoisted(() => ({
  candidates: [] as Array<{ trendId: string; slug: string | null; version: number; published: boolean; sourceVideoUrl: string }>,
  attach: vi.fn(),
  download: vi.fn(),
  probe: vi.fn(),
  copy: vi.fn(),
  storage: { configured: true, publicUrl: "https://cdn.example.com" },
}))

vi.mock("@/ee/lib/trends/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ee/lib/trends/store.js")>()),
  listVersionsLackingDisplay: async () => fx.candidates,
  attachDisplayCopy: fx.attach,
}))
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/ffmpeg-utils.js")>()),
  downloadFile: fx.download,
  probeVideoSource: fx.probe,
}))
vi.mock("@/ee/lib/trends/media.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ee/lib/trends/media.js")>()),
  makeDisplayCopy: fx.copy,
}))
vi.mock("@/lib/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage.js")>()),
  isStorageConfigured: () => fx.storage.configured,
  r2Url: (key: string) => `${fx.storage.publicUrl}/${key}`,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: () => { throw new Error("the script reaches the database only through the store") } } }))

import { DisplayAttachConflictError } from "@/ee/lib/trends/store.js"
import { TrendMediaError } from "@/ee/lib/trends/media.js"
import { parseDisplayArgs, runDisplayBackfill } from "../backfill-trend-display.js"

const T1 = "00000000-0000-4000-8000-0000000000a1"
const T2 = "00000000-0000-4000-8000-0000000000a2"
const DISPLAY = { videoUrl: "https://cdn.example.com/d.mp4", posterUrl: "https://cdn.example.com/d.png", width: 240, height: 320, durationSec: 12 }

let logs: string[] = []
beforeEach(() => {
  fx.candidates = [
    { trendId: T1, slug: "dance-off", version: 1, published: true, sourceVideoUrl: "https://cdn.example.com/a.mov" },
    { trendId: T1, slug: "dance-off", version: 2, published: false, sourceVideoUrl: "https://cdn.example.com/a.mov" },
    { trendId: T2, slug: "jump", version: 3, published: true, sourceVideoUrl: "https://cdn.example.com/b.webm" },
  ]
  fx.attach.mockReset().mockResolvedValue("set")
  fx.download.mockReset().mockResolvedValue(undefined)
  fx.probe.mockReset().mockResolvedValue({ width: 1080, height: 1920, durationSeconds: 12 })
  fx.copy.mockReset().mockResolvedValue(DISPLAY)
  fx.storage = { configured: true, publicUrl: "https://cdn.example.com" }
  logs = []
  for (const m of ["log", "warn", "error"] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      logs.push(a.join(" "))
    })
  }
})

describe("parseDisplayArgs", () => {
  it("is a dry run unless --apply; --limit N caps the versions", () => {
    expect(parseDisplayArgs([])).toEqual({ apply: false, limit: null })
    expect(parseDisplayArgs(["--apply", "--limit", "2"])).toEqual({ apply: true, limit: 2 })
  })
  it("refuses a --limit that is not a positive whole number", () => {
    for (const bad of [["--limit"], ["--limit", "0"], ["--limit", "-1"], ["--limit", "2.5"], ["--limit", "x"]]) {
      expect(() => parseDisplayArgs(bad)).toThrow(/--limit/)
    }
  })
})

describe("runDisplayBackfill", () => {
  it("dry run: lists every version lacking a display copy and downloads, transcodes and writes nothing", async () => {
    const r = await runDisplayBackfill({ apply: false, limit: null })
    expect(r).toEqual({ ok: true, candidates: 3, set: 0, already: 0, failed: 0 })
    expect(fx.download).not.toHaveBeenCalled()
    expect(fx.copy).not.toHaveBeenCalled()
    expect(fx.attach).not.toHaveBeenCalled()
    const out = logs.join("\n")
    expect(out).toContain(`dance-off (${T1}) v1 · published · would make a display copy`)
    expect(out).toContain(`dance-off (${T1}) v2 · draft · would make a display copy`)
    expect(out).toContain(`jump (${T2}) v3 · published · would make a display copy`)
    expect(out).toMatch(/dry run — nothing written/)
  })

  it("--apply: downloads each version's source, makes its copy and attaches it once per version, published and draft alike", async () => {
    const r = await runDisplayBackfill({ apply: true, limit: null })
    expect(r).toEqual({ ok: true, candidates: 3, set: 3, already: 0, failed: 0 })
    expect(fx.download.mock.calls.map((c) => c[0])).toEqual(["https://cdn.example.com/a.mov", "https://cdn.example.com/a.mov", "https://cdn.example.com/b.webm"])
    // The trend's own media limit, and the copy admitted at the clip's probed size.
    expect(fx.download.mock.calls[0]![2]).toEqual({ maxBytes: 500 * 1024 * 1024 })
    expect(fx.copy.mock.calls[0]![0]).toBe(T1)
    expect(fx.copy.mock.calls[0]![1]).toBe(fx.download.mock.calls[0]![1])
    expect(fx.copy.mock.calls[0]![2]).toEqual({ canvas: { width: 1080, height: 1920 } })
    expect(fx.attach.mock.calls).toEqual([
      [T1, 1, DISPLAY, { sourceVideoUrl: "https://cdn.example.com/a.mov" }],
      [T1, 2, DISPLAY, { sourceVideoUrl: "https://cdn.example.com/a.mov" }],
      [T2, 3, DISPLAY, { sourceVideoUrl: "https://cdn.example.com/b.webm" }],
    ])
    expect(logs.join("\n")).toContain(`jump (${T2}) v3 · published · display copy set (240×320, 12.0 s)`)
    expect(logs.join("\n")).toMatch(/3 set, 0 already had one, 0 failed/)
  })

  it("a version that got its copy meanwhile is reported as 'already', not counted as set", async () => {
    fx.attach.mockResolvedValueOnce("already")
    const r = await runDisplayBackfill({ apply: true, limit: null })
    expect(r).toMatchObject({ set: 2, already: 1, failed: 0, ok: true })
    expect(logs.join("\n")).toContain(`dance-off (${T1}) v1 · published · already had a display copy`)
  })

  it("a failed download, transcode or conflicting write is reported and skipped; the versions after it still run", async () => {
    fx.download.mockRejectedValueOnce(new Error("HTTP 404"))
    fx.copy.mockResolvedValueOnce(DISPLAY).mockRejectedValueOnce(new TrendMediaError("media_unreadable", "Could not make a playable copy of the video."))
    const r = await runDisplayBackfill({ apply: true, limit: null })
    expect(r).toEqual({ ok: false, candidates: 3, set: 1, already: 0, failed: 2 })
    expect(fx.attach).toHaveBeenCalledTimes(1)
    const out = logs.join("\n")
    expect(out).toContain(`dance-off (${T1}) v1 · published · FAILED (download: HTTP 404)`)
    expect(out).toContain(`jump (${T2}) v3 · published · FAILED (media_unreadable: Could not make a playable copy of the video.)`)

    // ffmpeg's own words ride along as the cause: the operator's only clue to WHY.
    fx.attach.mockReset().mockResolvedValue("set")
    fx.copy.mockReset().mockResolvedValue(DISPLAY).mockRejectedValueOnce(
      new TrendMediaError("media_unreadable", "Could not make a playable copy of the video.", { cause: new Error("ffmpeg failed: moov atom not found") }),
    )
    await runDisplayBackfill({ apply: true, limit: null })
    expect(logs.join("\n")).toContain("FAILED (media_unreadable: Could not make a playable copy of the video. (ffmpeg failed: moov atom not found))")

    fx.attach.mockReset().mockRejectedValueOnce(new DisplayAttachConflictError(T1, 1, "source_changed")).mockResolvedValue("set")
    const again = await runDisplayBackfill({ apply: true, limit: null })
    expect(again).toMatchObject({ set: 2, failed: 1, ok: false })
    expect(logs.join("\n")).toContain("FAILED (source_changed")
  })

  it.each(["version_missing", "source_removed"] as const)("a version whose row moved away mid-run (%s) is reported and skipped, with the unused copy's addresses; the next version still runs", async (reason) => {
    fx.attach.mockRejectedValueOnce(new DisplayAttachConflictError(T1, 1, reason)).mockResolvedValue("set")
    const r = await runDisplayBackfill({ apply: true, limit: null })
    expect(r).toEqual({ ok: false, candidates: 3, set: 2, already: 0, failed: 1 })
    expect(fx.attach).toHaveBeenCalledTimes(3)
    const line = logs.find((l) => l.startsWith(`dance-off (${T1}) v1`))!
    expect(line).toContain(`FAILED (${reason}`)
    expect(line).toContain(DISPLAY.videoUrl)
    expect(line).toContain(DISPLAY.posterUrl)
  })

  it("a display address that is not http(s) stops the run (storage misconfigured, not one version)", async () => {
    fx.attach.mockRejectedValueOnce(new Error("Trend x version 1: the display copy's addresses must be http(s) (is R2_PUBLIC_URL set?)."))
    await expect(runDisplayBackfill({ apply: true, limit: null })).rejects.toThrow(/http\(s\)/)
    expect(fx.attach).toHaveBeenCalledTimes(1)
  })

  it("a database error while writing stops the run (it is not one version's problem)", async () => {
    fx.attach.mockRejectedValueOnce(new Error("Could not attach: connection refused"))
    await expect(runDisplayBackfill({ apply: true, limit: null })).rejects.toThrow(/connection refused/)
    expect(fx.copy).toHaveBeenCalledTimes(1)
  })

  it("removes its temp dir after each version, including one that failed", async () => {
    const dirs: string[] = []
    fx.download.mockImplementation(async (_url: string, dest: string) => {
      dirs.push(dirname(dest))
    })
    fx.copy.mockResolvedValueOnce(DISPLAY).mockRejectedValueOnce(new TrendMediaError("media_unreadable", "x"))
    await runDisplayBackfill({ apply: true, limit: null })
    expect(dirs).toHaveLength(3)
    expect(new Set(dirs).size).toBe(3)
    for (const d of dirs) expect(existsSync(d)).toBe(false)
  })

  it("--limit N takes the first N versions, in dry run and apply alike", async () => {
    expect(await runDisplayBackfill({ apply: false, limit: 2 })).toMatchObject({ candidates: 2 })
    expect(await runDisplayBackfill({ apply: true, limit: 1 })).toMatchObject({ candidates: 1, set: 1 })
    expect(fx.attach).toHaveBeenCalledTimes(1)
    expect(fx.attach.mock.calls[0]![1]).toBe(1)
  })

  it("a probe that cannot read the clip still tries the copy, admitted at the default size", async () => {
    fx.probe.mockRejectedValue(new Error("no stream"))
    await runDisplayBackfill({ apply: true, limit: 1 })
    expect(fx.copy.mock.calls[0]![2]).toEqual({})
  })

  it("--apply refuses to start without storage (no credentials, or no http(s) R2_PUBLIC_URL); a dry run needs none", async () => {
    for (const storage of [{ configured: false, publicUrl: "https://cdn.example.com" }, { configured: true, publicUrl: "" }]) {
      fx.storage = storage
      expect(await runDisplayBackfill({ apply: true, limit: null })).toEqual({ ok: false, candidates: 0, set: 0, already: 0, failed: 0 })
      expect(fx.download).not.toHaveBeenCalled()
    }
    expect(logs.join("\n")).toContain("Refusing: storage is not configured")
    expect(await runDisplayBackfill({ apply: false, limit: null })).toMatchObject({ ok: true, candidates: 3 })
  })

  it("nothing to do: says so", async () => {
    fx.candidates = []
    expect(await runDisplayBackfill({ apply: true, limit: null })).toEqual({ ok: true, candidates: 0, set: 0, already: 0, failed: 0 })
    expect(logs.join("\n")).toMatch(/0 version\(s\) lacking a display copy/)
  })
})
