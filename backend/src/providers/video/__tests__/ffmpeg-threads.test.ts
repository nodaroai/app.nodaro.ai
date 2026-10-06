// ffmpeg's auto-threading counts the host's cores, not the container's CPU
// quota: on the Railway pool's 2-vCPU boxes (`nproc` = 48) a 4K Apply EDL
// final ran libx264 with 67 frame threads and was killed for memory. These pin
// how the quota is read and what every slice is told, and that a box with no
// quota renders exactly as before.
import { describe, it, expect } from "vitest"
import { createHash } from "node:crypto"
import type { Edl } from "@nodaro/shared"
import {
  affinityCpuCount,
  cgroupCpuQuota,
  ffmpegAutoThreadsFor,
  ffmpegCpuBudget,
  ffmpegEffectiveThreads,
  ffmpegThreads,
  ffmpegThreadsFor,
  parseCpuList,
  parseCfsQuota,
  parseCpuMax,
  type ReadText,
} from "../ffmpeg-threads.js"
import { buildSliceCommand, sliceArgv, sliceFingerprint, type SliceOptions } from "../apply-edl.js"

/** A fake filesystem: a path not listed does not exist. */
const files = (entries: Record<string, string>): ReadText => (path) => entries[path]

describe("parseCpuMax — cgroup v2 cpu.max", () => {
  it("is quota ÷ period in CPUs", () => {
    expect(parseCpuMax("200000 100000")).toBe(2) // the Railway pool box
    expect(parseCpuMax("150000 100000\n")).toBe(1.5)
    expect(parseCpuMax("50000 100000")).toBe(0.5)
    expect(parseCpuMax("800000 100000")).toBe(8)
  })

  it("is undefined for no quota, or anything that is not one", () => {
    expect(parseCpuMax("max 100000")).toBeUndefined()
    expect(parseCpuMax("")).toBeUndefined()
    expect(parseCpuMax("garbage")).toBeUndefined()
    expect(parseCpuMax("0 100000")).toBeUndefined()
  })
})

describe("parseCfsQuota — cgroup v1", () => {
  it("is quota ÷ period, and undefined for the unlimited -1", () => {
    expect(parseCfsQuota("200000\n", "100000\n")).toBe(2)
    expect(parseCfsQuota("-1", "100000")).toBeUndefined()
    expect(parseCfsQuota("", "100000")).toBeUndefined()
  })
})

describe("cgroupCpuQuota — the tightest quota on this process's cgroup path", () => {
  it("reads the container's own cpu.max under a private cgroup namespace", () => {
    const read = files({ "/proc/self/cgroup": "0::/\n", "/sys/fs/cgroup/cpu.max": "200000 100000\n" })
    expect(cgroupCpuQuota(read)).toBe(2)
  })

  it("takes the tightest of its own cgroup and every parent — a parent's quota binds too", () => {
    const read = files({
      "/proc/self/cgroup": "0::/a/b\n",
      "/sys/fs/cgroup/a/b/cpu.max": "max 100000",
      "/sys/fs/cgroup/a/cpu.max": "400000 100000",
      "/sys/fs/cgroup/cpu.max": "200000 100000",
    })
    expect(cgroupCpuQuota(read)).toBe(2)
  })

  it("reaches the mounted root when the host-namespace path does not exist under it", () => {
    const read = files({ "/proc/self/cgroup": "0::/docker/abc123\n", "/sys/fs/cgroup/cpu.max": "300000 100000" })
    expect(cgroupCpuQuota(read)).toBe(3)
  })

  it("is undefined when no level has a quota", () => {
    const read = files({ "/proc/self/cgroup": "0::/\n", "/sys/fs/cgroup/cpu.max": "max 100000\n" })
    expect(cgroupCpuQuota(read)).toBeUndefined()
    expect(cgroupCpuQuota(files({}))).toBeUndefined()
  })

  it("falls back to cgroup v1's CFS quota", () => {
    const read = files({
      "/proc/self/cgroup": "4:cpu,cpuacct:/docker/abc\n1:name=systemd:/docker/abc\n",
      "/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_quota_us": "150000\n",
      "/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_period_us": "100000\n",
    })
    expect(cgroupCpuQuota(read)).toBe(1.5)
    expect(cgroupCpuQuota(files({
      "/sys/fs/cgroup/cpu/cpu.cfs_quota_us": "-1",
      "/sys/fs/cgroup/cpu/cpu.cfs_period_us": "100000",
    }))).toBeUndefined()
  })
})

