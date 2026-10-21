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
  holdLastMaskFrames,
  maskRleCoveredPixels,
  dropMaskRegionsBySize,
  dropMaskRegionsBySizeInFrame,
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

describe("holdLastMaskFrames (holdLastMask)", () => {
  // A 100×100 frame (10,000 px): empty below 0.002 % = 0.2 px — so only a frame with no white at all is empty here.
  const PIX = 100 * 100
  const A = "1 50", B = "201 30", C = "5001 10"

  it("counts the pixels a frame's runs cover", async () => {
    expect(maskRleCoveredPixels("")).toBe(0)
    expect(maskRleCoveredPixels("2 2 9 3")).toBe(5)
  })
  it("fills every empty frame after the first detection from the most recent non-empty one; leading empties stay; the count is unchanged", async () => {
    const rle = ["", "", A, A, "", "", B, "", C, ""]
    const { rle: out, heldFrames } = await holdLastMaskFrames([...rle], PIX)
    expect(out).toEqual(["", "", A, A, A, A, B, B, C, C])
    expect(out).toHaveLength(rle.length)
    expect(heldFrames).toBe(4)
  })
  it("treats a mask under 0.002 % of the frame as empty (a speck), but keeps a small real one (e.g. 0.005 %)", async () => {
    // 1920×1080 = 2,073,600 px → empty below 41.47 px; 0.005 % ≈ 104 px is a small, distant subject.
    const big = 1920 * 1080
    const { rle: out, heldFrames } = await holdLastMaskFrames(["1 5000", "1 40", "1 104", "1 42"], big)
    expect(out).toEqual(["1 5000", "1 5000", "1 104", "1 42"])
    expect(heldFrames).toBe(1)
  })
  it("changes nothing when no frame is empty, or when no frame is ever detected", async () => {
    expect(await holdLastMaskFrames([A, B, C], PIX)).toEqual({ rle: [A, B, C], heldFrames: 0 })
    expect(await holdLastMaskFrames(["", ""], PIX)).toEqual({ rle: ["", ""], heldFrames: 0 })
  })

  it("counts without allocating, holds in place, and keeps the worker responsive on noisy frames", async () => {
    // 300 noisy frames: 1-px alternating runs over a 400×300 box (60,000 runs each), every 10th lost.
    // Measured on 1,000 such frames: ≈ 0.7 s, longest event-loop wait ≈ 10 ms (the first version: ≈ 3.2 s in one
    // blocking call); 9,000 crowd-like 1080p frames: ≈ 1.0 s, wait ≈ 10 ms (was ≈ 3.6 s, blocking).
    const w = 1920
    const frame = (n: number) => {
      const parts: string[] = []
      for (let r = 0; r < 300; r++) for (let c = 0; c < 200; c++) parts.push(`${(100 + r) * w + 100 + c * 2 + (n % 2) + 1} 1`)
      return parts.join(" ")
    }
    const frames = Array.from({ length: 300 }, (_, i) => (i % 10 === 5 ? "" : frame(i)))
    let maxGap = 0
    let last = performance.now()
    const tick = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now }, 2)
    const t0 = performance.now()
    const out = await holdLastMaskFrames(frames, w * 1080)
    const ms = performance.now() - t0
    clearInterval(tick)
    expect(out.rle).toBe(frames)
    expect(out.heldFrames).toBe(30)
    expect(frames[5]).toBe(frames[4])
    expect(ms).toBeLessThan(5_000)
    expect(maxGap).toBeLessThan(500)
  }, 60_000)
})

