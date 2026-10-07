/**
 * WHAT A RE-ENCODING yt-dlp RUN TELLS ITS OWN ffmpeg, AND WHAT IT RESERVES FOR IT
 * (round 4 of #1860, decided 2026-10-05).
 *
 * yt-dlp's ffmpeg is not the backend's launcher: it counted the host's cores for
 * its decoders, filter graph and x264 frame threads, and a run reserved one flat
 * default whatever it asked for. Now the argv a transcoding run spawns carries the
 * quota's thread counts — in the places yt-dlp routes them to the downloader and to
 * each encoding post-processor — and the reservation is the measured canvas model
 * at the requested format's resolution (the audio estimate for an audio extraction).
 *
 * The routing rules were probed against yt-dlp's source and a logging ffmpeg shim:
 * a bare `ffmpeg_i:`/`ffmpeg_o:` post-processor key reaches NOTHING (only the
 * downloader), so the post-processor's own name is part of the key.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { EventEmitter } from "node:events"
import type { FfmpegThreads } from "../ffmpeg-threads.js"

type FakeProc = EventEmitter & { kill: ReturnType<typeof vi.fn>; stdout: EventEmitter; stderr: EventEmitter; pid?: number }
const fx = vi.hoisted(() => ({
  slots: [] as Array<{ peakMemoryMiB?: number; label?: string }>,
  spawned: [] as Array<{ args: string[] }>,
  procs: [] as FakeProc[],
  /** What `ffmpegThreads()` places on this "box" (undefined: no quota below the cores). */
  placed: undefined as { decode: number; filter: number; encode: number } | undefined,
  /** What `ffmpegEffectiveThreads()` says a launch runs with. */
  effective: { decode: 8, filter: 8, encode: 12 } as { decode: number; filter: number; encode: number },
}))

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: vi.fn((_bin: string, args: string[]) => {
    const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(), pid: undefined })
    fx.spawned.push({ args })
    fx.procs.push(proc)
    return proc
  }),
}))
vi.mock("../yt-proxy.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../yt-proxy.js")>()),
  resolveAttemptChain: () => [null],
}))
vi.mock("../ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ffmpeg-utils.js")>()
  return {
    ...actual,
    withFfmpegSlot: async (fn: () => Promise<unknown>, opts: { peakMemoryMiB?: number; label?: string }) => {
      fx.slots.push({ peakMemoryMiB: opts.peakMemoryMiB, label: opts.label })
      return fn()
    },
  }
})
vi.mock("../ffmpeg-threads.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ffmpeg-threads.js")>()),
  ffmpegThreads: () => fx.placed,
  ffmpegEffectiveThreads: () => fx.placed ?? fx.effective,
}))

import { audioPeakMemoryMiB, canvasPeakMemoryMiB } from "../ffmpeg-memory-model.js"
import { YTDLP_ENCODING_POSTPROCESSORS, ytDlpPeakMemoryMiB, ytDlpThreadArgs } from "../ytdlp-ffmpeg-limits.js"
import { ytDlpTranscodeReason } from "../ytdlp-transcode.js"
import { buildYtDlpSectionStreamArgs, buildYtDlpVideoArgs, spawnYtDlpDownload } from "../youtube-video.js"
import { buildYtAudioExtractionArgs } from "../../audio/youtube-extractor.js"
import { SECTION_HD_AUDIO_SELECTOR, sectionHdVideoSelector } from "../video-format.js"

const URL_ = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
const SECTION = { startSec: 60, endSec: 120 }
const same = (t: number): FfmpegThreads => ({ decode: t, filter: t, encode: t })
const UHD = { width: 3840, height: 2160 }

describe("ytDlpThreadArgs — the quota's counts, where yt-dlp routes them", () => {
  it("gives the downloader and EVERY encoding post-processor decode threads before -i and filter + encode threads before the output", () => {
    const args = ytDlpThreadArgs({ decode: 3, filter: 4, encode: 5 })
    const pairs: Array<[string, string]> = []
    for (let i = 0; i < args.length; i += 2) pairs.push([args[i]!, args[i + 1]!])
    expect(pairs).toContainEqual(["--downloader-args", "ffmpeg_i:-threads 3"])
    expect(pairs).toContainEqual(["--downloader-args", "ffmpeg_o:-filter_threads 4 -filter_complex_threads 4 -threads 5"])
    for (const pp of YTDLP_ENCODING_POSTPROCESSORS) {
      expect(pairs).toContainEqual(["--postprocessor-args", `${pp}+ffmpeg_i:-threads 3`])
      expect(pairs).toContainEqual(["--postprocessor-args", `${pp}+ffmpeg_o:-filter_threads 4 -filter_complex_threads 4 -threads 5`])
    }
    expect(pairs).toHaveLength(2 + 2 * YTDLP_ENCODING_POSTPROCESSORS.length)
  })

  it("names the post-processors the classifier's transcoding rows start (audio conversion, recode, cuts by chapter)", () => {
    expect([...YTDLP_ENCODING_POSTPROCESSORS]).toEqual(["ExtractAudio", "VideoConvertor", "ModifyChapters", "SplitChapters"])
  })

  it("never uses a bare post-processor key, which yt-dlp routes to the downloader or the output side only", () => {
    const flags = ytDlpThreadArgs(same(2))
    const ppKeys = flags.filter((_, i) => flags[i - 1] === "--postprocessor-args")
    for (const key of ppKeys) expect(key).toMatch(/^[A-Z][A-Za-z]+\+ffmpeg_[io]:/)
  })

  it("is empty when no quota sits below the cores ffmpeg counts", () => {
    expect(ytDlpThreadArgs(undefined)).toEqual([])
  })

  it("does not change what the classifier says of a run", () => {
    const args = buildYtDlpVideoArgs({ url: URL_, outPath: "/tmp/o.mp4", section: SECTION, proxyArgs: [] })
    expect(ytDlpTranscodeReason([...args, ...ytDlpThreadArgs(same(2))])).toBe(ytDlpTranscodeReason(args))
  })
})

