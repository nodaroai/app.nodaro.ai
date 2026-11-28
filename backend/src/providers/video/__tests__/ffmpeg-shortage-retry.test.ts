import { describe, expect, it, vi } from "vitest"
import {
  KERNEL_REFUSAL_RECENT_MS,
  SHORTAGE_RETRY_ATTEMPTS,
  SHORTAGE_RETRY_MAX_WAIT_MS,
  SHORTAGE_RETRY_WINDOW_MS,
  causedByResourceShortage,
  isResourceShortage,
  retryOnShortage,
  spawnShowsShortage,
  stderrShowsShortage,
  type KernelRefusals,
  type LaunchEvidence,
  type ShortageRetryDeps,
} from "../ffmpeg-shortage-retry.js"

const shortage = () => Object.assign(new Error("ffmpeg failed: Resource temporarily unavailable"), { resourceShortage: true as const })

/** A clock the waits move, no randomness, waits recorded. */
function deps(): ShortageRetryDeps & { waits: number[]; warned: string[] } {
  let t = 0
  const waits: number[] = []
  const warned: string[] = []
  return {
    waits,
    warned,
    now: () => t,
    sleep: async (ms) => {
      waits.push(ms)
      t += ms
    },
    random: () => 0,
    warn: (m) => void warned.push(m),
  }
}

describe("stderrShowsShortage", () => {
  it("a thread ffmpeg could not create is the box's passing shortage", () => {
    expect(stderrShowsShortage("[swscaler @ 0x55] Failed to create thread: Resource temporarily unavailable\nError while filtering")).toBe(true)
    expect(stderrShowsShortage("pthread_create() failed: Resource temporarily unavailable")).toBe(true)
  })
  it("anything else is not, nor a link whose own path carries the words", () => {
    expect(stderrShowsShortage("Invalid data found when processing input")).toBe(false)
    expect(stderrShowsShortage(undefined)).toBe(false)
    expect(stderrShowsShortage("Error opening input https://evil.example/Resource temporarily unavailable.mp4")).toBe(false)
  })
})

describe("spawnShowsShortage", () => {
  it("a spawn refused for want of a process", () => {
    expect(spawnShowsShortage({ code: "EAGAIN", syscall: "spawn ffmpeg" })).toBe(true)
    expect(spawnShowsShortage({ code: "ENOENT", syscall: "spawn ffmpeg" })).toBe(false)
    expect(spawnShowsShortage(undefined)).toBe(false)
  })
})

