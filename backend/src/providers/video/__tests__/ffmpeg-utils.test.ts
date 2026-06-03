/**
 * ffmpeg-utils tests.
 *
 * ffmpeg-utils.ts is the foundational FFmpeg/FFprobe wrapper used by every
 * downstream video utility (combine-videos, trim-video, fade-video, etc.).
 * It owns:
 *   - The shared semaphore that caps concurrent ffmpeg processes to
 *     FFMPEG_CONCURRENCY (so a 2-vCPU box doesn't spawn 50 ffmpegs).
 *   - downloadFile() with SSRF-safe fetch
 *   - runFfmpeg() / runFfprobe() — the only place execFile is invoked
 *   - probeVideoSource() / probeVideoStream() — fragile CSV parsing
 *   - needsTranscode() / transcodeToBrowserSafe()
 *   - trimLastFrames() / stripAudio() / normalizeVideoForCombine()
 *   - createWorkDir() / cleanupWorkDir()
 *
 * Misroute any of these and silent file corruption / billing waste / SSRF
 * holes follow. Tests mock execFile, fs, and safeFetch at the module
 * boundary so they're hermetic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // execFile is the callback API: (cmd, args, opts, callback) => void
  // The default impl invokes the callback with empty stdout (success) so
  // tests that don't care about the stdout don't have to set it up.
  const execFile = vi.fn(
    (
      _cmd: string,
      _args: string[],
      _opts: { maxBuffer?: number; timeout?: number },
      cb: (
        error: NodeJS.ErrnoException | null,
        stdout: string,
        stderr: string,
      ) => void,
    ) => {
      cb(null, "", "")
    },
  )
  const fsMkdir = vi.fn().mockResolvedValue(undefined)
  const fsRm = vi.fn().mockResolvedValue(undefined)
  const safeFetch = vi.fn()
  const dnsLookup = vi.fn()
  const createWriteStream = vi.fn(() => ({}))
  const pipeline = vi.fn().mockResolvedValue(undefined)
  const readableFromWeb = vi.fn(() => ({}))
  return {
    execFile, fsMkdir, fsRm, safeFetch, dnsLookup,
    createWriteStream, pipeline, readableFromWeb,
  }
})

vi.mock("node:child_process", () => ({
  execFile: mocks.execFile,
}))

vi.mock("node:fs", () => ({
  createWriteStream: mocks.createWriteStream,
  promises: {
    mkdir: mocks.fsMkdir,
    rm: mocks.fsRm,
  },
}))

vi.mock("node:stream/promises", () => ({
  pipeline: mocks.pipeline,
}))

vi.mock("node:stream", () => ({
  Readable: { fromWeb: mocks.readableFromWeb },
}))

vi.mock("../../../lib/safe-fetch.js", async (importOriginal) => ({
  // Keep the REAL isPrivateOrReservedIP (a pure classifier used by the
  // probeVideoSource SSRF guard); only safeFetch is stubbed.
  ...(await importOriginal<typeof import("../../../lib/safe-fetch.js")>()),
  safeFetch: mocks.safeFetch,
}))

vi.mock("node:dns/promises", () => ({
  lookup: mocks.dnsLookup,
}))

vi.mock("@/lib/config.js", () => ({
  config: {
    FFMPEG_CONCURRENCY: 2,
    EDITION: "cloud",
    NODE_ENV: "test",
  },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

// ---------------------------------------------------------------------------
// Imports under test (after mocks)
// ---------------------------------------------------------------------------

import {
  downloadFile,
  runFfmpeg,
  runFfprobe,
  getVideoDuration,
  probeVideoSource,
  probeVideoStream,
  needsTranscode,
  transcodeToBrowserSafe,
  createWorkDir,
  cleanupWorkDir,
  trimLastFrames,
  stripAudio,
  normalizeVideoForCombine,
  BROWSER_SAFE_VIDEO_ARGS,
  REMOTION_INPUT_VIDEO_ARGS,
} from "../ffmpeg-utils.js"

beforeEach(() => {
  vi.clearAllMocks()
  // Reset to default execFile success; per-test overrides below set stdout.
  mocks.execFile.mockImplementation((_cmd, _args, _opts, cb) => {
    cb(null, "", "")
  })
  mocks.fsMkdir.mockResolvedValue(undefined)
  mocks.fsRm.mockResolvedValue(undefined)
  mocks.pipeline.mockResolvedValue(undefined)
  // Default: any hostname resolves to a public IP so URL-based probes proceed.
  mocks.dnsLookup.mockResolvedValue([{ address: "1.2.3.4", family: 4 }])
})

/** Helper: control execFile output once. */
function execFileOnce(stdout: string, error: NodeJS.ErrnoException | null = null, stderr = "") {
  mocks.execFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
    cb(error, stdout, stderr)
  })
}

