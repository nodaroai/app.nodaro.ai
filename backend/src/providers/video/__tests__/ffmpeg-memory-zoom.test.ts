// The slice memory model's ZOOM term (decided 2026-10-07, per zoomed segment
// since 2026-10-10, refit on the pinned build's own thread counts, one straight
// slope in T, 2026-10-11).
// A Speaker View zoom crops its camera to the start box and scales that window
// (about 1.56x the canvas) on every frame of the segment, so a slice that draws
// one holds more than the canvas model predicts - and more again for every
// zoomed segment (each is its own crop + scale branch of the graph).
// Measured rows, ffmpeg's own peak RSS, zoom slice against a static slice:
//   one zoom (the Speaker View plugin's F4b / F4c probes, one-segment 1080p):
//     2 threads (pinned n8.1.2, the 2-vCPU CI runner): +103 to +118 MiB, flat
//     in the box; 16 / 32 / 48 threads (macOS, ffmpeg 9.0.2): about +330 /
//     +260 / +350 MiB;
//   many zooms, pinned n8.1.2 at 2 threads (the C4 Speaker View cost probe);
//   many zooms, pinned n8.1.2 with the thread counts FORCED to 2 / 16 / 32 on
//     the nodaro-ci runner, 720p proxy and 1080p final, Z = 2 ... 28 (the
//     zoom-memory probe, 3 reps per row): SWEEP below. Four 1080p rows are
//     FLOORS (the harness stopped ffmpeg at its RSS ceiling: the 8 GB container
//     cannot hold the real peak), and the rows that ran into the venue's
//     1,000-pid cap are flagged: their memory is what that venue produced.
//   the same harness locally (macOS, ffmpeg 9.0.2 - local-only), kept as
//     extra coverage; it was the thread-slope basis before the pinned sweep.
// BASE PER CAMERA (decided 2026-10-11): the canvas model's base was fitted on
// single-source slices (one input file). The multicam slices of the same runs
// (Apply EDL's 3-camera `aedl-mc3`, Speaker View's `sv2-zoom`, the one-camera
// `z0`) hold more at 16+ threads, so the base carries a per-input term:
// (inputs - 1) * (T - 2) * 9 MiB, `inputs` = the ffmpeg input files the slice
// opens. Every row below states its input count (the harness records it for the
// later runs; the earlier ones are pinned at the lowest count their shape
// allows, so a pass is a pass for any real count above it). One input is the
// model of 2026-10-05 to the MiB.
// The zoom TERM covers every measured excess, and the WHOLE prediction covers
// every pinned row by 5 % or more (floors included). The picture builder says
// which segments draw a zoom (`memoryHint.zoom` on its fragment); a builder
// that says nothing gets exactly today's prediction.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { Edl, EdlSegment } from "@nodaro/shared/edl"
import type { FfmpegThreads } from "../ffmpeg-threads.js"

const fx = vi.hoisted(() => ({
  launches: [] as Array<{ out: string; opts: { peakMemoryMiB?: number } | undefined }>,
  /** What the picture-size probe answers for every video source ("WxH"). */
  cameraSize: "1920x1080\n",
  threads: undefined as { decode: number; filter: number; encode: number } | undefined,
}))

vi.mock("../ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ffmpeg-utils.js")>()
  return {
    ...actual,
    downloadFile: async () => {},
    // the picture-size probe answers the cameras' size (fx.cameraSize), everything else "has audio"
    runFfprobe: async (args: readonly string[]) => (args.includes("stream=width,height") ? fx.cameraSize : "audio\n"),
    probeStreamEnds: async () => ({ video: { state: "measured", endSec: 10_000 }, audio: { state: "measured", endSec: 10_000 } }),
    ffmpegVersionLine: async () => "ffmpeg version test",
    runFfmpeg: async (args: readonly string[], _timeoutMs?: number, opts?: { peakMemoryMiB?: number }) => {
      fx.launches.push({ out: String(args[args.length - 1]), opts })
      return ""
    },
  }
})
vi.mock("../ffmpeg-threads.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ffmpeg-threads.js")>()
  return {
    ...actual,
    ffmpegThreads: () => fx.threads,
    ffmpegEffectiveThreads: () => fx.threads ?? actual.ffmpegAutoThreadsFor(8),
  }
})
vi.mock("../../../lib/storage.js", () => ({
  getR2ObjectSize: async () => 0,
  downloadR2ObjectToFile: async () => {},
  uploadFileWithKeyToR2: async () => {},
  deleteFromR2: async () => {},
}))
vi.mock("../combine-videos.js", () => ({
  pickTargetResolution: async () => ({ width: 1920, height: 1080 }),
  pickTargetFps: async () => 30,
}))

import { canvasPeakMemoryMiB, zoomPeakMemoryMiB } from "../ffmpeg-memory-model.js"
import { buildSliceCommand, type SliceOptions } from "../apply-edl-slice.js"
import { renderEdlTimeline, slicePeakMemoryMiB } from "../edl-timeline.js"
import { pictureFragmentError, type EdlPictureBuilder, type EdlPictureContext } from "../edl-picture.js"
import { scalePadChain } from "../edl-picture-fullframe.js"

const FHD = { width: 1920, height: 1080 }
const PORTRAIT = { width: 1080, height: 1920 }
const UHD = { width: 3840, height: 2160 }
const same = (t: number): FfmpegThreads => ({ decode: t, filter: t, encode: t })
/** The cameras every memory row was measured with: 1080p (megapixels). */
const CAM = (1920 * 1080) / 1e6

const HD = { width: 1280, height: 720 }
const mpOf = (c: { width: number; height: number }) => (c.width * c.height) / 1e6

