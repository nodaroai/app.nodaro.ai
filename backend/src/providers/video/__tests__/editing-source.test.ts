// @test-reads-none writes and reads only its own temp folder
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  probeMatched: vi.fn(),
  encodeEditingSource: vi.fn(),
  budgetMiB: 20_000,
  resolve: vi.fn(),
  isKeptOriginalUrl: vi.fn(),
}))

vi.mock("../ffmpeg-utils.js", () => ({ downloadFile: m.downloadFile }))
vi.mock("../matched-encode.js", () => ({ probeMatched: m.probeMatched }))
vi.mock("../browser-safe-preview.js", () => ({
  encodeEditingSource: m.encodeEditingSource,
  previewChangesFile: (p: { videoCodec?: string; pixFmt?: string }) => !(p.videoCodec === "h264" && p.pixFmt === "yuv420p"),
  previewPeakMemoryMiB: () => 2_000,
  previewAllowanceMs: (p: { durationSec?: number }) => (p.durationSec === undefined ? undefined : p.durationSec * 1000),
  previewTimeoutMs: () => 30 * 60 * 1000,
}))
vi.mock("../ffmpeg-admission-instance.js", () => ({ ffmpegMemoryBudgetNow: () => ({ budgetMiB: m.budgetMiB }) }))
vi.mock("../../../lib/video-source.js", () => ({ resolveVideoSource: m.resolve, isKeptOriginalUrl: m.isKeptOriginalUrl }))

import { downloadEditingSource, downloadVideoSource, EDITING_SOURCE_BUDGET_MS, tenBitJoinSource } from "../editing-source.js"
import { addConformSpentMs, conformSpentMs, runWithVideoSourceContext, videoSourceNotices, withVideoSourceNotice } from "../../../lib/video-source-context.js"
import { DrainAbortError } from "../../../lib/worker-drain.js"

const PREVIEW = "https://cdn.example.com/videos/job.mp4"
const ORIGINAL = "https://cdn.example.com/videos/job-master.mov"
const HDR = { videoCodec: "hevc", pixFmt: "yuv420p10le", width: 3840, height: 2160, colorTransfer: "arib-std-b67", durationSec: 10 }
const SDR10 = { videoCodec: "hevc", pixFmt: "yuv420p10le", width: 1920, height: 1080, colorTransfer: "bt709", durationSec: 10 }
const H264 = { videoCodec: "h264", pixFmt: "yuv420p", width: 1920, height: 1080 }

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "editing-source-"))
  vi.clearAllMocks()
  m.budgetMiB = 20_000
  m.downloadFile.mockImplementation(async (url: string, dest: string) => writeFile(dest, `from ${url}`))
  m.encodeEditingSource.mockImplementation(async (input: string, output: string) => writeFile(output, `conformed ${await readFile(input, "utf8")}`))
  m.isKeptOriginalUrl.mockResolvedValue(false)
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const inJob = <T>(fn: () => Promise<T>) => runWithVideoSourceContext("owner-1", fn)

