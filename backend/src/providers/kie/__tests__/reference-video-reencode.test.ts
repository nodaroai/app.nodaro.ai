import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Every reference video a Seedance 2.x run carries is sent as a fresh encode,
 * never as the file it came in (`../reference-video-reencode.ts`). A clip the
 * model itself produced, sent byte for byte as the source of an edit, came
 * back as a near-copy of the input; the same footage re-encoded was edited.
 * The encode changes nothing a person can see: same size, same frames, same
 * frame rate, same length, sound kept.
 */

const mocks = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  runFfmpeg: vi.fn(),
  runFfprobe: vi.fn(),
  createWorkDir: vi.fn(),
  cleanupWorkDir: vi.fn(),
  uploadJobScratchFile: vi.fn(),
  stat: vi.fn(),
}))

vi.mock("../../video/ffmpeg-utils.js", () => ({
  downloadFile: mocks.downloadFile,
  runFfmpeg: mocks.runFfmpeg,
  runFfprobe: mocks.runFfprobe,
  createWorkDir: mocks.createWorkDir,
  cleanupWorkDir: mocks.cleanupWorkDir,
}))
vi.mock("../../../lib/job-scratch.js", () => ({ uploadJobScratchFile: mocks.uploadJobScratchFile }))
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  stat: mocks.stat,
}))
vi.mock("../client.js", () => ({
  createSanitizedError: (msg: string, ctx: string) => new Error(`[${ctx}] ${msg}`),
}))

import {
  REFERENCE_VIDEO_FALLBACK_CRF,
  SEEDANCE_2_5_REF_VIDEO_MAX_BYTES,
  SEEDANCE_2_REF_VIDEO_MAX_BYTES,
  parseReferenceVideoProbe,
  reencodeFirstPassArgs,
  reencodeReferenceVideo,
  reencodeReferenceVideoArgs,
  reencodeReferenceVideos,
  referenceVideoAudio,
  referenceVideoContainer,
  referenceVideoMaxBitRate,
  referenceVideoMaxBytes,
  referenceVideoTargetBitRate,
  type ReferenceVideoProbe,
} from "../reference-video-reencode.js"

const URL_IN = "https://cdn.nodaro.ai/videos/0f0e6b1c-seedance-output.mp4"
const REENCODED = "https://cdn.nodaro.ai/tmp/provider-input/job/provider-reencoded-1.mp4"

/** A Seedance 8 s generation as it comes back: H.264 4:2:0, AAC. */
const SEEDANCE_MP4: ReferenceVideoProbe = {
  width: 1280,
  height: 720,
  pixFmt: "yuv420p",
  videoBitRate: 6_000_000,
  audioBitRate: 128_000,
  durationSec: 8.04,
  quickTime: false,
}

/** The 2.0 family's limit and Seedance 2.5's (the provider's docs). */
const MAX_2_0 = 50_000_000
const MAX_2_5 = 200_000_000

const valueOf = (args: string[], flag: string): string | undefined => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

/** Flags that would trim, retime, resize or filter the clip. None may appear. */
const FORBIDDEN = ["-t", "-ss", "-to", "-sseof", "-r", "-vf", "-filter:v", "-filter_complex", "-frames:v", "-vframes", "-shortest", "-fpsmax", "-s"]

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
  mocks.createWorkDir.mockResolvedValue("/tmp/work")
  mocks.uploadJobScratchFile.mockResolvedValue(REENCODED)
  mocks.runFfmpeg.mockResolvedValue("")
  mocks.stat.mockResolvedValue({ size: 6_000_000 })
})

