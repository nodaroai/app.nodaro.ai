import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EventEmitter } from "node:events"

vi.mock("node:child_process", () => ({ spawn: vi.fn(), execFile: vi.fn() }))
import { spawn } from "node:child_process"
import {
  ytMetadataProbe,
  buildYtDlpVideoArgs,
  resolveYtDlpBin,
  probeStreams,
  downloadYouTubeVideo,
  youtubeClientLadder,
  runThroughClientLadder,
  reencodeToH264,
  assertAudioPresent,
  YtUrlNotAllowedError,
  type YtClientRung,
} from "../youtube-video.js"
import { VIDEO_FORMAT_SELECTOR, videoFormatSelector } from "../video-format.js"

/** Minimal stand-in for a spawned child: emits stdout/stderr, then closes. */
function fakeProc(opts: { stdout?: string; stderr?: string; code?: number; error?: Error }) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: () => void
  }
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.kill = () => {}
  // Emit after the caller has attached its listeners.
  queueMicrotask(() => {
    if (opts.error) return proc.emit("error", opts.error)
    if (opts.stdout) proc.stdout.emit("data", Buffer.from(opts.stdout))
    if (opts.stderr) proc.stderr.emit("data", Buffer.from(opts.stderr))
    proc.emit("close", opts.code ?? 0)
  })
  return proc
}

describe("ytMetadataProbe", () => {
  it("rejects non-YouTube hosts BEFORE spawning", async () => {
    await expect(ytMetadataProbe("https://internal.service/meta")).rejects.toBeInstanceOf(YtUrlNotAllowedError)
    await expect(ytMetadataProbe("https://vimeo.com/123")).rejects.toBeInstanceOf(YtUrlNotAllowedError)
  })
})

describe("buildYtDlpVideoArgs", () => {
  it("carries spoof + mp4 merge + max-filesize", () => {
    const args = buildYtDlpVideoArgs({ url: "https://youtu.be/x", outPath: "/tmp/x.mp4", maxFilesizeBytes: 512 * 1024 * 1024 })
    expect(args.join(" ")).toContain("referer:youtube.com")
    expect(args.join(" ")).toContain("--max-filesize 512M")
    expect(args.join(" ")).toContain("--merge-output-format mp4")
  })

  /**
   * The regression this pins: `youtube:player_client=android` capped EVERY
   * YouTube download at 360p — the android client does not expose the
   * higher-resolution DASH streams, so the format selector had nothing better to
   * pick. It was mis-diagnosed as a YouTube-side SABR limit; it was this arg.
   * yt-dlp's own default client chain returns 1080p from the same binary.
   */
  it("pins no player_client — the android pin capped YouTube at 360p", () => {
    const args = buildYtDlpVideoArgs({ url: "https://youtu.be/x", outPath: "/tmp/x.mp4" })
    expect(args.join(" ")).not.toContain("player_client")
  })

  /**
   * The regression this pins: `--format mp4/best` picks the highest-bitrate mp4,
   * which on TikTok is a `bytevc1` (h265) format that claims `acodec=aac` but
   * downloads VIDEO-ONLY. Users got a silent video back from the voice changer.
   */
  it("never asks for bare `mp4/best` — it downloads TikTok silently", () => {
    const format = formatOf(buildYtDlpVideoArgs({ url: "https://tiktok.com/x", outPath: "/tmp/x.mp4" }))
    expect(format).not.toBe("mp4/best")
  })

  it("prefers h264 by BOTH vcodec spellings — YouTube says avc1, TikTok says h264", () => {
    const format = formatOf(buildYtDlpVideoArgs({ url: "https://tiktok.com/x", outPath: "/tmp/x.mp4" }))
    expect(format).toContain("[vcodec^=avc1]")
    expect(format).toContain("[vcodec^=h264]")
  })

  it("requires audio in every merged branch, and still falls back to a playable file", () => {
    const branches = formatOf(buildYtDlpVideoArgs({ url: "https://youtu.be/x", outPath: "/tmp/x.mp4" })).split("/")
    // Every `bv*` (video-only) branch must pair with a `+ba` audio stream —
    // an unpaired `bv*` is exactly how a silent download gets selected.
    for (const branch of branches.filter((b) => b.startsWith("bv*"))) {
      expect(branch).toContain("+ba")
    }
    expect(branches.at(-1)).toBe("b")
  })

  it("caps the --format to <=maxHeight when set, and leaves it uncapped when absent", () => {
    const capped = formatOf(
      buildYtDlpVideoArgs({ url: "https://youtu.be/x", outPath: "/tmp/x.mp4", maxHeight: 720 }),
    )
    expect(capped).toBe(videoFormatSelector(720))
    expect(capped).toContain("[height<=720]")

    // Absent maxHeight → byte-identical to the uncapped selector (no `height`).
    const uncapped = formatOf(buildYtDlpVideoArgs({ url: "https://youtu.be/x", outPath: "/tmp/x.mp4" }))
    expect(uncapped).toBe(VIDEO_FORMAT_SELECTOR)
    expect(uncapped).not.toContain("height")
  })

  it("composes maxHeight WITH a section — capped format AND the padded --download-sections", () => {
    const args = buildYtDlpVideoArgs({
      url: "https://youtu.be/x",
      outPath: "/tmp/x.mp4",
      maxHeight: 480,
      section: { startSec: 10, endSec: 20 },
    })
    expect(formatOf(args)).toBe(videoFormatSelector(480))
    expect(args[args.indexOf("--download-sections") + 1]).toBe("*7-23")
  })

  it("uses the supplied proxyArgs verbatim instead of the default proxy (the auth-shim path)", () => {
    const args = buildYtDlpVideoArgs({
      url: "https://youtu.be/x",
      outPath: "/tmp/x.mp4",
      section: { startSec: 10, endSec: 20 },
      proxyArgs: ["--proxy", "http://127.0.0.1:54321"],
    })
    const i = args.indexOf("--proxy")
    expect(i).toBeGreaterThan(-1)
    expect(args[i + 1]).toBe("http://127.0.0.1:54321")
    // The override REPLACES the default proxy — exactly one --proxy in the args.
    expect(args.filter((a) => a === "--proxy")).toHaveLength(1)
  })
})

