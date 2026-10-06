// The EDL timeline on real ffmpeg, for what Apply EDL never drew (Speaker
// View C2.0): an `xfade:<id>` layout switch (F8) and a picture built from
// several slots, chunked by branch count, frame-locked to its sound (F9's A/V
// half). The pinned image's numbers are the authority; these assertions are
// coarse on purpose (which half shows which camera), so a dev box's ffmpeg
// answers the same.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { promises as fs } from "node:fs"
import { basename, dirname, join } from "node:path"
import { tmpdir } from "node:os"
import type { Edl } from "@nodaro/shared"
import { edlDurationMs } from "@nodaro/shared"
import { ffmpegAvailable, makeSource, decodeSound, goertzel, trackDetail, ONE_FRAME } from "./apply-edl-e2e-helpers.js"
import { runFfmpeg } from "../ffmpeg-utils.js"
import { frameAtMs, frameRateOf } from "../apply-edl-frame-grid.js"
import type { EdlPictureBuilder } from "../edl-picture.js"
import { scalePadChain } from "../edl-picture-fullframe.js"

const calls = vi.hoisted(() => ({ ffmpeg: 0 }))
vi.mock("../ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ffmpeg-utils.js")>()
  return {
    ...actual,
    runFfmpeg: async (args: readonly string[], timeoutMs?: number, launch?: Parameters<typeof actual.runFfmpeg>[2]) => {
      if (args.includes("-/filter_complex")) calls.ffmpeg++
      return actual.runFfmpeg(args, timeoutMs, launch)
    },
    downloadFile: async (url: string, dest: string): Promise<void> => {
      await fs.copyFile(join(process.env.EDL_TIMELINE_FIXTURE_DIR!, basename(new URL(url).pathname)), dest)
    },
  }
})

const { renderEdlTimeline } = await import("../edl-timeline.js")

const src = (id: string, file: string) => ({ id, url: `https://f.test/${file}`, kind: "video" })

/** Average RGB of the left or right half of the frame at output time `t`. */
async function halfColour(path: string, t: number, half: "left" | "right"): Promise<string> {
  const raw = join(tmpdir(), `tl-px-${Math.random().toString(36).slice(2)}.raw`)
  const crop = half === "left" ? "crop=iw/2:ih:0:0" : "crop=iw/2:ih:iw/2:0"
  await runFfmpeg(["-y", "-ss", String(t), "-i", path, "-frames:v", "1", "-vf", `${crop},scale=1:1`, "-f", "rawvideo", "-pix_fmt", "rgb24", raw])
  const [r, g, b] = await fs.readFile(raw)
  await fs.rm(raw, { force: true })
  return r! > 150 && g! < 100 && b! < 100 ? "red" : b! > 150 && r! < 100 && g! < 100 ? "blue" : `?(${r},${g},${b})`
}

/** Tone energy at `freq` in a 0.2 s window centred on output time `t`. */
function toneAt(sound: Float64Array, t: number, freq: number): number {
  const at = Math.round((t - 0.1) * 8000)
  return goertzel(sound.subarray(at, at + 1600), 8000, freq)
}

