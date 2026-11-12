import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The extend stitch (`../extend-stitch.ts`): source and extension joined at
 * the source's size, frame rate and picture quality, the boundary found on two
 * small proxies by the smart-cut matcher when one is registered, else the
 * fixed trims. The ffmpeg run itself is covered by
 * `extend-stitch-output.test.ts`; here the arguments and the boundary choice.
 */

const mocks = vi.hoisted(() => ({
  runFfmpeg: vi.fn(),
  probeVideoOverlayBase: vi.fn(),
  probeAudioSampleRate: vi.fn(),
  probeMatched: vi.fn(),
  getSmartCutMatcher: vi.fn(),
}))

vi.mock("../ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ffmpeg-utils.js")>()),
  runFfmpeg: mocks.runFfmpeg,
  probeVideoOverlayBase: mocks.probeVideoOverlayBase,
  probeAudioSampleRate: mocks.probeAudioSampleRate,
}))
vi.mock("../matched-encode.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../matched-encode.js")>()),
  probeMatched: mocks.probeMatched,
}))
vi.mock("../smart-cut.js", () => ({ getSmartCutMatcher: mocks.getSmartCutMatcher }))

import { extendTailPicture, stitchExtension, type ExtendStitchArgs } from "../extend-stitch.js"
import { extendStitchArgs, stitchEncodesAtBitRate } from "../extend-stitch-args.js"
import { matchedPictureArgs, parseMatchedProbe, type MatchedProbe } from "../matched-encode.js"
import type { VideoOverlayBaseProbe } from "../ffmpeg-utils.js"
import type { SmartCutBoundary } from "../smart-cut.js"
import { defaultLaunchPeakMiB } from "../ffmpeg-admission-instance.js"

/** An 854×480 @ 24 H.264 MP4 source with AAC sound, 3 s (72 frames). */
const SOURCE: MatchedProbe = {
  width: 854,
  height: 480,
  videoCodec: "h264",
  pixFmt: "yuv420p",
  videoBitRate: 2_000_000,
  audioBitRate: 128_000,
  audioCodec: "aac",
  durationSec: 3,
  videoDurationSec: 3,
  fpsRational: "24/1",
  nominalFpsRational: "24/1",
  quickTime: false,
}

/** The same source as a Matroska/WebM stream: no length of its own, an average rate the demuxer never measured. */
const WEBM_SOURCE: MatchedProbe = { ...SOURCE, fpsRational: "30/1", nominalFpsRational: "30/1", videoDurationSec: undefined, durationSec: 4.608, quickTime: undefined }

/** A 1280×720 @ 24 extension, 2 s (48 frames), no sound. */
const EXTENSION: MatchedProbe = {
  width: 1280, height: 720, pixFmt: "yuv420p", videoBitRate: 4_000_000, durationSec: 2, videoDurationSec: 2, fpsRational: "24/1", nominalFpsRational: "24/1", quickTime: false,
}

/** An iPhone HLG clip as the probe reads it: HEVC, 10-bit, BT.2020 primaries and matrix, HLG transfer. */
const HLG_SOURCE: MatchedProbe = {
  ...SOURCE, videoCodec: "hevc", pixFmt: "yuv420p10le", colorPrimaries: "bt2020", colorTransfer: "arib-std-b67", colorSpace: "bt2020nc", colorRange: "tv",
}

/**
 * An HDR source's picture taken to SDR BT.709: its frames tagged as `tags` say, linearized,
 * tone-mapped, back to BT.709 4:2:0, error-diffusion dithered on the step down to 8 bits.
 */
const toSdr = (tags: string): string =>
  `setparams=${tags},zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,` +
  "zscale=t=bt709:m=bt709:r=tv:d=error_diffusion,format=yuv420p"

/** A full-range SDR source's picture taken to limited range: its frames tagged full range, the levels converted, 4:2:0. */
const TO_LIMITED = "setparams=range=pc,scale=out_range=tv,format=yuv420p"

/** The source's picture as the graph receives it: square pixels, no rotation. */
const SHAPE: VideoOverlayBaseProbe = { width: 854, height: 480, rotation: 0, sar: 1, streamDurationSec: 3, startTimeSec: 0, frameCount: 72, audioCodec: "aac" }

const BASE = {
  sourcePath: "/w/source.mp4",
  extensionPath: "/w/extension.mp4",
  outputPath: "/w/stitched.mp4",
  source: SOURCE,
  sourceFrames: 72,
  extensionFrames: 48,
  trimEndFrames: 4,
  trimStartFrames: 3,
  audioFadeSec: 0.15,
  sourceHasAudio: true,
  extensionHasAudio: false,
  audioSampleRate: 48_000,
}

const valueOf = (args: readonly string[], flag: string): string | undefined => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

/** The filter graph's chains, by the label each one ends with ("[sv]", "[ev]", "[sa]", "[ea]", "[a]", "[v]"). */
const chainsOf = (args: readonly string[]): Record<string, string> => {
  const graph = valueOf(args, "-filter_complex") ?? ""
  return Object.fromEntries(graph.split(";").map((c) => [c.slice(c.lastIndexOf("[")), c]))
}

const samplesIn = (chain: string, key: string): number => Number(new RegExp(`${key}=(\\d+)`).exec(chain)?.[1])

