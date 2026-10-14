// @vitest-environment node
import { describe, it, expect } from "vitest"
import { getScheduledCancelDate } from "../subscription"

describe("getScheduledCancelDate", () => {
  it("returns cancel_at when set (newer Stripe portal-cancel shape)", () => {
    expect(
      getScheduledCancelDate({
        status: "active",
        cancel_at_period_end: false,
        cancel_at: "2026-08-28T21:21:31+00:00",
        current_period_end: "2026-08-28T21:21:31+00:00",
      }),
    ).toBe("2026-08-28T21:21:31+00:00")
  })

  it("falls back to current_period_end when only the legacy boolean is set", () => {
    expect(
      getScheduledCancelDate({
        status: "active",
        cancel_at_period_end: true,
        cancel_at: null,
        current_period_end: "2026-08-28T21:21:31+00:00",
      }),
    ).toBe("2026-08-28T21:21:31+00:00")
  })

  it("returns null when no cancellation is scheduled", () => {
    expect(
      getScheduledCancelDate({
        status: "active",
        cancel_at_period_end: false,
        cancel_at: null,
        current_period_end: "2026-08-28T21:21:31+00:00",
      }),
    ).toBeNull()
  })

  it("returns null for non-active subscriptions and missing rows", () => {
    expect(
      getScheduledCancelDate({
        status: "canceled",
        cancel_at_period_end: false,
        cancel_at: "2026-08-28T21:21:31+00:00",
        current_period_end: null,
      }),
    ).toBeNull()
    expect(getScheduledCancelDate(null)).toBeNull()
    expect(getScheduledCancelDate(undefined)).toBeNull()
  })
})
