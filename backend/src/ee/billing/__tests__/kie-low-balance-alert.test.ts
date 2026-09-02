/**
 * KIE.ai low-balance runway alert — pure computation over stored snapshots.
 *
 * Ops item from the 2026-09-01 app-reports triage: on 2026-08-31 20:31Z the
 * KIE.ai account balance ran dry mid-generation (four user jobs failed with
 * `[ALERT] KIE.ai account balance exhausted`, providers/kie/client.ts) with
 * zero advance warning. `kieRunwayAlert` computes a trailing-24h burn rate
 * from the hourly balance snapshots and returns a warning message once the
 * runway (balance / burn rate) drops under KIE_LOW_BALANCE_RUNWAY_HOURS —
 * table-driven so every threshold edge is pinned down.
 */

import { describe, it, expect } from "vitest"
import { kieRunwayAlert, KIE_LOW_BALANCE_RUNWAY_HOURS, type KieCreditSnapshotRow } from "../kie-low-balance-alert.js"

const HOUR = 3_600_000
const NOW = new Date("2026-09-01T12:00:00.000Z")

function at(hoursBeforeNow: number, credits: number): KieCreditSnapshotRow {
  return { credits, recorded_at: new Date(NOW.getTime() - hoursBeforeNow * HOUR).toISOString() }
}

describe("kieRunwayAlert", () => {
  it("is a documented, tunable constant — not a magic number sprinkled around", () => {
    expect(KIE_LOW_BALANCE_RUNWAY_HOURS).toBe(24)
  })

  it("healthy: burning slowly gives a runway of days -> no alert", () => {
    // 24h ago: 1000, now: 990 -> burn 10/24h -> runway = 990 / (10/24) = 2376h (~99 days)
    const snapshots = [at(24, 1000), at(0, 990)]
    expect(kieRunwayAlert(snapshots, NOW)).toBeNull()
  })

  it("low: burning fast gives a runway under 24h -> alert with the numbers", () => {
    // 24h ago: 340, now: 100 -> burn 240/24h -> burnPerHour 10 -> runway = 100/10 = 10h
    const snapshots = [at(24, 340), at(0, 100)]
    const msg = kieRunwayAlert(snapshots, NOW)
    expect(msg).not.toBeNull()
    expect(msg).toContain("[ALERT] KIE.ai balance low:")
    expect(msg).toContain("100 credits")
    expect(msg).toContain("~10h of runway")
    expect(msg).toContain("(240/24h)")
  })

  it("zero burn: balance flat over 24h -> no alert (nothing to warn about)", () => {
    const snapshots = [at(24, 500), at(0, 500)]
    expect(kieRunwayAlert(snapshots, NOW)).toBeNull()
  })

  it("rising balance (top-up happened): drop floored at 0 -> no alert", () => {
    const snapshots = [at(24, 100), at(0, 500)]
    expect(kieRunwayAlert(snapshots, NOW)).toBeNull()
  })

  it("single snapshot: nothing to compute a trend from -> no alert", () => {
    const snapshots = [at(0, 50)]
    expect(kieRunwayAlert(snapshots, NOW)).toBeNull()
  })

  it("two snapshots less than 6h apart: too close to trust as a rate -> no alert", () => {
    const snapshots = [at(3, 200), at(0, 190)]
    expect(kieRunwayAlert(snapshots, NOW)).toBeNull()
  })

  it("balance already 0: alerts with runway 0, regardless of burn magnitude", () => {
    const snapshots = [at(24, 240), at(0, 0)]
    const msg = kieRunwayAlert(snapshots, NOW)
    expect(msg).not.toBeNull()
    expect(msg).toContain("0 credits")
    expect(msg).toContain("~0h of runway")
  })

  it("balance already 0 and flat (drained well before this window): still alerts", () => {
    // No positive "burn" to point to (already-zero yesterday too), but an
    // empty account is never a non-event.
    const snapshots = [at(24, 0), at(0, 0)]
    const msg = kieRunwayAlert(snapshots, NOW)
    expect(msg).not.toBeNull()
    expect(msg).toContain("0 credits")
    expect(msg).toContain("~0h of runway")
  })

  it("empty array: no alert", () => {
    expect(kieRunwayAlert([], NOW)).toBeNull()
  })

  it("ignores rows dated after `now` when picking the latest reading", () => {
    // A future-dated row (clock skew / concurrent insert) must not be
    // mistaken for "latest" — the real latest-as-of-now is 100, drop-heavy.
    const future = { credits: 999, recorded_at: new Date(NOW.getTime() + HOUR).toISOString() }
    const snapshots = [at(24, 340), at(0, 100), future]
    const msg = kieRunwayAlert(snapshots, NOW)
    expect(msg).not.toBeNull()
    expect(msg).toContain("100 credits")
    expect(msg).toContain("~10h of runway")
  })

  it("is order-independent (sorts snapshots itself)", () => {
    const snapshots = [at(0, 100), at(24, 340)]
    const msg = kieRunwayAlert(snapshots, NOW)
    expect(msg).toContain("100 credits")
  })
})
