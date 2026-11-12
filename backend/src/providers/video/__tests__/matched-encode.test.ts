import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * One picture encode for every re-encode that must keep the source's quality
 * (`../matched-encode.ts`): the source's own picture bitrate (in two passes
 * when asked), its pixel format where 8-bit H.264 can hold it and its colour
 * tags; a visually lossless constant quality only when the bitrate is unknown.
 */

const mocks = vi.hoisted(() => ({ runFfprobe: vi.fn() }))

vi.mock("../ffmpeg-utils.js", () => ({ runFfprobe: mocks.runFfprobe }))

import {
  MATCHED_FALLBACK_CRF,
  matchedHasBitRate,
  matchedPictureArgs,
  parseMatchedProbe,
  probeMatched,
  type MatchedProbe,
} from "../matched-encode.js"

/** A Seedance 8 s generation as it comes back: H.264 4:2:0 at 24 fps, AAC. */
const SOURCE: MatchedProbe = {
  width: 1280,
  height: 720,
  pixFmt: "yuv420p",
  videoBitRate: 6_000_000,
  audioBitRate: 128_000,
  durationSec: 8.04,
  fpsRational: "24/1",
  quickTime: false,
}

const valueOf = (args: string[], flag: string): string | undefined => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("matchedPictureArgs", () => {
  it("keeps the probe's bitrate, pixel format and colour tags, and never a CRF when the bitrate is known", () => {
    const args = matchedPictureArgs({
      ...SOURCE, pixFmt: "yuv444p", colorSpace: "bt709", colorPrimaries: "bt709", colorTransfer: "bt709", colorRange: "tv",
    })
    expect(valueOf(args, "-c:v")).toBe("libx264")
    expect(valueOf(args, "-fps_mode")).toBe("passthrough")
    expect(valueOf(args, "-b:v")).toBe("6000000")
    expect(valueOf(args, "-pix_fmt")).toBe("yuv444p")
    expect(valueOf(args, "-colorspace")).toBe("bt709")
    expect(valueOf(args, "-color_primaries")).toBe("bt709")
    expect(valueOf(args, "-color_trc")).toBe("bt709")
    expect(valueOf(args, "-color_range")).toBe("tv")
    expect(args).not.toContain("-crf")
    expect(args).not.toContain("-maxrate")
    // A rate the caller sets wins over the probe's, still with no CRF.
    const capped = matchedPictureArgs(SOURCE, { targetBitRate: 4_000_000, maxBitRate: 4_000_000 })
    expect(valueOf(capped, "-b:v")).toBe("4000000")
    expect(capped).not.toContain("-crf")
    expect(capped).not.toContain("-maxrate")
  })

  it("falls back to CRF 14 only without a bitrate", () => {
    expect(MATCHED_FALLBACK_CRF).toBe("14")
    const unknown: MatchedProbe = { ...SOURCE, videoBitRate: undefined }
    const args = matchedPictureArgs(unknown)
    expect(valueOf(args, "-crf")).toBe("14")
    expect(args).not.toContain("-b:v")
    expect(args).not.toContain("-maxrate")
    // A ceiling, when the caller has one, caps the constant quality.
    const capped = matchedPictureArgs(unknown, { maxBitRate: 3_000_000 })
    expect(valueOf(capped, "-crf")).toBe("14")
    expect(valueOf(capped, "-maxrate")).toBe("3000000")
    expect(valueOf(capped, "-bufsize")).toBe("6000000")
  })

  it("adds the two-pass flags with a bitrate, and none at constant quality", () => {
    const first = matchedPictureArgs(SOURCE, { pass: { n: 1, log: "/w/pass" } })
    expect(valueOf(first, "-pass")).toBe("1")
    expect(valueOf(first, "-passlogfile")).toBe("/w/pass")
    const second = matchedPictureArgs(SOURCE, { pass: { n: 2, log: "/w/pass" } })
    expect(valueOf(second, "-pass")).toBe("2")
    expect(matchedPictureArgs(SOURCE)).not.toContain("-pass")
    expect(matchedPictureArgs({ ...SOURCE, videoBitRate: undefined }, { pass: { n: 1, log: "/w/pass" } })).not.toContain("-pass")
  })

  it("matchedHasBitRate agrees with the arguments: a bitrate when it says so, the CRF fallback when it does not", () => {
    for (const [probe, opts] of [
      [SOURCE, undefined],
      [SOURCE, { targetBitRate: 4_000_000 }],
    ] as const) {
      expect(matchedHasBitRate(probe, opts)).toBe(true)
      const args = matchedPictureArgs(probe, { ...opts, pass: { n: 1, log: "/w/pass" } })
      expect(args).toContain("-b:v")
      expect(args).toContain("-pass")
      expect(args).not.toContain("-crf")
    }
    for (const videoBitRate of [undefined, 0, 0.4]) {
      const probe: MatchedProbe = { ...SOURCE, videoBitRate }
      expect(matchedHasBitRate(probe), String(videoBitRate)).toBe(false)
      const args = matchedPictureArgs(probe, { pass: { n: 1, log: "/w/pass" } })
      expect(valueOf(args, "-crf")).toBe(MATCHED_FALLBACK_CRF)
      expect(args).not.toContain("-b:v")
      expect(args).not.toContain("-pass")
    }
  })

  it("keeps an 8-bit 4:2:0, 4:2:2 or 4:4:4 pixel format, and makes anything else 4:2:0", () => {
    const pix = (pixFmt: string | undefined) => valueOf(matchedPictureArgs({ ...SOURCE, pixFmt }), "-pix_fmt")
    expect(pix("yuv420p")).toBe("yuv420p")
    expect(pix("yuv422p")).toBe("yuv422p")
    expect(pix("yuv444p")).toBe("yuv444p")
    expect(pix("yuvj420p")).toBe("yuv420p")
    expect(pix("yuv420p10le")).toBe("yuv420p")
    expect(pix(undefined)).toBe("yuv420p")
  })

  it("skips a colour tag the probe calls unknown", () => {
    const args = matchedPictureArgs({ ...SOURCE, colorSpace: "bt709", colorTransfer: "unknown" })
    expect(valueOf(args, "-colorspace")).toBe("bt709")
    expect(args).not.toContain("-color_trc")
    expect(args).not.toContain("-color_primaries")
  })
})