describe("extendStitchArgs", () => {
  it("the result is the source's size and frame rate", () => {
    const chains = chainsOf(extendStitchArgs(BASE))
    const extension = chains["[ev]"]!
    const source = chains["[sv]"]!
    // The extension is conformed to the source's exact rate, then covered and centre-cropped to its size.
    expect(extension.startsWith("[1:v:0]fps=24/1,")).toBe(true)
    expect(extension).toContain("scale=854:480:force_original_aspect_ratio=increase")
    expect(extension).toContain("crop=854:480")
    expect(extension).toContain("setsar=1")
    // Its start trim counts frames at the source's rate: after `fps`, never before it.
    expect(extension).toContain("trim=start_frame=3:end_frame=48")
    expect(extension.indexOf("fps=")).toBeLessThan(extension.indexOf("trim="))
    // The source is conformed to its own rate (a no-op for an even-rate clip) and held to its count, its end trimmed by frame index.
    expect(source).toBe("[0:v:0]fps=24/1,tpad=stop_mode=clone:stop=-1,trim=end_frame=68,setpts=PTS-STARTPTS[sv]")
    expect(chains["[v]"]).toBe("[sv][ev]concat=n=2:v=1:a=0[v]")
    // The conformed extension is held to its count (its last frame cloned as long as it takes),
    // so its picture always reaches the length its sound is cut to.
    expect(extension).toBe(
      "[1:v:0]fps=24/1,tpad=stop_mode=clone:stop=-1,trim=start_frame=3:end_frame=48,setpts=PTS-STARTPTS," +
        "scale=854:480:force_original_aspect_ratio=increase,crop=854:480,setsar=1[ev]",
    )
  })

  it("writes the source's rate as ffprobe read it (an NTSC fraction stays exact)", () => {
    const ntsc = { ...SOURCE, fpsRational: "30000/1001", nominalFpsRational: "30000/1001", videoDurationSec: 2.4024 }
    const chains = chainsOf(extendStitchArgs({ ...BASE, source: ntsc }))
    expect(chains["[ev]"]).toContain("fps=30000/1001,")
    expect(chains["[sv]"]).toContain("[0:v:0]fps=30000/1001,")
  })

  it("conforms both pictures to the source's nominal rate, never its average", () => {
    // A phone clip that slows for its last frames: its average is off its 30 fps grid.
    const chains = chainsOf(extendStitchArgs({ ...BASE, source: { ...SOURCE, fpsRational: "5400/187", nominalFpsRational: "30/1" } }))
    expect(chains["[sv]"]).toBe("[0:v:0]fps=30/1,tpad=stop_mode=clone:stop=-1,trim=end_frame=68,setpts=PTS-STARTPTS[sv]")
    expect(chains["[ev]"]).toContain("[1:v:0]fps=30/1,")
    // A variable rate (no constant one): its nominal rate too.
    const vfr = chainsOf(extendStitchArgs({ ...BASE, source: { ...SOURCE, fpsRational: undefined, nominalFpsRational: "60/1" } }))
    expect(vfr["[sv]"]).toContain("[0:v:0]fps=60/1,")
  })

  it("keeps a nominal rate within 1–240; any other falls to the probe's constant rate, else 30, held to 1–60", () => {
    // Only probes `parseMatchedProbe` can produce: the rate fields it reads from these r_frame_rate / avg_frame_rate.
    const sv = (r: string | undefined, avg: string | undefined) => {
      const { fpsRational, nominalFpsRational } = parseMatchedProbe(JSON.stringify({
        streams: [{ codec_type: "video", width: 854, height: 480, r_frame_rate: r, avg_frame_rate: avg }],
      }))
      return chainsOf(extendStitchArgs({ ...BASE, source: { ...SOURCE, fpsRational, nominalFpsRational } }))["[sv]"]!
    }
    // A nominal rate within 1–240 is the source's rate, kept as it is, its average aside.
    expect(sv("30/1", "5400/187")).toContain("[0:v:0]fps=30/1,")
    expect(sv("120/1", "120/1")).toContain("[0:v:0]fps=120/1,")
    expect(sv("240/1", "240/1")).toContain("[0:v:0]fps=240/1,")
    expect(sv("1/1", "1/1")).toContain("[0:v:0]fps=1/1,")
    // Below 1 (a slideshow) or above 240: the constant rate the probe reads, held to 1–60.
    expect(sv("1/2", "1/2")).toContain("[0:v:0]fps=1,")
    expect(sv("250/1", "250/1")).toContain("[0:v:0]fps=60,")
    // A nominal rate that does not read: the average, the only rate there is.
    expect(sv("0/0", "25/1")).toContain("[0:v:0]fps=25/1,")
    // No constant rate to fall to (a garbage nominal rate the average disagrees with), or none at all: 30.
    expect(sv("90000/1", "24/1")).toContain("[0:v:0]fps=30,")
    expect(sv(undefined, undefined)).toContain("[0:v:0]fps=30,")
  })

  it("conforms a Matroska/WebM source at the rate it reports", () => {
    const chains = chainsOf(extendStitchArgs({ ...BASE, source: WEBM_SOURCE }))
    expect(chains["[sv]"]).toBe("[0:v:0]fps=30/1,tpad=stop_mode=clone:stop=-1,trim=end_frame=68,setpts=PTS-STARTPTS[sv]")
    expect(chains["[ev]"]).toContain("[1:v:0]fps=30/1,tpad=stop_mode=clone:stop=-1,")
  })

  it("fits the extension to a rotated source's upright picture", () => {
    // A portrait phone clip stored 854×480 with a 90° display matrix: the graph receives it 480×854.
    const chains = chainsOf(extendStitchArgs({ ...BASE, picture: { width: 480, height: 854 } }))
    expect(chains["[ev]"]!.endsWith(",scale=480:854:force_original_aspect_ratio=increase,crop=480:854,setsar=1[ev]")).toBe(true)
    expect(chains["[sv]"]).toBe("[0:v:0]fps=24/1,tpad=stop_mode=clone:stop=-1,trim=end_frame=68,setpts=PTS-STARTPTS[sv]")
  })

  it("fits the extension to a non-square-pixel source's displayed shape, stored at the source's size and SAR", () => {
    // 720×480 at SAR 32:27 displays as 853×480 (16:9).
    const chains = chainsOf(extendStitchArgs({ ...BASE, picture: { width: 720, height: 480, sarRatio: "32/27" } }))
    expect(chains["[ev]"]!.endsWith(",scale=853:480:force_original_aspect_ratio=increase,crop=853:480,scale=720:480,setsar=32/27[ev]")).toBe(true)
  })

  it("leaves the arguments as they are for square, unrotated pixels", () => {
    expect(extendStitchArgs({ ...BASE, picture: { width: 854, height: 480 } })).toEqual(extendStitchArgs(BASE))
  })

  it("encodes at the source's bitrate in two passes with no fixed CRF", () => {
    const source = { ...SOURCE, pixFmt: "yuv444p", colorSpace: "bt709" }
    const first = extendStitchArgs({ ...BASE, source, pass: { n: 1, log: "/w/pass" } })
    const second = extendStitchArgs({ ...BASE, source, pass: { n: 2, log: "/w/pass" } })
    for (const [args, n] of [[first, "1"], [second, "2"]] as const) {
      expect(valueOf(args, "-b:v")).toBe("2000000")
      expect(valueOf(args, "-pass")).toBe(n)
      expect(valueOf(args, "-passlogfile")).toBe("/w/pass")
      // The delivered picture is 4:2:0 whatever the source's (`deliveryPicture`).
      expect(valueOf(args, "-pix_fmt")).toBe("yuv420p")
      expect(valueOf(args, "-colorspace")).toBe("bt709")
      expect(valueOf(args, "-fps_mode")).toBe("passthrough")
      expect(args).not.toContain("-crf")
    }
    // Pass 1 measures the picture alone and writes nothing; its picture graph is pass 2's.
    expect(first).toContain("-an")
    expect(first.slice(-3)).toEqual(["-f", "null", "-"])
    expect(valueOf(first, "-filter_complex")).not.toMatch(/\[a\]|acrossfade|anullsrc/)
    expect(valueOf(second, "-filter_complex")!.startsWith(`${valueOf(first, "-filter_complex")};`)).toBe(true)
    expect(second[second.length - 1]).toBe("/w/stitched.mp4")
    // An unreadable bitrate: one pass at the visually lossless constant quality.
    const fallback = extendStitchArgs({ ...BASE, source: { ...SOURCE, videoBitRate: undefined } })
    expect(valueOf(fallback, "-crf")).toBe("14")
    expect(fallback).not.toContain("-pass")
  })

  // An H.264 source's bitrate has a floor (ruling AI): 0.1 bits per pixel per frame at the
  // output's size and rate, about what CRF 18 spends on moving footage. A source below it (a
  // near-static clip, a heavily compressed upload) would otherwise starve the extension after it.
  it("raises a low-bitrate H.264 source to the floor, in both passes, and keeps a higher one's own rate", () => {
    const low = { ...SOURCE, videoBitRate: 300_000 }
    // 854 × 480 at 24 fps × 0.1 = 983,808 bits per second.
    for (const n of [1, 2] as const) {
      const args = extendStitchArgs({ ...BASE, source: low, pass: { n, log: "/w/pass" } })
      expect(valueOf(args, "-b:v")).toBe("983808")
      expect(valueOf(args, "-pass")).toBe(String(n))
      expect(args).not.toContain("-crf")
    }
    expect(stitchEncodesAtBitRate(low)).toBe(true)
    // Above the floor: its own rate, as before.
    expect(valueOf(extendStitchArgs({ ...BASE, source: { ...SOURCE, videoBitRate: 2_000_000 } }), "-b:v")).toBe("2000000")
    expect(valueOf(extendStitchArgs({ ...BASE, source: { ...SOURCE, videoBitRate: 983_809 } }), "-b:v")).toBe("983809")
    // No bitrate, or not H.264: the constant quality, no floor.
    expect(valueOf(extendStitchArgs({ ...BASE, source: { ...SOURCE, videoBitRate: undefined } }), "-crf")).toBe("14")
    expect(extendStitchArgs({ ...BASE, source: { ...low, videoCodec: "hevc" } })).not.toContain("-b:v")
  })

  it.each([
    // [width, height, nominal rate, floor]
    [1920, 1080, "30/1", 6_220_800],
    [1280, 720, "30/1", 2_764_800],
    [854, 480, "24/1", 983_808],
    [3840, 2160, "30/1", 24_883_200],
    [1920, 1080, "30000/1001", Math.round(1920 * 1080 * (30000 / 1001) * 0.1)],
    [1920, 1080, "60/1", 12_441_600],
    // At the OUTPUT rate: a slideshow below 1 fps is put on 1 fps, a 250 fps clip on 60.
    [1920, 1080, "1/2", 207_360],
    [1920, 1080, "250/1", 12_441_600],
  ] as const)("floors a %ix%i source at %s fps at %i b/s", (width, height, rate, floor) => {
    const source = { ...SOURCE, width, height, nominalFpsRational: rate, fpsRational: rate, videoBitRate: 50_000 }
    const args = extendStitchArgs({ ...BASE, source, picture: { width, height } })
    expect(valueOf(args, "-b:v")).toBe(String(floor))
  })

  // An H.264 source's bitrate carries its quality over to the H.264 delivery. Another codec's
  // does not: HEVC, VP9 and AV1 hold the same picture in fewer bits, an intra codec in far more.
  it.each(["hevc", "vp9", "av1", "prores"])("encodes a %s source in one pass at the near-lossless constant quality, never at its bitrate", (videoCodec) => {
    const source = { ...SOURCE, videoCodec, videoBitRate: 40_000_000 }
    for (const args of [extendStitchArgs({ ...BASE, source }), extendStitchArgs({ ...BASE, source, pass: { n: 2, log: "/w/pass" } })]) {
      expect(valueOf(args, "-crf")).toBe("14")
      expect(args).not.toContain("-b:v")
      expect(args).not.toContain("-pass")
      expect(args).not.toContain("-passlogfile")
      expect(valueOf(args, "-c:v")).toBe("libx264")
      expect(valueOf(args, "-pix_fmt")).toBe("yuv420p")
    }
    expect(stitchEncodesAtBitRate(source)).toBe(false)
  })

  it("keeps an H.264 source at its bitrate in two passes; one that reports no codec takes the constant quality", () => {
    expect(valueOf(extendStitchArgs(BASE), "-b:v")).toBe("2000000")
    expect(stitchEncodesAtBitRate(SOURCE)).toBe(true)
    // H.264 with no readable bitrate: the constant quality, as before.
    expect(stitchEncodesAtBitRate({ ...SOURCE, videoBitRate: undefined })).toBe(false)
    // A picture whose codec the probe did not name is not known to be H.264.
    const unnamed = { ...SOURCE, videoCodec: undefined }
    expect(valueOf(extendStitchArgs({ ...BASE, source: unnamed }), "-crf")).toBe("14")
    expect(extendStitchArgs({ ...BASE, source: unnamed })).not.toContain("-b:v")
    expect(stitchEncodesAtBitRate(unnamed)).toBe(false)
  })

  // An HDR source is delivered in SDR BT.709, the extension's own (Seedance generates SDR):
  // its picture is tone-mapped inside the one encode, the extension's left as it is.
  it.each([
    ["HLG", "arib-std-b67"],
    ["PQ", "smpte2084"],
  ])("tone-maps an %s source to SDR BT.709 and tags the result BT.709, limited range", (_label, transfer) => {
    const source = { ...HLG_SOURCE, colorTransfer: transfer }
    const args = extendStitchArgs({ ...BASE, source })
    const chains = chainsOf(args)
    expect(chains["[sv]"]).toBe(
      "[0:v:0]fps=24/1,tpad=stop_mode=clone:stop=-1,trim=end_frame=68,setpts=PTS-STARTPTS," +
        `${toSdr(`color_primaries=bt2020:color_trc=${transfer}:colorspace=bt2020nc:range=tv`)}[sv]`,
    )
    // The extension: no colour conversion.
    expect(chains["[ev]"]).toBe(chainsOf(extendStitchArgs(BASE))["[ev]"])
    expect(valueOf(args, "-pix_fmt")).toBe("yuv420p")
    expect(valueOf(args, "-color_primaries")).toBe("bt709")
    expect(valueOf(args, "-color_trc")).toBe("bt709")
    expect(valueOf(args, "-colorspace")).toBe("bt709")
    expect(valueOf(args, "-color_range")).toBe("tv")
    // Both passes of an H.264 HDR source tone-map the same picture.
    const h264 = { ...source, videoCodec: "h264" }
    const first = extendStitchArgs({ ...BASE, source: h264, pass: { n: 1, log: "/w/pass" } })
    const second = extendStitchArgs({ ...BASE, source: h264, pass: { n: 2, log: "/w/pass" } })
    expect(chainsOf(first)["[sv]"]).toBe(chains["[sv]"])
    expect(valueOf(second, "-filter_complex")!.startsWith(`${valueOf(first, "-filter_complex")};`)).toBe(true)
    expect(valueOf(first, "-color_trc")).toBe("bt709")
  })

  it("tone-maps from what an HDR source reports, BT.2020 and limited range where it reports none", () => {
    const svOf = (source: MatchedProbe) => chainsOf(extendStitchArgs({ ...BASE, source }))["[sv]"]!
    // Its own primaries, matrix and range.
    expect(svOf({ ...HLG_SOURCE, colorPrimaries: "smpte432", colorSpace: "bt2020c", colorRange: "pc" }))
      .toContain(toSdr("color_primaries=smpte432:color_trc=arib-std-b67:colorspace=bt2020c:range=pc"))
    // A transfer and nothing else (or tags that read as none): BT.2020, limited range.
    const bare = { ...SOURCE, videoCodec: "hevc", colorTransfer: "smpte2084" }
    expect(svOf(bare)).toContain(toSdr("color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc:range=tv"))
    expect(svOf({ ...bare, colorPrimaries: "unknown", colorSpace: "reserved", colorRange: "unknown" }))
      .toContain(toSdr("color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc:range=tv"))
    // A full-range (yuvj) HDR picture is read as full range; the result is limited range all the same.
    expect(svOf({ ...bare, pixFmt: "yuvj420p" })).toContain("range=pc,zscale=")
    expect(valueOf(extendStitchArgs({ ...BASE, source: { ...bare, pixFmt: "yuvj420p" } }), "-color_range")).toBe("tv")
  })

  // SDR, tagged or not: the arguments as they were, the source's own tags delivered.
  it.each([
    ["untagged", {}],
    ["BT.709", { colorPrimaries: "bt709", colorTransfer: "bt709", colorSpace: "bt709", colorRange: "tv" }],
    ["BT.601", { colorPrimaries: "smpte170m", colorTransfer: "smpte170m", colorSpace: "smpte170m", colorRange: "tv" }],
    ["BT.2020 SDR (bt2020-10 transfer)", { colorPrimaries: "bt2020", colorTransfer: "bt2020-10", colorSpace: "bt2020nc", colorRange: "tv" }],
    ["BT.2020 with an unreadable transfer", { colorPrimaries: "bt2020", colorTransfer: "unknown", colorSpace: "bt2020nc" }],
  ] as const)("leaves an SDR source (%s) as it is: no tone-map, its own colour tags", (_label, tags: Partial<MatchedProbe>) => {
    const args = extendStitchArgs({ ...BASE, source: { ...SOURCE, ...tags } })
    expect(chainsOf(args)["[sv]"]).toBe("[0:v:0]fps=24/1,tpad=stop_mode=clone:stop=-1,trim=end_frame=68,setpts=PTS-STARTPTS[sv]")
    expect(valueOf(args, "-filter_complex")).not.toMatch(/zscale|tonemap|setparams/)
    const tag = (v: string | undefined) => (v && v !== "unknown" ? v : undefined)
    expect(valueOf(args, "-color_primaries")).toBe(tag(tags.colorPrimaries))
    expect(valueOf(args, "-color_trc")).toBe(tag(tags.colorTransfer))
    expect(valueOf(args, "-colorspace")).toBe(tag(tags.colorSpace))
    expect(valueOf(args, "-color_range")).toBe(tag(tags.colorRange))
  })

  it("crossfades the sound at the join and pads a silent side", () => {
    const args = extendStitchArgs(BASE)
    const chains = chainsOf(args)
    // The picture: 68 source frames, then 45 of the extension, at 24 fps and 48 kHz.
    const sourceSamples = (68 / 24) * 48_000
    const extensionSamples = (45 / 24) * 48_000
    const fade = 0.15 * 48_000
    // The source's sound runs the fade past its picture's cut, so the extension's starts exactly on its picture.
    expect(chains["[sa]"]).toBe(`[0:a:0]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=end_sample=${sourceSamples + fade}[sa]`)
    // The silent extension: silence exactly as long as its picture.
    expect(chains["[ea]"]).toBe(`anullsrc=r=48000:cl=stereo,atrim=end_sample=${extensionSamples}[ea]`)
    expect(chains["[a]"]).toBe(`[sa][ea]acrossfade=ns=${fade}:c1=qsin:c2=qsin[a]`)
    // Sample-locked: the sound is exactly the picture's length.
    expect(samplesIn(chains["[sa]"]!, "end_sample") + samplesIn(chains["[ea]"]!, "end_sample") - fade).toBe(((68 + 45) / 24) * 48_000)
    expect(args).toContain("[a]")
    expect(valueOf(args, "-c:a")).toBe("aac")
    expect(valueOf(args, "-b:a")).toBe("128000")

    // A silent source with a sounding extension: the extension's sound starts at its start trim
    // (to the nearest sample: 3 frames at 24 fps are 5512.5 samples at 44.1 kHz).
    const reversed = chainsOf(extendStitchArgs({ ...BASE, sourceHasAudio: false, extensionHasAudio: true, audioSampleRate: 44_100 }))
    expect(reversed["[sa]"]).toBe(`anullsrc=r=44100:cl=stereo,atrim=end_sample=${124_950 + 6_615}[sa]`)
    expect(reversed["[ea]"]).toBe(
      "[1:a:0]aresample=44100,aformat=channel_layouts=stereo,atrim=start_sample=5513,asetpts=PTS-STARTPTS,apad,atrim=end_sample=82688[ea]",
    )

    // No sound on either side: none in the result.
    const silent = extendStitchArgs({ ...BASE, sourceHasAudio: false })
    expect(valueOf(silent, "-filter_complex")).not.toMatch(/\[a\]|anullsrc/)
    expect(silent).toContain("-an")
    expect(silent).not.toContain("-c:a")
  })

  it("delivers the sound as AAC at the source's bitrate, a PCM MOV source's (a chained raw clip) too", () => {
    // A chained raw MOV: AAC at the most AAC is asked for, never its PCM.
    const mov = extendStitchArgs({ ...BASE, source: { ...SOURCE, quickTime: true, audioCodec: "pcm_s24le", audioBitRate: 2_304_000 } })
    expect(valueOf(mov, "-c:a")).toBe("aac")
    expect(valueOf(mov, "-b:a")).toBe("320000")
    // A phone MOV with AAC sound: AAC at its bitrate.
    const phone = extendStitchArgs({ ...BASE, source: { ...SOURCE, quickTime: true, audioCodec: "aac", audioBitRate: 256_000 } })
    expect(valueOf(phone, "-c:a")).toBe("aac")
    expect(valueOf(phone, "-b:a")).toBe("256000")
    // PCM in an MP4 (few readers take it) is AAC too.
    expect(valueOf(extendStitchArgs({ ...BASE, source: { ...SOURCE, audioCodec: "pcm_s16le" } }), "-c:a")).toBe("aac")
    expect(valueOf(extendStitchArgs({ ...BASE, source: { ...SOURCE, audioBitRate: undefined } }), "-b:a")).toBe("192000")
  })

  // The delivered picture: what the upload takes as it is (`needsTranscode`: H.264 yuv420p),
  // so it is never encoded a second time; the source's colour tags ride along.
  it.each([
    ["yuv420p", "yuv420p"],
    ["yuv422p", "yuv420p"],
    ["yuv444p", "yuv420p"],
    ["yuv420p10le", "yuv420p"],
    ["yuv444p10le", "yuv420p"],
    ["yuvj420p", "yuv420p"],
    [undefined, "yuv420p"],
  ])("delivers H.264 %s as %s, keeping the source's colour tags", (pixFmt, delivered) => {
    const source = { ...SOURCE, pixFmt, colorSpace: "bt709", colorPrimaries: "bt709", colorTransfer: "bt709", colorRange: "tv" }
    const args = extendStitchArgs({ ...BASE, source })
    expect(valueOf(args, "-c:v")).toBe("libx264")
    expect(valueOf(args, "-pix_fmt")).toBe(delivered)
    expect(valueOf(args, "-colorspace")).toBe("bt709")
    expect(valueOf(args, "-color_primaries")).toBe("bt709")
    expect(valueOf(args, "-color_trc")).toBe("bt709")
    expect(valueOf(args, "-color_range")).toBe("tv")
  })

  it("delivers a full-range source as limited range (tv), its levels converted in the one encode", () => {
    const tagOf = (source: MatchedProbe) => valueOf(extendStitchArgs({ ...BASE, source }), "-color_range")
    // Full range probes as yuvj420p, which the upload would encode again: delivered tv instead.
    expect(tagOf({ ...SOURCE, pixFmt: "yuvj420p", colorRange: "pc" })).toBe("tv")
    // A yuvj source that reports no range is full range all the same.
    expect(tagOf({ ...SOURCE, pixFmt: "yuvj420p" })).toBe("tv")
    expect(tagOf({ ...SOURCE, pixFmt: "yuvj444p" })).toBe("tv")
    expect(tagOf({ ...SOURCE, pixFmt: "yuv420p", colorRange: "pc" })).toBe("tv")
    // A limited-range source keeps its tag; one that reports no range gets none, as before.
    expect(tagOf({ ...SOURCE, colorRange: "tv" })).toBe("tv")
    expect(tagOf(SOURCE)).toBeUndefined()
    expect(tagOf({ ...SOURCE, colorRange: "unknown" })).toBeUndefined()
    for (const source of [{ ...SOURCE, pixFmt: "yuvj420p" }, { ...SOURCE, pixFmt: "yuvj444p", colorRange: "pc" }]) {
      expect(valueOf(extendStitchArgs({ ...BASE, source }), "-pix_fmt")).toBe("yuv420p")
    }
  })

  // A full-range SDR source's picture is taken to limited range in its own chain, as an HDR
  // source's is taken to SDR, so the boundary proxy, the encode and the extend's tail all read
  // the same limited-range picture. The extension (limited range, as Seedance returns it) is left as it is.
  it.each<[string, Partial<MatchedProbe>]>([
    ["yuvj420p, pc", { pixFmt: "yuvj420p", colorRange: "pc" }],
    ["yuvj420p reporting no range", { pixFmt: "yuvj420p" }],
    ["yuvj444p", { pixFmt: "yuvj444p" }],
    ["yuv420p, pc", { colorRange: "pc" }],
  ])("takes a full-range SDR source (%s) to limited range in its own picture chain", (_label, range) => {
    const args = extendStitchArgs({ ...BASE, source: { ...SOURCE, colorPrimaries: "bt709", colorTransfer: "bt709", colorSpace: "bt709", ...range } })
    const chains = chainsOf(args)
    expect(chains["[sv]"]).toBe(`[0:v:0]fps=24/1,tpad=stop_mode=clone:stop=-1,trim=end_frame=68,setpts=PTS-STARTPTS,${TO_LIMITED}[sv]`)
    expect(valueOf(args, "-filter_complex")).not.toMatch(/zscale|tonemap/)
    expect(chains["[ev]"]).toBe(chainsOf(extendStitchArgs(BASE))["[ev]"])
    // Delivered limited range, its own colour otherwise.
    expect(valueOf(args, "-pix_fmt")).toBe("yuv420p")
    expect(valueOf(args, "-color_range")).toBe("tv")
    expect(valueOf(args, "-colorspace")).toBe("bt709")
  })

  it("leaves the shared matched encode's pixel-format rule as it is (the reference re-encode keeps 4:4:4)", () => {
    expect(valueOf(matchedPictureArgs({ ...SOURCE, pixFmt: "yuv444p" }), "-pix_fmt")).toBe("yuv444p")
    expect(valueOf(matchedPictureArgs({ ...SOURCE, pixFmt: "yuv422p" }), "-pix_fmt")).toBe("yuv422p")
  })

  it("asks AAC for no more than 320 kb/s, whatever the source's sound ran at (PCM in an MP4)", () => {
    const pcm = extendStitchArgs({ ...BASE, source: { ...SOURCE, audioCodec: "pcm_s16le", audioBitRate: 1_536_000 } })
    expect(valueOf(pcm, "-c:a")).toBe("aac")
    expect(valueOf(pcm, "-b:a")).toBe("320000")
    expect(valueOf(extendStitchArgs({ ...BASE, source: { ...SOURCE, audioBitRate: 320_000 } }), "-b:a")).toBe("320000")
  })

  it("lines each sound up with its own picture when the two start apart, before cutting it", () => {
    const sa = (source: number, extension = 0) =>
      chainsOf(extendStitchArgs({ ...BASE, extensionHasAudio: true, soundOffsetSec: { source, extension } }))
    const end = `apad,atrim=end_sample=${(68 / 24) * 48_000 + 0.15 * 48_000}[sa]`
    // The source's sound starts 0.5 s after its picture: that much silence ahead of it.
    expect(sa(0.5)["[sa]"]).toBe(`[0:a:0]aresample=48000,aformat=channel_layouts=stereo,adelay=24000S:all=1,${end}`)
    // Its picture starts 2 frames after its sound: the sound's head before the picture is dropped.
    expect(sa(-2 / 24)["[sa]"]).toBe(`[0:a:0]aresample=48000,aformat=channel_layouts=stereo,atrim=start_sample=4000,asetpts=PTS-STARTPTS,${end}`)
    // The extension's sound the same way, before its start trim.
    expect(sa(0, 0.5)["[ea]"]).toBe(
      "[1:a:0]aresample=48000,aformat=channel_layouts=stereo,adelay=24000S:all=1," +
        "atrim=start_sample=6000,asetpts=PTS-STARTPTS,apad,atrim=end_sample=90000[ea]",
    )
    expect(sa(0, -2 / 24)["[ea]"]).toBe(
      "[1:a:0]aresample=48000,aformat=channel_layouts=stereo,atrim=start_sample=4000,asetpts=PTS-STARTPTS," +
        "atrim=start_sample=6000,asetpts=PTS-STARTPTS,apad,atrim=end_sample=90000[ea]",
    )
    // Starting together (or a side with no sound): the arguments as they are.
    expect(extendStitchArgs({ ...BASE, soundOffsetSec: { source: 0, extension: 0 } })).toEqual(extendStitchArgs(BASE))
    expect(extendStitchArgs({ ...BASE, soundOffsetSec: { source: 1e-6, extension: 0.25 } })).toEqual(extendStitchArgs(BASE))
  })

  it("joins the sound without a crossfade when there is no fade", () => {
    const chains = chainsOf(extendStitchArgs({ ...BASE, audioFadeSec: 0 }))
    expect(chains["[a]"]).toBe("[sa][ea]concat=n=2:v=0:a=1[a]")
    expect(samplesIn(chains["[sa]"]!, "end_sample")).toBe((68 / 24) * 48_000)
  })
})