describe("ffmpegCpuBudget — what ffmpeg is told, and when it is told nothing", () => {
  it("is the quota on a box whose quota sits below the cores ffmpeg counts (the Railway pool: 2 of 48)", () => {
    expect(ffmpegCpuBudget(2, 48, 48)).toBe(2)
    // Node's own count may already honour the quota (libuv reads cpu.max too).
    expect(ffmpegCpuBudget(2, 2, 48)).toBe(2)
  })

  it("rounds a fractional quota up — 1.5 CPUs still run two threads at once", () => {
    expect(ffmpegCpuBudget(1.5, 48, 48)).toBe(2)
    expect(ffmpegCpuBudget(0.5, 48, 48)).toBe(1)
  })

  it("never exceeds the CPUs the scheduler lets the process run on", () => {
    expect(ffmpegCpuBudget(8, 4, 48)).toBe(4)
  })

  it("is undefined — ffmpeg decides, exactly as before — with no quota, or one at or above the cores", () => {
    expect(ffmpegCpuBudget(undefined, 48, 48)).toBeUndefined()
    expect(ffmpegCpuBudget(48, 48, 48)).toBeUndefined()
    expect(ffmpegCpuBudget(64, 48, 48)).toBeUndefined()
  })
})

// Review of #1813 (decided 2026-10-05: round up, count the allowed cores).
// Node's availableParallelism() already FLOORS a fractional quota, which undid
// the round-up; os.cpus() counts every host CPU, not the ones this process may
// run on. ffmpeg and x264 count the process's CPU affinity mask (what `nproc`
// prints), so that is both the scheduler cap and "the cores ffmpeg sees".
describe("parseCpuList — a kernel CPU list (Cpus_allowed_list)", () => {
  it("counts single CPUs and ranges", () => {
    expect(parseCpuList("0-47")).toBe(48) // the Railway pool box
    expect(parseCpuList("0,1\n")).toBe(2)
    expect(parseCpuList("0-3,8-11")).toBe(8)
    expect(parseCpuList("5")).toBe(1)
  })

  it("is undefined for anything that is not a CPU list", () => {
    expect(parseCpuList("")).toBeUndefined()
    expect(parseCpuList("garbage")).toBeUndefined()
    expect(parseCpuList("3-1")).toBeUndefined()
  })
})

describe("affinityCpuCount — the CPUs this process may run on", () => {
  it("reads Cpus_allowed_list from /proc/self/status", () => {
    const status = "Name:\tnode\nCpus_allowed:\tffff\nCpus_allowed_list:\t0,1\nMems_allowed:\t1\n"
    expect(affinityCpuCount(files({ "/proc/self/status": status }))).toBe(2)
  })

  it("is undefined when the status cannot be read", () => {
    expect(affinityCpuCount(files({}))).toBeUndefined()
  })
})

describe("ffmpegThreads — the box's own counts", () => {
  const box = (cpuMax: string, allowed: string): ReadText => files({
    "/proc/self/cgroup": "0::/\n",
    "/sys/fs/cgroup/cpu.max": cpuMax,
    "/proc/self/status": `Cpus_allowed_list:\t${allowed}\n`,
  })

  it("the Railway pool box (2 of 48): every count is 2", () => {
    expect(ffmpegThreads(box("200000 100000", "0-47"))).toEqual({ decode: 2, filter: 2, encode: 2 })
  })

  it("rounds a fractional quota UP — 1.5 CPUs run two threads", () => {
    expect(ffmpegThreads(box("150000 100000", "0-47"))).toEqual({ decode: 2, filter: 2, encode: 2 })
  })

  it("never above the CPUs the process may run on", () => {
    expect(ffmpegThreads(box("800000 100000", "0-15"))).toEqual({ decode: 8, filter: 8, encode: 8 })
    // a quota of 6 on 4 allowed CPUs: ffmpeg already counts 4 — nothing is passed
    expect(ffmpegThreads(box("600000 100000", "0-3"))).toBeUndefined()
  })

  it("no quota: ffmpeg decides, exactly as before", () => {
    expect(ffmpegThreads(box("max 100000", "0-47"))).toBeUndefined()
  })
})

