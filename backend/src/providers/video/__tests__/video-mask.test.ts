import { describe, it, expect } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import {
  buildMaskEncodeArgs,
  buildNormaliseArgs,
  decodeMaskRle,
  planVideoMaskSource,
  renderMaskVideo,
  constantRateOf,
  planMaskChunks,
  buildSplitArgs,
  splitMaskSource,
  countVideoFrames,
  videoMaskFfmpegTimeoutMs,
} from "../video-mask.js"
import { DeterministicJobError } from "../../../lib/deterministic-job-error.js"
import { assertFrameCountMatches } from "../../../workers/handlers/video-mask.js"
import type { VideoOverlayBaseProbe } from "../ffmpeg-utils.js"

const probe = (over: Partial<VideoOverlayBaseProbe>): VideoOverlayBaseProbe => ({
  width: 1280, height: 720, rotation: 0, sar: 1, rFrameRate: "30/1", avgFrameRate: "30/1",
  streamDurationSec: 5, startTimeSec: 0, audioCodec: null, ...over,
} as VideoOverlayBaseProbe)

describe("decodeMaskRle", () => {
  it("draws row-major (start, length) runs with a ONE-based start and counts the covered pixels", () => {
    const out = new Uint8Array(4 * 3)
    expect(decodeMaskRle("2 2 9 3", out)).toBe(5)
    expect([...out]).toEqual([0, 255, 255, 0, 0, 0, 0, 0, 255, 255, 255, 0])
  })
  it("accepts a run that ends on the frame's last pixel (start + length = pixels + 1) and covers the first", () => {
    const out = new Uint8Array(6)
    expect(decodeMaskRle("1 1 5 2", out)).toBe(3)
    expect([...out]).toEqual([255, 0, 0, 0, 255, 255])
  })
  it("overwrites the previous frame and reads an empty string as an empty frame", () => {
    const out = new Uint8Array(6).fill(255)
    expect(decodeMaskRle("", out)).toBe(0)
    expect([...out]).toEqual([0, 0, 0, 0, 0, 0])
  })
  it("refuses a run that leaves the frame — the RLE was drawn on other geometry", () => {
    expect(() => decodeMaskRle("5 3", new Uint8Array(6))).toThrow(/leaves the 6-pixel frame/)
    expect(() => decodeMaskRle("0 2", new Uint8Array(6))).toThrow(/leaves the 6-pixel frame/)
    // Deterministic — a retry would decode the same answer the same way and pay the model again.
    expect(() => decodeMaskRle("5 3", new Uint8Array(6))).toThrow(DeterministicJobError)
    expect(() => decodeMaskRle("1", new Uint8Array(6))).toThrow(/odd number/)
  })
})

describe("planVideoMaskSource", () => {
  it("sends a plain upright, square-pixel, constant-rate clip as it is", () => {
    expect(planVideoMaskSource(probe({}))).toBeNull()
  })
  it("re-encodes a rotated clip (the display size is already rotated in the probe)", () => {
    expect(planVideoMaskSource(probe({ width: 720, height: 1280, rotation: 90 }))).toEqual({ width: 720, height: 1280 })
  })
  it("scales a clip over 1920 px down to the cap, keeping even dimensions", () => {
    expect(planVideoMaskSource(probe({ width: 3840, height: 2160 }))).toEqual({ width: 1920, height: 1080 })
  })
  it("pins a variable frame rate to 30 fps", () => {
    expect(planVideoMaskSource(probe({ avgFrameRate: "24000/1001", rFrameRate: "60/1" }))).toEqual({ width: 1280, height: 720, fps: 30 })
  })
  it("reads the frame rate by the SAME rule pricing does: a 2.5 % spread is a constant 58.5 fps, not variable", () => {
    expect(planVideoMaskSource(probe({ avgFrameRate: "117/2", rFrameRate: "60/1" }))).toBeNull()
    expect(constantRateOf({ avgFrameRate: "117/2", rFrameRate: "60/1" })).toBe("117/2")
  })
  it("takes the nominal rate when the average is unreadable (0/0), as pricing does", () => {
    expect(planVideoMaskSource(probe({ avgFrameRate: "0/0", rFrameRate: "60/1" }))).toBeNull()
    expect(constantRateOf({ avgFrameRate: "0/0", rFrameRate: "60/1" })).toBe("60/1")
  })
  it("squares non-square pixels", () => {
    expect(planVideoMaskSource(probe({ width: 720, height: 480, sar: 32 / 27 }))).toEqual({ width: 852, height: 480 })
  })
  it("normalise argv scales, squares and (when asked) pins the rate", () => {
    expect(buildNormaliseArgs("in.mp4", "out.mp4", { width: 1920, height: 1080, fps: 30 })).toContain("scale=1920:1080,setsar=1,fps=30")
  })
})

