import { describe, expect, it } from "vitest"
import {
  IN_FLIGHT_JOB_STATUSES,
  JOB_STATUSES,
  PARKED_JOB_STATUSES,
  TERMINAL_JOB_STATUSES,
  isParkedJobStatus,
} from "../job-status.js"

// The in-flight/terminal split must stay an exact partition of the status
// vocabulary: a status added to JOB_STATUSES but neither subset would silently
// vanish from every "is anything in flight?" query (the studio-spinner-lost-
// on-refresh bug this module was extracted to fix).
describe("job status vocabulary", () => {
  it("in-flight + terminal partition JOB_STATUSES exactly", () => {
    const union = [...IN_FLIGHT_JOB_STATUSES, ...TERMINAL_JOB_STATUSES]
    expect([...union].sort()).toEqual([...JOB_STATUSES].sort())
    expect(new Set(union).size).toBe(union.length)
  })

  it("covers the statuses workers/MCP actually write mid-flight", () => {
    expect(IN_FLIGHT_JOB_STATUSES).toContain("processing")
    expect(IN_FLIGHT_JOB_STATUSES).toContain("queued")
    expect(IN_FLIGHT_JOB_STATUSES).toContain("pending")
    // "running" belongs to workflow_executions, never jobs.
    expect(JOB_STATUSES).not.toContain("running")
  })

  // PARKED is a NAMED SUBSET of in-flight, not a fourth partition (spec §6.1,
  // D14). Two ways to get it wrong, both caught here:
  //   • putting "pending_review" in TERMINAL — every waiter (SDK runAndWait,
  //     the canvas poll loops, MCP _wait-for-job, the studio spinner
  //     rehydration) would stop early on a job whose media is withheld but
  //     whose credits are still reserved;
  //   • putting it in neither subset — the partition assertion above already
  //     catches that, which is why it needs no edit.
  // The set exists so a sweep's exemption is a POSITIVE assertion
  // (isParkedJobStatus) rather than an omission nobody notices.
  it("parked is a strict subset of in-flight and disjoint from terminal", () => {
    expect(PARKED_JOB_STATUSES.length).toBeGreaterThan(0)
    for (const s of PARKED_JOB_STATUSES) {
      expect(JOB_STATUSES).toContain(s)
      expect(IN_FLIGHT_JOB_STATUSES).toContain(s)
      expect(TERMINAL_JOB_STATUSES).not.toContain(s)
    }
    // Strict subset: in-flight has members that are NOT parked (a job the
    // worker is actively pushing forward).
    expect(PARKED_JOB_STATUSES.length).toBeLessThan(IN_FLIGHT_JOB_STATUSES.length)
  })

  it("isParkedJobStatus recognises exactly the parked set", () => {
    for (const s of JOB_STATUSES) {
      expect(isParkedJobStatus(s)).toBe((PARKED_JOB_STATUSES as readonly string[]).includes(s))
    }
    expect(isParkedJobStatus("running")).toBe(false)
    expect(isParkedJobStatus("")).toBe(false)
  })
})
