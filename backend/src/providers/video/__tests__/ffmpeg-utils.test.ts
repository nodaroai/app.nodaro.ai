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
  // spawn (streamed ffprobe packet scans): each call pops a script
  // `{ stdout, code }` and replays it as chunked data + close events.
  const spawnScripts: Array<{ stdout: string; code?: number; stderr?: string }> = []
  const spawn = vi.fn((_cmd: string, _args: string[]) => {
    const script = spawnScripts.shift() ?? { stdout: "", code: 0 }
    const listeners: Record<string, Array<(...a: unknown[]) => void>> = {}
    const on = (bucket: Record<string, Array<(...a: unknown[]) => void>>) => (ev: string, cb: (...a: unknown[]) => void) => {
      ;(bucket[ev] ??= []).push(cb)
    }
    const stdoutL: Record<string, Array<(...a: unknown[]) => void>> = {}
    const stderrL: Record<string, Array<(...a: unknown[]) => void>> = {}
    const proc = { stdout: { on: on(stdoutL) }, stderr: { on: on(stderrL) }, on: on(listeners), kill: vi.fn() }
    setImmediate(() => {
      // Deliver in two chunks split mid-line so the line buffering is exercised.
      const cut = Math.floor(script.stdout.length / 2)
      for (const part of [script.stdout.slice(0, cut), script.stdout.slice(cut)]) {
        if (part) for (const cb of stdoutL.data ?? []) cb(Buffer.from(part))
      }
      if (script.stderr) for (const cb of stderrL.data ?? []) cb(Buffer.from(script.stderr))
      for (const cb of listeners.close ?? []) cb(script.code ?? 0)
    })
    return proc
  })
  return {
    execFile, fsMkdir, fsRm, safeFetch, dnsLookup,
    createWriteStream, pipeline, readableFromWeb,
    spawn, spawnScripts,
  }
})

