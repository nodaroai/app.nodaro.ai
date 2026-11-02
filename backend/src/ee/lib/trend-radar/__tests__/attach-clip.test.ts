/**
 * attachTopPostClip (attach-clip.ts): the top post is downloaded as the admin,
 * stored as the draft's source and saved on the draft with the revision the
 * read carried; every failure — a link the downloader does not read, a
 * download or copy error, a clip with no readable length, a draft that
 * already has a source — leaves the draft as it was and notes why on the
 * candidate. It never throws.
 */
import { describe, it, expect, vi } from "vitest"
import { attachTopPostClip, type AttachClipDeps } from "../attach-clip.js"
import type { TrendVersionData } from "../../trends/types.js"

const DRAFT = { name: { en: "phone on train" }, source: null, previewStart: 0, slots: [], references: [], examples: [] } as unknown as TrendVersionData

function deps(over: Partial<AttachClipDeps> = {}) {
  const notes: Array<[string, string, string | null]> = []
  const saved: Array<[string, TrendVersionData, string]> = []
  const d: AttachClipDeps = {
    download: vi.fn(async () => ({ videoUrl: "https://cdn.test/library/clip.mp4" })),
    copy: vi.fn(async () => ({ url: "https://cdn.test/trends/t1/source.mp4", durationSec: 10, width: 1080, height: 1920, sha256: "abc" })),
    readDraft: vi.fn(async () => ({ data: DRAFT, revision: "r1" })),
    saveDraft: vi.fn(async (trendId: string, data: TrendVersionData, revision: string) => {
      saved.push([trendId, data, revision])
    }),
    note: vi.fn(async (id: string, event: string, detail: string | null) => {
      notes.push([id, event, detail])
    }),
    ...over,
  }
  return { d, notes, saved }
}

const input = { trendId: "t1", candidateId: "c1", post: { url: "https://www.tiktok.com/@a/video/7300000000000000001", author: "a", platform: "tiktok" as const }, userId: "admin" }

describe("attachTopPostClip", () => {
  it("the admin's confirmation for the link rides into the downloader (the import gate is inside it)", async () => {
    const { d } = deps()
    await attachTopPostClip({ ...input, confirmationId: "7f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01" }, d)
    expect(d.download).toHaveBeenCalledWith(input.post.url, "admin", "7f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01")
  })

  it("downloads as the admin, stores the clip as the draft's source and notes it", async () => {
    const { d, notes, saved } = deps()
    const out = await attachTopPostClip(input, d)
    expect(out).toEqual({ ok: true, durationSec: 10 })
    expect(d.download).toHaveBeenCalledWith(input.post.url, "admin", null)
    expect(d.copy).toHaveBeenCalledWith("t1", "https://cdn.test/library/clip.mp4")
    expect(saved).toEqual([["t1", { ...DRAFT, source: { videoUrl: "https://cdn.test/trends/t1/source.mp4", durationSec: 10, width: 1080, height: 1920, sha256: "abc" } }, "r1"]])
    expect(notes).toEqual([["c1", "source_attached", "tiktok post by a, 10s"]])
  })

  it("refuses a link the downloader does not read, without downloading", async () => {
    const { d, notes, saved } = deps()
    const out = await attachTopPostClip({ ...input, post: { ...input.post, url: "https://example.test/clip" } }, d)
    expect(out.ok).toBe(false)
    expect(d.download).not.toHaveBeenCalled()
    expect(saved).toEqual([])
    expect(notes[0]![1]).toBe("source_failed")
  })

  it("a failed download, an unreadable length or a draft with a source leave the draft alone and note why", async () => {
    let r = deps({ download: vi.fn(async () => { throw new Error("Download failed: private") }) })
    expect(await attachTopPostClip(input, r.d)).toEqual({ ok: false, why: "Download failed: private" })
    expect(r.saved).toEqual([])
    expect(r.notes).toEqual([["c1", "source_failed", "Download failed: private"]])

    r = deps({ copy: vi.fn(async () => ({ url: "x" })) })
    expect((await attachTopPostClip(input, r.d)).ok).toBe(false)
    expect(r.saved).toEqual([])

    r = deps({ readDraft: vi.fn(async () => ({ data: { ...DRAFT, source: { videoUrl: "kept", durationSec: 8 } }, revision: "r2" })) })
    expect(await attachTopPostClip(input, r.d)).toEqual({ ok: false, why: "the draft already has a source clip" })
    expect(r.saved).toEqual([])
  })

  it("never throws, even when noting fails", async () => {
    const r = deps({ download: vi.fn(async () => { throw new Error("x") }), note: vi.fn(async () => { throw new Error("db down") }) })
    await expect(attachTopPostClip(input, r.d)).resolves.toEqual({ ok: false, why: "x" })
  })
})