describe("retryOnShortage", () => {
  it("a launch that failed for the shortage runs again after a jittered, doubling wait, and its answer stands", async () => {
    const d = deps()
    const attempt = vi.fn().mockRejectedValueOnce(shortage()).mockRejectedValueOnce(shortage()).mockResolvedValue("done")
    expect(await retryOnShortage(attempt, { limitMs: 600_000, label: "ffmpeg" }, d)).toBe("done")
    expect(attempt).toHaveBeenCalledTimes(3)
    expect(d.waits).toEqual([2_000, 4_000])
    expect(d.warned).toHaveLength(2)
  })

  it("every try runs inside the first one's deadline", async () => {
    const d = deps()
    const attempt = vi.fn().mockRejectedValueOnce(shortage()).mockResolvedValue("done")
    await retryOnShortage(attempt, { limitMs: 600_000, label: "ffmpeg" }, d)
    expect(attempt.mock.calls.map((c) => c[0])).toEqual([600_000, 598_000])
  })

  it(`at most ${SHORTAGE_RETRY_ATTEMPTS} tries: the last shortage is thrown`, async () => {
    const d = deps()
    const attempt = vi.fn().mockRejectedValue(shortage())
    await expect(retryOnShortage(attempt, { limitMs: 600_000, label: "ffmpeg" }, d)).rejects.toSatisfy(isResourceShortage)
    expect(attempt).toHaveBeenCalledTimes(SHORTAGE_RETRY_ATTEMPTS)
  })

  it("any other failure is thrown at once", async () => {
    const d = deps()
    const attempt = vi.fn().mockRejectedValue(new Error("ffmpeg failed: Invalid data"))
    await expect(retryOnShortage(attempt, { limitMs: 600_000, label: "ffmpeg" }, d)).rejects.toThrow("Invalid data")
    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it("no retry once less than half of the budget would be left", async () => {
    const d = deps()
    // The first try ran for most of its budget before it failed.
    const attempt = vi.fn().mockImplementation(async () => {
      await d.sleep(4_000)
      throw shortage()
    })
    await expect(retryOnShortage(attempt, { limitMs: 10_000, label: "ffmpeg" }, d)).rejects.toSatisfy(isResourceShortage)
    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it("a stop during the wait ends it", async () => {
    const stop = new AbortController()
    const d = { ...deps(), sleep: async () => { stop.abort(new Error("cancelled")); throw new Error("cancelled") } }
    const attempt = vi.fn().mockRejectedValue(shortage())
    await expect(retryOnShortage(attempt, { limitMs: 600_000, label: "ffmpeg", signal: stop.signal }, d)).rejects.toThrow("cancelled")
    expect(attempt).toHaveBeenCalledTimes(1)
  })
})

/** The kernel's word, as the test sets it: `refusing` is whether it just refused the container a process or a thread. */
function kernel(refusing: boolean | (() => boolean)): KernelRefusals & { looks: number; asked: number[] } {
  const k = {
    looks: 0,
    asked: [] as number[],
    look: () => void (k.looks += 1),
    refusedWithin: (ms: number) => {
      k.asked.push(ms)
      return typeof refusing === "function" ? refusing() : refusing
    },
  }
  return k
}

describe("causedByResourceShortage", () => {
  it("finds the mark on the failure or on what caused it", () => {
    expect(causedByResourceShortage(shortage())).toBe(true)
    expect(causedByResourceShortage(new Error("Could not add the captions", { cause: shortage() }))).toBe(true)
    expect(causedByResourceShortage(new Error("Could not add the captions", { cause: new Error("ffmpeg failed: Invalid data") }))).toBe(false)
    expect(causedByResourceShortage(undefined)).toBe(false)
  })
})

describe("what a launch can say about its own failure", () => {
  /** Runs one failing try and returns the mark it made of `ownWords`. */
  async function markOf(ownWords: boolean, k: KernelRefusals | undefined) {
    let made: object | undefined
    const attempt = async (_limitMs: number, evidence: LaunchEvidence) => {
      made = evidence.mark(ownWords)
      throw new Error("ffmpeg failed: Error while opening encoder")
    }
    await expect(retryOnShortage(attempt, { limitMs: 600_000, label: "ffmpeg", ...(k ? { kernel: k } : {}) }, deps())).rejects.toThrow("opening encoder")
    return made
  }

  it("its own words mark it, whatever the kernel counted", async () => {
    expect(await markOf(true, kernel(false))).toEqual({ resourceShortage: true })
    expect(await markOf(true, undefined)).toEqual({ resourceShortage: true })
  })

  it("the kernel having just refused the container a thread marks it, whatever it printed", async () => {
    const k = kernel(true)
    expect(await markOf(false, k)).toEqual({ resourceShortage: true })
    expect(k.asked).toEqual([KERNEL_REFUSAL_RECENT_MS])
  })

  it("neither: the failure is the launch's own", async () => {
    expect(await markOf(false, kernel(false))).toEqual({})
    expect(await markOf(false, undefined)).toEqual({})
  })
})

describe("retryOnShortage with the kernel's count", () => {
  it("looks at the count as each try begins, so a refusal counted when it fails came since", async () => {
    const d = deps()
    const k = kernel(false)
    const attempt = vi.fn().mockRejectedValueOnce(shortage()).mockResolvedValue("done")
    await retryOnShortage(attempt, { limitMs: 600_000, label: "ffmpeg", kernel: k }, d)
    expect(k.looks).toBe(2)
  })

  it("while the kernel keeps refusing, a launch is tried again for minutes, no wait longer than the cap", async () => {
    const d = deps()
    const attempt = vi.fn().mockRejectedValue(shortage())
    await expect(retryOnShortage(attempt, { limitMs: 3_600_000, label: "ffmpeg", kernel: kernel(true) }, d)).rejects.toSatisfy(isResourceShortage)
    expect(d.waits).toEqual([2_000, 4_000, 8_000, 16_000, ...Array.from({ length: 7 }, () => SHORTAGE_RETRY_MAX_WAIT_MS)])
    // The tries stop once the window has passed since the first failure.
    expect(d.waits.reduce((sum, ms) => sum + ms, 0)).toBe(SHORTAGE_RETRY_WINDOW_MS)
    expect(attempt).toHaveBeenCalledTimes(12)
    expect(d.warned.at(-1)).toContain("the container is at its process limit")
  })

  it("it succeeds as soon as the box has a process free again", async () => {
    const d = deps()
    const attempt = vi.fn()
    for (let i = 0; i < 6; i++) attempt.mockRejectedValueOnce(shortage())
    attempt.mockResolvedValue("done")
    expect(await retryOnShortage(attempt, { limitMs: 3_600_000, label: "ffmpeg", kernel: kernel(true) }, d)).toBe("done")
    expect(attempt).toHaveBeenCalledTimes(7)
  })

  it("once the kernel is quiet again, only the three tries are left", async () => {
    const d = deps()
    let failures = 0
    const attempt = vi.fn().mockImplementation(async () => {
      failures += 1
      throw shortage()
    })
    // The kernel refused during the first four tries, then stopped.
    const k = kernel(() => failures <= 4)
    await expect(retryOnShortage(attempt, { limitMs: 3_600_000, label: "ffmpeg", kernel: k }, d)).rejects.toSatisfy(isResourceShortage)
    expect(attempt).toHaveBeenCalledTimes(5)
  })

  it("the minutes never outlive the launch's own budget: a retry only while half of it is left", async () => {
    const d = deps()
    const attempt = vi.fn().mockRejectedValue(shortage())
    await expect(retryOnShortage(attempt, { limitMs: 60_000, label: "ffmpeg", kernel: kernel(true) }, d)).rejects.toSatisfy(isResourceShortage)
    // 2 + 4 + 8 + 16 s of waiting leave exactly half; the next wait would not.
    expect(d.waits).toEqual([2_000, 4_000, 8_000, 16_000])
    expect(attempt.mock.calls.map((c) => c[0])).toEqual([60_000, 58_000, 54_000, 46_000, 30_000])
  })

  it("a failure that is not a shortage is thrown at once, whatever the kernel counted", async () => {
    const d = deps()
    const attempt = vi.fn().mockRejectedValue(new Error("ffmpeg failed: Invalid data"))
    await expect(retryOnShortage(attempt, { limitMs: 600_000, label: "ffmpeg", kernel: kernel(true) }, d)).rejects.toThrow("Invalid data")
    expect(attempt).toHaveBeenCalledTimes(1)
  })
})