/**
 * Section downloads: `--download-sections "*start-end"` with a ±3s pad —
 * yt-dlp cuts at keyframes, so the fetched range is imprecise; the pad
 * guarantees the requested range survives, and the CLIENT does the frame-exact
 * trim on the small file afterwards.
 */
describe("buildYtDlpVideoArgs — section downloads", () => {
  const base = { url: "https://youtu.be/x", outPath: "/tmp/x.mp4" }

  it("adds --download-sections with the ±3s padded range", () => {
    const args = buildYtDlpVideoArgs({ ...base, section: { startSec: 10, endSec: 20 } })
    const i = args.indexOf("--download-sections")
    expect(i).toBeGreaterThan(-1)
    expect(args[i + 1]).toBe("*7-23")
  })

  it("clamps the padded start at 0 — never a negative range start", () => {
    const args = buildYtDlpVideoArgs({ ...base, section: { startSec: 2, endSec: 5 } })
    expect(args[args.indexOf("--download-sections") + 1]).toBe("*0-8")
  })

  it("never adds --force-keyframes-at-cuts — that re-encodes server-side", () => {
    const args = buildYtDlpVideoArgs({ ...base, section: { startSec: 10, endSec: 20 } })
    expect(args).not.toContain("--force-keyframes-at-cuts")
  })

  it("without a section, args are the stable base list (incl. --force-overwrites for clean retries)", () => {
    const args = buildYtDlpVideoArgs(base)
    expect(args).toEqual([
      "https://youtu.be/x",
      "--format", VIDEO_FORMAT_SELECTOR,
      "--output", "/tmp/x.%(ext)s",
      "--no-playlist",
      "--no-check-certificates",
      "--merge-output-format", "mp4",
      "--force-overwrites",
      "--write-thumbnail",
      "--convert-thumbnails", "jpg",
      "--add-header", "referer:youtube.com",
      "--add-header", "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "--newline",
      "--progress-template", "download:%(progress._percent_str)s",
    ])
  })
})

/** The value passed to `--format`. */
function formatOf(args: string[]): string {
  return args[args.indexOf("--format") + 1]
}

