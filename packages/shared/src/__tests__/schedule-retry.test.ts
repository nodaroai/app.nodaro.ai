import { describe, it, expect } from "vitest"
import { SCHEDULE_RETRY_DEFAULTS, SCHEDULE_RETRY_LIMITS, normalizeScheduleRetry } from "../schedule-retry.js"

describe("normalizeScheduleRetry — the node's retry policy as the server runs it", () => {
  it("absent, null or not an object is the feature off", () => {
    expect(normalizeScheduleRetry(undefined)).toBeNull()
    expect(normalizeScheduleRetry(null)).toBeNull()
    expect(normalizeScheduleRetry(true)).toBeNull()
    expect(normalizeScheduleRetry("30")).toBeNull()
  })

  it("an empty object is the defaults: 30 minutes, 3 attempts, cheap lanes only", () => {
    expect(normalizeScheduleRetry({})).toEqual(SCHEDULE_RETRY_DEFAULTS)
    expect(SCHEDULE_RETRY_DEFAULTS).toEqual({ afterMinutes: 30, maxAttempts: 3, cheapLanesOnly: true })
  })

  it("keeps in-range values, reads a numeric string, and clamps the rest into range", () => {
    expect(normalizeScheduleRetry({ afterMinutes: 90, maxAttempts: 2, cheapLanesOnly: false })).toEqual({ afterMinutes: 90, maxAttempts: 2, cheapLanesOnly: false })
    expect(normalizeScheduleRetry({ afterMinutes: "45", maxAttempts: "1" })).toMatchObject({ afterMinutes: 45, maxAttempts: 1 })
    expect(normalizeScheduleRetry({ afterMinutes: 1, maxAttempts: 9 })).toMatchObject({
      afterMinutes: SCHEDULE_RETRY_LIMITS.afterMinutes[0],
      maxAttempts: SCHEDULE_RETRY_LIMITS.maxAttempts[1],
    })
    expect(normalizeScheduleRetry({ afterMinutes: 100000, maxAttempts: 0 })).toMatchObject({
      afterMinutes: SCHEDULE_RETRY_LIMITS.afterMinutes[1],
      maxAttempts: SCHEDULE_RETRY_LIMITS.maxAttempts[0],
    })
  })

  it("cheap lanes only is off only when said so — a missing or truthy flag keeps it on", () => {
    expect(normalizeScheduleRetry({ cheapLanesOnly: false })?.cheapLanesOnly).toBe(false)
    expect(normalizeScheduleRetry({ cheapLanesOnly: "false" })?.cheapLanesOnly).toBe(true)
    expect(normalizeScheduleRetry({ cheapLanesOnly: undefined })?.cheapLanesOnly).toBe(true)
  })
})
