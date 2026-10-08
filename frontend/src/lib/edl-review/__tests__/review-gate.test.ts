import { describe, it, expect } from "vitest"
import { reviewGate, type ReviewGateInput } from "../review-gate"

/** The footer's gate (§2.5 of the inspectors design). */
const ready: ReviewGateInput = {
  reviewable: true,
  readOnly: false,
  locked: false,
  keptCount: 1,
  verdict: { ok: true },
  newerRun: null,
}

describe("reviewGate", () => {
  // A4-2: a clip set's gate counts kept clips, not intervals.
  it("holds the runs when no clip is kept, and does not when the count is unknown", () => {
    expect(reviewGate({ ...ready, keptCount: 0 }).hold).toEqual({ kind: "nothing-kept" })
    expect(reviewGate({ ...ready, keptCount: null }).hold).toBeNull()
  })

  it("lets both runs go when the cut keeps time, passes the rule and no newer run waits", () => {
    expect(reviewGate(ready)).toEqual({ mode: "ready", hold: null })
  })

  it("hides the runs for a plan it cannot review, and runs nothing on a read-only canvas", () => {
    expect(reviewGate({ ...ready, reviewable: false }).mode).toBe("hidden")
    expect(reviewGate({ ...ready, readOnly: true, locked: true }).mode).toBe("view-only")
  })

  it("is running while a live run includes the render or its plan (R9 a)", () => {
    expect(reviewGate({ ...ready, locked: true })).toEqual({ mode: "running", hold: null })
  })

  it("holds the runs, first match wins: nothing kept, the rule's issues, a newer run, the check out, no verdict yet", () => {
    const issues = { ok: false as const, issues: ["too long"] }
    expect(reviewGate({ ...ready, keptCount: 0, verdict: issues }).hold).toEqual({ kind: "nothing-kept" })
    expect(reviewGate({ ...ready, verdict: issues, newerRun: {} }).hold).toEqual({ kind: "issues", issues: ["too long"] })
    expect(reviewGate({ ...ready, newerRun: { cut: {} } }).hold).toEqual({ kind: "newer-run" })
    expect(reviewGate({ ...ready, newerRun: undefined }).hold).toEqual({ kind: "checking-newer" })
    expect(reviewGate({ ...ready, verdict: undefined }).hold).toEqual({ kind: "judging" })
  })

  // Decided 2026-10-07: a check that has not answered in 15 s stops holding the runs.
  it("lets the runs go with a warning once the newer-run check has timed out", () => {
    expect(reviewGate({ ...ready, newerRun: undefined, newerCheckTimedOut: true })).toEqual({
      mode: "ready",
      hold: null,
      warning: "newer-unchecked",
    })
    // Earlier holds still win; the warning stays beside them.
    expect(reviewGate({ ...ready, keptCount: 0, newerRun: undefined, newerCheckTimedOut: true })).toEqual({
      mode: "ready",
      hold: { kind: "nothing-kept" },
      warning: "newer-unchecked",
    })
    // An answer, even a late one, replaces the warning.
    expect(reviewGate({ ...ready, newerRun: null, newerCheckTimedOut: true })).toEqual({ mode: "ready", hold: null })
    expect(reviewGate({ ...ready, newerRun: { cut: {} }, newerCheckTimedOut: true }).hold).toEqual({ kind: "newer-run" })
  })
})
