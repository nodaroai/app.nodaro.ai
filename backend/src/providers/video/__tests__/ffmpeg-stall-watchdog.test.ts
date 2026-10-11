// The no-progress watchdog for chunked renders (C4 bug fixes, decided
// 2026-10-10): ffmpeg's scheduler can elect a closed input forever and the
// launch sleeps on every thread with its stats line frozen (19 of 281 six-input
// launches on the D5 venue). A launch is ALIVE while its stats move (frame,
// output time or size — never elapsed/fps/speed, which tick during the stall
// too) OR it burns CPU (a sparse chunk decodes hours of source between two
// output frames). Frozen stats AND an idle process for the stall window is the
// proven signature, and only that is killed. A killed chunk is retried a
// bounded number of times inside its own kill budget, then fails honestly.
import { describe, it, expect, vi, afterEach } from "vitest"
import { EventEmitter } from "node:events"
import {
  FFMPEG_STALL_MS,
  FFMPEG_STALL_CPU_SEC,
  SLICE_STALL_ATTEMPTS,
  ffmpegStallError,
  isFfmpegStall,
  parseProcStatCpuSec,
  retryStalledLaunch,
  statsProgressKey,
  watchForStall,
} from "../ffmpeg-stall-watchdog.js"

/** The stats line the evidence's stalled launch printed every 0.5 s (only
 *  fps / speed / elapsed move — the picture is stuck at frame 56). */
const stalledLine = (elapsedSec: number) =>
  `frame=   56 fps=${(56 / elapsedSec).toFixed(1)} q=24.0 size=    2048KiB time=00:00:01.80 bitrate=9320.9kbits/s speed=${(1.8 / elapsedSec).toFixed(3)}x elapsed=0:00:${elapsedSec.toFixed(2)}    \r`
const videoLine = (frame: number) =>
  `frame=${String(frame).padStart(5)} fps=9.1 q=24.0 size=    ${frame * 32}KiB time=00:00:${(frame / 30).toFixed(2).padStart(5, "0")} bitrate=9175.3kbits/s speed=0.29x elapsed=0:00:05.50    \r`

describe("statsProgressKey — what counts as output progress", () => {
  it("the frozen stall line keeps one key however long elapsed/fps/speed tick", () => {
    const a = statsProgressKey(stalledLine(6))
    const b = statsProgressKey(stalledLine(31.5))
    expect(a).toBeDefined()
    expect(b).toBe(a)
  })

  it("a new frame, output time or size is a new key", () => {
    expect(statsProgressKey(videoLine(50))).not.toBe(statsProgressKey(videoLine(51)))
  })

  it("reads an audio-only slice's line (no frame=) by its time and size", () => {
    const one = statsProgressKey("size=     512KiB time=00:00:05.12 bitrate= 819.2kbits/s speed=10.2x elapsed=0:00:00.50    \r")
    const two = statsProgressKey("size=     768KiB time=00:00:07.68 bitrate= 819.2kbits/s speed=10.2x elapsed=0:00:01.00    \r")
    expect(one).toBeDefined()
    expect(two).not.toBe(one)
  })

  it("takes the LAST complete stats line, ignoring a half-written one after it", () => {
    const text = `${videoLine(10)}${videoLine(11)}frame=   1`
    expect(statsProgressKey(text)).toBe(statsProgressKey(videoLine(11)))
  })

  it("is undefined when nothing is a stats line (the banner, stream mapping)", () => {
    expect(statsProgressKey("ffmpeg version n8.1.2\n  Stream #0:0 (h264) -> tpad:default\n    creation_time   : 2024-01-01\n")).toBeUndefined()
  })
})

describe("parseProcStatCpuSec — a process's CPU time from /proc/<pid>/stat", () => {
  it("sums utime + stime (fields 14 and 15) in clock ticks, after the comm's LAST ')'", () => {
    // comm may hold spaces and parentheses; fields 3.. follow the last ')'.
    const fields = ["S", "1", "1", "1", "0", "-1", "4194304", "0", "0", "0", "0", "250", "130", "0", "0"]
    expect(parseProcStatCpuSec(`4242 (ff (x) y) ${fields.join(" ")}`)).toBeCloseTo(3.8, 6)
  })

  it("is undefined for text it cannot read", () => {
    expect(parseProcStatCpuSec("")).toBeUndefined()
    expect(parseProcStatCpuSec("4242 (ffmpeg) S 1")).toBeUndefined()
  })
})

/** A child the watchdog can watch: a pid and a stderr that emits text. */
function fakeChild() {
  const stderr = new EventEmitter()
  return { pid: 4242, stderr, write: (s: string) => stderr.emit("data", Buffer.from(s)) }
}