describe("reencodeReferenceVideoArgs", () => {
  it("re-encodes the picture with libx264 and passes every frame through as it is: no trim, no rate change, no filter", () => {
    const args = reencodeReferenceVideoArgs("/in", "/out.mp4", SEEDANCE_MP4, MAX_2_0, "copy", "/pass")
    expect(valueOf(args, "-c:v")).toBe("libx264")
    expect(valueOf(args, "-fps_mode")).toBe("passthrough")
    for (const flag of FORBIDDEN) expect(args, flag).not.toContain(flag)
    expect(args[args.length - 1]).toBe("/out.mp4")
    expect(args.slice(0, 3)).toEqual(["-y", "-i", "/in"])
  })

  it("keeps the first picture and the first sound track, copies the sound, drops chapters and metadata, and puts the index up front", () => {
    const args = reencodeReferenceVideoArgs("/in", "/out.mp4", SEEDANCE_MP4, MAX_2_0, "copy", "/pass")
    expect(args).toEqual(expect.arrayContaining(["-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1", "-map_chapters", "-1"]))
    expect(valueOf(args, "-c:a")).toBe("copy")
    expect(valueOf(args, "-movflags")).toBe("+faststart")
    expect(args).not.toContain("-an")
  })

  it("encodes the sound to AAC only when asked (the container could not hold it as it is)", () => {
    const args = reencodeReferenceVideoArgs("/in", "/out.mp4", SEEDANCE_MP4, MAX_2_0, "aac", "/pass")
    expect(valueOf(args, "-c:a")).toBe("aac")
    expect(valueOf(args, "-b:a")).toBe("192k")
  })

  it("matches the source's picture bitrate in the second of two passes", () => {
    const args = reencodeReferenceVideoArgs("/in", "/out.mp4", SEEDANCE_MP4, MAX_2_0, "copy", "/pass")
    expect(valueOf(args, "-b:v")).toBe("6000000")
    expect(valueOf(args, "-pass")).toBe("2")
    expect(valueOf(args, "-passlogfile")).toBe("/pass")
    expect(args).not.toContain("-crf")
  })

  it("falls back to a visually lossless constant quality when the bitrate is unknown, capped to the provider's size limit", () => {
    const probe: ReferenceVideoProbe = { ...SEEDANCE_MP4, videoBitRate: undefined }
    const args = reencodeReferenceVideoArgs("/in", "/out.mp4", probe, MAX_2_0, "copy")
    expect(valueOf(args, "-crf")).toBe(REFERENCE_VIDEO_FALLBACK_CRF)
    expect(args).not.toContain("-b:v")
    expect(args).not.toContain("-pass")
    const cap = referenceVideoMaxBitRate(probe, MAX_2_0)!
    expect(valueOf(args, "-maxrate")).toBe(String(cap))
    expect(valueOf(args, "-bufsize")).toBe(String(cap * 2))
  })

  it("with neither the bitrate nor the length known, is constant quality alone", () => {
    const args = reencodeReferenceVideoArgs("/in", "/out.mp4", { quickTime: false }, MAX_2_0, "copy")
    expect(valueOf(args, "-crf")).toBe(REFERENCE_VIDEO_FALLBACK_CRF)
    expect(args).not.toContain("-maxrate")
  })

  it("keeps an 8-bit 4:2:0, 4:2:2 or 4:4:4 pixel format, and makes anything else 4:2:0", () => {
    const pix = (pixFmt: string | undefined) => valueOf(reencodeReferenceVideoArgs("/in", "/o", { ...SEEDANCE_MP4, pixFmt }, MAX_2_0, "copy", "/p"), "-pix_fmt")
    expect(pix("yuv420p")).toBe("yuv420p")
    expect(pix("yuv422p")).toBe("yuv422p")
    expect(pix("yuv444p")).toBe("yuv444p")
    expect(pix("yuvj420p")).toBe("yuv420p")
    expect(pix("yuv420p10le")).toBe("yuv420p")
    expect(pix(undefined)).toBe("yuv420p")
  })

  it("carries the source's colour tags, skipping the ones the probe calls unknown", () => {
    const args = reencodeReferenceVideoArgs("/in", "/o", {
      ...SEEDANCE_MP4, colorSpace: "bt709", colorPrimaries: "bt709", colorTransfer: "unknown", colorRange: "tv",
    }, MAX_2_0, "copy", "/p")
    expect(valueOf(args, "-colorspace")).toBe("bt709")
    expect(valueOf(args, "-color_primaries")).toBe("bt709")
    expect(args).not.toContain("-color_trc")
    expect(valueOf(args, "-color_range")).toBe("tv")
  })
})

