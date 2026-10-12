/**
 * Split into Chunks — the ffmpeg launches `splitMedia` makes, with ffmpeg and
 * ffprobe replaced by fakes that write the files a real run would (the real
 * output is proven by `split-media.e2e.test.ts`). Pins the argv shape: one
 * constant-rate encode with keyframes at every candidate cut and the sound to
 * PCM, a stream-copy cut by frame index, each part's sound read by byte offset
 * and trimmed to its exact sample count; refusals before any encode.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

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

const videoProbe = (over: Record<string, unknown> = {}) => ({
  format: { start_time: "0.000000", duration: "65.000000" },
  streams: [
    { index: 0, codec_type: "video", r_frame_rate: "30000/1001", avg_frame_rate: "30000/1001", start_time: "0.000000", duration: "64.998267", width: 1920, height: 1080, ...over },
    { index: 1, codec_type: "audio", sample_rate: "48000", channels: 2, channel_layout: "stereo", start_time: "0.000000", duration: "65.000000" },
  ],
})
const argOf = (args: string[], flag: string) => args[args.indexOf(flag) + 1]

beforeEach(() => {
  fake.calls.length = 0
  fake.downloads.length = 0
  fake.frames = [1948]
  fake.pcmSamples = 65 * 48000
  fake.channels = 2
  fake.probe = videoProbe()
})
afterEach(async () => {
  for (const d of fake.workDirs.splice(0)) await fs.rm(d, { recursive: true, force: true })
})

describe("splitMedia — video", () => {
  it("downloads under the big-media limits and encodes ONCE: constant rate, keyframes at every candidate cut, sound to PCM", async () => {
    const r = await splitMedia({ videoUrl: "https://v", chunkDuration: 10 })
    expect(fake.downloads).toEqual([{ url: "https://v", opts: { limits: { tag: "big-media" } } }])
    const encodes = fake.calls.filter((c) => c.args.includes("libx264"))
    expect(encodes).toHaveLength(1)
    const enc = encodes[0]!.args
    expect(argOf(enc, "-vf")).toBe("fps=fps=30000/1001")
    expect(enc.slice(enc.indexOf("-map"), enc.indexOf("-map") + 2)).toEqual(["-map", "0:0"])
    const keys = argOf(enc, "-force_key_frames")!.split(",")
    expect(keys.slice(0, 3)).toEqual(["0.000000", "9.976633", "19.953266"])
    expect(argOf(enc, "-af")).toBe("aresample=async=1:first_pts=0")
    expect(enc.join(" ")).toContain("-c:a pcm_f32le -ar 48000 -ch_layout stereo -f f32le")
    expect(encodes[0]!.peakMemoryMiB).toBeGreaterThan(257)
    expect(encodes[0]!.timeoutMs).toBeGreaterThanOrEqual(10 * 60_000)
    // the cut: stream copy at the partition's frame indices
    const cut = fake.calls.find((c) => c.args.includes("segment"))!.args
    expect(argOf(cut, "-c")).toBe("copy")
    expect(argOf(cut, "-segment_frames")).toBe("299,598,897,1196,1495,1794")
    expect(r.videoPartDurationsSec).toEqual([299, 299, 299, 299, 299, 299, 154].map((f) => (f * 1001) / 30000))
    expect(r.videoPaths!.map((p) => p.split("/").pop())).toEqual(Array.from({ length: 7 }, (_, i) => `video-part-0000${i}.mp4`))
  })

  it("each part's sound: read from its first sample by byte offset, trimmed to whole AAC frames, never longer than its picture", async () => {
    await splitMedia({ videoUrl: "https://v", chunkDuration: 10 })
    const muxes = fake.calls.filter((c) => c.args.includes("-skip_initial_bytes"))
    expect(muxes).toHaveLength(7)
    // part 1 = frames [299, 598): samples [⌈299·1001·48000/30000⌉, ⌊598·…⌋) = [478879, 957756),
    // 478 877 samples → written as 467 whole AAC frames = 478 208
    const m1 = muxes[1]!.args
    expect(argOf(m1, "-skip_initial_bytes")).toBe(String(478879 * 2 * 4))
    expect(argOf(m1, "-af")).toBe("apad=whole_len=478208,atrim=end_sample=478208")
    expect(argOf(m1, "-movie_timescale")).toBe("48000")
    expect(argOf(m1, "-c:v")).toBe("copy")
    expect(argOf(m1, "-c:a")).toBe("aac")
    expect(m1).toContain("+faststart")
  })

  it("the minimum rebalances the tail: 1798 frames → cuts at …1495, 1647", async () => {
    fake.frames = [1798]
    fake.probe = videoProbe({ duration: "59.993267" })
    const r = await splitMedia({ videoUrl: "https://v", chunkDuration: 10, minPartDuration: 4 })
    expect(argOf(fake.calls.find((c) => c.args.includes("segment"))!.args, "-segment_frames")).toBe("299,598,897,1196,1495,1647")
    expect(r.videoPaths).toHaveLength(7)
  })

  it("a frame count outside the estimate's slack re-encodes with keyframes at exactly the real cuts", async () => {
    // estimate 1948 (cuts at multiples of 299 only); the picture came out 1800:
    // 6 · 299 + 6 → the tail rebalances to 153 + 152, a cut (1648) nothing keyed
    fake.frames = [1800, 1800]
    const r = await splitMedia({ videoUrl: "https://v", chunkDuration: 10, minPartDuration: 4 })
    const encodes = fake.calls.filter((c) => c.args.includes("libx264"))
    expect(encodes).toHaveLength(2)
    expect(argOf(fake.calls.find((c) => c.args.includes("segment"))!.args, "-segment_frames")).toBe("299,598,897,1196,1495,1648")
    // the second encode keys exactly those cuts, and writes no PCM again
    expect(argOf(encodes[1]!.args, "-force_key_frames")!.split(",")).toHaveLength(7)
    expect(encodes[1]!.args.some((a) => a.endsWith(".pcm"))).toBe(false)
    expect(r.videoPaths).toHaveLength(7)
  })

  it("a video aligned after its sound: the PCM starts at the picture's first frame", async () => {
    fake.probe = videoProbe({ start_time: "0.500000" })
    await splitMedia({ videoUrl: "https://v", chunkDuration: 10 })
    const enc = fake.calls.find((c) => c.args.includes("libx264"))!.args
    // round(0.5 · 29.97) = 15 frames → ⌈15 · 1001 · 48000 / 30000⌉ = 24024 samples
    expect(argOf(enc, "-af")).toBe("aresample=async=1:first_pts=24024")
  })

  it("cover art is not a picture; a believable nominal rate wins, a timebase-like one falls to the average", async () => {
    fake.probe = {
      format: { start_time: "0", duration: "65" },
      streams: [
        { index: 0, codec_type: "video", disposition: { attached_pic: 1 }, r_frame_rate: "90000/1" },
        { index: 1, codec_type: "video", r_frame_rate: "90000/1", avg_frame_rate: "25/1", duration: "65", width: 320, height: 240 },
      ],
    }
    fake.frames = [1625]
    await splitMedia({ videoUrl: "https://v", chunkDuration: 10 })
    const enc = fake.calls.find((c) => c.args.includes("libx264"))!.args
    expect(argOf(enc, "-map")).toBe("0:1")
    expect(argOf(enc, "-vf")).toBe("fps=fps=25/1")
    expect(enc.some((a) => a.endsWith(".pcm"))).toBe(false) // no sound stream → picture-only parts
  })

  it("a video that states no length: no refusal up front, the encode stops one frame past the cap, every part-length multiple keyed", async () => {
    fake.probe = { format: { start_time: "0" }, streams: [{ index: 0, codec_type: "video", r_frame_rate: "25/1", width: 320, height: 240 }] }
    fake.frames = [300]
    const r = await splitMedia({ videoUrl: "https://v", chunkDuration: 5, minPartDuration: 0 })
    const enc = fake.calls.find((c) => c.args.includes("libx264"))!.args
    expect(argOf(enc, "-frames:v")).toBe(String(200 * 125 + 1))
    expect(argOf(enc, "-force_key_frames")!.split(",").slice(0, 3)).toEqual(["0.000000", "5.000000", "10.000000"])
    expect(r.videoPartDurationsSec).toEqual([5, 5, 2])
    expect(fake.calls.filter((c) => c.args.includes("libx264"))).toHaveLength(1)
  })

  it("a video that states no length and runs past the cap is refused after the capped encode", async () => {
    fake.probe = { format: {}, streams: [{ index: 0, codec_type: "video", r_frame_rate: "25/1" }] }
    fake.frames = [200 * 125 + 1]
    const err = await splitMedia({ videoUrl: "https://v", chunkDuration: 5 }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe("This video is longer than 200 parts of 5 s; the limit is 200. Use a longer part length, or trim the video first.")
  })

  it("refuses a video past 3 hours from the probe — before any ffmpeg runs", async () => {
    fake.probe = videoProbe({ duration: String(3 * 3600 + 12 * 60) })
    const err = await splitMedia({ videoUrl: "https://v", chunkDuration: 600 }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe("This video is 3 h 12 min long; Split into Chunks takes up to 3 hours — trim it first.")
    expect(fake.calls).toHaveLength(0)
  })

  it("exactly 3 hours passes the source cap", async () => {
    fake.probe = videoProbe({ duration: "10800" })
    fake.frames = [323_676]
    const r = await splitMedia({ videoUrl: "https://v", chunkDuration: 600 })
    // 600 s = 17 982 frames at 29.97: 323 676 = 18 × 17 982 exactly
    expect(r.videoPaths).toHaveLength(18)
  })

  it("a video that states no length is decoded at most 3 hours + 1 frame, then refused if longer", async () => {
    fake.probe = { format: {}, streams: [{ index: 0, codec_type: "video", r_frame_rate: "25/1" }] }
    fake.frames = [270_001]
    const err = await splitMedia({ videoUrl: "https://v", chunkDuration: 60 }).catch((e: unknown) => e)
    // 200 parts of 60 s = 300 000 frames, past the 270 000 frames of 3 hours
    expect(argOf(fake.calls.find((c) => c.args.includes("libx264"))!.args, "-frames:v")).toBe("270001")
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe("This video is longer than 3 hours; Split into Chunks takes up to 3 hours — trim it first.")
  })

  it("refuses over the cap from the probe — before any ffmpeg runs", async () => {
    fake.probe = videoProbe({ duration: "10800" })
    const err = await splitMedia({ videoUrl: "https://v", chunkDuration: 10 }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toMatch(/^This video would make 1,083 parts; the limit is 200\. Use a part length of at least 55 s/)
    expect(fake.calls).toHaveLength(0)
  })

  it("refuses a file with no video stream", async () => {
    fake.probe = { format: {}, streams: [{ index: 0, codec_type: "audio", sample_rate: "48000", channels: 2 }] }
    const err = await splitMedia({ videoUrl: "https://v", chunkDuration: 10 }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect(fake.calls).toHaveLength(0)
  })

  it("refuses an unusable part length before downloading", async () => {
    const err = await splitMedia({ videoUrl: "https://v", chunkDuration: Number.NaN }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect(fake.downloads).toHaveLength(0)
  })
})

describe("splitMedia — audio", () => {
  const audioProbe = { format: { duration: "23.5" }, streams: [{ index: 0, codec_type: "audio", sample_rate: "48000", channels: 1, channel_layout: "mono", duration: "23.5" }] }

  for (const [format, codec] of [["mp3", "libmp3lame"], ["wav", "pcm_s16le"]] as const) {
    it(`${format}: decoded once to PCM, each part encoded from its sample range`, async () => {
      fake.probe = audioProbe
      fake.channels = 1
      fake.pcmSamples = 23.5 * 48000
      const r = await splitMedia({ audioUrl: "https://a", chunkDuration: 5, minPartDuration: 4, audioFormat: format })
      expect(fake.calls[0]!.args.join(" ")).toContain("-map 0:0 -c:a pcm_f32le -ar 48000 -ch_layout mono -f f32le")
      const parts = fake.calls.slice(1)
      expect(parts.map((c) => argOf(c.args, "-skip_initial_bytes"))).toEqual([0, 240000, 480000, 720000, 924000].map((s) => String(s * 4)))
      expect(parts.map((c) => argOf(c.args, "-af"))).toEqual([240000, 240000, 240000, 204000, 204000].map((n) => `apad=whole_len=${n},atrim=end_sample=${n}`))
      expect(parts.every((c) => argOf(c.args, "-c:a") === codec)).toBe(true)
      expect(r.audioPaths!.map((p) => p.split("/").pop())).toEqual(Array.from({ length: 5 }, (_, i) => `audio-part-0000${i}.${format}`))
      expect(r.audioPartDurationsSec).toEqual([5, 5, 5, 4.25, 4.25])
    })
  }

  it("aac: AAC in MP4 (.m4a), planned in whole 1024-sample AAC frames — every part decodes exactly on every decoder", async () => {
    fake.probe = audioProbe
    fake.channels = 1
    fake.pcmSamples = 23.5 * 48000 // 1 128 000 samples = 1 101 whole frames (+576)
    const r = await splitMedia({ audioUrl: "https://a", chunkDuration: 5, minPartDuration: 4, audioFormat: "aac" })
    // max ⌊5 s · 48000 / 1024⌋ = 234 frames, min ⌈4 s · 48000 / 1024⌉ = 188:
    // 234 × 3, then 165 < 188 → the last two share 399 → 200, 199
    const frames = [234, 234, 234, 200, 199]
    const parts = fake.calls.slice(1)
    expect(parts.map((c) => Number(argOf(c.args, "-skip_initial_bytes")) / 4 / 1024)).toEqual([0, 234, 468, 702, 902])
    expect(parts.map((c) => argOf(c.args, "-af"))).toEqual(frames.map((f) => `apad=whole_len=${f * 1024},atrim=end_sample=${f * 1024}`))
    expect(parts.every((c) => argOf(c.args, "-c:a") === "aac" && argOf(c.args, "-movie_timescale") === "48000")).toBe(true)
    expect(r.audioPaths!.map((p) => p.split("/").pop())).toEqual(Array.from({ length: 5 }, (_, i) => `audio-part-0000${i}.m4a`))
    expect(r.audioPartDurationsSec).toEqual(frames.map((f) => (f * 1024) / 48000))
  })

  it("refuses a sound file past 3 hours from the probe — before decoding", async () => {
    fake.probe = { ...audioProbe, format: { duration: "10805" }, streams: [{ ...audioProbe.streams[0], duration: "10805" }] }
    const err = await splitMedia({ audioUrl: "https://a", chunkDuration: 600 }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe("This audio is 3 h 0 min 5 s long; Split into Chunks takes up to 3 hours — trim it first.")
    expect(fake.calls).toHaveLength(0)
  })

  it("a sound file that states no length is decoded at most 3 hours + 1 sample, then refused if longer", async () => {
    fake.probe = { format: {}, streams: [{ index: 0, codec_type: "audio", sample_rate: "48000", channels: 1, channel_layout: "mono" }] }
    fake.channels = 1
    fake.pcmSamples = 518_400_001
    const err = await splitMedia({ audioUrl: "https://a", chunkDuration: 600, audioFormat: "wav" }).catch((e: unknown) => e)
    expect(argOf(fake.calls[0]!.args, "-af")).toBe("atrim=end_sample=518400001")
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe("This audio is longer than 3 hours; Split into Chunks takes up to 3 hours — trim it first.")
    expect(fake.calls).toHaveLength(1)
  })

  it("the exact sample count decides: a PCM longer than the probe said can still be refused", async () => {
    fake.probe = { ...audioProbe, streams: [{ ...audioProbe.streams[0], duration: "999" }] }
    fake.channels = 1
    fake.pcmSamples = 48000 * 1001 // 1001 s at x = 5 → 201 parts
    const err = await splitMedia({ audioUrl: "https://a", chunkDuration: 5 }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toMatch(/^This audio would make 201 parts; the limit is 200/)
    expect(fake.calls).toHaveLength(1) // the decode only — no part encoded
  })
})