// [canvas, threads, zoomed segments, zoom slice peak MiB, static slice peak MiB, where]
//
// ONE ZOOM — every row of the plugin's F4b / F4c tables. The pinned rows are
// paired per framing (box 0.40, 0.35, 0.19 at 9:16, 0.05, 0.03). The pinned
// runner is 2 vCPU: its harness launches at `availableParallelism()` = 2, the
// count its quoted predictor (604 MiB) is computed at — the tables' "4
// threads" label does not match that predictor. The local rows are ranges;
// each is taken at its worst pairing (the highest zoom peak over the lowest
// static one). The 48-thread row is indicative only (its static peak sits
// below the 32-thread one).
//
// MANY ZOOMS — the C4 probe: `sv2-zoom` (one camera per segment, all but an
// edit's first two segments zoomed: Z = 8 of N = 10, 28 or 30 of N = 30)
// against `aedl-mc3` at the same N, each at its worst pairing over every chunk
// of every rep. Pinned: 3 slices at Z = 8, 12 at Z = 28, 15 at Z = 30. Local:
// one rep per thread count — the only multi-zoom rows above 2 threads.
const MEASURED: Array<[typeof FHD, number, number, number, number, string]> = [
  [FHD, 2, 1, 535, 421, "F4, pinned n8.1.2, box 0.40"],
  [FHD, 2, 1, 522, 419, "F4, pinned n8.1.2, box 0.35"],
  [PORTRAIT, 2, 1, 539, 422, "F4, pinned n8.1.2, box 0.19 (9:16)"],
  [FHD, 2, 1, 526, 421, "F4, pinned n8.1.2, box 0.05"],
  [FHD, 2, 1, 540, 423, "F4, pinned n8.1.2, box 0.03"],
  [FHD, 16, 1, 945, 606, "F4, macOS 9.0.2"],
  [FHD, 32, 1, 1425, 1154, "F4, macOS 9.0.2 (production's quota)"],
  [FHD, 48, 1, 1266, 904, "F4, macOS 9.0.2, indicative"],
  [FHD, 2, 8, 1202, 662, "C4, pinned n8.1.2, final N = 10"],
  [FHD, 2, 28, 2725, 1020, "C4, pinned n8.1.2, final N = 30"],
  [FHD, 2, 30, 2822, 1020, "C4, pinned n8.1.2, final N = 30"],
  [HD, 2, 8, 606, 317, "C4, pinned n8.1.2, proxy N = 10"],
  [HD, 2, 28, 1466, 488, "C4, pinned n8.1.2, proxy N = 30"],
  [HD, 2, 30, 1542, 488, "C4, pinned n8.1.2, proxy N = 30"],
  [FHD, 2, 8, 1110, 569, "C4, local macOS 9.0.2, final N = 10"],
  [FHD, 2, 28, 2304, 934, "C4, local macOS 9.0.2, final N = 30"],
  [HD, 2, 8, 563, 274, "C4, local macOS 9.0.2, proxy N = 10"],
  [HD, 2, 28, 1409, 424, "C4, local macOS 9.0.2, proxy N = 30"],
  [FHD, 16, 8, 1594, 1091, "C4, local macOS 9.0.2, final N = 10"],
  [FHD, 16, 28, 3186, 1456, "C4, local macOS 9.0.2, final N = 30"],
  [HD, 16, 8, 962, 689, "C4, local macOS 9.0.2, proxy N = 10"],
  [HD, 16, 28, 2134, 970, "C4, local macOS 9.0.2, proxy N = 30"],
  [FHD, 32, 8, 2199, 1624, "C4, local macOS 9.0.2, final N = 10"],
  [FHD, 32, 28, 4151, 2095, "C4, local macOS 9.0.2, final N = 30"],
  [HD, 32, 8, 1489, 1165, "C4, local macOS 9.0.2, proxy N = 10"],
  [HD, 32, 28, 3039, 1584, "C4, local macOS 9.0.2, proxy N = 30"],
]
/** The multi-zoom slices whose segment count is known (N = 10 or 30), as
 *  [canvas, threads, Z, N, zoom slice peak, static slice peak, where]. */
const multiZoom = (pinned: boolean) =>
  MEASURED.filter(([, , z, , , where]) => z > 1 && where.includes("pinned") === pinned).map(
    ([canvas, t, z, zoom, still, where]) => [canvas, t, z, where.endsWith("N = 10") ? 10 : 30, zoom, still, where] as const,
  )
/** The pinned ones, for the whole prediction: the build production runs, and
 *  the one the canvas model was fitted on — but all at 2 threads. */
const PINNED_MULTI = multiZoom(true)
/** The local ones (macOS, ffmpeg 9.0.2): the only multi-zoom slices above 2
 *  threads, on a build whose static slices the canvas model was not fitted on. */
const LOCAL_MULTI = multiZoom(false)

type SweepRow = [canvas: typeof FHD, threads: number, segments: number, zoomed: number, peakMiB: number, staticMiB: number | null, flags: string]
/** The zoom-memory probe, pinned n8.1.2 on the nodaro-ci runner (AMD EPYC
 *  9655/9655P, 2 vCPU quota, 8 GB, pids.max 1000), thread counts FORCED
 *  (`-threads` / `-filter_complex_threads` = T, x264's own SEI confirms T):
 *  Speaker View `sv2-zoom` (one camera per segment, all but the first two
 *  segments zoomed: Z = N - 2) against Apply EDL's static multicam slice
 *  `aedl-mc3` of the same N. Each row is the HIGHEST ffmpeg maxrss over its
 *  3 reps (rep spread under 3 %); `staticMiB` is the highest static peak at
 *  the same canvas, T and N where that N was run. Flags: "floor" = ffmpeg was
 *  stopped at the harness's RSS ceiling (5.3-6.0 GB), so the peak is a LOWER
 *  BOUND of the real one; "pidCapped" = the pids cgroup refused ffmpeg's
 *  thread creation during the row (swscaler: Resource temporarily
 *  unavailable) - ffmpeg ran with fewer threads than T asked for. */
const SWEEP: SweepRow[] = [
[FHD, 2, 4, 2, 679, 532, ""],
  [FHD, 2, 6, 4, 857, null, ""],
  [FHD, 2, 8, 6, 1030, null, ""],
  [FHD, 2, 10, 8, 1197, 666, ""],
  [FHD, 2, 15, 13, 1581, null, ""],
  [FHD, 2, 20, 18, 1966, 847, ""],
  [FHD, 2, 25, 23, 2414, null, ""],
  [FHD, 2, 30, 28, 2720, 1041, ""],
  [FHD, 16, 4, 2, 1120, 962, ""],
  [FHD, 16, 6, 4, 1320, null, ""],
  [FHD, 16, 8, 6, 1535, null, ""],
  [FHD, 16, 10, 8, 1733, 1174, ""],
  [FHD, 16, 15, 13, 2099, null, "pidCapped"],
  [FHD, 16, 20, 18, 3826, 1390, "pidCapped"],
  [FHD, 16, 25, 23, 5308, null, "floor"],
  [FHD, 16, 30, 28, 6051, 1562, "floor"],
  [FHD, 32, 4, 2, 1666, 1456, ""],
  [FHD, 32, 6, 4, 1949, null, ""],
  [FHD, 32, 8, 6, 2141, null, "pidCapped"],
  [FHD, 32, 10, 8, 2826, 1783, "pidCapped"],
  [FHD, 32, 15, 13, 3974, null, "pidCapped"],
  [FHD, 32, 20, 18, 5517, 2067, "pidCapped"],
  [FHD, 32, 25, 23, 5915, null, "floor"],
  [FHD, 32, 30, 28, 6003, 2271, "floor"],
  [HD, 2, 4, 2, 323, 245, ""],
  [HD, 2, 6, 4, 420, null, ""],
  [HD, 2, 8, 6, 523, null, ""],
  [HD, 2, 10, 8, 605, 320, ""],
  [HD, 2, 15, 13, 820, null, ""],
  [HD, 2, 20, 18, 1036, 411, ""],
  [HD, 2, 25, 23, 1296, null, ""],
  [HD, 2, 30, 28, 1467, 508, ""],
  [HD, 16, 4, 2, 606, 498, ""],
  [HD, 16, 6, 4, 749, null, ""],
  [HD, 16, 8, 6, 894, null, ""],
  [HD, 16, 10, 8, 1018, 700, ""],
  [HD, 16, 15, 13, 1281, null, "pidCapped"],
  [HD, 16, 20, 18, 2062, 861, "pidCapped"],
  [HD, 16, 25, 23, 3342, null, "pidCapped"],
  [HD, 16, 30, 28, 3867, 1022, "pidCapped"],
  [HD, 32, 4, 2, 925, 795, ""],
  [HD, 32, 6, 4, 1187, null, ""],
  [HD, 32, 8, 6, 1337, null, "pidCapped"],
  [HD, 32, 10, 8, 1701, 1126, "pidCapped"],
  [HD, 32, 15, 13, 2285, null, "pidCapped"],
  [HD, 32, 20, 18, 3055, 1394, "pidCapped"],
  [HD, 32, 25, 23, 4195, null, "pidCapped"],
  [HD, 32, 30, 28, 4782, 1581, "pidCapped"],
]
/** The static twins, [canvas, threads, segments, peak MiB]: Apply EDL's
 *  multicam slice (`aedl-mc3`, no zoom), same runs. */