describe("ytDlpPeakMemoryMiB — sized by the requested format", () => {
  const sec = (format: string) => buildYtDlpSectionStreamArgs({ url: URL_, outTemplate: "/tmp/o.%(ext)s", format, section: SECTION, proxyArgs: [] })

  it("an HD section's video half reserves the canvas model at its height cap, 16:9, one segment, at the threads it runs with", () => {
    const t = same(8)
    expect(ytDlpPeakMemoryMiB(sec(sectionHdVideoSelector(720)), t)).toBe(canvasPeakMemoryMiB({ width: 1280, height: 720 }, 1, t))
    expect(ytDlpPeakMemoryMiB(sec(sectionHdVideoSelector(1080)), t)).toBe(canvasPeakMemoryMiB({ width: 1920, height: 1080 }, 1, t))
    expect(ytDlpPeakMemoryMiB(sec(sectionHdVideoSelector(720)), t)).toBeLessThan(ytDlpPeakMemoryMiB(sec(sectionHdVideoSelector(1080)), t))
  })

  it("the progressive section fallback reads its cap from the selector too", () => {
    const args = buildYtDlpVideoArgs({ url: URL_, outPath: "/tmp/o.mp4", maxHeight: 480, section: SECTION, proxyArgs: [] })
    expect(ytDlpPeakMemoryMiB(args, same(4))).toBe(canvasPeakMemoryMiB({ width: 853, height: 480 }, 1, same(4)))
  })

  it("a lane that requests no cap reserves 4K", () => {
    const t = same(8)
    expect(ytDlpPeakMemoryMiB(sec(sectionHdVideoSelector()), t)).toBe(canvasPeakMemoryMiB(UHD, 1, t))
    expect(ytDlpPeakMemoryMiB(buildYtDlpVideoArgs({ url: URL_, outPath: "/tmp/o.mp4", section: SECTION, proxyArgs: [] }), t)).toBe(canvasPeakMemoryMiB(UHD, 1, t))
  })

  it("takes the tallest cap when a selector names several, and an exact height as its own cap", () => {
    expect(ytDlpPeakMemoryMiB(["--format", "bv*[height<=480]/bv*[height<=720]"], same(2))).toBe(canvasPeakMemoryMiB({ width: 1280, height: 720 }, 1, same(2)))
    expect(ytDlpPeakMemoryMiB(["-f", "bv*[height=1080]", "--recode-video", "mp4"], same(2))).toBe(canvasPeakMemoryMiB({ width: 1920, height: 1080 }, 1, same(2)))
  })

  it("an audio extraction reserves the audio estimate, whatever the threads", () => {
    const args = buildYtAudioExtractionArgs(URL_, "/tmp/a.mp3", null)
    expect(ytDlpPeakMemoryMiB(args, same(2))).toBe(audioPeakMemoryMiB())
    expect(ytDlpPeakMemoryMiB(args, same(64))).toBe(audioPeakMemoryMiB())
    expect(ytDlpPeakMemoryMiB(["-x", "--audio-format", "opus"], same(2))).toBe(audioPeakMemoryMiB())
    expect(audioPeakMemoryMiB()).toBeLessThan(canvasPeakMemoryMiB({ width: 640, height: 360 }, 1, same(1)))
  })

  it("an audio-only format (the audio half of an HD section) reserves the audio estimate; a selector that may carry a picture does not", () => {
    expect(ytDlpPeakMemoryMiB(sec(SECTION_HD_AUDIO_SELECTOR), same(8))).toBe(audioPeakMemoryMiB())
    expect(ytDlpPeakMemoryMiB(sec("bestaudio"), same(8))).toBe(audioPeakMemoryMiB())
    for (const picture of ["ba*", "ba/b", "bv*+ba", "wa/ba*"]) {
      expect(ytDlpPeakMemoryMiB(sec(picture), same(8)), picture).toBe(canvasPeakMemoryMiB(UHD, 1, same(8)))
    }
  })

  it("-x with a video encode alongside is still a video run", () => {
    expect(ytDlpPeakMemoryMiB(["-x", "--recode-video", "mp4", "--format", "bv*[height<=720]"], same(2))).toBe(canvasPeakMemoryMiB({ width: 1280, height: 720 }, 1, same(2)))
  })

  it("the reservation follows the threads: 32 threads at 4K are far over 2", () => {
    const args = sec(sectionHdVideoSelector())
    expect(ytDlpPeakMemoryMiB(args, same(32))).toBeGreaterThan(ytDlpPeakMemoryMiB(args, same(2)) + 2_000)
  })
})

