import { describe, expect, it } from "vitest"
import { IN_FLIGHT_JOB_STATUSES, JOB_STATUSES, TERMINAL_JOB_STATUSES } from "../job-status.js"

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
})
