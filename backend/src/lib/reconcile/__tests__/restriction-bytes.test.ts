/**
 * The restriction bytes' sweep (lib/reconcile/restriction-bytes.ts): every
 * record whose bytes are not where its side says is finished again, the
 * settled ones are left alone, each side is read by its own date, the sweep
 * runs at most once an hour, a failure is counted and never thrown, and a
 * database before 583 is nothing to do.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const db = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  error: null as null | { code?: string; message: string },
  finished: [] as string[],
  orders: [] as string[],
  settleOnFinish: true,
}))

vi.mock("../../supabase.js", () => {
  const chain = (lifted: "null" | "set" | null) => ({
    is: () => chain("null"),
    not: () => chain("set"),
    order: (column: string) => {
      db.orders.push(column)
      return chain(lifted)
    },
    limit: async () => ({
      data: db.error ? null : db.rows.filter((r) => (lifted === "null" ? r.lifted_at === null : lifted === "set" ? r.lifted_at !== null : true)),
      error: db.error,
    }),
  })
  return { supabase: { from: () => ({ select: () => chain(null) }) } }
})
vi.mock("../../content-restrictions.js", () => ({
  finishRestrictionBytes: vi.fn(async (id: string) => {
    db.finished.push(id)
    if (id === "r-throws") throw new Error("boom")
    const row = db.rows.find((r) => r.id === id)!
    const keys = Object.fromEntries((row.r2_keys as string[]).map((k) => [k, { state: row.lifted_at ? "restored" : "moved", at: "x" }]))
    const phase = { keys, purge: { status: db.settleOnFinish ? "done" : "failed", at: "x" } }
    return { id, r2Keys: row.r2_keys, liftedAt: row.lifted_at, bytes: row.lifted_at ? { lift: phase } : { restrict: phase } }
  }),
}))

import { SWEEP_EVERY_MS, _resetRestrictionBytesSweepForTests, sweepRestrictionBytes } from "../restriction-bytes.js"

const settledRestrict = { restrict: { keys: { "k/1": { state: "moved", at: "x" } }, purge: { status: "done", at: "x" } } }

beforeEach(() => {
  db.rows.length = 0
  db.error = null
  db.finished.length = 0
  db.orders.length = 0
  db.settleOnFinish = true
  _resetRestrictionBytesSweepForTests()
  vi.spyOn(console, "error").mockImplementation(() => undefined)
})

describe("sweepRestrictionBytes", () => {
  it("finishes the records whose bytes are not settled for their side, and leaves the settled ones alone", async () => {
    db.rows.push(
      { id: "r-settled", r2_keys: ["k/1"], lifted_at: null, bytes: settledRestrict },
      { id: "r-empty", r2_keys: ["k/1"], lifted_at: null, bytes: {} },
      { id: "r-failed-key", r2_keys: ["k/1", "k/2"], lifted_at: null, bytes: { restrict: { keys: { "k/1": { state: "moved", at: "x" }, "k/2": { state: "failed", at: "x", error: "e" } }, purge: { status: "done", at: "x" } } } },
      { id: "r-purge-failed", r2_keys: ["k/1"], lifted_at: null, bytes: { restrict: { keys: { "k/1": { state: "moved", at: "x" } }, purge: { status: "failed", at: "x", error: "e" } } } },
      { id: "r-no-purge-keys", r2_keys: ["k/1"], lifted_at: null, bytes: { restrict: { keys: { "k/1": { state: "moved", at: "x" } }, purge: { status: "not_configured", at: "x" } } } },
      { id: "r-lifted-unrestored", r2_keys: ["k/1"], lifted_at: "2026-11-02T00:00:00Z", bytes: settledRestrict },
      { id: "r-lifted-deferred", r2_keys: ["k/1"], lifted_at: "2026-11-02T00:00:00Z", bytes: { ...settledRestrict, lift: { keys: { "k/1": { state: "deferred", at: "x", why: "w" } }, purge: { status: "done", at: "x" } } } },
      { id: "r-lifted-settled", r2_keys: ["k/1"], lifted_at: "2026-11-02T00:00:00Z", bytes: { ...settledRestrict, lift: { keys: { "k/1": { state: "restored", at: "x" } }, purge: { status: "done", at: "x" } } } },
    )
    expect(await sweepRestrictionBytes()).toEqual({ finished: 5, errors: 0 })
    expect(db.finished).toEqual(["r-empty", "r-failed-key", "r-purge-failed", "r-lifted-unrestored", "r-lifted-deferred"])
    // The active side by its restriction, the lifted side by its lift: an old deferred lift is not pushed out of the window.
    expect(db.orders).toEqual(["restricted_at", "lifted_at"])
  })

  it("runs at most once an hour", async () => {
    db.rows.push({ id: "r-empty", r2_keys: ["k/1"], lifted_at: null, bytes: {} })
    expect(await sweepRestrictionBytes(1_000)).toEqual({ finished: 1, errors: 0 })
    db.rows[0] = { ...db.rows[0], bytes: {} }
    expect(await sweepRestrictionBytes(1_000 + SWEEP_EVERY_MS - 1)).toEqual({ finished: 0, errors: 0 })
    expect(db.finished).toHaveLength(1)
    expect(await sweepRestrictionBytes(1_000 + SWEEP_EVERY_MS)).toEqual({ finished: 1, errors: 0 })
  })

  it("counts a record that still is not settled after the attempt, and one that throws, as errors; never throws itself", async () => {
    db.settleOnFinish = false
    db.rows.push({ id: "r-empty", r2_keys: ["k/1"], lifted_at: null, bytes: {} }, { id: "r-throws", r2_keys: ["k/1"], lifted_at: null, bytes: {} })
    expect(await sweepRestrictionBytes()).toEqual({ finished: 0, errors: 2 })
  })

  it("a database before migration 583 is nothing to do; another read failure is one error per side", async () => {
    db.error = { code: "42703", message: "column bytes does not exist" }
    expect(await sweepRestrictionBytes()).toEqual({ finished: 0, errors: 0 })
    _resetRestrictionBytesSweepForTests()
    db.error = { message: "down" }
    expect(await sweepRestrictionBytes()).toEqual({ finished: 0, errors: 2 })
  })
})
