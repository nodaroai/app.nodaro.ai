/**
 * Real-ffmpeg test for `extractTailToFile` (`../extract-tail.ts`).
 *
 * This repo's other real-ffmpeg tests (`trim-edge-frames.e2e.test.ts`,
 * `assemble-narrated-video.e2e.test.ts`) assume ffmpeg is present — CI
 * installs it via a dedicated step in `.github/workflows/ci.yml` — and don't
 * skip-guard (grepped this repo for `ffmpegAvailable`/`skipIf`/`which
 * ffmpeg`: no existing precedent). This test adds a minimal, synchronous
 * availability check so a local run without ffmpeg on PATH skips cleanly
 * instead of failing with a confusing spawn error.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { runFfmpeg, runFfprobe } from "../ffmpeg-utils.js"
import { extractTailArgs, extractTailToFile } from "../extract-tail.js"
import { sdrPictureFilter } from "../extend-stitch-args.js"
import { probeMatched, type MatchedProbe } from "../matched-encode.js"
import { hdrTags, writeTaggedClip } from "./colour-tagged-clip.js"

function isFfmpegAvailable(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

const ffmpegAvailable = isFfmpegAvailable()

/** Whether this ffmpeg has zscale (libzimg): the pinned build does, Homebrew's does not. */
function hasZscale(): boolean {
  try {
    return /\szscale\s/.test(execFileSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))
  } catch {
    return false
  }
}

const zscaleAvailable = ffmpegAvailable && hasZscale()
if (ffmpegAvailable && !zscaleAvailable) console.warn("[extract-tail] HDR cases skipped: this ffmpeg has no zscale filter (CI's pinned build does)")

/** An HDR source as the probe reads it: BT.2020 primaries and matrix, limited range, `transfer` (PQ or HLG). */
const hdrProbe = (transfer: string): MatchedProbe => ({
  width: 1920, height: 1080, videoCodec: "hevc", colorPrimaries: "bt2020", colorTransfer: transfer, colorSpace: "bt2020nc", colorRange: "tv",
})

describe("extractTailArgs", () => {
  /** The tail's arguments as they have always been: a re-encode of `seconds` from `start`, sound and all. */
  const PLAIN = [
    "-ss", "3.000", "-i", "/w/source.mp4", "-t", "2.000",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "20",
    "-c:a", "aac", "-movflags", "+faststart", "-y", "/w/source.mp4.tail.mp4",
  ]

  it("cuts the tail exactly as before when no picture filter is given", () => {
    expect(extractTailArgs("/w/source.mp4", 3, 2, "/w/source.mp4.tail.mp4")).toEqual(PLAIN)
  })

  // An HDR source's tail (the extend's `@video_1`, and its last frame) goes through the
  // stitch's own SDR conversion; its sound and every other setting stay as they were.
  it.each([
    ["HLG", "arib-std-b67"],
    ["PQ", "smpte2084"],
  ])("puts an %s source's picture through the stitch's SDR conversion, nothing else changed", (_label, transfer) => {
    const filter = sdrPictureFilter(hdrProbe(transfer))!
    expect(filter).toBe(
      `setparams=color_primaries=bt2020:color_trc=${transfer}:colorspace=bt2020nc:range=tv,` +
        "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0," +
        "zscale=t=bt709:m=bt709:r=tv:d=error_diffusion,format=yuv420p",
    )
    expect(extractTailArgs("/w/source.mp4", 3, 2, "/w/source.mp4.tail.mp4", filter)).toEqual([...PLAIN.slice(0, 6), "-vf", filter, ...PLAIN.slice(6)])
  })

  it("has no picture filter for an SDR or untagged source", () => {
    for (const source of [{}, { colorTransfer: "bt709" }, { colorPrimaries: "bt2020", colorTransfer: "bt2020-10" }, { colorTransfer: "unknown" }]) {
      expect(sdrPictureFilter(source)).toBeUndefined()
    }
  })
})