describe("parseMatchedProbe", () => {
  it("reads the picture, its frame rate, the sound's rate, the length and the QuickTime brand", () => {
    const probe = parseMatchedProbe(JSON.stringify({
      streams: [
        { codec_type: "video", width: 854, height: 480, pix_fmt: "yuv420p", bit_rate: "2000000", r_frame_rate: "24/1", avg_frame_rate: "24/1" },
        { codec_type: "audio", codec_name: "aac", bit_rate: "128000", r_frame_rate: "0/0", avg_frame_rate: "0/0" },
      ],
      format: { bit_rate: "2140000", duration: "5.041667", tags: { major_brand: "isom" } },
    }))
    expect(probe).toEqual({
      width: 854, height: 480, pixFmt: "yuv420p", videoBitRate: 2_000_000, audioBitRate: 128_000,
      audioCodec: "aac", durationSec: 5.041667, fpsRational: "24/1", nominalFpsRational: "24/1", quickTime: false,
    })
  })

  it("reads the picture's codec, apart from the sound's", () => {
    const probe = parseMatchedProbe(JSON.stringify({
      streams: [
        { codec_type: "video", codec_name: "hevc", width: 1920, height: 1080 },
        { codec_type: "audio", codec_name: "aac" },
      ],
    }))
    expect(probe.videoCodec).toBe("hevc")
    expect(probe.audioCodec).toBe("aac")
    expect(parseMatchedProbe(JSON.stringify({ streams: [{ codec_type: "video", width: 2, height: 2 }] }))).not.toHaveProperty("videoCodec")
  })

  it("reads the nominal rate verbatim, apart from the average, and leaves it out when it does not parse", () => {
    const nominalOf = (r: string | undefined, avg: string | undefined) =>
      parseMatchedProbe(JSON.stringify({ streams: [{ codec_type: "video", r_frame_rate: r, avg_frame_rate: avg }] }))
    // An NTSC MOV on a millisecond timescale: its average is off the grid, its nominal rate is not.
    expect(nominalOf("30000/1001", "8900/297")).toMatchObject({ fpsRational: "8900/297", nominalFpsRational: "30000/1001" })
    // A variable rate has no constant one, but still a nominal one.
    const vfr = nominalOf("60/1", "6/1")
    expect(vfr.fpsRational).toBeUndefined()
    expect(vfr.nominalFpsRational).toBe("60/1")
    for (const r of ["0/0", "-30/-1", undefined]) {
      expect(nominalOf(r, "25/1"), String(r)).not.toHaveProperty("nominalFpsRational")
    }
  })

  /** The constant rate parseMatchedProbe reads from a picture with these `r_frame_rate` / `avg_frame_rate`. */
  const rateOf = (r: string | undefined, avg: string | undefined) =>
    parseMatchedProbe(JSON.stringify({ streams: [{ codec_type: "video", r_frame_rate: r, avg_frame_rate: avg }] })).fpsRational

  it("reads an NTSC rate with its exact fraction", () => {
    expect(rateOf("30000/1001", "30000/1001")).toBe("30000/1001")
  })

  it("takes the fraction from the field the rate came from: the average, else the nominal rate", () => {
    // An average a little off the nominal rate is still constant: the average is the rate.
    expect(rateOf("30/1", "120000/4001")).toBe("120000/4001")
    expect(rateOf("25/1", undefined)).toBe("25/1")
    expect(rateOf(undefined, "24/1")).toBe("24/1")
    // An unreadable average falls to the nominal rate, fraction included.
    expect(rateOf("25/1", "0/0")).toBe("25/1")
  })

  it("leaves the constant rate out when the clip has none, or reports none", () => {
    // A sparse screen recording: an average of ~6 against a base of 60.
    expect(rateOf("60/1", "6/1")).toBeUndefined()
    expect(rateOf("0/0", "0/0")).toBeUndefined()
    expect(rateOf(undefined, undefined)).toBeUndefined()
  })

  it("reads a negative rate as none, as every probe does (the shared parser's rule)", () => {
    expect(rateOf("-30/-1", "-30/-1")).toBeUndefined()
  })

  it("reads the picture stream's own length, and leaves it out when the stream states none", () => {
    const mp4 = parseMatchedProbe(JSON.stringify({
      streams: [{ codec_type: "video", r_frame_rate: "24/1", avg_frame_rate: "24/1", duration: "3.000000" }],
      format: { duration: "3.021333" },
    }))
    expect(mp4).toMatchObject({ videoDurationSec: 3, durationSec: 3.021333 })
    // A Matroska/WebM stream states none (ffprobe writes N/A); the container's length stays.
    const webm = parseMatchedProbe(JSON.stringify({
      streams: [{ codec_type: "video", r_frame_rate: "30/1", avg_frame_rate: "30/1", duration: "N/A" }],
      format: { duration: "4.608000" },
    }))
    expect(webm).not.toHaveProperty("videoDurationSec")
    expect(webm.durationSec).toBe(4.608)
  })

  it("reads where the picture and the first sound track start, at zero or before it too", () => {
    const at = (video: unknown, audio: unknown) => parseMatchedProbe(JSON.stringify({
      streams: [{ codec_type: "video", start_time: video }, { codec_type: "audio", start_time: audio }, { codec_type: "audio", start_time: "9" }],
    }))
    expect(at("0.500000", "0.000000")).toMatchObject({ videoStartSec: 0.5, audioStartSec: 0 })
    expect(at("0.000000", "-0.021333")).toMatchObject({ videoStartSec: 0, audioStartSec: -0.021333 })
    const unread = at("N/A", undefined)
    expect(unread).not.toHaveProperty("videoStartSec")
    expect(unread).not.toHaveProperty("audioStartSec")
  })

  it("leaves out what it cannot read, and reads nothing from output that is not ffprobe's", () => {
    expect(parseMatchedProbe("not json")).toEqual({})
    expect(parseMatchedProbe(JSON.stringify({ streams: [{ codec_type: "audio" }] }))).toEqual({})
  })
})