describe("assertFrameCountMatches", () => {
  const g = { width: 640, height: 360, frameRate: "30/1", durationSec: 3 }
  it("accepts the clip's frame count within a few frames", () => {
    expect(() => assertFrameCountMatches(90, g)).not.toThrow()
    expect(() => assertFrameCountMatches(88, g)).not.toThrow()
  })
  it("refuses a count far from the clip's (the model decoded something else), deterministically", () => {
    expect(() => assertFrameCountMatches(60, g)).toThrow(/60 frame masks/)
    expect(() => assertFrameCountMatches(60, g)).toThrow(DeterministicJobError)
  })
})

describe("renderMaskVideo (real ffmpeg)", () => {
  it("encodes one mask frame per RLE entry at the geometry, white where the runs are", async () => {
    const dir = await mkdtemp(join(tmpdir(), "video-mask-test-"))
    try {
      const out = join(dir, "mask.mp4")
      // 64×36 at 10 fps, 10 frames: the left half white in frames 0–4, nothing in 5–9 except frame 7.
      const leftHalf = Array.from({ length: 36 }, (_, y) => `${y * 64 + 1} 32`).join(" ")
      const rle = [...Array(5).fill(leftHalf), "", "", leftHalf, "", ""]
      const { coveredFraction } = await renderMaskVideo(rle, { width: 64, height: 36, frameRate: "10/1", durationSec: 1 }, out)
      expect(coveredFraction).toBeCloseTo(0.3, 5)
      const frames = execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames,width,height", "-of", "csv=p=0", out]).toString().trim()
      expect(frames).toBe("64,36,10")
      // Frame 0: left half white, right half black. Frame 5: all black.
      const gray = (n: number) => execFileSync("ffmpeg", ["-v", "error", "-i", out, "-vf", `select=eq(n\\,${n})`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"])
      const f0 = gray(0)
      expect(f0[18 * 64 + 8]).toBeGreaterThan(220)
      expect(f0[18 * 64 + 56]).toBeLessThan(30)
      expect(Math.max(...gray(5))).toBeLessThan(30)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("refuses a result with nothing matched on any frame (and never spawns an encode)", async () => {
    await expect(renderMaskVideo(["", ""], { width: 4, height: 4, frameRate: "30/1", durationSec: 0.1 }, "/nonexistent/x.mp4"))
      .rejects.toThrow(/No region matched/)
  })

  it("mask encode argv reads raw gray frames on stdin at the geometry and rate", () => {
    const argv = buildMaskEncodeArgs({ width: 640, height: 360, frameRate: "30000/1001", durationSec: 1 }, "o.mp4")
    expect(argv.join(" ")).toContain("-f rawvideo -pix_fmt gray -s 640x360 -framerate 30000/1001 -i pipe:0")
  })
})

describe("chunking a long clip", () => {
  it("plans requests of at most N frames, in order, covering every frame once", () => {
    expect(planMaskChunks(90, 1800)).toEqual([{ index: 0, startFrame: 0, frames: 90 }])
    expect(planMaskChunks(1800, 1800)).toEqual([{ index: 0, startFrame: 0, frames: 1800 }])
    expect(planMaskChunks(4000, 1800)).toEqual([
      { index: 0, startFrame: 0, frames: 1800 },
      { index: 1, startFrame: 1800, frames: 1800 },
      { index: 2, startFrame: 3600, frames: 400 },
    ])
    expect(planMaskChunks(9000).reduce((n, c) => n + c.frames, 0)).toBe(9000)
  })
  it("split argv forces a keyframe on every boundary and cuts exactly there", () => {
    const argv = buildSplitArgs("in.mp4", "out-%03d.mp4", planMaskChunks(4000, 1800)).join(" ")
    expect(argv).toContain("-force_key_frames expr:eq(mod(n,1800),0)")
    expect(argv).toContain("-segment_frames 1800,3600")
  })
  it("gives longer clips longer kill budgets", () => {
    expect(videoMaskFfmpegTimeoutMs(300)).toBeGreaterThan(videoMaskFfmpegTimeoutMs(10))
  })
  it("cuts a real clip into chunks of exactly the planned frames (real ffmpeg)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "video-mask-split-"))
    try {
      const src = join(dir, "src.mp4")
      execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=10:d=5", "-c:v", "libx264", "-pix_fmt", "yuv420p", src])
      const total = await countVideoFrames(src)
      expect(total).toBe(50)
      const chunks = planMaskChunks(total!, 20)
      const paths = await splitMaskSource(src, dir, { width: 160, height: 90, frameRate: "10/1", durationSec: 5 }, chunks)
      expect(await Promise.all(paths.map((p) => countVideoFrames(p)))).toEqual([20, 20, 10])
      // One chunk: no cut, the clip itself.
      expect(await splitMaskSource(src, dir, { width: 160, height: 90, frameRate: "10/1", durationSec: 5 }, planMaskChunks(50, 1800))).toEqual([src])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