describe("an editing step's source (decided 2026-11-22)", () => {
  it("reads the kept original, conformed by the preview's own chain, when the run may read one", async () => {
    m.resolve.mockResolvedValue({ kind: "original", url: ORIGINAL, previewUrl: PREVIEW, jobId: "job" })
    m.probeMatched.mockResolvedValue(SDR10)
    const dest = join(dir, "input.mp4")
    const read = await inJob(() => downloadEditingSource(PREVIEW, dest))
    expect(read).toEqual({ origin: "original", toneMapped: false })
    expect(await readFile(dest, "utf8")).toBe(`conformed from ${ORIGINAL}`)
    expect(m.resolve).toHaveBeenCalledWith(PREVIEW, "owner-1", undefined)
    expect(m.downloadFile).toHaveBeenCalledTimes(1)
  })

  it("an HDR original is tone-mapped to SDR, and the job's result says so", async () => {
    m.resolve.mockResolvedValue({ kind: "original", url: ORIGINAL, previewUrl: PREVIEW, jobId: "job" })
    m.probeMatched.mockResolvedValue(HDR)
    await inJob(async () => {
      expect(await downloadEditingSource(PREVIEW, join(dir, "in.mp4"))).toEqual({ origin: "original", toneMapped: true })
      expect(videoSourceNotices()).toEqual(["hdr_tone_mapped"])
      expect(withVideoSourceNotice({ videoUrl: "x" })).toEqual({ videoUrl: "x", warningCode: "hdr_tone_mapped", warningMessage: expect.stringContaining("SDR") })
      // A step's own notice is never overwritten.
      expect(withVideoSourceNotice({ videoUrl: "x", warningCode: "own" })).toEqual({ videoUrl: "x", warningCode: "own" })
    })
  })

  it("only ever upgrades: an original it cannot download, or a conform that fails, reads the preview", async () => {
    m.resolve.mockResolvedValue({ kind: "original", url: ORIGINAL, previewUrl: PREVIEW, jobId: "job" })
    m.probeMatched.mockResolvedValue(SDR10)
    m.downloadFile.mockImplementationOnce(async () => { throw new Error("Failed to download (404)") })
    const a = join(dir, "a.mp4")
    expect(await inJob(() => downloadEditingSource(PREVIEW, a))).toEqual({ origin: "preview-fallback", toneMapped: false })
    expect(await readFile(a, "utf8")).toBe(`from ${PREVIEW}`)

    m.encodeEditingSource.mockRejectedValueOnce(Object.assign(new Error("ffmpeg failed"), { killed: false }))
    const b = join(dir, "b.mp4")
    expect(await inJob(() => downloadEditingSource(PREVIEW, b))).toEqual({ origin: "preview-fallback", toneMapped: false })
    expect(await readFile(b, "utf8")).toBe(`from ${PREVIEW}`)
  })

  it("never conforms what the box's ffmpeg memory cannot hold, nor past the job's conform budget", async () => {
    m.resolve.mockResolvedValue({ kind: "original", url: ORIGINAL, previewUrl: PREVIEW, jobId: "job" })
    m.probeMatched.mockResolvedValue(HDR)
    m.budgetMiB = 1_000
    expect(await inJob(() => downloadEditingSource(PREVIEW, join(dir, "c.mp4")))).toMatchObject({ origin: "preview-fallback" })
    m.budgetMiB = 20_000
    expect(await inJob(async () => {
      addConformSpentMs(EDITING_SOURCE_BUDGET_MS)
      return downloadEditingSource(PREVIEW, join(dir, "d.mp4"))
    })).toMatchObject({ origin: "preview-fallback" })
    expect(m.encodeEditingSource).not.toHaveBeenCalled()
  })

  it("never starts a conform whose allowance does not fit what is left, nor one of a picture whose length does not read", async () => {
    m.resolve.mockResolvedValue({ kind: "original", url: ORIGINAL, previewUrl: PREVIEW, jobId: "job" })
    m.probeMatched.mockResolvedValue({ ...SDR10, durationSec: EDITING_SOURCE_BUDGET_MS / 1000 + 1 })
    expect(await inJob(() => downloadEditingSource(PREVIEW, join(dir, "long.mp4")))).toMatchObject({ origin: "preview-fallback" })
    m.probeMatched.mockResolvedValue({ ...SDR10, durationSec: undefined })
    expect(await inJob(() => downloadEditingSource(PREVIEW, join(dir, "unread.mp4")))).toMatchObject({ origin: "preview-fallback" })
    expect(m.encodeEditingSource).not.toHaveBeenCalled()
  })

  it("parallel conforms take their allowance from the budget before they start: two that together exceed it never both run", async () => {
    m.resolve.mockResolvedValue({ kind: "original", url: ORIGINAL, previewUrl: PREVIEW, jobId: "job" })
    // Each reserves 500 s of the 900 s budget.
    m.probeMatched.mockResolvedValue({ ...SDR10, durationSec: 500 })
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => { release = r })
    m.encodeEditingSource.mockImplementation(async (input: string, output: string) => {
      await gate
      await writeFile(output, `conformed ${await readFile(input, "utf8")}`)
    })
    const results = await inJob(async () => {
      const both = Promise.all([downloadEditingSource(PREVIEW, join(dir, "p1.mp4")), downloadEditingSource(PREVIEW, join(dir, "p2.mp4"))])
      setTimeout(release, 20)
      return both
    })
    expect(results.map((r) => r.origin).sort()).toEqual(["original", "preview-fallback"])
    expect(m.encodeEditingSource).toHaveBeenCalledTimes(1)
  })

  it("a conform's clock starts at its admission, and its unused reservation is given back", async () => {
    m.resolve.mockResolvedValue({ kind: "original", url: ORIGINAL, previewUrl: PREVIEW, jobId: "job" })
    m.probeMatched.mockResolvedValue({ ...SDR10, durationSec: 200 })
    // The clock the budget reads, set by hand: no wall time decides this test.
    let clock = 1_000_000
    const now = vi.spyOn(Date, "now").mockImplementation(() => clock)
    let timeout: number | undefined
    m.encodeEditingSource.mockImplementation(async (input: string, output: string, _p: unknown, opts: { onAdmitted?: () => void; timeoutMs: number }) => {
      timeout = opts.timeoutMs
      clock += 90_000 // a long wait for a slot: not conform time
      opts.onAdmitted?.()
      clock += 7_000 // the encode itself
      await writeFile(output, `conformed ${await readFile(input, "utf8")}`)
    })
    try {
      const [read, spent] = await inJob(async () => [await downloadEditingSource(PREVIEW, join(dir, "q.mp4")), conformSpentMs()] as const)
      expect(read.origin).toBe("original")
      expect(timeout).toBe(200_000)
      // The 200 s reservation is given back; only the 7 s after admission is spent.
      expect(spent).toBe(7_000)
    } finally {
      now.mockRestore()
    }
  })

  it("an encode that finished without saying when it was admitted is charged its whole reservation", async () => {
    m.resolve.mockResolvedValue({ kind: "original", url: ORIGINAL, previewUrl: PREVIEW, jobId: "job" })
    m.probeMatched.mockResolvedValue({ ...SDR10, durationSec: 200 })
    const spent = await inJob(async () => {
      await downloadEditingSource(PREVIEW, join(dir, "r.mp4"))
      return conformSpentMs()
    })
    expect(spent).toBe(200_000)
  })

  it("a drain is never read as a failure of this path", async () => {
    m.resolve.mockResolvedValue({ kind: "original", url: ORIGINAL, previewUrl: PREVIEW, jobId: "job" })
    m.probeMatched.mockResolvedValue(SDR10)
    m.encodeEditingSource.mockRejectedValueOnce(new DrainAbortError("drain"))
    await expect(inJob(() => downloadEditingSource(PREVIEW, join(dir, "e.mp4")))).rejects.toBeInstanceOf(DrainAbortError)
  })

  it("a file read as given is left as it is unless it is HDR (then tone-mapped in place) or itself a kept original", async () => {
    m.resolve.mockImplementation(async (url: string) => ({ kind: "as-given", url }))
    m.probeMatched.mockResolvedValue(H264)
    const f = join(dir, "f.mp4")
    expect(await inJob(() => downloadEditingSource(PREVIEW, f))).toEqual({ origin: "as-given", toneMapped: false })
    expect(await readFile(f, "utf8")).toBe(`from ${PREVIEW}`)

    m.probeMatched.mockResolvedValue(SDR10)
    const g = join(dir, "g.mp4")
    expect(await inJob(() => downloadEditingSource("https://upload.example.com/clip.mov", g))).toEqual({ origin: "as-given", toneMapped: false })
    expect(m.encodeEditingSource).not.toHaveBeenCalled()

    m.probeMatched.mockResolvedValue(HDR)
    const h = join(dir, "h.mp4")
    expect(await inJob(() => downloadEditingSource("https://upload.example.com/hdr.mov", h))).toEqual({ origin: "as-given", toneMapped: true })
    expect(await readFile(h, "utf8")).toBe("conformed from https://upload.example.com/hdr.mov")

    m.probeMatched.mockResolvedValue(SDR10)
    m.isKeptOriginalUrl.mockResolvedValueOnce(true)
    const i = join(dir, "i.mp4")
    expect(await inJob(() => downloadEditingSource(ORIGINAL, i))).toEqual({ origin: "as-given", toneMapped: false })
    expect(await readFile(i, "utf8")).toBe(`conformed from ${ORIGINAL}`)
  })

  it("an HDR file whose conform reads longer than the file as given is read as given (its run was priced on that file)", async () => {
    m.resolve.mockImplementation(async (url: string) => ({ kind: "as-given", url }))
    m.probeMatched.mockResolvedValueOnce({ ...HDR, durationSec: 10 }).mockResolvedValueOnce({ ...H264, durationSec: 10.2 })
    const k = join(dir, "longer.mp4")
    expect(await inJob(() => downloadEditingSource(PREVIEW, k))).toEqual({ origin: "as-given", toneMapped: false })
    expect(await readFile(k, "utf8")).toBe(`from ${PREVIEW}`)
  })

  it("an HDR file whose conform fails stays as it was downloaded, as before", async () => {
    m.resolve.mockImplementation(async (url: string) => ({ kind: "as-given", url }))
    m.probeMatched.mockResolvedValue(HDR)
    m.encodeEditingSource.mockRejectedValueOnce(Object.assign(new Error("ffmpeg failed"), { killed: false }))
    const j = join(dir, "j.mp4")
    expect(await inJob(() => downloadEditingSource(PREVIEW, j))).toEqual({ origin: "as-given", toneMapped: false })
    expect(await readFile(j, "utf8")).toBe(`from ${PREVIEW}`)
    expect(await inJob(async () => videoSourceNotices())).toEqual([])
  })

  it("passes the caller's download limits on, and passes none when it gave none", async () => {
    m.resolve.mockImplementation(async (url: string) => ({ kind: "as-given", url }))
    m.probeMatched.mockResolvedValue(H264)
    await inJob(() => downloadEditingSource(PREVIEW, join(dir, "k.mp4")))
    expect(m.downloadFile).toHaveBeenLastCalledWith(PREVIEW, join(dir, "k.mp4"))
    await inJob(() => downloadEditingSource(PREVIEW, join(dir, "l.mp4"), { download: { maxBytes: 10 } }))
    expect(m.downloadFile).toHaveBeenLastCalledWith(PREVIEW, join(dir, "l.mp4"), { maxBytes: 10 })
  })
})