describe("dropMaskRegionsBySize (minSubjectHeightPct)", () => {
  // A 20×10 frame. RLE starts are one-based: pixel (x, y) is y*20 + x + 1.
  const W = 20, H = 10
  const rect = (x: number, y: number, w: number, h: number) =>
    Array.from({ length: h }, (_, i) => `${(y + i) * W + x + 1} ${w}`).join(" ")
  const draw = (rle: string) => {
    const out = new Uint8Array(W * H)
    decodeMaskRle(rle, out)
    return out
  }

  it("drops a region whose bounding box is under the cut, keeps the rest pixel for pixel", () => {
    const big = rect(2, 1, 4, 6) // 6 rows tall
    const small = rect(12, 2, 3, 2) // 2 rows tall
    const { rle, dropped } = dropMaskRegionsBySizeInFrame(`${big} ${small}`, W, H, 3)
    expect(dropped).toBe(1)
    expect(draw(rle)).toEqual(draw(big))
  })
  it("keeps a region exactly at the cut, and returns the frame untouched when nothing is dropped", () => {
    const three = rect(5, 0, 2, 3)
    const r = dropMaskRegionsBySizeInFrame(three, W, H, 3)
    expect(r).toMatchObject({ rle: three, dropped: 0 })
  })
  it("joins pixels that touch diagonally (8-connected): a thin diagonal stroke is one tall region", () => {
    const diagonal = Array.from({ length: 6 }, (_, i) => `${i * W + i + 1} 1`).join(" ")
    expect(dropMaskRegionsBySizeInFrame(diagonal, W, H, 5).dropped).toBe(0)
    // Two separate 1-row dots far apart are two small regions.
    expect(dropMaskRegionsBySizeInFrame(`${rect(0, 0, 1, 1)} ${rect(10, 5, 1, 1)}`, W, H, 2)).toMatchObject({ rle: "", dropped: 2 })
  })
  it("cuts a run that wraps past a row end at the row end: its pieces sit on opposite edges and are not one region", () => {
    // One run from (18, 3) for 4 pixels: (18–19, 3) and (0–1, 4), each one row tall.
    expect(dropMaskRegionsBySizeInFrame(`${3 * W + 18 + 1} 4`, W, H, 1).dropped).toBe(0)
    expect(dropMaskRegionsBySizeInFrame(`${3 * W + 18 + 1} 4`, W, H, 2)).toMatchObject({ rle: "", dropped: 2 })
    // A run that spans whole rows joins them: from (0, 2) for 3 full rows is one region 3 rows tall.
    expect(dropMaskRegionsBySizeInFrame(`${2 * W + 1} ${3 * W}`, W, H, 3).dropped).toBe(0)
  })
  it("refuses a run that leaves the frame, like the decoder", () => {
    expect(() => dropMaskRegionsBySizeInFrame("199 5", W, H, 2)).toThrow(DeterministicJobError)
  })
  it("over a whole mask: 0 = off (frames as they are); a % of the frame height otherwise; the frame count never changes", async () => {
    const frames = [`${rect(0, 0, 2, 8)} ${rect(10, 0, 2, 1)}`, rect(10, 0, 2, 1), ""]
    expect(await dropMaskRegionsBySize([...frames], { width: W, height: H }, 0)).toEqual({ rle: frames, droppedRegions: 0, matched: true, kept: true })
    const { rle, droppedRegions } = await dropMaskRegionsBySize([...frames], { width: W, height: H }, 15) // 1.5 rows
    expect(rle).toHaveLength(3)
    expect(draw(rle[0]!)).toEqual(draw(rect(0, 0, 2, 8)))
    expect(rle[1]).toBe("")
    expect(rle[2]).toBe("")
    expect(droppedRegions).toBe(2)
  })
  it("runs before the hold: a frame left with only small regions is held from the last frame with a big subject", async () => {
    const big = rect(0, 0, 3, 8), extra = rect(15, 0, 2, 1)
    const frames = [extra, big, `${big} ${extra}`, extra, ""]
    const sized = await dropMaskRegionsBySize(frames, { width: W, height: H }, 50)
    const { rle, heldFrames } = await holdLastMaskFrames(sized.rle, W * H)
    // Frame 0 (only the extra, before any big subject) stays empty; frames 3 and 4 hold frame 2's big subject.
    expect(rle[0]).toBe("")
    expect(rle.slice(1).map((f) => [...draw(f)])).toEqual(Array(4).fill([...draw(big)]))
    expect(heldFrames).toBe(2)
  })
  it("maxSubjectHeightPct alone drops the tall regions and keeps the small ones; both together keep a band", async () => {
    const big = rect(0, 0, 3, 8), mid = rect(8, 0, 2, 4), small = rect(15, 0, 2, 1)
    // Only a ceiling (50 % = 5 rows): the 8-row subject goes, the 4-row and 1-row stay.
    const onlyMax = await dropMaskRegionsBySize([`${big} ${mid} ${small}`], { width: W, height: H }, 0, 50)
    expect(draw(onlyMax.rle[0]!)).toEqual(draw(`${mid} ${small}`))
    expect(onlyMax.droppedRegions).toBe(1)
    // A band (20 %–50 % = 2–5 rows): only the 4-row region stays.
    const band = await dropMaskRegionsBySize([`${big} ${mid} ${small}`], { width: W, height: H }, 20, 50)
    expect(draw(band.rle[0]!)).toEqual(draw(mid))
    expect(band.droppedRegions).toBe(2)
    // Exactly at the ceiling is kept.
    expect(dropMaskRegionsBySizeInFrame(mid, W, H, 0, 4).dropped).toBe(0)
    expect(dropMaskRegionsBySizeInFrame(mid, W, H, 0, 3).dropped).toBe(1)
  })

  it("the ceiling runs before the hold too: a frame left with nothing small enough is held from the last one", async () => {
    const big = rect(0, 0, 3, 8), small = rect(15, 0, 2, 1)
    const sized = await dropMaskRegionsBySize([small, big, `${big} ${small}`], { width: W, height: H }, 0, 50)
    const { rle } = await holdLastMaskFrames(sized.rle, W * H)
    expect(rle.map((f) => [...draw(f)])).toEqual([[...draw(small)], [...draw(small)], [...draw(small)]])
  })

  it("handles overlapping and out-of-order runs (the model does not send them, but they decode)", () => {
    // Row 0: [0,10) [1,2) [5,12) overlap into one run; rows 1–4 continue it under [5,12): one region 5 rows tall.
    const rle = `1 10 2 1 6 7 ${rect(5, 1, 7, 4)}`
    expect(dropMaskRegionsBySizeInFrame(rle, W, H, 5).dropped).toBe(0)
    // The same runs in reverse order.
    const reversed = rle.trim().split(" ").reduce<string[]>((pairs, v, i, all) => (i % 2 === 0 ? [`${v} ${all[i + 1]}`, ...pairs] : pairs), []).join(" ")
    expect(dropMaskRegionsBySizeInFrame(reversed, W, H, 5).dropped).toBe(0)
    expect(draw(dropMaskRegionsBySizeInFrame(rle, W, H, 6).rle)).toEqual(draw(""))
  })

  it("replaces frames in place (no second copy of the mask) and gives the event loop a turn while it works", async () => {
    const frames = [`${rect(0, 0, 2, 8)} ${rect(10, 0, 2, 1)}`, rect(0, 0, 2, 8)]
    const keep = frames[1]
    const out = await dropMaskRegionsBySize(frames, { width: W, height: H }, 50)
    expect(out.rle).toBe(frames)
    expect(frames[1]).toBe(keep) // untouched frame: the same string
  })

  it("keeps up with a crowd-like 1080p mask (6,900 runs a frame) without stalling the worker", async () => {
    // 40 small faces (60×60) and 5 people (200×900) per frame, a distinct string per frame — the realistic heavy
    // case. 1,500 frames here (memory-light for CI); measured on the full 9,000 frames (5 min at 30 fps): ≈ 4.6 s,
    // heap 701 → 531 MB, longest event-loop wait 41 ms — the first version took ≈ 10.3 s in ONE blocking call and
    // grew the heap 701 → 1,198 MB.
    const w = 1920, h = 1080
    const frame = (n: number) => {
      const runs: Array<[number, number]> = []
      const shift = n % 7
      for (let f = 0; f < 40; f++) {
        const x = 20 + (f % 20) * 90 + shift, y = 30 + Math.floor(f / 20) * 70
        for (let r = 0; r < 60; r++) runs.push([(y + r) * w + x, 60])
      }
      for (let p = 0; p < 5; p++) for (let r = 0; r < 900; r++) runs.push([(170 + r) * w + 100 + p * 360 + shift, 200])
      return runs.sort((a, b) => a[0] - b[0]).map(([s, l]) => `${s + 1} ${l}`).join(" ")
    }
    const frames = Array.from({ length: 1500 }, (_, i) => frame(i))
    let maxGap = 0
    let last = performance.now()
    const tick = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now }, 2)
    const t0 = performance.now()
    const { droppedRegions } = await dropMaskRegionsBySize(frames, { width: w, height: h }, 15)
    const ms = performance.now() - t0
    clearInterval(tick)
    expect(droppedRegions).toBe(1500 * 40)
    // ≈ 0.8 s measured; a generous bound for a busy CI machine.
    expect(ms).toBeLessThan(8_000)
    // The worker's event loop gets a turn every slice (8 ms of work); the bound leaves room for a GC pause.
    expect(maxGap).toBeLessThan(500)
  }, 60_000)
})

