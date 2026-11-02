// queueInfoFor: which rows count as waiting, no gate call without one, and a
// gate that never answers costs a status read at most QUEUE_READ_TIMEOUT_MS.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const refs = vi.hoisted(() => ({ gate: null as unknown, made: 0, tier: async (): Promise<string | null> => "free" }))
vi.mock("@/lib/concurrency-lanes/instance.js", () => ({
  concurrencyGate: () => {
    refs.made++
    return refs.gate
  },
}))
vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config.js")>()),
  hasCredits: () => true,
}))
vi.mock("@/lib/concurrency-lanes/sizes.js", () => ({ payerTier: () => refs.tier() }))

import { isWaitingRow, QUEUE_READ_TIMEOUT_MS, queueInfoFor, resetQueueInfoWarningForTests, waitingRowsOf } from "../queue-info.js"
import type { WaitInfo } from "../types.js"

const T0 = Date.UTC(2026, 9, 30, 12, 0, 0)
const wait = (over: Partial<WaitInfo> = {}): WaitInfo =>
  ({ lane: "provider", position: 1, limit: 2, running: 2, reason: "user_lane", waitedMs: 4_000, enqueuedAtMs: T0, ...over })
/** A gate that answers `waits` for the ids it is asked. */
const gateAnswering = (waits: Record<string, { wait: WaitInfo; payer: string | null }>) => ({
  describeWaits: async (ids: readonly string[]) => new Map(ids.filter((id) => waits[id]).map((id) => [id, waits[id]!])),
})

beforeEach(() => {
  refs.made = 0
  refs.tier = async () => "free"
  resetQueueInfoWarningForTests()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("isWaitingRow", () => {
  const STAMP = "2026-10-30T12:00:00Z"
  it("a job waits when queued with the lane stamp, never otherwise", () => {
    expect(isWaitingRow("job", { status: "queued", lane_queued_at: STAMP })).toBe(true)
    // A `queued` row the park did not write, or one read without the stamp, costs no gate read.
    expect(isWaitingRow("job", { status: "queued" })).toBe(false)
    expect(isWaitingRow("job", { status: "queued", lane_queued_at: null })).toBe(false)
    expect(isWaitingRow("job", { status: "queued", lane_queued_at: "" })).toBe(false)
    for (const status of ["pending", "processing", "pending_review", "completed"]) expect(isWaitingRow("job", { status, lane_queued_at: STAMP })).toBe(false)
  })
  it("an execution waits when pending with the lane stamp, never otherwise", () => {
    expect(isWaitingRow("execution", { status: "pending", lane_queued_at: STAMP })).toBe(true)
    expect(isWaitingRow("execution", { status: "pending" })).toBe(false)
    expect(isWaitingRow("execution", { status: "pending", lane_queued_at: null })).toBe(false)
    expect(isWaitingRow("execution", { status: "running", lane_queued_at: STAMP })).toBe(false)
  })
  it("a pipeline waits when queued with the lane stamp (queued alone: not driven yet)", () => {
    expect(isWaitingRow("pipeline", { status: "queued", lane_queued_at: STAMP })).toBe(true)
    expect(isWaitingRow("pipeline", { status: "queued" })).toBe(false)
    expect(isWaitingRow("pipeline", { status: "running", lane_queued_at: STAMP })).toBe(false)
  })
})

describe("waitingRowsOf", () => {
  it("keeps the waiting rows with their stamp, in order", () => {
    const rows = [
      { id: "a", status: "pending", lane_queued_at: "2026-10-30T12:00:00Z" },
      { id: "b", status: "pending" },
      { id: "c", status: "running", lane_queued_at: "2026-10-30T12:00:00Z" },
      { id: "d", status: "pending", lane_queued_at: "2026-10-30T11:00:00Z" },
    ]
    expect(waitingRowsOf("execution", rows)).toEqual([
      { id: "a", queuedAt: "2026-10-30T12:00:00Z" },
      { id: "d", queuedAt: "2026-10-30T11:00:00Z" },
    ])
    expect(waitingRowsOf("job", [{ id: "j", status: "queued", lane_queued_at: "2026-10-30T12:00:00Z" }, { id: "k", status: "queued" }])).toEqual([{ id: "j", queuedAt: "2026-10-30T12:00:00Z" }])
  })
})

describe("queueInfoFor", () => {
  it("no rows: no gate at all", async () => {
    expect((await queueInfoFor([])).size).toBe(0)
    expect(refs.made).toBe(0)
  })

  it("a gate that never answers: an empty answer once the read's timeout passes", async () => {
    vi.useFakeTimers()
    refs.gate = { describeWaits: () => new Promise(() => undefined) }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const settled = vi.fn()
    const p = queueInfoFor([{ id: "j1", queuedAt: null }])
    p.then(settled)
    await vi.advanceTimersByTimeAsync(QUEUE_READ_TIMEOUT_MS - 1)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect((await p).size).toBe(0)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("waitedSeconds counts from the row's own lane stamp when it has one, else the gate's", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(T0 + 125_400)
    refs.gate = gateAnswering({ a: { wait: wait(), payer: "workspace:W" }, b: { wait: wait(), payer: "workspace:W" } })
    const q = await queueInfoFor([{ id: "a", queuedAt: new Date(T0).toISOString() }, { id: "b", queuedAt: null }])
    expect(q.get("a")?.waitedSeconds).toBe(125)
    expect(q.get("b")?.waitedSeconds).toBe(4)
  })

  it("an upgrade hint only for the payer's own full line, never for a provider or server wait", async () => {
    refs.gate = gateAnswering({
      own: { wait: wait(), payer: "user:U" },
      provider: { wait: wait({ reason: "provider_ceiling" }), payer: "user:U" },
      server: { wait: wait({ reason: "server_busy", limit: 0, running: 0 }), payer: null },
      ws: { wait: wait({ reason: "provider_ceiling" }), payer: "workspace:W" },
    })
    const q = await queueInfoFor(["own", "provider", "server", "ws"].map((id) => ({ id, queuedAt: null })))
    expect([...q].map(([id, v]) => [id, v.upgradeHint])).toEqual([["own", "plan"], ["provider", null], ["server", null], ["ws", null]])
  })

  it("a payer tier that does not come in time: the queue stands, with no upgrade hint", async () => {
    vi.useFakeTimers()
    refs.gate = gateAnswering({ a: { wait: wait({ position: 3 }), payer: "user:U" } })
    refs.tier = () => new Promise(() => undefined)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const p = queueInfoFor([{ id: "a", queuedAt: null }])
    await vi.advanceTimersByTimeAsync(QUEUE_READ_TIMEOUT_MS)
    expect((await p).get("a")).toMatchObject({ position: 3, upgradeHint: null })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("one deadline for the whole read: a slow gate leaves the tier read only what is left", async () => {
    vi.useFakeTimers()
    const answer = new Map([["a", { wait: wait(), payer: "user:U" }]])
    refs.gate = { describeWaits: () => new Promise((resolve) => setTimeout(() => resolve(answer), 600)) }
    refs.tier = () => new Promise(() => undefined)
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const settled = vi.fn()
    const p = queueInfoFor([{ id: "a", queuedAt: null }])
    p.then(settled)
    await vi.advanceTimersByTimeAsync(QUEUE_READ_TIMEOUT_MS - 1)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect((await p).get("a")).toMatchObject({ position: 1, upgradeHint: null })
    expect(vi.getTimerCount()).toBe(0)
  })
})