describe("the funnel: every transcoding lane spawns the pinned argv and reserves what it requested", () => {
  beforeEach(() => {
    fx.slots = []
    fx.spawned = []
    fx.procs = []
    fx.placed = same(3)
    fx.effective = { decode: 8, filter: 8, encode: 12 }
  })
  afterEach(() => vi.clearAllMocks())

  async function run(args: string[]): Promise<void> {
    const done = spawnYtDlpDownload(args)
    await vi.waitFor(() => expect(fx.spawned).toHaveLength(1))
    fx.procs[0]!.emit("close", 0)
    await done
  }
  const hdVideo = (maxHeight?: number) =>
    buildYtDlpSectionStreamArgs({ url: URL_, outTemplate: "/tmp/o.%(ext)s", format: sectionHdVideoSelector(maxHeight), section: SECTION, proxyArgs: [], writeThumbnail: true })

  it("an HD section's video half: the argv carries the threads, the reservation matches its height", async () => {
    const args = hdVideo(720)
    await run(args)
    expect(fx.spawned[0]!.args).toEqual([...args, ...ytDlpThreadArgs(same(3))])
    expect(fx.spawned[0]!.args).toContain("ffmpeg_i:-threads 3")
    expect(fx.slots).toHaveLength(1)
    expect(fx.slots[0]!.peakMemoryMiB).toBe(canvasPeakMemoryMiB({ width: 1280, height: 720 }, 1, same(3)))
  })

  it("the same lane without a cap reserves 4K", async () => {
    await run(hdVideo())
    expect(fx.slots[0]!.peakMemoryMiB).toBe(canvasPeakMemoryMiB(UHD, 1, same(3)))
  })

  it("an audio extraction: the audio estimate, and the argv still carries the threads", async () => {
    const args = buildYtAudioExtractionArgs(URL_, "/tmp/a.mp3", null)
    await run(args)
    expect(fx.slots[0]!.peakMemoryMiB).toBe(audioPeakMemoryMiB())
    expect(fx.spawned[0]!.args).toContain("ExtractAudio+ffmpeg_i:-threads 3")
    expect(fx.spawned[0]!.args).toContain("ExtractAudio+ffmpeg_o:-filter_threads 3 -filter_complex_threads 3 -threads 3")
  })

  it("the audio half of an HD section reserves the audio estimate", async () => {
    await run(buildYtDlpSectionStreamArgs({ url: URL_, outTemplate: "/tmp/o.%(ext)s", format: SECTION_HD_AUDIO_SELECTOR, section: SECTION, proxyArgs: [] }))
    expect(fx.slots[0]!.peakMemoryMiB).toBe(audioPeakMemoryMiB())
  })

  it("the progressive section fallback reserves for its cap, with the threads in its argv", async () => {
    const args = buildYtDlpVideoArgs({ url: URL_, outPath: "/tmp/o.mp4", maxHeight: 1080, section: SECTION, proxyArgs: [] })
    await run(args)
    expect(fx.slots[0]!.peakMemoryMiB).toBe(canvasPeakMemoryMiB({ width: 1920, height: 1080 }, 1, same(3)))
    expect(fx.spawned[0]!.args).toContain("ffmpeg_o:-filter_threads 3 -filter_complex_threads 3 -threads 3")
  })

  it("with no quota below the cores: the argv is untouched, and the reservation uses the counts ffmpeg picks by itself", async () => {
    fx.placed = undefined
    const args = hdVideo(1080)
    await run(args)
    expect(fx.spawned[0]!.args).toEqual(args)
    expect(fx.slots[0]!.peakMemoryMiB).toBe(canvasPeakMemoryMiB({ width: 1920, height: 1080 }, 1, fx.effective))
  })

  it("a run that only copies streams spawns its own argv and reserves nothing", async () => {
    const args = buildYtDlpVideoArgs({ url: URL_, outPath: "/tmp/o.mp4", proxyArgs: [] })
    await run(args)
    expect(fx.spawned[0]!.args).toEqual(args)
    expect(fx.slots).toHaveLength(0)
  })
})