describe.skipIf(!ffmpegAvailable)("EDL timeline (real ffmpeg)", () => {
  let dir: string
  const outs: string[] = []

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "edl-timeline-test-"))
    process.env.EDL_TIMELINE_FIXTURE_DIR = dir
    await makeSource(join(dir, "red.mp4"), "red", 440, 12)
    await makeSource(join(dir, "blue.mp4"), "blue", 880, 12)
  }, 60_000)

  afterAll(async () => {
    await Promise.all([dir, ...outs].map((d) => fs.rm(d, { recursive: true, force: true })))
  })

  // F8 — `xfade:wipe-left` at a DISCONTINUOUS boundary (master 3 s → 6 s), the
  // only place SV21 c lets a renderer write one: the wipe over the picture, a
  // crossfade over the sound, the overlap off the length.
  it("renders an xfade:wipe-left switch: two cameras side by side mid-wipe, the voices blended, the overlap consumed", async () => {
    const edl = {
      version: 1, clock: "master",
      sources: [src("A", "red.mp4"), src("B", "blue.mp4")],
      segments: [
        { id: "s0", inMs: 0, outMs: 3000, video: "A" },
        { id: "s1", inMs: 6000, outMs: 9000, video: "B", layout: { mode: "single", transition: { type: "xfade:wipe-left", durationMs: 1000 } } },
      ],
    } as unknown as Edl
    const { outputPath, durationMs } = await renderEdlTimeline({ edl, output: "video", quality: "final", jobId: "t-f8", checkpoint: false, label: "speaker-view" })
    outs.push(dirname(outputPath))
    expect(durationMs).toBe(edlDurationMs(edl))
    expect(durationMs).toBe(5000)
    const t = await trackDetail(outputPath)
    expect(t.vframes).toBe(String(frameAtMs(5000, frameRateOf(30))))
    expect(Math.abs(t.audio - 5)).toBeLessThan(0.05)
    expect(t.drift).toBeLessThan(ONE_FRAME)

    expect([await halfColour(outputPath, 1, "left"), await halfColour(outputPath, 1, "right")]).toEqual(["red", "red"])
    const mid = [await halfColour(outputPath, 2.5, "left"), await halfColour(outputPath, 2.5, "right")]
    expect(mid.slice().sort()).toEqual(["blue", "red"])
    expect([await halfColour(outputPath, 4.2, "left"), await halfColour(outputPath, 4.2, "right")]).toEqual(["blue", "blue"])

    const sound = await decodeSound(outputPath)
    expect(toneAt(sound, 1, 440)).toBeGreaterThan(10 * toneAt(sound, 1, 880))
    expect(toneAt(sound, 4.2, 880)).toBeGreaterThan(10 * toneAt(sound, 4.2, 440))
    // mid-blend both voices are heard
    const [lo, hi] = [toneAt(sound, 2.5, 440), toneAt(sound, 2.5, 880)]
    expect(Math.min(lo, hi)).toBeGreaterThan(0.1 * Math.max(lo, hi))
  }, 120_000)

  // F9's A/V half (its timing half needs the pinned image): a two-slot
  // composite on every segment halves the picture cap, so 40 segments render
  // as three picture chunks plus the one sound pass — and every frame is on
  // the grid, the sound exactly as long.
  it("composites two slots per segment, chunked by branch count, frame-locked to its sound", async () => {
    const segments = Array.from({ length: 40 }, (_, i) => ({
      id: `s${i}`, inMs: i * 233, outMs: (i + 1) * 233, video: "A",
      layout: { mode: "side-by-side", slots: i % 2 ? [{ source: "B" }, { source: "A" }] : [{ source: "A" }, { source: "B" }] },
    }))
    const edl = { version: 1, clock: "master", sources: [src("A", "red.mp4"), src("B", "blue.mp4")], segments } as unknown as Edl
    const sideBySide: EdlPictureBuilder = (ctx) => {
      if (ctx.slots.length === 1) return { chain: scalePadChain(ctx.canvas) }
      const w = ctx.canvas.width / 2
      const s = ctx.scope
      return {
        graph: ctx.slots.map((slot, j) => `${slot.label}scale=${w}:${ctx.canvas.height},setsar=1[${s}${j}]`).join(";") +
          `;[${s}0][${s}1]hstack=inputs=2${ctx.output}`,
      }
    }
    calls.ffmpeg = 0
    const { outputPath } = await renderEdlTimeline({
      edl, output: "video", quality: "proxy", jobId: "t-f9", checkpoint: false, picture: sideBySide, canvas: { width: 320, height: 180 }, label: "speaker-view",
    })
    outs.push(dirname(outputPath))
    expect(calls.ffmpeg).toBe(3 + 2) // ceil(40 / 15) picture chunks + ceil(40 / 30) sound slices
    const t = await trackDetail(outputPath)
    expect(t.vframes).toBe(String(frameAtMs(edlDurationMs(edl), frameRateOf(30))))
    expect(t.drift).toBeLessThan(ONE_FRAME)
    // segment 0 (0–233 ms): A left, B right; segment 1 (233–466 ms): swapped
    expect([await halfColour(outputPath, 0.1, "left"), await halfColour(outputPath, 0.1, "right")]).toEqual(["red", "blue"])
    expect([await halfColour(outputPath, 0.35, "left"), await halfColour(outputPath, 0.35, "right")]).toEqual(["blue", "red"])
  }, 180_000)
})