describe("probeStreams", () => {
  beforeEach(() => vi.mocked(spawn).mockReset())

  it("flags a file with no audio stream — the silent-TikTok download", async () => {
    vi.mocked(spawn).mockReturnValue(
      fakeProc({ stdout: JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264" }] }) }) as never,
    )
    await expect(probeStreams("/tmp/x.mp4")).resolves.toEqual({ videoCodec: "h264", hasAudio: false })
  })

  it("sees audio regardless of stream order", async () => {
    vi.mocked(spawn).mockReturnValue(
      fakeProc({
        stdout: JSON.stringify({
          streams: [
            { codec_type: "audio", codec_name: "aac" },
            { codec_type: "video", codec_name: "hevc" },
          ],
        }),
      }) as never,
    )
    await expect(probeStreams("/tmp/x.mp4")).resolves.toEqual({ videoCodec: "hevc", hasAudio: true })
  })

  /**
   * "Probe failed" must NOT read as "no audio" — otherwise every corrupt
   * download would also claim to be silent, and the warning stops meaning
   * anything. null is unknown; only `false` is a real missing-audio verdict.
   */
  it("reports unknown (null), not missing, when the probe fails", async () => {
    vi.mocked(spawn).mockReturnValue(fakeProc({ code: 1 }) as never)
    await expect(probeStreams("/tmp/x.mp4")).resolves.toEqual({ videoCodec: null, hasAudio: null })
  })

  it("reports unknown when ffprobe cannot be spawned at all", async () => {
    vi.mocked(spawn).mockReturnValue(fakeProc({ error: new Error("ENOENT") }) as never)
    await expect(probeStreams("/tmp/x.mp4")).resolves.toEqual({ videoCodec: null, hasAudio: null })
  })
})

/**
 * The regression these pin: the image sets `YOUTUBE_DL_SKIP_DOWNLOAD=1`, so the
 * bundled binary is never fetched — yet the code spawned it anyway, and every
 * social-video path died with `spawn .../bin/yt-dlp ENOENT`, silently. The image
 * now ships the real binary and points YOUTUBE_DL_DIR at it; resolution must
 * prefer that, and must never hand `spawn` a path it already knows is absent.
 */
describe("resolveYtDlpBin", () => {
  it("prefers YOUTUBE_DL_DIR — the env `youtube-dl-exec` itself reads", () => {
    const dir = mkdtempSync(join(tmpdir(), "ytdlp-"))
    const bin = join(dir, "yt-dlp")
    writeFileSync(bin, "#!/bin/sh\n")
    expect(resolveYtDlpBin({ YOUTUBE_DL_DIR: dir } as NodeJS.ProcessEnv)).toBe(bin)
  })

  it("ignores YOUTUBE_DL_DIR when no binary is actually there", () => {
    const empty = mkdtempSync(join(tmpdir(), "ytdlp-empty-"))
    // Must NOT return the non-existent env path — that is precisely the ENOENT bug.
    expect(resolveYtDlpBin({ YOUTUBE_DL_DIR: empty } as NodeJS.ProcessEnv)).not.toBe(
      join(empty, "yt-dlp"),
    )
  })

  it("falls back to a bare PATH lookup rather than a path known to be absent", () => {
    // No env dir, and (in CI) no postinstalled bundle → must degrade to "yt-dlp"
    // so the OS resolves it, instead of spawning a guaranteed-missing path.
    const resolved = resolveYtDlpBin({} as NodeJS.ProcessEnv)
    expect(resolved === "yt-dlp" || resolved.endsWith("/bin/yt-dlp")).toBe(true)
  })
})

/**
 * The regression these pin: PR #77 dropped the android client pin (it capped
 * downloads at 360p), leaving every YouTube fetch on the default (web) client.
 * YouTube's watch page then 429s the web client from Railway's datacenter IP,
 * taking video imports 100% down ("Couldn't fetch this video"). The ladder
 * retries web → tv → android — best quality first, guaranteed-working android
 * last — for YouTube only; every other host keeps its single attempt.
 */
describe("youtubeClientLadder", () => {
  it("YouTube URLs get the web → tv → android ladder, in order", () => {
    const rungs = youtubeClientLadder("https://www.youtube.com/watch?v=x")
    expect(rungs.map((r) => r.label)).toEqual(["default", "tv", "android"])
    // Rung 1 is the pin-free base args — no extractor-args, so best quality.
    expect(rungs[0].extractorArgs).toEqual([])
    expect(rungs[1].extractorArgs).toEqual(["--extractor-args", "youtube:player_client=tv"])
    expect(rungs[2].extractorArgs).toEqual(["--extractor-args", "youtube:player_client=android"])
  })

  it("treats youtu.be and music.youtube.com as YouTube (3 rungs)", () => {
    expect(youtubeClientLadder("https://youtu.be/x")).toHaveLength(3)
    expect(youtubeClientLadder("https://music.youtube.com/watch?v=x")).toHaveLength(3)
  })

  it("non-YouTube hosts get exactly one default-client attempt", () => {
    for (const url of [
      "https://www.tiktok.com/@a/video/1",
      "https://www.instagram.com/reel/x",
      "https://x.com/a/status/1",
      "https://www.facebook.com/watch?v=1",
    ]) {
      const rungs = youtubeClientLadder(url)
      expect(rungs).toHaveLength(1)
      expect(rungs[0]).toEqual({ label: "default", extractorArgs: [] })
    }
  })
})

describe("runThroughClientLadder", () => {
  it("stops at the first success — a rung-1 win runs the attempt exactly once", async () => {
    const attempt = vi.fn().mockResolvedValue("ok")
    await expect(runThroughClientLadder("https://youtu.be/x", attempt)).resolves.toBe("ok")
    expect(attempt).toHaveBeenCalledTimes(1)
    expect(attempt.mock.calls[0][0].label).toBe("default")
  })

  it("a first-attempt failure advances to rung 2 with the tv extractor-args", async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new Error("HTTP Error 429: Too Many Requests"))
      .mockResolvedValueOnce("ok")
    await expect(runThroughClientLadder("https://youtu.be/x", attempt)).resolves.toBe("ok")
    expect(attempt).toHaveBeenCalledTimes(2)
    expect(attempt.mock.calls[1][0].label).toBe("tv")
    expect(attempt.mock.calls[1][0].extractorArgs).toContain("youtube:player_client=tv")
  })

  it("when every rung fails, the LAST rung's error is what propagates", async () => {
    const attempt = vi.fn((rung: YtClientRung) => Promise.reject(new Error(`rung ${rung.label} failed`)))
    await expect(runThroughClientLadder("https://youtu.be/x", attempt)).rejects.toThrow("rung android failed")
    expect(attempt).toHaveBeenCalledTimes(3)
  })

  it("non-YouTube hosts try once and propagate that single error unchanged", async () => {
    const attempt = vi.fn().mockRejectedValue(new Error("tiktok boom"))
    await expect(runThroughClientLadder("https://tiktok.com/x", attempt)).rejects.toThrow("tiktok boom")
    expect(attempt).toHaveBeenCalledTimes(1)
  })
})