describe("ffmpegAutoThreadsFor / ffmpegEffectiveThreads — the counts ffmpeg picks when none are placed", () => {
  const box = (cpuMax: string, allowed: string): ReadText => files({
    "/proc/self/cgroup": "0::/\n",
    "/sys/fs/cgroup/cpu.max": cpuMax,
    "/proc/self/status": `Cpus_allowed_list:\t${allowed}\n`,
  })

  it("decoders and the filter graph use every CPU; x264 runs 1.5 frame threads per CPU, up to its ceiling of 128", () => {
    expect(ffmpegAutoThreadsFor(8)).toEqual({ decode: 8, filter: 8, encode: 12 })
    expect(ffmpegAutoThreadsFor(1)).toEqual({ decode: 1, filter: 1, encode: 2 })
    expect(ffmpegAutoThreadsFor(48)).toEqual({ decode: 48, filter: 48, encode: 72 })
    expect(ffmpegAutoThreadsFor(200).encode).toBe(128)
  })

  it("a quota'd box: the counts that are placed (production: 32 of 48 CPUs)", () => {
    expect(ffmpegEffectiveThreads(box("3200000 100000", "0-47"))).toEqual({ decode: 32, filter: 32, encode: 32 })
  })

  it("no quota below the cores: what ffmpeg picks for the CPUs the process may run on", () => {
    expect(ffmpegEffectiveThreads(box("max 100000", "0-7"))).toEqual({ decode: 8, filter: 8, encode: 12 })
  })
})

describe("ffmpegThreadsFor — the counts a budget becomes", () => {
  it("gives every part of the render the budget, never the host's core count", () => {
    expect(ffmpegThreadsFor(2)).toEqual({ decode: 2, filter: 2, encode: 2 })
    expect(ffmpegThreadsFor(8)).toEqual({ decode: 8, filter: 8, encode: 8 })
  })
})

const EDL: Edl = {
  version: 1,
  clock: "master",
  sources: [
    { id: "A", url: "https://f.test/camA.mp4", kind: "video" },
    { id: "B", url: "https://f.test/camB.mp4", kind: "video" },
  ],
  segments: [
    { id: "s0", inMs: 0, outMs: 1000, video: "A" },
    { id: "s1", inMs: 5000, outMs: 6000, video: "B" },
  ],
} as unknown as Edl

const OPTS: SliceOptions = {
  output: "video",
  quality: "final",
  target: { width: 320, height: 240 },
  fps: 30,
  chunkStartMs: 0,
  masterAudioId: undefined,
  audioPresent: new Map([["A", true], ["B", true]]),
}
const PATHS = new Map([["A", "/w/src-0.mp4"], ["B", "/w/src-1.mp4"]])

describe("sliceArgv — where the counts go", () => {
  const cmd = buildSliceCommand(EDL, EDL.segments, OPTS)

  it("without counts it is the unthreaded argv, unchanged", () => {
    const argv = sliceArgv(cmd, PATHS, "/w/g", "/w/out.mp4")
    expect(argv).toEqual([
      "-y",
      "-i", "/w/src-0.mp4",
      "-ss", cmd.inputSeekSec[1]!.toFixed(3), "-i", "/w/src-1.mp4",
      "-/filter_complex", "/w/g", ...cmd.outputArgs, "/w/out.mp4",
    ])
    expect(argv.join(" ")).not.toContain("threads")
  })

  it("with counts: the graph's (global, first), each decoder's (before its -i), the encoders' (before the output)", () => {
    const argv = sliceArgv(cmd, PATHS, "/w/g", "/w/out.mp4", { decode: 2, filter: 3, encode: 4 })
    expect(argv).toEqual([
      "-y", "-filter_complex_threads", "3",
      "-threads", "2", "-i", "/w/src-0.mp4",
      "-threads", "2", "-ss", cmd.inputSeekSec[1]!.toFixed(3), "-i", "/w/src-1.mp4",
      "-/filter_complex", "/w/g", ...cmd.outputArgs, "-threads", "4", "/w/out.mp4",
    ])
  })
})

describe("sliceFingerprint — threads are part of what renders", () => {
  const cmd = buildSliceCommand(EDL, EDL.segments, OPTS)
  const V = "ffmpeg version n8.1.2"

  it("without counts the key is the one this slice always had (no quota → no resume miss)", () => {
    const sources = cmd.inputIds.map((id) => [id, EDL.sources.find((s) => s.id === id)?.url ?? null])
    const legacy = createHash("sha256")
      .update(JSON.stringify({ ffmpegVersion: V, sources, inputSeekSec: cmd.inputSeekSec, needsSilence: cmd.needsSilence, filterGraph: cmd.filterGraph, outputArgs: cmd.outputArgs }))
      .digest("hex")
      .slice(0, 16)
    expect(sliceFingerprint(cmd, EDL, V)).toBe(legacy)
  })

  it("moves with the counts — a chunk encoded with other frame threads is other bits", () => {
    const none = sliceFingerprint(cmd, EDL, V)
    const two = sliceFingerprint(cmd, EDL, V, { decode: 2, filter: 2, encode: 2 })
    const three = sliceFingerprint(cmd, EDL, V, { decode: 2, filter: 2, encode: 3 })
    expect(new Set([none, two, three]).size).toBe(3)
    expect(sliceFingerprint(cmd, EDL, V, { decode: 2, filter: 2, encode: 2 })).toBe(two)
  })
})