describe.skipIf(!ffmpegAvailable)("extractTailToFile (real ffmpeg)", () => {
  let dir: string

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "extract-tail-test-"))
  })

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  it("re-encodes the last N seconds: correct duration, decodable first frame, h264/yuv420p video", async () => {
    const src = join(dir, `${randomUUID()}.mp4`)

    // 5s test pattern video + 5s sine-tone audio, muxed into one clip.
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "testsrc=duration=5:size=320x240:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=5",
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-movflags", "+faststart",
      "-shortest",
      src,
    ])

    const out = await extractTailToFile(src, 1.0)
    expect(out).toBe(`${src}.tail.mp4`)

    // Output duration must be ~1s (0.9-1.1s tolerance).
    const durationOut = await runFfprobe([
      "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out,
    ])
    const duration = parseFloat(durationOut.trim())
    expect(duration).toBeGreaterThanOrEqual(0.9)
    expect(duration).toBeLessThanOrEqual(1.1)

    // First frame must decode cleanly — a stream-copy trim that snapped to a
    // keyframe outside the requested window can otherwise emit a file that
    // fails to decode from its start.
    expect(() =>
      execFileSync("ffmpeg", ["-i", out, "-frames:v", "1", "-f", "null", "-"], { stdio: "ignore" }),
    ).not.toThrow()

    // Video stream must be h264/yuv420p — proves it was RE-ENCODED, not
    // stream-copied (the source is already h264/yuv420p, so a stream-copy
    // would trivially "pass" a codec check; the duration + decode assertions
    // above are what actually distinguish re-encode from copy).
    const streamOut = await runFfprobe([
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,pix_fmt",
      "-of", "csv=p=0",
      out,
    ])
    const [codec, pixFmt] = streamOut.trim().toLowerCase().split(",")
    expect(codec).toBe("h264")
    expect(pixFmt).toBe("yuv420p")
  }, 60_000)

  // The HDR cases below run only where zscale exists (CI's pinned build), so their fixture is
  // checked here, on any ffmpeg: tagged HDR, as the extend reads it.
  it.each([
    ["HLG", "arib-std-b67"],
    ["PQ", "smpte2084"],
  ])("makes an %s fixture that probes as HDR, on this ffmpeg too", async (_label, transfer) => {
    const src = join(dir, `${randomUUID()}.mp4`)
    await writeTaggedClip(src, hdrTags(transfer), { size: "320x180", seconds: 1 })
    expect(await probeMatched(src)).toMatchObject({
      videoCodec: "h264", pixFmt: "yuv420p", colorPrimaries: "bt2020", colorTransfer: transfer, colorSpace: "bt2020nc", colorRange: "tv",
    })
    expect(sdrPictureFilter(await probeMatched(src))).toBeDefined()
  }, 60_000)

  it("runs the picture through `pictureFilter` when given, the sound as before", async () => {
    const src = join(dir, `${randomUUID()}.mp4`)
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
      src,
    ])
    const out = await extractTailToFile(src, 1, { measureFrom: "picture", pictureFilter: "scale=160:120" })
    const streams = (JSON.parse(await runFfprobe([
      "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height", "-of", "json", out,
    ])) as { streams: Array<Record<string, unknown>> }).streams
    expect(streams.find((st) => st.codec_type === "video")).toMatchObject({ codec_name: "h264", width: 160, height: 120 })
    expect(streams.find((st) => st.codec_type === "audio")).toMatchObject({ codec_name: "aac" })
  }, 60_000)

  // The extend's tail of an HDR source: SDR BT.709 like the stitched result, so the model continues
  // the picture the result shows. Tag-only fixtures (8-bit H.264): the tags are what the stitch reads.
  it.skipIf(!zscaleAvailable).each([
    ["HLG", "arib-std-b67"],
    ["PQ", "smpte2084"],
  ])("cuts an %s source's tail in SDR BT.709, limited range, a full second of picture with its sound", async (_label, transfer) => {
    const src = join(dir, `${randomUUID()}.mp4`)
    await writeTaggedClip(src, hdrTags(transfer), { size: "640x360", seconds: 3 })
    const source = await probeMatched(src)
    expect(source.colorTransfer).toBe(transfer)
    const out = await extractTailToFile(src, 1, { measureFrom: "picture", pictureFilter: sdrPictureFilter(source) })
    const streams = (JSON.parse(await runFfprobe([
      "-v", "error", "-count_frames",
      "-show_entries", "stream=codec_type,codec_name,pix_fmt,color_primaries,color_transfer,color_space,color_range,nb_read_frames",
      "-of", "json", out,
    ])) as { streams: Array<Record<string, unknown>> }).streams
    expect(streams.find((st) => st.codec_type === "video")).toMatchObject({
      codec_name: "h264", pix_fmt: "yuv420p", color_primaries: "bt709", color_transfer: "bt709", color_space: "bt709", color_range: "tv", nb_read_frames: "24",
    })
    expect(streams.find((st) => st.codec_type === "audio")).toMatchObject({ codec_name: "aac" })
    // A picture, not black or blown out.
    const stats = await runFfmpeg(["-v", "error", "-i", out, "-vf", "signalstats,metadata=print:file=-", "-f", "null", "-"])
    const yavg = [...stats.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)].map((m) => Number(m[1]))
    expect(yavg).toHaveLength(24)
    for (const y of yavg) {
      expect(y).toBeGreaterThan(30)
      expect(y).toBeLessThan(230)
    }
  }, 60_000)

  it("measureFrom picture: the tail ends on the last frame when the sound runs past it", async () => {
    const src = join(dir, `${randomUUID()}.mp4`)
    // 4 s of picture, 4.5 s of sound.
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "testsrc=duration=4:size=320x240:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=4.5",
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      src,
    ])
    const pictureFrames = async (file: string) =>
      Number((await runFfprobe([
        "-v", "error", "-select_streams", "v:0", "-count_frames",
        "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", file,
      ])).trim())

    // From the container's end the 1 s tail starts at 3.5 s: half of it is past the last frame.
    expect(await pictureFrames(await extractTailToFile(src, 1))).toBeLessThanOrEqual(13)
    // From the picture's end it is a full second of picture, ending on the last frame.
    expect(await pictureFrames(await extractTailToFile(src, 1, { measureFrom: "picture" }))).toBe(24)
  }, 60_000)
})
