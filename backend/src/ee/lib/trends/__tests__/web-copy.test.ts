// @test-reads-none reads only the temp clips it makes with ffmpeg and the copies the stubbed upload keeps
/**
 * A shown trend video's web copy (ee/lib/trends/web-copy.ts).
 *
 * What must hold:
 *  - the encode is exactly the web copy's recipe: H.264 High / yuv420p at
 *    CRF 23 capped at 3 Mbit/s (6 Mbit buffer), preset medium; AAC 160 kbit/s
 *    stereo at 44.1 or 48 kHz; faststart; the first picture and sound only;
 *  - a video up to 1080 on its short side keeps its size (even sides), a
 *    larger one is scaled to 1080 on the short side, judged on the decoded
 *    (rotated) frame;
 *  - the copy is a new file under `trends/<trendId>/<uuid>.mp4`, with its size;
 *    a video that cannot be fetched or encoded stores nothing;
 *  - `makeWebCopies` makes one copy per shown video lacking one, one at a
 *    time, pinned to the video it stands for, keeps going past a failure, and
 *    attaches only what was made; `startWebCopies` never throws, never starts
 *    a version twice at once, and logs what failed.
 *
 * The upload and the attach are stubbed; downloads read local files. The real
 * ffmpeg tests run only where ffmpeg and ffprobe are on PATH (CI installs the
 * production one).
 */
import { execFileSync } from "node:child_process"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const fx = vi.hoisted(() => ({
  keepDir: "",
  uploads: [] as Array<{ key: string; contentType: string; kept: string }>,
  attach: vi.fn(),
}))

vi.mock("../../../../lib/storage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/storage.js")>()
  const { copyFile } = await import("node:fs/promises")
  const { join: joinPath } = await import("node:path")
  return {
    ...actual,
    uploadFileWithKeyToR2: vi.fn(async (file: string, key: string, contentType: string) => {
      const kept = joinPath(fx.keepDir, key.replaceAll("/", "_"))
      await copyFile(file, kept)
      fx.uploads.push({ key, contentType, kept })
      return `https://cdn.test/${key}`
    }),
  }
})

vi.mock("../../../../providers/video/ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../providers/video/ffmpeg-utils.js")>()
  const { copyFile } = await import("node:fs/promises")
  // "https://files.test/<absolute path>" is that local file.
  return {
    ...actual,
    downloadFile: vi.fn(async (url: string, dest: string) => copyFile(decodeURIComponent(new URL(url).pathname), dest)),
    runFfmpeg: vi.fn(actual.runFfmpeg),
  }
})

vi.mock("../store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../store.js")>()),
  attachWebCopies: fx.attach,
}))
vi.mock("../../../../lib/supabase.js", () => ({ supabase: { from: () => { throw new Error("web copies reach the database only through the store") } } }))

import { downloadFile, runFfmpeg } from "../../../../providers/video/ffmpeg-utils.js"
import { TrendMediaError } from "../media.js"
import type { TrendVersionData } from "../types.js"
import { makeWebCopies, makeWebCopy, startWebCopies, webCopyArgs, webCopyAudioRate, WEB_COPY_TIMEOUT_MS } from "../web-copy.js"

const TREND = "00000000-0000-4000-8000-0000000000a1"
const url = (path: string) => `https://files.test${path}`

function has(bin: string): boolean {
  try {
    execFileSync(bin, ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}
const ffmpegAvailable = has("ffmpeg") && has("ffprobe")

let sandbox = ""
beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "trend-web-test-"))
  fx.keepDir = await mkdtemp(join(sandbox, "kept-"))
})
afterAll(async () => {
  await rm(sandbox, { recursive: true, force: true })
})
beforeEach(() => {
  fx.uploads = []
  fx.attach.mockReset().mockImplementation(async (_t: string, _v: number, copies: unknown[]) => ({ set: copies.length, already: 0, stale: 0 }))
  vi.mocked(runFfmpeg).mockClear()
  vi.mocked(downloadFile).mockClear()
})