vi.mock("node:child_process", () => ({
  execFile: mocks.execFile,
  spawn: mocks.spawn,
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

vi.mock("node:stream", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:stream")>()), // a real Transform (the stall watch)
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

// R2-origin fallback plumbing: r2KeyFromOurUrl keeps realistic prefix
// semantics (only OUR public-bucket URLs map to keys) so the foreign-URL
// tests stay honest; downloadR2ObjectToFile is the spy under test.
const storageMocks = vi.hoisted(() => ({
  downloadR2ObjectToFile: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("../../../lib/storage.js", () => ({
  r2KeyFromOurUrl: (url: string) =>
    url.startsWith("https://r2.example.com/") ? url.slice("https://r2.example.com/".length) : null,
  downloadR2ObjectToFile: storageMocks.downloadR2ObjectToFile,
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
  BIG_MEDIA_DOWNLOAD_LIMITS,
  downloadFile,
  runFfmpeg,
  withFfmpegSlot,
  runFfprobe,
  getVideoDuration,
  getVideoStreamDuration,
  getVideoFps,
  probeVideoSource,
  probeVideoStream,
  probeMediaStreams,
  needsTranscode,
  transcodeToBrowserSafe,
  createWorkDir,
  cleanupWorkDir,
  trimLastFrames,
  trimEdgeFrames,
  stripAudio,
  normalizeVideoForCombine,
  BROWSER_SAFE_VIDEO_ARGS,
  REMOTION_INPUT_VIDEO_ARGS,
  ffmpegFailureMessage,
  parsePacketLine,
  parseStreamListing,
  probeStreamEnds,
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
  it("by default uses safeFetch (SSRF-protected) with one flat 120 s timeout — unchanged for the ~60 ordinary callers", async () => {
    mocks.safeFetch.mockResolvedValueOnce({
      ok: true,
      body: {} as never,
    })

    await downloadFile("https://example.com/video.mp4", "/tmp/out.mp4")

    expect(mocks.safeFetch).toHaveBeenCalledWith("https://example.com/video.mp4", {
      timeoutMs: 120_000,
    })
  })

  it("with big-media limits, carries its own abort signal, sets safeFetch's timer past the overall ceiling (a backstop only) and asks for an uncompressed body", async () => {
    mocks.safeFetch.mockResolvedValueOnce({ ok: true, body: {} as never, headers: new Headers() })

    await downloadFile("https://example.com/video.mp4", "/tmp/out.mp4", { limits: BIG_MEDIA_DOWNLOAD_LIMITS })

    expect(mocks.safeFetch).toHaveBeenCalledWith("https://example.com/video.mp4", {
      timeoutMs: 60 * 60_000 + 5_000,
      signal: expect.any(AbortSignal),
      headers: { "accept-encoding": "identity" },
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

  // ── CDN negative-cache fallback (per-edge 404s for media that exists;
  //    incidents 2026-06-10/12) ──

  it("404 on OUR public-bucket URL falls back to the R2 origin", async () => {
    mocks.safeFetch.mockResolvedValueOnce({ ok: false, status: 404, body: null })

    await downloadFile("https://r2.example.com/videos/job-1.mp4", "/tmp/o.mp4")

    expect(storageMocks.downloadR2ObjectToFile).toHaveBeenCalledWith("videos/job-1.mp4", "/tmp/o.mp4")
    expect(mocks.pipeline).not.toHaveBeenCalled()
  })

  it("404 on a foreign URL does NOT touch the R2 origin", async () => {
    mocks.safeFetch.mockResolvedValueOnce({ ok: false, status: 404, body: null })

    await expect(downloadFile("https://provider.example/missing.mp4", "/tmp/o.mp4"))
      .rejects.toThrow(/404/)
    expect(storageMocks.downloadR2ObjectToFile).not.toHaveBeenCalled()
  })

  it("non-404 errors on our URL still throw (fallback is 404-only)", async () => {
    mocks.safeFetch.mockResolvedValueOnce({ ok: false, status: 500, body: null })

    await expect(downloadFile("https://r2.example.com/videos/job-1.mp4", "/tmp/o.mp4"))
      .rejects.toThrow(/500/)
    expect(storageMocks.downloadR2ObjectToFile).not.toHaveBeenCalled()
  })
})

describe("runFfprobe watchdog", () => {
  it("enforces a 120s timeout so remote probes can never hang a worker", async () => {
    execFileOnce("1280,720\n4.0")
    await runFfprobe(["-v", "error", "https://cdn.example/x.mp4"])
    const opts = mocks.execFile.mock.calls[0][2] as { timeout?: number }
    expect(opts.timeout).toBe(120_000)
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

  // jobs.error_message keeps only the FIRST 500 chars (lib/job-failure.ts) and
  // ffmpeg opens every run with a multi-KB banner — so the cause must ride in
  // the message TAIL or it never reaches /admin/app-reports (prod 2026-09-06).
  it("drops ffmpeg's banner and keeps the cause within the stored 500 chars", async () => {
    const banner = [
      "ffmpeg version n8.1.2-21-gce3c09c101-20260630 Copyright (c) 2000-2026 the FFmpeg developers",
      "  built with gcc 15.2.0 (crosstool-NG 1.28.0.23_185f348)",
      `  configuration: ${"--enable-something ".repeat(120)}`,
      ...Array.from({ length: 20 }, (_, i) => `  libavcodec${i} 62. ${i}.100 / 62. ${i}.100`),
    ].join("\n")
    execFileOnce(
      "",
      new Error("exit 1") as NodeJS.ErrnoException,
      `${banner}\nStream map '0:v' matches no streams.\n`,
    )

    const err = await runFfmpeg(["bad"]).then(() => null, (e: Error) => e)

    expect(err?.message).toMatch(/^ffmpeg failed: /)
    expect(err?.message).toContain("Stream map '0:v' matches no streams.")
    expect(err?.message).not.toContain("ffmpeg version")
    expect(err?.message.slice(0, 500)).toContain("matches no streams")
  })

  // No stderr at all (a spawn/exit failure): Node's execFile message is
  // "Command failed: ffmpeg -y -i … <every arg>", which would itself eat the
  // budget. Tail that too rather than storing the head of the command line.
  it("falls back to the tail of the spawn error when stderr is empty", async () => {
    const longCommand = `Command failed: ffmpeg -y -i ${"input-".repeat(200)}0.mp4 out.mp4`
    execFileOnce("", new Error(longCommand) as NodeJS.ErrnoException, "")

    const err = await runFfmpeg(["bad"]).then(() => null, (e: Error) => e)

    expect(err?.message).toMatch(/^ffmpeg failed: /)
    expect(err?.message).toContain("out.mp4")
    expect(err?.message.length).toBeLessThan(500)
  })
})

describe("ffmpegFailureMessage", () => {
  it("keeps the last lines, newest last", () => {
    expect(ffmpegFailureMessage("one\ntwo\nthree\n", "unused")).toBe("ffmpeg failed: one\ntwo\nthree")
  })

  it("says so rather than throwing an empty message", () => {
    expect(ffmpegFailureMessage("", "")).toBe("ffmpeg failed: no output")
  })

  it("tail-cuts a single over-long line instead of dropping it", () => {
    const line = `Error: ${"x".repeat(900)}END`
    const msg = ffmpegFailureMessage(line, "unused")
    expect(msg).toContain("END")
    expect(msg.length).toBeLessThan(500)
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

  it("removes a cancelled waiter without consuming a future CPU slot", async () => {
    const releases: Array<() => void> = []
    const hold = () => new Promise<void>((resolve) => releases.push(resolve))
    const busy = [withFfmpegSlot(hold), withFfmpegSlot(hold)]
    await Promise.resolve(); await Promise.resolve()
    const controller = new AbortController(), cancelledWork = vi.fn(async () => {})
    const cancelled = withFfmpegSlot(cancelledWork, controller.signal)
    const rejection = expect(cancelled).rejects.toThrow("stop")
    const nextWork = vi.fn(async () => {})
    const next = withFfmpegSlot(nextWork)
    controller.abort(new Error("stop"))
    await rejection
    releases.forEach((release) => release())
    await Promise.all([...busy, next])
    expect(cancelledWork).not.toHaveBeenCalled()
    expect(nextWork).toHaveBeenCalledOnce()
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
// 4b) getVideoFps
// ===========================================================================

describe("getVideoFps", () => {
  it("parses a fractional r_frame_rate (e.g. 30000/1001)", async () => {
    execFileOnce("30000/1001\n")

    const fps = await getVideoFps("/tmp/v.mp4")

    expect(fps).toBeCloseTo(29.97, 1)
  })

  it("reads the first row of an MPEG-TS answer, which repeats the stream under its program (was 30000 fps → a 60 fps canvas)", async () => {
    execFileOnce("30000/1001\n\n30000/1001\n")

    expect(await getVideoFps("/tmp/cam.ts")).toBeCloseTo(29.97, 2)
  })

  it("reads a rotated phone MP4 / MPEG-PS answer, whose side data appends an empty field (was 30000 fps → a 60 fps canvas)", async () => {
    execFileOnce("30000/1001,\n")

    expect(await getVideoFps("/tmp/rotated.mp4")).toBeCloseTo(29.97, 2)
  })

  it("parses a whole-number fraction (24/1)", async () => {
    execFileOnce("24/1\n")

    expect(await getVideoFps("/tmp/v.mp4")).toBe(24)
  })

  it("falls back to 30 when the probe yields an invalid fraction", async () => {
    execFileOnce("invalid\n")

    expect(await getVideoFps("/tmp/v.mp4")).toBe(30)
  })

  it("falls back to 30 when ffprobe throws", async () => {
    execFileOnce("", new Error("boom") as NodeJS.ErrnoException, "ffprobe: no such file")

    expect(await getVideoFps("/tmp/missing.mp4")).toBe(30)
  })
})

// ===========================================================================
// 5) probeVideoSource
// ===========================================================================

describe("probeVideoSource", () => {
  it("reads dimensions and duration from named JSON fields", async () => {
    execFileOnce(JSON.stringify({ streams: [{ width: 1920, height: 1080 }], format: { duration: "8.5" } }))

    const result = await probeVideoSource("/tmp/v.mp4")

    expect(result).toEqual({ width: 1920, height: 1080, durationSeconds: 8.5 })
    expect(execArgs()).toEqual(expect.arrayContaining(["-of", "json"]))
  })

  it("ignores JSON field order", async () => {
    execFileOnce(JSON.stringify({ format: { duration: "8.5" }, streams: [{ width: 1920, height: 1080 }] }))

    const result = await probeVideoSource("/tmp/v.mp4")

    expect(result).toEqual({ width: 1920, height: 1080, durationSeconds: 8.5 })
  })

  it("reads streams with side data without losing dimensions", async () => {
    execFileOnce(JSON.stringify({ streams: [{ width: 1280, height: 720, side_data_list: [{}] }], format: { duration: "5.0" } }, null, 2))

    const result = await probeVideoSource("/tmp/v.mp4")

    expect(result).toEqual({ width: 1280, height: 720, durationSeconds: 5.0 })
  })

  it("throws when width/height/duration cannot be extracted", async () => {
    execFileOnce("garbage\nmore garbage\n")

    await expect(probeVideoSource("/tmp/v.mp4"))
      .rejects.toThrow(/probeVideoSource failed to parse/)
  })

  it("works with a remote URL (passes it through to ffprobe)", async () => {
    execFileOnce(JSON.stringify({ streams: [{ width: 1920, height: 1080 }], format: { duration: "10.0" } }))

    await probeVideoSource("https://r2/video.mp4")

    expect(execArgs()).toContain("https://r2/video.mp4")
  })

  it.each([
    { streams: [], format: { duration: "4" } },
    { streams: [{ width: 960, height: 540 }], format: { duration: "N/A" } },
    { streams: [{ width: 960, height: 540 }], format: { duration: "Infinity" } },
    { streams: [{ width: 960, height: 540 }], format: { duration: "0" } },
    { streams: [{ width: -1, height: 540 }], format: { duration: "4" } },
    { streams: [{ width: 960.5, height: 540 }], format: { duration: "4" } },
    null,
  ])("rejects missing or invalid video metadata: %j", async (metadata) => {
    execFileOnce(JSON.stringify(metadata))
    await expect(probeVideoSource("/tmp/v.mp4")).rejects.toThrow(/probeVideoSource failed to parse/)
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
    execFileOnce(JSON.stringify({ streams: [{ width: 1920, height: 1080 }], format: { duration: "10.0" } }))
    await probeVideoSource("/tmp/v.mp4")
    const args = execArgs()
    expect(args).toContain("-protocol_whitelist")
  })

  it("allows a local filesystem path with no DNS lookup", async () => {
    execFileOnce(JSON.stringify({ streams: [{ width: 1920, height: 1080 }], format: { duration: "7.0" } }))
    const result = await probeVideoSource("/tmp/local.mp4")
    expect(result).toEqual({ width: 1920, height: 1080, durationSeconds: 7.0 })
    expect(mocks.dnsLookup).not.toHaveBeenCalled()
  })

  // --- frame rate (the burn-captions render follows the SOURCE's rate) ---

  const withRate = (rates: Record<string, unknown>) =>
    JSON.stringify({ streams: [{ width: 1920, height: 1080, ...rates }], format: { duration: "5" } })

  it("parses the rational avg_frame_rate", async () => {
    execFileOnce(withRate({ avg_frame_rate: "24000/1001", r_frame_rate: "24000/1001" }))
    expect((await probeVideoSource("/tmp/v.mp4")).fps).toBeCloseTo(23.976, 3)
  })

  it("asks ffprobe for both rates", async () => {
    execFileOnce(withRate({ avg_frame_rate: "30/1" }))
    await probeVideoSource("/tmp/v.mp4")
    expect(execArgs()).toContain("stream=width,height,avg_frame_rate,r_frame_rate:format=duration")
  })

  it("falls back to r_frame_rate when the average is the unusable 0/0", async () => {
    execFileOnce(withRate({ avg_frame_rate: "0/0", r_frame_rate: "25/1" }))
    expect((await probeVideoSource("/tmp/v.mp4")).fps).toBe(25)
  })

  it("reports NO fps for a VARIABLE-frame-rate source (average far from the nominal base)", async () => {
    // A sparse screen recording: 6.2 fps average against a 60 fps base. Neither
    // number is a constant playback rate, and re-encoding at the average
    // decimates the bursts of real motion — so the caller falls back instead.
    execFileOnce(withRate({ avg_frame_rate: "31/5", r_frame_rate: "60/1" }))
    expect((await probeVideoSource("/tmp/v.mp4")).fps).toBeUndefined()
  })

  it("keeps the average when the two rates agree (ordinary constant-rate clip)", async () => {
    execFileOnce(withRate({ avg_frame_rate: "30000/1001", r_frame_rate: "30/1" }))
    expect((await probeVideoSource("/tmp/v.mp4")).fps).toBeCloseTo(29.97, 2)
    // Just inside the tolerance (10 %) stays a rate; just outside does not.
    execFileOnce(withRate({ avg_frame_rate: "55/1", r_frame_rate: "60/1" }))
    expect((await probeVideoSource("/tmp/v.mp4")).fps).toBe(55)
    execFileOnce(withRate({ avg_frame_rate: "50/1", r_frame_rate: "60/1" }))
    expect((await probeVideoSource("/tmp/v.mp4")).fps).toBeUndefined()
  })

  it.each([
    { avg_frame_rate: "0/0", r_frame_rate: "0/0" },
    { avg_frame_rate: "N/A" },
    { avg_frame_rate: "30/0" },
    { avg_frame_rate: "" },
    { avg_frame_rate: 30 },
    {},
  ])("reports NO fps rather than a made-up one: %j", async (rates) => {
    execFileOnce(withRate(rates))
    // The caller decides the fallback — an unreadable rate is not an error
    // either: dimensions and duration are the contract, fps is a bonus.
    const result = await probeVideoSource("/tmp/v.mp4")
    expect(result.fps).toBeUndefined()
    expect(result.durationSeconds).toBe(5)
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

  it("an MPEG-TS answer (stream repeated under its program) is read from its first row — a TS used to always 'need transcode'", async () => {
    execFileOnce("h264,yuv420p\n\nh264,yuv420p\n")

    expect(await probeVideoStream("/tmp/cam.ts")).toEqual({ codec: "h264", pixFmt: "yuv420p" })
    execFileOnce("h264,yuv420p\n\nh264,yuv420p\n")
    expect(await needsTranscode("/tmp/cam.ts")).toBe(false)
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
// 10b) trimEdgeFrames
//
// Shared by combine-videos.ts (clip-boundary seam trim) and
// assemble-narrated-video.ts (interior block-join seam trim) — see
// combine-videos.test.ts for coverage of the CALLERS' boundary-protection
// math (which frame counts get zeroed for the first/last clip); this suite
// owns the helper's own probe/skip/re-encode semantics. A real-ffmpeg
// fixture test lives in trim-edge-frames.e2e.test.ts (this file mocks
// execFile globally, so it can't exercise real duration math end to end).
// ===========================================================================

describe("trimEdgeFrames", () => {
  it("returns inputPath unchanged when both trim counts are <= 0 (skips the probe entirely)", async () => {
    const result = await trimEdgeFrames("/tmp/in.mp4", "/tmp/out.mp4", 0, 0)

    expect(result).toBe("/tmp/in.mp4")
    expect(mocks.execFile).not.toHaveBeenCalled()
  })

  it("returns inputPath unchanged for negative trim counts (treated as <= 0)", async () => {
    const result = await trimEdgeFrames("/tmp/in.mp4", "/tmp/out.mp4", -5, -1)

    expect(result).toBe("/tmp/in.mp4")
    expect(mocks.execFile).not.toHaveBeenCalled()
  })

  it("returns inputPath unchanged when the requested trim would meet/exceed the clip duration", async () => {
    execFileOnce("30/1\n") // fps probe → 30fps
    execFileOnce("1.000\n") // duration probe → 1s clip

    // 30 frames @ 30fps = 1s start trim; clip is exactly 1s → startSec+endSec
    // (1) >= duration (1) → skip, no ffmpeg trim call.
    const result = await trimEdgeFrames("/tmp/in.mp4", "/tmp/out.mp4", 30, 0)

    expect(result).toBe("/tmp/in.mp4")
    expect(mocks.execFile).toHaveBeenCalledTimes(2) // fps + duration probes only
  })

  it("trims only the start when trimEndFrames is 0 (-ss present, no -to)", async () => {
    execFileOnce("30/1\n")
    execFileOnce("10.0\n")
    execFileOnce("") // ffmpeg trim

    const result = await trimEdgeFrames("/tmp/in.mp4", "/tmp/out.mp4", 30, 0)

    const args = execArgs(2)
    expect(args[args.indexOf("-ss") + 1]).toBe("1")
    expect(args).not.toContain("-to")
    expect(result).toBe("/tmp/out.mp4")
  })

  it("trims only the end when trimStartFrames is 0 (-to present, no -ss)", async () => {
    execFileOnce("30/1\n")
    execFileOnce("10.0\n")
    execFileOnce("")

    await trimEdgeFrames("/tmp/in.mp4", "/tmp/out.mp4", 0, 30)

    const args = execArgs(2)
    expect(args).not.toContain("-ss")
    expect(args[args.indexOf("-to") + 1]).toBe("9")
  })

  it("trims both ends and re-encodes with libx264 fast preset + aac audio", async () => {
    execFileOnce("30/1\n")
    execFileOnce("10.0\n")
    execFileOnce("")

    await trimEdgeFrames("/tmp/in.mp4", "/tmp/out.mp4", 30, 30)

    const args = execArgs(2)
    expect(args[args.indexOf("-ss") + 1]).toBe("1")
    expect(args[args.indexOf("-to") + 1]).toBe("9")
    expect(args).toContain("libx264")
    expect(args[args.indexOf("-preset") + 1]).toBe("fast")
    // Delivery CRF: this re-encode stacks on top of normalize's on the cut
    // path — an implicit x264 default (23) was a second bitrate halving.
    expect(args[args.indexOf("-crf") + 1]).toBe("18")
    expect(args[args.indexOf("-c:a") + 1]).toBe("aac")
    expect(args[args.length - 1]).toBe("/tmp/out.mp4")
  })

  it("uses whatever fps getVideoFps resolves (including its own invalid-probe 30fps fallback)", async () => {
    execFileOnce("invalid\n") // getVideoFps falls back to 30
    execFileOnce("10.0\n")
    execFileOnce("")

    await trimEdgeFrames("/tmp/in.mp4", "/tmp/out.mp4", 30, 0)

    const args = execArgs(2)
    expect(args[args.indexOf("-ss") + 1]).toBe("1") // 30 frames / 30fps fallback = 1s
  })

  it("computes the end cut from the VIDEO STREAM duration, not the container (audio-overhang regression)", async () => {
    // Real-world numbers from the reporting user's clip: 121 frames @ 24fps
    // → video stream 5.041667s, but the container reports 5.088s because the
    // audio track runs ~46ms longer. Cutting 2 frames from the CONTAINER
    // duration (5.088 - 2/24 = 5.0047) lands past the last video frame
    // (pts 5.000) and removes NOTHING. The stream duration must be used:
    // 5.041667 - 2/24 = 4.958334 → exactly 2 frames dropped.
    execFileOnce("24/1\n") // fps probe
    execFileOnce("5.041667\n") // VIDEO STREAM duration probe
    execFileOnce("") // ffmpeg trim

    await trimEdgeFrames("/tmp/in.mp4", "/tmp/out.mp4", 0, 2)

    // The duration probe must target the video stream, not the format.
    const probeArgs = execArgs(1)
    expect(probeArgs).toContain("-select_streams")
    expect(probeArgs[probeArgs.indexOf("-select_streams") + 1]).toBe("v:0")
    expect(probeArgs[probeArgs.indexOf("-show_entries") + 1]).toBe("stream=duration")

    const args = execArgs(2)
    expect(args[args.indexOf("-to") + 1]).toMatch(/^4\.9583/)
  })

  it("preserveAudioTail + end trim: VIDEO-ONLY trim via filter graph, audio kept to the clip's original end", async () => {
    // Fix 2a (field report 2026-07-25 "voice was cut"): at a matched smart
    // boundary the trimmed tail VIDEO is duplicated content but its AUDIO is
    // unique speech — the caller's L-cut graph lingers the real tail, so the
    // trim must not delete it. 3/24 and 6/24 chosen binary-exact.
    execFileOnce("24/1\n") // fps probe
    execFileOnce("10\n") // video stream duration probe
    execFileOnce("") // ffmpeg trim

    const result = await trimEdgeFrames("/tmp/in.mp4", "/tmp/out.mp4", 3, 6, { preserveAudioTail: true })

    const args = execArgs(2)
    expect(args).not.toContain("-ss")
    expect(args).not.toContain("-to")
    const fc = args[args.indexOf("-filter_complex") + 1]
    expect(fc).toContain("[0:v]trim=start=0.125:end=9.75,setpts=PTS-STARTPTS[v]")
    expect(fc).toContain("[0:a]atrim=start=0.125,asetpts=PTS-STARTPTS[a]")
    expect(args[args.indexOf("-map") + 1]).toBe("[v]")
    expect(args).toContain("libx264")
    expect(args[args.indexOf("-preset") + 1]).toBe("fast")
    expect(args[args.indexOf("-crf") + 1]).toBe("18") // delivery CRF, same as the -ss/-to path
    expect(args[args.indexOf("-c:a") + 1]).toBe("aac")
    expect(result).toBe("/tmp/out.mp4")
  })

  it("preserveAudioTail with NO end trim: the classic -ss path (tail preservation is an end-trim concern)", async () => {
    execFileOnce("30/1\n")
    execFileOnce("10.0\n")
    execFileOnce("")

    await trimEdgeFrames("/tmp/in.mp4", "/tmp/out.mp4", 30, 0, { preserveAudioTail: true })

    const args = execArgs(2)
    expect(args).not.toContain("-filter_complex")
    expect(args[args.indexOf("-ss") + 1]).toBe("1")
  })

  it("preserveAudioTail: the exceeds-duration skip still applies before any encode", async () => {
    execFileOnce("30/1\n")
    execFileOnce("1.000\n")

    const result = await trimEdgeFrames("/tmp/in.mp4", "/tmp/out.mp4", 0, 30, { preserveAudioTail: true })

    expect(result).toBe("/tmp/in.mp4")
    expect(mocks.execFile).toHaveBeenCalledTimes(2)
  })
})

// ===========================================================================
// 10b) getVideoStreamDuration
// ===========================================================================

describe("getVideoStreamDuration", () => {
  it("returns the video stream duration when the stream reports one", async () => {
    execFileOnce("5.041667\n")
    const d = await getVideoStreamDuration("/tmp/in.mp4")
    expect(d).toBeCloseTo(5.041667, 5)
    expect(mocks.execFile).toHaveBeenCalledTimes(1)
  })

  it("falls back to the container/format duration when the stream has none", async () => {
    execFileOnce("N/A\n") // some containers don't carry stream duration
    execFileOnce("7.5\n") // format duration fallback
    const d = await getVideoStreamDuration("/tmp/in.mp4")
    expect(d).toBe(7.5)
    expect(mocks.execFile).toHaveBeenCalledTimes(2)
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
  it("defaults to fps=24 when the caller passes no rate + scale/pad to the target resolution + h264/yuv420p + AAC", async () => {
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

  it("conforms to the frame rate the caller tallied from the sources (combine-videos' pickTargetFps)", async () => {
    // Regression (job 597dcf72, 2026-09-08): two 30 fps clips came back at
    // 24 fps because this filter hardcoded fps=24 — one frame in five gone.
    execFileOnce("")

    await normalizeVideoForCombine("/tmp/in.mp4", "/tmp/out.mp4", 1280, 720, 30)

    const args = execArgs()
    const vfIdx = args.indexOf("-vf")
    expect(args[vfIdx + 1]).toContain("fps=30,")
    expect(args[vfIdx + 1]).not.toContain("fps=24")
  })

  it("encodes at the delivery CRF (18) — this is the encode the user receives on the cut path (job 08f99f85: the old CRF 23 halved the delivered bitrate)", async () => {
    execFileOnce("")

    await normalizeVideoForCombine("/tmp/in.mp4", "/tmp/out.mp4", 1280, 720)

    const args = execArgs()
    expect(args[args.indexOf("-crf") + 1]).toBe("18")
  })

  it("pins audio to 44.1kHz stereo so -c copy concat never splices mismatched rates", async () => {
    // Regression (job 3dca9c76): two clips normalized here kept their source
    // sample rates (32kHz vs 44.1kHz). The cut fast path's concat demuxer
    // stream-copy then spliced both into one AAC track declared at the first
    // clip's rate — the second clip's audio played ~27% slow and pitch-shifted,
    // and the audio track ran 4s past the video. Every clip must leave
    // normalize with identical audio params (mirrors runBlockFit's pin).
    execFileOnce("")

    await normalizeVideoForCombine("/tmp/in.mp4", "/tmp/out.mp4", 1280, 720)

    const args = execArgs()
    expect(args[args.indexOf("-ar") + 1]).toBe("44100")
    expect(args[args.indexOf("-ac") + 1]).toBe("2")
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

// ===========================================================================
// probeMediaStreams — "what streams does this media ACTUALLY carry"
// ===========================================================================
//
// The 2026-08-30 voice-changer-pro incident: an audio-only M4A uploaded as
// `.mp4` (video/mp4) went down the video path and died at `-map 0:v` AFTER the
// paid speech-to-speech pass. The slot/extension/MIME lied; the streams don't.

describe("probeMediaStreams", () => {
  const ffprobeJson = (streams: Array<Record<string, unknown>>) => JSON.stringify({ streams })

  it("reports video + audio for a normal clip", async () => {
    execFileOnce(ffprobeJson([
      { codec_type: "video", codec_name: "h264", disposition: { attached_pic: 0 } },
      { codec_type: "audio", codec_name: "aac", disposition: { attached_pic: 0 } },
    ]))
    await expect(probeMediaStreams("/tmp/v.mp4")).resolves.toEqual({ hasVideo: true, hasAudio: true })
  })

  it("reports an audio-only container (M4A / audio-only .mp4) as hasVideo:false", async () => {
    execFileOnce(ffprobeJson([{ codec_type: "audio", codec_name: "aac", disposition: { attached_pic: 0 } }]))
    await expect(probeMediaStreams("/tmp/consultation.mp4")).resolves.toEqual({ hasVideo: false, hasAudio: true })
  })

  it("does NOT count embedded cover art (disposition.attached_pic) as a video stream", async () => {
    execFileOnce(ffprobeJson([
      { codec_type: "video", codec_name: "mjpeg", disposition: { attached_pic: 1 } },
      { codec_type: "audio", codec_name: "mp3", disposition: { attached_pic: 0 } },
    ]))
    await expect(probeMediaStreams("/tmp/podcast.mp3")).resolves.toEqual({ hasVideo: false, hasAudio: true })
  })

  it("reports a silent video as hasAudio:false", async () => {
    execFileOnce(ffprobeJson([{ codec_type: "video", codec_name: "h264", disposition: {} }]))
    await expect(probeMediaStreams("/tmp/silent.mp4")).resolves.toEqual({ hasVideo: true, hasAudio: false })
  })

  it("asks ffprobe for JSON with the protocol whitelist (blocks protocol pivots)", async () => {
    execFileOnce(ffprobeJson([]))
    await probeMediaStreams("/tmp/v.mp4")
    const args = execArgs(0)
    expect(args).toContain("-protocol_whitelist")
    expect(args[args.indexOf("-of") + 1]).toBe("json")
  })

  it("blocks private/reserved remote hosts before ffprobe touches the network (SSRF guard)", async () => {
    mocks.dnsLookup.mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }])
    await expect(probeMediaStreams("http://evil.example/v.mp4")).rejects.toThrow(/resolve|private|reserved/i)
    expect(mocks.execFile).not.toHaveBeenCalled()
  })

  it("throws (never guesses) when ffprobe output is not parseable", async () => {
    execFileOnce("not json")
    await expect(probeMediaStreams("/tmp/v.mp4")).rejects.toThrow(/probeMediaStreams/)
  })
})



// ===========================================================================
// probeStreamEnds — each track's REAL end, on the render's clock
// ===========================================================================
// Per track (never one number for the file), from the track's own packets:
// max(pts + duration), skipping packets the demuxer flags D (frames past a
// tail-trimming edit list — `trim` never reaches them), DTS only for a stream
// with no pts at all (AVI), minus the file's `format.start_time` (the ffmpeg
// CLI shifts every input by it before `trim` / `atrim` see a frame — a `.ts`
// or an offset MKV/MP4 over-reported by exactly that). The stream picked is
// the one the render binds: the first REAL video stream (`[i:V]`, never cover
// art) and the first audio stream.
describe("parseStreamListing", () => {
  const listing = (streams: unknown[], format?: unknown) => JSON.stringify({ streams, ...(format ? { format } : {}) })

  it("picks the first REAL video stream and the first audio stream by index, and reads format.start_time", () => {
    expect(parseStreamListing(listing([
      { index: 0, codec_type: "audio", disposition: { attached_pic: 0 } },
      { index: 1, codec_type: "video", disposition: { attached_pic: 0 } },
      { index: 2, codec_type: "audio", disposition: { attached_pic: 0 } },
    ], { start_time: "1.478667", format_name: "mov,mp4,m4a,3gp,3g2,mj2" }))).toEqual({ video: 1, audio: 0, startSec: 1.478667, reAnchors: false })
  })

  it("never picks embedded cover art (attached_pic) as the picture — a podcast mp3 has no video track", () => {
    expect(parseStreamListing(listing([
      { index: 0, codec_type: "audio", disposition: { attached_pic: 0 } },
      { index: 1, codec_type: "video", disposition: { attached_pic: 1 } },
    ]))).toEqual({ audio: 0, startSec: 0, reAnchors: false })
  })

  it("a missing, N/A or negative start_time: 0 for the first two, kept for the last (encoder priming shifts the other way)", () => {
    expect(parseStreamListing(listing([], { start_time: "N/A" })).startSec).toBe(0)
    expect(parseStreamListing(listing([])).startSec).toBe(0)
    expect(parseStreamListing(listing([], { start_time: "-0.021333" })).startSec).toBeCloseTo(-0.021333, 6)
  })

  it("flags MPEG-TS / program-stream containers as re-anchoring (their start_time is not the render's clock), not mp4/mkv/mp3", () => {
    expect(parseStreamListing(listing([], { format_name: "mpegts" })).reAnchors).toBe(true)
    expect(parseStreamListing(listing([], { format_name: "mpeg" })).reAnchors).toBe(true)
    expect(parseStreamListing(listing([], { format_name: "mov,mp4,m4a,3gp,3g2,mj2" })).reAnchors).toBe(false)
    expect(parseStreamListing(listing([], { format_name: "matroska,webm" })).reAnchors).toBe(false)
    expect(parseStreamListing(listing([], { format_name: "mp3" })).reAnchors).toBe(false)
    expect(parseStreamListing(listing([])).reAnchors).toBe(false)
  })

  it("reads the container's declared duration when it reports a positive one (the coarse bound for a re-anchoring container)", () => {
    expect(parseStreamListing(listing([], { format_name: "mpegts", duration: "6.016000" })).declaredSec).toBeCloseTo(6.016, 6)
    expect(parseStreamListing(listing([], { duration: "N/A" })).declaredSec).toBeUndefined()
    expect(parseStreamListing(listing([], { duration: "0" })).declaredSec).toBeUndefined()
    expect(parseStreamListing(listing([])).declaredSec).toBeUndefined()
  })

  it("throws (never guesses) when the listing is not JSON", () => {
    expect(() => parseStreamListing("not json")).toThrow(/probeStreamEnds/)
  })
})

describe("parsePacketLine — ffprobe's fixed field order pts_time,dts_time,duration_time,flags", () => {
  it("reads pts, dts, duration and the discard flag", () => {
    expect(parsePacketLine("5.933333,5.900000,0.033333,_D_")).toEqual({ pts: 5.933333, dts: 5.9, dur: 0.033333, discard: true })
    expect(parsePacketLine("1.500000,1.433333,0.033333,K__")).toEqual({ pts: 1.5, dts: 1.433333, dur: 0.033333, discard: false })
  })
  it("keeps a packet with no pts (AVI) for the DTS fallback, and treats a missing duration as 0", () => {
    expect(parsePacketLine("N/A,12.000000,N/A,K__")).toEqual({ dts: 12, dur: 0, discard: false })
  })
  it("ignores a blank line", () => {
    expect(parsePacketLine("")).toBeUndefined()
    expect(parsePacketLine("   ")).toBeUndefined()
  })
})

describe("probeStreamEnds", () => {
  const listingOf = (start: string | undefined, streams: unknown[]) =>
    JSON.stringify({ streams, ...(start !== undefined ? { format: { start_time: start } } : {}) })
  const V0 = { index: 0, codec_type: "video", disposition: { attached_pic: 0 } }
  const A1 = { index: 1, codec_type: "audio", disposition: { attached_pic: 0 } }

  it("lists streams + start_time once, streams each chosen track's packets, keeps max(pts + dur) minus start_time", async () => {
    execFileOnce(listingOf("1.500000", [V0, A1]))
    // Video packets in DTS order with B-frame reordering: the LAST line is not the max.
    mocks.spawnScripts.push({ stdout: "1.5,1.4,0.5,K__\n3.5,1.9,0.5,___\n2.5,2.4,0.5,___\n9.5,2.9,1,___\n8.5,3.9,1,___\n" })
    mocks.spawnScripts.push({ stdout: "1.500000,1.500000,0.021333,K__\n4.486667,4.486667,0.021333,K__\n" })

    const ends = await probeStreamEnds("/tmp/off15.mp4")
    expect(ends.video).toEqual({ state: "measured", endSec: 9 }) // 10.5 − 1.5
    expect(ends.audio).toMatchObject({ state: "measured" })
    expect((ends.audio as { endSec: number }).endSec).toBeCloseTo(3.008, 3)

    expect(execCmd(0)).toBe("ffprobe")
    expect(execArgs(0)).toEqual(expect.arrayContaining(["-show_entries", "format=start_time,duration,format_name:stream=index,codec_type:stream_disposition=attached_pic", "-of", "json"]))
    expect(mocks.spawn).toHaveBeenCalledTimes(2)
    const [, vArgs] = mocks.spawn.mock.calls[0]!
    expect(vArgs).toEqual(expect.arrayContaining(["-select_streams", "0", "-show_entries", "packet=pts_time,dts_time,duration_time,flags", "-of", "csv=p=0", "/tmp/off15.mp4"]))
    const [, aArgs] = mocks.spawn.mock.calls[1]!
    expect(aArgs).toEqual(expect.arrayContaining(["-select_streams", "1"]))
  })

  it("an MPEG-TS/PS container is not measured against its start_time — both present tracks come back unmeasured, no packet scan", async () => {
    execFileOnce(JSON.stringify({ streams: [V0, A1], format: { start_time: "3600.0", format_name: "mpegts" } }))
    const ends = await probeStreamEnds("/tmp/cam.ts")
    expect(ends.video).toMatchObject({ state: "unmeasured" })
    expect(ends.audio).toMatchObject({ state: "unmeasured" })
    expect((ends.video as { reason: string }).reason).toMatch(/MPEG-TS\/PS/)
    expect(mocks.spawn).not.toHaveBeenCalled() // no per-track packet scan
  })

  // A TS/PS file's declared duration is a coarse UPPER bound only while its
  // timestamps run forward. Joined recordings / a reconnected stream jump BACK,
  // and ffprobe's duration (last minus first timestamp) then UNDER-states what
  // the render plays through — a bound there would refuse correct paid edits.
  describe("the declared bound of a TS/PS container is gated on DTS continuity", () => {
    const tsListing = (streams: unknown[]) =>
      JSON.stringify({ streams, format: { start_time: "1.400000", duration: "6.016000", format_name: "mpegts" } })

    it("attaches the declared duration when every mapped track's DTS only runs forward (one scan per track)", async () => {
      execFileOnce(tsListing([V0, A1]))
      mocks.spawnScripts.push({ stdout: "1.5,1.4,0.04,K__\n1.6,1.44,0.04,___\n1.54,1.48,0.04,___\n" }) // B-frames: pts reorders, dts does not
      mocks.spawnScripts.push({ stdout: "1.4,1.4,0.02,K__\n1.42,1.42,0.02,K__\n" })
      const ends = await probeStreamEnds("/tmp/cam.ts")
      expect(ends.video).toMatchObject({ state: "unmeasured", declaredEndSec: 6.016 })
      expect(ends.audio).toMatchObject({ state: "unmeasured", declaredEndSec: 6.016 })
      expect((ends.video as { reason: string }).reason).not.toMatch(/no bound/)
      expect(mocks.spawn).toHaveBeenCalledTimes(2)
      expect(mocks.spawn.mock.calls[0]![1]).toEqual(expect.arrayContaining(["-select_streams", "0", "/tmp/cam.ts"]))
      expect(mocks.spawn.mock.calls[1]![1]).toEqual(expect.arrayContaining(["-select_streams", "1"]))
    })

    it("attaches NO bound when a track's DTS steps back (joined / reconnected recording) — and says why", async () => {
      execFileOnce(tsListing([V0, A1]))
      mocks.spawnScripts.push({ stdout: "7.3,7.36,0.04,___\n1.4,1.4,0.04,K__\n" })
      const ends = await probeStreamEnds("/tmp/joined.ts")
      expect(ends.video).toEqual({ state: "unmeasured", reason: expect.stringMatching(/stream 0's timestamps jump.*no bound/) })
      expect(ends.audio).not.toHaveProperty("declaredEndSec")
      expect(mocks.spawn).toHaveBeenCalledTimes(1) // the first discontinuous track settles it
    })

    // A recording that restarted its clock more than 60 s below its first
    // timestamp is "unwrapped" by libavformat (+2^33 ticks): the join reads as
    // one ~26.5 h FORWARD step and format.duration declares ~91,853 s for 16 s
    // of content. Any forward step past the CLI's fold threshold is a jump too.
    it("attaches NO bound when a track's DTS jumps FORWARD past the fold threshold (an unwrapped restart)", async () => {
      execFileOnce(tsListing([V0]))
      mocks.spawnScripts.push({ stdout: "3600.0,3600.0,0.04,K__\n3607.96,3607.96,0.04,___\n95445.0,95445.0,0.04,K__\n" })
      const ends = await probeStreamEnds("/tmp/restart.ts")
      expect(ends.video).not.toHaveProperty("declaredEndSec")
      expect((ends.video as { reason: string }).reason).toMatch(/forward by more than 10 s/)
      expect(mocks.spawn).toHaveBeenCalledTimes(1)
    })

    // The CLI measures a forward step from where the previous packet ENDS
    // (dts + duration), so a still-image stream whose frames each last 12 s is
    // continuous and its declared length is a valid bound.
    it("a still-image stream (12 s frames, 12 s steps) is continuous — keeps the bound", async () => {
      execFileOnce(tsListing([V0]))
      mocks.spawnScripts.push({ stdout: "1.4,1.4,12,K__\n13.4,13.4,12,K__\n25.4,25.4,12,K__\n" })
      expect((await probeStreamEnds("/tmp/stills.ts")).video).toMatchObject({ declaredEndSec: 6.016 })
    })

    it("a forward step inside the threshold (a short gap) keeps the bound", async () => {
      execFileOnce(tsListing([V0]))
      mocks.spawnScripts.push({ stdout: "1.4,1.4,0.04,K__\n9.4,9.4,0.04,___\n" })
      expect((await probeStreamEnds("/tmp/gap.ts")).video).toMatchObject({ declaredEndSec: 6.016 })
    })

    it("attaches NO bound when a scan fails or a track carries no DTS — never treated as continuous", async () => {
      execFileOnce(tsListing([V0]))
      mocks.spawnScripts.push({ stdout: "", code: 1, stderr: "boom" })
      const failed = await probeStreamEnds("/tmp/bad.ts")
      expect(failed.video).not.toHaveProperty("declaredEndSec")
      expect((failed.video as { reason: string }).reason).toMatch(/could not be scanned/)

      execFileOnce(tsListing([V0]))
      mocks.spawnScripts.push({ stdout: "N/A,N/A,0.04,K__\n" })
      const noDts = await probeStreamEnds("/tmp/nodts.ts")
      expect(noDts.video).not.toHaveProperty("declaredEndSec")
      expect((noDts.video as { reason: string }).reason).toMatch(/carries no DTS/)
    })
  })

  it("a TS container missing one track: the absent track stays `absent`, the present one is unmeasured", async () => {
    execFileOnce(JSON.stringify({ streams: [V0], format: { format_name: "mpegts" } }))
    const ends = await probeStreamEnds("/tmp/vonly.ts")
    expect(ends.video).toMatchObject({ state: "unmeasured" })
    expect(ends.audio).toEqual({ state: "absent" })
  })

  it("skips packets flagged D (past a tail-trimming edit list — the decoder drops them, `trim` never reaches them)", async () => {
    execFileOnce(listingOf("0.000000", [V0]))
    mocks.spawnScripts.push({ stdout: "0,0,1,K__\n1,1,1,___\n2,2,1,___\n3,3,1,_D_\n4,4,1,_D_\n5,5,1,_D_\n" })
    expect((await probeStreamEnds("/tmp/elst.mp4")).video).toEqual({ state: "measured", endSec: 3 })
  })

  it("falls back to DTS only for a stream with no pts on ANY packet (AVI)", async () => {
    execFileOnce(listingOf(undefined, [V0]))
    mocks.spawnScripts.push({ stdout: "N/A,0,0.04,K__\nN/A,5.96,0.04,___\n" })
    expect((await probeStreamEnds("/tmp/clip.avi")).video).toEqual({ state: "measured", endSec: 6 })
  })

  it("an absent track is `absent` (no scan); a track with no timestamps at all is `unmeasured`", async () => {
    execFileOnce(listingOf(undefined, [A1]))
    mocks.spawnScripts.push({ stdout: "N/A,N/A,N/A,___\n" })
    const ends = await probeStreamEnds("/tmp/odd.mp3")
    expect(ends.video).toEqual({ state: "absent" })
    expect(ends.audio).toEqual({ state: "unmeasured", reason: "stream 1 carries no packet timestamps" })
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
  })

  it("a failed scan leaves THAT track unmeasured with the reason — the other track is still measured", async () => {
    execFileOnce(listingOf("0", [V0, A1]))
    mocks.spawnScripts.push({ stdout: "", code: 1, stderr: "Invalid data found when processing input" })
    mocks.spawnScripts.push({ stdout: "0,0,1,K__\n5,5,1,K__\n" })
    const ends = await probeStreamEnds("/tmp/half-broken.mp4")
    expect(ends.video).toMatchObject({ state: "unmeasured", reason: expect.stringMatching(/probeStreamEnds: ffprobe exit 1 on stream 0: Invalid data/) })
    expect(ends.audio).toEqual({ state: "measured", endSec: 6 })
  })

  it("throws only when the stream listing itself cannot be read", async () => {
    execFileOnce("", new Error("ffprobe exited 1") as NodeJS.ErrnoException, "moov atom not found")
    await expect(probeStreamEnds("/tmp/garbage.mp4")).rejects.toThrow()
  })
})

// Video Overlay classifies a render failure on these flags (spec §4.2 step 9):
// the Node watchdog kill is a timeout; a maxBuffer overflow is a kill but not one.
describe("runFfmpeg / runFfprobe — the watchdog flags", () => {
  it("a watchdog kill carries killed + timedOut", async () => {
    execFileOnce("", Object.assign(new Error("Command failed"), { killed: true }) as NodeJS.ErrnoException, "frame= 9000")
    await expect(runFfmpeg(["-i", "x"])).rejects.toMatchObject({ killed: true, timedOut: true })
  })

  it("a maxBuffer overflow is a kill but NOT a timeout", async () => {
    execFileOnce("", Object.assign(new Error("stdout maxBuffer length exceeded"), { killed: true, code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }) as NodeJS.ErrnoException, "")
    await expect(runFfmpeg(["-i", "x"])).rejects.toMatchObject({ killed: true, timedOut: false })
  })

  it("an ordinary non-zero exit is neither, and keeps its message", async () => {
    execFileOnce("", new Error("exit 1") as NodeJS.ErrnoException, "Conversion failed")
    await expect(runFfmpeg(["bad"])).rejects.toMatchObject({ killed: false, timedOut: false, message: expect.stringMatching(/ffmpeg failed: Conversion failed/) })
  })

  it("runFfprobe carries the same flags", async () => {
    execFileOnce("", Object.assign(new Error("Command failed"), { killed: true }) as NodeJS.ErrnoException, "")
    await expect(runFfprobe(["x"])).rejects.toMatchObject({ killed: true, timedOut: true })
  })
})
