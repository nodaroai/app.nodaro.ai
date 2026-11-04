import { describe, it, expect } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { cutTimesFromFirstFrame, cutTimesToFrames, detectCutFrames, detectCutTimes, detectShotCuts, numberedCutsOf } from "../scene-cut-frames.js"
import { findSceneCuts } from "../media-proxy-cuts.js"

describe("cutTimesToFrames", () => {
  it("counts frames from the first decoded frame's time (a source may start past 0), at the clip's rate", () => {
    expect(cutTimesToFrames([1], 0, "24/1")).toEqual([24])
    // A plain source sent as it is can start at 0.5 s: its cut at 1.5 s is still frame 24.
    expect(cutTimesToFrames([1.5], 0.5, "24/1")).toEqual([24])
    // NTSC: frame 30 of a 30000/1001 clip is at 1.001 s.
    expect(cutTimesToFrames([1.001, 2.002], 0, "30000/1001")).toEqual([30, 60])
  })
  it("drops a cut at or before the first frame, and repeats; sorted", () => {
    expect(cutTimesToFrames([2, 0, 1, 1], 0, "10/1")).toEqual([10, 20])
    expect(cutTimesToFrames([0.01], 0, "10/1")).toEqual([])
  })
  it("returns nothing for a rate it cannot read", () => {
    expect(cutTimesToFrames([1], 0, "0/0")).toEqual([])
  })
})

describe("cutTimesFromFirstFrame", () => {
  it("counts seconds from the first decoded frame, to the millisecond, ascending, each once", () => {
    expect(cutTimesFromFirstFrame([2.5, 1], 0)).toEqual([1, 2.5])
    expect(cutTimesFromFirstFrame([1.5, 3.0004], 0.5)).toEqual([1, 2.5])
    expect(cutTimesFromFirstFrame([1.0001, 1.0004, 1], 0)).toEqual([1])
  })
  it("drops a cut at or before the first frame, and a time that is not a number", () => {
    expect(cutTimesFromFirstFrame([0.5, 0.2, Number.NaN, 2], 0.5)).toEqual([1.5])
    expect(cutTimesFromFirstFrame([], 0)).toEqual([])
  })
})