describe("reencodeFirstPassArgs", () => {
  it("measures the picture alone at the same rate and settings, and writes nothing", () => {
    const args = reencodeFirstPassArgs("/in", SEEDANCE_MP4, MAX_2_0, "/pass")
    expect(valueOf(args, "-pass")).toBe("1")
    expect(valueOf(args, "-passlogfile")).toBe("/pass")
    expect(valueOf(args, "-b:v")).toBe("6000000")
    expect(valueOf(args, "-fps_mode")).toBe("passthrough")
    expect(args).toContain("-an")
    expect(args.slice(-3)).toEqual(["-f", "null", "-"])
    for (const flag of FORBIDDEN) expect(args, flag).not.toContain(flag)
  })
})

describe("the provider's size limit", () => {
  it("is 200 MB a reference video for Seedance 2.5 and 50 MB for the 2.0 family", () => {
    expect(SEEDANCE_2_5_REF_VIDEO_MAX_BYTES).toBe(MAX_2_5)
    expect(SEEDANCE_2_REF_VIDEO_MAX_BYTES).toBe(MAX_2_0)
    expect(referenceVideoMaxBytes("seedance-2-5")).toBe(MAX_2_5)
    for (const p of ["seedance-2", "seedance-2-fast", "seedance-2-mini"]) expect(referenceVideoMaxBytes(p), p).toBe(MAX_2_0)
  })

  it("holds a model it does not name to the smaller limit", () => {
    expect(referenceVideoMaxBytes("seedance-3")).toBe(MAX_2_0)
    expect(referenceVideoMaxBytes("constructor")).toBe(MAX_2_0)
  })

  it("leaves a source under it at its own bitrate", () => {
    expect(referenceVideoTargetBitRate(SEEDANCE_MP4, MAX_2_0)).toBe(6_000_000)
  })

  it("leaves a source just under it at its own bitrate too", () => {
    // 30 s at 12.5 Mb/s + 300 kb/s sound = 48 MB: it fits, so its quality is kept.
    const near: ReferenceVideoProbe = { ...SEEDANCE_MP4, videoBitRate: 12_500_000, audioBitRate: 300_000, durationSec: 30 }
    expect(referenceVideoTargetBitRate(near, MAX_2_0)).toBe(12_500_000)
  })

  it("brings a source that would not fit under it, sound included", () => {
    const heavy: ReferenceVideoProbe = { ...SEEDANCE_MP4, videoBitRate: 40_000_000, audioBitRate: 1_536_000, durationSec: 30 }
    const rate = referenceVideoTargetBitRate(heavy, MAX_2_0)!
    expect(rate).toBeLessThan(40_000_000)
    expect(((rate + heavy.audioBitRate!) * heavy.durationSec!) / 8).toBeLessThan(MAX_2_0)
  })

  it("leaves Seedance 2.5 a source the 2.0 family's limit brings down", () => {
    // 30 s at 40 Mb/s + 1.5 Mb/s sound ≈ 156 MB: over 50 MB, under 200 MB.
    const heavy: ReferenceVideoProbe = { ...SEEDANCE_MP4, videoBitRate: 40_000_000, audioBitRate: 1_536_000, durationSec: 30 }
    expect(referenceVideoTargetBitRate(heavy, MAX_2_5)).toBe(40_000_000)
    expect(referenceVideoTargetBitRate(heavy, MAX_2_0)).toBeLessThan(40_000_000)
  })

  it("is not applied when the length is unknown", () => {
    expect(referenceVideoMaxBitRate({ ...SEEDANCE_MP4, durationSec: undefined }, MAX_2_0)).toBeUndefined()
    expect(referenceVideoTargetBitRate({ ...SEEDANCE_MP4, durationSec: undefined }, MAX_2_0)).toBe(6_000_000)
  })
})