describe("stitchExtension", () => {
  const ARGS: ExtendStitchArgs = {
    sourcePath: "/w/source.mp4",
    extensionPath: "/w/extension.mp4",
    workDir: "/w",
    smartCut: { framesFromPrev: 8, framesFromNext: 8 },
    fallbackTrims: { trimEndFrames: 4, trimStartFrames: 3 },
    audioFadeSec: 0.15,
  }

  const cut = (over: Partial<SmartCutBoundary>): SmartCutBoundary => ({
    trimEndFrames: 2, trimStartFrames: 5, psnr: 41.234, matched: true, searchedPrevFrames: 8, searchedNextFrames: 8, ...over,
  })

  /** Every ffmpeg the stitch ran, in order. */
  const ffmpegRuns = (): string[][] => mocks.runFfmpeg.mock.calls.map((c) => c[0] as string[])
  /** The final encode's filter graph, by chain. */
  const encodeChains = () => chainsOf(ffmpegRuns().at(-1)!)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.runFfmpeg.mockResolvedValue("")
    mocks.probeMatched.mockImplementation(async (p: string) => (p === ARGS.extensionPath ? EXTENSION : SOURCE))
    mocks.probeVideoOverlayBase.mockResolvedValue(SHAPE)
    mocks.probeAudioSampleRate.mockResolvedValue(48_000)
    mocks.getSmartCutMatcher.mockReturnValue(null)
  })

  it("applies the matcher's trims when it matches, else the fixed trims", async () => {
    const matcher = vi.fn().mockResolvedValue(cut({}))
    mocks.getSmartCutMatcher.mockReturnValue(matcher)
    const matched = await stitchExtension(ARGS)
    expect(matched.boundary).toEqual({ matched: true, psnrDb: 41.23, trimEndFrames: 2, trimStartFrames: 5, searchedPrevFrames: 8, searchedNextFrames: 8 })
    expect(matched.outputPath).toBe("/w/stitched.mp4")
    expect(encodeChains()["[sv]"]).toContain("trim=end_frame=70,")
    expect(encodeChains()["[ev]"]).toContain("trim=start_frame=5:end_frame=48,")
    // The matcher searched two small proxies: the source's last 8 frames and the
    // extension's first 8, both at the source's size and rate, as the stitch reads them.
    expect(matcher).toHaveBeenCalledWith("/w/stitch-prev.mp4", "/w/stitch-next.mp4", 8, 8, "best-pair")
    const [prevProxy, nextProxy] = ffmpegRuns()
    expect(valueOf(prevProxy!, "-vf")).toBe("fps=24/1,tpad=stop_mode=clone:stop=-1,trim=start_frame=64:end_frame=72,setpts=PTS-STARTPTS")
    expect(valueOf(nextProxy!, "-vf")).toBe(
      "fps=24/1,tpad=stop_mode=clone:stop=-1,trim=end_frame=8,setpts=PTS-STARTPTS,scale=854:480:force_original_aspect_ratio=increase,crop=854:480,setsar=1",
    )
    expect(prevProxy!.at(-1)).toBe("/w/stitch-prev.mp4")
    expect(nextProxy!.at(-1)).toBe("/w/stitch-next.mp4")

    // No genuine match: the fixed trims, with what the search found.
    matcher.mockResolvedValue(cut({ matched: false, psnr: 12.5 }))
    const unmatched = await stitchExtension(ARGS)
    expect(unmatched.boundary).toEqual({ matched: false, psnrDb: 12.5, trimEndFrames: 4, trimStartFrames: 3, searchedPrevFrames: 8, searchedNextFrames: 8 })
    expect(encodeChains()["[sv]"]).toContain("trim=end_frame=68,")
    expect(encodeChains()["[ev]"]).toContain("trim=start_frame=3:end_frame=48,")

    // Identical frames score 100 dB, as combineVideos reports them.
    matcher.mockResolvedValue(cut({ psnr: Infinity }))
    expect((await stitchExtension(ARGS)).boundary.psnrDb).toBe(100)
  })

  it("keeps the fixed trims, and still stitches, when there is no matcher or the search fails", async () => {
    const fixed = { matched: false, psnrDb: null, trimEndFrames: 4, trimStartFrames: 3, searchedPrevFrames: null, searchedNextFrames: null }
    // No matcher registered (community / business, or an older plugin): no proxies either.
    expect((await stitchExtension(ARGS)).boundary).toEqual(fixed)
    expect(ffmpegRuns().map((a) => valueOf(a, "-pass"))).toEqual(["1", "2"])

    // The matcher throws.
    mocks.getSmartCutMatcher.mockReturnValue(vi.fn().mockRejectedValue(new Error("search failed")))
    mocks.runFfmpeg.mockClear()
    expect((await stitchExtension(ARGS)).boundary).toEqual(fixed)
    expect(encodeChains()["[sv]"]).toContain("trim=end_frame=68,")

    // A proxy cannot be made.
    const matcher = vi.fn()
    mocks.getSmartCutMatcher.mockReturnValue(matcher)
    mocks.runFfmpeg.mockReset().mockRejectedValueOnce(new Error("ffmpeg failed")).mockResolvedValue("")
    expect((await stitchExtension(ARGS)).boundary).toEqual(fixed)
    expect(matcher).not.toHaveBeenCalled()

    // No smart cut asked for: the matcher is never consulted.
    mocks.getSmartCutMatcher.mockClear()
    expect((await stitchExtension({ ...ARGS, smartCut: undefined })).boundary).toEqual(fixed)
    expect(mocks.getSmartCutMatcher).not.toHaveBeenCalled()
  })

  it("runs pass 1 only with a bitrate, its log in the work dir, and always delivers an MP4", async () => {
    await stitchExtension(ARGS)
    const [first, second] = ffmpegRuns()
    expect(valueOf(first!, "-passlogfile")).toBe("/w/stitch-pass")
    expect(valueOf(second!, "-passlogfile")).toBe("/w/stitch-pass")
    // Admitted at a two-input encode's predicted memory.
    expect(mocks.runFfmpeg.mock.calls[1]![2]).toEqual({ peakMemoryMiB: expect.any(Number) })

    // A QuickTime source still gives an MP4 (what the upload stores and browsers play).
    mocks.runFfmpeg.mockClear()
    mocks.probeMatched.mockImplementation(async (p: string) => (p === ARGS.extensionPath ? EXTENSION : { ...SOURCE, videoBitRate: undefined, quickTime: true }))
    const mov = await stitchExtension({ ...ARGS, smartCut: undefined })
    expect(mov.outputPath).toBe("/w/stitched.mp4")
    expect(ffmpegRuns()).toHaveLength(1)
    expect(ffmpegRuns()[0]!.at(-1)).toBe("/w/stitched.mp4")
    expect(valueOf(ffmpegRuns()[0]!, "-movflags")).toBe("+faststart")
    expect(valueOf(ffmpegRuns()[0]!, "-crf")).toBe("14")
  })

  it("encodes a source that is not H.264 in one pass at the constant quality, its bitrate aside", async () => {
    mocks.probeMatched.mockImplementation(async (p: string) =>
      p === ARGS.extensionPath ? EXTENSION : { ...SOURCE, videoCodec: "hevc", videoBitRate: 12_000_000 })
    await stitchExtension({ ...ARGS, smartCut: undefined })
    expect(ffmpegRuns()).toHaveLength(1)
    const [only] = ffmpegRuns()
    expect(valueOf(only!, "-crf")).toBe("14")
    expect(only).not.toContain("-pass")
    expect(only).not.toContain("-b:v")
    expect(only!.at(-1)).toBe("/w/stitched.mp4")
  })

  it("makes an HDR source's boundary proxy as the stitch reads it, tone-mapped; the extension's as it is", async () => {
    const matcher = vi.fn().mockResolvedValue(cut({}))
    mocks.getSmartCutMatcher.mockReturnValue(matcher)
    mocks.probeMatched.mockImplementation(async (p: string) => (p === ARGS.extensionPath ? EXTENSION : HLG_SOURCE))
    await stitchExtension(ARGS)
    const sdr = toSdr("color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc:range=tv")
    const [prevProxy, nextProxy] = ffmpegRuns()
    expect(valueOf(prevProxy!, "-vf")).toBe(`fps=24/1,tpad=stop_mode=clone:stop=-1,trim=start_frame=64:end_frame=72,setpts=PTS-STARTPTS,${sdr}`)
    expect(valueOf(nextProxy!, "-vf")).not.toMatch(/zscale|tonemap|setparams/)
    expect(encodeChains()["[sv]"]).toContain(`,${sdr}[sv]`)
    // An HEVC source: the one constant-quality encode after the two proxies.
    expect(ffmpegRuns()).toHaveLength(3)
  })

  // The matcher compares the proxies' raw planes: a full-range source's proxy at full range
  // never scores against the extension's limited-range frames.
  it("makes a full-range source's boundary proxy limited range, as the stitch reads it; the extension's as it is", async () => {
    const matcher = vi.fn().mockResolvedValue(cut({}))
    mocks.getSmartCutMatcher.mockReturnValue(matcher)
    mocks.probeMatched.mockImplementation(async (p: string) => (p === ARGS.extensionPath ? EXTENSION : { ...SOURCE, pixFmt: "yuvj420p", colorRange: "pc" }))
    await stitchExtension(ARGS)
    const [prevProxy, nextProxy] = ffmpegRuns()
    expect(valueOf(prevProxy!, "-vf")).toBe(`fps=24/1,tpad=stop_mode=clone:stop=-1,trim=start_frame=64:end_frame=72,setpts=PTS-STARTPTS,${TO_LIMITED}`)
    expect(valueOf(nextProxy!, "-vf")).not.toMatch(/setparams|out_range/)
    expect(encodeChains()["[sv]"]).toContain(`,${TO_LIMITED}[sv]`)
  })

  it("admits an HDR source's stitch with its tone-map's buffers on top: about 72 MiB per megapixel", async () => {
    const uhd = { width: 3840, height: 2160 }
    mocks.probeVideoOverlayBase.mockResolvedValue({ ...SHAPE, ...uhd })
    const peakOf = async (source: MatchedProbe) => {
      mocks.runFfmpeg.mockClear()
      mocks.probeMatched.mockImplementation(async (p: string) => (p === ARGS.extensionPath ? EXTENSION : { ...source, ...uhd }))
      await stitchExtension({ ...ARGS, smartCut: undefined })
      const peaks = mocks.runFfmpeg.mock.calls.map((c) => (c[2] as { peakMemoryMiB: number }).peakMemoryMiB)
      expect(new Set(peaks).size).toBe(1)
      return peaks[0]!
    }
    const sdr = await peakOf({ ...SOURCE, videoCodec: "hevc" })
    const hdr = await peakOf(HLG_SOURCE)
    expect(hdr - sdr).toBeGreaterThanOrEqual(Math.floor(8.2944 * 72))
    expect(hdr - sdr).toBeLessThanOrEqual(Math.ceil(8.2944 * 72))
  })

  it("conforms a source with no constant rate to its nominal rate, counted at that rate, as combineVideos does", async () => {
    mocks.probeMatched.mockImplementation(async (p: string) =>
      p === ARGS.extensionPath ? EXTENSION : { ...SOURCE, fpsRational: undefined, nominalFpsRational: "30/1" })
    await stitchExtension({ ...ARGS, smartCut: undefined })
    // 3 s and 2 s of picture at 30 fps.
    expect(encodeChains()["[sv]"]).toBe("[0:v:0]fps=30/1,tpad=stop_mode=clone:stop=-1,trim=end_frame=86,setpts=PTS-STARTPTS[sv]")
    expect(encodeChains()["[ev]"]).toContain("[1:v:0]fps=30/1,tpad=stop_mode=clone:stop=-1,trim=start_frame=3:end_frame=60,")
  })

  it("counts a source's frames from the length it reports (the stream's own, else the container's)", async () => {
    mocks.probeMatched.mockImplementation(async (p: string) => (p === ARGS.extensionPath ? EXTENSION : WEBM_SOURCE))
    await stitchExtension({ ...ARGS, smartCut: undefined })
    // 4.608 s at 30 fps is 138 frames; 2 s of extension is 60.
    expect(encodeChains()["[sv]"]).toBe("[0:v:0]fps=30/1,tpad=stop_mode=clone:stop=-1,trim=end_frame=134,setpts=PTS-STARTPTS[sv]")
    expect(encodeChains()["[ev]"]).toContain("trim=start_frame=3:end_frame=60,")
    // A picture that must be counted from its length and reports none fails, loudly, before encoding.
    mocks.runFfmpeg.mockClear()
    mocks.probeMatched.mockImplementation(async (p: string) => (p === ARGS.extensionPath ? EXTENSION : { ...WEBM_SOURCE, durationSec: undefined }))
    await expect(stitchExtension(ARGS)).rejects.toThrow(/source reports no length/)
    expect(mocks.runFfmpeg).not.toHaveBeenCalled()
  })

  it("says, in its own words, when the source's picture cannot be read for its shape", async () => {
    const { DeterministicJobError } = await import("../../../lib/deterministic-job-error.js")
    mocks.probeVideoOverlayBase.mockRejectedValue(new DeterministicJobError("The base input is not a video"))
    const failure = stitchExtension(ARGS)
    await expect(failure).rejects.toThrow("Extend stitch: the source's picture could not be read")
    await expect(failure).rejects.not.toThrow(/base input/)
    expect(mocks.runFfmpeg).not.toHaveBeenCalled()
  })

  it("lines each sound up with its picture from where the probe says each stream starts", async () => {
    mocks.probeMatched.mockImplementation(async (p: string) =>
      p === ARGS.extensionPath
        ? { ...EXTENSION, audioCodec: "aac", videoStartSec: 0.5, audioStartSec: 0 }
        : { ...SOURCE, videoStartSec: 0, audioStartSec: 0.5 })
    await stitchExtension({ ...ARGS, smartCut: undefined })
    expect(encodeChains()["[sa]"]).toContain(",adelay=24000S:all=1,")
    expect(encodeChains()["[ea]"]).toContain(",atrim=start_sample=24000,asetpts=PTS-STARTPTS,atrim=start_sample=6000,")
  })

  it("fits the extension to the source as the graph receives it: upright, at its SAR", async () => {
    mocks.probeVideoOverlayBase.mockResolvedValue({ ...SHAPE, width: 480, height: 854, rotation: 90 })
    await stitchExtension({ ...ARGS, smartCut: undefined })
    expect(encodeChains()["[ev]"]).toContain(",crop=480:854,setsar=1[ev]")
    mocks.probeVideoOverlayBase.mockResolvedValue({ ...SHAPE, width: 720, height: 480, sar: 32 / 27, sarRatio: "32/27" })
    await stitchExtension({ ...ARGS, smartCut: undefined })
    expect(encodeChains()["[ev]"]).toContain(",crop=853:480,scale=720:480,setsar=32/27[ev]")
    expect(mocks.probeVideoOverlayBase).toHaveBeenCalledWith(ARGS.sourcePath)
  })

  it("skips a trim that would leave a side with no picture, as trimEdgeFrames does", async () => {
    mocks.probeMatched.mockImplementation(async (p: string) =>
      p === ARGS.extensionPath
        ? { ...EXTENSION, videoDurationSec: 3 / 24 }
        : { ...SOURCE, videoDurationSec: 4 / 24 })
    const { boundary } = await stitchExtension({ ...ARGS, smartCut: undefined })
    expect(boundary).toMatchObject({ trimEndFrames: 0, trimStartFrames: 0 })
    expect(encodeChains()["[sv]"]).toContain("trim=end_frame=4,")
    expect(encodeChains()["[ev]"]).toContain("trim=end_frame=3,")
  })

  it("fails on an extension with no video stream, before encoding", async () => {
    mocks.probeMatched.mockImplementation(async (p: string) => (p === ARGS.extensionPath ? {} : SOURCE))
    await expect(stitchExtension(ARGS)).rejects.toThrow(/extension has no video stream/)
    expect(mocks.runFfmpeg).not.toHaveBeenCalled()
  })
})

