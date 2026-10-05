// Memory-weighted ffmpeg admission (decided 2026-10-05, fixing the 4K OOM).
//
// Measured on the Railway nodaro-ci runner (2 vCPU quota, memory.max 7,629 MiB,
// ffmpeg n8.1.2, quota thread counts): two 30-segment 4K Apply EDL finals at
// once reached 7,427 MiB of cgroup anon — memory adds up with no sharing — and
// one was OOM-killed. Every launch therefore reserves its PREDICTED peak from a
// budget before it starts; one that does not fit waits (never fails), one
// bigger than the whole budget runs alone, and the slot count stays as a
// second limit.
import { describe, it, expect } from "vitest"
import { FfmpegAdmission, FFMPEG_ADMISSION_MAX_OVERTAKES, type AdmissionLimits } from "../ffmpeg-admission.js"
import { ffmpegMemoryBudget } from "../ffmpeg-memory.js"
import { canvasPeakMemoryMiB } from "../ffmpeg-memory-model.js"
import { SlotWaitLedger } from "../../../lib/ffmpeg-slot-wait.js"

const MIB = 1024 * 1024
const GIB = 1024
/** The budget the measured runner gets with the default reserve and headroom. */
const RUNNER = ffmpegMemoryBudget(
  {},
  (path) => ({ "/proc/self/cgroup": "0::/\n", "/sys/fs/cgroup/memory.max": "8000000000\n" } as Record<string, string>)[path],
  330_437 * MIB,
)

const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve() }

/** An admission controller over fixed limits, and a launcher that records what runs. */
function harness(limits: Partial<AdmissionLimits> = {}) {
  const resolved: AdmissionLimits = { slots: 4, budgetMiB: RUNNER.budgetMiB, defaultPeakMiB: 512, ...limits }
  const admission = new FfmpegAdmission(() => resolved)
  const running = new Map<string, () => void>()
  const started: string[] = []
  let peakConcurrent = 0
  const launch = (name: string, peakMemoryMiB?: number, signal?: AbortSignal, observer?: SlotWaitLedger) => {
    const done = admission.acquire({ peakMemoryMiB, signal, observer }).then((release) => {
      started.push(name)
      running.set(name, () => { running.delete(name); release() })
      peakConcurrent = Math.max(peakConcurrent, running.size)
    })
    done.catch(() => undefined)
    return done
  }
  const finish = async (name: string) => {
    const end = running.get(name)
    if (!end) throw new Error(`${name} is not running`)
    end()
    await flush()
  }
  return { admission, launch, finish, started, running, peakConcurrent: () => peakConcurrent }
}

