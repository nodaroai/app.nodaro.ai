/**
 * Smart-cut integration test — REAL ffmpeg/ffprobe/sharp, no mocks.
 *
 * Proves the search compares EVERY pair in the windows by planting the one
 * genuine match in the far corner of the matrix (last prev candidate ×
 * last next candidate) and in a deep off-diagonal cell — positions a
 * partial scan would miss.
 *
 * Gated behind FFMPEG_INTEGRATION=1 (needs the ffmpeg/ffprobe binaries);
 * CI runners without them skip this file. Run locally with:
 *   FFMPEG_INTEGRATION=1 npx vitest run src/providers/video/__tests__/smart-cut.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const execFileP = promisify(execFile)
const RUN = process.env.FFMPEG_INTEGRATION === "1"

// 24fps, 320x180, yuv420p — mirrors what normalizeVideoForCombine feeds the
// matcher (uniform fps + resolution). A hard per-frame hue rotation
// (~130° per frame) makes every frame strongly distinct — adjacent-frame
// PSNR lands far below the match threshold, so only planted twins match.
const FPS = 24
const SIZE = "320x180"
const UNIQ = "hue=H=n*2.27"

async function ffmpeg(args: string[]): Promise<void> {
  await execFileP("ffmpeg", ["-y", "-v", "error", ...args])
}

function uniqueFramesSrc(frames: number): string {
  return `testsrc2=size=${SIZE}:rate=${FPS}:duration=${(frames / FPS).toFixed(4)}`
}

describe.runIf(RUN)("findSmartCutBoundary — real ffmpeg, full-matrix coverage", () => {
  let dir: string
  let prevPath: string

  beforeAll(async () => {
    dir = join(tmpdir(), `smart-cut-itest-${Date.now()}`)
    await fs.mkdir(dir, { recursive: true })
    // prev: 60 unique frames (0..59).
    prevPath = join(dir, "prev.mp4")
    await ffmpeg([
      "-f", "lavfi", "-i", uniqueFramesSrc(60),
      "-vf", UNIQ,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "12", prevPath,
    ])
  }, 60_000)

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  it("finds a match planted in the FAR CORNER of the matrix (prev offset 7 × next index 7)", async () => {
    // next: 7 unrelated frames (smptebars), then prev's frame 52 — which is
    // prev's offset-7 candidate (59 - 7 = 52) — then unrelated tail padding.
    // The ONLY high-PSNR pair is (prev candidate i=0/offset 7, next j=7):
    // the FIRST prev candidate against the LAST next candidate. A scan that
    // trimmed either loop would miss it.
    const { findSmartCutBoundary } = await import("../smart-cut.js")
    const nextPath = join(dir, "next_corner.mp4")
    // Single-pass build (one encode, deterministic frame order): 7 smptebars
    // frames, then prev's frames 52-53 (trim keeps real frame durations — a
    // 1-frame select segment gets eaten by concat), then 10 red frames.
    // Durations must be FULL precision: toFixed(4) rounds 7/24 up and lavfi
    // then emits an 8th bars frame, shifting the twin off index 7.
    // High CRF quality so the twin survives the re-encode. The twin sits at
    // next[7] (verified 51dB vs prev frame 52); frame 53 at next[8] is
    // OUTSIDE the 8-frame window, so (offset 7, index 7) — the far corner of
    // the matrix — is the unique in-window match.
    await ffmpeg([
      "-i", prevPath,
      "-f", "lavfi", "-i", `smptebars=size=${SIZE}:rate=${FPS}:duration=${7 / FPS}`,
      "-f", "lavfi", "-i", `color=c=red:size=${SIZE}:rate=${FPS}:duration=${10 / FPS}`,
      "-filter_complex",
      `[0:v]trim=start_frame=52:end_frame=54,setpts=PTS-STARTPTS[twin];[1:v][twin][2:v]concat=n=3:v=1:a=0[out]`,
      "-map", "[out]",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "12",
      nextPath,
    ])

    const cut = await findSmartCutBoundary(prevPath, nextPath, 8, 8)

    expect(cut.searchedPrevFrames).toBe(8)
    expect(cut.searchedNextFrames).toBe(8)
    expect(cut.matched).toBe(true)
    // Match at prev offset 7 → drop 7 tail frames; next index 7 → drop 8.
    expect(cut.trimEndFrames).toBe(7)
    expect(cut.trimStartFrames).toBe(8)
  }, 60_000)

  it("finds the natural continuation overlap (next = prev's tail from frame 54 → first identical pair wins)", async () => {
    const { findSmartCutBoundary } = await import("../smart-cut.js")
    // next: 60 frames of the SAME numbered testsrc2 starting at frame 54 —
    // next[j] === prev[54 + j] while both exist. Pairs with p + j = 5 are
    // all pixel-identical; the scan (prev candidates oldest-first) hits
    // (offset 5, index 0) first and > keeps the first maximum.
    const nextPath = join(dir, "next_overlap.mp4")
    await ffmpeg([
      "-f", "lavfi", "-i", uniqueFramesSrc(114),
      "-vf", `${UNIQ},select=gte(n\\,54),setpts=PTS-STARTPTS`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", nextPath,
    ])

    const cut = await findSmartCutBoundary(prevPath, nextPath, 8, 8)

    expect(cut.matched).toBe(true)
    expect(cut.trimEndFrames).toBe(5)
    expect(cut.trimStartFrames).toBe(1)
  }, 60_000)

  it("unrelated clips: best pair stays far below the threshold → matched:false", async () => {
    const { findSmartCutBoundary } = await import("../smart-cut.js")
    const nextPath = join(dir, "next_unrelated.mp4")
    await ffmpeg([
      "-f", "lavfi", "-i", `smptebars=size=${SIZE}:rate=${FPS}:duration=1`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", nextPath,
    ])

    const cut = await findSmartCutBoundary(prevPath, nextPath, 8, 8)

    expect(cut.matched).toBe(false)
  }, 60_000)
})