describe("referenceVideoContainer", () => {
  it("keeps a QuickTime file a MOV (its 4:4:4 picture and PCM sound stay as they are), anything else an MP4", () => {
    expect(referenceVideoContainer({ quickTime: true }, URL_IN)).toBe("mov")
    expect(referenceVideoContainer({ quickTime: false }, URL_IN)).toBe("mp4")
  })

  it("reads a .mov address as QuickTime when the probe did not say", () => {
    expect(referenceVideoContainer({}, "https://cdn.nodaro.ai/videos/a-raw.mov?v=2")).toBe("mov")
    expect(referenceVideoContainer({}, URL_IN)).toBe("mp4")
  })
})

describe("referenceVideoAudio", () => {
  it("copies the sound an MP4 plays everywhere (AAC, MP3), and encodes any other to AAC", () => {
    expect(referenceVideoAudio({ audioCodec: "aac" }, "mp4")).toBe("copy")
    expect(referenceVideoAudio({ audioCodec: "mp3" }, "mp4")).toBe("copy")
    // ffmpeg would copy PCM into an MP4 without complaint: an MP4 few readers take.
    expect(referenceVideoAudio({ audioCodec: "pcm_s16le" }, "mp4")).toBe("aac")
    expect(referenceVideoAudio({ audioCodec: "opus" }, "mp4")).toBe("aac")
  })

  it("copies a MOV's PCM or AAC sound as it is, and encodes any other to AAC", () => {
    expect(referenceVideoAudio({ audioCodec: "pcm_s16le" }, "mov")).toBe("copy")
    expect(referenceVideoAudio({ audioCodec: "pcm_s24le" }, "mov")).toBe("copy")
    expect(referenceVideoAudio({ audioCodec: "aac" }, "mov")).toBe("copy")
    expect(referenceVideoAudio({ audioCodec: "opus" }, "mov")).toBe("aac")
  })

  it("tries a copy when the probe did not name the sound (a refused copy is then encoded to AAC)", () => {
    expect(referenceVideoAudio({}, "mp4")).toBe("copy")
  })
})

describe("parseReferenceVideoProbe", () => {
  it("reads the picture, the sound's rate, the length and the QuickTime brand", () => {
    const probe = parseReferenceVideoProbe(JSON.stringify({
      streams: [
        { codec_type: "video", width: 1280, height: 720, pix_fmt: "yuv444p", bit_rate: "9000000", color_space: "bt709" },
        { codec_type: "audio", codec_name: "pcm_s16le", bit_rate: "1536000" },
      ],
      format: { bit_rate: "10600000", duration: "8.041667", tags: { major_brand: "qt  " } },
    }))
    expect(probe).toEqual({
      width: 1280, height: 720, pixFmt: "yuv444p", videoBitRate: 9_000_000, audioBitRate: 1_536_000,
      audioCodec: "pcm_s16le", durationSec: 8.041667, quickTime: true, colorSpace: "bt709",
    })
  })

  it("takes the picture's rate from the container less the sound when the stream reports none", () => {
    const probe = parseReferenceVideoProbe(JSON.stringify({
      streams: [{ codec_type: "video", width: 640, height: 360, pix_fmt: "yuv420p" }, { codec_type: "audio", bit_rate: "128000" }],
      format: { bit_rate: "2128000", duration: "5", tags: { major_brand: "isom" } },
    }))
    expect(probe.videoBitRate).toBe(2_000_000)
    expect(probe.quickTime).toBe(false)
  })

  it("leaves out what it cannot read, and reads nothing from output that is not ffprobe's", () => {
    expect(parseReferenceVideoProbe("not json")).toEqual({})
    expect(parseReferenceVideoProbe(JSON.stringify({ streams: [{ codec_type: "audio" }] }))).toEqual({})
  })
})