describe("webCopyArgs", () => {
  it("is exactly the web copy's recipe", () => {
    expect(webCopyArgs("/in", "/out.mp4", { audioRate: 44100 })).toEqual([
      "-y", "-i", "/in",
      "-map", "0:v:0", "-map", "0:a:0?",
      "-map_metadata", "-1", "-map_chapters", "-1",
      "-vf", "scale=w='if(lte(iw,ih),trunc(min(iw,1080)/2)*2,-2)':h='if(lte(iw,ih),-2,trunc(min(ih,1080)/2)*2)',setsar=1",
      "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-maxrate", "3M", "-bufsize", "6M",
      "-profile:v", "high", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k", "-ac", "2", "-ar", "44100",
      "-movflags", "+faststart",
      "/out.mp4",
    ])
  })

  it("writes the sound at the source's rate when it is 44.1 kHz, else at 48 kHz", () => {
    expect(webCopyAudioRate(44100)).toBe(44100)
    for (const rate of [48000, 22050, 96000, 32000, undefined]) expect(webCopyAudioRate(rate)).toBe(48000)
    expect(webCopyArgs("/in", "/out.mp4", { audioRate: 48000 })).toContain("48000")
  })
})

function makeClip(path: string, opts: { size: string; rotate?: number; audioRate?: number; audio?: boolean }): void {
  const tmp = opts.rotate === undefined ? path : `${path}.raw.mp4`
  execFileSync("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", `testsrc2=s=${opts.size}:r=24:d=1.5`,
    ...(opts.audio === false ? [] : ["-f", "lavfi", "-i", `sine=f=440:r=${opts.audioRate ?? 48000}:d=1.5`]),
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    ...(opts.audio === false ? [] : ["-c:a", "aac", "-b:a", "96k", "-ac", "1"]),
    "-shortest", tmp,
  ])
  if (opts.rotate !== undefined) execFileSync("ffmpeg", ["-v", "error", "-y", "-display_rotation", String(opts.rotate), "-i", tmp, "-c", "copy", path])
}

interface Probed {
  video: { codec_name: string; profile: string; width: number; height: number; pix_fmt: string; sample_aspect_ratio?: string }
  audio?: { codec_name: string; channels: number; sample_rate: string; bit_rate: string }
}
function probe(path: string): Probed {
  const out = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,profile,width,height,pix_fmt,sample_aspect_ratio,channels,sample_rate,bit_rate", "-of", "json", path]).toString())
  const streams = out.streams as Array<Record<string, unknown>>
  return {
    video: streams.find((s) => s.codec_type === "video") as unknown as Probed["video"],
    audio: streams.find((s) => s.codec_type === "audio") as unknown as Probed["audio"],
  }
}

/** Whether the file's `moov` box comes before its `mdat` (faststart). */
async function moovFirst(path: string): Promise<boolean> {
  const { readFile } = await import("node:fs/promises")
  const bytes = await readFile(path)
  return bytes.indexOf("moov") !== -1 && bytes.indexOf("moov") < bytes.indexOf("mdat")
}