describe("renderMaskVideo (real ffmpeg)", () => {
  it("a held mask goes through the same encode: same frame count, size and rate, the lost frames white", async () => {
    const dir = await mkdtemp(join(tmpdir(), "video-mask-hold-"))
    try {
      const out = join(dir, "mask.mp4")
      const leftHalf = Array.from({ length: 36 }, (_, y) => `${y * 64 + 1} 32`).join(" ")
      // The subject is lost for the last 3 of 10 frames (a hand in front of the face).
      const { rle } = await holdLastMaskFrames([...Array(7).fill(leftHalf), "", "", ""], 64 * 36)
      await renderMaskVideo(rle, { width: 64, height: 36, frameRate: "10/1", durationSec: 1 }, out)
      const frames = execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames,width,height,r_frame_rate", "-of", "csv=p=0", out]).toString().trim()
      expect(frames).toBe("64,36,10/1,10")
      const last = execFileSync("ffmpeg", ["-v", "error", "-i", out, "-vf", "select=eq(n\\,9)", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"])
      expect(last[18 * 64 + 8]).toBeGreaterThan(220)
      expect(last[18 * 64 + 56]).toBeLessThan(30)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

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

  it("allowEmpty encodes an all-black mask of the same frame count instead of refusing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "video-mask-empty-"))
    try {
      const out = join(dir, "mask.mp4")
      const { coveredFraction } = await renderMaskVideo(Array(5).fill(""), { width: 64, height: 36, frameRate: "10/1", durationSec: 0.5 }, out, { allowEmpty: true })
      expect(coveredFraction).toBe(0)
      const frames = execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", out]).toString().trim()
      expect(frames).toBe("5")
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