/**
 * End-to-end wiring of the ladder into the real yt-dlp spawn (spawn is mocked).
 * These exercise the all-rungs-fail path, which rejects inside the ladder before
 * any ffprobe/fs work — so the mocked spawn calls ARE the ladder attempts.
 */
describe("downloadYouTubeVideo — client ladder wiring", () => {
  beforeEach(() => vi.mocked(spawn).mockReset())

  const argsOfCall = (call: number) => vi.mocked(spawn).mock.calls[call][1] as string[]

  it("retries web → tv → android, appending each rung's extractor-args to the spawn", async () => {
    // mockImplementationOnce (not mockReturnValueOnce): each fakeProc — and its
    // queued close emit — must be created lazily WHEN that rung spawns, so its
    // listeners are attached before the microtask fires. Building all three
    // eagerly would fire rungs 2/3's close before their listeners existed.
    vi.mocked(spawn)
      .mockImplementationOnce(() => fakeProc({ stderr: "ERROR: web\nERROR: HTTP Error 429: Too Many Requests", code: 1 }) as never)
      .mockImplementationOnce(() => fakeProc({ stderr: "ERROR: tv\nERROR: tv rung failed", code: 1 }) as never)
      .mockImplementationOnce(() => fakeProc({ stderr: "ERROR: android\nERROR: android rung final line", code: 1 }) as never)

    await expect(
      downloadYouTubeVideo({ url: "https://www.youtube.com/watch?v=x", outPath: "/tmp/x.mp4" }),
    ).rejects.toThrow("android rung final line")

    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(3)
    // Rung 1 (web) carries no client pin; rungs 2/3 add tv then android.
    expect(argsOfCall(0).join(" ")).not.toContain("player_client")
    expect(argsOfCall(1)).toContain("youtube:player_client=tv")
    expect(argsOfCall(2)).toContain("youtube:player_client=android")
  })

  it("propagates the stderr LAST line of the final failed rung (SSE + mapYtdlpError contract)", async () => {
    vi.mocked(spawn)
      .mockImplementationOnce(() => fakeProc({ stderr: "ERROR: first rung line", code: 1 }) as never)
      .mockImplementationOnce(() => fakeProc({ stderr: "ERROR: second rung line", code: 1 }) as never)
      .mockImplementationOnce(
        () => fakeProc({ stderr: "WARNING: noise\nERROR: unable to download video data: HTTP Error 403", code: 1 }) as never,
      )
    await expect(
      downloadYouTubeVideo({ url: "https://youtu.be/x", outPath: "/tmp/x.mp4" }),
    ).rejects.toThrow("ERROR: unable to download video data: HTTP Error 403")
  })

  it("every ladder rung inherits the section args — they live in the BASE args", async () => {
    vi.mocked(spawn)
      .mockImplementationOnce(() => fakeProc({ stderr: "ERROR: web down", code: 1 }) as never)
      .mockImplementationOnce(() => fakeProc({ stderr: "ERROR: tv down", code: 1 }) as never)
      .mockImplementationOnce(() => fakeProc({ stderr: "ERROR: android down", code: 1 }) as never)

    await expect(
      downloadYouTubeVideo({
        url: "https://www.youtube.com/watch?v=x",
        outPath: "/tmp/x.mp4",
        section: { startSec: 10, endSec: 20 },
      }),
    ).rejects.toThrow("android down")

    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(3)
    for (const call of [0, 1, 2]) {
      const args = argsOfCall(call)
      expect(args[args.indexOf("--download-sections") + 1]).toBe("*7-23")
    }
  })

  it("every ladder rung shares the capped --format — maxHeight lives in the BASE args", async () => {
    vi.mocked(spawn)
      .mockImplementationOnce(() => fakeProc({ stderr: "ERROR: web down", code: 1 }) as never)
      .mockImplementationOnce(() => fakeProc({ stderr: "ERROR: tv down", code: 1 }) as never)
      .mockImplementationOnce(() => fakeProc({ stderr: "ERROR: android down", code: 1 }) as never)

    await expect(
      downloadYouTubeVideo({ url: "https://www.youtube.com/watch?v=x", outPath: "/tmp/x.mp4", maxHeight: 720 }),
    ).rejects.toThrow("android down")

    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(3)
    for (const call of [0, 1, 2]) {
      const args = argsOfCall(call)
      expect(args[args.indexOf("--format") + 1]).toBe(videoFormatSelector(720))
    }
  })

  it("spawns yt-dlp exactly once for a non-YouTube host, with no client pin", async () => {
    vi.mocked(spawn).mockImplementationOnce(() => fakeProc({ stderr: "ERROR: tiktok boom", code: 1 }) as never)
    await expect(
      downloadYouTubeVideo({ url: "https://www.tiktok.com/@a/video/1", outPath: "/tmp/x.mp4" }),
    ).rejects.toThrow("tiktok boom")
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1)
    expect(argsOfCall(0).join(" ")).not.toContain("player_client")
  })
})

