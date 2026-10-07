// F10 — Apply EDL's golden render trace. Captured from the renderer BEFORE its
// timeline moved into `edl-timeline.ts` (Speaker View C2.0), and asserted
// byte-for-byte after: every ffmpeg launch `applyEdl` makes (its argv, the
// filter graph it reads from a file, its kill budget and its memory
// reservation), every checkpoint key, and the liveness budget. If the refactor
// changes a single character of what Apply EDL renders, this fails.
//
// The fixture is written ONCE from the pre-refactor code
// (`UPDATE_APPLY_EDL_GOLDEN=1 npx vitest run …apply-edl-golden`); never
// regenerate it to make a refactor pass — a moved byte is a behaviour change
// that needs its own justification.
//
// HERMETIC: the trace must not depend on the box running it. A launch's
// `peakMemoryMiB` is predicted from the thread counts it will run with
// (`ffmpegEffectiveThreads` → `canvasPeakMemoryMiB`), and those are read from
// the host — its affinity mask and cgroup CPU quota, or `cpus()` off Linux.
// So every host read goes through ONE pinned reader (`PINNED_HOST`): Linux,
// affinity `0-15` (16 CPUs), cgroup v2 at `/` with `cpu.max` `max` (no quota).
// That host places no explicit counts (`ffmpegThreads` → undefined) and runs
// ffmpeg's own picks, `{ decode: 16, filter: 16, encode: 24 }`
// (`ffmpegAutoThreadsFor(16)`) — the counts of the 16-CPU, quota-less box the
// fixture was captured on, so the pin reproduces it unchanged. A case that sets
// `threads` overrides the placed counts, exactly as a quota would.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { promises as fs, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Edl, EdlSegment } from "@nodaro/shared"

const fx = vi.hoisted(() => ({
  workDirs: [] as string[],
  /** download url → local path */
  localOf: new Map<string, string>(),
  silentUrls: new Set<string>(),
  trace: [] as unknown[],
  threads: undefined as undefined | { decode: number; filter: number; encode: number },
  canvas: { width: 1280, height: 720 },
  fps: 30 as number,
}))

const norm = (s: string): string => {
  let out = s
  for (const w of fx.workDirs) out = out.split(w).join("<work>")
  return out
}

vi.mock("../ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ffmpeg-utils.js")>()
  return {
    ...actual,
    createWorkDir: async (prefix: string) => {
      const dir = await actual.createWorkDir(prefix)
      fx.workDirs.push(dir)
      fx.trace.push({ step: "workdir", prefix })
      return dir
    },
    downloadFile: async (url: string, dest: string, opts?: unknown) => {
      fx.localOf.set(dest, url)
      fx.trace.push({ step: "download", url, dest: norm(dest), opts })
    },
    runFfprobe: async (args: readonly string[]) => {
      const path = String(args[args.length - 1])
      return fx.silentUrls.has(fx.localOf.get(path) ?? "") ? "" : "audio\n"
    },
    probeStreamEnds: async () => ({ video: { state: "measured", endSec: 100_000 }, audio: { state: "measured", endSec: 100_000 } }),
    ffmpegVersionLine: async () => "ffmpeg version n8.1.2-golden",
    runFfmpeg: async (args: readonly string[], timeoutMs?: number, launch?: unknown) => {
      const i = args.indexOf("-/filter_complex")
      const graph = i >= 0 ? await fs.readFile(String(args[i + 1]), "utf8") : undefined
      fx.trace.push({ step: "ffmpeg", args: args.map((a) => norm(String(a))), timeoutMs, launch, graph })
      return ""
    },
  }
})
vi.mock("../../../lib/storage.js", () => ({
  getR2ObjectSize: async () => 0,
  downloadR2ObjectToFile: async () => {},
  uploadFileWithKeyToR2: async (_p: string, key: string, type: string, user: unknown) => {
    fx.trace.push({ step: "checkpoint-upload", key, type, user: user ?? null })
  },
  deleteFromR2: async (key: string) => {
    fx.trace.push({ step: "checkpoint-delete", key })
  },
}))
vi.mock("../combine-videos.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../combine-videos.js")>()),
  pickTargetResolution: async () => fx.canvas,
  pickTargetFps: async () => fx.fps,
}))
vi.mock("../ffmpeg-threads.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ffmpeg-threads.js")>()
  /** The one host every golden renders on (see the header) — fixed text for
   *  each file the CPU readers open, nothing else readable, so neither the
   *  real `/proc` / `/sys` nor `cpus()` is ever consulted. */
  const PINNED_HOST_FILES: Readonly<Record<string, string>> = {
    "/proc/self/status": "Name:\tnode\nCpus_allowed_list:\t0-15\n",
    "/proc/self/cgroup": "0::/\n",
    "/sys/fs/cgroup/cpu.max": "max 100000\n",
  }
  const PINNED_HOST: import("../ffmpeg-threads.js").ReadText = (path) => PINNED_HOST_FILES[path]
  return {
    ...actual,
    // Both entry points the renderer calls, each on the pinned host: the real
    // module's `ffmpegEffectiveThreads` calls its own `ffmpegThreads`, which a
    // mock of the export alone never reaches.
    ffmpegThreads: () => fx.threads ?? actual.ffmpegThreads(PINNED_HOST),
    ffmpegEffectiveThreads: () => fx.threads ?? actual.ffmpegEffectiveThreads(PINNED_HOST),
  }
})

