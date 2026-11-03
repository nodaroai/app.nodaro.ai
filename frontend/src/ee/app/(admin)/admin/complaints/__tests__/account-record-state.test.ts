import { describe, it, expect } from "vitest"
import type { ComplaintCase } from "@/ee/hooks/queries/use-admin-complaints-queries"
import type { AccountRecord, RecordInfringement, RecordMeasure } from "@/ee/hooks/queries/use-admin-repeat-infringers"
import {
  blockMismatch,
  draftFromStep,
  followsStep,
  measureBlocker,
  parseDays,
  recordBlocker,
  standingInfringementOf,
  suggestedOwnerReason,
} from "../account-record-state"

/**
 * What the account's record on a case says to do next: whether a measure is
 * the policy's step (the server's own rule), the standing infringement this
 * case recorded, why a move cannot be made yet, the measure the form starts
 * at and what the owner is told, where the block and the closures disagree,
 * and an import block's days as typed.
 */

const infringement = (over: Partial<RecordInfringement> = {}): RecordInfringement => ({
  id: "i-1",
  complaintId: "c-1",
  caseReference: "CR-2026-000001",
  caseStatus: "resolved",
  caseKind: "copyright",
  note: null,
  recordedAt: "2026-10-01T00:00:00Z",
  withdrawnAt: null,
  withdrawReason: null,
  counts: true,
  restoredAfterCounterNotice: false,
  ...over,
})
const measure = (over: Partial<RecordMeasure> = {}): RecordMeasure => ({
  id: "m-1",
  kind: "closed",
  appliedAt: "2026-10-02T00:00:00Z",
  endsAt: null,
  reason: "r",
  note: null,
  complaintId: "c-1",
  caseReference: "CR-2026-000001",
  infringementId: null,
  infringementsInWindow: 3,
  policyStep: { infringements: 3 },
  departureReason: null,
  liftedAt: null,
  liftReason: null,
  inForce: true,
  ...over,
})
const record = (over: Partial<AccountRecord> = {}): AccountRecord => ({
  userId: "u-1",
  windowMonths: 24,
  inWindow: 1,
  step: { infringements: 1, kind: "warning" },
  infringements: [],
  measures: [],
  blocked: false,
  block: null,
  ...over,
})
const complaint = (over: Partial<ComplaintCase> = {}) => ({ id: "c-1", verifiedAt: "2026-10-01T00:00:00Z", userId: "u-1", record: record(), ...over }) as ComplaintCase

describe("followsStep", () => {
  it("is the step's kind, and for an import block the step's length (none: until lifted)", () => {
    expect(followsStep({ infringements: 1, kind: "warning" }, "warning", null)).toBe(true)
    expect(followsStep({ infringements: 1, kind: "warning" }, "closed", null)).toBe(false)
    expect(followsStep({ infringements: 2, kind: "imports_blocked", days: 30 }, "imports_blocked", 30)).toBe(true)
    expect(followsStep({ infringements: 2, kind: "imports_blocked", days: 30 }, "imports_blocked", 7)).toBe(false)
    expect(followsStep({ infringements: 2, kind: "imports_blocked", days: 30 }, "imports_blocked", null)).toBe(false)
    expect(followsStep({ infringements: 2, kind: "imports_blocked" }, "imports_blocked", null)).toBe(true)
    expect(followsStep(null, "warning", null)).toBe(false)
  })
})

describe("standingInfringementOf", () => {
  it("is this case's infringement while it stands", () => {
    const mine = infringement()
    expect(standingInfringementOf(record({ infringements: [infringement({ id: "i-0", complaintId: "c-9" }), mine] }), "c-1")).toBe(mine)
    expect(standingInfringementOf(record({ infringements: [infringement({ withdrawnAt: "2026-10-05T00:00:00Z" })] }), "c-1")).toBeNull()
  })
})

describe("recordBlocker and measureBlocker", () => {
  it("an unverified case, or one naming no account, records and measures nothing", () => {
    expect(recordBlocker(complaint({ verifiedAt: null }))).toMatch(/not proved their email/)
    expect(measureBlocker(complaint({ verifiedAt: null }))).toMatch(/not proved their email/)
    expect(recordBlocker(complaint({ userId: null }))).toBe("Name the case's account first.")
    expect(measureBlocker(complaint({ userId: null }))).toBe("Name the case's account first.")
  })

  it("an infringement is recorded once per case while it stands; a measure is taken whatever was recorded", () => {
    const recorded = complaint({ record: record({ infringements: [infringement()] }) })
    expect(recordBlocker(recorded)).toBe("An infringement from this case is recorded.")
    expect(measureBlocker(recorded)).toBeNull()
    expect(recordBlocker(complaint({ record: record({ infringements: [infringement({ withdrawnAt: "2026-10-05T00:00:00Z" })] }) }))).toBeNull()
    expect(recordBlocker(complaint())).toBeNull()
  })
})

describe("draftFromStep and suggestedOwnerReason", () => {
  it("starts at the policy's step, or a warning when it names none", () => {
    expect(draftFromStep({ infringements: 2, kind: "imports_blocked", days: 30 })).toEqual({ kind: "imports_blocked", days: 30 })
    expect(draftFromStep({ infringements: 2, kind: "imports_blocked" })).toEqual({ kind: "imports_blocked", days: null })
    expect(draftFromStep({ infringements: 3, kind: "closed" })).toEqual({ kind: "closed", days: null })
    expect(draftFromStep(null)).toEqual({ kind: "warning", days: null })
  })

  it("suggests what the owner is told, naming a copyright complaint only for a copyright case", () => {
    expect(suggestedOwnerReason("warning", "copyright")).toContain("a copyright complaint")
    expect(suggestedOwnerReason("warning", "other")).not.toContain("copyright")
    expect(suggestedOwnerReason("imports_blocked", "copyright")).toContain("importing links is blocked")
    expect(suggestedOwnerReason("closed", "copyright")).toContain("the account is closed")
  })
})

describe("blockMismatch", () => {
  it("a closure lifted while the account stays blocked, and a closure standing on an unblocked account, are named", () => {
    expect(blockMismatch(record({ blocked: true, measures: [measure({ inForce: false, liftedAt: "2026-10-09T00:00:00Z" })] }))).toBe("blocked_after_lift")
    expect(blockMismatch(record({ blocked: false, measures: [measure()] }))).toBe("closure_without_block")
  })

  it("agreement, a block with no closure ever, and a block that could not be read say nothing", () => {
    expect(blockMismatch(record({ blocked: true, measures: [measure()] }))).toBeNull()
    expect(blockMismatch(record({ blocked: false, measures: [measure({ inForce: false, liftedAt: "2026-10-09T00:00:00Z" })] }))).toBeNull()
    expect(blockMismatch(record({ blocked: true, measures: [] }))).toBeNull()
    expect(blockMismatch(record({ blocked: null, measures: [measure()] }))).toBeNull()
  })
})

describe("parseDays", () => {
  it("is a whole number from 1 to the cap, null when empty, undefined otherwise", () => {
    expect(parseDays("", 3650)).toBeNull()
    expect(parseDays("  ", 3650)).toBeNull()
    expect(parseDays("30", 3650)).toBe(30)
    expect(parseDays(" 7 ", 3650)).toBe(7)
    expect(parseDays("0", 3650)).toBeUndefined()
    expect(parseDays("3651", 3650)).toBeUndefined()
    expect(parseDays("1.5", 3650)).toBeUndefined()
    expect(parseDays("-3", 3650)).toBeUndefined()
    expect(parseDays("ten", 3650)).toBeUndefined()
  })
})
