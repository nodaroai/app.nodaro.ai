/**
 * Split into Chunks' shots mode — the ffmpeg launches `splitMedia` makes with
 * `mode: "shots"`, ffmpeg and ffprobe replaced by fakes (the real output is
 * proven by `split-media-shots.e2e.test.ts`) and the measured cuts by a stand-in
 * scan. Pins: the scan reads the probed picture stream, the one encode keys
 * exactly the cuts on the constant-rate grid, the copy cuts there; refusals
 * (too long, too many shots) before any encode.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const scan = vi.hoisted(() => ({
  calls: [] as Array<{ path: string; opts: Record<string, unknown> }>,
  result: { cuts: [] as Array<{ sec: number; frame: number }>, frameCount: 0, firstFrameTimeS: 0 as number | null, lastFrameSec: 0 },
}))
vi.mock("../../../services/scene-cut-frames.js", () => ({
  detectShotCuts: async (path: string, opts: Record<string, unknown>) => {
    scan.calls.push({ path, opts })
    return scan.result
  },
}))

const fake = vi.hoisted(() => ({
  calls: [] as { args: string[]; timeoutMs?: number; peakMemoryMiB?: number }[],
  downloads: [] as { url: string; opts: unknown }[],
  probe: {} as unknown,
  /** Frame counts the "encode" produces, one per encode in order. */
  frames: [] as number[],
  /** Samples the PCM output holds. */
  pcmSamples: 0,
  channels: 2,
  workDirs: [] as string[],
}))

vi.mock("../ffmpeg-utils.js", () => ({
  BIG_MEDIA_DOWNLOAD_LIMITS: { tag: "big-media" },
  createWorkDir: async (prefix: string) => {
    const d = await (await import("node:fs")).promises.mkdtemp(join(tmpdir(), `${prefix}-`))
    fake.workDirs.push(d)
    return d
  },
  cleanupWorkDir: async (d: string) => {
    await (await import("node:fs")).promises.rm(d, { recursive: true, force: true })
  },
  downloadFile: async (url: string, dest: string, opts: unknown) => {
    fake.downloads.push({ url, opts })
    await (await import("node:fs")).promises.writeFile(dest, "src")
  },
  runFfprobe: async (args: string[]) => {
    if (args.includes("-count_packets")) {
      const n = fake.frames[Math.min(fake.frames.length - 1, fake.calls.filter((c) => c.args.includes("libx264")).length - 1)]
      return JSON.stringify({ streams: [{ nb_read_packets: String(n) }] })
    }
    return JSON.stringify(fake.probe)
  },
  runFfmpeg: async (args: string[], timeoutMs?: number, launch?: { peakMemoryMiB?: number }) => {
    fake.calls.push({ args: [...args], timeoutMs, peakMemoryMiB: launch?.peakMemoryMiB })
    const { promises: f } = await import("node:fs")
    const outs = args.filter((a, i) => /\.(mp4|pcm|mp3|wav|aac)$/.test(a) && args[i - 1] !== "-i")
    for (const out of outs) {
      if (out.endsWith(".pcm")) {
        await f.writeFile(out, Buffer.alloc(fake.pcmSamples * fake.channels * 4))
      } else if (out.includes("%05d")) {
        const n = args[args.indexOf("-segment_frames") + 1]!.split(",").length + 1
        for (let i = 0; i < n; i++) await f.writeFile(out.replace("%05d", String(i).padStart(5, "0")), "seg")
      } else {
        await f.writeFile(out, "out")
      }
    }
    return ""
  },
}))

import { splitMedia } from "../split-media.js"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"

const probeOf = (over: Record<string, unknown> = {}) => ({
  format: { start_time: "0.000000", duration: "65.000000" },
  streams: [
    { index: 0, codec_type: "video", disposition: { attached_pic: 1 }, r_frame_rate: "90000/1" },
    { index: 1, codec_type: "video", r_frame_rate: "30000/1001", avg_frame_rate: "30000/1001", start_time: "0.000000", duration: "64.998267", width: 1920, height: 1080, ...over },
    { index: 2, codec_type: "audio", sample_rate: "48000", channels: 2, channel_layout: "stereo", start_time: "0.000000", duration: "65.000000" },
  ],
})
const argOf = (args: string[], flag: string) => args[args.indexOf(flag) + 1]

beforeEach(() => {
  fake.calls.length = 0
  fake.downloads.length = 0
  fake.frames = [1948]
  fake.pcmSamples = 65 * 48000
  fake.channels = 2
  fake.probe = probeOf()
  scan.calls.length = 0
  // cuts at 10.01 s (frame 300 at 29.97) and 40.007 s (frame 1199)
  scan.result = { cuts: [{ sec: 10.01, frame: 300 }, { sec: 40.007, frame: 1199 }], frameCount: 1948, firstFrameTimeS: 0, lastFrameSec: 64.965 }
})
afterEach(async () => {
  for (const d of fake.workDirs.splice(0)) await fs.rm(d, { recursive: true, force: true })
})

