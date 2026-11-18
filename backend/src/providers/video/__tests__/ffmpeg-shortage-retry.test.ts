import { describe, expect, it, vi } from "vitest"
import {
  SHORTAGE_RETRY_ATTEMPTS,
  isResourceShortage,
  retryOnShortage,
  spawnShowsShortage,
  stderrShowsShortage,
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
