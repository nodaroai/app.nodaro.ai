/**
 * Faststart on real ffmpeg/ffprobe, over fixtures generated at run time with
 * lavfi. Only the launcher is wrapped (so a test can make it fail, hang, or
 * return a damaged output); everything else — the box walk, the stream copy,
 * the verification probes — is real.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const launcher = vi.hoisted(() => ({ override: undefined as undefined | ((args: readonly string[], signal: AbortSignal, ...rest: unknown[]) => Promise<void>) }))
vi.mock("../../providers/video/ffmpeg-cancellable.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../providers/video/ffmpeg-cancellable.js")>()
  return {
    ...actual,
    runFfmpegCancellable: vi.fn((args: readonly string[], signal: AbortSignal, ...rest: unknown[]) =>
      launcher.override
        ? launcher.override(args, signal, ...rest)
        : (actual.runFfmpegCancellable as (...a: unknown[]) => Promise<void>)(args, signal, ...rest)),
  }
})

import { runFfmpegCancellable } from "../../providers/video/ffmpeg-cancellable.js"
import { runFfmpeg, runFfprobe } from "../../providers/video/ffmpeg-utils.js"
import { ffmpegAvailable } from "../../providers/video/__tests__/video-overlay-e2e-fixtures.js"
import { probeMp4LayoutInBuffer } from "../mp4-boxes.js"
import {
  faststartBuffersInFlight,
  faststartReservedDiskBytes,
  faststartBudgetMs,
  faststartVideoBuffer,
  faststartVideoFile,
} from "../faststart.js"

// In CI this file must never skip green: a runner without ffmpeg FAILS here.
it.runIf(!!process.env.CI)("CI has ffmpeg — this file never skips there", () => {
  expect(ffmpegAvailable).toBe(true)
})

describe.skipIf(!ffmpegAvailable)("faststart (real ffmpeg)", () => {
  let dir: string
  let moovLastMp4: Buffer
  let faststartMp4: Buffer
  let moovLastMov: Buffer
  let fragmentedMp4: Buffer
  let silentMoovLast: Buffer

  /** What the real launcher does with a signal: reject now if it is already aborted, else when it aborts. */
  const hangUntilAborted = (_args: readonly string[], signal: AbortSignal): Promise<void> =>
    new Promise<void>((_resolve, reject) => {
      if (signal.aborted) return reject(signal.reason)
      signal.addEventListener("abort", () => reject(signal.reason), { once: true })
    })

  const make = async (name: string, extra: string[], format: "mp4" | "mov" = "mp4", audio = true): Promise<Buffer> => {
    const path = join(dir, name)
    await runFfmpeg([
      "-y", "-v", "error",
      "-f", "lavfi", "-i", "testsrc=d=3:s=320x240:r=25",
      ...(audio ? ["-f", "lavfi", "-i", "sine=d=3"] : []),
      "-c:v", "libx264", ...(audio ? ["-c:a", "aac"] : []),
      "-pix_fmt", "yuv420p", ...extra, "-f", format, path,
    ], 60_000)
    return fs.readFile(path)
  }

  /** Per-stream md5 of the stream-copied packets: equal = no re-encode, byte-identical media. */
  const packetMd5 = async (buf: Buffer, map: string): Promise<string> => {
    const path = join(dir, `md5-${Math.random().toString(36).slice(2)}.mp4`)
    await fs.writeFile(path, buf)
    return (await runFfmpeg(["-v", "error", "-i", path, "-map", map, "-c", "copy", "-f", "md5", "-"], 60_000)).trim()
  }

  const facts = async (buf: Buffer) => {
    const path = join(dir, `facts-${Math.random().toString(36).slice(2)}.bin`)
    await fs.writeFile(path, buf)
    const out = JSON.parse(await runFfprobe(["-v", "error", "-show_entries", "format=duration,nb_streams:stream=codec_type", "-of", "json", path]))
    return { streams: Number(out.format.nb_streams), duration: Number(out.format.duration), types: (out.streams as Array<{ codec_type: string }>).map((s) => s.codec_type) }
  }

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "faststart-test-"))
    // ffmpeg's mp4 muxer writes moov LAST unless asked otherwise.
    moovLastMp4 = await make("last.mp4", [])
    faststartMp4 = await make("fast.mp4", ["-movflags", "+faststart"])
    moovLastMov = await make("last.mov", [], "mov")
    fragmentedMp4 = await make("frag.mp4", ["-movflags", "frag_keyframe+empty_moov+default_base_moof"])
    silentMoovLast = await make("silent.mp4", [], "mp4", false)
  }, 120_000)

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  afterEach(() => {
    launcher.override = undefined
    vi.mocked(runFfmpegCancellable).mockClear()
  })

  it("the fixtures have the layouts the tests rely on", async () => {
    expect((await probeMp4LayoutInBuffer(moovLastMp4)).layout).toBe("moov-last")
    expect((await probeMp4LayoutInBuffer(faststartMp4)).layout).toBe("faststart")
    expect((await probeMp4LayoutInBuffer(moovLastMov)).layout).toBe("moov-last")
    expect((await probeMp4LayoutInBuffer(moovLastMov)).majorBrand).toBe("qt  ")
    expect((await probeMp4LayoutInBuffer(fragmentedMp4)).layout).not.toBe("moov-last")
  })

  it("moves moov to the front without touching the media: same streams, same duration, same packets", async () => {
    const result = await faststartVideoBuffer(moovLastMp4, "video/mp4")
    expect(result.outcome).toBe("remuxed")
    expect(result.buffer).not.toBe(moovLastMp4)
    expect((await probeMp4LayoutInBuffer(result.buffer)).layout).toBe("faststart")

    const before = await facts(moovLastMp4)
    const after = await facts(result.buffer)
    expect(after.streams).toBe(before.streams)
    expect(after.types).toEqual(before.types)
    expect(Math.abs(after.duration - before.duration)).toBeLessThan(0.1)
    // a stream copy: the encoded packets are byte-identical, per stream
    expect(await packetMd5(result.buffer, "0:v:0")).toBe(await packetMd5(moovLastMp4, "0:v:0"))
    expect(await packetMd5(result.buffer, "0:a:0")).toBe(await packetMd5(moovLastMp4, "0:a:0"))
    // and the launcher was told to copy, not encode, and to hold the memory a copy needs
    const call = vi.mocked(runFfmpegCancellable).mock.calls[0]!
    const args = call[0] as string[]
    expect(args).toEqual(expect.arrayContaining(["-c", "copy", "-movflags", "+faststart", "-map", "0"]))
    expect(args).not.toContain("libx264")
    expect((call[3] as { peakMemoryMiB: number }).peakMemoryMiB).toBeGreaterThan(0)
  })

  it("a file with no audio stream keeps its single stream", async () => {
    const result = await faststartVideoBuffer(silentMoovLast, "video/mp4")
    expect(result.outcome).toBe("remuxed")
    expect((await facts(result.buffer)).types).toEqual(["video"])
  })

  it("a QuickTime MOV stays a MOV", async () => {
    const result = await faststartVideoBuffer(moovLastMov, "video/quicktime")
    expect(result.outcome).toBe("remuxed")
    const probe = await probeMp4LayoutInBuffer(result.buffer)
    expect(probe.layout).toBe("faststart")
    expect(probe.majorBrand).toBe("qt  ")
    expect(vi.mocked(runFfmpegCancellable).mock.calls[0]![0]).toEqual(expect.arrayContaining(["-f", "mov"]))
  })

  it("never remuxes a file that is already faststart: same buffer, ffmpeg never launched", async () => {
    const result = await faststartVideoBuffer(faststartMp4, "video/mp4")
    expect(result.outcome).toBe("already-faststart")
    expect(result.buffer).toBe(faststartMp4)
    expect(runFfmpegCancellable).not.toHaveBeenCalled()
  })

  it("leaves a fragmented MP4, a non-video type and a non-ISO-BMFF file alone", async () => {
    const frag = await faststartVideoBuffer(fragmentedMp4, "video/mp4")
    expect(frag.buffer).toBe(fragmentedMp4)
    expect(frag.outcome).not.toBe("remuxed")
    const audio = await faststartVideoBuffer(moovLastMp4, "audio/mp4")
    expect(audio).toMatchObject({ outcome: "not-applicable" })
    expect(audio.buffer).toBe(moovLastMp4)
    // EBML header: WebM / Matroska — a video type, but the bytes say it is not an MP4
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]), Buffer.alloc(256)])
    expect(await faststartVideoBuffer(webm, "video/webm")).toMatchObject({ outcome: "not-applicable", buffer: webm })
    expect(runFfmpegCancellable).not.toHaveBeenCalled()
  })

  it("a vendor alias of a video type still reaches the box walk (the handoff lane never resolves it)", async () => {
    const result = await faststartVideoBuffer(moovLastMov, "video/mov")
    expect(result.outcome).toBe("remuxed")
    expect((await probeMp4LayoutInBuffer(result.buffer)).layout).toBe("faststart")
  })

  it("keeps the original when ffmpeg fails", async () => {
    launcher.override = async () => { throw new Error("ffmpeg exploded") }
    const result = await faststartVideoBuffer(moovLastMp4, "video/mp4")
    expect(result).toMatchObject({ outcome: "failed", reason: "ffmpeg exploded" })
    expect(result.buffer).toBe(moovLastMp4)
  })

  it("keeps the original when the input is damaged enough that ffmpeg cannot read it", async () => {
    const box = (type: string, n: number) => { const b = Buffer.alloc(8 + n); b.writeUInt32BE(8 + n, 0); b.write(type, 4, "latin1"); return b }
    const ftyp = box("ftyp", 12); ftyp.write("isom", 8, "latin1")
    const junk = Buffer.concat([ftyp, box("mdat", 200), box("moov", 40)])
    expect((await probeMp4LayoutInBuffer(junk)).layout).toBe("moov-last")
    const result = await faststartVideoBuffer(junk, "video/mp4")
    expect(result.outcome).toBe("failed")
    expect(result.buffer).toBe(junk)
  })

  it("keeps the original when the output lost a stream", async () => {
    // Video only: the same remux, but the audio stream is dropped.
    launcher.override = async (args, signal, ...rest) => {
      const patched = [...args]
      patched.splice(patched.indexOf("-map") + 1, 1, "0:v")
      const actual = await vi.importActual<typeof import("../../providers/video/ffmpeg-cancellable.js")>("../../providers/video/ffmpeg-cancellable.js")
      return (actual.runFfmpegCancellable as (...a: unknown[]) => Promise<void>)(patched, signal, ...rest)
    }
    const result = await faststartVideoBuffer(moovLastMp4, "video/mp4")
    expect(result.outcome).toBe("failed")
    expect(result.reason).toMatch(/stream count/)
    expect(result.buffer).toBe(moovLastMp4)
  })

  it("keeps the original when the output lost duration", async () => {
    launcher.override = async (args, signal, ...rest) => {
      const patched = [...args]
      patched.splice(patched.length - 1, 0, "-t", "1.5")
      const actual = await vi.importActual<typeof import("../../providers/video/ffmpeg-cancellable.js")>("../../providers/video/ffmpeg-cancellable.js")
      return (actual.runFfmpegCancellable as (...a: unknown[]) => Promise<void>)(patched, signal, ...rest)
    }
    const result = await faststartVideoBuffer(moovLastMp4, "video/mp4")
    expect(result.outcome).toBe("failed")
    expect(result.buffer).toBe(moovLastMp4)
  })

  it("keeps the original when the output is not actually faststart", async () => {
    launcher.override = async (args, signal, ...rest) => {
      const patched = [...args]
      patched.splice(patched.indexOf("-movflags"), 2) // no +faststart: moov stays last
      const actual = await vi.importActual<typeof import("../../providers/video/ffmpeg-cancellable.js")>("../../providers/video/ffmpeg-cancellable.js")
      return (actual.runFfmpegCancellable as (...a: unknown[]) => Promise<void>)(patched, signal, ...rest)
    }
    const result = await faststartVideoBuffer(moovLastMp4, "video/mp4")
    expect(result.outcome).toBe("failed")
    expect(result.reason).toMatch(/layout/)
  })

  it("gives up at its deadline (admission wait included) and keeps the original", async () => {
    launcher.override = hangUntilAborted
    const result = await faststartVideoBuffer(moovLastMp4, "video/mp4", { maxBudgetMs: 1 })
    expect(result.outcome).toBe("failed")
    expect(result.buffer).toBe(moovLastMp4)
  })

  it("a caller's cancel stops the file variant too", async () => {
    launcher.override = hangUntilAborted
    const path = join(dir, "cancel.mp4")
    await fs.writeFile(path, moovLastMp4)
    const leftovers = (await fs.readdir(dir)).filter((n) => n.startsWith("faststart-"))
    const ctl = new AbortController()
    const pending = faststartVideoFile(path, "video/mp4", { signal: ctl.signal })
    setTimeout(() => ctl.abort(new Error("client gone")), 20)
    const result = await pending
    expect(result).toMatchObject({ path, outcome: "failed" })
    expect((await fs.readdir(dir)).filter((n) => n.startsWith("faststart-"))).toEqual(leftovers)
  })

  it("skips when there is not room for the second copy, without launching ffmpeg", async () => {
    const result = await faststartVideoBuffer(moovLastMp4, "video/mp4", { freeBytes: async () => 1024 })
    expect(result.outcome).toBe("no-disk")
    expect(result.buffer).toBe(moovLastMp4)
    expect(runFfmpegCancellable).not.toHaveBeenCalled()
  })

  it("counts the disk an in-flight remux has promised, so a concurrent one cannot spend it twice", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    launcher.override = () => gate.then(() => { throw new Error("released") })
    const a = join(dir, "reserve-a.mp4")
    const b = join(dir, "reserve-b.mp4")
    await fs.writeFile(a, moovLastMp4)
    await fs.writeFile(b, moovLastMp4)
    // Room for exactly one remux: the 256 MB margin plus one output, and no more. The volume's free
    // space never changes in this test (the launcher writes nothing), which is exactly the race:
    // each statfs, taken alone, says yes.
    const free = Math.ceil(moovLastMp4.length * 1.1) + 256 * 1024 * 1024 + 1024
    const freeBytes = async () => free
    const first = faststartVideoFile(a, "video/mp4", { freeBytes })
    await vi.waitFor(() => expect(runFfmpegCancellable).toHaveBeenCalledTimes(1))
    const second = await faststartVideoFile(b, "video/mp4", { freeBytes })
    expect(second).toMatchObject({ path: b, outcome: "no-disk" })
    expect(runFfmpegCancellable).toHaveBeenCalledTimes(1)
    release()
    await first
    // The promise is returned when the remux ends: the next one has room again.
    const third = faststartVideoFile(b, "video/mp4", { freeBytes })
    await vi.waitFor(() => expect(runFfmpegCancellable).toHaveBeenCalledTimes(2))
    release()
    expect((await third).outcome).toBe("failed")
    expect(faststartReservedDiskBytes()).toBe(0) // every promise is given back, success or failure
  })

  it("at most two buffered remuxes at once; the rest store as sent", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    launcher.override = () => gate.then(() => { throw new Error("released") })
    const running = [faststartVideoBuffer(moovLastMp4, "video/mp4"), faststartVideoBuffer(moovLastMp4, "video/mp4")]
    await vi.waitFor(() => expect(faststartBuffersInFlight()).toBe(2))
    const third = await faststartVideoBuffer(moovLastMp4, "video/mp4")
    expect(third).toMatchObject({ outcome: "busy" })
    expect(third.buffer).toBe(moovLastMp4)
    release()
    await Promise.all(running)
    expect(faststartBuffersInFlight()).toBe(0)
  })

  it("removes its work dir, success or failure", async () => {
    // Observed through the work dir the launcher is handed: its parent is gone afterwards.
    const dirs: string[] = []
    launcher.override = async (args) => { dirs.push(join(String(args[args.indexOf("-i") + 1]), "..")); throw new Error("nope") }
    await faststartVideoBuffer(moovLastMp4, "video/mp4")
    await faststartVideoBuffer(moovLastMp4, "video/mp4")
    // (a success is the same finally block; the failure path is the one that can leak)
    expect(dirs).toHaveLength(2)
    for (const d of dirs) await expect(fs.stat(d)).rejects.toThrow()
  })

  describe("the file variant (the multi-GB import lane)", () => {
    it("returns a NEW file beside the source, with the source untouched", async () => {
      const path = join(dir, "import-source.mp4")
      await fs.writeFile(path, moovLastMp4)
      const result = await faststartVideoFile(path, "video/mp4")
      expect(result.outcome).toBe("remuxed")
      expect(result.path).not.toBe(path)
      expect(await fs.readFile(path)).toEqual(moovLastMp4)
      expect((await probeMp4LayoutInBuffer(await fs.readFile(result.path))).layout).toBe("faststart")
    })

    it("an already-faststart file comes back as the same path", async () => {
      const path = join(dir, "import-fast.mp4")
      await fs.writeFile(path, faststartMp4)
      expect(await faststartVideoFile(path, "video/mp4")).toEqual({ path, outcome: "already-faststart" })
    })

    it("a failed remux hands back the source path and removes the partial output", async () => {
      launcher.override = async (args) => {
        await fs.writeFile(args[args.length - 1]!, Buffer.alloc(10))
        throw new Error("died mid-write")
      }
      const path = join(dir, "import-fail.mp4")
      await fs.writeFile(path, moovLastMp4)
      const leftovers = (await fs.readdir(dir)).filter((n) => n.startsWith("faststart-"))
      const result = await faststartVideoFile(path, "video/mp4")
      expect(result).toMatchObject({ path, outcome: "failed" })
      expect((await fs.readdir(dir)).filter((n) => n.startsWith("faststart-"))).toEqual(leftovers)
    })
  })
})

describe("faststartBudgetMs", () => {
  it("scales with size, has a floor, and respects the caller's ceiling", () => {
    expect(faststartBudgetMs(1024)).toBeGreaterThanOrEqual(30_000)
    expect(faststartBudgetMs(8 * 1024 ** 3)).toBeGreaterThan(faststartBudgetMs(500 * 1024 ** 2))
    expect(faststartBudgetMs(8 * 1024 ** 3, 60_000)).toBe(60_000)
    expect(faststartBudgetMs(1, 1)).toBe(1)
  })
})
