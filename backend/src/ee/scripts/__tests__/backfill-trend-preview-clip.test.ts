// @test-reads-none the store and the cut are fakes; nothing is read from disk
/**
 * The preview input clip backfill: every trend version that offers a 4 s
 * preview and has no stored input clip — published or draft — gets one cut
 * from its OWN source at its OWN start (with its current stored face mask's
 * cut when it has one), written by `attachPreviewClip` (the store's second
 * exception to "a published version is never written"). Dry run by default:
 * nothing is cut, uploaded or written.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { VIDEO_MASK_RECIPE } from "@nodaro/shared/media"
import type { TrendPreviewClip, TrendVersionData } from "@/ee/lib/trends/types.js"

const fx = vi.hoisted(() => ({
  candidates: [] as Array<{ trendId: string; slug: string | null; version: number; published: boolean; data: unknown }>,
  attach: vi.fn(),
  make: vi.fn(),
  storage: { configured: true, publicUrl: "https://cdn.example.com" },
}))

vi.mock("@/ee/lib/trends/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ee/lib/trends/store.js")>()),
  listVersionsLackingPreviewClip: async () => fx.candidates,
  attachPreviewClip: fx.attach,
}))
vi.mock("@/ee/lib/trends/preview-clip-media.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ee/lib/trends/preview-clip-media.js")>()),
  makePreviewClip: fx.make,
}))
vi.mock("@/lib/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage.js")>()),
  isStorageConfigured: () => fx.storage.configured,
  r2Url: (key: string) => `${fx.storage.publicUrl}/${key}`,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: () => { throw new Error("the script reaches the database only through the store") } } }))

import { PreviewClipAttachConflictError } from "@/ee/lib/trends/store.js"
import { TrendMediaError } from "@/ee/lib/trends/media.js"
import { faceMaskSettingsKey } from "@/ee/lib/trends/face-mask.js"
import { parsePreviewClipArgs, runPreviewClipBackfill } from "../backfill-trend-preview-clip.js"

const T1 = "00000000-0000-4000-8000-0000000000a1"
const T2 = "00000000-0000-4000-8000-0000000000a2"
const SRC_A = "https://cdn.example.com/a.mov"
const SRC_B = "https://cdn.example.com/b.webm"
const MASK = "https://cdn.example.com/mask.mp4"
const MASKING = { mode: "always" as const, threshold: 0.4 }

function data(over: Partial<TrendVersionData> = {}): TrendVersionData {
  return {
    name: { en: "Dance off" },
    source: { videoUrl: SRC_A, durationSec: 12 },
    previewStart: 2,
    slots: [{ key: "lead", label: { en: "Lead" }, kind: "person", required: true, roleName: "the dancer" }],
    references: [],
    examples: [],
    ...over,
  }
}

/** A masked version with a current stored mask. */
function masked(): TrendVersionData {
  const d = data({ faceMasking: MASKING, previewStart: 8 })
  return {
    ...d,
    faceMask: {
      url: MASK, frames: 360, recipe: { core: VIDEO_MASK_RECIPE, plugin: "1" }, settingsKey: faceMaskSettingsKey(d)!,
      jobId: "j", stats: { shots: 1, heldFrames: 0, coverage: 0.02, droppedRegions: 0 }, approvedAt: "2026-10-26T00:00:00Z", approvedBy: "admin",
    },
  }
}

const CLIP: TrendPreviewClip = {
  videoUrl: "https://cdn.example.com/preview.mp4", durationSec: 5, width: 240, height: 320, frames: 150, sha256: "a".repeat(64),
  sourceVideoUrl: SRC_A, startSec: 2, recipe: "1", madeAt: "2026-10-27T10:00:00.000Z",
}
const WITH_MASK: TrendPreviewClip = { ...CLIP, faceMask: { url: "https://cdn.example.com/preview-mask.mp4", frames: 150, sha256: "b".repeat(64), sourceMaskUrl: MASK } }