describe.skipIf(!ffmpegAvailable)("makeWebCopy (real ffmpeg)", () => {
  it.each([
    ["a portrait clip under 1080 keeps its size", { size: "720x1280" }, [720, 1280]],
    ["an odd-sized clip gets even sides", { size: "721x1281" }, [720, 1280]],
    ["a 4K landscape clip is scaled to 1080 on its short side", { size: "3840x2160" }, [1920, 1080]],
    ["a 4K portrait clip is scaled to 1080 on its short side", { size: "2160x3840" }, [1080, 1920]],
    ["a landscape-stored clip tagged to show portrait is judged as shown", { size: "3840x2160", rotate: 90 }, [1080, 1920]],
  ] as const)("%s, H.264 High with AAC 160 kbit/s stereo, faststart", async (_name, clip, [w, h]) => {
    const src = join(sandbox, `src-${clip.size}-${"rotate" in clip ? clip.rotate : 0}.mp4`)
    makeClip(src, clip)
    const made = await makeWebCopy(TREND, url(src))

    expect(fx.uploads).toHaveLength(1)
    const up = fx.uploads[0]!
    expect(up.key).toMatch(new RegExp(`^trends/${TREND}/[0-9a-f-]{36}\\.mp4$`))
    expect(up.contentType).toBe("video/mp4")
    expect(made).toEqual({ videoUrl: `https://cdn.test/${up.key}`, sizeBytes: (await stat(up.kept)).size })

    const p = probe(up.kept)
    expect(p.video).toMatchObject({ codec_name: "h264", profile: "High", width: w, height: h, pix_fmt: "yuv420p" })
    expect(p.video.sample_aspect_ratio ?? "1:1").toBe("1:1")
    expect(p.audio).toMatchObject({ codec_name: "aac", channels: 2, sample_rate: "48000" })
    // A 1.5 s sine at 160k: the encoder's own rate lands near it (AAC holds a mono tone well under its target).
    expect(Number(p.audio!.bit_rate)).toBeGreaterThan(60_000)
    expect(await moovFirst(up.kept)).toBe(true)
    // Admitted and bounded as a re-encode is.
    const launch = vi.mocked(runFfmpeg).mock.calls[0]!
    expect(launch[1]).toBe(WEB_COPY_TIMEOUT_MS)
    expect((launch[2] as { peakMemoryMiB: number }).peakMemoryMiB).toBeGreaterThan(0)
  }, 60_000)

  it("keeps 44.1 kHz sound at 44.1 kHz, and a silent clip stays silent", async () => {
    const cd = join(sandbox, "cd.mp4")
    makeClip(cd, { size: "640x360", audioRate: 44100 })
    await makeWebCopy(TREND, url(cd))
    expect(probe(fx.uploads[0]!.kept).audio).toMatchObject({ sample_rate: "44100", channels: 2 })

    const silent = join(sandbox, "silent.mp4")
    makeClip(silent, { size: "640x360", audio: false })
    await makeWebCopy(TREND, url(silent))
    expect(probe(fx.uploads[1]!.kept).audio).toBeUndefined()
  }, 60_000)

  it("a file that is not a video is media_unreadable, and nothing is stored", async () => {
    const { writeFile } = await import("node:fs/promises")
    const junk = join(sandbox, "junk.mp4")
    await writeFile(junk, "not a video")
    const err = await makeWebCopy(TREND, url(junk)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TrendMediaError)
    expect((err as TrendMediaError).code).toBe("media_unreadable")
    expect(fx.uploads).toEqual([])
  })
})

describe("makeWebCopy (stubbed download)", () => {
  it("a video that cannot be fetched is download_failed, and nothing is encoded or stored", async () => {
    vi.mocked(downloadFile).mockRejectedValueOnce(new Error("blocked address"))
    const err = await makeWebCopy(TREND, "https://files.test/nowhere.mp4").catch((e: unknown) => e)
    expect((err as TrendMediaError).code).toBe("download_failed")
    expect(runFfmpeg).not.toHaveBeenCalled()
    expect(fx.uploads).toEqual([])
  })
})

const SRC = "https://cdn.test/trends/t/src.mov"
const DISPLAY = { videoUrl: "https://cdn.test/trends/t/display.mp4", posterUrl: "https://cdn.test/trends/t/d.png", width: 720, height: 1280, durationSec: 12 }
const EX = (n: number) => ({ videoUrl: `https://cdn.test/trends/t/ex${n}.mp4`, width: 720, height: 1280, durationSec: 12, slots: {}, sourceJobId: `job-${n}` })
const DATA: TrendVersionData = {
  name: { en: "Neon" },
  source: { videoUrl: SRC, durationSec: 12, display: DISPLAY },
  previewStart: null,
  slots: [],
  references: [],
  examples: [EX(1), EX(2)],
}
const made = (from: string) => ({ videoUrl: from.replace(/\.(mp4|mov)$/, "-web.mp4"), sizeBytes: 1000 })