/** Get the args of the Nth execFile call. */
function execArgs(index = 0): string[] {
  return mocks.execFile.mock.calls[index][1] as string[]
}

/** Get the cmd of the Nth execFile call. */
function execCmd(index = 0): string {
  return mocks.execFile.mock.calls[index][0] as string
}

// ===========================================================================
// 1) Constants
// ===========================================================================

describe("BROWSER_SAFE_VIDEO_ARGS", () => {
  it("encodes H.264 yuv420p with faststart", () => {
    expect(BROWSER_SAFE_VIDEO_ARGS).toContain("libx264")
    expect(BROWSER_SAFE_VIDEO_ARGS).toContain("yuv420p")
    expect(BROWSER_SAFE_VIDEO_ARGS).toContain("+faststart")
  })
})

describe("REMOTION_INPUT_VIDEO_ARGS", () => {
  it("forces -g 1 (keyframe every frame) for compositor seek performance", () => {
    expect(REMOTION_INPUT_VIDEO_ARGS).toContain("-g")
    expect(REMOTION_INPUT_VIDEO_ARGS).toContain("1")
  })

  it("uses higher quality CRF (18) than browser-safe default (23)", () => {
    const idx = REMOTION_INPUT_VIDEO_ARGS.indexOf("-crf")
    expect(REMOTION_INPUT_VIDEO_ARGS[idx + 1]).toBe("18")
  })
})

// ===========================================================================
// 2) downloadFile
// ===========================================================================