let logs: string[] = []
beforeEach(() => {
  fx.candidates = [
    { trendId: T1, slug: "dance-off", version: 1, published: true, data: data() },
    { trendId: T1, slug: "dance-off", version: 2, published: false, data: data({ previewStart: 3 }) },
    { trendId: T2, slug: "jump", version: 3, published: true, data: { ...masked(), source: { videoUrl: SRC_B, durationSec: 12 } } },
  ]
  // The third candidate's mask key names SRC_B: rebuild it so the mask reads as current.
  const third = masked()
  const d3 = { ...third, source: { videoUrl: SRC_B, durationSec: 12 } }
  d3.faceMask = { ...third.faceMask!, settingsKey: faceMaskSettingsKey(d3)! }
  fx.candidates[2]!.data = d3
  fx.attach.mockReset().mockResolvedValue("set")
  fx.make.mockReset().mockImplementation(async (_trendId: string, args: { sourceUrl: string; startSec: number; faceMask?: { url: string } }) =>
    args.faceMask ? { ...WITH_MASK, sourceVideoUrl: args.sourceUrl, startSec: args.startSec } : { ...CLIP, sourceVideoUrl: args.sourceUrl, startSec: args.startSec },
  )
  fx.storage = { configured: true, publicUrl: "https://cdn.example.com" }
  logs = []
  for (const m of ["log", "warn", "error"] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      logs.push(a.join(" "))
    })
  }
})

describe("parsePreviewClipArgs", () => {
  it("is a dry run unless --apply; --limit N caps the versions; --published keeps published versions only", () => {
    expect(parsePreviewClipArgs([])).toEqual({ apply: false, limit: null, publishedOnly: false })
    expect(parsePreviewClipArgs(["--apply", "--limit", "2", "--published"])).toEqual({ apply: true, limit: 2, publishedOnly: true })
  })
  it("refuses a --limit that is not a positive whole number", () => {
    for (const bad of [["--limit"], ["--limit", "0"], ["--limit", "-1"], ["--limit", "2.5"], ["--limit", "x"]]) {
      expect(() => parsePreviewClipArgs(bad)).toThrow(/--limit/)
    }
  })
})

