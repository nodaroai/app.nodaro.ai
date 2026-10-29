/**
 * The admin's model switch (model_pricing.is_enabled) as the fourth layer of
 * the availability funnel — the in-process cache behind `isModelSwitchedOff`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const dbState = vi.hoisted(() => ({
  rows: [] as Array<{ model_identifier: string }>,
  error: null as null | { message: string },
  /** When set, the read THROWS it (a client that failed to build, a network error). */
  throws: null as null | Error,
  reads: 0,
  /** When set, a read waits on it before answering — to hold a refresh in flight. */
  gate: null as Promise<void> | null,
}))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: async (column: string, value: unknown) => {
          dbState.reads += 1
          if (dbState.throws) throw dbState.throws
          if (dbState.gate) await dbState.gate
          expect(table).toBe("model_pricing")
          expect(column).toBe("is_enabled")
          expect(value).toBe(false)
          return dbState.error ? { data: null, error: dbState.error } : { data: dbState.rows, error: null }
        },
      }),
    }),
  },
}))

import {
  isModelSwitchedOff,
  loadSwitchedOffModels,
  noteModelSwitch,
  switchedOffModelIds,
  __awaitModelSwitchRefreshForTests,
  __resetModelSwitchForTests,
} from "../model-switch.js"

beforeEach(() => {
  dbState.rows = []
  dbState.error = null
  dbState.throws = null
  dbState.reads = 0
  dbState.gate = null
  __resetModelSwitchForTests()
})
afterEach(() => {
  vi.useRealTimers()
  __resetModelSwitchForTests()
})

describe("model-switch", () => {
  it("never loaded: nothing is switched off, and under Vitest no read is kicked", () => {
    expect(isModelSwitchedOff("flux-flex")).toBe(false)
    expect(switchedOffModelIds()).toEqual([])
    expect(dbState.reads).toBe(0)
  })

  it("the load reads the rows whose switch is off, exactly by identifier", async () => {
    dbState.rows = [{ model_identifier: "flux-flex" }, { model_identifier: "flux-flex:2K" }]
    await loadSwitchedOffModels()
    await __awaitModelSwitchRefreshForTests()
    expect(isModelSwitchedOff("flux-flex")).toBe(true)
    expect(isModelSwitchedOff("flux-flex:2K")).toBe(true)
    // Exact: the base id answers for itself only.
    expect(isModelSwitchedOff("flux")).toBe(false)
    expect(switchedOffModelIds().sort()).toEqual(["flux-flex", "flux-flex:2K"])
  })

  it("a failed read keeps the last known switches", async () => {
    dbState.rows = [{ model_identifier: "flux-flex" }]
    await loadSwitchedOffModels()
    await __awaitModelSwitchRefreshForTests()
    dbState.error = { message: "db down" }
    const warn = vi.spyOn(console, "error").mockImplementation(() => {})
    await loadSwitchedOffModels()
    await __awaitModelSwitchRefreshForTests()
    warn.mockRestore()
    expect(isModelSwitchedOff("flux-flex")).toBe(true)
  })

  it("a read that THROWS keeps the last known switches too — a kicked load is never an unhandled rejection", async () => {
    dbState.rows = [{ model_identifier: "flux-flex" }]
    await loadSwitchedOffModels()
    await __awaitModelSwitchRefreshForTests()
    dbState.throws = new Error("fetch failed")
    const warn = vi.spyOn(console, "error").mockImplementation(() => {})
    await loadSwitchedOffModels()
    await expect(__awaitModelSwitchRefreshForTests()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![1])).toContain("fetch failed")
    warn.mockRestore()
    expect(isModelSwitchedOff("flux-flex")).toBe(true)
  })

  it("an in-process writer updates the answer at once, both ways", () => {
    __resetModelSwitchForTests([])
    noteModelSwitch("flux-flex", false)
    expect(isModelSwitchedOff("flux-flex")).toBe(true)
    noteModelSwitch("flux-flex", true)
    expect(isModelSwitchedOff("flux-flex")).toBe(false)
    noteModelSwitch("", false)
    expect(switchedOffModelIds()).toEqual([])
  })

  it("a switch flipped while a refresh is reading is not undone by that refresh's older rows", async () => {
    __resetModelSwitchForTests([])
    // The read is in flight — it still sees the row ON — when the admin switches it off.
    let release: () => void = () => {}
    dbState.gate = new Promise<void>((r) => { release = r })
    dbState.rows = []
    await loadSwitchedOffModels()
    noteModelSwitch("flux-flex", false)
    expect(isModelSwitchedOff("flux-flex")).toBe(true)
    release()
    dbState.gate = null
    await __awaitModelSwitchRefreshForTests()
    // The older rows did not land over the flip; the next TTL read will see the row.
    expect(isModelSwitchedOff("flux-flex")).toBe(true)
  })

  it("a stale cache kicks ONE background refresh per TTL and answers the old set meanwhile", async () => {
    vi.useFakeTimers()
    __resetModelSwitchForTests(["flux-flex"])
    dbState.rows = []
    vi.setSystemTime(Date.now() + 61_000)
    expect(isModelSwitchedOff("flux-flex")).toBe(true)
    expect(isModelSwitchedOff("flux-flex")).toBe(true)
    await __awaitModelSwitchRefreshForTests()
    expect(dbState.reads).toBe(1)
    expect(isModelSwitchedOff("flux-flex")).toBe(false)
  })
})