describe("FfmpegAdmission — memory-weighted, slot-capped, FIFO with bounded overtaking", () => {
  it("the measured runner's budget is 5,022 MiB (7,629 − 2,048 reserve, × 0.9)", () => {
    expect(RUNNER).toMatchObject({ limitMiB: 7629, budgetMiB: 5022 })
  })

  it("two predicted 3.6 GiB launches on the 7.4 GiB box run one at a time", async () => {
    const h = harness()
    void h.launch("a", 3.6 * GIB)
    void h.launch("b", 3.6 * GIB)
    await flush()
    expect(h.started).toEqual(["a"])
    expect(h.admission.state).toMatchObject({ running: 1, waiting: 1 })
    await h.finish("a")
    expect(h.started).toEqual(["a", "b"])
    await h.finish("b")
    expect(h.admission.state).toEqual({ running: 0, reservedMiB: 0, waiting: 0 })
  })

  it("on a 7.4 GiB box read through the budget (not a 7.4 GiB budget) they serialize too", async () => {
    const box = ffmpegMemoryBudget({ fallbackLimitMiB: 7.4 * GIB }, () => undefined, 330_437 * MIB)
    const h = harness({ budgetMiB: box.budgetMiB })
    void h.launch("a", 3.6 * GIB)
    void h.launch("b", 3.6 * GIB)
    await flush()
    expect(h.started).toEqual(["a"])
  })

  it("two 20-segment 4K chunks serialize on the runner — the model's own prediction, not a retyped figure — and run together where the budget holds both", async () => {
    // The pair is read from the model (with its +150 MiB margin): ≈ 3,037 MiB each, 6,074 together. That is over
    // the runner's 5,022 MiB budget, and was already over round 2's 5,944 — the reserve is not what serializes
    // it. The pair measured safe (6,069 MiB anon), so on the small box it simply gives up its concurrency.
    const peak = canvasPeakMemoryMiB({ width: 3840, height: 2160 }, 20, { decode: 2, filter: 2, encode: 2 })
    expect(2 * peak).toBeGreaterThan(RUNNER.budgetMiB)
    expect(2 * peak).toBeGreaterThan(5944) // round 2's budget: it serialized there too
    const small = harness()
    void small.launch("a", peak)
    void small.launch("b", peak)
    await flush()
    expect(small.started).toEqual(["a"])
    const roomy = harness({ budgetMiB: 2 * peak })
    void roomy.launch("a", peak)
    void roomy.launch("b", peak)
    await flush()
    expect(roomy.started).toEqual(["a", "b"])
  })

  it("many light launches still run 4 at once (the slot count), the next as soon as one ends", async () => {
    const h = harness()
    for (let i = 0; i < 10; i++) void h.launch(`l${i}`) // no prediction: the default estimate
    await flush()
    expect(h.started).toEqual(["l0", "l1", "l2", "l3"])
    await h.finish("l0")
    expect(h.started).toEqual(["l0", "l1", "l2", "l3", "l4"])
    expect(h.peakConcurrent()).toBe(4)
  })

  it("light launches keep running beside a heavy one, and past a heavy one waiting for memory", async () => {
    const h = harness()
    void h.launch("heavy-1", 3586)
    void h.launch("heavy-2", 3586) // waits: 3,586 × 2 > 5,022
    void h.launch("l0")
    void h.launch("l1")
    void h.launch("l2")
    await flush()
    // 3,586 + 2 x 512 = 4,610 fits; a third light (5,122) is over the 5,022 budget and waits.
    expect(h.started).toEqual(["heavy-1", "l0", "l1"])
    // The lights never delay heavy-2: once heavy-1 ends it fits beside them.
    await h.finish("heavy-1")
    expect(h.started.at(-1)).toBe("heavy-2")
  })

  it("an oversized launch waits for nothing else to hold memory, then runs ALONE — no deadlock", async () => {
    const h = harness()
    void h.launch("l0")
    void h.launch("l1")
    void h.launch("huge", RUNNER.budgetMiB + 1)
    await flush()
    expect(h.started).toEqual(["l0", "l1"])
    await h.finish("l0")
    expect(h.started).toEqual(["l0", "l1"])
    await h.finish("l1")
    expect(h.started).toEqual(["l0", "l1", "huge"])
    // While it runs, nothing else is admitted, however small.
    void h.launch("l2")
    await flush()
    expect(h.started).toEqual(["l0", "l1", "huge"])
    await h.finish("huge")
    expect(h.started).toEqual(["l0", "l1", "huge", "l2"])
  })

  it("an oversized launch is not starved by a stream of small ones: at most a bounded number pass it", async () => {
    const h = harness()
    void h.launch("seed")
    void h.launch("huge", 100 * GIB)
    await flush()
    // A stream: each time a light ends, another arrives. Without a bound the
    // box would never drain and `huge` would wait forever.
    let overtakers = 0
    let current = "seed"
    for (let i = 0; i < 100 && !h.started.includes("huge"); i++) {
      void h.launch(`s${i}`)
      await flush()
      if (h.started.includes(`s${i}`)) overtakers++
      await h.finish(current)
      current = `s${i}`
      if (!h.running.has(current)) break
    }
    if (h.running.has(current)) await h.finish(current)
    expect(h.started).toContain("huge")
    expect(overtakers).toBeLessThanOrEqual(FFMPEG_ADMISSION_MAX_OVERTAKES)
  })

  it("a memory-blocked waiter is passed at most the bound, then strict FIFO holds behind it", async () => {
    const h = harness({ slots: 32 })
    void h.launch("heavy-1", 3586)
    void h.launch("heavy-2", 3586)
    for (let i = 0; i < FFMPEG_ADMISSION_MAX_OVERTAKES + 3; i++) void h.launch(`l${i}`, 1)
    await flush()
    const passed = h.started.filter((n) => n.startsWith("l"))
    expect(passed).toHaveLength(FFMPEG_ADMISSION_MAX_OVERTAKES)
    expect(h.started).not.toContain("heavy-2")
    await h.finish("heavy-1")
    expect(h.started).toContain("heavy-2")
    expect(h.started.filter((n) => n.startsWith("l"))).toHaveLength(FFMPEG_ADMISSION_MAX_OVERTAKES + 3)
  })

  it("the slot count stays a second limit even when memory is plentiful", async () => {
    const h = harness({ slots: 2, budgetMiB: 1_000_000 })
    void h.launch("a", 10)
    void h.launch("b", 10)
    void h.launch("c", 10)
    await flush()
    expect(h.started).toEqual(["a", "b"])
  })

  it("a zero, negative or non-finite prediction gets the default estimate — never a launch that blocks forever", async () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -5]) {
      const h = harness()
      void h.launch("x", bad)
      await flush()
      expect(h.started).toEqual(["x"])
      expect(h.admission.state.reservedMiB).toBe(512)
    }
  })

  it("a released holder frees its memory — the waiter behind it runs (error or kill alike)", async () => {
    const h = harness()
    void h.launch("a", 3586)
    void h.launch("b", 3586)
    await flush()
    await h.finish("a") // its work failed or was killed: the launcher releases in a finally
    expect(h.started).toEqual(["a", "b"])
  })

  it("a release is idempotent — a double release never frees memory twice", async () => {
    const admission = new FfmpegAdmission(() => ({ slots: 4, budgetMiB: 5022, defaultPeakMiB: 512 }))
    const releaseA = await admission.acquire({ peakMemoryMiB: 3000 })
    await admission.acquire({ peakMemoryMiB: 1000 })
    releaseA()
    releaseA()
    expect(admission.state).toMatchObject({ running: 1, reservedMiB: 1000 })
  })

  it("an aborted waiter is rejected and removed, and the waiters behind a blocked head it was then run", async () => {
    const h = harness({ slots: 32 })
    void h.launch("heavy-1", 3586)
    const controller = new AbortController()
    const blocked = h.launch("heavy-2", 3586, controller.signal)
    for (let i = 0; i < FFMPEG_ADMISSION_MAX_OVERTAKES; i++) void h.launch(`l${i}`, 1) // spend the bound
    void h.launch("after", 1)
    await flush()
    expect(h.started).not.toContain("after") // strict FIFO now holds behind heavy-2
    controller.abort(new Error("cancelled"))
    await expect(blocked).rejects.toThrow("cancelled")
    await flush()
    expect(h.started).toContain("after")
    expect(h.started).not.toContain("heavy-2")
    expect(h.admission.state.waiting).toBe(0)
  })

  it("an already-aborted signal is refused without taking anything", async () => {
    const h = harness()
    const controller = new AbortController()
    controller.abort(new Error("gone"))
    await expect(h.launch("x", 100, controller.signal)).rejects.toThrow("gone")
    expect(h.admission.state).toEqual({ running: 0, reservedMiB: 0, waiting: 0 })
  })

  it("a wait for MEMORY counts in the job's slot-wait ledger, even with a slot free", async () => {
    let t = 0
    const ledger = new SlotWaitLedger(() => t)
    const h = harness()
    void h.launch("heavy-1", 3586)
    await flush()
    void h.launch("heavy-2", 3586, undefined, ledger) // 3 slots free, no memory
    await flush()
    t += 120_000
    expect(ledger.waitedMs()).toBe(120_000)
    await h.finish("heavy-1")
    t += 60_000
    expect(ledger.waitedMs()).toBe(120_000) // the wait ended at its grant
  })
})