describe("runPreviewClipBackfill", () => {
  it("dry run: lists every version lacking a clip with what would be cut, and cuts and writes nothing", async () => {
    const r = await runPreviewClipBackfill({ apply: false, limit: null, publishedOnly: false })
    expect(r).toEqual({ ok: true, candidates: 3, set: 0, already: 0, failed: 0 })
    expect(fx.make).not.toHaveBeenCalled()
    expect(fx.attach).not.toHaveBeenCalled()
    const out = logs.join("\n")
    expect(out).toContain(`dance-off (${T1}) v1 · published · would cut the preview clip (5.00 s from 2.00 s)`)
    expect(out).toContain(`dance-off (${T1}) v2 · draft · would cut the preview clip (5.00 s from 3.00 s)`)
    expect(out).toContain(`jump (${T2}) v3 · published · would cut the preview clip (4.00 s from 8.00 s, with its face mask)`)
    expect(out).toMatch(/dry run — nothing written/)
  })

  it("--apply: cuts each version's clip from ITS source at ITS start (the mask's cut when it has a current mask) and attaches it once per version", async () => {
    const r = await runPreviewClipBackfill({ apply: true, limit: null, publishedOnly: false })
    expect(r).toEqual({ ok: true, candidates: 3, set: 3, already: 0, failed: 0 })
    expect(fx.make.mock.calls).toEqual([
      [T1, { sourceUrl: SRC_A, startSec: 2, durationSec: 5 }],
      [T1, { sourceUrl: SRC_A, startSec: 3, durationSec: 5 }],
      [T2, { sourceUrl: SRC_B, startSec: 8, durationSec: 4, faceMask: { url: MASK } }],
    ])
    expect(fx.attach.mock.calls).toEqual([
      [T1, 1, { ...CLIP, startSec: 2 }],
      [T1, 2, { ...CLIP, startSec: 3 }],
      [T2, 3, { ...WITH_MASK, sourceVideoUrl: SRC_B, startSec: 8 }],
    ])
    expect(logs.join("\n")).toContain(`jump (${T2}) v3 · published · preview clip set (4.00 s from 8.00 s, with its face mask: 150 frames, 240×320, 5.00 s, sha256 aaaaaaaaaaaa)`)
    expect(logs.join("\n")).toMatch(/3 set, 0 already had one, 0 failed/)
  })

  it("--published cuts the published versions only", async () => {
    const r = await runPreviewClipBackfill({ apply: true, limit: null, publishedOnly: true })
    expect(r).toMatchObject({ candidates: 2, set: 2 })
    expect(fx.attach.mock.calls.map((c) => [c[0], c[1]])).toEqual([[T1, 1], [T2, 3]])
  })

  it("a version that got its clip meanwhile is reported as 'already', not counted as set", async () => {
    fx.attach.mockResolvedValueOnce("already")
    const r = await runPreviewClipBackfill({ apply: true, limit: null, publishedOnly: false })
    expect(r).toMatchObject({ set: 2, already: 1, failed: 0, ok: true })
    expect(logs.join("\n")).toContain(`dance-off (${T1}) v1 · published · already had a preview clip`)
  })

  it("a failed cut or a conflicting write is reported and skipped (the cause along); the versions after it still run", async () => {
    fx.make.mockRejectedValueOnce(new TrendMediaError("download_failed", "Could not fetch the file: HTTP 404"))
    const r = await runPreviewClipBackfill({ apply: true, limit: null, publishedOnly: false })
    expect(r).toEqual({ ok: false, candidates: 3, set: 2, already: 0, failed: 1 })
    expect(fx.attach).toHaveBeenCalledTimes(2)
    expect(logs.join("\n")).toContain(`dance-off (${T1}) v1 · published · FAILED (download_failed: Could not fetch the file: HTTP 404)`)

    fx.attach.mockReset().mockResolvedValue("set")
    fx.make.mockRejectedValueOnce(new TrendMediaError("media_unreadable", "Could not cut the preview's input clip from the source clip.", { cause: new Error("ffmpeg failed: moov atom not found") }))
    await runPreviewClipBackfill({ apply: true, limit: null, publishedOnly: false })
    expect(logs.join("\n")).toContain("FAILED (media_unreadable: Could not cut the preview's input clip from the source clip. (ffmpeg failed: moov atom not found))")

    fx.attach.mockReset().mockRejectedValueOnce(new PreviewClipAttachConflictError(T1, 1, "start_changed")).mockResolvedValue("set")
    const again = await runPreviewClipBackfill({ apply: true, limit: null, publishedOnly: false })
    expect(again).toMatchObject({ set: 2, failed: 1, ok: false })
    const line = logs.find((l) => l.startsWith(`dance-off (${T1}) v1`) && l.includes("start_changed"))!
    expect(line).toContain("FAILED")
    // The clip just cut is left in storage, named so the operator can find it.
    expect(line).toContain(CLIP.videoUrl)
  })

  it("a clip address that is not http(s), or a database error, stops the run (not one version's problem)", async () => {
    fx.attach.mockRejectedValueOnce(new Error("Trend x version 1: the preview clip's addresses must be http(s) (is R2_PUBLIC_URL set?)."))
    await expect(runPreviewClipBackfill({ apply: true, limit: null, publishedOnly: false })).rejects.toThrow(/http\(s\)/)
    expect(fx.attach).toHaveBeenCalledTimes(1)
    fx.attach.mockReset().mockRejectedValueOnce(new Error("Could not attach: connection refused"))
    await expect(runPreviewClipBackfill({ apply: true, limit: null, publishedOnly: false })).rejects.toThrow(/connection refused/)
  })

  it("--limit N takes the first N versions, in dry run and apply alike", async () => {
    expect(await runPreviewClipBackfill({ apply: false, limit: 2, publishedOnly: false })).toMatchObject({ candidates: 2 })
    expect(await runPreviewClipBackfill({ apply: true, limit: 1, publishedOnly: false })).toMatchObject({ candidates: 1, set: 1 })
    expect(fx.attach).toHaveBeenCalledTimes(1)
    expect(fx.attach.mock.calls[0]![1]).toBe(1)
  })

  it("--apply refuses to start without storage (no credentials, or no http(s) R2_PUBLIC_URL); a dry run needs none", async () => {
    for (const storage of [{ configured: false, publicUrl: "https://cdn.example.com" }, { configured: true, publicUrl: "" }]) {
      fx.storage = storage
      expect(await runPreviewClipBackfill({ apply: true, limit: null, publishedOnly: false })).toEqual({ ok: false, candidates: 0, set: 0, already: 0, failed: 0 })
      expect(fx.make).not.toHaveBeenCalled()
    }
    expect(logs.join("\n")).toContain("Refusing: storage is not configured")
    fx.storage = { configured: false, publicUrl: "" }
    expect(await runPreviewClipBackfill({ apply: false, limit: null, publishedOnly: false })).toMatchObject({ ok: true, candidates: 3 })
  })
})
