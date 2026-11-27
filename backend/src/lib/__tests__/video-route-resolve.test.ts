// @test-units-by-name it names no node unit
/**
 * Reading a routed job's unfinished business back from the route
 * (lib/video-route-resolve.ts): a send that started and has no task row, a
 * delivered task with no bill, and a start given up on as `unresolved` are each
 * read once. A start read to its end is recorded (its bill, or how it failed);
 * a delivered send changes only by gaining a verified bill, and never becomes
 * failed or expired; a given-up start that turns out billed is delivered again.
 * Anything else is left to be read again. What can never be read is closed as
 * `unresolved`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  ledger: { tasks: [], segments: [], unresolvedStarts: [] } as Record<string, unknown>,
  poll: vi.fn(),
  service: true,
  tasks: [] as unknown[][],
  outcomes: [] as unknown[][],
  revived: [] as unknown[][],
}))
vi.mock("../private-plugins/services-registry.js", () => ({ getPluginServices: () => (h.service ? { alternateRoutes: { poll: h.poll } } : {}) }))
vi.mock("../video-route-ledger.js", async (orig) => ({
  ...(await orig<typeof import("../video-route-ledger.js")>()),
  readRouteLedger: async () => h.ledger,
  recordRouteTask: async (...a: unknown[]) => (h.tasks.push(a), true),
  recordRouteTaskOutcome: async (...a: unknown[]) => (h.outcomes.push(a), true),
  reviveUnresolvedTask: async (...a: unknown[]) => (h.revived.push(a), true),
}))

const { resolveRouteLedger, closeUnresolvedStarts } = await import("../video-route-resolve.js")

beforeEach(() => {
  h.poll.mockReset()
  h.service = true
  h.tasks = []
  h.outcomes = []
  h.revived = []
  h.ledger = { tasks: [], segments: [], unresolvedStarts: [] }
})

describe("resolveRouteLedger", () => {
  it("reads a started send with no task row: done records its bill and basis, failed and expired record how it ended, running is left", async () => {
    h.ledger = { tasks: [], segments: [], unresolvedStarts: [{ send: 1, key: "", ref: "a" }, { send: 2, key: "", ref: "b" }, { send: 1, key: "seg-3", ref: "c" }, { send: 3, key: "", ref: "d" }, { send: 4, key: "", ref: null }] }
    h.poll
      .mockResolvedValueOnce({ state: "done", resultUrl: "https://r/a.mp4", providerCostUsd: 0.5, costBasis: "billed-seconds", billedSec: 8, estimatedCostUsd: 0.4 })
      .mockResolvedValueOnce({ state: "failed", message: "x" })
      .mockResolvedValueOnce({ state: "expired", message: "x" })
      .mockResolvedValueOnce({ state: "running" })
    expect(await resolveRouteLedger("job", "route-1")).toEqual({ readable: true, resolved: 3, billed: 1 })
    // A start with no reference cannot be read: never polled.
    expect(h.poll.mock.calls).toEqual([["route-1", "a"], ["route-1", "b"], ["route-1", "c"], ["route-1", "d"]])
    expect(h.tasks).toEqual([["job", 1, "a", 0.5, "", 0.4, "billed-seconds"]])
    expect(h.outcomes).toEqual([["job", 2, "", "b", "failed"], ["job", 1, "seg-3", "c", "expired"]])
  })

  it("a started send read done with no bill is recorded delivered, bill pending: resolved, but no bill arrived", async () => {
    h.ledger = { tasks: [], segments: [], unresolvedStarts: [{ send: 1, key: "", ref: "a" }] }
    h.poll.mockResolvedValueOnce({ state: "done", resultUrl: "https://r/a.mp4", estimatedCostUsd: 0.4 })
    expect(await resolveRouteLedger("job", "route-1")).toEqual({ readable: true, resolved: 1, billed: 0 })
    expect(h.tasks).toEqual([["job", 1, "a", null, "", 0.4, undefined]])
  })

  const unbilled = () => ({
    tasks: [{ send: 1, ref: "t1", billedUsd: null }, { send: 2, ref: "t2", billedUsd: 0.3 }, { send: 3, ref: "t3", billedUsd: null, outcome: "failed" }, { send: 4, ref: null, billedUsd: null }],
    segments: [{ key: "seg-1", ref: "s1", billedUsd: null, outcome: "done" }, { key: "seg-2", ref: "s2", billedUsd: 0.2 }, { key: "seg-3", ref: "s3", billedUsd: null, outcome: "expired" }],
    unresolvedStarts: [],
  })

  it("reads a delivered task or segment that has no bill yet, and leaves billed, failed and unreferenced ones alone", async () => {
    h.ledger = unbilled()
    h.poll.mockResolvedValue({ state: "running" })
    expect(await resolveRouteLedger("job", "route-1")).toEqual({ readable: true, resolved: 0, billed: 0 })
    expect(h.poll.mock.calls).toEqual([["route-1", "t1"], ["route-1", "s1"]])
  })

  it("a delivered send read done with no bill changes nothing and counts nothing: no bill arrived", async () => {
    h.ledger = unbilled()
    // Done, with an estimate, a bill of zero, or nothing at all: none of them is a verified bill.
    h.poll
      .mockResolvedValueOnce({ state: "done", resultUrl: "https://r/x.mp4", estimatedCostUsd: 0.4 })
      .mockResolvedValueOnce({ state: "done", resultUrl: "https://r/x.mp4", providerCostUsd: 0 })
    expect(await resolveRouteLedger("job", "route-1")).toEqual({ readable: true, resolved: 0, billed: 0 })
    expect(h.poll).toHaveBeenCalledTimes(2)
    expect(h.tasks).toEqual([])
    expect(h.outcomes).toEqual([])
    expect(h.revived).toEqual([])
  })

  it("a delivered send read done with a verified bill gains it: recorded, and counted as a bill that arrived", async () => {
    h.ledger = unbilled()
    h.poll
      .mockResolvedValueOnce({ state: "done", resultUrl: "https://r/x.mp4", providerCostUsd: 0.5, costBasis: "receipt", estimatedCostUsd: 0.4 })
      .mockResolvedValueOnce({ state: "done", resultUrl: "https://r/x.mp4", providerCostUsd: 0.6, costBasis: "billed-seconds", billedSec: 8 })
    expect(await resolveRouteLedger("job", "route-1")).toEqual({ readable: true, resolved: 2, billed: 2 })
    expect(h.tasks).toEqual([["job", 1, "t1", 0.5, "", 0.4, "receipt"], ["job", 1, "s1", 0.6, "seg-1", null, "billed-seconds"]])
    // It was delivered all along: nothing to revive.
    expect(h.revived).toEqual([])
  })

  it.each(["failed", "expired"])("a delivered, unbilled send the route later answers %s for stays delivered: no outcome is written", async (state) => {
    h.ledger = unbilled()
    h.poll.mockResolvedValue({ state, message: "no longer kept" })
    expect(await resolveRouteLedger("job", "route-1")).toEqual({ readable: true, resolved: 0, billed: 0 })
    expect(h.poll.mock.calls).toEqual([["route-1", "t1"], ["route-1", "s1"]])
    expect(h.outcomes).toEqual([])
    expect(h.tasks).toEqual([])
  })

  describe("a start given up on as unresolved", () => {
    const givenUp = () => ({
      tasks: [{ send: 2, ref: "g1", billedUsd: null, outcome: "unresolved" }, { send: 3, ref: null, billedUsd: null, outcome: "unresolved" }],
      segments: [{ key: "seg-4", ref: "g2", billedUsd: null, outcome: "unresolved" }],
      unresolvedStarts: [],
    })

    it("is read again, and one that turns out done with a verified bill is recorded and counts as delivered again", async () => {
      h.ledger = givenUp()
      h.poll
        .mockResolvedValueOnce({ state: "done", resultUrl: "https://r/x.mp4", providerCostUsd: 0.7, costBasis: "receipt" })
        .mockResolvedValueOnce({ state: "done", resultUrl: "https://r/x.mp4", providerCostUsd: 0.2 })
      expect(await resolveRouteLedger("job", "route-1")).toEqual({ readable: true, resolved: 2, billed: 2 })
      // One with no reference cannot be read.
      expect(h.poll.mock.calls).toEqual([["route-1", "g1"], ["route-1", "g2"]])
      expect(h.tasks).toEqual([["job", 2, "g1", 0.7, "", null, "receipt"], ["job", 1, "g2", 0.2, "seg-4", null, "receipt"]])
      expect(h.revived).toEqual([["job", 2, ""], ["job", 1, "seg-4"]])
    })

    it("done with no bill, or still running, leaves it given up", async () => {
      h.ledger = givenUp()
      h.poll.mockResolvedValueOnce({ state: "done", resultUrl: "https://r/x.mp4" }).mockResolvedValueOnce({ state: "running" })
      expect(await resolveRouteLedger("job", "route-1")).toEqual({ readable: true, resolved: 0, billed: 0 })
      expect(h.tasks).toEqual([])
      expect(h.revived).toEqual([])
      expect(h.outcomes).toEqual([])
    })

    it("failed or expired is recorded as how it ended (it never delivered)", async () => {
      h.ledger = givenUp()
      h.poll.mockResolvedValueOnce({ state: "failed", message: "x" }).mockResolvedValueOnce({ state: "expired", message: "x" })
      expect(await resolveRouteLedger("job", "route-1")).toEqual({ readable: true, resolved: 2, billed: 0 })
      expect(h.outcomes).toEqual([["job", 2, "", "g1", "failed"], ["job", 1, "seg-4", "g2", "expired"]])
      expect(h.revived).toEqual([])
    })
  })

  it("never throws: a read that fails leaves the item, and a process with no route service reads nothing", async () => {
    h.ledger = { tasks: [], segments: [], unresolvedStarts: [{ send: 1, key: "", ref: "a" }] }
    h.poll.mockRejectedValueOnce(new Error("timeout"))
    expect(await resolveRouteLedger("job", "route-1")).toEqual({ readable: true, resolved: 0, billed: 0 })
    h.service = false
    expect(await resolveRouteLedger("job", "route-1")).toEqual({ readable: false, resolved: 0, billed: 0 })
    expect(h.tasks).toEqual([])
    expect(h.outcomes).toEqual([])
  })
})

describe("closeUnresolvedStarts", () => {
  it("records every start still unread as unresolved, and says which", async () => {
    const open = [{ send: 2, key: "", ref: "b" }, { send: 1, key: "seg-3", ref: null }]
    h.ledger = { tasks: [], segments: [], unresolvedStarts: open }
    expect(await closeUnresolvedStarts("job")).toEqual(open)
    expect(h.outcomes).toEqual([["job", 2, "", "b", "unresolved"], ["job", 1, "seg-3", null, "unresolved"]])
  })
})
