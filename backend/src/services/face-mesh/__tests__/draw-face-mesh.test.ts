/**
 * The face mesh on real clips — real ffmpeg, real onnxruntime-node, the pinned
 * models. The faces: Speaker Frames' parity fixture (26 frames of four seated
 * people, 960 × 540, `../../face-detect/__tests__/fixtures/README.md`); the
 * rest is drawn by ffmpeg's own sources (`testsrc2`, a sine tone, a black or
 * white mask), so nothing else is committed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { drawFaceMeshVideo, buildFaceMeshEncodeArgs, clipColourOf, FaceMeshInputError } from "../draw-face-mesh.js"
import { releaseFaceMeshSession } from "../face-mesh-session.js"
import { releaseYunetSession } from "../../face-detect/yunet-session.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const FACES = join(HERE, "..", "..", "face-detect", "__tests__", "fixtures", "rt4k-540p2-gop.mp4")
const OFF = { minFaceHeightPct: 0, maxFaceHeightPct: 0, zone: null }

let dir: string
const ff = (...args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args])
const probe = (path: string, entries: string) =>
  execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", entries, "-of", "csv=p=0", path]).toString().trim()
const frames = (path: string) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-count_packets", "-select_streams", "v:0", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", path]).toString().trim())
const audioMd5 = (path: string) => execFileSync("ffmpeg", ["-v", "error", "-i", path, "-map", "0:a", "-c", "copy", "-f", "md5", "-"]).toString().trim()
/** A solid mask clip of `n` frames at 2 fps, 960 × 540. */
const maskClip = (name: string, color: "black" | "white", n: number) => {
  const out = join(dir, name)
  ff("-f", "lavfi", "-i", `color=${color}:s=960x540:r=2`, "-frames:v", String(n), "-c:v", "libx264", "-pix_fmt", "yuv420p", out)
  return out
}
/** A frame of a clip at time `t`, packed RGB. */
function frameAt(path: string, t: number): { rgb: Buffer; w: number; h: number } {
  const [w, h] = probe(path, "stream=width,height").split(",").map(Number)
  const rgb = execFileSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { maxBuffer: 1e8 })
  return { rgb, w: w!, h: h! }
}
/** Pixels of `drawn` at time `t` more than 25 levels darker than the same pixel of `source` (the lines, above the codec's noise). */
function darkenedPixels(drawn: string, source: string, t: number): number {
  const a = frameAt(drawn, t)
  const b = frameAt(source, t)
  let n = 0
  for (let i = 0; i < a.w * a.h; i++) {
    const la = 0.2126 * a.rgb[3 * i]! + 0.7152 * a.rgb[3 * i + 1]! + 0.0722 * a.rgb[3 * i + 2]!
    const lb = 0.2126 * b.rgb[3 * i]! + 0.7152 * b.rgb[3 * i + 1]! + 0.0722 * b.rgb[3 * i + 2]!
    if (lb - la > 25) n++
  }
  return n
}
/** Pixels of a frame with a strong blue or green cast (the former line colours) at time `t`. */
function bluePixels(path: string, t: number): number {
  const { rgb, w, h } = frameAt(path, t)
  let n = 0
  for (let i = 0; i < w * h; i++) {
    const r = rgb[3 * i]!, g = rgb[3 * i + 1]!, b = rgb[3 * i + 2]!
    if ((b > 150 && b > r + 60 && b > g + 30) || (g > 150 && g > r + 60 && g > b + 60)) n++
  }
  return n
}
/** Every frame of a clip, packed RGB, none dropped or doubled. */
function framesOf(path: string): { w: number; h: number; frames: Buffer[] } {
  const [w, h] = probe(path, "stream=width,height").split(",").map(Number)
  const all = execFileSync("ffmpeg", ["-v", "error", "-i", path, "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { maxBuffer: 1e9 })
  const size = w! * h! * 3
  return { w: w!, h: h!, frames: Array.from({ length: all.length / size }, (_, i) => all.subarray(i * size, (i + 1) * size)) }
}
/**
 * Per frame, the pixels of `drawn` whose luminance is more than 25 levels from
 * the same frame of `source` (inside `box`, pixels, when given): the lines —
 * the drawer changes nothing else, so a frame without lines has none, and a
 * frame that is not its own source's has thousands.
 */
function changedPerFrame(drawn: string, source: string, box?: { x0: number; y0: number; x1: number; y1: number }): number[] {
  const a = framesOf(drawn)
  const b = framesOf(source)
  expect(a.frames).toHaveLength(b.frames.length)
  const luma = (rgb: Buffer, i: number) => 0.2126 * rgb[3 * i]! + 0.7152 * rgb[3 * i + 1]! + 0.0722 * rgb[3 * i + 2]!
  const { x0, y0, x1, y1 } = box ?? { x0: 0, y0: 0, x1: a.w, y1: a.h }
  return a.frames.map((fa, f) => {
    let n = 0
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (Math.abs(luma(fa, y * a.w + x) - luma(b.frames[f]!, y * a.w + x)) > 25) n++
    return n
  })
}
/** The frames of `drawn` with lines (two small faces' lines change 1,200 pixels or more; a frame with none changes none). */
function framesWithLines(drawn: string, source: string): number[] {
  const changed = changedPerFrame(drawn, source)
  // Nothing in between: a frame either carries both faces' lines or is its own source's.
  for (const n of changed) expect(n < 50 || n > 500, `a frame changed in ${n} pixels`).toBe(true)
  return changed.flatMap((n, f) => (n > 500 ? [f] : []))
}
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "face-mesh-test-"))
})
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true })
  await releaseFaceMeshSession()
  await releaseYunetSession()
})

