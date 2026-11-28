/**
 * The file a Download of a video result gives (lib/video-download-original.ts,
 * decided 2026-11-22): the kept original its job names beside the preview,
 * else the address itself. The job's own record is the proof; the address's
 * key, not its text, is compared.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  error: null as { message: string } | null,
  throws: false,
  filters: [] as Array<[string, string, unknown]>,
  selects: [] as string[],
}))

vi.mock("../config.js", () => ({ config: { R2_PUBLIC_URL: "https://cdn.test", R2_PUBLIC_FALLBACK_DOMAIN: "pub-fallback.test" } }))
vi.mock("../supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (m.throws) throw new Error("database unreachable")
      const chain = {
        select: (columns: string) => {
          m.selects.push(`${table}:${columns}`)
          return chain
        },
        eq: (column: string, value: unknown) => {
          m.filters.push(["eq", column, value])
          return chain
        },
        is: (column: string, value: unknown) => {
          m.filters.push(["is", column, value])
          return chain
        },
        maybeSingle: async () => ({ data: m.row, error: m.error }),
      }
      return chain
    },
  },
}))

import { keptOriginalNamedBeside, videoDownloadTargetOf } from "../video-download-original.js"

const JOB = "00000000-0000-4000-8000-0000000000aa"
const PREVIEW = `https://cdn.test/videos/${JOB}.mp4`
const ORIGINAL = `https://cdn.test/videos/${JOB}-master.mov`

beforeEach(() => {
  m.row = null
  m.error = null
  m.throws = false
  m.filters = []
  m.selects = []
})

describe("keptOriginalNamedBeside (pure)", () => {
  it("gives the original an output names beside the very preview asked for", () => {
    expect(keptOriginalNamedBeside(PREVIEW, { videoUrl: PREVIEW, originalVideoUrl: ORIGINAL })).toBe(ORIGINAL)
  })

  it("compares keys, so the fallback host and a percent-escape find the same preview", () => {
    expect(keptOriginalNamedBeside(`https://pub-fallback.test/videos/${JOB}.mp4`, { videoUrl: PREVIEW, originalVideoUrl: ORIGINAL })).toBe(ORIGINAL)
    expect(keptOriginalNamedBeside(`https://cdn.test/videos/${JOB}%2Emp4`, { videoUrl: PREVIEW, originalVideoUrl: ORIGINAL })).toBe(ORIGINAL)
  })

  it("keeps every container an original is stored as", () => {
    for (const ext of ["mp4", "mov", "webm", "mkv"]) {
      const original = `https://cdn.test/videos/${JOB}-master.${ext}`
      expect(keptOriginalNamedBeside(PREVIEW, { videoUrl: PREVIEW, originalVideoUrl: original })).toBe(original)
    }
  })

  it("a preview in the job's family (`<id>-merged`) has its own original", () => {
    const merged = `https://cdn.test/videos/${JOB}-merged.mp4`
    const mergedOriginal = `https://cdn.test/videos/${JOB}-merged-master.mp4`
    expect(keptOriginalNamedBeside(merged, { videoUrl: merged, originalVideoUrl: mergedOriginal })).toBe(mergedOriginal)
    // Never the job's other original.
    expect(keptOriginalNamedBeside(merged, { videoUrl: merged, originalVideoUrl: ORIGINAL })).toBeUndefined()
  })

  it("gives nothing when the output names no original (a watermarked run, an H.264 8-bit file)", () => {
    expect(keptOriginalNamedBeside(PREVIEW, { videoUrl: PREVIEW })).toBeUndefined()
    expect(keptOriginalNamedBeside(PREVIEW, null)).toBeUndefined()
  })

  it("gives nothing when the output's videoUrl is another file", () => {
    const other = "00000000-0000-4000-8000-0000000000bb"
    expect(keptOriginalNamedBeside(PREVIEW, { videoUrl: `https://cdn.test/videos/${other}.mp4`, originalVideoUrl: ORIGINAL })).toBeUndefined()
  })

  it("never points a Download outside the preview's own key family or off our storage", () => {
    const other = "00000000-0000-4000-8000-0000000000bb"
    expect(keptOriginalNamedBeside(PREVIEW, { videoUrl: PREVIEW, originalVideoUrl: `https://cdn.test/videos/${other}-master.mov` })).toBeUndefined()
    expect(keptOriginalNamedBeside(PREVIEW, { videoUrl: PREVIEW, originalVideoUrl: `https://cdn.test/images/${JOB}-master.png` })).toBeUndefined()
    expect(keptOriginalNamedBeside(PREVIEW, { videoUrl: PREVIEW, originalVideoUrl: `https://evil.test/videos/${JOB}-master.mov` })).toBeUndefined()
    expect(keptOriginalNamedBeside(PREVIEW, { videoUrl: PREVIEW, originalVideoUrl: 42 })).toBeUndefined()
  })

  it("an address that is no preview has no original beside it", () => {
    expect(keptOriginalNamedBeside(ORIGINAL, { videoUrl: ORIGINAL, originalVideoUrl: ORIGINAL })).toBeUndefined()
    expect(keptOriginalNamedBeside(`https://cdn.test/images/${JOB}.png`, { videoUrl: PREVIEW, originalVideoUrl: ORIGINAL })).toBeUndefined()
    expect(keptOriginalNamedBeside(`https://evil.test/videos/${JOB}.mp4`, { videoUrl: PREVIEW, originalVideoUrl: ORIGINAL })).toBeUndefined()
  })
})

describe("videoDownloadTargetOf", () => {
  it("reads the preview's own job: completed, not in the Trash, the two fields only", async () => {
    m.row = { videoUrl: PREVIEW, originalVideoUrl: ORIGINAL }
    expect(await videoDownloadTargetOf(PREVIEW)).toEqual({ url: ORIGINAL, isOriginal: true })
    expect(m.selects).toEqual(["jobs:videoUrl:output_data->>videoUrl, originalVideoUrl:output_data->>originalVideoUrl"])
    expect(m.filters).toEqual([
      ["eq", "id", JOB],
      ["eq", "status", "completed"],
      ["is", "deleted_at", null],
    ])
  })

  it("a job that completed on its original downloads that file as an original, with no read", async () => {
    expect(await videoDownloadTargetOf(ORIGINAL)).toEqual({ url: ORIGINAL, isOriginal: true })
    expect(m.selects).toEqual([])
  })

  it("gives the address itself when the job names no original, is gone, or cannot be read", async () => {
    const itself = { url: PREVIEW, isOriginal: false }
    m.row = { videoUrl: PREVIEW, originalVideoUrl: null }
    expect(await videoDownloadTargetOf(PREVIEW)).toEqual(itself)
    m.row = null
    expect(await videoDownloadTargetOf(PREVIEW)).toEqual(itself)
    m.row = { videoUrl: PREVIEW, originalVideoUrl: ORIGINAL }
    m.error = { message: "timeout" }
    expect(await videoDownloadTargetOf(PREVIEW)).toEqual(itself)
    m.error = null
    m.throws = true
    expect(await videoDownloadTargetOf(PREVIEW)).toEqual(itself)
  })

  it("asks nothing for an image, an upload, another host or a key with no job id", async () => {
    for (const url of [
      `https://cdn.test/images/${JOB}.png`,
      "https://cdn.test/uploads/abc/clip.mp4",
      `https://evil.test/videos/${JOB}.mp4`,
      "https://cdn.test/videos/not-a-job.mp4",
    ]) {
      expect(await videoDownloadTargetOf(url)).toEqual({ url, isOriginal: false })
    }
    expect(m.selects).toEqual([])
  })
})