const STATIC_MULTICAM: Array<[typeof FHD, number, number, number]> = [
[FHD, 2, 4, 532],
  [FHD, 2, 10, 666],
  [FHD, 2, 20, 847],
  [FHD, 2, 30, 1041],
  [FHD, 16, 4, 962],
  [FHD, 16, 10, 1174],
  [FHD, 16, 20, 1390],
  [FHD, 16, 30, 1562],
  [FHD, 32, 4, 1456],
  [FHD, 32, 10, 1783],
  [FHD, 32, 20, 2067],
  [FHD, 32, 30, 2271],
  [HD, 2, 4, 245],
  [HD, 2, 10, 320],
  [HD, 2, 20, 411],
  [HD, 2, 30, 508],
  [HD, 16, 4, 498],
  [HD, 16, 10, 700],
  [HD, 16, 20, 861],
  [HD, 16, 30, 1022],
  [HD, 32, 4, 795],
  [HD, 32, 10, 1126],
  [HD, 32, 20, 1394],
  [HD, 32, 30, 1581],
]

/** FEW ZOOMS AMONG MANY SEGMENTS (measured 2026-10-11, same harness and venue,
 *  N = 30 in every row, 3 reps, highest peak): [canvas, threads, cell, Z, peak].
 *  A zoom starts at a speaker change and runs to the END of the slice, so
 *  `z1`/`z2`/`z4` put the only change 1 / 2 / 4 segments from the end. `z0` =
 *  one camera, no change (2 inputs); `aedl-mc3` = the static multicam twin (4
 *  inputs); `zK` = K zooms (3 inputs). 720p is the proxy, 1080p the final. At
 *  32 threads the venue's pid cap was hit in every cell (the refused thread
 *  creations climb with Z), so Z = 4 holds less than Z = 2 there. */
const FEW_ZOOMS: Array<[typeof FHD, number, string, number, number]> = [
  [FHD, 2, "z0", 0, 987],
  [FHD, 2, "aedl-mc3", 0, 1037],
  [FHD, 2, "z1", 1, 1109],
  [FHD, 2, "z2", 2, 1196],
  [FHD, 2, "z4", 4, 1291],
  [FHD, 16, "z0", 0, 1427],
  [FHD, 16, "aedl-mc3", 0, 1580],
  [FHD, 16, "z1", 1, 1581],
  [FHD, 16, "z2", 2, 1704],
  [FHD, 16, "z4", 4, 1796],
  [FHD, 32, "z0", 0, 1862],
  [FHD, 32, "aedl-mc3", 0, 2269],
  [FHD, 32, "z1", 1, 2340],
  [FHD, 32, "z2", 2, 2705],
  [FHD, 32, "z4", 4, 2528],
  [HD, 2, "z0", 0, 441],
  [HD, 2, "aedl-mc3", 0, 498],
  [HD, 2, "z1", 1, 519],
  [HD, 2, "z2", 2, 557],
  [HD, 2, "z4", 4, 608],
  [HD, 16, "z0", 0, 848],
  [HD, 16, "aedl-mc3", 0, 1019],
  [HD, 16, "z1", 1, 972],
  [HD, 16, "z2", 2, 1049],
  [HD, 16, "z4", 4, 1111],
  [HD, 32, "z0", 0, 1160],
  [HD, 32, "aedl-mc3", 0, 1580],
  [HD, 32, "z1", 1, 1415],
  [HD, 32, "z2", 2, 1674],
  [HD, 32, "z4", 4, 1585],
]

/** ffmpeg INPUT FILES per measured slice, as the harness recorded them (`steps[].inputs`)
 *  for the few-zoom runs: `z0` = one camera + the master's sound, `aedl-mc3` = three
 *  cameras + the master, `zK` = two cameras (one change) + the master. */
const FEW_INPUTS: Record<string, number> = { z0: 2, "aedl-mc3": 4, z1: 3, z2: 3, z4: 3 }
/** The static multicam twins (`aedl-mc3`): three cameras + the master's sound. */
const STATIC_INPUTS = 4
/** SWEEP: `sv2-zoom` with Z = N - 2 has ONE speaker change (the zoom starts at
 *  it and is carried to the slice's end), i.e. two cameras + the master. The
 *  earlier runs' raw `inputs` field is not kept; this follows from the shape
 *  (the few-zoom `zK` cells, built the same way, recorded 3). */
const SWEEP_INPUTS = 3
/** C4 multi-zoom rows (pinned and local): a Speaker View slice always has the
 *  master's sound plus at least one camera - the LOWEST count their shape
 *  allows. A one-zoom F4 row: a single input. */
const MULTI_ZOOM_INPUTS = 2
const ONE_ZOOM_INPUTS = 1

/** The zoom term as the header states it. */
const expectedTerm = (canvas: typeof FHD, t: number, z: number) =>
  mpOf(canvas) * (44 + z * (26 + 6.5 * t))
/** The model's canvas-only prediction, unrounded, equal thread counts, with the
 *  per-input term for `inputs` files (one: the model of 2026-10-05). */
const baseOf = (canvas: typeof FHD, n: number, t: number, inputs = 1) =>
  257 + mpOf(canvas) * (136 + 8.85 * n + 11.05 * t) + (inputs - 1) * Math.max(0, t - 2) * 9