describe("reencodeReferenceVideo", () => {
  const probeJson = (overrides: Record<string, unknown> = {}, brand = "isom", audioCodec: string | undefined = "aac") => JSON.stringify({
    streams: [
      { codec_type: "video", width: 1280, height: 720, pix_fmt: "yuv420p", bit_rate: "6000000", ...overrides },
      { codec_type: "audio", codec_name: audioCodec, bit_rate: "128000" },
    ],
    format: { duration: "8.04", tags: { major_brand: brand } },
  })

  it("downloads, encodes in two passes at the source's rate, and returns the copy in the job's scratch folder", async () => {
    mocks.runFfprobe.mockResolvedValue(probeJson())
    const url = await reencodeReferenceVideo(URL_IN, "seedance-2-5", "reference video #1")
    expect(url).toBe(REENCODED)
    expect(mocks.downloadFile).toHaveBeenCalledWith(URL_IN, "/tmp/work/input")
    const passes = mocks.runFfmpeg.mock.calls.map((c) => c[0] as string[])
    expect(passes).toHaveLength(2)
    expect(valueOf(passes[0]!, "-pass")).toBe("1")
    expect(valueOf(passes[1]!, "-pass")).toBe("2")
    expect(passes[1]![passes[1]!.length - 1]).toBe("/tmp/work/reencoded.mp4")
    // Admitted like every ffmpeg, at the clip's own size.
    expect(mocks.runFfmpeg.mock.calls[0]![2]).toEqual({ peakMemoryMiB: expect.any(Number) })
    expect(mocks.uploadJobScratchFile).toHaveBeenCalledWith("/tmp/work/reencoded.mp4", "provider-reencoded", "mp4", "video/mp4")
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/work")
  })

  it("runs the second pass again at the bitrate that fits when two passes land over the limit", async () => {
    mocks.runFfprobe.mockResolvedValue(JSON.stringify({
      streams: [
        { codec_type: "video", width: 1280, height: 720, pix_fmt: "yuv444p", bit_rate: "12500000" },
        { codec_type: "audio", codec_name: "pcm_s16le", bit_rate: "300000" },
      ],
      format: { duration: "30", tags: { major_brand: "qt  " } },
    }))
    mocks.stat.mockResolvedValueOnce({ size: 50_400_000 }).mockResolvedValueOnce({ size: 45_000_000 })
    await reencodeReferenceVideo(URL_IN, "seedance-2")
    const runs = mocks.runFfmpeg.mock.calls.map((c) => c[0] as string[])
    expect(runs).toHaveLength(3)
    expect(valueOf(runs[1]!, "-b:v")).toBe("12500000")
    const cap = referenceVideoMaxBitRate({ durationSec: 30, audioBitRate: 300_000 }, MAX_2_0)!
    expect(cap).toBeLessThan(12_500_000)
    expect(valueOf(runs[2]!, "-b:v")).toBe(String(cap))
    expect(valueOf(runs[2]!, "-pass")).toBe("2")
    expect(valueOf(runs[2]!, "-c:a")).toBe("copy")
  })

  it("holds each model to its own limit: a heavy clip is encoded down for the 2.0 family and kept for Seedance 2.5", async () => {
    // 30 s at 40 Mb/s + 1.5 Mb/s sound ≈ 156 MB.
    mocks.runFfprobe.mockResolvedValue(JSON.stringify({
      streams: [
        { codec_type: "video", width: 1280, height: 720, pix_fmt: "yuv420p", bit_rate: "40000000" },
        { codec_type: "audio", codec_name: "aac", bit_rate: "1536000" },
      ],
      format: { duration: "30", tags: { major_brand: "isom" } },
    }))
    await reencodeReferenceVideo(URL_IN, "seedance-2-fast")
    const down = Number(valueOf(mocks.runFfmpeg.mock.calls[1]![0] as string[], "-b:v"))
    expect(down).toBeLessThan(40_000_000)
    expect(((down + 1_536_000) * 30) / 8).toBeLessThan(MAX_2_0)
    mocks.runFfmpeg.mockClear()
    await reencodeReferenceVideo(URL_IN, "seedance-2-5")
    expect(valueOf(mocks.runFfmpeg.mock.calls[1]![0] as string[], "-b:v")).toBe("40000000")
  })

  it("re-runs a Seedance 2.5 copy only past its own 200 MB, not past 50 MB", async () => {
    mocks.runFfprobe.mockResolvedValue(JSON.stringify({
      streams: [
        { codec_type: "video", width: 1280, height: 720, pix_fmt: "yuv420p", bit_rate: "12500000" },
        { codec_type: "audio", codec_name: "aac", bit_rate: "300000" },
      ],
      format: { duration: "30", tags: { major_brand: "isom" } },
    }))
    mocks.stat.mockResolvedValue({ size: 50_400_000 })
    await reencodeReferenceVideo(URL_IN, "seedance-2-5")
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(2)
  })

  it("does not re-run a copy that fits", async () => {
    mocks.runFfprobe.mockResolvedValue(probeJson())
    await reencodeReferenceVideo(URL_IN, "seedance-2-5")
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(2)
  })

  it("keeps a QuickTime source a MOV, its 4:4:4 picture and its PCM sound", async () => {
    mocks.runFfprobe.mockResolvedValue(probeJson({ pix_fmt: "yuv444p" }, "qt  ", "pcm_s16le"))
    await reencodeReferenceVideo(URL_IN, "seedance-2-5")
    const second = mocks.runFfmpeg.mock.calls[1]![0] as string[]
    expect(second[second.length - 1]).toBe("/tmp/work/reencoded.mov")
    expect(valueOf(second, "-pix_fmt")).toBe("yuv444p")
    expect(valueOf(second, "-c:a")).toBe("copy")
    expect(mocks.uploadJobScratchFile).toHaveBeenCalledWith("/tmp/work/reencoded.mov", "provider-reencoded", "mov", "video/quicktime")
  })

  it("encodes a sound the MP4 should not carry straight to AAC, with no copy attempt", async () => {
    mocks.runFfprobe.mockResolvedValue(probeJson({}, "isom", "pcm_s16le"))
    await reencodeReferenceVideo(URL_IN, "seedance-2-5")
    const runs = mocks.runFfmpeg.mock.calls.map((c) => c[0] as string[])
    expect(runs).toHaveLength(2)
    expect(valueOf(runs[1]!, "-c:a")).toBe("aac")
  })

  it("encodes the sound to AAC when a copy is refused, reusing the first pass", async () => {
    mocks.runFfprobe.mockResolvedValue(probeJson({}, "isom", undefined))
    mocks.runFfmpeg
      .mockResolvedValueOnce("")
      .mockRejectedValueOnce(new Error("ffmpeg failed: [mp4 @ 0x1] Could not find tag for codec pcm_s16le in stream #1, codec not currently supported in container"))
      .mockResolvedValueOnce("")
    await reencodeReferenceVideo(URL_IN, "seedance-2-5")
    const runs = mocks.runFfmpeg.mock.calls.map((c) => c[0] as string[])
    expect(runs).toHaveLength(3)
    expect(valueOf(runs[1]!, "-c:a")).toBe("copy")
    expect(valueOf(runs[2]!, "-c:a")).toBe("aac")
    expect(valueOf(runs[2]!, "-pass")).toBe("2")
  })

  it("reads the MOV muxer's refusal the same way", async () => {
    mocks.runFfprobe.mockResolvedValue(probeJson({}, "qt  ", undefined))
    mocks.runFfmpeg
      .mockResolvedValueOnce("")
      .mockRejectedValueOnce(new Error("ffmpeg failed: [mov @ 0x1] opus only supported in MP4."))
      .mockResolvedValueOnce("")
    await reencodeReferenceVideo(URL_IN, "seedance-2-5")
    expect(valueOf(mocks.runFfmpeg.mock.calls[2]![0] as string[], "-c:a")).toBe("aac")
  })

  it("does not retry a failure that is not about the sound", async () => {
    mocks.runFfprobe.mockResolvedValue(probeJson({}, "isom", undefined))
    mocks.runFfmpeg.mockResolvedValueOnce("").mockRejectedValueOnce(new Error("ffmpeg failed: Conversion failed!"))
    await expect(reencodeReferenceVideo(URL_IN, "seedance-2-5")).rejects.toThrow(/Could not prepare reference video/)
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(2)
  })

  it("encodes in one pass at constant quality when the probe reads no bitrate", async () => {
    mocks.runFfprobe.mockRejectedValue(new Error("ffprobe failed"))
    await reencodeReferenceVideo(URL_IN, "seedance-2-5")
    const runs = mocks.runFfmpeg.mock.calls.map((c) => c[0] as string[])
    expect(runs).toHaveLength(1)
    expect(valueOf(runs[0]!, "-crf")).toBe(REFERENCE_VIDEO_FALLBACK_CRF)
  })

  it("fails the run, never sends the original, when the encode fails", async () => {
    mocks.runFfprobe.mockResolvedValue(probeJson())
    mocks.runFfmpeg.mockRejectedValue(new Error("ffmpeg failed: Invalid data found when processing input"))
    await expect(reencodeReferenceVideo(URL_IN, "seedance-2-5", "reference video #2")).rejects.toThrow(
      "[Video generation] Could not prepare reference video #2 for this model",
    )
    expect(mocks.uploadJobScratchFile).not.toHaveBeenCalled()
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/work")
  })

  it("fails the run when the download fails", async () => {
    mocks.downloadFile.mockRejectedValueOnce(new Error("terminated"))
    await expect(reencodeReferenceVideo(URL_IN, "seedance-2-5")).rejects.toThrow(/Could not prepare reference video/)
    expect(mocks.runFfmpeg).not.toHaveBeenCalled()
  })

  it("fails the run when the upload fails", async () => {
    mocks.runFfprobe.mockResolvedValue(probeJson())
    mocks.uploadJobScratchFile.mockRejectedValueOnce(new Error("R2 down"))
    await expect(reencodeReferenceVideo(URL_IN, "seedance-2-5")).rejects.toThrow(/Could not prepare reference video/)
  })
})

