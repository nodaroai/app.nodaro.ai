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
/** Blue-dominant pixels of a frame (the mesh's colour) at time `t`. */
function bluePixels(path: string, t: number): number {
  const [w, h] = probe(path, "stream=width,height").split(",").map(Number)
  const rgb = execFileSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { maxBuffer: 1e8 })
  let n = 0
  for (let i = 0; i < w! * h!; i++) {
    const r = rgb[3 * i]!, g = rgb[3 * i + 1]!, b = rgb[3 * i + 2]!
    if (b > 150 && b > r + 60 && b > g + 30) n++
  }
  return n
}

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
    expect(bluePixels(out, 3)).toBeGreaterThan(50)
    expect(bluePixels(FACES, 3)).toBeLessThan(10)
  }, 120_000)

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

  it("refuses a clip it cannot read", async () => {
    const bad = join(dir, "bad.mp4")
    execFileSync("sh", ["-c", `printf 'not a video' > '${bad}'`])
    await expect(drawFaceMeshVideo({ videoPath: bad, drawOnPath: bad, filters: OFF, outputPath: join(dir, "z.mp4") })).rejects.toBeInstanceOf(FaceMeshInputError)
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