/**
 * Proxy-pool failover: a download tries each proxy in the resolved chain
 * (YTDLP_PROXY_POOL tiers, then the legacy fallback), running the full client
 * ladder per proxy, until one succeeds — then it stops.
 */
describe("downloadYouTubeVideo — proxy pool failover", () => {
  beforeEach(() => vi.mocked(spawn).mockReset())
  afterEach(() => {
    delete process.env.YTDLP_PROXY_POOL
    delete process.env.YTDLP_PROXY
  })
  const argsOfCall = (call: number) => vi.mocked(spawn).mock.calls[call][1] as string[]

  it("exhausts the main tier then the fallback (2 proxies × 3 rungs), last error propagates", async () => {
    process.env.YTDLP_PROXY_POOL = "http://u:p@main:1 | http://u:p@fallback:2"
    for (let i = 0; i < 6; i++) {
      vi.mocked(spawn).mockImplementationOnce(() => fakeProc({ stderr: `ERROR: attempt ${i} down`, code: 1 }) as never)
    }
    await expect(
      downloadYouTubeVideo({ url: "https://www.youtube.com/watch?v=x", outPath: "/tmp/x.mp4" }),
    ).rejects.toThrow("attempt 5 down") // the LAST proxy's last rung
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(6)
    for (const c of [0, 1, 2]) expect(argsOfCall(c)).toContain("http://u:p@main:1")
    for (const c of [3, 4, 5]) expect(argsOfCall(c)).toContain("http://u:p@fallback:2")
  })

  it("stops at the first proxy when its download succeeds — the fallback is never spawned", async () => {
    process.env.YTDLP_PROXY_POOL = "http://u:p@main:1 | http://u:p@fallback:2"
    // Rung 1 (web) on the main proxy succeeds → the ladder returns and the loop
    // breaks; findDownloadedFile then fails (no real file), but crucially the
    // fallback proxy is never tried.
    vi.mocked(spawn).mockImplementationOnce(() => fakeProc({ code: 0 }) as never)
    await expect(
      downloadYouTubeVideo({ url: "https://www.youtube.com/watch?v=x", outPath: "/tmp/x.mp4" }),
    ).rejects.toThrow(/did not produce an output file/i)
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1)
    expect(argsOfCall(0)).toContain("http://u:p@main:1")
  })
})

