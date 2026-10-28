import { describe, it, expect, vi, beforeEach } from "vitest"
import { writeFile } from "node:fs/promises"

/**
 * The Kling 4.0 audio soundtrack (lib/audio-soundtrack.ts): the first reference
 * audio clip becomes a reference video carrying it, so the run's checks and
 * price read it as one; the clip's length is the one the price was quoted at.
 */

const io = vi.hoisted(() => ({
  audioSec: new Map<string, number>(),
  stored: new Set<string>(),
  uploads: [] as string[],
  ffmpeg: [] as string[][],
}))
vi.mock("../../providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../providers/video/ffmpeg-utils.js")>()),
  probeMediaDuration: async (url: string) => {
    const d = io.audioSec.get(url)
    if (d === undefined) throw new Error("ffprobe failed")
    return d
  },
  downloadFile: async (_url: string, dest: string) => writeFile(dest, "x"),
  runFfmpeg: async (args: readonly string[]) => {
    io.ffmpeg.push([...args])
    await writeFile(args[args.length - 1]!, "mp4")
    return ""
  },
}))
// The test's CDN host counts as this platform's own storage whatever the environment's R2_PUBLIC_URL.
vi.mock("../fetch-own-media.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../fetch-own-media.js")>()),
  isOwnMediaUrl: (url: string) => url.startsWith("https://cdn.nodaro.ai/"),
}))
vi.mock("../storage.js", () => ({
  r2Url: (key: string) => `https://cdn.nodaro.ai/${key}`,
  headR2Object: async (key: string) => ({ exists: io.stored.has(key) }),
  uploadBufferToR2: async (_buf: Buffer, key: string) => {
    io.uploads.push(key)
    io.stored.add(key)
    return `https://cdn.nodaro.ai/${key}`
  },
}))

import { applyAudioSoundtrack, audioSoundtrackFfmpegArgs } from "../audio-soundtrack.js"
import { probeRefVideoDurations, resetRefVideoProbeCache } from "../ref-video-probe.js"

const SONG = "https://cdn.nodaro.ai/audios/song.mp3"
const VOICE = "https://cdn.nodaro.ai/audios/voice.mp3"
const SINGER = "https://cdn.nodaro.ai/uploads/images/singer.png"

beforeEach(() => {
  io.audioSec = new Map([[SONG, 14], [VOICE, 6]])
  io.stored = new Set()
  io.uploads = []
  io.ffmpeg = []
  resetRefVideoProbeCache()
})

const kling = (extra: Record<string, unknown> = {}) => ({
  provider: "kling-4",
  duration: 5,
  aspectRatio: "16:9",
  prompt: "use the exact audio from @audio_1; @audio_2 is the narrator",
  referenceImageUrls: [SINGER],
  referenceAudioUrls: [SONG, VOICE],
  ...extra,
})

describe("applyAudioSoundtrack", () => {
  it("leaves a request alone when the model follows the audio, the soundtrack is off, or there is no audio", async () => {
    for (const req of [
      kling({ provider: "seedance-2" }),
      kling({ audioSoundtrack: false }),
      kling({ referenceAudioUrls: [] }),
    ]) {
      const out = await applyAudioSoundtrack(req, "u1")
      expect(out).toEqual({ ok: true, request: req, applied: false })
    }
    expect(io.uploads).toEqual([])
  })

  it("sends the first clip as a reference video with its sound kept; the rest stay voices", async () => {
    const out = await applyAudioSoundtrack(kling({ referenceVideoUrls: ["https://cdn.nodaro.ai/uploads/video/u1/move.mp4"] }), "u1")
    expect(out.ok && out.applied).toBe(true)
    if (!out.ok) return
    const req = out.request
    expect(req.referenceVideoUrls).toHaveLength(2)
    expect(String((req.referenceVideoUrls as string[])[1])).toMatch(/^https:\/\/cdn\.nodaro\.ai\/uploads\/video\/u1\/soundtrack-[0-9a-f]{32}\.mp4$/)
    expect(req.referenceAudioUrls).toEqual([VOICE])
    expect(req.keepOriginalSound).toBe(true)
    expect(req.prompt).toMatch(/^@video_2 is the soundtrack:/)
    expect(req.prompt).toContain("use the exact audio from @video_2; @audio_1 is the narrator")
  })

  it("cuts a long track to the video's length, on the start frame, at the run's aspect ratio", async () => {
    await applyAudioSoundtrack(kling({ imageUrl: "https://cdn.nodaro.ai/start.png" }), "u1")
    const args = io.ffmpeg[0]!
    expect(args[args.indexOf("-t") + 1]).toBe("5.000000")
    expect(args[args.indexOf("-frames:v") + 1]).toBe("120")
    expect(args.join(" ")).toContain("pad=1280:720")
    expect(args.join(" ")).toContain("-loop 1")
  })

  it("prices from the length it made: the run's probe reads it exactly", async () => {
    io.audioSec.set(SONG, 3.4)
    const out = await applyAudioSoundtrack(kling(), "u1")
    if (!out.ok) throw new Error("refused")
    const url = (out.request.referenceVideoUrls as string[])[0]!
    expect(await probeRefVideoDurations({ provider: "kling-4", referenceVideoUrls: [url] })).toEqual([82 / 24])
  })

  it("applies once: a request read again keeps its remaining clips as voices", async () => {
    const once = await applyAudioSoundtrack(kling(), "u1")
    if (!once.ok) throw new Error("refused")
    expect(once.request.audioSoundtrack).toBe(false)
    const twice = await applyAudioSoundtrack(once.request, "u1")
    expect(twice.ok && twice.applied).toBe(false)
    if (twice.ok) expect(twice.request).toEqual(once.request)
  })

  it("makes a clip once: a quote and its run reuse it", async () => {
    await applyAudioSoundtrack(kling(), "u1")
    await applyAudioSoundtrack(kling(), "u1")
    expect(io.uploads).toHaveLength(1)
    expect(io.ffmpeg).toHaveLength(1)
  })

  it("refuses when no reference-video place is left, or the audio cannot be read", async () => {
    const five = Array.from({ length: 5 }, (_, i) => `https://cdn.nodaro.ai/uploads/video/u1/v${i}.mp4`)
    const full = await applyAudioSoundtrack(kling({ referenceVideoUrls: five }), "u1")
    expect(full.ok).toBe(false)
    if (!full.ok) expect(full.message).toMatch(/turn off "Play audio as soundtrack"/)

    io.audioSec.delete(SONG)
    const unread = await applyAudioSoundtrack(kling(), "u1")
    expect(unread.ok).toBe(false)
  })
})

describe("audioSoundtrackFfmpegArgs", () => {
  it("draws black when the run has no image, sized to its aspect ratio", () => {
    const args = audioSoundtrackFfmpegArgs({ framePath: undefined, audioPath: "/a", outPath: "/o.mp4", sec: 2, canvas: { w: 720, h: 1280 } })
    expect(args.join(" ")).toContain("color=c=black:s=720x1280")
    expect(args[args.indexOf("-t") + 1]).toBe("2.000000")
    expect(args[args.indexOf("-frames:v") + 1]).toBe("48")
  })
})
