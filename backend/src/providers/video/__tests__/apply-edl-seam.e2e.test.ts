/**
 * Real-ffmpeg proof that a chunked render loses no frame at a seam that lands
 * exactly on a half frame (decided 2026-10-05: fix it now). The 4K probe's
 * 11-segment edits, planned as chunks [10, 1], came out at 520 of 521 frames —
 * at 4K and 1080p, every run: the slice grid rounded (15.95 + 1.4)·30 =
 * 520.4999… DOWN, while the exact position, 17 350 ms, is frame 520.5 and
 * rounds UP (`frameAtMs`). The same shape is rendered here at 30, 25 and
 * 29.97 fps (an NTSC 30000/1001 source), and the output must hold exactly
 * frameAtMs(total) frames, with every cut — the seam included — on the global
 * grid, and its sound ending on the edit's length.
 *
 * Harness as in `apply-edl-proxy-audio.e2e.test.ts`: a synchronous
 * ffmpeg-availability skip (CI installs the production-pinned build), and a
 * partial mock of ONLY `downloadFile` so sources "download" from local lavfi
 * fixtures. Every render is `checkpoint:false` and must never reach storage.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { basename, dirname, join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import type { Edl } from "@nodaro/shared"
import { ffmpegAvailable, frameRuns, makeSource, trackDetail } from "./apply-edl-e2e-helpers.js"
import { frameAtMs, frameRateOf } from "../apply-edl-frame-grid.js"

vi.mock("../ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ffmpeg-utils.js")>()
  return {
    ...actual,
    downloadFile: async (url: string, dest: string): Promise<void> => {
      const dir = process.env.APPLY_EDL_FIXTURE_DIR
      if (!dir) throw new Error("fixture dir not set")
      await fs.copyFile(join(dir, basename(new URL(url).pathname)), dest)
    },
  }
})
// A `checkpoint:false` render never imports storage; if one ever did, it fails here.
vi.mock("../../../lib/storage.js", () => {
  const untouchable = async (): Promise<never> => {
    throw new Error("a checkpoint:false render must not touch storage")
  }
  return { getR2ObjectSize: untouchable, downloadR2ObjectToFile: untouchable, uploadFileWithKeyToR2: untouchable, deleteFromR2: untouchable }
})

vi.setConfig({ testTimeout: 180_000 })

const { applyEdl, resolveChunksForOutput } = await import("../apply-edl.js")

// Each shape: 11 cuts alternating red (A) / blue (B), chunks [10, 1], total on
// an exact half frame that float arithmetic rounded the wrong way.
const SHAPES = [
  { fps: 30, sourceRate: "30", lens: [...Array(9).fill(1500), 2450, 1400], frames: 521 },
  { fps: 25, sourceRate: "25", lens: [...Array(9).fill(1000), 8120, 220], frames: 434 },
  { fps: 29.97, sourceRate: "30000/1001", lens: [...Array(9).fill(1010), 40_680, 230], frames: 1499 },
] as const

describe.skipIf(!ffmpegAvailable)("a chunked render keeps every frame at a half-frame seam (real ffmpeg)", () => {
  let dir: string
  const renderDirs: string[] = []

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "apply-edl-seam-"))
    process.env.APPLY_EDL_FIXTURE_DIR = dir
    await Promise.all(
      SHAPES.flatMap(({ fps, sourceRate, lens }) => {
        const sec = Math.ceil(Math.max(...lens) / 1000) + 1
        return [
          makeSource(join(dir, `a${fps}.mp4`), "red", 440, sec, sourceRate),
          makeSource(join(dir, `b${fps}.mp4`), "blue", 880, sec, sourceRate),
        ]
      }),
    )
  })

  afterAll(async () => {
    await Promise.all([dir, ...renderDirs].map((d) => fs.rm(d, { recursive: true, force: true })))
    delete process.env.APPLY_EDL_FIXTURE_DIR
  })

  for (const { fps, lens, frames } of SHAPES) {
    it(`[10, 1] at ${fps} fps: ${frames} frames, every cut on the global grid, sound on the total`, async () => {
      const segments = lens.map((len, i) => ({ id: `s${i}`, inMs: 0, outMs: len, video: i % 2 === 0 ? "A" : "B" }))
      const edl: Edl = {
        version: 1, clock: "master",
        sources: [
          { id: "A", url: `https://fixtures.test/a${fps}.mp4`, kind: "video" },
          { id: "B", url: `https://fixtures.test/b${fps}.mp4`, kind: "video" },
        ],
        segments,
      }
      const plan = { chunkThreshold: 10, maxSegmentsPerChunk: 10 }
      expect(resolveChunksForOutput(edl.segments, "video", plan).map((c) => c.length)).toEqual([10, 1])

      const out = await applyEdl({ edl, output: "video", quality: "final", jobId: `t-seam-${fps}`, checkpoint: false, ...plan })
      renderDirs.push(dirname(out.outputPath))

      const rate = frameRateOf(fps)
      const totalMs = lens.reduce((a, b) => a + b, 0)
      expect(frameAtMs(totalMs, rate)).toBe(frames)
      const d = await trackDetail(out.outputPath)
      expect(Number(d.vframes), `frames ${JSON.stringify(d)}`).toBe(frames)
      // Each segment's run of colour is its exact share of the global grid —
      // the seam (between the 10th and 11th cut) included.
      let at = 0
      const expected = lens.map((len, i) => {
        const n = frameAtMs(at + len, rate) - frameAtMs(at, rate)
        at += len
        return `${i % 2 === 0 ? "R" : "B"}${n}`
      })
      expect(await frameRuns(out.outputPath)).toBe(expected.join(" "))
      expect(Math.abs(d.audio - totalMs / 1000), `audio end ${JSON.stringify(d)}`).toBeLessThan(1 / fps)
    })
  }
})