describe("splitMedia — at the shots", () => {
  it("scans the probed picture stream (not cover art), keys exactly the cuts in one encode, and cuts there by copy", async () => {
    const r = await splitMedia({ videoUrl: "https://v", mode: "shots" })
    expect(fake.downloads).toEqual([{ url: "https://v", opts: { limits: { tag: "big-media" } } }])
    expect(scan.calls).toHaveLength(1)
    expect(scan.calls[0]!.opts.map).toBe("0:1")
    expect(scan.calls[0]!.opts.timeoutMs).toBe(10 * 60_000 + 65 * 4_000)
    const encodes = fake.calls.filter((c) => c.args.includes("libx264"))
    expect(encodes).toHaveLength(1)
    const enc = encodes[0]!.args
    expect(argOf(enc, "-vf")).toBe("fps=fps=30000/1001")
    expect(argOf(enc, "-force_key_frames")).toBe("0.000000,10.010000,40.006633")
    expect(enc).not.toContain("-frames:v")
    expect(argOf(fake.calls.find((c) => c.args.includes("segment"))!.args, "-segment_frames")).toBe("300,1199")
    expect(r.videoPartDurationsSec).toEqual([300, 899, 749].map((f) => (f * 1001) / 30000))
    expect(r.shots).toEqual([
      { index: 0, startSec: 0, endSec: 10.01, durationSec: 10.01 },
      { index: 1, startSec: 10.01, endSec: 40.007, durationSec: 29.997 },
      { index: 2, startSec: 40.007, endSec: 64.998, durationSec: 24.991 },
    ])
    // every part gets its own sound, as in the part-length split
    expect(fake.calls.filter((c) => c.args.includes("-skip_initial_bytes"))).toHaveLength(3)
  })

  it("a cut the encode's frames do not reach starts no part", async () => {
    fake.frames = [1100]
    const r = await splitMedia({ videoUrl: "https://v", mode: "shots" })
    expect(argOf(fake.calls.find((c) => c.args.includes("segment"))!.args, "-segment_frames")).toBe("300")
    expect(r.videoPaths).toHaveLength(2)
  })

  it("no cut: one part, renamed, no copy cut", async () => {
    scan.result = { cuts: [], frameCount: 1948, firstFrameTimeS: 0, lastFrameSec: 64.965 }
    const r = await splitMedia({ videoUrl: "https://v", mode: "shots" })
    expect(fake.calls.find((c) => c.args.includes("segment"))).toBeUndefined()
    expect(r.videoPaths).toHaveLength(1)
    expect(r.shots).toHaveLength(1)
  })

  it("refuses a video past 30 minutes before the scan, and one with more than 200 shots before the encode", async () => {
    fake.probe = probeOf({ duration: "1900" })
    const long = await splitMedia({ videoUrl: "https://v", mode: "shots" }).catch((e: unknown) => e)
    expect(isDeterministicJobError(long)).toBe(true)
    expect(scan.calls).toHaveLength(0)

    fake.probe = probeOf()
    scan.result = { cuts: Array.from({ length: 200 }, (_, i) => ({ sec: (i + 1) * 0.3, frame: (i + 1) * 9 })), frameCount: 1948, firstFrameTimeS: 0, lastFrameSec: 64.965 }
    const many = await splitMedia({ videoUrl: "https://v", mode: "shots" }).catch((e: unknown) => e)
    expect(isDeterministicJobError(many)).toBe(true)
    expect((many as Error).message).toMatch(/201 shots; the limit is 200 parts/)
    expect(fake.calls.filter((c) => c.args.includes("libx264"))).toHaveLength(0)
  })

  it("a file that states no length: the scan's last frame decides, and the encode stops one frame past the cap", async () => {
    fake.probe = { format: {}, streams: [probeOf({ duration: undefined }).streams[1], probeOf().streams[2]] }
    await splitMedia({ videoUrl: "https://v", mode: "shots" })
    expect(argOf(fake.calls.find((c) => c.args.includes("libx264"))!.args, "-frames:v")).toBe(String(Math.floor(1800 * 30000 / 1001) + 1))
    scan.result = { ...scan.result, lastFrameSec: 1800.5 }
    const err = await splitMedia({ videoUrl: "https://v", mode: "shots" }).catch((e: unknown) => e)
    expect((err as Error).message).toMatch(/longer than 30 minutes/)
  })
})