describe("probeMatched", () => {
  it("probes the local file with ffprobe, frame rates included", async () => {
    mocks.runFfprobe.mockResolvedValue(JSON.stringify({
      streams: [{ codec_type: "video", width: 1280, height: 720, pix_fmt: "yuv420p", bit_rate: "6000000", r_frame_rate: "24/1", avg_frame_rate: "24/1" }],
      format: { duration: "8.04", tags: { major_brand: "qt  " } },
    }))
    const probe = await probeMatched("/w/source.mov")
    expect(probe).toMatchObject({ width: 1280, height: 720, videoBitRate: 6_000_000, fpsRational: "24/1", quickTime: true })
    expect(probe).not.toHaveProperty("fps")
    const args = mocks.runFfprobe.mock.calls[0]![0] as string[]
    expect(args[args.length - 1]).toBe("/w/source.mov")
    expect(valueOf(args, "-show_entries")).toMatch(/r_frame_rate/)
    expect(valueOf(args, "-show_entries")).toMatch(/avg_frame_rate/)
    // The picture stream's own length, and where each stream starts.
    expect(valueOf(args, "-show_entries")).toMatch(/^stream=[^:]*\bduration\b/)
    expect(valueOf(args, "-show_entries")).toMatch(/^stream=[^:]*\bstart_time\b/)
    expect(valueOf(args, "-show_entries")).not.toMatch(/nb_frames/)
  })

  it("never throws: an unreadable probe is an empty one", async () => {
    mocks.runFfprobe.mockRejectedValue(new Error("ffprobe failed"))
    await expect(probeMatched("/w/missing.mp4")).resolves.toEqual({})
  })
})