describe("detectCutFrames (real ffmpeg)", () => {
  const clip = async (name: string, inputs: string[][], fn: (path: string) => Promise<void>) => {
    const dir = await mkdtemp(join(tmpdir(), "scene-cut-frames-"))
    try {
      const path = join(dir, name)
      const args = inputs.flatMap((i) => ["-f", "lavfi", "-i", i.join("")])
      execFileSync("ffmpeg", [
        "-v", "error", "-y", ...args,
        "-filter_complex", `${inputs.map((_, k) => `[${k}]`).join("")}concat=n=${inputs.length}:v=1`,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", path,
      ])
      await fn(path)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  it("finds the cut of a two-shot clip (1 s red, then 1 s blue, 24 fps) at frame 24", async () => {
    await clip("two.mp4", [["color=red:s=160x90:r=24:d=1"], ["color=blue:s=160x90:r=24:d=1"]], async (path) => {
      expect(await detectCutFrames(path, "24/1")).toEqual([24])
    })
  }, 60_000)

  it("finds no cut in a single-colour clip", async () => {
    await clip("one.mp4", [["color=red:s=160x90:r=24:d=2"]], async (path) => {
      expect(await detectCutFrames(path, "24/1")).toEqual([])
    })
  }, 60_000)

  it("finds no cut in a flash (one white frame in a red shot): it stays one shot", async () => {
    await clip("flash.mp4", [
      ["color=red:s=160x90:r=24:d=1"], ["color=white:s=160x90:r=24:d=0.0417"], ["color=red:s=160x90:r=24:d=1"],
    ], async (path) => {
      expect(await detectCutFrames(path, "24/1")).toEqual([])
    })
  }, 60_000)

  it("finds a cut into fast motion, which the media proxy's flash check reads as a flash (a hit, a swing, a whip pan)", async () => {
    // Every frame of the second shot still moves by ~0.85× the cut's own change.
    await clip("cut-into-motion.mp4", [
      ["color=gray:s=160x90:r=24:d=1"], ["testsrc2=s=160x90:r=24:d=1,scroll=horizontal=0.1"],
    ], async (path) => {
      expect(await detectCutFrames(path, "24/1")).toEqual([24])
    })
  }, 60_000)

  it("detectCutTimes answers the same cuts in seconds from the first frame, with the input confined", async () => {
    await clip("two-times.mp4", [["color=red:s=160x90:r=24:d=1"], ["color=blue:s=160x90:r=24:d=1"]], async (path) => {
      const { cutsSec } = await detectCutTimes(path, { inputArgs: ["-protocol_whitelist", "file", "-format_whitelist", "mov,mp4,m4a,matroska,webm"] })
      expect(cutsSec).toEqual([1])
    })
  }, 60_000)

  it("finds both cuts of a three-shot clip", async () => {
    await clip("three.mp4", [
      ["color=red:s=160x90:r=24:d=1"], ["color=blue:s=160x90:r=24:d=1"], ["color=green:s=160x90:r=24:d=1"],
    ], async (path) => {
      expect(await detectCutFrames(path, "24/1")).toEqual([24, 48])
    })
  }, 60_000)
})

describe("numberedCutsOf — the same cuts as detectCutTimes, each with the frame it starts on", () => {
  /** A 24 fps run of numbered frames: quiet motion unless `at` says otherwise. */
  const run = (frames: number, at: Record<number, { score: number; mafd: number }> = {}, start = 0) =>
    Array.from({ length: frames }, (_, k) => ({ n: k, t: start + k / 24, ...(at[k] ?? { score: k === 0 ? 0 : 0.3, mafd: k === 0 ? 0 : 0.4 }) }))

  it("a hard cut at frame 24 is 1 s and frame 24; the clip's frames are counted from its numbers", () => {
    const scan = numberedCutsOf(run(48, { 24: { score: 40, mafd: 40 } }))
    expect(scan.cuts).toEqual([{ sec: 1, frame: 24 }])
    expect(scan.frameCount).toBe(48)
    expect(scan.firstFrameTimeS).toBe(0)
    expect(scan.lastFrameSec).toBe(1.958)
  })

  it("times count from the first decoded frame, exactly as cutTimesFromFirstFrame does", () => {
    const frames = run(72, { 24: { score: 40, mafd: 40 }, 60: { score: 35, mafd: 36 } }, 0.5)
    const scan = numberedCutsOf(frames)
    expect(scan.cuts.map((c) => c.sec)).toEqual(cutTimesFromFirstFrame(findSceneCuts(frames, { isolatedSpikeIsCut: true }), 0.5))
    expect(scan.cuts.map((c) => c.frame)).toEqual([24, 60])
  })

  it("a frame skipped by the reader (NOPTS) never shifts the frame numbers after it", () => {
    const frames = run(48, { 30: { score: 40, mafd: 40 } }).filter((f) => f.n !== 10)
    expect(numberedCutsOf(frames).cuts).toEqual([{ sec: 1.25, frame: 30 }])
  })

  it("no frames is no cuts and no frames", () => {
    expect(numberedCutsOf([])).toEqual({ cuts: [], frameCount: 0, firstFrameTimeS: null, lastFrameSec: 0 })
  })
})

describe("detectShotCuts (real ffmpeg)", () => {
  it("answers detectCutTimes' cuts with the frames they start on, and the clip's frame count", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shot-cuts-scan-"))
    try {
      const path = join(dir, "three.mp4")
      execFileSync("ffmpeg", [
        "-v", "error", "-y",
        "-f", "lavfi", "-i", "color=red:s=160x90:r=24:d=1",
        "-f", "lavfi", "-i", "color=blue:s=160x90:r=24:d=1.5",
        "-f", "lavfi", "-i", "color=green:s=160x90:r=24:d=1",
        "-filter_complex", "[0][1][2]concat=n=3:v=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", path,
      ])
      const scan = await detectShotCuts(path)
      expect(scan.cuts).toEqual([{ sec: 1, frame: 24 }, { sec: 2.5, frame: 60 }])
      expect(scan.cuts.map((c) => c.sec)).toEqual((await detectCutTimes(path)).cutsSec)
      expect(scan.frameCount).toBe(84)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
