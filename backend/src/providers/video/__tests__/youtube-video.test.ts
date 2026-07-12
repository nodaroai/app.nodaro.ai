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
  YtUrlNotAllowedError,
} from "../youtube-video.js"

/** Minimal stand-in for a spawned ffprobe: emits stdout, then closes. */
function fakeProc(opts: { stdout?: string; code?: number; error?: Error }) {
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
    expect(args).toContain("--extractor-args")
    expect(args.join(" ")).toContain("youtube:player_client=android")
    expect(args.join(" ")).toContain("--max-filesize 512M")
    expect(args.join(" ")).toContain("--merge-output-format mp4")
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