describe("only a job that reads originals takes the new path", () => {
  it("any other job, and a read outside a job, is the plain download it always was (no lookup, no probe)", async () => {
    m.resolve.mockResolvedValue({ kind: "original", url: ORIGINAL, previewUrl: PREVIEW, jobId: "job" })
    m.probeMatched.mockResolvedValue(HDR)
    const a = join(dir, "a.mp4")
    expect(await runWithVideoSourceContext("owner-1", () => downloadEditingSource(PREVIEW, a), { readsOriginals: false })).toEqual({ origin: "as-given", toneMapped: false })
    expect(await readFile(a, "utf8")).toBe(`from ${PREVIEW}`)
    expect(await downloadVideoSource(PREVIEW, join(dir, "b.mp4"))).toEqual({ origin: "as-given" })
    expect(m.resolve).not.toHaveBeenCalled()
    expect(m.probeMatched).not.toHaveBeenCalled()
    expect(m.encodeEditingSource).not.toHaveBeenCalled()
  })
})

describe("a finishing step's source", () => {
  it("is the kept original as it is, else the preview", async () => {
    m.resolve.mockResolvedValue({ kind: "original", url: ORIGINAL, previewUrl: PREVIEW, jobId: "job" })
    m.probeMatched.mockResolvedValue(SDR10)
    const a = join(dir, "a.mp4")
    expect(await inJob(() => downloadVideoSource(PREVIEW, a))).toEqual({ origin: "original" })
    expect(await readFile(a, "utf8")).toBe(`from ${ORIGINAL}`)
    expect(m.encodeEditingSource).not.toHaveBeenCalled()

    m.downloadFile.mockImplementationOnce(async () => { throw new Error("Failed to download (404)") })
    const b = join(dir, "b.mp4")
    expect(await inJob(() => downloadVideoSource(PREVIEW, b))).toEqual({ origin: "preview-fallback" })
    expect(await readFile(b, "utf8")).toBe(`from ${PREVIEW}`)
  })

  it("an original the box's ffmpeg memory cannot hold, at the preview's prediction, reads the preview (the Extend decodes it)", async () => {
    m.resolve.mockResolvedValue({ kind: "original", url: ORIGINAL, previewUrl: PREVIEW, jobId: "job" })
    m.probeMatched.mockResolvedValue(HDR)
    m.budgetMiB = 1_000
    const c = join(dir, "c.mp4")
    expect(await inJob(() => downloadVideoSource(PREVIEW, c))).toEqual({ origin: "preview-fallback" })
    expect(await readFile(c, "utf8")).toBe(`from ${PREVIEW}`)
  })
})