describe("zoomPeakMemoryMiB - the zoom's own term, per zoomed segment and thread-aware", () => {
  it("is MP·(44 + Z·(26 + 6.5·T)) MiB, T the graph's side of the counts (decode / filter): one straight slope, no knee", () => {
    for (const canvas of [FHD, HD, UHD]) {
      for (const t of [1, 2, 8, 16, 24, 32, 48]) {
        for (const z of [1, 8, 30]) {
          expect(zoomPeakMemoryMiB(canvas, same(t), z)).toBeCloseTo(expectedTerm(canvas, t, z), 6)
        }
      }
    }
  })

  it("is at or above EVERY measured zoom term (zoom slice minus static slice), by 5 % or more", () => {
    for (const [canvas, t, z, zoom, still, where] of MEASURED) {
      const term = zoomPeakMemoryMiB(canvas, same(t), z)
      expect(term, `${where}, ${t} threads, Z = ${z}: ${term.toFixed(1)} vs ${zoom - still}`).toBeGreaterThanOrEqual(1.05 * (zoom - still))
    }
    for (const [canvas, t, n, z, peak, still, flags] of SWEEP) {
      if (still === null) continue
      const term = zoomPeakMemoryMiB(canvas, same(t), z)
      expect(term, `${mpOf(canvas) > 1.5 ? "1080p" : "720p"} T=${t} N=${n} Z=${z} ${flags}: ${term.toFixed(1)} vs ${peak - still}`).toBeGreaterThanOrEqual(1.05 * (peak - still))
    }
  })

  it("is the round-up of the fit at 2 threads; at 16 and 32 the per-camera base lifts every whole prediction to 1.13x or more, so there the term alone is held to its 1.05x excess over the twin", () => {
    // Per thread count, over the SWEEP and the pinned multi-zoom rows: the
    // whole prediction (canvas model + per-input term + zoom term) over the
    // measured peak, and the zoom term over the measured excess on its static
    // twin. At 2 threads the per-input term is zero, so the term's own fit still
    // binds (the tightest row is within 12 % of 1.05). Before the per-camera base
    // (decided 2026-10-11) the 16-thread whole prediction bound at 1.06-1.09;
    // the two cameras the sweep's slices open now carry 252 MiB of it.
    for (const t of [2, 16, 32]) {
      const rows = [
        ...SWEEP.filter(([, tt]) => tt === t).map(([canvas, , n, z, peak, still]) => [canvas, n, z, peak, still, SWEEP_INPUTS] as const),
        ...PINNED_MULTI.filter(([, tt]) => tt === t).map(([canvas, , z, n, peak, still]) => [canvas, n, z, peak, still, MULTI_ZOOM_INPUTS] as const),
      ]
      const whole = rows.map(([canvas, n, z, peak, , inputs]) => (baseOf(canvas, n, t, inputs) + zoomPeakMemoryMiB(canvas, same(t), z)) / peak)
      const excess = rows.flatMap(([canvas, , z, peak, still]) => (still === null ? [] : [zoomPeakMemoryMiB(canvas, same(t), z) / (peak - still)]))
      expect(Math.min(...whole, ...excess), `${t} threads`).toBeGreaterThanOrEqual(1.05)
      expect(Math.min(...excess), `${t} threads, term over excess`).toBeGreaterThanOrEqual(1.05)
      if (t === 2) expect(Math.min(...whole, ...excess), `${t} threads`).toBeLessThan(1.12)
      else expect(Math.min(...whole), `${t} threads, whole prediction`).toBeGreaterThan(1.13)
    }
  })

  it("grows with every zoomed segment: a 30-zoom slice reserves 29 per-zoom parts more than a one-zoom slice", () => {
    for (const t of [2, 16, 32]) {
      const perZoom = expectedTerm(FHD, t, 1) - expectedTerm(FHD, t, 0)
      expect(zoomPeakMemoryMiB(FHD, same(t), 30) - zoomPeakMemoryMiB(FHD, same(t), 1)).toBeCloseTo(29 * perZoom, 6)
      expect(zoomPeakMemoryMiB(FHD, same(t), 30)).toBeGreaterThan(zoomPeakMemoryMiB(FHD, same(t), 28))
    }
  })

  it("follows the zoom count, not the graph size: two 30-segment chunks 2 zooms apart are 2 per-zoom parts apart, which covers the measured 1080p step but not the 720p one", () => {
    // Measured (pinned, T = 2, 9 edits): chunk 1 (30 zooms) holds +125 to
    // +167 MiB (1080p) / +80 to +95 (720p) over chunk 0 (28 zooms) of the same
    // 30 segments. The model's step of 2 per-zoom parts at T = 2 is 161.7 MiB
    // at 1080p (inside that range, below its top) and 71.9 at 720p (below all
    // of it): it does NOT cover the measured step. The 30-zoom slices are
    // covered whole only because of the term's slack - the SWEEP totals test
    // holds the whole prediction.
    const fhdStep = zoomPeakMemoryMiB(FHD, same(2), 30) - zoomPeakMemoryMiB(FHD, same(2), 28)
    const hdStep = zoomPeakMemoryMiB(HD, same(2), 30) - zoomPeakMemoryMiB(HD, same(2), 28)
    expect(fhdStep).toBeCloseTo(2 * mpOf(FHD) * 39, 6)
    expect(hdStep).toBeCloseTo(2 * mpOf(HD) * 39, 6)
    expect(fhdStep).toBeGreaterThan(125)
    expect(fhdStep).toBeLessThan(167)
    expect(hdStep).toBeLessThan(80)
  })

  it("grows with the graph's threads, not the encoder's (the zoom is filter-graph work), and linearly (no knee at 16)", () => {
    expect(zoomPeakMemoryMiB(FHD, same(32), 30)).toBeGreaterThan(zoomPeakMemoryMiB(FHD, same(2), 30))
    expect(zoomPeakMemoryMiB(FHD, { decode: 2, filter: 2, encode: 32 }, 30)).toBe(zoomPeakMemoryMiB(FHD, same(2), 30))
    expect(zoomPeakMemoryMiB(FHD, { decode: 2, filter: 32, encode: 2 }, 30)).toBe(zoomPeakMemoryMiB(FHD, same(32), 30))
    const perThread = (a: number, b: number) => (zoomPeakMemoryMiB(FHD, same(b), 30) - zoomPeakMemoryMiB(FHD, same(a), 30)) / (b - a)
    expect(perThread(16, 32)).toBeCloseTo(perThread(2, 16), 6)
    expect(perThread(2, 16)).toBeCloseTo(30 * mpOf(FHD) * 6.5, 6)
    expect(perThread(16, 32)).toBeCloseTo(30 * mpOf(FHD) * 6.5, 6)
  })

  it("scales with the canvas (its windows are canvas-sized): a 4K zoom predicts more than a 1080p one", () => {
    expect(zoomPeakMemoryMiB(UHD, same(32), 30)).toBeGreaterThan(zoomPeakMemoryMiB(FHD, same(32), 30))
  })

  it("counts a nonsensical zero or negative count as one zoomed segment (the caller passes a count only when one is drawn)", () => {
    expect(zoomPeakMemoryMiB(FHD, same(2), 0)).toBe(zoomPeakMemoryMiB(FHD, same(2), 1))
    expect(zoomPeakMemoryMiB(FHD, same(2), -3)).toBe(zoomPeakMemoryMiB(FHD, same(2), 1))
  })
})

/** Coverage = the whole reservation over the measured peak, to two decimals; at or above 1 = covered. */
const ratio = (reserved: number, measured: number) => Number((reserved / measured).toFixed(2))
const rowName = (canvas: typeof FHD) => (mpOf(canvas) > 1.5 ? "1080p" : "720p")