describe("extendTailPicture", () => {
  const uhd = { width: 3840, height: 2160 }

  // The extend's generation inputs (the `@video_1` tail, and the last frame taken from it) of an
  // HDR source go through the stitch's own SDR conversion, so the model continues the picture the
  // result shows and the boundary match compares like with like.
  it.each([
    ["HLG", "arib-std-b67"],
    ["PQ", "smpte2084"],
  ])("cuts an %s source's tail through the stitch's own SDR conversion, admitted at the default plus the tone-map's buffers", (_label, transfer) => {
    const source = { ...HLG_SOURCE, ...uhd, colorTransfer: transfer }
    const tail = extendTailPicture(source)
    expect(tail.pictureFilter).toBe(toSdr(`color_primaries=bt2020:color_trc=${transfer}:colorspace=bt2020nc:range=tv`))
    // Exactly the picture the stitch delivers the source as.
    expect(chainsOf(extendStitchArgs({ ...BASE, source }))["[sv]"]!.endsWith(`,${tail.pictureFilter}[sv]`)).toBe(true)
    // What a tail cut reserves today (the default launch), plus the tone-map's buffers: about 597 MiB at 4K.
    expect(tail.launch!.peakMemoryMiB - defaultLaunchPeakMiB()).toBe(Math.ceil(8.2944 * 72))
  })

  // A full-range SDR source's tail goes through the stitch's own conversion to limited range,
  // so the model is given the picture the result shows. No tone-map: no estimate of its own.
  it("cuts a full-range SDR source's tail to limited range, the stitch's own conversion, at the default launch", () => {
    for (const source of [
      { ...SOURCE, pixFmt: "yuvj420p", colorRange: "pc" },
      { ...SOURCE, pixFmt: "yuvj420p" },
      { ...SOURCE, colorRange: "pc" },
      { ...SOURCE, ...uhd, pixFmt: "yuvj420p", colorPrimaries: "bt709", colorTransfer: "bt709", colorSpace: "bt709", colorRange: "pc" },
    ]) {
      const tail = extendTailPicture(source)
      expect(tail).toEqual({ pictureFilter: TO_LIMITED })
      // Exactly the picture the stitch delivers the source as.
      expect(chainsOf(extendStitchArgs({ ...BASE, source }))["[sv]"]!.endsWith(`,${tail.pictureFilter}[sv]`)).toBe(true)
    }
    // An HDR source read as full range is tone-mapped as before, its range in the tone-map's tags.
    const hdr = extendTailPicture({ ...HLG_SOURCE, ...uhd, pixFmt: "yuvj420p", colorRange: "pc" })
    expect(hdr.pictureFilter).toBe(toSdr("color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc:range=pc"))
    expect(hdr.launch!.peakMemoryMiB - defaultLaunchPeakMiB()).toBe(Math.ceil(8.2944 * 72))
  })

  it("leaves a limited-range SDR or untagged source's tail as it always was: no filter, no estimate of its own", () => {
    for (const source of [
      SOURCE,
      {},
      { ...SOURCE, colorPrimaries: "bt709", colorTransfer: "bt709", colorSpace: "bt709", colorRange: "tv" },
      { ...SOURCE, colorPrimaries: "bt2020", colorTransfer: "bt2020-10", colorSpace: "bt2020nc" },
      { ...SOURCE, colorTransfer: "unknown" },
    ]) {
      expect(extendTailPicture(source)).toEqual({})
    }
  })
})
