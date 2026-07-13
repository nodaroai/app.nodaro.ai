import { describe, it, expect, vi, beforeEach } from "vitest"
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
  YtUrlNotAllowedError,
  type YtClientRung,
} from "../youtube-video.js"

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

  it("spawns yt-dlp exactly once for a non-YouTube host, with no client pin", async () => {
    vi.mocked(spawn).mockImplementationOnce(() => fakeProc({ stderr: "ERROR: tiktok boom", code: 1 }) as never)
    await expect(
      downloadYouTubeVideo({ url: "https://www.tiktok.com/@a/video/1", outPath: "/tmp/x.mp4" }),
    ).rejects.toThrow("tiktok boom")
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1)
    expect(argsOfCall(0).join(" ")).not.toContain("player_client")
  })
})
