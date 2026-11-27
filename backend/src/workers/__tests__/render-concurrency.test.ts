import { describe, expect, it } from "vitest"
import { RENDER_ENCODER_CPUS, RENDER_TAB_CAP, remotionConcurrencyFor, renderEncoderThreads, renderFfmpegArgs } from "../render-concurrency.js"

/** A file source over a fixed set of files. */
const files = (map: Record<string, string>) => (path: string) => map[path]
/** A box whose scheduler lets the process run on `cpus` CPUs, with an optional CPU quota. */
const box = (cpus: number, quota?: number) =>
  files({
    "/proc/self/status": `Name:\tnode\nCpus_allowed_list:\t0-${cpus - 1}\n`,
    "/proc/self/cgroup": "0::/\n",
    ...(quota === undefined ? {} : { "/sys/fs/cgroup/cpu.max": `${quota * 100000} 100000\n` }),
  })

const COMPOSITIONS = ["after-effects", "scene-graph", "3d-title", "shot-sequence", "burn-captions"]

describe("the tabs one render opens", () => {
  it.each([null, undefined])("bounds WebGL scene tabs when no override is configured (%s)", (configured) => {
    expect(remotionConcurrencyFor("3d-scene", configured, 32)).toBe(2)
  })

  it.each(COMPOSITIONS)("never more than the cap for %s, however many CPUs the box shows", (composition) => {
    // The renderer's own choice is half the CPUs up to 8: on 2026-11-25 two renders at 8 tabs each used every thread the container may have.
    for (const cpus of [8, 16, 32, 64, 128]) expect(remotionConcurrencyFor(composition, null, cpus)).toBe(RENDER_TAB_CAP)
  })

  it("on a small box, what the renderer would pick itself: half the CPUs, at least one", () => {
    expect(remotionConcurrencyFor("burn-captions", null, 1)).toBe(1)
    expect(remotionConcurrencyFor("burn-captions", null, 2)).toBe(1)
    expect(remotionConcurrencyFor("burn-captions", null, 3)).toBe(2)
    expect(remotionConcurrencyFor("burn-captions", null, 4)).toBe(2)
    expect(remotionConcurrencyFor("burn-captions", null, 6)).toBe(3)
    expect(remotionConcurrencyFor("burn-captions", null, 7)).toBe(4)
  })

  it("never more tabs than CPUs, which the renderer refuses", () => {
    expect(remotionConcurrencyFor("3d-scene", null, 1)).toBe(1)
    expect(remotionConcurrencyFor("3d-scene", null, 2)).toBe(2)
    for (const composition of [...COMPOSITIONS, "3d-scene"]) {
      for (const cpus of [1, 2, 3, 4, 5, 8, 48]) expect(remotionConcurrencyFor(composition, null, cpus)).toBeLessThanOrEqual(cpus)
    }
  })

  it.each([1, 4, 8, 32])("honors an operator's explicit concurrency %s", (configured) => {
    expect(remotionConcurrencyFor("3d-scene", configured, 64)).toBe(configured)
    expect(remotionConcurrencyFor("after-effects", configured, 64)).toBe(configured)
  })

  it("reads this box when no CPU count is given", () => {
    const tabs = remotionConcurrencyFor("burn-captions", null)
    expect(tabs).toBeGreaterThanOrEqual(1)
    expect(tabs).toBeLessThanOrEqual(RENDER_TAB_CAP)
  })
})

describe("the threads of one render's encoder", () => {
  it("never more than the encoder's cap, on any box", () => {
    for (const cpus of [8, 10, 16, 32, 48, 128]) {
      expect(renderEncoderThreads(box(cpus))).toEqual({ decode: RENDER_ENCODER_CPUS, filter: RENDER_ENCODER_CPUS, encode: RENDER_ENCODER_CPUS })
    }
    // A big box under a big quota: the house ceiling (16 CPUs) is itself above the cap.
    expect(renderEncoderThreads(box(64, 32))).toEqual({ decode: 8, filter: 8, encode: 8 })
  })

  it("the box's own budget when it is smaller: few CPUs, or a quota below them", () => {
    expect(renderEncoderThreads(box(4))).toEqual({ decode: 4, filter: 4, encode: 4 })
    expect(renderEncoderThreads(box(1))).toEqual({ decode: 1, filter: 1, encode: 1 })
    expect(renderEncoderThreads(box(48, 2))).toEqual({ decode: 2, filter: 2, encode: 2 })
  })
})

describe("the renderer's ffmpeg command lines", () => {
  const threads = { decode: 8, filter: 8, encode: 8 }
  // The encoder the frames are piped into, as @remotion/renderer 4.0.486 builds it (prespawn-ffmpeg.js): the frame rate is a number.
  const preStitcher = [
    "-r", 25, "-f", "image2pipe", "-s", "1080x1920", "-vcodec", "mjpeg", "-i", "-",
    "-c:v", "libx264", "-colorspace:v", "bt709", "-color_primaries:v", "bt709", "-color_trc:v", "bt709", "-color_range", "tv",
    "-vf", "zscale=matrix=709:matrixin=709:range=limited", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium",
    "-y", "/tmp/remotion-pre-encode/pre-encode.mp4",
  ]

  it("the encoder gets the render's counts: its graph, its decoder and x264", () => {
    expect(renderFfmpegArgs({ type: "pre-stitcher", args: preStitcher }, threads)).toEqual([
      "-filter_complex_threads", "8", "-filter_threads", "8",
      "-r", "25", "-f", "image2pipe", "-s", "1080x1920", "-vcodec", "mjpeg", "-threads", "8", "-i", "-",
      "-c:v", "libx264", "-colorspace:v", "bt709", "-color_primaries:v", "bt709", "-color_trc:v", "bt709", "-color_range", "tv",
      "-vf", "zscale=matrix=709:matrixin=709:range=limited", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium",
      "-y", "-threads", "8", "/tmp/remotion-pre-encode/pre-encode.mp4",
    ])
  })

  it("the final mux gets them too", () => {
    const stitcher = ["-i", "/tmp/pre-encode.mp4", "-i", "/tmp/audio.wav", "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", "-movflags", "faststart", "-y", "/tmp/out.mp4"]
    const placed = renderFfmpegArgs({ type: "stitcher", args: stitcher }, threads)
    expect(placed.filter((arg) => arg === "-threads")).toHaveLength(3)
    expect(placed.slice(-3)).toEqual(["-threads", "8", "/tmp/out.mp4"])
    // Nothing of the renderer's own command is lost or reordered.
    expect(placed.filter((arg, k) => !(arg === "-threads" || placed[k - 1] === "-threads" || arg.startsWith("-filter") || placed[k - 1]?.startsWith("-filter")))).toEqual(stitcher)
  })

  it("a command that states its own counts is left as given", () => {
    const own = ["-threads", "2", "-i", "-", "-c:v", "libx264", "-y", "/tmp/out.mp4"]
    expect(renderFfmpegArgs({ type: "pre-stitcher", args: own }, threads)).toEqual(own)
  })

  it("reads this box's counts when none are given", () => {
    const placed = renderFfmpegArgs({ type: "pre-stitcher", args: preStitcher })
    const count = Number(placed[placed.indexOf("-threads") + 1])
    expect(count).toBeGreaterThanOrEqual(1)
    expect(count).toBeLessThanOrEqual(RENDER_ENCODER_CPUS)
  })
})
