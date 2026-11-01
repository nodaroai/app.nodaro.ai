// `tk.media.withMemorySlot` against the process's REAL ffmpeg admission
// (`ffmpeg-admission-instance.ts`): a local ledger and a 1,000 MiB budget, so
// what the hold reserves and when it gives it back is the admission's own word.
import { beforeEach, describe, expect, it, vi } from "vitest"

const fx = vi.hoisted(() => ({ status: "processing" as string }))

vi.mock("../../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config.js")>()
  return {
    ...actual,
    config: { ...actual.config, FFMPEG_CONCURRENCY: 8, FFMPEG_MEMORY_LEDGER: "local", FFMPEG_DEFAULT_PEAK_MIB: undefined },
  }
})
vi.mock("../../../providers/video/ffmpeg-memory.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../providers/video/ffmpeg-memory.js")>()
  return {
    ...actual,
    ffmpegMemoryBudgetOnThisBox: () => ({
      budgetMiB: 1000, limitMiB: 1000, limitSource: "configured", reserveMiB: 0, headroom: 1,
      defaultPeakOverrideMiB: undefined, localShare: 1, localBudgetMiB: 1000,
    }),
  }
})
// The worker's ambient cancellation check (it reads the job's row at most every
// 4 s; here it answers at once): cancelled once `fx.status` says so, inside a
// job's context only.
vi.mock("../../job-cancellation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../job-cancellation.js")>()
  return {
    ...actual,
    throwIfJobCancelled: async () => {
      const jobId = actual.getJobId()
      if (jobId && fx.status === "cancelled") throw new actual.JobCancelledError(jobId)
    },
  }
})

const load = async () => {
  vi.resetModules()
  const slot = await import("../memory-slot.js")
  const cancellation = await import("../../job-cancellation.js")
  return { ...slot, ...cancellation }
}

/** A promise and its resolver, for holding a slot open. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void
  const promise = new Promise<void>((resolve) => { open = resolve })
  return { promise, open }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

beforeEach(() => {
  fx.status = "processing"
})

describe("the reserved figure", () => {
  it("clamps peakMiB to [64, 4096] and refuses a figure that is not a finite number", async () => {
    const { pluginMemorySlotMiB, PLUGIN_MEMORY_SLOT_MIN_MIB, PLUGIN_MEMORY_SLOT_MAX_MIB } = await load()
    expect([PLUGIN_MEMORY_SLOT_MIN_MIB, PLUGIN_MEMORY_SLOT_MAX_MIB]).toEqual([64, 4096])
    expect(pluginMemorySlotMiB(0)).toBe(64)
    expect(pluginMemorySlotMiB(-50)).toBe(64)
    expect(pluginMemorySlotMiB(63.2)).toBe(64)
    expect(pluginMemorySlotMiB(64)).toBe(64)
    expect(pluginMemorySlotMiB(500.4)).toBe(501)
    expect(pluginMemorySlotMiB(4096)).toBe(4096)
    expect(pluginMemorySlotMiB(1e9)).toBe(4096)
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, "500", undefined, null]) {
      expect(() => pluginMemorySlotMiB(bad), String(bad)).toThrow(TypeError)
    }
  })

  it("refuses a bad figure or an empty label before anything is reserved", async () => {
    const { withPluginMemorySlot } = await load()
    const fn = vi.fn(async () => 1)
    await expect(withPluginMemorySlot({ peakMiB: Number.NaN, label: "x" }, fn)).rejects.toThrow(TypeError)
    await expect(withPluginMemorySlot({ peakMiB: 100, label: "  " }, fn)).rejects.toThrow(TypeError)
    expect(fn).not.toHaveBeenCalled()
    // Nothing held: the whole budget is still free.
    await expect(withPluginMemorySlot({ peakMiB: 1000, label: "whole" }, async () => "ran")).resolves.toBe("ran")
  })
})

describe("the hold", () => {
  it("reserves while fn runs and gives it back on success", async () => {
    const { withPluginMemorySlot } = await load()
    const held = gate()
    const first = withPluginMemorySlot({ peakMiB: 700, label: "compose" }, async () => { await held.promise; return "first" })
    await tick()
    // 700 of 1,000 MiB are held: a 400 MiB call waits.
    let secondRan = false
    const second = withPluginMemorySlot({ peakMiB: 400, label: "compose" }, async () => { secondRan = true; return "second" })
    await tick()
    expect(secondRan).toBe(false)
    held.open()
    await expect(first).resolves.toBe("first")
    await expect(second).resolves.toBe("second")
    expect(secondRan).toBe(true)
  })

  it("passes fn's error through unchanged and gives the memory back", async () => {
    const { withPluginMemorySlot } = await load()
    const boom = new Error("decode failed")
    await expect(withPluginMemorySlot({ peakMiB: 1000, label: "decode" }, async () => { throw boom })).rejects.toBe(boom)
    // A synchronous throw too.
    const sync = new RangeError("bad size")
    await expect(withPluginMemorySlot({ peakMiB: 1000, label: "decode" }, (() => { throw sync }) as () => Promise<never>)).rejects.toBe(sync)
    // The whole budget is free again.
    await expect(withPluginMemorySlot({ peakMiB: 1000, label: "after" }, async () => "ok")).resolves.toBe("ok")
  })

  it("bounds how many run at once by the budget", async () => {
    const { withPluginMemorySlot } = await load()
    let running = 0
    let most = 0
    const calls = Array.from({ length: 6 }, (_, i) =>
      withPluginMemorySlot({ peakMiB: 400, label: `tile-${i}` }, async () => {
        running++
        most = Math.max(most, running)
        await tick()
        running--
        return i
      }),
    )
    await expect(Promise.all(calls)).resolves.toEqual([0, 1, 2, 3, 4, 5])
    // 2 × 400 fit in 1,000 MiB; a third does not.
    expect(most).toBe(2)
  })

  it("a call whose job is cancelled while it is queued leaves the queue with JobCancelledError and reserves nothing", async () => {
    const { withPluginMemorySlot, runWithJobCancellation, JobCancelledError, PLUGIN_MEMORY_SLOT_CANCEL_POLL_MS } = await load()
    const held = gate()
    const first = withPluginMemorySlot({ peakMiB: 1000, label: "holder" }, async () => { await held.promise; return "held" })
    await tick()
    const fn = vi.fn(async () => "never")
    const queued = runWithJobCancellation("job-1", "u1", () => withPluginMemorySlot({ peakMiB: 500, label: "queued" }, fn))
    const outcome = queued.then(() => "resolved", (err: unknown) => err)
    await tick()
    fx.status = "cancelled"
    await new Promise((resolve) => setTimeout(resolve, PLUGIN_MEMORY_SLOT_CANCEL_POLL_MS + 100))
    expect(await outcome).toBeInstanceOf(JobCancelledError)
    expect(fn).not.toHaveBeenCalled()
    held.open()
    await expect(first).resolves.toBe("held")
    // The cancelled call reserved nothing: the whole budget is free.
    await expect(withPluginMemorySlot({ peakMiB: 1000, label: "after" }, async () => "ok")).resolves.toBe("ok")
  })

  it("a job already cancelled never queues", async () => {
    const { withPluginMemorySlot, runWithJobCancellation, JobCancelledError } = await load()
    fx.status = "cancelled"
    const fn = vi.fn(async () => 1)
    await expect(runWithJobCancellation("job-2", "u1", () => withPluginMemorySlot({ peakMiB: 100, label: "x" }, fn))).rejects.toBeInstanceOf(JobCancelledError)
    expect(fn).not.toHaveBeenCalled()
  })
})
