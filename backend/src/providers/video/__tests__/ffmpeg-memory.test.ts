// How much memory the ffmpeg launches of this process may reserve between them
// (decided 2026-10-05, fixing the 4K OOM): the box's limit, read from its
// cgroup, minus a reserve for Node and the rest, times a headroom. Never
// "unlimited" by accident — a box with no limit falls back to a configured
// value, then to the host's memory.
import { describe, it, expect } from "vitest"
import {
  FFMPEG_MEMORY_DEFAULTS,
  cgroupMemoryLimitBytes,
  describeFfmpegMemoryBudget,
  ffmpegContainerId,
  ffmpegMemoryBudget,
  parseCgroupV1MemoryLimit,
  parseMemoryMax,
} from "../ffmpeg-memory.js"
import type { ReadText } from "../ffmpeg-threads.js"

const MIB = 1024 * 1024
/** A fake filesystem: a path not listed does not exist. */
const files = (entries: Record<string, string>): ReadText => (path) => entries[path]
/** The measured Railway nodaro-ci runner: memory.max = 8,000,000,000 B = 7,629 MiB. */
const RUNNER_MEMORY_MAX = "8000000000\n"
const HOST_BYTES = 330_437 * MIB // that runner's host, as `free` and os.totalmem() see it

describe("parseMemoryMax — cgroup v2 memory.max", () => {
  it("is the limit in bytes", () => {
    expect(parseMemoryMax(RUNNER_MEMORY_MAX)).toBe(8_000_000_000)
    expect(parseMemoryMax("4294967296")).toBe(4 * 1024 * MIB)
  })

  it("is undefined for no limit, or anything that is not one", () => {
    expect(parseMemoryMax("max\n")).toBeUndefined()
    expect(parseMemoryMax("")).toBeUndefined()
    expect(parseMemoryMax("garbage")).toBeUndefined()
    expect(parseMemoryMax("0")).toBeUndefined()
  })
})

describe("parseCgroupV1MemoryLimit — cgroup v1 memory.limit_in_bytes", () => {
  it("is the limit in bytes", () => {
    expect(parseCgroupV1MemoryLimit("8000000000\n")).toBe(8_000_000_000)
  })

  it("is undefined for v1's 'unlimited' (the page-counter maximum), never an 8 EiB budget", () => {
    expect(parseCgroupV1MemoryLimit("9223372036854771712\n")).toBeUndefined()
    expect(parseCgroupV1MemoryLimit("-1")).toBeUndefined()
    expect(parseCgroupV1MemoryLimit("")).toBeUndefined()
  })
})

describe("cgroupMemoryLimitBytes — the tightest limit on this process's cgroup", () => {
  it("cgroup v2: the container's own memory.max under a private namespace", () => {
    const read = files({ "/proc/self/cgroup": "0::/\n", "/sys/fs/cgroup/memory.max": RUNNER_MEMORY_MAX })
    expect(cgroupMemoryLimitBytes(read)).toEqual({ bytes: 8_000_000_000, source: "cgroup-v2" })
  })

  it("cgroup v2: the tightest of its own cgroup and every parent", () => {
    const read = files({
      "/proc/self/cgroup": "0::/a/b\n",
      "/sys/fs/cgroup/a/b/memory.max": "max",
      "/sys/fs/cgroup/a/memory.max": "6000000000",
      "/sys/fs/cgroup/memory.max": "8000000000",
    })
    expect(cgroupMemoryLimitBytes(read)).toEqual({ bytes: 6_000_000_000, source: "cgroup-v2" })
  })

  it("cgroup v1: memory.limit_in_bytes", () => {
    const read = files({
      "/proc/self/cgroup": "9:memory:/\n",
      "/sys/fs/cgroup/memory/memory.limit_in_bytes": "8000000000\n",
    })
    expect(cgroupMemoryLimitBytes(read)).toEqual({ bytes: 8_000_000_000, source: "cgroup-v1" })
  })

  it("is undefined for v2 'max', v1's unlimited, or nothing readable", () => {
    expect(cgroupMemoryLimitBytes(files({ "/proc/self/cgroup": "0::/\n", "/sys/fs/cgroup/memory.max": "max\n" }))).toBeUndefined()
    expect(cgroupMemoryLimitBytes(files({ "/sys/fs/cgroup/memory/memory.limit_in_bytes": "9223372036854771712" }))).toBeUndefined()
    expect(cgroupMemoryLimitBytes(files({}))).toBeUndefined()
  })
})

