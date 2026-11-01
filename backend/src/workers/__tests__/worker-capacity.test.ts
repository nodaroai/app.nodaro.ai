// The video worker's per-process capacity groups (workers/worker-capacity.ts):
// the background scrapes run at most VIDEO_WORKER_SCRAPE_CONCURRENCY at once
// per process; one over the cap waits on the queue holding no worker slot and
// is promoted, oldest first, when one ends.
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DelayedError } from "bullmq"

vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/config.js")>()
  return { ...actual, config: { ...actual.config, VIDEO_WORKER_SCRAPE_CONCURRENCY: 2 } }
})

const { enterCapacity, leaveCapacity, deferForCapacity, capacitySnapshot, resetCapacityForTests, CAPACITY_RECHECK_MS } = await import("../worker-capacity.js")

const bullJob = (id: string) => ({ id, moveToDelayed: vi.fn(async () => undefined), promote: vi.fn(async () => undefined) })

beforeEach(() => resetCapacityForTests())

describe("worker capacity", () => {
  it("takes places up to the cap, then refuses", () => {
    expect(enterCapacity("scrape", "a")).toBe(true)
    expect(enterCapacity("scrape", "b")).toBe(true)
    expect(enterCapacity("scrape", "c")).toBe(false)
    expect(capacitySnapshot("scrape")).toMatchObject({ running: 2, cap: 2 })
  })

  it("a deferred job goes back to the delayed set (no attempt spent) and the processor ends with DelayedError", async () => {
    const job = bullJob("c")
    const before = Date.now()
    await expect(deferForCapacity("scrape", job as never, "tok")).rejects.toBeInstanceOf(DelayedError)
    const [ts, token] = job.moveToDelayed.mock.calls[0] as unknown as [number, string]
    expect(token).toBe("tok")
    expect(ts).toBeGreaterThanOrEqual(before + CAPACITY_RECHECK_MS)
  })

  it("a place that frees promotes this process's oldest waiter, which keeps its place when deferred again", async () => {
    enterCapacity("scrape", "a")
    enterCapacity("scrape", "b")
    const [c, d] = [bullJob("c"), bullJob("d")]
    await deferForCapacity("scrape", c as never, undefined).catch(() => undefined)
    await deferForCapacity("scrape", d as never, undefined).catch(() => undefined)
    // c is looked at again before anyone frees a place: still capped, it keeps its place ahead of d.
    await deferForCapacity("scrape", c as never, undefined).catch(() => undefined)
    expect(capacitySnapshot("scrape").waiting).toBe(2)
    await leaveCapacity("scrape")
    expect(c.promote).toHaveBeenCalledTimes(1)
    expect(d.promote).not.toHaveBeenCalled()
    // c runs: it is no longer waiting; the next place goes to d.
    expect(enterCapacity("scrape", "c")).toBe(true)
    await leaveCapacity("scrape")
    expect(d.promote).toHaveBeenCalledTimes(1)
  })

  it("a waiter that can no longer be promoted (another process ran it) is skipped for the next", async () => {
    enterCapacity("scrape", "a")
    enterCapacity("scrape", "b")
    const [c, d] = [bullJob("c"), bullJob("d")]
    c.promote.mockRejectedValueOnce(new Error("Job c is not in the delayed state"))
    await deferForCapacity("scrape", c as never, undefined).catch(() => undefined)
    await deferForCapacity("scrape", d as never, undefined).catch(() => undefined)
    await leaveCapacity("scrape")
    expect(d.promote).toHaveBeenCalledTimes(1)
  })
})