describe("the source an Extend joins onto (decided 2026-11-22)", () => {
  const join10 = (keep = true) => tenBitJoinSource({ sourceUrl: PREVIEW, givenPath: join(dir, "source.mp4"), extensionPath: join(dir, "ext.mp4"), dir, keep })

  it("is the kept original only when both clips are 10-bit of one dynamic range", async () => {
    m.resolve.mockResolvedValue({ kind: "original", url: ORIGINAL, previewUrl: PREVIEW, jobId: "job" })
    m.probeMatched.mockResolvedValue(SDR10)
    const path = await inJob(() => join10())
    expect(path).toBe(join(dir, "source-original"))
    expect(await readFile(path, "utf8")).toBe(`from ${ORIGINAL}`)
  })

  it("is the preview, as before, for every other join: an 8-bit extension, an HDR original beside an SDR extension, a watermarked run, a job that reads no originals, memory it cannot hold", async () => {
    m.resolve.mockResolvedValue({ kind: "original", url: ORIGINAL, previewUrl: PREVIEW, jobId: "job" })
    const given = join(dir, "source.mp4")
    m.probeMatched.mockResolvedValue(H264)
    expect(await inJob(() => join10())).toBe(given)
    expect(m.resolve).not.toHaveBeenCalled()
    m.probeMatched.mockResolvedValueOnce(SDR10).mockResolvedValueOnce(HDR)
    expect(await inJob(() => join10())).toBe(given)
    m.probeMatched.mockResolvedValue(SDR10)
    expect(await inJob(() => join10(false))).toBe(given)
    expect(await runWithVideoSourceContext("owner-1", () => join10(), { readsOriginals: false })).toBe(given)
    // The stitch's own prediction for two 1080p inputs is well above this.
    m.budgetMiB = 100
    expect(await inJob(() => join10())).toBe(given)
  })
})
