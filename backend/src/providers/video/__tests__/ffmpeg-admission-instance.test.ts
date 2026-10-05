// The process's admission as production wires it (decided 2026-10-05): the
// config picks the gate, a launch that predicts nothing reserves the
// thread-scaled default, and with the ledger on every reservation lands in the
// container's shared ledger.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { RedisMemoryLedger } from "../ffmpeg-memory-ledger.js"
import { defaultPeakMemoryMiB } from "../ffmpeg-memory-model.js"
import { makeFakeClient, makeFakeStore, leasesOf } from "./fake-ledger-redis.js"

const fx = vi.hoisted(() => ({
  config: {
    FFMPEG_CONCURRENCY: 4,
    FFMPEG_MEMORY_LEDGER: "redis" as string | undefined,
    FFMPEG_MEMORY_LIMIT_MIB: 4096 as number | undefined,
    FFMPEG_MEMORY_RESERVE_MIB: 0 as number | undefined,
    FFMPEG_MEMORY_HEADROOM: 1 as number | undefined,
    FFMPEG_DEFAULT_PEAK_MIB: undefined as number | undefined,
    FFMPEG_MEMORY_LOCAL_SHARE: 0.5 as number | undefined,
  },
  ledgerBuilt: 0,
  importFails: false,
  threads: { decode: 32, filter: 32, encode: 32 },
  store: undefined as undefined | ReturnType<typeof import("./fake-ledger-redis.js").makeFakeStore>,
}))

vi.mock("../../../lib/config.js", () => ({ config: fx.config }))
vi.mock("../ffmpeg-threads.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ffmpeg-threads.js")>()),
  ffmpegEffectiveThreads: () => fx.threads,
}))
vi.mock("../../../lib/ffmpeg-memory-redis.js", async () => {
  if (fx.importFails) throw new Error("cannot load redis")
  const { makeFakeClient, makeFakeStore } = await import("./fake-ledger-redis.js")
  fx.store = makeFakeStore()
  const client = makeFakeClient(fx.store)
  return {
    createFfmpegMemoryLedger: () => {
      fx.ledgerBuilt++
      return { ledger: new RedisMemoryLedger({ client: () => client, containerId: "rep-test" }), containerId: "rep-test", containerIdSource: "RAILWAY_REPLICA_ID" }
    },
  }
})

const load = async () => {
  vi.resetModules()
  return import("../ffmpeg-admission-instance.js")
}

beforeEach(() => {
  fx.config.FFMPEG_MEMORY_LEDGER = "redis"
  fx.config.FFMPEG_DEFAULT_PEAK_MIB = undefined
  fx.ledgerBuilt = 0
  fx.importFails = false
  fx.threads = { decode: 32, filter: 32, encode: 32 }
  vi.spyOn(console, "log").mockImplementation(() => undefined)
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
})

describe("the process's ffmpeg admission", () => {
  it("with the ledger on, every launch reserves a lease in the container's ledger — built once, on the first launch", async () => {
    const { acquireFfmpegSlot } = await load()
    expect(fx.ledgerBuilt).toBe(0) // nothing at import
    const release = await acquireFfmpegSlot(undefined, 1000, undefined)
    expect(fx.ledgerBuilt).toBe(1)
    expect([...leasesOf(fx.store!, "rep-test").values()]).toEqual(["1000"])
    const second = await acquireFfmpegSlot(undefined, 500, undefined)
    expect(fx.ledgerBuilt).toBe(1)
    expect(leasesOf(fx.store!, "rep-test").size).toBe(2)
    release()
    second()
    await Promise.resolve()
    expect(leasesOf(fx.store!, "rep-test").size).toBe(0)
  })

  it("a launch that predicts nothing reserves 393 + 22.9·threads — 1,126 MiB at production's 32, not a flat 512", async () => {
    const { acquireFfmpegSlot, defaultLaunchPeakMiB } = await load()
    expect(defaultLaunchPeakMiB()).toBe(1126)
    const release = await acquireFfmpegSlot(undefined, undefined, undefined)
    expect([...leasesOf(fx.store!, "rep-test").values()]).toEqual(["1126"])
    release()
    fx.threads = { decode: 2, filter: 2, encode: 2 }
    expect(defaultLaunchPeakMiB()).toBe(defaultPeakMemoryMiB(fx.threads))
  })

  it("FFMPEG_DEFAULT_PEAK_MIB, when set, replaces the thread-scaled estimate with one fixed figure", async () => {
    fx.config.FFMPEG_DEFAULT_PEAK_MIB = 700
    const { defaultLaunchPeakMiB } = await load()
    expect(defaultLaunchPeakMiB()).toBe(700)
  })

  it("FFMPEG_MEMORY_LEDGER=local spends the whole budget in this process and never builds a Redis client", async () => {
    fx.config.FFMPEG_MEMORY_LEDGER = "local"
    const { acquireFfmpegSlot, ffmpegMemoryBudgetNow } = await load()
    // Two launches of 60 % of the budget (a container's own cgroup limit, where
    // there is one, outranks the configured one): together they do not fit.
    const sixty = Math.floor(ffmpegMemoryBudgetNow().budgetMiB * 0.6)
    const a = await acquireFfmpegSlot(undefined, sixty, undefined)
    let second = false
    void acquireFfmpegSlot(undefined, sixty, undefined).then(() => { second = true })
    await new Promise((r) => setTimeout(r, 20))
    expect(second).toBe(false) // it waits…
    a()
    await new Promise((r) => setTimeout(r, 20))
    expect(second).toBe(true) // …and starts on the release
    expect(fx.ledgerBuilt).toBe(0)
  })

  it("an unknown or missing setting (a config stub) is the local gate — nothing reaches for Redis by accident", async () => {
    fx.config.FFMPEG_MEMORY_LEDGER = undefined
    const { acquireFfmpegSlot } = await load()
    ;(await acquireFfmpegSlot(undefined, 100, undefined))()
    expect(fx.ledgerBuilt).toBe(0)
  })

  it("a ledger that cannot even be built leaves the process on its local share — the launch still runs", async () => {
    fx.importFails = true
    const { acquireFfmpegSlot, ffmpegMemoryBudgetNow } = await load()
    const budget = ffmpegMemoryBudgetNow().budgetMiB
    const release = await acquireFfmpegSlot(undefined, Math.floor(budget * 0.25), undefined) // inside the local share (half)
    release()
    const big = await acquireFfmpegSlot(undefined, Math.floor(budget * 0.75), undefined) // bigger than the local share: alone
    big()
  })
})