describe("reencodeReferenceVideos", () => {
  it("re-encodes each clip under its own number, in order", async () => {
    mocks.runFfprobe.mockResolvedValue("{}")
    mocks.createWorkDir.mockResolvedValueOnce("/tmp/w1").mockResolvedValueOnce("/tmp/w2")
    mocks.uploadJobScratchFile.mockImplementation(async (path: string) => (path.startsWith("/tmp/w1/") ? "https://cdn/a.mp4" : "https://cdn/b.mp4"))
    const out = await reencodeReferenceVideos(["https://x/1.mp4", "https://x/2.mp4"], "seedance-2-5")
    expect(out).toEqual(["https://cdn/a.mp4", "https://cdn/b.mp4"])
    expect(mocks.downloadFile.mock.calls.map((c) => c[0])).toEqual(["https://x/1.mp4", "https://x/2.mp4"])
  })

  it("lets every clip finish before the run fails, so no encode or upload outlives it", async () => {
    mocks.runFfprobe.mockResolvedValue("{}")
    mocks.createWorkDir.mockResolvedValueOnce("/tmp/w1").mockResolvedValueOnce("/tmp/w2")
    let finishSecond: (() => void) | undefined
    mocks.downloadFile.mockImplementation(async (url: string) => {
      if (url.endsWith("/1.mp4")) throw new Error("404")
      await new Promise<void>((resolve) => { finishSecond = resolve })
    })
    let failed = false
    const run = reencodeReferenceVideos(["https://x/1.mp4", "https://x/2.mp4"], "seedance-2-5").then(
      () => undefined,
      (e: unknown) => { failed = true; return e },
    )
    await vi.waitFor(() => expect(finishSecond).toBeDefined())
    await new Promise((r) => setTimeout(r, 0))
    expect(failed).toBe(false)
    finishSecond!()
    const err = await run
    expect(failed).toBe(true)
    expect(String(err)).toMatch(/Could not prepare reference video #1/)
    expect(mocks.cleanupWorkDir.mock.calls.map((c) => c[0]).sort()).toEqual(["/tmp/w1", "/tmp/w2"])
  })

  it("makes no work for no clips", async () => {
    expect(await reencodeReferenceVideos([], "seedance-2-5")).toEqual([])
    expect(mocks.downloadFile).not.toHaveBeenCalled()
  })
})
