/**
 * An account's record as the complaint handler's screen shows it
 * (ee/lib/account-record.ts) over an in-memory store: each matched account's
 * standing (standing infringements in the window, kinds in force), and the
 * named account's whole record (each infringement with its case and whether
 * that case's content was restored after a counter-notice, each measure with
 * whether it is in force, the step the policy names, the block as it is now).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { MemoryDb } from "../../../test/memory-tables.js"

const db = vi.hoisted(() => ({ tables: {} }) as MemoryDb)
const blocked = vi.hoisted(() => ({ readBlock: vi.fn(async (): Promise<{ reason: string | null; blockedAt: string } | null> => null) }))

vi.mock("../../../lib/supabase.js", async () => {
  const { memorySupabase } = await import("../../../test/memory-tables.js")
  return { supabase: memorySupabase(db) }
})
vi.mock("../account-blocking.js", () => ({ readBlock: blocked.readBlock, isBlockedNow: vi.fn(), blockRefusal: vi.fn(), BLOCK_REFUSAL_MESSAGE: {} }))
// The moves module is read for its column lists only.
vi.mock("../block-account.js", () => ({ blockAccount: vi.fn() }))
vi.mock("../repeat-infringer-alerts.js", () => ({ alertPolicyNamesClosure: vi.fn() }))
vi.mock("../../../lib/app-settings.js", () => ({ getAppSettings: vi.fn() }))
vi.mock("../../../lib/repeat-infringer-policy-store.js", () => ({ currentRepeatInfringerPolicy: vi.fn() }))
vi.mock("../../../lib/rights-complaints.js", () => ({ recordComplaintEventQuietly: vi.fn() }))

import { accountRecordOf, standingOf } from "../account-record.js"
import type { RepeatInfringerPolicy } from "../../../lib/repeat-infringer-policy.js"

const OWNER = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"
const NOW = new Date("2026-11-03T12:00:00.000Z")
const POLICY: RepeatInfringerPolicy = {
  windowMonths: 24,
  steps: [
    { infringements: 1, kind: "warning" },
    { infringements: 2, kind: "imports_blocked", days: 30 },
    { infringements: 3, kind: "closed" },
  ],
}

const infringement = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  complaint_id: "c1",
  user_id: OWNER,
  note: "why",
  recorded_at: "2026-10-01T00:00:00.000Z",
  withdrawn_at: null,
  withdraw_reason: null,
  ...over,
})
const measure = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  user_id: OWNER,
  kind: "imports_blocked",
  applied_at: "2026-10-02T00:00:00.000Z",
  ends_at: null,
  reason: "told",
  note: "mine",
  complaint_id: "c1",
  infringement_id: null,
  infringements_in_window: 2,
  policy_step: { infringements: 2, kind: "imports_blocked", days: 30, windowMonths: 24 },
  departure_reason: null,
  lifted_at: null,
  lift_reason: null,
  ...over,
})

beforeEach(() => {
  db.tables = {
    account_infringements: [],
    account_sanctions: [],
    rights_complaints: [
      { id: "c1", reference: "CR-2026-000001", status: "resolved", kind: "copyright" },
      { id: "c2", reference: "CR-2026-000002", status: "content_restored", kind: "copyright" },
    ],
    rights_counter_notices: [],
  }
  db.missingTables = undefined
  db.failReads = undefined
  blocked.readBlock.mockReset().mockResolvedValue(null)
})

describe("standingOf", () => {
  it("counts each account's standing infringements in the window and names the kinds in force", async () => {
    db.tables.account_infringements = [
      infringement("i1"),
      infringement("i2", { complaint_id: "c2" }),
      infringement("i3", { withdrawn_at: "2026-10-05T00:00:00.000Z", withdraw_reason: "x" }),
      infringement("i4", { recorded_at: "2024-01-01T00:00:00.000Z" }),
      infringement("i5", { user_id: OTHER }),
    ]
    db.tables.account_sanctions = [
      measure("m1", { ends_at: "2026-11-30T00:00:00.000Z" }),
      measure("m2", { kind: "warning" }),
      measure("m3", { ends_at: "2026-10-30T00:00:00.000Z" }),
      measure("m4", { user_id: OTHER, kind: "closed", lifted_at: "2026-10-20T00:00:00.000Z", lift_reason: "x" }),
    ]
    const standing = await standingOf([OWNER, OTHER, "33333333-3333-4333-8333-333333333333"], POLICY, NOW)
    expect(standing.get(OWNER)).toEqual({ inWindow: 2, inForce: ["imports_blocked"] })
    expect(standing.get(OTHER)).toEqual({ inWindow: 1, inForce: [] })
    expect(standing.get("33333333-3333-4333-8333-333333333333")).toEqual({ inWindow: 0, inForce: [] })
  })

  it("asks nothing for no account, and reads a record not in the database yet as empty", async () => {
    expect((await standingOf([], POLICY, NOW)).size).toBe(0)
    db.missingTables = new Set(["account_infringements", "account_sanctions"])
    expect((await standingOf([OWNER], POLICY, NOW)).get(OWNER)).toEqual({ inWindow: 0, inForce: [] })
  })

  it("a failed read fails the section", async () => {
    db.failReads = new Set(["account_sanctions"])
    await expect(standingOf([OWNER], POLICY, NOW)).rejects.toThrow("Account measures read failed")
  })
})

describe("accountRecordOf", () => {
  it("answers each infringement with its case and whether it counts, each measure with whether it is in force, and the step the policy names", async () => {
    db.tables.account_infringements = [
      infringement("i1"),
      infringement("i2", { complaint_id: "c2", recorded_at: "2026-10-03T00:00:00.000Z" }),
      infringement("i3", { recorded_at: "2026-09-01T00:00:00.000Z", withdrawn_at: "2026-09-05T00:00:00.000Z", withdraw_reason: "appeal" }),
      infringement("i4", { complaint_id: "c-gone", recorded_at: "2023-01-01T00:00:00.000Z" }),
      infringement("i5", { user_id: OTHER }),
    ]
    db.tables.account_sanctions = [
      measure("m1", { ends_at: "2026-11-01T00:00:00.000Z" }),
      measure("m2", { kind: "warning", applied_at: "2026-10-01T00:00:00.000Z" }),
      measure("m3", { kind: "closed", applied_at: "2026-10-05T00:00:00.000Z", complaint_id: null }),
    ]
    db.tables.rights_counter_notices = [
      { complaint_id: "c2", user_id: OWNER, restored_at: "2026-10-20T00:00:00.000Z" },
      { complaint_id: "c1", user_id: OWNER, restored_at: null },
      { complaint_id: "c1", user_id: OTHER, restored_at: "2026-10-20T00:00:00.000Z" },
    ]
    blocked.readBlock.mockResolvedValue({ reason: "Closed under the repeat-infringer policy (case CR-2026-000001)", blockedAt: "2026-10-05T00:00:01.000Z" })
    const record = await accountRecordOf(OWNER, POLICY, NOW)
    expect(record).toMatchObject({
      userId: OWNER,
      windowMonths: 24,
      inWindow: 2,
      step: { infringements: 2, kind: "imports_blocked", days: 30 },
      blocked: true,
      block: { reason: "Closed under the repeat-infringer policy (case CR-2026-000001)", blockedAt: "2026-10-05T00:00:01.000Z" },
    })
    expect(blocked.readBlock).toHaveBeenCalledWith(OWNER)
    expect(record.infringements.map((i) => [i.id, i.caseReference, i.caseStatus, i.counts, i.restoredAfterCounterNotice])).toEqual([
      ["i2", "CR-2026-000002", "content_restored", true, true],
      ["i1", "CR-2026-000001", "resolved", true, false],
      ["i3", "CR-2026-000001", "resolved", false, false],
      ["i4", null, null, false, false],
    ])
    expect(record.infringements[2]).toMatchObject({ withdrawReason: "appeal", note: "why" })
    expect(record.measures.map((m) => [m.id, m.kind, m.inForce, m.caseReference])).toEqual([
      ["m3", "closed", true, null],
      ["m1", "imports_blocked", false, "CR-2026-000001"],
      ["m2", "warning", false, "CR-2026-000001"],
    ])
    expect(record.measures[1]).toMatchObject({ reason: "told", note: "mine", policyStep: { infringements: 2 }, departureReason: null })
  })

  it("a block that could not be read is unknown, not unblocked", async () => {
    blocked.readBlock.mockRejectedValueOnce(new Error("blocks down"))
    expect(await accountRecordOf(OWNER, POLICY, NOW)).toMatchObject({ blocked: null, block: null })
  })

  it("an account with nothing recorded has an empty record and no step", async () => {
    expect(await accountRecordOf(OWNER, POLICY, NOW)).toEqual({ userId: OWNER, windowMonths: 24, inWindow: 0, step: null, infringements: [], measures: [], blocked: false, block: null })
  })

  it("reads a record not in the database yet as empty", async () => {
    db.missingTables = new Set(["account_infringements", "account_sanctions"])
    await expect(accountRecordOf(OWNER, POLICY, NOW)).resolves.toMatchObject({ inWindow: 0, infringements: [], measures: [] })
  })
})
