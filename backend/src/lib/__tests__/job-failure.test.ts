/**
 * `markJobFailed` is THE way anything marks a job failed (spec
 * 2026-09-03-job-policy-hook-design §9, D10/D11).
 *
 * What these cases protect:
 *  - the returned boolean IS the refund gate. Every migrated writer refunds
 *    only when WE flipped the row; a helper that returned `true` on a 0-row CAS
 *    would refund a job another writer already settled.
 *  - `pending_review` is NOT in the default CAS set: no sweep may fail a job a
 *    human is reviewing. The reject path is the one caller that says so, with
 *    an explicit `from`.
 *  - the 500-char slice moves here so it cannot be forgotten (reconcile/kie.ts
 *    used to do it by hand).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { selectMock, inMock, eqMock, updateMock, fromMock } = vi.hoisted(() => {
  const selectMock = vi.fn<(...a: unknown[]) => unknown>().mockResolvedValue({ data: [{ id: "j1" }], error: null })
  const inMock = vi.fn<(...a: unknown[]) => unknown>(() => ({ select: selectMock }))
  const eqMock = vi.fn<(...a: unknown[]) => unknown>(() => ({ in: inMock }))
  const updateMock = vi.fn<(a: Record<string, unknown>) => unknown>(() => ({ eq: eqMock }))
  const fromMock = vi.fn<(...a: unknown[]) => unknown>(() => ({ update: updateMock }))
  return { selectMock, inMock, eqMock, updateMock, fromMock }
})

vi.mock("../supabase.js", () => ({ supabase: { from: fromMock } }))

import { markJobFailed, markJobFailedDetailed, FAILABLE_STATUSES } from "../job-failure.js"

describe("markJobFailed", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectMock.mockResolvedValue({ data: [{ id: "j1" }], error: null })
  })

  it("writes the terminal shape and CASes on the live statuses", async () => {
    const ok = await markJobFailed("j1", { error_message: "boom" })
    expect(ok).toBe(true)
    expect(fromMock).toHaveBeenCalledWith("jobs")
    const arg = updateMock.mock.calls[0]![0]
    expect(arg.status).toBe("failed")
    expect(arg.error_message).toBe("boom")
    expect(typeof arg.completed_at).toBe("string")
    expect(eqMock).toHaveBeenCalledWith("id", "j1")
    expect(inMock).toHaveBeenCalledWith("status", ["pending", "queued", "processing"])
  })

  it("never fails a job that is parked for review by default", () => {
    expect(FAILABLE_STATUSES).not.toContain("pending_review")
    // and the widening that comes with consolidation is deliberate (D11/Q14):
    expect(FAILABLE_STATUSES).toContain("queued")
  })

  it("honours an explicit `from` — the reject path's only lever", async () => {
    await markJobFailed("j2", { error_message: "rejected", from: ["pending_review"] })
    expect(inMock).toHaveBeenCalledWith("status", ["pending_review"])
  })

  it("markJobFailedDetailed tells a DB ERROR apart from a 0-row CAS", async () => {
    // The boolean collapses the two, and the result gate's block arm then files
    // a `policy-decision-lost-race` report for a statement timeout — a race an
    // operator would chase that never happened (F-review H2).
    selectMock.mockResolvedValueOnce({ data: [{ id: "j9" }], error: null })
    expect(await markJobFailedDetailed("j9", { error_message: "x" })).toBe("flipped")
    selectMock.mockResolvedValueOnce({ data: [], error: null })
    expect(await markJobFailedDetailed("j9", { error_message: "x" })).toBe("missed")
    selectMock.mockResolvedValueOnce({ data: null, error: { message: "canceling statement due to statement timeout" } })
    expect(await markJobFailedDetailed("j9", { error_message: "x" })).toBe("error")
  })

  it("markJobFailed stays the boolean wrapper its 16 callers read as the refund gate", async () => {
    selectMock.mockResolvedValueOnce({ data: [{ id: "j9" }], error: null })
    expect(await markJobFailed("j9", { error_message: "x" })).toBe(true)
    // Both non-flipped outcomes answer false: no caller may refund on either.
    selectMock.mockResolvedValueOnce({ data: [], error: null })
    expect(await markJobFailed("j9", { error_message: "x" })).toBe(false)
    selectMock.mockResolvedValueOnce({ data: null, error: { message: "nope" } })
    expect(await markJobFailed("j9", { error_message: "x" })).toBe(false)
  })

  it("returns false when the CAS matched no row (another writer won)", async () => {
    selectMock.mockResolvedValueOnce({ data: [], error: null })
    expect(await markJobFailed("j3", { error_message: "x" })).toBe(false)
  })

  it("returns false (never throws) on a DB error", async () => {
    selectMock.mockResolvedValueOnce({ data: null, error: { message: "nope" } })
    expect(await markJobFailed("j4", { error_message: "x" })).toBe(false)
  })

  it("slices error_message to 500 chars", async () => {
    await markJobFailed("j5", { error_message: "a".repeat(900) })
    expect(String(updateMock.mock.calls[0]![0].error_message)).toHaveLength(500)
  })

  it("writes error_detail when given (null included — the honest answer)", async () => {
    await markJobFailed("j6", { error_message: "x", error_detail: null })
    expect(updateMock.mock.calls[0]![0]).toHaveProperty("error_detail", null)
  })

  it("omits error_detail entirely when the caller did not pass one", async () => {
    await markJobFailed("j7", { error_message: "x" })
    expect(updateMock.mock.calls[0]![0]).not.toHaveProperty("error_detail")
  })

  it("carries the error_hint and the caller's extra columns onto the failed row", async () => {
    await markJobFailed("j8", {
      error_message: "blocked",
      error_hint: { kind: "policy-block", policyId: "p", reason: "no", hookPoint: "result" },
      extra: { provider: "kie", provider_cost: 0.4 },
      reconcile_attempts: 3,
      reconcile_last_error: "reconcile_no_recovery",
    })
    const arg = updateMock.mock.calls[0]![0]
    expect(arg.error_hint).toEqual({ kind: "policy-block", policyId: "p", reason: "no", hookPoint: "result" })
    expect(arg.provider).toBe("kie")
    expect(arg.provider_cost).toBe(0.4)
    expect(arg.reconcile_attempts).toBe(3)
    expect(arg.reconcile_last_error).toBe("reconcile_no_recovery")
  })
})
