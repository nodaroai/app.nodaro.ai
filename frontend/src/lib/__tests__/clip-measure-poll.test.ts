/**
 * The editor's side of the background clip measurement (decided 2026-10-12,
 * R4): ask, and if the server says it is still measuring, ask again after the
 * pause it names, until the answer is in. A big file is never one long request,
 * and the second run of the same address answers on the first ask.
 */
import { describe, it, expect, vi } from "vitest"
import { CLIP_MEASURE_MAX_WAIT_MS, ClipMeasureStopped, pollClipMeasure, type ClipMeasureAnswer } from "../clip-measure-poll"

const READY = { status: "ready", durationMs: 14_600, width: 3840, height: 2160, faces: "present" } as const
const running = (retryAfterMs?: number): ClipMeasureAnswer => ({ data: { status: "running", ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) } })

function harness(answers: Array<ClipMeasureAnswer | Error>) {
  let clock = 0
  const sleeps: number[] = []
  const ask = vi.fn(async () => {
    const next = answers.shift()
    if (!next) throw new Error("asked more often than scripted")
    if (next instanceof Error) throw next
    return next
  })
  const sleep = vi.fn(async (ms: number) => { sleeps.push(ms); clock += ms })
  return { ask, sleep, sleeps, now: () => clock }
}

describe("pollClipMeasure", () => {
  it("returns a measured clip on the first ask without waiting, minus the status marker", async () => {
    const h = harness([{ data: READY }])
    await expect(pollClipMeasure({ ask: h.ask, sleep: h.sleep, now: h.now })).resolves.toEqual({ durationMs: 14_600, width: 3840, height: 2160, faces: "present" })
    expect(h.sleep).not.toHaveBeenCalled()
  })

  it("asks again after the pause the server names, until it is ready", async () => {
    const h = harness([running(1500), running(1500), { data: READY }])
    await expect(pollClipMeasure({ ask: h.ask, sleep: h.sleep, now: h.now })).resolves.toMatchObject({ durationMs: 14_600 })
    expect(h.ask).toHaveBeenCalledTimes(3)
    expect(h.sleeps).toEqual([1500, 1500])
  })

  it("keeps the pause between half a second and five, and uses two seconds when the server names none", async () => {
    const h = harness([running(10), running(60_000), running(), { data: READY }])
    await pollClipMeasure({ ask: h.ask, sleep: h.sleep, now: h.now })
    expect(h.sleeps).toEqual([500, 5000, 2000])
  })

  it("tells the person once that the video is being checked", async () => {
    const onWaiting = vi.fn()
    const h = harness([running(), running(), { data: READY }])
    await pollClipMeasure({ ask: h.ask, sleep: h.sleep, now: h.now, onWaiting })
    expect(onWaiting).toHaveBeenCalledTimes(1)
    const quick = harness([{ data: READY }])
    const quiet = vi.fn()
    await pollClipMeasure({ ask: quick.ask, sleep: quick.sleep, now: quick.now, onWaiting: quiet })
    expect(quiet).not.toHaveBeenCalled()
  })

  it("passes a refusal from the server straight through, with its sentence", async () => {
    const h = harness([running(), new Error("This file has no picture.")])
    await expect(pollClipMeasure({ ask: h.ask, sleep: h.sleep, now: h.now })).rejects.toThrow("This file has no picture.")
  })

  it("gives up after the longest wait, in a sentence that says the next run will be quick", async () => {
    const answers: ClipMeasureAnswer[] = Array.from({ length: 1000 }, () => running(5000))
    const h = harness(answers)
    const err = await pollClipMeasure({ ask: h.ask, sleep: h.sleep, now: h.now }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/taking longer than expected/i)
    expect(h.now()).toBeGreaterThanOrEqual(CLIP_MEASURE_MAX_WAIT_MS)
    expect(h.now()).toBeLessThan(CLIP_MEASURE_MAX_WAIT_MS + 6000)
  })

  it("stops when the run is stopped", async () => {
    const ctrl = new AbortController()
    const h = harness([running(), running(), { data: READY }])
    h.sleep.mockImplementationOnce(async () => { ctrl.abort() })
    await expect(pollClipMeasure({ ask: h.ask, sleep: h.sleep, now: h.now, signal: ctrl.signal })).rejects.toThrow(/stopped/i)
    expect(h.ask).toHaveBeenCalledTimes(1)
  })

  it("refuses an answer it does not understand rather than looping on it", async () => {
    const h = harness([{ data: { status: "nope" } } as unknown as ClipMeasureAnswer])
    await expect(pollClipMeasure({ ask: h.ask, sleep: h.sleep, now: h.now })).rejects.toThrow(/unexpected/i)
  })

  it("F4: stops with a typed reason when the run is stopped, so a caller can tell Stop from a failure", async () => {
    const ctrl = new AbortController()
    const h = harness([running(), { data: READY }])
    h.sleep.mockImplementationOnce(async () => { ctrl.abort() })
    const err = await pollClipMeasure({ ask: h.ask, sleep: h.sleep, now: h.now, signal: ctrl.signal }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ClipMeasureStopped)
    expect((err as ClipMeasureStopped).reason).toBe("aborted")
  })

  it("F4: stops when the workflow went stale (a restarted run), at the next pause, without asking again", async () => {
    let stale = false
    const h = harness([running(), { data: READY }])
    h.sleep.mockImplementationOnce(async () => { stale = true })
    const err = await pollClipMeasure({ ask: h.ask, sleep: h.sleep, now: h.now, isStale: () => stale }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ClipMeasureStopped)
    expect((err as ClipMeasureStopped).reason).toBe("stale")
    expect(h.ask).toHaveBeenCalledTimes(1)
  })

  it("F4: a signal already aborted, or a workflow already stale, asks nothing at all", async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const h = harness([{ data: READY }])
    await expect(pollClipMeasure({ ask: h.ask, sleep: h.sleep, now: h.now, signal: ctrl.signal })).rejects.toBeInstanceOf(ClipMeasureStopped)
    await expect(pollClipMeasure({ ask: h.ask, sleep: h.sleep, now: h.now, isStale: () => true })).rejects.toBeInstanceOf(ClipMeasureStopped)
    expect(h.ask).not.toHaveBeenCalled()
  })

  it("F4: the default pause ends the moment the run is stopped, not at the end of the pause", async () => {
    vi.useFakeTimers()
    try {
      const ctrl = new AbortController()
      const ask = vi.fn(async () => running(5000))
      const settled = pollClipMeasure({ ask, signal: ctrl.signal }).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(100)
      expect(ask).toHaveBeenCalledTimes(1)
      ctrl.abort()
      await vi.advanceTimersByTimeAsync(0)
      expect(await settled).toBeInstanceOf(ClipMeasureStopped)
      expect(ask).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
