/**
 * The hold TTL (spec D31, Q3).
 *
 * Why it exists: a `pending_review` row is exempt from EVERY liveness sweep by
 * construction (its status is outside `pending|processing`), so without a clock
 * an abandoned review holds a user's credits — on a deployment with a single
 * payer account, the payer's balance — forever.
 *
 * Why it AUTO-REJECTS rather than auto-approves: approving would publish
 * exactly the output a human declined to look at. Rejecting returns the money
 * and publishes nothing.
 *
 * And why the first case is the important one: unset must mean the sweep does
 * NOTHING — not "runs and finds nothing". A deployment with no job policy must
 * not gain a query per cron tick.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const env = vi.hoisted(() => ({ ttl: "" }))
vi.mock("../../config.js", () => ({ config: { get JOB_HOLD_TTL_HOURS() { return env.ttl } } }))

const db = vi.hoisted(() => {
  const rows = { value: [{ id: "job-old" }, { id: "job-older" }] as unknown[] }
  const ltArgs: unknown[][] = []
  const updateArgs: Array<{ arg: Record<string, unknown>; eq: unknown[][] }> = []
  const limitMock = vi.fn(() => Promise.resolve({ data: rows.value, error: null }))
  const ltMock = vi.fn((...a: unknown[]) => { ltArgs.push(a); return { order: () => ({ limit: limitMock }) } })
  const eqMock = vi.fn(() => ({ lt: ltMock }))
  const selectMock = vi.fn(() => ({ eq: eqMock }))
  const updateMock = vi.fn((arg: Record<string, unknown>) => {
    const call = { arg, eq: [] as unknown[][] }
    updateArgs.push(call)
    const chain = {
      eq: (...a: unknown[]) => {
        call.eq.push(a)
        return Object.assign(Promise.resolve({ data: [{ id: "x" }], error: null }), chain)
      },
    }
    return chain
  })
  const from = vi.fn(() => ({ select: selectMock, update: updateMock }))
  return { from, rows, ltArgs, selectMock, eqMock, ltMock, updateMock, updateArgs }
})
vi.mock("../../supabase.js", () => ({ supabase: { from: db.from } }))

const reports = vi.hoisted(() => ({ insertAppReport: vi.fn(async (_r: Record<string, unknown>) => true) }))
vi.mock("../../app-reports.js", () => reports)

const gate = vi.hoisted(() => ({
  rejectHeldJobRow: vi.fn(
    async (_jobId: string, _input: Record<string, unknown>) =>
      ({ ok: true, refunded: 1 }) as { ok: boolean; reason?: string; refunded?: number },
  ),
}))
vi.mock("../../job-policy-gate.js", () => gate)

import { sweepExpiredHolds } from "../hold-expiry.js"

beforeEach(() => {
  vi.clearAllMocks()
  env.ttl = ""
  db.rows.value = [{ id: "job-old" }, { id: "job-older" }]
  db.ltArgs.length = 0
  db.updateArgs.length = 0
  gate.rejectHeldJobRow.mockResolvedValue({ ok: true, refunded: 1 })
})

describe("sweepExpiredHolds", () => {
  it("with JOB_HOLD_TTL_HOURS unset it does NOTHING — not even a query", async () => {
    expect(await sweepExpiredHolds()).toEqual({ expired: 0, errors: 0 })
    expect(db.from).not.toHaveBeenCalled()
    expect(gate.rejectHeldJobRow).not.toHaveBeenCalled()
  })

  it("treats a blank, zero or non-numeric value as disabled", async () => {
    for (const v of ["   ", "0", "-3", "soon"]) {
      env.ttl = v
      expect(await sweepExpiredHolds()).toEqual({ expired: 0, errors: 0 })
    }
    expect(db.from).not.toHaveBeenCalled()
  })

  it("selects only PARKED rows older than the TTL", async () => {
    env.ttl = "72"
    const before = Date.now()
    await sweepExpiredHolds()
    expect(db.from).toHaveBeenCalledWith("jobs")
    expect(db.eqMock).toHaveBeenCalledWith("status", "pending_review")
    const [col, cutoff] = db.ltArgs[0]! as [string, string]
    expect(col).toBe("held_at")
    const age = before - new Date(cutoff).getTime()
    expect(age).toBeGreaterThan(71 * 3600_000)
    expect(age).toBeLessThan(73 * 3600_000)
  })

  it("auto-rejects each expired hold as the PLATFORM, with the documented reason", async () => {
    env.ttl = "72"
    expect(await sweepExpiredHolds()).toEqual({ expired: 2, errors: 0 })
    expect(gate.rejectHeldJobRow).toHaveBeenCalledTimes(2)
    const [jobId, input] = gate.rejectHeldJobRow.mock.calls[0]! as [string, Record<string, unknown>]
    expect(jobId).toBe("job-old")
    expect(input.policyId).toBe("platform")
    expect(input.machineReason).toBe("hold-expired")
    expect(input.verdict).toBe("reject")
    // The user sees the platform's words, never a policy's.
    expect(String(input.userMessage)).toMatch(/review/i)
  })

  it("a refund that actually happened is stated ONCE — no second write", async () => {
    env.ttl = "1"
    db.rows.value = [{ id: "job-old" }]
    await sweepExpiredHolds()
    const [, input] = gate.rejectHeldJobRow.mock.calls[0]! as [string, Record<string, unknown>]
    expect(String(input.userMessage)).toMatch(/refunded/i)
    expect(db.updateMock).not.toHaveBeenCalled()
    expect(reports.insertAppReport).not.toHaveBeenCalled()
  })

  it("does NOT tell the user their credits came back when nothing was refunded", async () => {
    // The reservation can already be settled when the hold is taken (the
    // smart-loop-cut path commits at reserved-minus-addon before the gate
    // speaks), so `refundReservedCreditsForJob` touches nothing. The message is
    // written by the CAS BEFORE the refund runs, so the honest wording is a
    // correction on the one path where the promise would have been a lie.
    env.ttl = "1"
    db.rows.value = [{ id: "job-old" }]
    gate.rejectHeldJobRow.mockResolvedValue({ ok: true, refunded: 0 })
    expect(await sweepExpiredHolds()).toEqual({ expired: 1, errors: 0 })
    expect(db.updateMock).toHaveBeenCalledTimes(1)
    const call = db.updateArgs[0]!
    expect(String(call.arg.error_message)).not.toMatch(/have been refunded/i)
    expect(String(call.arg.error_message)).toMatch(/nothing was refunded/i)
    // The hint the canvas renders carries the corrected sentence too.
    expect(call.arg.error_hint).toMatchObject({ kind: "policy-block", reason: call.arg.error_message })
    // Only ever corrects the row WE just failed.
    expect(call.eq).toEqual([["id", "job-old"], ["status", "failed"]])
    // And an operator hears about it: a hold that expired with nothing to
    // refund means the money was settled somewhere it should not have been.
    expect(reports.insertAppReport).toHaveBeenCalledTimes(1)
    expect(reports.insertAppReport.mock.calls[0]![0]).toMatchObject({ kind: "hold-expired-without-refund", jobId: "job-old" })
  })

  it("a row another writer already resolved is counted, not retried or thrown", async () => {
    env.ttl = "1"
    gate.rejectHeldJobRow.mockResolvedValueOnce({ ok: false, reason: "lost_race" })
    expect(await sweepExpiredHolds()).toEqual({ expired: 1, errors: 1 })
  })

  it("one failing row does not abort the sweep", async () => {
    env.ttl = "1"
    gate.rejectHeldJobRow.mockRejectedValueOnce(new Error("boom"))
    expect(await sweepExpiredHolds()).toEqual({ expired: 1, errors: 1 })
  })

  it("nothing expired is a clean no-op", async () => {
    env.ttl = "1"
    db.rows.value = []
    expect(await sweepExpiredHolds()).toEqual({ expired: 0, errors: 0 })
    expect(gate.rejectHeldJobRow).not.toHaveBeenCalled()
  })
})
