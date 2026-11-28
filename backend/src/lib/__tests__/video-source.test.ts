// @test-reads-none the resolver's row read is injected; reads no file
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The shared rule (lib/video-download-original.ts) reads the public base from config.
vi.mock("../config.js", () => ({ config: { R2_PUBLIC_URL: "https://cdn.example.com", R2_PUBLIC_FALLBACK_DOMAIN: undefined } }))
vi.mock("../supabase.js", () => ({ supabase: {} }))
vi.mock("../storage.js", () => ({
  r2KeyFromOurUrl: (url: string) => {
    const base = "https://cdn.example.com/"
    return url.startsWith(base) ? url.slice(base.length) : null
  },
}))

import { isKeptOriginalUrl, resolveVideoSource } from "../video-source.js"

const JOB = "11111111-2222-4333-8444-555555555555"
const OTHER = "99999999-2222-4333-8444-555555555555"
const PREVIEW = `https://cdn.example.com/videos/${JOB}.mp4`
const ORIGINAL = `https://cdn.example.com/videos/${JOB}-master.mov`

const row = (over: Record<string, unknown> = {}, output: Record<string, unknown> = {}): Record<string, unknown> => ({
  user_id: "owner-1",
  is_public: false,
  status: "completed",
  output_data: { videoUrl: PREVIEW, originalVideoUrl: ORIGINAL, ...output },
  ...over,
})

describe("resolveVideoSource (decided 2026-11-22: our own steps read the kept original)", () => {
  const before = process.env.R2_PUBLIC_URL
  beforeEach(() => { process.env.R2_PUBLIC_URL = "https://cdn.example.com" })
  afterEach(() => { process.env.R2_PUBLIC_URL = before })

  it("gives the original of a preview the owner's own completed job names", async () => {
    const readJob = vi.fn().mockResolvedValue(row())
    await expect(resolveVideoSource(PREVIEW, "owner-1", { readJob })).resolves.toEqual({ kind: "original", url: ORIGINAL, previewUrl: PREVIEW, jobId: JOB })
    expect(readJob).toHaveBeenCalledWith(JOB)
  })

  it("reads a merged preview's job by the UUID head of its id", async () => {
    const preview = `https://cdn.example.com/videos/${JOB}-merged.mp4`
    const original = `https://cdn.example.com/videos/${JOB}-merged-master.mp4`
    const readJob = vi.fn().mockResolvedValue(row({}, { videoUrl: preview, originalVideoUrl: original }))
    await expect(resolveVideoSource(preview, "owner-1", { readJob })).resolves.toMatchObject({ kind: "original", url: original, jobId: JOB })
  })

  it("never reads another user's original, unless their job is public and completed (who can already read its output)", async () => {
    const asGiven = { kind: "as-given", url: PREVIEW }
    await expect(resolveVideoSource(PREVIEW, "someone-else", { readJob: vi.fn().mockResolvedValue(row()) })).resolves.toEqual(asGiven)
    await expect(resolveVideoSource(PREVIEW, "someone-else", { readJob: vi.fn().mockResolvedValue(row({ is_public: true })) })).resolves.toMatchObject({ kind: "original" })
  })

  it("reads the url as given with no owner, for a url not ours, and for a key that is not a preview", async () => {
    const readJob = vi.fn().mockResolvedValue(row())
    await expect(resolveVideoSource(PREVIEW, undefined, { readJob })).resolves.toEqual({ kind: "as-given", url: PREVIEW })
    await expect(resolveVideoSource(`https://elsewhere.example.com/videos/${JOB}.mp4`, "owner-1", { readJob })).resolves.toMatchObject({ kind: "as-given" })
    await expect(resolveVideoSource(ORIGINAL, "owner-1", { readJob })).resolves.toMatchObject({ kind: "as-given" })
    await expect(resolveVideoSource(`https://cdn.example.com/images/${JOB}.png`, "owner-1", { readJob })).resolves.toMatchObject({ kind: "as-given" })
    expect(readJob).not.toHaveBeenCalled()
  })

  it("only the live row proves it: a job not found, not completed, erased, or naming another object reads the url as given", async () => {
    const cases: Array<Record<string, unknown> | null> = [
      null,
      row({ status: "processing" }),
      row({ output_data: null }),
      row({}, { videoUrl: `https://cdn.example.com/videos/${OTHER}.mp4` }),
      row({}, { originalVideoUrl: undefined }),
      // An original outside the preview's own key family is never given.
      row({}, { originalVideoUrl: `https://cdn.example.com/videos/${OTHER}-master.mp4` }),
      row({}, { originalVideoUrl: `https://cdn.example.com/videos/${JOB}-raw.mp4` }),
      row({}, { originalVideoUrl: "https://elsewhere.example.com/x.mp4" }),
    ]
    for (const r of cases) {
      await expect(resolveVideoSource(PREVIEW, "owner-1", { readJob: vi.fn().mockResolvedValue(r) })).resolves.toEqual({ kind: "as-given", url: PREVIEW })
    }
  })

  it("a row read that fails reads the url as given (never throws)", async () => {
    const readJob = vi.fn().mockRejectedValue(new Error("db down"))
    await expect(resolveVideoSource(PREVIEW, "owner-1", { readJob })).resolves.toEqual({ kind: "as-given", url: PREVIEW })
  })

  it("knows a kept original's own url", async () => {
    await expect(isKeptOriginalUrl(ORIGINAL)).resolves.toBe(true)
    await expect(isKeptOriginalUrl(PREVIEW)).resolves.toBe(false)
    await expect(isKeptOriginalUrl("https://elsewhere.example.com/videos/x-master.mov")).resolves.toBe(false)
  })
})