describe("makeWebCopies", () => {
  it("makes one copy per shown video lacking one, one at a time, pinned to what it stands for, and attaches them", async () => {
    let running = 0
    const order: string[] = []
    const make = vi.fn(async (_trend: string, from: string) => {
      running += 1
      expect(running).toBe(1)
      order.push(from)
      await new Promise((r) => setTimeout(r, 1))
      running -= 1
      return made(from)
    })
    const r = await makeWebCopies(TREND, 3, DATA, { make })
    // The original from its uploaded clip (the fuller sound), each example from its own video.
    expect(order).toEqual([SRC, EX(1).videoUrl, EX(2).videoUrl])
    expect(fx.attach).toHaveBeenCalledTimes(1)
    expect(fx.attach).toHaveBeenCalledWith(TREND, 3, [
      { ...made(SRC), madeFrom: DISPLAY.videoUrl },
      { ...made(EX(1).videoUrl), madeFrom: EX(1).videoUrl },
      { ...made(EX(2).videoUrl), madeFrom: EX(2).videoUrl },
    ])
    expect(r.attached).toEqual({ set: 3, already: 0, stale: 0 })
  })

  it("a video whose copy fails is left without; the others are still made and attached", async () => {
    const make = vi.fn(async (_t: string, from: string) => {
      if (from === EX(1).videoUrl) throw new TrendMediaError("media_unreadable", "nope")
      return made(from)
    })
    const seen: string[] = []
    const r = await makeWebCopies(TREND, 3, DATA, { make, onEach: (o) => seen.push(`${o.target.label}:${o.copy ? "ok" : "failed"}`) })
    expect(seen).toEqual(["original:ok", "example 1:failed", "example 2:ok"])
    expect(fx.attach.mock.calls[0]![2]).toHaveLength(2)
    expect(r.outcomes[1]!.error).toBeInstanceOf(TrendMediaError)
  })

  it("nothing made (every copy failed, or none was needed) attaches nothing", async () => {
    const failing = vi.fn(async () => {
      throw new Error("down")
    })
    expect((await makeWebCopies(TREND, 3, DATA, { make: failing })).attached).toBeUndefined()
    const current = (from: string) => ({ videoUrl: `${from}-web.mp4`, sizeBytes: 1, madeFrom: from })
    const done: TrendVersionData = {
      ...DATA,
      source: { ...DATA.source!, display: { ...DISPLAY, web: current(DISPLAY.videoUrl) } },
      examples: DATA.examples.map((e) => ({ ...e, web: current(e.videoUrl) })),
    }
    const make = vi.fn()
    expect((await makeWebCopies(TREND, 3, done, { make })).outcomes).toEqual([])
    expect(make).not.toHaveBeenCalled()
    expect(fx.attach).not.toHaveBeenCalled()
  })
})

describe("startWebCopies (a publish's background work)", () => {
  const log = () => ({ info: vi.fn(), warn: vi.fn() })

  it("never throws or rejects, even when every copy and the attach fail; each failure is logged", async () => {
    vi.mocked(downloadFile).mockRejectedValue(new Error("offline"))
    fx.attach.mockRejectedValue(new Error("db down"))
    const l = log()
    let work!: Promise<void>
    expect(() => {
      work = startWebCopies(TREND, 7, DATA, l)
    }).not.toThrow()
    await expect(work).resolves.toBeUndefined()
    expect(l.warn).toHaveBeenCalledTimes(3)
    expect(l.warn.mock.calls.map((c) => (c[0] as { video: string }).video)).toEqual(["original", "example 1", "example 2"])
    vi.mocked(downloadFile).mockReset()

    // Copies made, the attach failing: logged, never thrown.
    const l2 = log()
    await expect(startWebCopies(TREND, 9, DATA, l2, { make: async (_t, from) => made(from) })).resolves.toBeUndefined()
    expect(l2.warn).toHaveBeenCalledWith(expect.objectContaining({ trendId: TREND, version: 9 }), "trends: web copies could not be attached")
    expect(l2.info).not.toHaveBeenCalled()
  })

  it("logs what it attached", async () => {
    const l = log()
    await startWebCopies(TREND, 10, DATA, l, { make: async (_t, from) => made(from) })
    expect(l.info).toHaveBeenCalledWith({ trendId: TREND, version: 10, set: 3, already: 0, stale: 0 }, "trends: web copies attached")
    expect(l.warn).not.toHaveBeenCalled()
  })

  it("a version already in the making in this process is not started twice; once done, it may start again", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const make = vi.fn(async (_t: string, from: string) => {
      await gate
      return made(from)
    })
    const l = log()
    const first = startWebCopies(TREND, 8, DATA, l, { make })
    await new Promise((r) => setTimeout(r, 5))
    await startWebCopies(TREND, 8, DATA, l, { make })
    expect(make).toHaveBeenCalledTimes(1)
    release()
    await first
    expect(make).toHaveBeenCalledTimes(3)
    // Once done, the same version may start again.
    await startWebCopies(TREND, 8, DATA, l, { make })
    expect(make).toHaveBeenCalledTimes(6)
  })
})