import { applyEdl, applyEdlRenderBudgetMs } from "../apply-edl.js"
import { applyEdlJobBudgetMs } from "../apply-edl-budget.js"

const FIXTURE = join(__dirname, "fixtures", "apply-edl-golden.json")

type Case = {
  readonly name: string
  readonly edl: Edl
  readonly output: "video" | "audio"
  readonly quality: "proxy" | "final"
  readonly threads?: { decode: number; filter: number; encode: number }
  readonly canvas?: { width: number; height: number }
  readonly fps?: number
  readonly silent?: readonly string[]
  readonly chunk?: { maxSegmentsPerChunk?: number; chunkThreshold?: number }
}

const src = (id: string, kind: "video" | "audio" = "video", extra: Record<string, unknown> = {}) =>
  ({ id, url: `https://f.test/${id}.${kind === "video" ? "mp4" : "m4a"}`, kind, ...extra })

const cuts = (n: number, durMs: number, pick: (i: number) => string, from = 0): EdlSegment[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}`, inMs: from + i * durMs, outMs: from + (i + 1) * durMs, video: pick(i) }))

const edlOf = (sources: unknown[], segments: unknown[]): Edl => ({ version: 1, clock: "master", sources, segments } as unknown as Edl)

const multicam = edlOf([src("A"), src("B"), src("MIC", "audio", { role: "master-audio" })], cuts(6, 617, (i) => (i % 2 ? "B" : "A")))
const crossfades = edlOf(
  [src("A"), src("B")],
  cuts(5, 2400, (i) => (i % 2 ? "B" : "A")).map((s, i) => (i > 0 ? { ...s, transition: { type: "crossfade", durationMs: 400 + 37 * i } } : s)),
)
const longCuts = edlOf([src("A"), src("B"), src("MIC", "audio", { role: "master-audio" })], cuts(70, 1013, (i) => (i % 3 ? "B" : "A")))
const xfRun = edlOf(
  [src("A"), src("B")],
  cuts(40, 1000, (i) => (i % 2 ? "B" : "A")).map((s, i) => (i > 0 ? { ...s, transition: { type: "crossfade", durationMs: 200 } } : s)),
)
const mixedRun = edlOf(
  [src("A"), src("B"), src("MIC", "audio", { role: "master-audio" })],
  cuts(75, 900, (i) => (i % 2 ? "B" : "A")).map((s, i) => (i > 0 && i % 4 !== 0 ? { ...s, transition: { type: "crossfade", durationMs: 150 } } : s)),
)
const audioOnly = edlOf([src("MIC", "audio", { role: "master-audio" })], Array.from({ length: 64 }, (_, i) => ({ id: `s${i}`, inMs: i * 1500 + 30, outMs: i * 1500 + 1290 })))
const silentCam = edlOf([src("A"), src("B")], cuts(4, 1500, (i) => (i % 2 ? "B" : "A")))
const slivers = edlOf([src("A"), src("B")], [
  { id: "s0", inMs: 0, outMs: 1000, video: "A" },
  { id: "s1", inMs: 1000, outMs: 1012, video: "B" },
  { id: "s2", inMs: 1012, outMs: 1020, video: "A" },
  { id: "s3", inMs: 1020, outMs: 2533, video: "B" },
])
const offsets = edlOf(
  [src("A", "video", { offsetMs: 4000 }), src("B", "video", { offsetMs: -2500 }), src("MIC", "audio", { role: "master-audio", offsetMs: 120 })],
  cuts(8, 3333, (i) => (i % 2 ? "B" : "A"), 3_600_000),
)
const singleLayout = edlOf([src("A"), src("B")], cuts(3, 2000, (i) => (i % 2 ? "B" : "A")).map((s) => ({
  ...s, speaker: "Host", layout: { mode: "single", slots: [{ source: s.video }], transition: { type: "cut" } },
})))
const ownAudio = edlOf([src("A"), src("B"), src("V", "audio")], cuts(5, 1700, (i) => (i % 2 ? "B" : "A")).map((s, i) => (i === 2 ? { ...s, audio: "V" } : s)))

export const GOLDEN_CASES: readonly Case[] = [
  { name: "multicam master audio, single pass", edl: multicam, output: "video", quality: "final" },
  { name: "multicam master audio, proxy", edl: multicam, output: "video", quality: "proxy", canvas: { width: 1920, height: 1080 } },
  { name: "crossfades on own audio", edl: crossfades, output: "video", quality: "final" },
  { name: "crossfades, proxy, 29.97", edl: crossfades, output: "video", quality: "proxy", fps: 29.97 },
  { name: "70 cuts chunked (option B)", edl: longCuts, output: "video", quality: "final" },
  { name: "70 cuts chunked, threads", edl: longCuts, output: "video", quality: "final", threads: { decode: 2, filter: 2, encode: 2 } },
  { name: "70 cuts chunked, proxy 4K canvas", edl: longCuts, output: "video", quality: "proxy", canvas: { width: 3840, height: 2160 } },
  { name: "crossfade run split inside", edl: xfRun, output: "video", quality: "final" },
  { name: "mixed cuts and crossfades chunked", edl: mixedRun, output: "video", quality: "final", fps: 24 },
  { name: "mixed run as audio", edl: mixedRun, output: "audio", quality: "final" },
  { name: "audio-only chunked PCM", edl: audioOnly, output: "audio", quality: "final" },
  { name: "audio-only chunked PCM, proxy", edl: audioOnly, output: "audio", quality: "proxy" },
  { name: "audio-only single pass", edl: audioOnly, output: "audio", quality: "final", chunk: { chunkThreshold: 100 } },
  { name: "silent camera", edl: silentCam, output: "video", quality: "final", silent: ["https://f.test/A.mp4"] },
  { name: "sub-frame slivers", edl: slivers, output: "video", quality: "final", fps: 25 },
  { name: "slivers chunked small", edl: slivers, output: "video", quality: "final", chunk: { maxSegmentsPerChunk: 2, chunkThreshold: 2 } },
  { name: "offsets and late seeks", edl: offsets, output: "video", quality: "final" },
  { name: "single-slot layout with cut", edl: singleLayout, output: "video", quality: "final" },
  { name: "per-segment own audio", edl: ownAudio, output: "video", quality: "final" },
  { name: "forced chunks of 3", edl: crossfades, output: "video", quality: "final", chunk: { maxSegmentsPerChunk: 3, chunkThreshold: 3 } },
]

async function traceOf(c: Case): Promise<unknown> {
  fx.workDirs.length = 0
  fx.localOf.clear()
  fx.trace = []
  fx.silentUrls = new Set(c.silent ?? [])
  fx.threads = c.threads
  fx.canvas = c.canvas ?? { width: 1280, height: 720 }
  fx.fps = c.fps ?? 30
  const res = await applyEdl({ edl: c.edl, output: c.output, quality: c.quality, jobId: "job-golden", ...(c.chunk ?? {}) })
  await fs.rm(join(res.outputPath, ".."), { recursive: true, force: true }).catch(() => {})
  return {
    trace: fx.trace,
    result: { outputPath: norm(res.outputPath), durationMs: res.durationMs },
    renderBudgetMs: applyEdlRenderBudgetMs(c.edl, { output: c.output, ...(c.chunk ?? {}) }),
    jobBudgetMs: applyEdlJobBudgetMs({ edl: c.edl, output: c.output }),
  }
}

describe("Apply EDL golden render trace (F10)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  it("renders every case byte-identically to the pre-extraction renderer", async () => {
    const got: Record<string, unknown> = {}
    for (const c of GOLDEN_CASES) got[c.name] = await traceOf(c)
    if (process.env.UPDATE_APPLY_EDL_GOLDEN === "1") {
      writeFileSync(FIXTURE, JSON.stringify(got, null, 1) + "\n")
      return
    }
    const want = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, unknown>
    expect(Object.keys(got)).toEqual(Object.keys(want))
    for (const name of Object.keys(want)) expect(got[name], name).toEqual(want[name])
  }, 60_000)
})