describe("canvasPeakMemoryMiB with zoomed segments", () => {
  it("is at or above EVERY measured one-zoom slice, never wildly above - each row's coverage pinned (one input: the per-camera term is zero)", () => {
    const coverage: Record<string, number> = {}
    for (const [canvas, t, z, zoom, , where] of MEASURED.filter(([, , z]) => z === 1)) {
      const predicted = canvasPeakMemoryMiB(canvas, 1, same(t), { cameraMegapixels: CAM, inputs: ONE_ZOOM_INPUTS, zoomSegments: z })
      const label = `${where}, ${t} threads: ${predicted} vs ${zoom}`
      expect(predicted, label).toBeGreaterThanOrEqual(zoom)
      // The per-slice part is the same at every thread count and the pinned
      // 2-thread rows sit well under the canvas model, so those come out ~1.9x.
      expect(predicted / zoom, label).toBeLessThan(2.1)
      coverage[`${where}, T=${t}`] = ratio(predicted, zoom)
    }
    expect(coverage).toEqual({
      "F4, pinned n8.1.2, box 0.40, T=2": 1.45,
      "F4, pinned n8.1.2, box 0.35, T=2": 1.49,
      "F4, pinned n8.1.2, box 0.19 (9:16), T=2": 1.44,
      "F4, pinned n8.1.2, box 0.05, T=2": 1.48,
      "F4, pinned n8.1.2, box 0.03, T=2": 1.44,
      "F4, macOS 9.0.2, T=16": 1.36,
      "F4, macOS 9.0.2 (production's quota), T=32": 1.31,
      "F4, macOS 9.0.2, indicative, T=48": 1.94,
    })
  })

  it("is at or above EVERY pinned multi-zoom slice at 2 threads (C4: they measured 1.83-1.98x the old reservation), and never wildly above - coverage pinned, one camera + the master", () => {
    const coverage: Record<string, number> = {}
    for (const [canvas, t, z, n, zoom, , where] of PINNED_MULTI) {
      const predicted = canvasPeakMemoryMiB(canvas, n, same(t), { cameraMegapixels: CAM, inputs: MULTI_ZOOM_INPUTS, zoomSegments: z })
      const label = `${where}, Z = ${z}: ${predicted} vs ${zoom}`
      expect(predicted, label).toBeGreaterThanOrEqual(zoom)
      expect(predicted / zoom, label).toBeLessThan(1.6)
      coverage[`${where}, T=${t}, Z=${z}`] = ratio(predicted, zoom)
    }
    expect(coverage).toEqual({
      "C4, pinned n8.1.2, final N = 10, T=2, Z=8": 1.25,
      "C4, pinned n8.1.2, final N = 30, T=2, Z=28": 1.28,
      "C4, pinned n8.1.2, final N = 30, T=2, Z=30": 1.29,
      "C4, pinned n8.1.2, proxy N = 10, T=2, Z=8": 1.34,
      "C4, pinned n8.1.2, proxy N = 30, T=2, Z=28": 1.16,
      "C4, pinned n8.1.2, proxy N = 30, T=2, Z=30": 1.15,
    })
  })

  it("SWEEP: the whole prediction (two cameras + the master) is 5 % or more above EVERY pinned row at 2 / 16 / 32 threads, 720p and 1080p, floors included - coverage pinned", () => {
    expect(SWEEP.length).toBe(48)
    const coverage: Record<string, number> = {}
    for (const [canvas, t, n, z, peak, , flags] of SWEEP) {
      const predicted = canvasPeakMemoryMiB(canvas, n, same(t), { cameraMegapixels: CAM, inputs: SWEEP_INPUTS, zoomSegments: z })
      const label = `${rowName(canvas)} T=${t} N=${n} Z=${z} ${flags}: ${predicted} vs ${peak}`
      expect(predicted, label).toBeGreaterThanOrEqual(1.05 * peak)
      expect(predicted / peak, label).toBeLessThan(3.2)
      coverage[`${rowName(canvas)} T=${t} N=${n} Z=${z}`] = ratio(predicted, peak)
    }
    expect(coverage).toEqual({
      "1080p T=2 N=4 Z=2": 1.34, "1080p T=2 N=6 Z=4": 1.3, "1080p T=2 N=8 Z=6": 1.27, "1080p T=2 N=10 Z=8": 1.26,
      "1080p T=2 N=15 Z=13": 1.27, "1080p T=2 N=20 Z=18": 1.27, "1080p T=2 N=25 Z=23": 1.24, "1080p T=2 N=30 Z=28": 1.28,
      "1080p T=16 N=4 Z=2": 1.66, "1080p T=16 N=6 Z=4": 1.85, "1080p T=16 N=8 Z=6": 1.96, "1080p T=16 N=10 Z=8": 2.07,
      "1080p T=16 N=15 Z=13": 2.4, "1080p T=16 N=20 Z=18": 1.69, "1080p T=16 N=25 Z=23": 1.49, "1080p T=16 N=30 Z=28": 1.54,
      "1080p T=32 N=4 Z=2": 1.77, "1080p T=32 N=6 Z=4": 2.03, "1080p T=32 N=8 Z=6": 2.32, "1080p T=32 N=10 Z=8": 2.11,
      "1080p T=32 N=15 Z=13": 2.14, "1080p T=32 N=20 Z=18": 1.99, "1080p T=32 N=25 Z=23": 2.29, "1080p T=32 N=30 Z=28": 2.67,
      "720p T=2 N=4 Z=2": 1.7, "720p T=2 N=6 Z=4": 1.51, "720p T=2 N=8 Z=6": 1.39, "720p T=2 N=10 Z=8": 1.34,
      "720p T=2 N=15 Z=13": 1.26, "720p T=2 N=20 Z=18": 1.21, "720p T=2 N=25 Z=23": 1.14, "720p T=2 N=30 Z=28": 1.16,
      "720p T=16 N=4 Z=2": 1.83, "720p T=16 N=6 Z=4": 1.82, "720p T=16 N=8 Z=6": 1.81, "720p T=16 N=10 Z=8": 1.84,
      "720p T=16 N=15 Z=13": 1.97, "720p T=16 N=20 Z=18": 1.53, "720p T=16 N=25 Z=23": 1.14, "720p T=16 N=30 Z=28": 1.15,
      "720p T=32 N=4 Z=2": 1.9, "720p T=32 N=6 Z=4": 1.85, "720p T=32 N=8 Z=6": 1.98, "720p T=32 N=10 Z=8": 1.82,
      "720p T=32 N=15 Z=13": 1.84, "720p T=32 N=20 Z=18": 1.75, "720p T=32 N=25 Z=23": 1.54, "720p T=32 N=30 Z=28": 1.58,
    })
  })

  it("SWEEP: the four 1080p floors (ffmpeg was stopped at the RSS ceiling) are reserved above the ceiling they hit, and above 7 GB at 32 threads for a full slice", () => {
    const floors = SWEEP.filter(([, , , , , , flags]) => flags.includes("floor"))
    expect(floors.map(([, t, , z, peak]) => `T=${t} Z=${z} >= ${peak}`)).toEqual([
      "T=16 Z=23 >= 5308", "T=16 Z=28 >= 6051", "T=32 Z=23 >= 5915", "T=32 Z=28 >= 6003",
    ])
    for (const [canvas, t, n, z, peak] of floors) {
      expect(canvasPeakMemoryMiB(canvas, n, same(t), { cameraMegapixels: CAM, inputs: SWEEP_INPUTS, zoomSegments: z })).toBeGreaterThan(1.05 * peak)
    }
    // The real peaks are above the floors: measured steps at 32 threads climb
    // ~240 MiB per zoomed segment (Z = 8 to 18), which puts Z = 28 near 7.4 GB.
    expect(canvasPeakMemoryMiB(FHD, 30, same(32), { cameraMegapixels: CAM, inputs: SWEEP_INPUTS, zoomSegments: 28 })).toBeGreaterThan(7400)
  })

  it("STATIC MULTICAM (3 cameras + the master = 4 inputs): every twin row is reserved at 1.05x or more - the old base gap (up to -40 %) is closed; coverage pinned, with the single-input model's alongside", () => {
    // Apply EDL's 3-camera slice at 16 / 32 threads measured above the canvas
    // model's prediction, which was fitted on single-source slices (this table
    // used to pin the gap, down to -628 MiB). The per-camera term closes it.
    const coverage: Record<string, number> = {}
    const oneInput: Record<string, number> = {}
    for (const [canvas, t, n, peak] of STATIC_MULTICAM) {
      const name = `${rowName(canvas)} T=${t} N=${n}`
      const predicted = canvasPeakMemoryMiB(canvas, n, same(t), { cameraMegapixels: CAM, inputs: STATIC_INPUTS })
      expect(predicted, name).toBeGreaterThanOrEqual(1.05 * peak)
      coverage[name] = ratio(predicted, peak)
      oneInput[name] = ratio(canvasPeakMemoryMiB(canvas, n, same(t), { cameraMegapixels: CAM, inputs: 1 }), peak)
    }
    expect(coverage).toEqual({
      "1080p T=2 N=4": 1.24, "1080p T=2 N=10": 1.15, "1080p T=2 N=20": 1.12, "1080p T=2 N=30": 1.09,
      "1080p T=16 N=4": 1.41, "1080p T=16 N=10": 1.25, "1080p T=16 N=20": 1.19, "1080p T=16 N=30": 1.17,
      "1080p T=32 N=4": 1.48, "1080p T=32 N=10": 1.27, "1080p T=32 N=20": 1.19, "1080p T=32 N=30": 1.16,
      "720p T=2 N=4": 1.78, "720p T=2 N=10": 1.52, "720p T=2 N=20": 1.38, "720p T=2 N=30": 1.28,
      "720p T=16 N=4": 1.92, "720p T=16 N=10": 1.44, "720p T=16 N=20": 1.26, "720p T=16 N=30": 1.14,
      "720p T=32 N=4": 1.95, "720p T=32 N=10": 1.42, "720p T=32 N=20": 1.21, "720p T=32 N=30": 1.12,
    })
    // before: counted as one input (what the base alone reserved); below 1.05 = short of the target
    expect(Object.entries(oneInput).filter(([, r]) => r < 1.05).map(([k]) => k)).toEqual([
      "1080p T=16 N=4", "1080p T=16 N=10", "1080p T=16 N=20", "1080p T=16 N=30",
      "1080p T=32 N=4", "1080p T=32 N=10", "1080p T=32 N=20", "1080p T=32 N=30",
      "720p T=16 N=10", "720p T=16 N=20", "720p T=16 N=30", "720p T=32 N=4", "720p T=32 N=10", "720p T=32 N=20", "720p T=32 N=30",
    ])
    expect(Math.min(...Object.values(oneInput))).toBeLessThan(0.62)
  })

  it("FEW ZOOMS (N = 30, inputs as the harness recorded them: z0 2, z1/z2/z4 3, aedl-mc3 4): every row is reserved at 1.05x or more at 2 / 16 / 32 threads, one-camera and multicam, 720p and 1080p - coverage pinned", () => {
    // Used to pin the gap (720p at 32 threads reserved 0.85x of Z = 1-2, the
    // static twin 0.60x): the shortfall was the base's, not the zoom term's, and
    // the one-camera / multicam contrast (10-27 % apart) is the input count.
    expect(FEW_ZOOMS.length).toBe(30)
    const coverage: Record<string, number> = {}
    for (const [canvas, t, cell, z, peak] of FEW_ZOOMS) {
      const inputs = FEW_INPUTS[cell]!
      const predicted = canvasPeakMemoryMiB(canvas, 30, same(t), { cameraMegapixels: CAM, inputs, ...(z > 0 ? { zoomSegments: z } : {}) })
      expect(predicted, `${rowName(canvas)} T=${t} ${cell}`).toBeGreaterThanOrEqual(1.05 * peak)
      coverage[`${rowName(canvas)} T=${t} ${cell}`] = ratio(predicted, peak)
    }
    expect(coverage).toEqual({
      "1080p T=2 z0": 1.15, "1080p T=2 z1": 1.18, "1080p T=2 z2": 1.16,
      "1080p T=2 z4": 1.2, "1080p T=32 z0": 1.12, "1080p T=32 z1": 1.26,
      "1080p T=32 z2": 1.27, "1080p T=32 z4": 1.74, "720p T=32 z0": 1.05,
      "720p T=32 z1": 1.24, "720p T=32 z2": 1.17, "720p T=32 z4": 1.51,
      "720p T=2 z0": 1.47, "720p T=2 z1": 1.39, "720p T=2 z2": 1.36,
      "720p T=2 z4": 1.37, "720p T=16 z0": 1.08, "720p T=16 z1": 1.24,
      "720p T=16 z2": 1.26, "720p T=16 z4": 1.41, "1080p T=16 z0": 1.11,
      "1080p T=16 z1": 1.31, "1080p T=16 z2": 1.37, "1080p T=16 z4": 1.6,
      "1080p T=2 aedl-mc3": 1.1, "1080p T=32 aedl-mc3": 1.16, "720p T=32 aedl-mc3": 1.12,
      "720p T=2 aedl-mc3": 1.3, "720p T=16 aedl-mc3": 1.15, "1080p T=16 aedl-mc3": 1.16,
    })
  })

  it("FEW ZOOMS: the term covers 1.05x every few-zoom excess over the static multicam twin (the z0 one-camera slice is no twin: the zoom slices read a third input)", () => {
    for (const [canvas, t, cell, z, peak] of FEW_ZOOMS.filter(([, , , zz]) => zz > 0)) {
      const still = FEW_ZOOMS.find(([c, tt, cc]) => c === canvas && tt === t && cc === "aedl-mc3")![4]
      if (peak <= still) continue
      const term = zoomPeakMemoryMiB(canvas, same(t), z)
      expect(term, `${rowName(canvas)} T=${t} ${cell} over aedl-mc3`).toBeGreaterThanOrEqual(1.05 * (peak - still))
    }
  })

  it("covers the local macOS multi-zoom slices too (one camera + the master) - coverage pinned", () => {
    const coverage: Record<string, number> = {}
    for (const [canvas, t, z, n, zoom, , where] of LOCAL_MULTI) {
      const predicted = canvasPeakMemoryMiB(canvas, n, same(t), { cameraMegapixels: CAM, inputs: MULTI_ZOOM_INPUTS, zoomSegments: z })
      expect(predicted, `${where}, ${t} threads, Z = ${z}`).toBeGreaterThanOrEqual(zoom)
      coverage[`${where}, T=${t}, Z=${z}`] = ratio(predicted, zoom)
    }
    expect(coverage).toEqual({
      "C4, local macOS 9.0.2, final N = 10, T=2, Z=8": 1.36,
      "C4, local macOS 9.0.2, final N = 30, T=2, Z=28": 1.52,
      "C4, local macOS 9.0.2, proxy N = 10, T=2, Z=8": 1.44,
      "C4, local macOS 9.0.2, proxy N = 30, T=2, Z=28": 1.2,
      "C4, local macOS 9.0.2, final N = 10, T=16, Z=8": 2.17,
      "C4, local macOS 9.0.2, final N = 30, T=16, Z=28": 2.89,
      "C4, local macOS 9.0.2, proxy N = 10, T=16, Z=8": 1.82,
      "C4, local macOS 9.0.2, proxy N = 30, T=16, Z=28": 2.02,
      "C4, local macOS 9.0.2, final N = 10, T=32, Z=8": 2.59,
      "C4, local macOS 9.0.2, final N = 30, T=32, Z=28": 3.8,
      "C4, local macOS 9.0.2, proxy N = 10, T=32, Z=8": 1.9,
      "C4, local macOS 9.0.2, proxy N = 30, T=32, Z=28": 2.4,
    })
  })

  it("the C4 headline: a 30-zoom 1080p final slice at 2 threads predicts 3,653 MiB (measured up to 2,822; the old term 1,426) - the per-camera term is zero at 2 threads", () => {
    for (const inputs of [1, 3, undefined]) {
      expect(canvasPeakMemoryMiB(FHD, 30, same(2), { cameraMegapixels: CAM, inputs, zoomSegments: 30 })).toBe(3653)
      expect(canvasPeakMemoryMiB(FHD, 30, same(2), { cameraMegapixels: CAM, inputs, zoomSegments: 28 })).toBe(3491)
      expect(canvasPeakMemoryMiB(HD, 30, same(2), { cameraMegapixels: CAM, inputs, zoomSegments: 30 })).toBe(1767)
    }
  })

  it("production's quota (32 threads), a two-camera Speaker View slice (3 inputs): a 30-zoom slice reserves 17,011 MiB at 1080p and 8,004 at 720p, so the 25,622 MiB budget holds one of the finals", () => {
    expect(canvasPeakMemoryMiB(FHD, 30, same(32), { cameraMegapixels: CAM, inputs: 3, zoomSegments: 30 })).toBe(17011)
    expect(canvasPeakMemoryMiB(HD, 30, same(32), { cameraMegapixels: CAM, inputs: 3, zoomSegments: 30 })).toBe(8004)
    expect(Math.floor(25_622 / canvasPeakMemoryMiB(FHD, 30, same(32), { cameraMegapixels: CAM, inputs: 3, zoomSegments: 30 }))).toBe(1)
    // 4K cameras (a Speaker View slice drawn from 4K sources onto a 1080p canvas): the per-camera term x4
    expect(canvasPeakMemoryMiB(FHD, 30, same(32), { inputs: 3, cameraMegapixels: (3840 * 2160) / 1e6, zoomSegments: 30 })).toBe(17011 + 3 * 540)
    // one input is the reservation before the per-camera term (16,471 / 7,464)
    expect(canvasPeakMemoryMiB(FHD, 30, same(32), { cameraMegapixels: CAM, inputs: 1, zoomSegments: 30 })).toBe(16471)
    expect(canvasPeakMemoryMiB(HD, 30, same(32), { cameraMegapixels: CAM, inputs: 1, zoomSegments: 30 })).toBe(7464)
  })

  it("the static slices of the same pinned runs stay under the prediction without the zoom (the base model holds at 2 threads)", () => {
    for (const [canvas, t, , , still, where] of MEASURED.filter(([, , z, , , w]) => z === 1 && !w.includes("macOS"))) {
      expect(canvasPeakMemoryMiB(canvas, 1, same(t), { cameraMegapixels: CAM, inputs: ONE_ZOOM_INPUTS }), where).toBeGreaterThanOrEqual(still)
    }
    for (const [canvas, t, , n, , still, where] of PINNED_MULTI) {
      expect(canvasPeakMemoryMiB(canvas, n, same(t), { cameraMegapixels: CAM, inputs: STATIC_INPUTS }), where).toBeGreaterThanOrEqual(still)
    }
  })

  it("production's quota (32 threads), 1080p: one zoomed segment predicts 1,868 MiB on one input and 2,138 on two (one-zoom measured 1,410-1,425; 1,291 without the zoom)", () => {
    expect(canvasPeakMemoryMiB(FHD, 1, same(32), { cameraMegapixels: CAM, inputs: 1 })).toBe(1291)
    expect(canvasPeakMemoryMiB(FHD, 1, same(32), { cameraMegapixels: CAM, inputs: 1, zoomSegments: 1 })).toBe(1868)
    expect(canvasPeakMemoryMiB(FHD, 1, same(32), { cameraMegapixels: CAM, inputs: 2, zoomSegments: 1 })).toBe(2138)
  })

  it("is the canvas model plus the per-input term plus the zoom term, rounded up once", () => {
    for (const t of [1, 2, 8, 32]) {
      for (const n of [1, 7, 30]) {
        for (const z of [1, 7]) {
          for (const inputs of [1, 3]) {
            const exact = 257 + (UHD.width * UHD.height / 1e6) * (136 + 8.85 * n + 11.05 * t) + (inputs - 1) * Math.max(0, t - 2) * 9 + zoomPeakMemoryMiB(UHD, same(t), z)
            expect(canvasPeakMemoryMiB(UHD, n, same(t), { cameraMegapixels: CAM, inputs, zoomSegments: z })).toBe(Math.ceil(exact - 1e-9))
          }
        }
      }
    }
  })

  it("no hint, or zero zoomed segments, is the same prediction, to the MiB", () => {
    for (const t of [1, 2, 16, 32]) {
      for (const inputs of [1, 3, undefined]) {
        const today = canvasPeakMemoryMiB(UHD, 30, same(t), { cameraMegapixels: CAM, inputs })
        expect(canvasPeakMemoryMiB(UHD, 30, same(t), { cameraMegapixels: CAM, inputs, zoomSegments: 0 })).toBe(today)
        expect(canvasPeakMemoryMiB(UHD, 30, same(t), { cameraMegapixels: CAM, inputs, zoomSegments: undefined })).toBe(today)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// The hint: the picture builder tells the timeline a segment draws a zoom.

const EDL: Edl = {
  version: 1,
  clock: "master",
  sources: [{ id: "A", url: "https://f.test/a.mp4", kind: "video" }],
  segments: Array.from({ length: 6 }, (_, k) => ({ id: `s${k}`, inMs: k * 1000, outMs: (k + 1) * 1000, video: "A" })),
} as unknown as Edl
const OPTS: SliceOptions = {
  output: "video", quality: "final", target: FHD, fps: 30, chunkStartMs: 0, masterAudioId: undefined, audioPresent: new Map([["A", true]]),
  sourceSizes: new Map([["A", FHD], ["B", FHD]]), // 1080p cameras, the size the memory rows were measured with
}
/** Draws the full frame; segments whose id is in `zoomed` say they zoom. */
const zoomingOn = (...zoomed: string[]): EdlPictureBuilder => (ctx) => ({
  chain: scalePadChain(ctx.canvas),
  ...(zoomed.includes(ctx.segment.id) ? { memoryHint: { zoom: true } } : {}),
})

describe("a picture fragment carries an optional memory hint", () => {
  const ctx = { segment: { id: "s0" }, slots: [{}], output: "[p0o]" } as unknown as EdlPictureContext
  it("a hinted chain or graph is a valid fragment", () => {
    expect(pictureFragmentError({ chain: "null", memoryHint: { zoom: true } }, ctx)).toBeUndefined()
    expect(pictureFragmentError({ graph: "[p0s0]null[p0o]", memoryHint: { zoom: true } }, ctx)).toBeUndefined()
    expect(pictureFragmentError({ chain: "null", memoryHint: {} }, ctx)).toBeUndefined()
    expect(pictureFragmentError({ chain: "null", memoryHint: { zoom: false } }, ctx)).toBeUndefined()
  })

  it("refuses a malformed hint: not an object, or a non-boolean zoom", () => {
    expect(pictureFragmentError({ chain: "null", memoryHint: "zoom" }, ctx)).toMatch(/memoryHint/)
    expect(pictureFragmentError({ chain: "null", memoryHint: { zoom: "yes" } }, ctx)).toMatch(/memoryHint\.zoom/)
  })

  it("ignores keys it does not know (forward compatibility), so a misspelled key reads as no hint", () => {
    // A newer plugin may send a hint key this host does not know yet; refusing
    // it would fail every render. The cost: a misspelled `zoom` is not caught
    // here (the TypeScript type is what catches it), and reserves no zoom term.
    expect(pictureFragmentError({ chain: "null", memoryHint: { zooms: true } }, ctx)).toBeUndefined()
    expect(pictureFragmentError({ chain: "null", memoryHint: { Zoom: true } }, ctx)).toBeUndefined()
    const misspelled: EdlPictureBuilder = (c) => ({ chain: scalePadChain(c.canvas), memoryHint: { zooms: true } as never })
    const cmd = buildSliceCommand(EDL, EDL.segments, { ...OPTS, picture: misspelled })
    expect(cmd.memoryBasis).not.toHaveProperty("zoomSegments")
    expect(slicePeakMemoryMiB(cmd, same(32))).toBe(canvasPeakMemoryMiB(FHD, 6, same(32), { cameraMegapixels: CAM, inputs: 1 }))
  })
})

describe("the slice's prediction follows the hint", () => {
  it("a slice with zoomed segments carries their count in its memory basis; one without carries none", () => {
    expect(buildSliceCommand(EDL, EDL.segments, { ...OPTS, picture: zoomingOn("s2") }).memoryBasis).toEqual({ ...FHD, segments: 6, inputs: 1, cameraMegapixels: CAM, zoomSegments: 1 })
    expect(buildSliceCommand(EDL, EDL.segments, { ...OPTS, picture: zoomingOn("s0", "s2", "s5") }).memoryBasis).toEqual({ ...FHD, segments: 6, inputs: 1, cameraMegapixels: CAM, zoomSegments: 3 })
    const plain = buildSliceCommand(EDL, EDL.segments, { ...OPTS, picture: zoomingOn() }).memoryBasis
    expect(plain).toEqual({ ...FHD, segments: 6, inputs: 1, cameraMegapixels: CAM })
    expect(plain).not.toHaveProperty("zoomSegments")
    expect(buildSliceCommand(EDL, EDL.segments, OPTS).memoryBasis).not.toHaveProperty("zoomSegments")
  })

  it("charges the zoom per zoomed segment, at the launch's threads — carried (rest) segments included", () => {
    const one = buildSliceCommand(EDL, EDL.segments, { ...OPTS, picture: zoomingOn("s2") })
    const many = buildSliceCommand(EDL, EDL.segments, { ...OPTS, picture: zoomingOn("s2", "s3", "s4") })
    for (const t of [2, 32]) {
      expect(slicePeakMemoryMiB(one, same(t))).toBe(canvasPeakMemoryMiB(FHD, 6, same(t), { cameraMegapixels: CAM, inputs: 1, zoomSegments: 1 }))
      expect(slicePeakMemoryMiB(many, same(t))).toBe(canvasPeakMemoryMiB(FHD, 6, same(t), { cameraMegapixels: CAM, inputs: 1, zoomSegments: 3 }))
      expect(slicePeakMemoryMiB(many, same(t))).toBeGreaterThan(slicePeakMemoryMiB(one, same(t))!)
    }
  })

  it("the hint is not part of what renders: the graph and the output are the unhinted slice's", () => {
    const hinted = buildSliceCommand(EDL, EDL.segments, { ...OPTS, picture: zoomingOn("s0", "s5") })
    const plain = buildSliceCommand(EDL, EDL.segments, { ...OPTS, picture: zoomingOn() })
    expect(hinted.filterGraph).toBe(plain.filterGraph)
    expect(hinted.outputArgs).toEqual(plain.outputArgs)
    expect(slicePeakMemoryMiB(plain, same(32))).toBe(canvasPeakMemoryMiB(FHD, 6, same(32), { cameraMegapixels: CAM, inputs: 1 }))
  })

  it("a plugin's picture needs NO new field for the camera count: the slice counts the distinct sources its slots read, hinted or not", () => {
    // Speaker View reads its cameras through `ctx.slots`; the host opens each
    // source file once and knows how many. `memoryHint` stays one boolean.
    const cams = {
      version: 1, clock: "master",
      sources: [
        { id: "A", url: "https://f.test/a.mp4", kind: "video" }, { id: "B", url: "https://f.test/b.mp4", kind: "video" },
        { id: "MIC", url: "https://f.test/m.wav", kind: "audio", role: "master-audio" },
      ],
      segments: [
        { id: "s0", inMs: 0, outMs: 1000, video: "A" }, { id: "s1", inMs: 1000, outMs: 2000, video: "B" },
        { id: "s2", inMs: 2000, outMs: 3000, video: "B" },
      ],
    } as unknown as Edl
    const opts = { ...OPTS, masterAudioId: "MIC", audioPresent: new Map([["A", true], ["B", true], ["MIC", true]]) }
    const plain = buildSliceCommand(cams, cams.segments, { ...opts, picture: zoomingOn() })
    const zoomed = buildSliceCommand(cams, cams.segments, { ...opts, picture: zoomingOn("s1", "s2") })
    expect(plain.memoryBasis).toEqual({ ...FHD, segments: 3, inputs: 3, cameraMegapixels: CAM })
    expect(zoomed.memoryBasis).toEqual({ ...FHD, segments: 3, inputs: 3, cameraMegapixels: CAM, zoomSegments: 2 })
    expect(slicePeakMemoryMiB(zoomed, same(32))).toBe(canvasPeakMemoryMiB(FHD, 3, same(32), { cameraMegapixels: CAM, inputs: 3, zoomSegments: 2 }))
    // a chunk of the same edit that touches only B reads two files (B and the master)
    expect(buildSliceCommand(cams, cams.segments.slice(1), { ...opts, picture: zoomingOn() }).memoryBasis?.inputs).toBe(2)
  })

  it("a sound-only slice still predicts nothing", () => {
    const cmd = buildSliceCommand(EDL, EDL.segments, { ...OPTS, output: "audio", audioCodec: "pcm", picture: zoomingOn("s1") })
    expect(cmd.memoryBasis).toBeUndefined()
  })
})

describe("behaviorally: a chunked render reserves the zoom term on exactly the chunks that draw one", () => {
  function edl(n: number): Edl {
    const segments = Array.from({ length: n }, (_, i) => ({ id: `s${i}`, inMs: i * 2000, outMs: (i + 1) * 2000, video: "A" })) as EdlSegment[]
    return { version: 1, clock: "master", sources: [{ id: "A", url: "https://f.test/a.mp4", kind: "video" }], segments } as unknown as Edl
  }

  beforeEach(() => {
    fx.launches = []
    fx.threads = undefined
    vi.useFakeTimers({ toFake: ["Date"] })
  })
  afterEach(() => vi.useRealTimers())

  it("chunks [s0 s1 s2] [s3 s4 s5] [s6], zooms on s1, s4 and s5: each chunk reserves its own zoom count", async () => {
    fx.threads = same(32)
    await renderEdlTimeline({
      edl: edl(7), output: "video", quality: "final", jobId: "job-zoom", checkpoint: false, chunkThreshold: 1, maxSegmentsPerChunk: 3,
      picture: zoomingOn("s1", "s4", "s5"), label: "speaker-view", canvas: FHD,
    })
    const chunks = fx.launches.filter((l) => /\/chunk-\d+\.mp4$/.test(l.out))
    expect(chunks.map((c) => c.opts?.peakMemoryMiB)).toEqual([
      canvasPeakMemoryMiB(FHD, 3, same(32), { cameraMegapixels: CAM, inputs: 1, zoomSegments: 1 }),
      canvasPeakMemoryMiB(FHD, 3, same(32), { cameraMegapixels: CAM, inputs: 1, zoomSegments: 2 }),
      canvasPeakMemoryMiB(FHD, 1, same(32), { cameraMegapixels: CAM, inputs: 1 }),
    ])
  })
})