describe("downloadFile", () => {
  it("uses safeFetch (SSRF-protected) with a 120s timeout", async () => {
    mocks.safeFetch.mockResolvedValueOnce({
      ok: true,
      body: {} as never,
    })

    await downloadFile("https://example.com/video.mp4", "/tmp/out.mp4")

    expect(mocks.safeFetch).toHaveBeenCalledWith("https://example.com/video.mp4", {
      timeoutMs: 120_000,
    })
  })

  it("pipes the response body to a write stream", async () => {
    mocks.safeFetch.mockResolvedValueOnce({ ok: true, body: {} as never })

    await downloadFile("https://x.com/v.mp4", "/tmp/o.mp4")

    expect(mocks.createWriteStream).toHaveBeenCalledWith("/tmp/o.mp4")
    expect(mocks.pipeline).toHaveBeenCalledOnce()
  })

  it("throws on non-200 response with status in message", async () => {
    mocks.safeFetch.mockResolvedValueOnce({ ok: false, status: 404, body: null })

    await expect(downloadFile("https://x.com/missing.mp4", "/tmp/o.mp4"))
      .rejects.toThrow(/Failed to download.*404/)

    // Should not even attempt to pipe on failure
    expect(mocks.pipeline).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// 3) runFfprobe / runFfmpeg
// ===========================================================================

describe("runFfprobe", () => {
  it("invokes ffprobe with the supplied args and returns stdout", async () => {
    execFileOnce("probe-output\n")

    const out = await runFfprobe(["-show_streams", "/tmp/x.mp4"])

    expect(out).toBe("probe-output\n")
    expect(execCmd()).toBe("ffprobe")
    expect(execArgs()).toEqual(["-show_streams", "/tmp/x.mp4"])
  })

  it("throws with stderr in the error message when ffprobe fails", async () => {
    execFileOnce("", new Error("exit 1") as NodeJS.ErrnoException, "ffprobe: invalid file")

    await expect(runFfprobe(["bad-args"])).rejects.toThrow(
      /ffprobe failed: ffprobe: invalid file/,
    )
  })

  it("falls back to error.message when stderr is empty", async () => {
    execFileOnce("", new Error("ENOENT: ffprobe not found") as NodeJS.ErrnoException, "")

    await expect(runFfprobe(["x"])).rejects.toThrow(
      /ffprobe failed: ENOENT: ffprobe not found/,
    )
  })
})

describe("runFfmpeg", () => {
  it("invokes ffmpeg with the supplied args and returns stdout", async () => {
    execFileOnce("encode-stdout")

    const out = await runFfmpeg(["-y", "-i", "in.mp4", "out.mp4"])

    expect(out).toBe("encode-stdout")
    expect(execCmd()).toBe("ffmpeg")
    expect(execArgs()).toEqual(["-y", "-i", "in.mp4", "out.mp4"])
  })

  it("uses the default 10-minute timeout when none supplied", async () => {
    execFileOnce("")

    await runFfmpeg(["-i", "x"])

    const opts = mocks.execFile.mock.calls[0][2] as { timeout: number }
    expect(opts.timeout).toBe(10 * 60 * 1000)
  })

  it("respects custom timeout", async () => {
    execFileOnce("")

    await runFfmpeg(["-i", "x"], 30_000)

    const opts = mocks.execFile.mock.calls[0][2] as { timeout: number }
    expect(opts.timeout).toBe(30_000)
  })

  it("throws with stderr in error message", async () => {
    execFileOnce("", new Error("exit 1") as NodeJS.ErrnoException, "Conversion failed")

    await expect(runFfmpeg(["bad"])).rejects.toThrow(
      /ffmpeg failed: Conversion failed/,
    )
  })

  it("FIFO semaphore caps concurrent invocations at FFMPEG_CONCURRENCY", async () => {
    // FFMPEG_CONCURRENCY mocked to 2; launch 5 simultaneously and verify
    // execFile is only called twice before any of them finishes.
    let activeCallbacks: Array<() => void> = []
    mocks.execFile.mockImplementation((_cmd, _args, _opts, cb) => {
      // Defer the callback so we can inspect concurrency mid-flight.
      activeCallbacks.push(() => cb(null, "", ""))
    })

    const calls = [
      runFfmpeg(["-i", "1"]),
      runFfmpeg(["-i", "2"]),
      runFfmpeg(["-i", "3"]),
      runFfmpeg(["-i", "4"]),
      runFfmpeg(["-i", "5"]),
    ]
    // Yield once so the first 2 acquire slots
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.execFile).toHaveBeenCalledTimes(2)

    // Release the first 2 — that should let the next 2 in
    activeCallbacks[0]?.()
    activeCallbacks[1]?.()
    activeCallbacks = activeCallbacks.slice(2)
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.execFile).toHaveBeenCalledTimes(4)

    // Drain the rest so calls resolve and the test cleans up.
    while (activeCallbacks.length > 0) {
      activeCallbacks.shift()?.()
      await Promise.resolve()
      await Promise.resolve()
    }
    await Promise.all(calls)
  })

  it("releases the semaphore slot even when ffmpeg fails", async () => {
    // First call fails; second call should still get a slot.
    execFileOnce("", new Error("boom") as NodeJS.ErrnoException, "fail")
    execFileOnce("ok2")

    await expect(runFfmpeg(["a"])).rejects.toThrow()
    const second = await runFfmpeg(["b"])

    expect(second).toBe("ok2")
  })
})

// ===========================================================================
// 4) getVideoDuration
// ===========================================================================

describe("getVideoDuration", () => {
  it("parses the ffprobe duration output", async () => {
    execFileOnce("12.345\n")

    const dur = await getVideoDuration("/tmp/v.mp4")

    expect(dur).toBe(12.345)
  })

  it("calls ffprobe with the canonical 'format=duration' query", async () => {
    execFileOnce("5.0")

    await getVideoDuration("/tmp/v.mp4")

    const args = execArgs()
    expect(args).toContain("-show_entries")
    expect(args).toContain("format=duration")
    expect(args).toContain("/tmp/v.mp4")
  })

  it("trims whitespace from output", async () => {
    execFileOnce("  8.5  \n\n")

    const dur = await getVideoDuration("/tmp/v.mp4")

    expect(dur).toBe(8.5)
  })

  it("throws when output is non-numeric", async () => {
    execFileOnce("not-a-number")

    await expect(getVideoDuration("/tmp/v.mp4")).rejects.toThrow(
      /Could not determine duration/,
    )
  })

  it("throws when duration is zero", async () => {
    execFileOnce("0")

    await expect(getVideoDuration("/tmp/v.mp4")).rejects.toThrow(
      /Could not determine duration/,
    )
  })

  it("throws when duration is negative", async () => {
    execFileOnce("-1.5")

    await expect(getVideoDuration("/tmp/v.mp4")).rejects.toThrow(
      /Could not determine duration/,
    )
  })
})

// ===========================================================================
// 5) probeVideoSource
// ===========================================================================

describe("probeVideoSource", () => {
  it("parses 2-line CSV output (stream first, format second)", async () => {
    execFileOnce("1920,1080\n8.5\n")

    const result = await probeVideoSource("/tmp/v.mp4")

    expect(result).toEqual({ width: 1920, height: 1080, durationSeconds: 8.5 })
  })

  it("parses output regardless of line order (format first, stream second)", async () => {
    execFileOnce("8.5\n1920,1080\n")

    const result = await probeVideoSource("/tmp/v.mp4")

    expect(result).toEqual({ width: 1920, height: 1080, durationSeconds: 8.5 })
  })

  it("handles \\r\\n line endings (Windows ffprobe builds)", async () => {
    execFileOnce("1280,720\r\n5.0\r\n")

    const result = await probeVideoSource("/tmp/v.mp4")

    expect(result).toEqual({ width: 1280, height: 720, durationSeconds: 5.0 })
  })

  it("throws when width/height/duration cannot be extracted", async () => {
    execFileOnce("garbage\nmore garbage\n")

    await expect(probeVideoSource("/tmp/v.mp4"))
      .rejects.toThrow(/probeVideoSource failed to parse/)
  })

  it("works with a remote URL (passes it through to ffprobe)", async () => {
    execFileOnce("1920,1080\n10.0\n")

    await probeVideoSource("https://r2/video.mp4")

    expect(execArgs()).toContain("https://r2/video.mp4")
  })

  // --- SSRF guard (ffprobe does its own DNS+network I/O, bypassing safeFetch) ---

  it("rejects a literal private/metadata IP URL BEFORE invoking ffprobe", async () => {
    await expect(
      probeVideoSource("http://169.254.169.254/latest/meta-data/"),
    ).rejects.toThrow(/private|reserved|blocked/i)
    expect(mocks.execFile).not.toHaveBeenCalled()
  })

  it("rejects loopback and RFC-1918 literal IP URLs", async () => {
    await expect(probeVideoSource("http://127.0.0.1/v.mp4")).rejects.toThrow(/private|reserved|blocked/i)
    await expect(probeVideoSource("http://10.0.0.5/v.mp4")).rejects.toThrow(/private|reserved|blocked/i)
    expect(mocks.execFile).not.toHaveBeenCalled()
  })

  it("rejects non-http(s) protocols (e.g. file://) BEFORE invoking ffprobe", async () => {
    await expect(probeVideoSource("file:///etc/passwd")).rejects.toThrow(/protocol/i)
    expect(mocks.execFile).not.toHaveBeenCalled()
  })

  it("rejects a hostname that RESOLVES to a private IP (DNS-rebinding class)", async () => {
    mocks.dnsLookup.mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }])
    await expect(probeVideoSource("http://evil.example/v.mp4")).rejects.toThrow(/resolve|private|reserved/i)
    expect(mocks.execFile).not.toHaveBeenCalled()
  })

  it("passes -protocol_whitelist to ffprobe (blocks protocol pivots)", async () => {
    execFileOnce("1920,1080\n10.0\n")
    await probeVideoSource("/tmp/v.mp4")
    const args = execArgs()
    expect(args).toContain("-protocol_whitelist")
  })

  it("allows a local filesystem path with no DNS lookup", async () => {
    execFileOnce("1920,1080\n7.0\n")
    const result = await probeVideoSource("/tmp/local.mp4")
    expect(result).toEqual({ width: 1920, height: 1080, durationSeconds: 7.0 })
    expect(mocks.dnsLookup).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// 6) probeVideoStream
// ===========================================================================

describe("probeVideoStream", () => {
  it("parses codec_name,pix_fmt CSV", async () => {
    execFileOnce("h264,yuv420p\n")

    const result = await probeVideoStream("/tmp/v.mp4")

    expect(result).toEqual({ codec: "h264", pixFmt: "yuv420p" })
  })

  it("lowercases output", async () => {
    execFileOnce("H264,YUV420P\n")

    const result = await probeVideoStream("/tmp/v.mp4")

    expect(result).toEqual({ codec: "h264", pixFmt: "yuv420p" })
  })

  it("returns empty strings when fields are missing", async () => {
    execFileOnce(",\n")

    const result = await probeVideoStream("/tmp/v.mp4")

    expect(result).toEqual({ codec: "", pixFmt: "" })
  })
})

// ===========================================================================
// 7) needsTranscode
// ===========================================================================

describe("needsTranscode", () => {
  it("returns false for h264 + yuv420p (browser-safe)", async () => {
    execFileOnce("h264,yuv420p\n")

    expect(await needsTranscode("/tmp/v.mp4")).toBe(false)
  })

  it("returns true for non-h264 codec", async () => {
    execFileOnce("hevc,yuv420p\n")

    expect(await needsTranscode("/tmp/v.mp4")).toBe(true)
  })

  it("returns true for non-yuv420p pixel format (yuv420p10le → 10-bit)", async () => {
    execFileOnce("h264,yuv420p10le\n")

    expect(await needsTranscode("/tmp/v.mp4")).toBe(true)
  })

  it("returns true when codec/pixFmt cannot be determined", async () => {
    execFileOnce(",\n")

    expect(await needsTranscode("/tmp/v.mp4")).toBe(true)
  })
})

// ===========================================================================
// 8) transcodeToBrowserSafe
// ===========================================================================

describe("transcodeToBrowserSafe", () => {
  it("returns inputPath unchanged when already browser-safe (no ffmpeg call)", async () => {
    execFileOnce("h264,yuv420p\n") // probe says h264 yuv420p

    const result = await transcodeToBrowserSafe("/tmp/in.mp4", "/tmp/out.mp4")

    expect(result).toBe("/tmp/in.mp4")
    // Only the probe ran — no ffmpeg invocation.
    expect(mocks.execFile).toHaveBeenCalledTimes(1)
    expect(execCmd(0)).toBe("ffprobe")
  })

  it("transcodes when codec is not h264, returning outputPath", async () => {
    execFileOnce("hevc,yuv420p\n") // probe
    execFileOnce("") // ffmpeg

    const result = await transcodeToBrowserSafe("/tmp/in.mp4", "/tmp/out.mp4")

    expect(result).toBe("/tmp/out.mp4")
    expect(mocks.execFile).toHaveBeenCalledTimes(2)
    expect(execCmd(1)).toBe("ffmpeg")
    const args = execArgs(1)
    expect(args).toContain("libx264")
    expect(args).toContain("yuv420p")
    expect(args).toContain("/tmp/out.mp4")
  })

  it("includes AAC audio re-encode when transcoding", async () => {
    execFileOnce("hevc,yuv420p\n")
    execFileOnce("")

    await transcodeToBrowserSafe("/tmp/in.mp4", "/tmp/out.mp4")

    const args = execArgs(1)
    expect(args).toContain("-c:a")
    expect(args).toContain("aac")
    expect(args).toContain("-b:a")
    expect(args).toContain("128k")
  })
})

// ===========================================================================
// 9) createWorkDir / cleanupWorkDir
// ===========================================================================

describe("createWorkDir", () => {
  it("creates a tmp dir with the given prefix and recursive flag", async () => {
    const dir = await createWorkDir("test-prefix")

    expect(dir).toMatch(/test-prefix-/)
    expect(mocks.fsMkdir).toHaveBeenCalledWith(
      dir,
      { recursive: true },
    )
  })

  it("each call returns a unique path (UUID suffix)", async () => {
    const a = await createWorkDir("p")
    const b = await createWorkDir("p")
    expect(a).not.toBe(b)
  })
})

describe("cleanupWorkDir", () => {
  it("removes the dir recursively + force", async () => {
    await cleanupWorkDir("/tmp/work")

    expect(mocks.fsRm).toHaveBeenCalledWith(
      "/tmp/work",
      { recursive: true, force: true },
    )
  })

  it("swallows rm failures (catch silently)", async () => {
    mocks.fsRm.mockRejectedValueOnce(new Error("EBUSY"))

    await expect(cleanupWorkDir("/tmp/work")).resolves.toBeUndefined()
  })
})

// ===========================================================================
// 10) trimLastFrames
// ===========================================================================

describe("trimLastFrames", () => {
  it("computes target duration as source - frames/fps", async () => {
    execFileOnce("10.000\n") // getVideoDuration probe
    execFileOnce("") // ffmpeg trim

    await trimLastFrames("/tmp/in.mp4", "/tmp/out.mp4", 8, 24)

    const args = execArgs(1)
    const tIdx = args.indexOf("-t")
    expect(tIdx).toBeGreaterThan(-1)
    // 10 - 8/24 = 9.6667 → "9.667"
    expect(args[tIdx + 1]).toBe("9.667")
  })

  it("re-encodes video (libx264 + crf 20) so cut lands on exact frame", async () => {
    execFileOnce("10.0\n")
    execFileOnce("")

    await trimLastFrames("/tmp/in.mp4", "/tmp/out.mp4", 8, 24)

    const args = execArgs(1)
    expect(args).toContain("libx264")
    const crfIdx = args.indexOf("-crf")
    expect(args[crfIdx + 1]).toBe("20")
  })

  it("stream-copies audio (-c:a copy) since we only shorten duration", async () => {
    execFileOnce("10.0\n")
    execFileOnce("")

    await trimLastFrames("/tmp/in.mp4", "/tmp/out.mp4", 8, 24)

    const args = execArgs(1)
    const idx = args.indexOf("-c:a")
    expect(args[idx + 1]).toBe("copy")
  })

  it("throws when source is too short to trim (target ≤ 0)", async () => {
    execFileOnce("0.1\n") // 100ms duration; trim 8 frames @ 24fps = 333ms

    await expect(trimLastFrames("/tmp/in.mp4", "/tmp/out.mp4", 8, 24))
      .rejects.toThrow(/too short to trim/)
  })

  it("returns the outputPath on success", async () => {
    execFileOnce("10.0\n")
    execFileOnce("")

    const result = await trimLastFrames("/tmp/in.mp4", "/tmp/out.mp4", 8, 24)

    expect(result).toBe("/tmp/out.mp4")
  })
})

// ===========================================================================
// 11) stripAudio
// ===========================================================================

describe("stripAudio", () => {
  it("invokes ffmpeg with -an and -c:v copy (no re-encode)", async () => {
    execFileOnce("")

    await stripAudio("/tmp/in.mp4", "/tmp/out.mp4")

    const args = execArgs()
    expect(args).toContain("-an")
    const idx = args.indexOf("-c:v")
    expect(args[idx + 1]).toBe("copy")
  })

  it("returns the outputPath", async () => {
    execFileOnce("")

    const result = await stripAudio("/tmp/in.mp4", "/tmp/out.mp4")

    expect(result).toBe("/tmp/out.mp4")
  })
})

// ===========================================================================
// 12) normalizeVideoForCombine
// ===========================================================================

describe("normalizeVideoForCombine", () => {
  it("forces fps=24 + scale/pad to the target resolution + h264/yuv420p + AAC", async () => {
    execFileOnce("")

    await normalizeVideoForCombine("/tmp/in.mp4", "/tmp/out.mp4", 1280, 720)

    const args = execArgs()
    const vfIdx = args.indexOf("-vf")
    expect(args[vfIdx + 1]).toContain("fps=24")
    expect(args[vfIdx + 1]).toContain("scale=1280:720:force_original_aspect_ratio=decrease")
    expect(args[vfIdx + 1]).toContain("pad=1280:720")
    expect(args[vfIdx + 1]).toContain("setsar=1")
    expect(args).toContain("libx264")
    expect(args).toContain("yuv420p")
    expect(args).toContain("aac")
  })

  it("rounds odd target dimensions down to even", async () => {
    execFileOnce("")

    await normalizeVideoForCombine("/tmp/in.mp4", "/tmp/out.mp4", 865, 497)

    const args = execArgs()
    const vfIdx = args.indexOf("-vf")
    expect(args[vfIdx + 1]).toContain("scale=864:496:force_original_aspect_ratio=decrease")
    expect(args[vfIdx + 1]).toContain("pad=864:496")
  })

  it("returns outputPath", async () => {
    execFileOnce("")

    const result = await normalizeVideoForCombine("/tmp/in.mp4", "/tmp/out.mp4", 1920, 1080)

    expect(result).toBe("/tmp/out.mp4")
  })
})