describe("drawFaceMeshVideo", () => {
  it("draws the faces it finds, keeping the clip's frame count, size and rate", async () => {
    const out = join(dir, "faces.mp4")
    const r = await drawFaceMeshVideo({ videoPath: FACES, drawOnPath: FACES, filters: OFF, outputPath: out })
    expect(r.frames).toBe(26)
    expect(frames(out)).toBe(26)
    expect(probe(out, "stream=width,height,r_frame_rate")).toBe("960,540,2/1")
    expect([r.width, r.height]).toEqual([960, 540])
    expect(r.facesDrawn).toBeGreaterThanOrEqual(26) // several faces a frame
    expect(r.framesWithFaces).toBeGreaterThan(20)
    // Gray lines: the faces darkened where they run, and no blue or green drawn.
    expect(darkenedPixels(out, FACES, 3)).toBeGreaterThan(200)
    expect(bluePixels(out, 3)).toBeLessThanOrEqual(bluePixels(FACES, 3))
  }, 120_000)

  it("parts: the eye and lip outlines alone, or the lip outline alone — the same faces, fewer lines drawn on them", async () => {
    const full = await drawFaceMeshVideo({ videoPath: FACES, drawOnPath: FACES, filters: OFF, outputPath: join(dir, "parts-full.mp4") })
    const features = await drawFaceMeshVideo({ videoPath: FACES, drawOnPath: FACES, parts: "features", filters: OFF, outputPath: join(dir, "parts-features.mp4") })
    const mouth = await drawFaceMeshVideo({ videoPath: FACES, drawOnPath: FACES, parts: "mouth", filters: OFF, outputPath: join(dir, "parts-mouth.mp4") })
    // The same faces found and drawn on, frame for frame.
    for (const r of [features, mouth]) {
      expect([r.frames, r.framesWithFaces, r.facesDrawn]).toEqual([full.frames, full.framesWithFaces, full.facesDrawn])
      expect(frames(join(dir, r === features ? "parts-features.mp4" : "parts-mouth.mp4"))).toBe(26)
    }
    const drawnFull = darkenedPixels(join(dir, "parts-full.mp4"), FACES, 3)
    const drawnFeatures = darkenedPixels(join(dir, "parts-features.mp4"), FACES, 3)
    const drawnMouth = darkenedPixels(join(dir, "parts-mouth.mp4"), FACES, 3)
    expect(drawnMouth).toBeGreaterThan(0)
    expect(drawnMouth).toBeLessThan(drawnFeatures)
    expect(drawnFeatures).toBeLessThan(drawnFull)
  }, 180_000)

  it("draws nothing outside the mask: an all-black mask draws no face, an all-white one every face", async () => {
    const none = await drawFaceMeshVideo({ videoPath: FACES, drawOnPath: FACES, maskPath: maskClip("black.mp4", "black", 26), filters: OFF, outputPath: join(dir, "none.mp4") })
    expect(none.facesDrawn).toBe(0)
    expect(none.framesWithFaces).toBe(0)
    expect(frames(join(dir, "none.mp4"))).toBe(26)
    const all = await drawFaceMeshVideo({ videoPath: FACES, drawOnPath: FACES, maskPath: maskClip("white.mp4", "white", 26), filters: OFF, outputPath: join(dir, "all.mp4") })
    expect(all.facesDrawn).toBeGreaterThanOrEqual(26)
  }, 120_000)

  it("the size limits leave faces out: none of these is a third of the frame tall", async () => {
    const r = await drawFaceMeshVideo({ videoPath: FACES, drawOnPath: FACES, filters: { ...OFF, minFaceHeightPct: 33 }, outputPath: join(dir, "big.mp4") })
    expect(r.facesDrawn).toBe(0)
  }, 120_000)

  it("no face is not a failure: the clip comes back with nothing drawn, its audio copied untouched", async () => {
    const src = join(dir, "noface.mp4")
    ff("-f", "lavfi", "-i", "testsrc2=s=320x240:r=24", "-f", "lavfi", "-i", "sine=f=440:r=48000",
      "-frames:v", "36", "-t", "1.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", src)
    const out = join(dir, "noface-out.mp4")
    const r = await drawFaceMeshVideo({ videoPath: src, drawOnPath: src, filters: OFF, outputPath: out })
    expect(r.facesDrawn).toBe(0)
    expect(r.frames).toBe(frames(src))
    expect(frames(out)).toBe(frames(src))
    expect(audioMd5(out)).toBe(audioMd5(src))
  }, 120_000)

  it("a variable-rate clip with Video Mask's 30 fps mask: the mask is read by TIME, the clip's frames and length kept", async () => {
    // The fixture's 26 frames at uneven times (gaps of 0.5 and 1 s), and a 30 fps mask of the same span:
    // black before 7.5 s, white from it. Read by index, every clip frame would get a black mask frame (the
    // first 26 are under a second); by time, the frames from 7.5 s on are inside it.
    const vfr = join(dir, "vfr.mp4")
    ff("-i", FACES, "-vf", "setpts=(N*0.5+0.2*floor(N/2))/TB", "-fps_mode", "passthrough", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-video_track_timescale", "1000", vfr)
    const times = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", vfr])
      .toString().trim().split("\n").map(Number).sort((a, b) => a - b)
    expect(times).toHaveLength(26)
    const span = times.at(-1)! - times[0]!
    const late = times.filter((t) => t - times[0]! >= 7.5).length
    expect(late).toBeGreaterThan(5)
    expect(late).toBeLessThan(26)
    const mask = join(dir, "half-time.mp4")
    ff("-f", "lavfi", "-i", "color=black:s=960x540:r=30", "-vf", "drawbox=c=white:t=fill:enable='gte(t,7.5)'",
      "-frames:v", String(Math.round(span * 30) + 1), "-c:v", "libx264", "-pix_fmt", "yuv420p", mask)
    expect(frames(mask)).not.toBe(26)
    const out = join(dir, "vfr-out.mp4")
    const r = await drawFaceMeshVideo({ videoPath: vfr, drawOnPath: vfr, maskPath: mask, filters: OFF, outputPath: out })
    expect(r.frames).toBe(26)
    expect(frames(out)).toBe(26)
    expect(r.framesWithFaces).toBeGreaterThan(0)
    expect(r.framesWithFaces).toBeLessThanOrEqual(late)
    // Its length is the clip's (encoded at its average rate), within a frame.
    const length = (path: string) => Number(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=duration", "-of", "csv=p=0", path]).toString().trim())
    expect(Math.abs(length(out) - length(vfr))).toBeLessThan(0.7)
  }, 120_000)

  it("refuses a mask that spans another length than the clip", async () => {
    const other = join(dir, "other-span.mp4")
    ff("-f", "lavfi", "-i", "color=white:s=960x540:r=30", "-frames:v", "90", "-c:v", "libx264", "-pix_fmt", "yuv420p", other)
    await expect(drawFaceMeshVideo({ videoPath: FACES, drawOnPath: FACES, maskPath: other, filters: OFF, outputPath: join(dir, "w.mp4") }))
      .rejects.toThrow(/not this video's mask/)
  }, 60_000)

  it("refuses a clip to draw on whose frame count differs, and a mask of another clip, before anything is drawn", async () => {
    const short = maskClip("short.mp4", "black", 10)
    await expect(drawFaceMeshVideo({ videoPath: FACES, drawOnPath: short, filters: OFF, outputPath: join(dir, "x.mp4") })).rejects.toBeInstanceOf(FaceMeshInputError)
    // A 10-frame mask at 2 fps spans 4.5 s against the clip's 12.5 s: not this clip's.
    await expect(drawFaceMeshVideo({ videoPath: FACES, drawOnPath: FACES, maskPath: short, filters: OFF, outputPath: join(dir, "y.mp4") })).rejects.toBeInstanceOf(FaceMeshInputError)
  }, 60_000)

  it("a coloured depth map: the lines take the map's colours, read from the gray depth render at its own size", async () => {
    // The gray "depth" render (the faces' clip in gray) at half size, and the clip drawn on: the same in gray, full size.
    const gray = join(dir, "gray.mp4")
    ff("-i", FACES, "-vf", "format=gray,format=yuv420p", "-c:v", "libx264", "-pix_fmt", "yuv420p", gray)
    const depth = join(dir, "depth-half.mp4")
    ff("-i", FACES, "-vf", "scale=480:270,format=gray,format=yuv420p", "-c:v", "libx264", "-pix_fmt", "yuv420p", depth)
    /** Pixels of a frame with a clear hue (the gray clip has none). */
    const hued = (path: string) => {
      const { rgb, w, h } = frameAt(path, 3)
      let n = 0
      for (let i = 0; i < w * h; i++) if (Math.max(rgb[3 * i]!, rgb[3 * i + 1]!, rgb[3 * i + 2]!) - Math.min(rgb[3 * i]!, rgb[3 * i + 1]!, rgb[3 * i + 2]!) > 40) n++
      return n
    }
    const plain = join(dir, "gray-out.mp4")
    await drawFaceMeshVideo({ videoPath: FACES, drawOnPath: gray, filters: OFF, outputPath: plain })
    expect(hued(plain)).toBeLessThan(10) // gray tones on a gray clip
    expect(darkenedPixels(plain, gray, 3)).toBeGreaterThan(200)
    const coloured = join(dir, "inferno-out.mp4")
    const r = await drawFaceMeshVideo({ videoPath: FACES, drawOnPath: gray, depth: { path: depth, colormap: "inferno" }, filters: OFF, outputPath: coloured })
    expect(r.frames).toBe(26)
    expect(r.facesDrawn).toBeGreaterThanOrEqual(26)
    expect(hued(coloured)).toBeGreaterThan(100) // inferno's own colours where the lines are
  }, 120_000)

  it("refuses a depth render whose frame count differs, before anything is drawn", async () => {
    const short = maskClip("short-depth.mp4", "black", 10)
    await expect(drawFaceMeshVideo({ videoPath: FACES, drawOnPath: FACES, depth: { path: short, colormap: "turbo" }, filters: OFF, outputPath: join(dir, "d.mp4") }))
      .rejects.toThrow(/depth video has 10 frames/)
  }, 60_000)

  it("refuses a clip it cannot read", async () => {
    const bad = join(dir, "bad.mp4")
    execFileSync("sh", ["-c", `printf 'not a video' > '${bad}'`])
    await expect(drawFaceMeshVideo({ videoPath: bad, drawOnPath: bad, filters: OFF, outputPath: join(dir, "z.mp4") })).rejects.toBeInstanceOf(FaceMeshInputError)
  }, 60_000)
})

describe("drawFaceMeshVideo: a face gets lines only when it is found in at least 3 frames of its track", () => {
  // The fixture's two middle faces (38 % and 67 % across) are found in every frame, at a presence of 0.75 or more;
  // the outer two (18 % and 82 %) only in frames 2, 3 and 21. A mask white on chosen frames and black on the rest
  // (the clip's 26 frames, read index to index) makes the middle faces FOUND exactly there: every window below
  // keeps to frames 5–20 and 22–25, so an outer face is never found inside one.
  const maskOn = (name: string, on: readonly number[]) => {
    const out = join(dir, name)
    const enable = on.map((f) => `eq(n,${f})`).join("+")
    ff("-f", "lavfi", "-i", "color=black:s=960x540:r=2", "-vf", `drawbox=c=white:t=fill:enable='${enable}'`,
      "-frames:v", "26", "-c:v", "libx264", "-pix_fmt", "yuv420p", out)
    return out
  }

  it.each<[string, number[], number[]]>([
    ["found in one frame: never drawn", [10], []],
    ["found in two frames: never drawn", [10, 11], []],
    ["found in three frames in a row: drawn on all three", [10, 11, 12], [10, 11, 12]],
    ["a long track with a one-frame dip: drawn wherever it is found", [...range(5, 9), ...range(11, 15)], [...range(5, 9), ...range(11, 15)]],
    ["a two-frame dip between two long stretches: drawn wherever it is found", [...range(5, 9), ...range(12, 16)], [...range(5, 9), ...range(12, 16)]],
    ["found in five, a two-frame dip, then in two: the two are a track of their own, never drawn", [...range(5, 9), 12, 13], range(5, 9)],
    ["found only in the clip's last two frames: never drawn", [24, 25], []],
    ["found in the clip's last three frames: drawn on all three", [23, 24, 25], [23, 24, 25]],
  ])("%s", async (_, on, drawn) => {
    const out = join(dir, `found-${on.join("-")}.mp4`)
    const r = await drawFaceMeshVideo({ videoPath: FACES, drawOnPath: FACES, maskPath: maskOn(`mask-${on.join("-")}.mp4`, on), filters: OFF, outputPath: out })
    // The frame count is unchanged…
    expect(r.frames).toBe(26)
    expect(frames(out)).toBe(26)
    // …the lines are on exactly the frames drawn, every other frame comes out as it went in, and the counts say so.
    expect(framesWithLines(out, FACES)).toEqual(drawn)
    expect([r.framesWithFaces, r.facesDrawn]).toEqual([drawn.length, 2 * drawn.length])
  }, 60_000)

  it("faces found in only one or two frames beside faces found in every frame: only the steady ones get lines", async () => {
    // No filter at all, as a run with no size or zone filter sends it.
    const out = join(dir, "steady.mp4")
    const r = await drawFaceMeshVideo({ videoPath: FACES, drawOnPath: FACES, filters: OFF, outputPath: out })
    expect([r.frames, r.framesWithFaces, r.facesDrawn]).toEqual([26, 26, 52])
    expect(framesWithLines(out, FACES)).toEqual(range(0, 25))
    // Where the outer faces are found (pixels: the left one in frames 2 and 21, the right one in frames 2 and 3): no line.
    const left = changedPerFrame(out, FACES, { x0: 113, y0: 134, x1: 213, y1: 234 })
    const right = changedPerFrame(out, FACES, { x0: 740, y0: 131, x1: 834, y1: 225 })
    expect([left[2], left[21], right[2], right[3]].every((n) => n! < 20), `${[left[2], left[21], right[2], right[3]]}`).toBe(true)
  }, 60_000)

  it("a clip shorter than the wait: two frames draw nothing and come out as two; three draw the faces found in all three", async () => {
    const two = join(dir, "two.mp4")
    ff("-i", FACES, "-frames:v", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", two)
    const r2 = await drawFaceMeshVideo({ videoPath: two, drawOnPath: two, filters: OFF, outputPath: join(dir, "two-out.mp4") })
    expect([r2.frames, r2.framesWithFaces, r2.facesDrawn]).toEqual([2, 0, 0])
    expect(frames(join(dir, "two-out.mp4"))).toBe(2)
    // Frames 0–2: the middle faces in all three; the outer two, found in frame 2 alone, are left out.
    const three = join(dir, "three.mp4")
    ff("-i", FACES, "-frames:v", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", three)
    const r3 = await drawFaceMeshVideo({ videoPath: three, drawOnPath: three, filters: OFF, outputPath: join(dir, "three-out.mp4") })
    expect([r3.frames, r3.framesWithFaces, r3.facesDrawn]).toEqual([3, 3, 6])
    expect(frames(join(dir, "three-out.mp4"))).toBe(3)
  }, 60_000)

  it("a held frame keeps its own depth: the lines take the colour of their own frame's depth, not of the last one read", async () => {
    // The gray depth render is black except frames 10–14, white. On the gray clip, a line over white depth is the
    // map's deep red (red well above green); over black, a faint blue lift. A frame waits for frames read after it,
    // so one coloured from the decoder's latest depth would put red lines before 10 and none on 11–14.
    const gray = join(dir, "held-gray.mp4")
    ff("-i", FACES, "-vf", "format=gray,format=yuv420p", "-c:v", "libx264", "-pix_fmt", "yuv420p", gray)
    const depth = join(dir, "held-depth.mp4")
    ff("-f", "lavfi", "-i", "color=black:s=480x270:r=2", "-vf", "drawbox=c=white:t=fill:enable='between(n,10,14)'",
      "-frames:v", "26", "-c:v", "libx264", "-pix_fmt", "yuv420p", depth)
    const out = join(dir, "held-depth-out.mp4")
    const r = await drawFaceMeshVideo({ videoPath: FACES, drawOnPath: gray, depth: { path: depth, colormap: "inferno" }, filters: OFF, outputPath: out })
    expect(r.framesWithFaces).toBe(26)
    const { w, h, frames: drawnFrames } = framesOf(out)
    const red = drawnFrames.map((rgb) => {
      let n = 0
      for (let i = 0; i < w * h; i++) if (rgb[3 * i]! - rgb[3 * i + 1]! > 40) n++
      return n
    })
    expect(red.flatMap((n, f) => (n > 300 ? [f] : [])), `${red}`).toEqual(range(10, 14))
    expect(red.filter((n) => n > 0 && n <= 300), `${red}`).toEqual([])
  }, 60_000)
})

describe("buildFaceMeshEncodeArgs", () => {
  it("encodes raw RGB at the drawn clip's size and rate, its first audio stream copied, no frame dropped or added", () => {
    const args = buildFaceMeshEncodeArgs({ width: 720, height: 1280, frameRate: "30000/1001", audioFrom: "/in.mp4", outputPath: "/out.mp4" })
    expect(args.join(" ")).toContain("-f rawvideo -pix_fmt rgb24 -s 720x1280 -framerate 30000/1001 -i pipe:0 -i /in.mp4")
    expect(args.join(" ")).toContain("-map 0:v:0 -map 1:a:0? -fps_mode passthrough")
    expect(args.join(" ")).toContain("-c:a copy")
    expect(args).not.toContain("-shortest")
    expect(args.at(-1)).toBe("/out.mp4")
  })

  it("writes the frames back in the clip's own colour and tags it as it was (untagged = BT.709, limited)", () => {
    const untagged = buildFaceMeshEncodeArgs({ width: 2, height: 2, frameRate: "24/1", audioFrom: "/a", outputPath: "/o" }).join(" ")
    expect(untagged).toContain("scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv")
    expect(untagged).toContain("-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv")
    const sd = clipColourOf({ color_space: "smpte170m", color_range: "pc", color_primaries: "bt470bg", color_transfer: "unknown" })
    expect(sd).toEqual({ matrix: "bt601", range: "pc", space: "smpte170m", primaries: "bt470bg", transfer: "smpte170m" })
    expect(clipColourOf({ color_space: "bt2020nc" }).matrix).toBe("bt2020")
  })
})

describe("the colour round trip", () => {
  it("a BT.709 clip comes back tagged BT.709 (no face: nothing drawn)", async () => {
    const src = join(dir, "bt709.mp4")
    ff("-f", "lavfi", "-i", "testsrc2=s=320x240:r=24", "-frames:v", "24", "-vf", "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv",
      "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", src)
    const out = join(dir, "bt709-out.mp4")
    await drawFaceMeshVideo({ videoPath: src, drawOnPath: src, filters: OFF, outputPath: out })
    expect(probe(out, "stream=color_space,color_primaries,color_transfer,color_range")).toBe("tv,bt709,bt709,bt709")
  }, 60_000)
})
