import { describe, it, expect, vi, beforeEach } from "vitest"

// `jobs.slot_wait_ms` (migration 451) until it reaches the shared database:
// staging runs dev against it, and migrations apply only at dev→main.

const db = vi.hoisted(() => ({ writes: 0, error: null as { code?: string; message: string } | null }))
vi.mock("../supabase.js", () => {
  const chain: Record<string, unknown> = {}
  chain.update = () => { db.writes++; return chain }
  chain.eq = () => chain
  chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve({ data: null, error: db.error }).then(res, rej)
  return { supabase: { from: () => chain } }
})

import {
  noteSlotWaitColumnError, resetSlotWaitColumnForTests, slotWaitColumnAbsent, withSlotWaitColumn,
} from "../jobs-slot-wait-column.js"
import { recordJobSlotWait } from "../reconcile/persistence.js"

beforeEach(() => {
  resetSlotWaitColumnForTests()
  db.writes = 0
  db.error = null
})

describe("the slot_wait_ms column guard", () => {
  it("names the column until a missing-column error, then never again", () => {
    expect(withSlotWaitColumn("id")).toBe("id, slot_wait_ms")
    expect(noteSlotWaitColumnError({ code: "42703" })).toBe(true)
    expect(slotWaitColumnAbsent()).toBe(true)
    expect(withSlotWaitColumn("id")).toBe("id")
  })

  it("PostgREST's unknown-column code counts too; any other error does not", () => {
    expect(noteSlotWaitColumnError({ code: "PGRST204" })).toBe(true)
    resetSlotWaitColumnForTests()
    for (const other of [{ code: "23505" }, { code: null }, {}, null, undefined]) {
      expect(noteSlotWaitColumnError(other)).toBe(false)
    }
    expect(slotWaitColumnAbsent()).toBe(false)
  })
})

describe("recordJobSlotWait before the column exists", () => {
  it("a missing-column error is remembered quietly, and later beats write nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    db.error = { code: "PGRST204", message: "Could not find the 'slot_wait_ms' column of 'jobs'" }
    await recordJobSlotWait("job-1", 60_000)
    await recordJobSlotWait("job-1", 120_000)
    expect(db.writes).toBe(1)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("any other error is logged, and the next beat tries again", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    db.error = { message: "transient" }
    await recordJobSlotWait("job-1", 60_000)
    await recordJobSlotWait("job-1", 120_000)
    expect(db.writes).toBe(2)
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})