/**
 * "No audio makes no sense for a voice changer": import callers pass
 * `requireAudio`, so a silent download fails honestly instead of being ingested.
 * A DEFINITE no-audio (`false`) is required — a probe glitch (`null`) never fails
 * an import.
 */
describe("assertAudioPresent", () => {
  it("throws only when requireAudio AND the download is definitely silent", () => {
    expect(() => assertAudioPresent(false, true)).toThrow(/no audio track/i)
  })
  it("does not throw when audio is present", () => {
    expect(() => assertAudioPresent(true, true)).not.toThrow()
  })
  it("does not throw on unknown audio (null probe) — never fail an import on a probe glitch", () => {
    expect(() => assertAudioPresent(null, true)).not.toThrow()
  })
  it("does not throw when requireAudio is unset — a silent video is valid for general callers", () => {
    expect(() => assertAudioPresent(false, undefined)).not.toThrow()
    expect(() => assertAudioPresent(false, false)).not.toThrow()
  })
})

/**
 * The re-encode must not add `-c:a aac` to a video with no audio stream — that
 * makes ffmpeg abort ("Invalid argument", exit 234), the crash that turned a
 * silent download into a failed import.
 */
describe("reencodeToH264 — audio-conditional args", () => {
  beforeEach(() => vi.mocked(spawn).mockReset())
  const ffmpegArgs = () => vi.mocked(spawn).mock.calls[0][1] as string[]

  it("re-encodes video-only (`-an`, no `-c:a`) when hasAudio is false", async () => {
    vi.mocked(spawn).mockImplementationOnce(() => fakeProc({ code: 0 }) as never)
    await reencodeToH264("/tmp/in.webm", "/tmp/out.mp4", false)
    const args = ffmpegArgs()
    expect(args).toContain("-an")
    expect(args).not.toContain("-c:a")
  })

  it("encodes aac when hasAudio is true", async () => {
    vi.mocked(spawn).mockImplementationOnce(() => fakeProc({ code: 0 }) as never)
    await reencodeToH264("/tmp/in.webm", "/tmp/out.mp4", true)
    const args = ffmpegArgs()
    expect(args[args.indexOf("-c:a") + 1]).toBe("aac")
    expect(args).not.toContain("-an")
  })

  it("keeps aac on unknown audio (null probe) — the safe default", async () => {
    vi.mocked(spawn).mockImplementationOnce(() => fakeProc({ code: 0 }) as never)
    await reencodeToH264("/tmp/in.webm", "/tmp/out.mp4", null)
    expect(ffmpegArgs()).toContain("-c:a")
  })
})