describe("watchForStall — kills only a launch that is frozen AND idle", () => {
  afterEach(() => vi.useRealTimers())

  const run = (opts: { cpu: () => number | undefined; feed?: (t: number, write: (s: string) => void) => void; forMs: number }) => {
    vi.useFakeTimers()
    const child = fakeChild()
    let stalledAt: number | undefined
    const t0 = Date.now()
    const stop = watchForStall(child, { readCpuSec: opts.cpu }, () => { stalledAt = Date.now() - t0 })
    for (let t = 0; t < opts.forMs; t += 250) {
      opts.feed?.(t, child.write)
      vi.advanceTimersByTime(250)
    }
    stop()
    return stalledAt
  }

  it("frozen stats + no CPU: stopped once the window passes, not before", () => {
    const at = run({ cpu: () => 1.0, feed: (t, w) => t % 500 === 0 && w(stalledLine(2 + t / 1000)), forMs: FFMPEG_STALL_MS + 5_000 })
    expect(at).toBeDefined()
    expect(at!).toBeGreaterThanOrEqual(FFMPEG_STALL_MS)
    expect(at!).toBeLessThanOrEqual(FFMPEG_STALL_MS + 2_000)
  })

  it("SLOW progress — one new frame every half window, idle CPU — is never stopped", () => {
    let frame = 0
    const at = run({
      cpu: () => 1.0,
      feed: (t, w) => { if (t % (FFMPEG_STALL_MS / 2) === 0) w(videoLine(++frame)) },
      forMs: FFMPEG_STALL_MS * 5,
    })
    expect(at).toBeUndefined()
  })

  it("a sparse chunk decoding between windows (stats frozen at frame 0, CPU busy) is never stopped", () => {
    let cpu = 0
    const at = run({
      cpu: () => (cpu += 0.25), // a quarter CPU-second per 250 ms tick of the fake clock… read once per tick
      feed: (t, w) => t % 500 === 0 && w("frame=    0 fps=0.0 q=0.0 size=       0KiB time=N/A bitrate=N/A speed=N/A elapsed=0:00:02.00    \r"),
      forMs: FFMPEG_STALL_MS * 4,
    })
    expect(at).toBeUndefined()
  })

  it("a trickle of CPU under the threshold (the stats thread printing) does not count as alive", () => {
    let cpu = 0
    const perWindow = FFMPEG_STALL_CPU_SEC / 2
    const at = run({ cpu: () => (cpu += perWindow / (FFMPEG_STALL_MS / 1000)), forMs: FFMPEG_STALL_MS + 5_000 })
    expect(at).toBeDefined()
  })

  it("where CPU time cannot be read (no /proc) it is inert — a frozen launch is left to its kill budget", () => {
    const at = run({ cpu: () => undefined, feed: (t, w) => t % 500 === 0 && w(stalledLine(2 + t / 1000)), forMs: FFMPEG_STALL_MS * 3 })
    expect(at).toBeUndefined()
  })
})

describe("retryStalledLaunch — a stalled chunk is retried inside its own kill budget", () => {
  it("a stall, then success: launched again with the budget the stalled attempt did not use", async () => {
    const budgets: number[] = []
    const result = await retryStalledLaunch(async (timeoutMs) => {
      budgets.push(timeoutMs)
      if (budgets.length === 1) throw ffmpegStallError(42_000)
      return "ok"
    }, { timeoutMs: 600_000 })
    expect(result).toBe("ok")
    expect(budgets).toEqual([600_000, 558_000])
  })

  it("never retries a failure that is not a stall (a real ffmpeg error, a timeout)", async () => {
    let calls = 0
    const timeout = Object.assign(new Error("ffmpeg failed: timed out"), { killed: true, timedOut: true })
    await expect(retryStalledLaunch(async () => { calls++; throw timeout }, { timeoutMs: 600_000 })).rejects.toBe(timeout)
    expect(calls).toBe(1)
  })

  it(`fails honestly after ${SLICE_STALL_ATTEMPTS} stalled attempts`, async () => {
    let calls = 0
    const err = await retryStalledLaunch(async () => { calls++; throw ffmpegStallError(35_000) }, { timeoutMs: 600_000 })
      .catch((e: unknown) => e as Error)
    expect(calls).toBe(SLICE_STALL_ATTEMPTS)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/^ffmpeg failed: /)
    expect((err as Error).message).toContain(`no progress for ${FFMPEG_STALL_MS / 1000} s`)
    expect((err as Error).message).toContain(`${SLICE_STALL_ATTEMPTS} attempts`)
    expect(isFfmpegStall(err)).toBe(false) // final: nothing above retries it again
  })

  it("stops early once the stalls have spent the whole budget", async () => {
    let calls = 0
    await expect(
      retryStalledLaunch(async () => { calls++; throw ffmpegStallError(70_000) }, { timeoutMs: 120_000 }),
    ).rejects.toThrow(/no progress/)
    expect(calls).toBe(2) // 120 − 70 = 50 s left after one; nothing after two
  })

  it("asks before each retry (the job's cancellation check) — and a cancel there ends it", async () => {
    let calls = 0
    const cancelled = new Error("cancelled")
    await expect(
      retryStalledLaunch(async () => { calls++; throw ffmpegStallError(31_000) }, {
        timeoutMs: 600_000,
        beforeRetry: async () => { throw cancelled },
      }),
    ).rejects.toBe(cancelled)
    expect(calls).toBe(1)
  })
})
