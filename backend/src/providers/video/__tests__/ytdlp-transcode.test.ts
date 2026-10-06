/**
 * WHICH yt-dlp RUNS RE-ENCODE, and what the admission does about it (round 3 of
 * #1860, decided 2026-10-05).
 *
 * yt-dlp starts its OWN ffmpeg for post-processing and for section downloads, and
 * that child is not the backend's launcher: left alone it carries no thread counts
 * and no reservation. A run that may RE-ENCODE (a section cut at keyframes is a full
 * video encode at the stream's resolution) is therefore admitted like any other
 * ffmpeg — it holds a slot and a reservation for the whole download, and its argv
 * carries the quota's thread counts (round 4: `ytdlp-ffmpeg-limits.test.ts`). A run that only COPIES streams (merge, remux, a plain section cut)
 * or converts one still image is exempt, with the reason listed here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { EventEmitter } from "node:events"

type FakeProc = EventEmitter & { kill: ReturnType<typeof vi.fn>; stdout: EventEmitter; stderr: EventEmitter; pid?: number }
const spawned = vi.hoisted(() => ({ calls: [] as Array<{ args: string[] }>, procs: [] as FakeProc[] }))
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: vi.fn((_bin: string, args: string[]) => {
    const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(), pid: undefined })
    spawned.calls.push({ args })
    spawned.procs.push(proc)
    return proc
  }),
}))
vi.mock("../yt-proxy.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../yt-proxy.js")>()),
  resolveAttemptChain: () => [null],
}))

import youtubedl from "youtube-dl-exec"

// The library's own argv builder: present at runtime, missing from its typings.
const libraryArgs = (youtubedl as unknown as { args: (flags: Record<string, unknown>) => string[] }).args
import { ytDlpOptionsToArgs, ytDlpTranscodeReason } from "../ytdlp-transcode.js"
import { FetchDeadline, YtDlpHaltError } from "../ytdlp-process.js"
import {
  buildYtDlpSectionStreamArgs,
  buildYtDlpVideoArgs,
  downloadYouTubeVideo,
  runThroughClientLadder,
  runYtDlpCapture,
  spawnYtDlpDownload,
} from "../youtube-video.js"
import { buildYtAudioExtractionArgs } from "../../audio/youtube-extractor.js"
import { socialPostArgs } from "../social-post-video.js"
import { FFMPEG_KILL_GRACE_MS, FFMPEG_SLOT_BACKSTOP_MS, withFfmpegSlot } from "../ffmpeg-utils.js"
import { withYtDlpAdmission, withYtDlpOptionsAdmission, YTDLP_TRANSCODE_HOLD_MS } from "../ytdlp-admission.js"

const URL_ = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
const SECTION = { startSec: 60, endSec: 120 }

describe("ytDlpTranscodeReason — every flag combination that makes yt-dlp's ffmpeg encode", () => {
  const transcodes: Array<[string, string[]]> = [
    ["--download-sections with --force-keyframes-at-cuts", ["--download-sections", "*1-9", "--force-keyframes-at-cuts"]],
    ["the = spelling of the same", ["--download-sections=*1-9", "--force-keyframes-at-cuts"]],
    ["--remove-chapters with --force-keyframes-at-cuts", ["--remove-chapters", "intro", "--force-keyframes-at-cuts"]],
    ["--sponsorblock-remove with --force-keyframes-at-cuts", ["--sponsorblock-remove", "all", "--force-keyframes-at-cuts"]],
    ["--split-chapters with --force-keyframes-at-cuts", ["--split-chapters", "--force-keyframes-at-cuts"]],
    ["--recode-video", ["--recode-video", "mp4"]],
    ["--recode (its alias)", ["--recode", "mkv"]],
    ["--extract-audio to mp3", ["--extract-audio", "--audio-format", "mp3"]],
    ["-x to opus", ["-x", "--audio-format", "opus"]],
    ["-x to m4a (not shown to be a copy)", ["-x", "--audio-format", "m4a"]],
    ["arbitrary post-processor ffmpeg arguments", ["--postprocessor-args", "ffmpeg:-c:v libx264"]],
    ["--ppa (its alias)", ["--ppa", "ffmpeg:-crf 20"]],
    ["arbitrary downloader arguments", ["--downloader-args", "ffmpeg:-c:v libx264"]],
    ["arbitrary external-downloader arguments", ["--external-downloader-args", "ffmpeg:-c:a aac"]],
  ]
  for (const [name, args] of transcodes) {
    it(`${name} transcodes`, () => {
      expect(ytDlpTranscodeReason([URL_, ...args])).toEqual(expect.any(String))
    })
  }

  const copies: Array<[string, string[], string]> = [
    ["a merge into mp4", ["--merge-output-format", "mp4"], "streams are muxed with -c copy"],
    ["a remux", ["--remux-video", "mp4"], "streams are muxed with -c copy"],
    ["a plain section download (no forced keyframes)", ["--download-sections", "*1-9"], "ffmpeg downloader with -c copy"],
    ["forced keyframes with nothing to cut", ["--force-keyframes-at-cuts"], "the flag does nothing without a cut"],
    ["chapter removal cut by copy", ["--remove-chapters", "intro"], "cuts by stream copy"],
    ["-x with no format (best: the source's own audio stream)", ["-x"], "best = copy"],
    ["-x with --audio-format best", ["-x", "--audio-format", "best"], "best = copy"],
    ["--audio-format without -x (ignored)", ["--audio-format", "mp3"], "yt-dlp ignores it"],
    ["a thumbnail converted to jpg", ["--write-thumbnail", "--convert-thumbnails", "jpg"], "ffmpeg converts ONE still image"],
    ["embedded subtitles / metadata / chapters", ["--embed-subs", "--embed-metadata", "--embed-chapters"], "streams copied"],
    ["a metadata dump", ["--dump-json", "--skip-download", "--no-playlist"], "no ffmpeg at all"],
    ["a print probe", ["--skip-download", "--print", "%(duration)s"], "no ffmpeg at all"],
  ]
  for (const [name, args, why] of copies) {
    it(`${name} is exempt — ${why}`, () => {
      expect(ytDlpTranscodeReason([URL_, ...args])).toBeUndefined()
    })
  }

  it("never throws on a dangling flag, an empty list, or a value that looks like a flag", () => {
    expect(ytDlpTranscodeReason([])).toBeUndefined()
    expect(ytDlpTranscodeReason(["--audio-format"])).toBeUndefined()
    expect(ytDlpTranscodeReason(["-x", "--audio-format"])).toBeUndefined()
    // A header value that merely contains a flag's name is data, not a flag.
    expect(ytDlpTranscodeReason(["--add-header", "x:--recode-video"])).toBeUndefined()
  })
})

describe("ytDlpOptionsToArgs — youtube-dl-exec's options, spelled as flags", () => {
  it("kebab-cases the keys, spells false as --no-<key>, drops nullish values, repeats arrays", () => {
    expect(ytDlpOptionsToArgs({ extractAudio: true, audioFormat: "mp3", audioQuality: 0, noPlaylist: true, writeThumbnail: false, proxy: undefined, addHeader: ["a:1", "b:2"] }))
      .toEqual(["--extract-audio", "--audio-format", "mp3", "--audio-quality", "0", "--no-playlist", "--no-write-thumbnail", "--add-header", "a:1", "--add-header", "b:2"])
  })

  it("spells every options object exactly as youtube-dl-exec (dargs) does, false and one-letter keys included", () => {
    const audioLane = { extractAudio: true, audioFormat: "mp3", audioQuality: 0, noPlaylist: true, noWarnings: true, addHeader: ["a:1", "b:2"], output: "/tmp/x.%(ext)s" }
    const mergeLane = { mergeOutputFormat: "mp4", noPlaylist: true, format: "bv*+ba", extractorArgs: "youtube:player_client=android" }
    for (const options of [
      audioLane,
      mergeLane,
      { writeThumbnail: false, proxy: undefined, cookies: null, noPlaylist: true },
      { x: true, f: "bestaudio", writeSubs: false },
      { x: false },
    ]) {
      expect(ytDlpOptionsToArgs(options)).toEqual(libraryArgs(options))
    }
    expect(ytDlpOptionsToArgs({ writeThumbnail: false })).toEqual(["--no-write-thumbnail"])
    expect(ytDlpOptionsToArgs({ x: true })).toEqual(["-x"])
  })

  it("classifies a one-letter -x the same as --extract-audio", () => {
    expect(ytDlpTranscodeReason(ytDlpOptionsToArgs({ x: true, audioFormat: "mp3" }))).toEqual(expect.any(String))
  })

  it("is classified exactly like the flags: the audio library calls transcode, the merge call does not", () => {
    expect(ytDlpTranscodeReason(ytDlpOptionsToArgs({ extractAudio: true, audioFormat: "mp3", audioQuality: 0 }))).toEqual(expect.any(String))
    expect(ytDlpTranscodeReason(ytDlpOptionsToArgs({ mergeOutputFormat: "mp4", noPlaylist: true, extractorArgs: "youtube:player_client=android" }))).toBeUndefined()
    expect(ytDlpTranscodeReason(ytDlpOptionsToArgs({ recodeVideo: "mp4" }))).toEqual(expect.any(String))
    expect(ytDlpTranscodeReason(ytDlpOptionsToArgs({ downloadSections: "*1-9", forceKeyframesAtCuts: true }))).toEqual(expect.any(String))
  })
})

describe("every args builder in the repo, classified", () => {
  it("a section download (progressive fallback), and both halves of the HD one, re-encode at the cuts", () => {
    expect(ytDlpTranscodeReason(buildYtDlpVideoArgs({ url: URL_, outPath: "/tmp/o.mp4", section: SECTION, proxyArgs: [] }))).toEqual(expect.any(String))
    for (const writeThumbnail of [true, false]) {
      expect(ytDlpTranscodeReason(buildYtDlpSectionStreamArgs({ url: URL_, outTemplate: "/tmp/o.%(ext)s", format: "bv", section: SECTION, proxyArgs: [], writeThumbnail }))).toEqual(expect.any(String))
    }
  })

  it("a whole-video download only merges and converts a thumbnail: exempt", () => {
    expect(ytDlpTranscodeReason(buildYtDlpVideoArgs({ url: URL_, outPath: "/tmp/o.mp4", proxyArgs: [] }))).toBeUndefined()
    const hardened = buildYtDlpVideoArgs({ url: URL_, outPath: "/tmp/o.mp4", proxyArgs: [], extraArgs: socialPostArgs("youtube", 600), checkCertificates: true })
    expect(ytDlpTranscodeReason(hardened)).toBeUndefined()
  })

  it("an audio extraction converts to mp3", () => {
    expect(ytDlpTranscodeReason(buildYtAudioExtractionArgs(URL_, "/tmp/a.mp3", null))).toEqual(expect.any(String))
  })
})

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

describe("the admission around a yt-dlp run", () => {
  beforeEach(() => {
    spawned.calls = []
    spawned.procs = []
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const sectionArgs = () => buildYtDlpVideoArgs({ url: URL_, outPath: "/tmp/o.mp4", section: SECTION, proxyArgs: [] })
  const wholeArgs = () => buildYtDlpVideoArgs({ url: URL_, outPath: "/tmp/o.mp4", proxyArgs: [] })

  /** Hold the whole memory budget: an oversized launch runs alone, so everything else queues behind it. */
  async function holdTheBox(): Promise<() => void> {
    let release!: () => void
    const held = withFfmpegSlot(() => new Promise<void>((resolve) => { release = resolve }), {
      timeoutMs: 24 * 60 * 60_000, peakMemoryMiB: 1_000_000_000, label: "the box",
    })
    held.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(0)
    return () => release()
  }

  it("a run that re-encodes WAITS for the box before it spawns, and spawns once it is admitted", async () => {
    const release = await holdTheBox()
    const run = spawnYtDlpDownload(sectionArgs())
    await vi.advanceTimersByTimeAsync(10_000)
    expect(spawned.calls).toHaveLength(0)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(spawned.calls).toHaveLength(1)
    spawned.procs[0]!.emit("close", 0)
    await run
  })

  it("a stream-copy run does NOT wait: it spawns at once, beside a busy box", async () => {
    const release = await holdTheBox()
    const run = spawnYtDlpDownload(wholeArgs())
    expect(spawned.calls).toHaveLength(1)
    spawned.procs[0]!.emit("close", 0)
    await run
    release()
  })

  it("a capture (--dump-json) never waits either", async () => {
    const release = await holdTheBox()
    const run = runYtDlpCapture(["--dump-json", "--skip-download", URL_], { timeoutMs: 15_000 })
    expect(spawned.calls).toHaveLength(1)
    spawned.procs[0]!.stdout.emit("data", Buffer.from("{}"))
    spawned.procs[0]!.emit("close", 0)
    await run
    release()
  })

  it("it holds its reservation for the WHOLE download: a second run queues until the first ends", async () => {
    const first = spawnYtDlpDownload(sectionArgs())
    await vi.advanceTimersByTimeAsync(0)
    expect(spawned.calls).toHaveLength(1)
    // An oversized launch needs the container empty, so it cannot start while the download holds its estimate.
    const big = vi.fn(async () => undefined)
    const queued = withFfmpegSlot(big, { timeoutMs: 60_000, peakMemoryMiB: 1_000_000_000 })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(big).not.toHaveBeenCalled()
    spawned.procs[0]!.emit("close", 0)
    await first
    await vi.advanceTimersByTimeAsync(1_000)
    await queued
    expect(big).toHaveBeenCalledOnce()
  })

  it("the reservation is given back when the download FAILS", async () => {
    const first = spawnYtDlpDownload(sectionArgs()).catch((err: Error) => err)
    await vi.advanceTimersByTimeAsync(0)
    spawned.procs[0]!.emit("close", 1)
    expect(await first).toBeInstanceOf(Error)
    const big = vi.fn(async () => undefined)
    await withFfmpegSlot(big, { timeoutMs: 60_000, peakMemoryMiB: 1_000_000_000 })
    expect(big).toHaveBeenCalledOnce()
  })

  it("the caller's abort ends the wait as the halt yt-dlp itself raises — and nothing spawns", async () => {
    const release = await holdTheBox()
    const controller = new AbortController()
    const run = spawnYtDlpDownload(sectionArgs(), undefined, { signal: controller.signal }).catch((err: Error) => err)
    await vi.advanceTimersByTimeAsync(2_000)
    controller.abort()
    const error = await run
    expect(error).toBeInstanceOf(YtDlpHaltError)
    expect(error).toMatchObject({ reason: "aborted" })
    expect(spawned.calls).toHaveLength(0)
    release()
  })

  it("a fetch's deadline does not run while the download waits: it is read AFTER admission, and still binds the run", async () => {
    const release = await holdTheBox()
    const deadline = new FetchDeadline(1_000)
    const run = spawnYtDlpDownload(sectionArgs(), undefined, { deadline }).catch((err: Error) => err)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(spawned.calls).toHaveLength(0)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(spawned.calls).toHaveLength(1) // not failed out_of_time
    await vi.advanceTimersByTimeAsync(900)
    expect(spawned.procs[0]!.kill).not.toHaveBeenCalled() // inside what was left
    await vi.advanceTimersByTimeAsync(300)
    expect(await run).toMatchObject({ name: "YtDlpHaltError", reason: "out_of_time" }) // the run is still held to it
  })

  it("the hold is bounded: the slot's own ceiling is 30 minutes (+ the kill grace and backstop), not unbounded", () => {
    expect(YTDLP_TRANSCODE_HOLD_MS).toBe(30 * 60 * 1000)
  })

  describe("a re-encoding run never outlives its hold (R3-1)", () => {
    /** Keep the run talking: only the hold, not the idle watchdog, may end it. */
    async function runFor(ms: number, proc: () => FakeProc): Promise<void> {
      for (let left = ms; left > 0; left -= 60_000) {
        await vi.advanceTimersByTimeAsync(Math.min(60_000, left))
        proc().stdout.emit("data", Buffer.from("download: 1%\n"))
      }
    }

    it("the process itself is killed at the hold, as an out_of_time halt — the slot is never released from under a live yt-dlp", async () => {
      const run = spawnYtDlpDownload(sectionArgs()).catch((err: Error) => err)
      await vi.advanceTimersByTimeAsync(0)
      await runFor(YTDLP_TRANSCODE_HOLD_MS - 1_000, () => spawned.procs[0]!)
      expect(spawned.procs[0]!.kill).not.toHaveBeenCalled()
      await runFor(2_000, () => spawned.procs[0]!)
      expect(spawned.procs[0]!.kill).toHaveBeenCalled()
      expect(await run).toMatchObject({ name: "YtDlpHaltError", reason: "out_of_time" })
    })

    it("the fetch's deadline still wins when it is the shorter of the two", async () => {
      const run = spawnYtDlpDownload(sectionArgs(), undefined, { deadline: new FetchDeadline(5_000) }).catch((err: Error) => err)
      await vi.advanceTimersByTimeAsync(5_500)
      expect(spawned.procs[0]!.kill).toHaveBeenCalled()
      expect(await run).toMatchObject({ reason: "out_of_time" })
    })

    it("a run that only copies streams is not capped by the hold (it holds nothing)", async () => {
      const run = spawnYtDlpDownload(wholeArgs(), undefined, { idleTimeoutMs: 24 * 60 * 60_000 })
      await vi.advanceTimersByTimeAsync(YTDLP_TRANSCODE_HOLD_MS + 60_000)
      expect(spawned.procs[0]!.kill).not.toHaveBeenCalled()
      spawned.procs[0]!.emit("close", 0)
      await run
    })

    it("a run that ignores the hold's signal is cut off by the backstop as a HALT, not an ordinary failure", async () => {
      let hold: { signal: AbortSignal } | undefined
      const run = withYtDlpAdmission(sectionArgs(), (h) => { hold = h; return new Promise<never>(() => undefined) }, {}).catch((err: Error) => err)
      await vi.advanceTimersByTimeAsync(YTDLP_TRANSCODE_HOLD_MS - 1)
      expect(hold!.signal.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(2)
      expect(hold!.signal.aborted).toBe(true)
      await vi.advanceTimersByTimeAsync(FFMPEG_KILL_GRACE_MS + FFMPEG_SLOT_BACKSTOP_MS)
      const error = await run
      expect(error).toBeInstanceOf(YtDlpHaltError)
      expect(error).toMatchObject({ reason: "out_of_time" })
    })

    it("youtube-dl-exec cannot be held: a library run that would encode is refused, one that only merges runs untouched", async () => {
      const run = vi.fn(async () => "ok")
      await expect(withYtDlpOptionsAdmission({ extractAudio: true, audioFormat: "mp3" }, run)).rejects.toThrow(/runYtDlpOptions/)
      expect(run).not.toHaveBeenCalled()
      await expect(withYtDlpOptionsAdmission({ mergeOutputFormat: "mp4", noPlaylist: true }, run)).resolves.toBe("ok")
      expect(run).toHaveBeenCalledOnce()
    })

    it("a halt after the hold starts NO next client rung — no second yt-dlp ffmpeg beside the first", async () => {
      const attempt = vi.fn((_rung: unknown) => withYtDlpAdmission(sectionArgs(), () => new Promise<never>(() => undefined), {}))
      const run = runThroughClientLadder(URL_, attempt).catch((err: Error) => err)
      await vi.advanceTimersByTimeAsync(YTDLP_TRANSCODE_HOLD_MS + FFMPEG_KILL_GRACE_MS + FFMPEG_SLOT_BACKSTOP_MS + 1_000)
      expect(await run).toMatchObject({ name: "YtDlpHaltError" })
      expect(attempt).toHaveBeenCalledTimes(1)
    })

    it("an HD section download that hits the hold does not fall back to a second (progressive) section run", async () => {
      const run = downloadYouTubeVideo({ url: URL_, outPath: "/tmp/o.mp4", section: SECTION }).catch((err: Error) => err)
      await vi.advanceTimersByTimeAsync(0)
      await runFor(YTDLP_TRANSCODE_HOLD_MS + 1_000, () => spawned.procs[0]!)
      const error = await run
      expect(error).toMatchObject({ name: "YtDlpHaltError", reason: "out_of_time" })
      expect(spawned.calls).toHaveLength(1)
    })
  })

  it("withYtDlpAdmission labels the hold with the reason and runs exempt work untouched", async () => {
    const run = vi.fn(async () => "ok")
    await expect(withYtDlpAdmission(wholeArgs(), run, {})).resolves.toBe("ok")
    await expect(withYtDlpAdmission(sectionArgs(), run, {})).resolves.toBe("ok")
    expect(run).toHaveBeenCalledTimes(2)
  })

  it("the hardened whole-video lane stays exempt end to end (merge + thumbnail only)", async () => {
    const hardening = { extraArgs: socialPostArgs("youtube", 600), env: { PATH: "/usr/bin" }, totalTimeoutMs: 60_000 }
    const release = await holdTheBox()
    const run = downloadYouTubeVideo({ url: URL_, outPath: "/tmp/x.mp4", hardening }).catch((err: Error) => err)
    await flush()
    expect(spawned.calls).toHaveLength(1) // not queued behind the box
    spawned.procs[0]!.emit("close", 101)
    await run
    release()
  })
})
