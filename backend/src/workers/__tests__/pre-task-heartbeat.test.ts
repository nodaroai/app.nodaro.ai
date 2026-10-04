/**
 * The host-side `pre-task` heartbeat that keeps a live run from being failed +
 * refunded by the reconcile sweep (staging Pro 3D Render job 99ede351, failed
 * at minute 31 while its worker was still running).
 *
 * The end-to-end half — a real cron tick against a row the beats keep fresh —
 * lives in `lib/reconcile/__tests__/pre-task-liveness.test.ts`; that the video
 * worker wraps EVERY handler it dispatches, core and plugin alike, lives in
 * `video-worker.test.ts` (beats counted through the processor) and
 * `video-worker-heartbeat-wiring.test.ts` (the dispatch-site wrap is present).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const refresh = vi.hoisted(() => vi.fn(async (_jobId: string): Promise<void> => {}))
const recordWait = vi.hoisted(() => vi.fn(async (_jobId: string, _totalMs: number): Promise<void> => {}))
vi.mock("../../lib/reconcile/persistence.js", () => ({ refreshPreTaskSentinel: refresh, recordJobSlotWait: recordWait }))

import {
  PRE_TASK_HEARTBEAT_MAX_MS,
  PRE_TASK_HEARTBEAT_MS,
  withPreTaskHeartbeat,
  effectiveHeartbeatMaxMs,
} from "../pre-task-heartbeat.js"
import { STALE_THRESHOLD_MS, isSyncKind } from "../../lib/reconcile/types.js"
import { NODE_TIMEOUT_MS } from "../../services/workflow-engine/types.js"
import { DrainAbortError } from "../../lib/worker-drain.js"
import { currentSlotWaitLedger } from "../../lib/ffmpeg-slot-wait.js"

const MIN = 60_000
const THRESHOLD = STALE_THRESHOLD_MS["pre-task"]
const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) })

beforeEach(() => {
  refresh.mockReset()
  refresh.mockResolvedValue(undefined)
  recordWait.mockReset()
  recordWait.mockResolvedValue(undefined)
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-09-15T18:18:44Z"))
})
afterEach(() => vi.useRealTimers())

describe("withPreTaskHeartbeat", () => {
  it("beats for its job once per interval while the handler runs, and never after it settles", async () => {
    const run = withPreTaskHeartbeat(async () => { await sleep(35 * MIN) })({}, { jobId: "job-1" })
    await vi.advanceTimersByTimeAsync(35 * MIN)
    await run

    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(34)
    expect(new Set(refresh.mock.calls.map(([jobId]) => jobId))).toEqual(new Set(["job-1"]))

    const beats = refresh.mock.calls.length
    await vi.advanceTimersByTimeAsync(30 * MIN)
    expect(refresh.mock.calls.length).toBe(beats)
  })

  it("honours a handler's own budget: beats continue past the default cap and stop at `maxMs`", async () => {
    const budget = PRE_TASK_HEARTBEAT_MAX_MS + 4 * 60 * MIN
    const run = withPreTaskHeartbeat(async () => { await sleep(budget + 60 * MIN) }, { maxMs: budget })({}, { jobId: "job-1" })

    await vi.advanceTimersByTimeAsync(PRE_TASK_HEARTBEAT_MAX_MS + 60 * MIN)
    expect(refresh.mock.calls.length).toBeGreaterThan(PRE_TASK_HEARTBEAT_MAX_MS / PRE_TASK_HEARTBEAT_MS)

    await vi.advanceTimersByTimeAsync(3 * 60 * MIN) // → the declared budget
    const atBudget = refresh.mock.calls.length
    expect(atBudget).toBeGreaterThanOrEqual(budget / PRE_TASK_HEARTBEAT_MS - 1)

    await vi.advanceTimersByTimeAsync(THRESHOLD + PRE_TASK_HEARTBEAT_MS)
    expect(refresh.mock.calls.length).toBe(atBudget)

    await vi.advanceTimersByTimeAsync(60 * MIN)
    await run
  })

  // A declared budget can only EXTEND the default: storage I/O sits outside
  // every budget, so a shorter cap would only take slack away from a live run,
  // and a non-finite one would switch the hung backstop off.
  it("a declared budget only extends the default — shorter, zero, negative, NaN and Infinity all keep the default cap", async () => {
    for (const bad of [10 * MIN, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      expect(effectiveHeartbeatMaxMs(bad), String(bad)).toBe(PRE_TASK_HEARTBEAT_MAX_MS)
    }
    expect(effectiveHeartbeatMaxMs(PRE_TASK_HEARTBEAT_MAX_MS + 1)).toBe(PRE_TASK_HEARTBEAT_MAX_MS + 1)

    // Through the wrapper: a 10-minute budget still beats to the DEFAULT cap, then stops.
    const run = withPreTaskHeartbeat(async () => { await sleep(PRE_TASK_HEARTBEAT_MAX_MS + 60 * MIN) }, { maxMs: 10 * MIN })({}, { jobId: "job-1" })
    await vi.advanceTimersByTimeAsync(PRE_TASK_HEARTBEAT_MAX_MS)
    const atCap = refresh.mock.calls.length
    expect(atCap).toBeGreaterThanOrEqual(PRE_TASK_HEARTBEAT_MAX_MS / PRE_TASK_HEARTBEAT_MS - 1)
    await vi.advanceTimersByTimeAsync(THRESHOLD + PRE_TASK_HEARTBEAT_MS)
    expect(refresh.mock.calls.length).toBe(atCap)
    await vi.advanceTimersByTimeAsync(60 * MIN)
    await run
  })

  it("no gap between beats across a 35-minute run comes anywhere near the sweep threshold", async () => {
    const startedAt = Date.now()
    const stamps: number[] = []
    refresh.mockImplementation(async () => { stamps.push(Date.now()) })

    const run = withPreTaskHeartbeat(async () => { await sleep(35 * MIN) })({}, { jobId: "job-1" })
    await vi.advanceTimersByTimeAsync(35 * MIN)
    await run

    // The pickup stamp is the first "beat"; every later one must follow within an interval.
    const gaps = [startedAt, ...stamps].slice(1).map((at, i) => at - [startedAt, ...stamps][i]!)
    expect(Math.max(...gaps)).toBeLessThanOrEqual(PRE_TASK_HEARTBEAT_MS)
    expect(Date.now() - stamps.at(-1)!).toBeLessThan(THRESHOLD)
  })

  it("stops on a drain hand-off and lets the DrainAbortError leave untouched (the worker requeues on it)", async () => {
    const drain = new DrainAbortError()
    const run = withPreTaskHeartbeat(async () => {
      await sleep(5 * MIN)
      throw drain
    })({}, { jobId: "job-1" }).catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(5 * MIN)
    expect(await run).toBe(drain)

    const beats = refresh.mock.calls.length
    await vi.advanceTimersByTimeAsync(10 * MIN)
    expect(refresh.mock.calls.length).toBe(beats)
  })

  it("a refresh that fails never reaches the handler it is keeping alive", async () => {
    refresh.mockRejectedValue(new Error("database unavailable"))
    const run = withPreTaskHeartbeat(async () => { await sleep(3 * MIN) })({}, { jobId: "job-1" })
    await vi.advanceTimersByTimeAsync(3 * MIN)
    await expect(run).resolves.toBeUndefined()
    expect(refresh).toHaveBeenCalled()
  })

  it("stops beating at PRE_TASK_HEARTBEAT_MAX_MS, so a handler that never settles still ages into the sweep", async () => {
    void withPreTaskHeartbeat(() => new Promise<void>(() => {}))({}, { jobId: "hung" })

    await vi.advanceTimersByTimeAsync(PRE_TASK_HEARTBEAT_MAX_MS)
    const beats = refresh.mock.calls.length
    expect(beats).toBeGreaterThanOrEqual(PRE_TASK_HEARTBEAT_MAX_MS / PRE_TASK_HEARTBEAT_MS - 1)

    await vi.advanceTimersByTimeAsync(THRESHOLD + 10 * MIN)
    expect(refresh.mock.calls.length).toBe(beats)
  })

  it("concurrent jobs keep their own beats", async () => {
    const wrap = withPreTaskHeartbeat(async (_job: unknown, ctx: { jobId: string }) => {
      await sleep(ctx.jobId === "short" ? 2 * MIN : 6 * MIN)
    })
    const short = wrap({}, { jobId: "short" })
    const long = wrap({}, { jobId: "long" })
    await vi.advanceTimersByTimeAsync(6 * MIN)
    await Promise.all([short, long])

    const byJob = (id: string) => refresh.mock.calls.filter(([jobId]) => jobId === id).length
    expect(byJob("short")).toBeLessThanOrEqual(2)
    expect(byJob("long")).toBeGreaterThanOrEqual(5)
  })
})

describe("liveness budget", () => {
  it("pre-task is a sync kind: its sweep fails + refunds, so a live run's only protection is a fresh stamp", () => {
    expect(isSyncKind("pre-task")).toBe(true)
  })

  it("one missed beat still leaves the row well inside the threshold", () => {
    expect(2 * PRE_TASK_HEARTBEAT_MS).toBeLessThan(THRESHOLD)
  })

  // The DEFAULT cap is the orchestrator's own per-node ceiling — a DAG node
  // must not lose its beats before the orchestrator gives up on it. Today's
  // handlers that declare no budget fit inside it by an empirical margin, not a
  // derived bound. A handler that runs longer declares its own budget
  // (`maxMs`) — the cap never stretches for it.
  it("the default cap outlasts the threshold (or it would re-open the gap) and is the orchestrator's own per-node ceiling", () => {
    expect(PRE_TASK_HEARTBEAT_MAX_MS).toBeGreaterThan(THRESHOLD)
    expect(PRE_TASK_HEARTBEAT_MAX_MS).toBe(NODE_TIMEOUT_MS)
  })
})


// Track 0.13 (decided 2026-10-04): a job stalled on the ffmpeg slot queue is not
// hung — the cap's clock pauses while it waits, and each beat reports the wait.
describe("withPreTaskHeartbeat — waiting for an ffmpeg slot", () => {
  it("keeps beating through a long slot wait: the cap counts only the run's own time", async () => {
    const run = withPreTaskHeartbeat(async () => {
      const ledger = currentSlotWaitLedger()!
      ledger.queued() // four long renders hold every slot
      await sleep(100 * MIN)
      ledger.granted(true)
      await sleep(60 * MIN) // its own run: 60 min, inside the 90-min default cap
      ledger.released()
    })({}, { jobId: "job-1" })

    await vi.advanceTimersByTimeAsync(159 * MIN)
    // Still beating at minute 159 — past the default cap in wall time.
    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(158)
    // ... and reported the 100 minutes it waited — written only while it grew.
    expect(recordWait.mock.calls.at(-1)).toEqual(["job-1", 100 * MIN])
    expect(recordWait.mock.calls.length).toBeLessThanOrEqual(100)
    await vi.advanceTimersByTimeAsync(2 * MIN)
    await run
  })

  it("a run that is not waiting still stops beating at the cap (a hang is still caught)", async () => {
    const run = withPreTaskHeartbeat(async () => {
      const ledger = currentSlotWaitLedger()!
      ledger.queued()
      await sleep(20 * MIN)
      ledger.granted(true) // got its slot after 20 min, then hangs
      await sleep(PRE_TASK_HEARTBEAT_MAX_MS + 60 * MIN)
    })({}, { jobId: "job-1" })

    // Beats until 90 min of its OWN time: 20 min waiting + 90 running = 110 min.
    await vi.advanceTimersByTimeAsync(PRE_TASK_HEARTBEAT_MAX_MS + 20 * MIN + PRE_TASK_HEARTBEAT_MS)
    const atCap = refresh.mock.calls.length
    await vi.advanceTimersByTimeAsync(30 * MIN)
    expect(refresh.mock.calls.length).toBe(atCap)
    expect(atCap).toBeLessThanOrEqual((PRE_TASK_HEARTBEAT_MAX_MS + 20 * MIN) / PRE_TASK_HEARTBEAT_MS)
    await vi.advanceTimersByTimeAsync(60 * MIN)
    await run
  })
})

describe("withPreTaskHeartbeat — a re-picked job keeps its earlier wait", () => {
  it("adds this attempt's wait to the earlier attempts' (slotWaitBaseMs), so the credit never drops", async () => {
    const run = withPreTaskHeartbeat(async () => {
      const ledger = currentSlotWaitLedger()!
      ledger.queued()
      await sleep(5 * MIN)
      ledger.granted(true)
      ledger.released()
    }, { slotWaitBaseMs: 100 * MIN })({}, { jobId: "job-1" })
    await vi.advanceTimersByTimeAsync(5 * MIN)
    await run
    expect(recordWait.mock.calls.at(-1)?.[1]).toBeGreaterThan(100 * MIN)
    expect(recordWait.mock.calls.every(([, total]) => total >= 100 * MIN)).toBe(true)
  })
})

describe("withPreTaskHeartbeat — the worker's inline safety retry re-runs the same handler", () => {
  it("the second run's total keeps the first run's wait", async () => {
    const wrapped = withPreTaskHeartbeat(async () => {
      const ledger = currentSlotWaitLedger()!
      ledger.queued()
      await sleep(3 * MIN)
      ledger.granted(true)
      ledger.released()
    })
    const first = wrapped({}, { jobId: "job-1" })
    await vi.advanceTimersByTimeAsync(3 * MIN)
    await first
    const second = wrapped({}, { jobId: "job-1" })
    await vi.advanceTimersByTimeAsync(3 * MIN)
    await second
    // The second run reports 3 min of its own on top of the first run's 3.
    expect(Math.max(...recordWait.mock.calls.map(([, total]) => total))).toBeGreaterThan(3 * MIN)
  })
})