describe("ffmpegMemoryBudget — (limit − reserve) × headroom", () => {
  it("the defaults: reserve 2,048 MiB (measured idle container memory.current: 1.66 GB staging, 1.9 GB prod, page cache included), headroom 0.9, half the budget for one process when the ledger is down", () => {
    expect(FFMPEG_MEMORY_DEFAULTS).toEqual({ reserveMiB: 2048, headroom: 0.9, localShare: 0.5 })
  })

  it("the measured runner (cgroup v2, 7,629 MiB): 5,022 MiB", () => {
    const read = files({ "/proc/self/cgroup": "0::/\n", "/sys/fs/cgroup/memory.max": RUNNER_MEMORY_MAX })
    expect(ffmpegMemoryBudget({}, read, HOST_BYTES)).toEqual({
      budgetMiB: 5022, limitMiB: 7629, limitSource: "cgroup-v2", reserveMiB: 2048, headroom: 0.9,
      defaultPeakOverrideMiB: undefined, localShare: 0.5, localBudgetMiB: 2511,
    })
  })

  it("production (memory.max 32,000,000,000 B = 30,517 MiB): 25,622 MiB for the whole container ((30,517 − 2,048) × 0.9 = 25,622.1, floored)", () => {
    const read = files({ "/proc/self/cgroup": "0::/\n", "/sys/fs/cgroup/memory.max": "32000000000\n" })
    expect(ffmpegMemoryBudget({}, read, HOST_BYTES)).toMatchObject({
      budgetMiB: 25_622, limitMiB: 30_517, limitSource: "cgroup-v2",
    })
  })

  it("cgroup v1 reads the same limit", () => {
    const read = files({ "/sys/fs/cgroup/memory/memory.limit_in_bytes": "8000000000" })
    expect(ffmpegMemoryBudget({}, read, HOST_BYTES)).toMatchObject({ budgetMiB: 5022, limitMiB: 7629, limitSource: "cgroup-v1" })
  })

  it("a cgroup limit above the host's memory is the host's", () => {
    const read = files({ "/proc/self/cgroup": "0::/\n", "/sys/fs/cgroup/memory.max": String(64 * 1024 * MIB) })
    expect(ffmpegMemoryBudget({}, read, 8 * 1024 * MIB)).toMatchObject({ limitMiB: 8192, limitSource: "host" })
  })

  it("'max' (no limit) uses the configured limit when one is set", () => {
    const read = files({ "/proc/self/cgroup": "0::/\n", "/sys/fs/cgroup/memory.max": "max" })
    expect(ffmpegMemoryBudget({ fallbackLimitMiB: 4096 }, read, HOST_BYTES)).toMatchObject({
      budgetMiB: Math.floor((4096 - 2048) * 0.9), limitMiB: 4096, limitSource: "configured",
    })
  })

  it("'max' with nothing configured uses the host's memory — never unlimited", () => {
    const read = files({ "/proc/self/cgroup": "0::/\n", "/sys/fs/cgroup/memory.max": "max" })
    const budget = ffmpegMemoryBudget({}, read, 16 * 1024 * MIB)
    expect(budget).toMatchObject({ budgetMiB: Math.floor((16_384 - 2048) * 0.9), limitMiB: 16_384, limitSource: "host" })
    expect(Number.isFinite(budget.budgetMiB)).toBe(true)
  })

  it("unreadable (not Linux) behaves like 'max'", () => {
    expect(ffmpegMemoryBudget({}, files({}), 16 * 1024 * MIB)).toMatchObject({ limitSource: "host", limitMiB: 16_384 })
  })

  it("reserve, headroom, the fixed default estimate and the local share are configurable", () => {
    const read = files({ "/proc/self/cgroup": "0::/\n", "/sys/fs/cgroup/memory.max": RUNNER_MEMORY_MAX })
    expect(ffmpegMemoryBudget({ reserveMiB: 512, headroom: 1, defaultPeakMiB: 256, localShare: 0.25 }, read, HOST_BYTES)).toMatchObject({
      budgetMiB: 7629 - 512, reserveMiB: 512, headroom: 1, defaultPeakOverrideMiB: 256, localShare: 0.25,
      localBudgetMiB: Math.floor((7629 - 512) * 0.25),
    })
  })

  it("an invalid setting falls back to its default instead of poisoning the budget", () => {
    const read = files({ "/proc/self/cgroup": "0::/\n", "/sys/fs/cgroup/memory.max": RUNNER_MEMORY_MAX })
    const budget = ffmpegMemoryBudget(
      { reserveMiB: Number.NaN, headroom: 7, defaultPeakMiB: -1, fallbackLimitMiB: Number.NaN, localShare: 0 },
      read,
      HOST_BYTES,
    )
    expect(budget).toMatchObject({ budgetMiB: 5022, reserveMiB: 2048, headroom: 0.9, defaultPeakOverrideMiB: undefined, localShare: 0.5 })
  })

  it("a box smaller than the reserve has a zero budget (every launch then runs alone), never a negative one", () => {
    const read = files({ "/proc/self/cgroup": "0::/\n", "/sys/fs/cgroup/memory.max": String(1536 * MIB) })
    expect(ffmpegMemoryBudget({}, read, HOST_BYTES).budgetMiB).toBe(0)
  })
})

describe("ffmpegContainerId — the key one container's processes share", () => {
  it("RAILWAY_REPLICA_ID when Railway sets it: the same in every process of one replica, different per replica", () => {
    expect(ffmpegContainerId({ RAILWAY_REPLICA_ID: "rep-1" }, "host-a")).toEqual({ id: "rep-1", source: "RAILWAY_REPLICA_ID" })
    expect(ffmpegContainerId({ RAILWAY_REPLICA_ID: "rep-2" }, "host-a").id).not.toBe("rep-1")
  })

  it("else the hostname — the container id under Docker, one per container", () => {
    expect(ffmpegContainerId({}, "3f2a9c")).toEqual({ id: "3f2a9c", source: "hostname" })
    expect(ffmpegContainerId({ RAILWAY_REPLICA_ID: "  " }, "3f2a9c")).toEqual({ id: "3f2a9c", source: "hostname" })
  })
})

describe("describeFfmpegMemoryBudget", () => {
  const read = files({ "/proc/self/cgroup": "0::/\n", "/sys/fs/cgroup/memory.max": RUNNER_MEMORY_MAX })

  it("names the budget, its source, the per-process fallback and the unpredicted estimate", () => {
    const line = describeFfmpegMemoryBudget(ffmpegMemoryBudget({}, read, HOST_BYTES))
    expect(line).toContain("5022 MiB")
    expect(line).toContain("cgroup-v2")
    expect(line).toContain("2511 MiB each if the ledger is down")
    expect(line).toContain("393 + 22.9·threads")
  })

  it("names the fixed estimate when the operator set one", () => {
    expect(describeFfmpegMemoryBudget(ffmpegMemoryBudget({ defaultPeakMiB: 700 }, read, HOST_BYTES))).toContain("reserves 700 MiB")
  })
})
