import { describe, it, expect } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { cutTimesToFrames, detectCutFrames } from "../scene-cut-frames.js"

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

  it("finds both cuts of a three-shot clip", async () => {
    await clip("three.mp4", [
      ["color=red:s=160x90:r=24:d=1"], ["color=blue:s=160x90:r=24:d=1"], ["color=green:s=160x90:r=24:d=1"],
    ], async (path) => {
      expect(await detectCutFrames(path, "24/1")).toEqual([24, 48])
    })
  }, 60_000)
})
