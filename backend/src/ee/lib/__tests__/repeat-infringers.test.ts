/**
 * The handler's moves on an account's record (ee/lib/repeat-infringers.ts)
 * over an in-memory store whose guards refuse what migration 588 refuses: an
 * infringement only from a verified case against the account it names, once
 * per case; a move refused when the case names another account than the
 * screen showed; a measure follows the policy's step as it reads now or says
 * why it departs, keeps the step it followed; an import block or a closure is
 * not taken twice while one is in force; a closure is refused up front for an
 * account the block refuses, records the decision before it blocks, takes
 * itself back when the block refuses late, and stands (said so) when the
 * block fails; a lift is once, only while in force, never of a warning, and
 * lifting a closure never unblocks; each move is written to its case's log.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { MemoryDb, Row } from "../../../test/memory-tables.js"

const db = vi.hoisted(() => ({ tables: {} }) as MemoryDb)
const log = vi.hoisted(() => ({ events: [] as Array<[string, string, string, Record<string, unknown>]> }))
const settings = vi.hoisted(() => ({
  policy: {
    windowMonths: 24,
    steps: [
      { infringements: 1, kind: "warning" },
      { infringements: 2, kind: "imports_blocked", days: 30 },
      { infringements: 3, kind: "closed" },
    ],
  } as unknown,
}))
const blocks = vi.hoisted(() => ({
  blockAccount: vi.fn(async (): Promise<Record<string, unknown>> => ({ refused: null, signInBlocked: true, signInError: null })),
  blockRefusal: vi.fn(async (): Promise<string | null> => null),
  isBlockedNow: vi.fn(async () => true),
  alert: vi.fn(async () => true),
}))

vi.mock("../../../lib/supabase.js", async () => {
  const { memorySupabase } = await import("../../../test/memory-tables.js")
  return { supabase: memorySupabase(db) }
})
vi.mock("../../../lib/app-settings.js", () => ({ getAppSettings: async () => ({}) }))
vi.mock("../../../lib/repeat-infringer-policy-store.js", () => ({ currentRepeatInfringerPolicy: async () => settings.policy }))
vi.mock("../../../lib/rights-complaints.js", () => ({
  recordComplaintEventQuietly: vi.fn(async (id: string, kind: string, actor: string, data: Record<string, unknown>) => {
    log.events.push([id, kind, actor, data])
  }),
}))
vi.mock("../block-account.js", () => ({ blockAccount: blocks.blockAccount }))
vi.mock("../account-blocking.js", () => ({
  BLOCK_REFUSAL_MESSAGE: { target_is_admin: "Admins cannot be blocked. Change the role first." },
  blockRefusal: blocks.blockRefusal,
  isBlockedNow: blocks.isBlockedNow,
}))
vi.mock("../repeat-infringer-alerts.js", () => ({ alertPolicyNamesClosure: blocks.alert }))

import { applyMeasure, liftMeasure, recordInfringement, withdrawInfringement, RepeatInfringerError } from "../repeat-infringers.js"

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const OWNER = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"
const CASE = "c0000000-0000-4000-8000-000000000001"
const NOW = new Date("2026-11-03T12:00:00.000Z")
const RECENT = "2026-10-01T00:00:00.000Z"

let ids = 0
const nextId = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`

/** Migration 588's triggers, as far as these moves can meet them. */
function guards(): MemoryDb["guards"] {
  const caseOf = (id: unknown) => db.tables.rights_complaints!.find((r) => r.id === id)
  return {
    account_infringements: ({ kind, row, before }) => {
      if (kind === "insert") {
        const c = caseOf(row.complaint_id)
        if (c && (!c.verified_at || c.user_id !== row.user_id)) return { code: "55028", message: "not supported" }
        const standing = db.tables.account_infringements!.some((r) => r.complaint_id === row.complaint_id && r.user_id === row.user_id && !r.withdrawn_at)
        return standing ? { code: "23505", message: "duplicate key value violates unique constraint" } : null
      }
      return before?.withdrawn_at ? { code: "55000", message: "withdrawn once" } : null
    },
    account_sanctions: ({ kind, row, before }) => {
      if (kind === "insert") {
        const c = row.complaint_id ? caseOf(row.complaint_id) : undefined
        if (c && (!c.verified_at || c.user_id !== row.user_id)) return { code: "55028", message: "not supported" }
        const inForce = db.tables.account_sanctions!.some(
          (s) => row.kind !== "warning" && s.user_id === row.user_id && s.kind === row.kind && !s.lifted_at && (!s.ends_at || String(s.ends_at) > NOW.toISOString()),
        )
        return inForce ? { code: "55029", message: "in force" } : null
      }
      if (before?.lifted_at) return { code: "55000", message: "lifted once" }
      if (row.kind === "warning" || (row.ends_at && String(row.ends_at) <= NOW.toISOString())) return { code: "23514", message: "check" }
      return null
    },
  }
}

function seed(over: Partial<Record<string, Row[]>> = {}) {
  db.tables = {
    rights_complaints: [
      { id: CASE, reference: "CR-2026-000001", user_id: OWNER, verified_at: RECENT },
      { id: "c-unverified", reference: "CR-2026-000002", user_id: OWNER, verified_at: null },
      { id: "c-nobody", reference: "CR-2026-000003", user_id: null, verified_at: RECENT },
    ],
    account_infringements: [],
    account_sanctions: [],
    ...over,
  }
  db.guards = guards()
  db.missingTables = undefined
  db.beforeWrite = undefined
  db.defaults = {
    account_infringements: () => ({ id: nextId(), recorded_at: NOW.toISOString(), withdrawn_at: null, withdraw_reason: null }),
    account_sanctions: () => ({ id: nextId(), applied_at: NOW.toISOString(), lifted_at: null, lift_reason: null }),
  }
}

const infringement = (over: Row = {}): Row => ({ id: nextId(), complaint_id: "c-old", user_id: OWNER, note: null, recorded_at: RECENT, withdrawn_at: null, withdraw_reason: null, ...over })
const measure = (over: Row = {}): Row => ({
  id: nextId(),
  user_id: OWNER,
  kind: "imports_blocked",
  applied_at: RECENT,
  ends_at: null,
  reason: "r",
  note: null,
  complaint_id: CASE,
  infringement_id: null,
  infringements_in_window: 2,
  policy_step: null,
  departure_reason: "d",
  lifted_at: null,
  lift_reason: null,
  ...over,
})
const apply = (over: Record<string, unknown> = {}) =>
  applyMeasure({ complaintId: CASE, userId: OWNER, kind: "warning", days: null, reason: "Told to the owner", note: null, infringementId: null, departureReason: null, ...over } as never, ADMIN, NOW)
const refusal = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as RepeatInfringerError)
const threeStanding = () => ({ account_infringements: [infringement(), infringement(), infringement()] })

beforeEach(() => {
  seed()
  log.events = []
  vi.clearAllMocks()
  blocks.blockAccount.mockImplementation(async () => ({ refused: null, signInBlocked: true, signInError: null }))
  blocks.blockRefusal.mockImplementation(async () => null)
  blocks.isBlockedNow.mockImplementation(async () => true)
})

describe("recordInfringement", () => {
  it("records it against the account the case names, with the note and the administrator, and logs it on the case", async () => {
    const row = await recordInfringement(CASE, OWNER, "The film is theirs", ADMIN)
    expect(row).toMatchObject({ complaint_id: CASE, user_id: OWNER, note: "The film is theirs", withdrawn_at: null })
    expect(db.tables.account_infringements![0]).toMatchObject({ recorded_by: ADMIN })
    expect(log.events).toEqual([[CASE, "infringement_recorded", ADMIN, { infringementId: row.id }]])
  })

  it("refuses an unknown case, a case whose complainant did not prove their email, and a case that names no account", async () => {
    expect(await refusal(recordInfringement("c-missing", OWNER, null, ADMIN))).toMatchObject({ code: "not_found" })
    expect(await refusal(recordInfringement("c-unverified", OWNER, null, ADMIN))).toMatchObject({ code: "unverified" })
    expect(await refusal(recordInfringement("c-nobody", OWNER, null, ADMIN))).toMatchObject({ code: "no_account" })
    expect(db.tables.account_infringements).toEqual([])
  })

  it("refuses when the case names another account than the screen showed", async () => {
    expect(await refusal(recordInfringement(CASE, OTHER, null, ADMIN))).toMatchObject({ code: "case_moved" })
    expect(db.tables.account_infringements).toEqual([])
  })

  it("an account id sent in capitals is the same account", async () => {
    const lettered = "abcdef12-3456-4789-8abc-def012345678"
    seed({ rights_complaints: [{ id: CASE, reference: "CR-2026-000001", user_id: lettered, verified_at: RECENT }] })
    await expect(recordInfringement(CASE, lettered.toUpperCase(), null, ADMIN)).resolves.toMatchObject({ user_id: lettered })
  })

  it("records one per case while it stands", async () => {
    await recordInfringement(CASE, OWNER, null, ADMIN)
    expect(await refusal(recordInfringement(CASE, OWNER, null, ADMIN))).toMatchObject({ code: "already_recorded" })
  })

  it("a case renamed between the read and the write is the database's to refuse", async () => {
    db.beforeWrite = { account_infringements: () => (db.tables.rights_complaints = db.tables.rights_complaints!.map((c) => (c.id === CASE ? { ...c, user_id: OTHER } : c))) }
    expect(await refusal(recordInfringement(CASE, OWNER, null, ADMIN))).toMatchObject({ code: "not_supported", message: expect.stringContaining("read the case again") })
  })

  it("is unavailable while the record is not in the database yet", async () => {
    db.missingTables = new Set(["account_infringements"])
    expect(await refusal(recordInfringement(CASE, OWNER, null, ADMIN))).toMatchObject({ code: "unavailable" })
  })

  it("tells the administrators' Slack once, when the count reaches the closure step, counting standing infringements in the window only", async () => {
    seed({ account_infringements: [infringement(), infringement({ withdrawn_at: RECENT, withdraw_reason: "x" }), infringement({ recorded_at: "2024-10-01T00:00:00.000Z" })] })
    await recordInfringement(CASE, OWNER, null, ADMIN)
    expect(blocks.alert).not.toHaveBeenCalled()
    seed({ account_infringements: [infringement(), infringement()] })
    await recordInfringement(CASE, OWNER, null, ADMIN)
    expect(blocks.alert).toHaveBeenCalledWith("CR-2026-000001", 3, 24)
    blocks.alert.mockClear()
    seed(threeStanding())
    await recordInfringement(CASE, OWNER, null, ADMIN)
    expect(blocks.alert).not.toHaveBeenCalled()
  })

  it("an alert that fails never fails the recording", async () => {
    seed({ account_infringements: [infringement(), infringement()] })
    blocks.alert.mockRejectedValueOnce(new Error("slack down"))
    await expect(recordInfringement(CASE, OWNER, null, ADMIN)).resolves.toMatchObject({ complaint_id: CASE })
  })
})

describe("withdrawInfringement", () => {
  it("withdraws it once, with the reason, logged on its case", async () => {
    const row = infringement({ complaint_id: CASE })
    seed({ account_infringements: [row] })
    const withdrawn = await withdrawInfringement(String(row.id), "Restored after a counter-notice", ADMIN)
    expect(withdrawn).toMatchObject({ id: row.id, withdraw_reason: "Restored after a counter-notice" })
    expect(db.tables.account_infringements![0]).toMatchObject({ withdrawn_by: ADMIN })
    expect(log.events).toEqual([[CASE, "infringement_withdrawn", ADMIN, { infringementId: row.id, reason: "Restored after a counter-notice" }]])
    expect(await refusal(withdrawInfringement(String(row.id), "again", ADMIN))).toMatchObject({ code: "withdrawn" })
  })

  it("refuses an unknown infringement", async () => {
    expect(await refusal(withdrawInfringement("00000000-0000-4000-8000-0000000000ff", "x", ADMIN))).toMatchObject({ code: "not_found" })
  })
})

describe("applyMeasure", () => {
  it("follows the step the policy names for the standing count, and keeps that step as applied", async () => {
    seed({ account_infringements: [infringement()] })
    const { measure: m, block } = await apply()
    expect(block).toBeNull()
    expect(m).toMatchObject({ kind: "warning", ends_at: null, infringements_in_window: 1, policy_step: { infringements: 1, kind: "warning", windowMonths: 24 }, departure_reason: null })
    expect(db.tables.account_sanctions![0]).toMatchObject({ applied_by: ADMIN, complaint_id: CASE, reason: "Told to the owner" })
    expect(log.events).toEqual([[CASE, "measure_applied", ADMIN, { measureId: m.id, kind: "warning", endsAt: null, followsPolicy: true }]])
  })

  it("an import block of the step's length ends that many days from now", async () => {
    seed({ account_infringements: [infringement(), infringement()] })
    const { measure: m } = await apply({ kind: "imports_blocked", days: 30 })
    expect(m).toMatchObject({ ends_at: "2026-12-03T12:00:00.000Z", policy_step: { infringements: 2, kind: "imports_blocked", days: 30, windowMonths: 24 } })
  })

  it("a measure that is not the step's says why, or is refused", async () => {
    seed({ account_infringements: [infringement(), infringement()] })
    expect(await refusal(apply({ kind: "imports_blocked", days: 7 }))).toMatchObject({ code: "departure_required" })
    expect(await refusal(apply({ kind: "warning" }))).toMatchObject({ code: "departure_required" })
    const { measure: m } = await apply({ kind: "imports_blocked", days: 7, departureReason: "A first block, kept short" })
    expect(m).toMatchObject({ policy_step: null, departure_reason: "A first block, kept short", infringements_in_window: 2, ends_at: "2026-11-10T12:00:00.000Z" })
  })

  it("with no infringement standing, the policy names nothing: any measure says why", async () => {
    seed({ account_infringements: [infringement({ withdrawn_at: RECENT, withdraw_reason: "x" })] })
    expect(await refusal(apply())).toMatchObject({ code: "departure_required", message: expect.stringContaining("names no measure for 0") })
    await expect(apply({ departureReason: "A warning before anything is recorded" })).resolves.toBeTruthy()
  })

  it("days are only an import block's", async () => {
    seed({ account_infringements: [infringement()] })
    const { measure: m } = await apply({ days: 30 })
    expect(m.ends_at).toBeNull()
  })

  it("is refused when the case names another account than the screen showed, before anything is written or blocked", async () => {
    seed(threeStanding())
    expect(await refusal(apply({ kind: "closed", userId: OTHER }))).toMatchObject({ code: "case_moved" })
    expect(db.tables.account_sanctions).toEqual([])
    expect(blocks.blockAccount).not.toHaveBeenCalled()
  })

  it("a closure records the decision first, then blocks the account", async () => {
    seed(threeStanding())
    blocks.blockAccount.mockImplementationOnce(async () => {
      expect(db.tables.account_sanctions).toEqual([expect.objectContaining({ kind: "closed", lifted_at: null })])
      return { refused: null, signInBlocked: false, signInError: new Error("auth down") }
    })
    const { measure: m, block } = await apply({ kind: "closed" })
    expect(blocks.blockRefusal).toHaveBeenCalledWith(ADMIN, OWNER)
    expect(blocks.blockAccount).toHaveBeenCalledWith(ADMIN, OWNER, "Closed under the repeat-infringer policy (case CR-2026-000001)")
    expect(m).toMatchObject({ kind: "closed", policy_step: { infringements: 3, kind: "closed", windowMonths: 24 } })
    expect(block).toMatchObject({ placed: true, signInBlocked: false, signInError: expect.any(Error) })
  })

  it("an account the block refuses is refused up front: nothing recorded, nothing blocked", async () => {
    seed(threeStanding())
    blocks.blockRefusal.mockResolvedValueOnce("target_is_admin")
    expect(await refusal(apply({ kind: "closed" }))).toMatchObject({ code: "target_is_admin", message: "Admins cannot be blocked. Change the role first." })
    expect(db.tables.account_sanctions).toEqual([])
    expect(blocks.blockAccount).not.toHaveBeenCalled()
  })

  it("a block refused late (the role changed meanwhile) takes the closure back, lifted with why", async () => {
    seed(threeStanding())
    blocks.blockAccount.mockResolvedValueOnce({ refused: "target_is_admin" })
    const { measure: m, block } = await apply({ kind: "closed" })
    expect(block).toMatchObject({ placed: false, refused: "target_is_admin", lifted: { id: m.id, lift_reason: "The account could not be blocked: Admins cannot be blocked. Change the role first." } })
    expect(db.tables.account_sanctions![0]).toMatchObject({ lifted_by: ADMIN })
    expect(log.events.map((e) => e[1])).toEqual(["measure_applied", "measure_lifted"])
  })

  it("a block that fails leaves the closure standing, and says so", async () => {
    seed(threeStanding())
    blocks.blockAccount.mockRejectedValueOnce(new Error("blocks down"))
    const { measure: m, block } = await apply({ kind: "closed" })
    expect(block).toMatchObject({ placed: false, failure: expect.any(Error) })
    expect(db.tables.account_sanctions).toEqual([expect.objectContaining({ id: m.id, kind: "closed", lifted_at: null })])
  })

  it("a case renamed between the checks and the write is refused by the database: nothing is blocked", async () => {
    seed(threeStanding())
    db.beforeWrite = { account_sanctions: () => (db.tables.rights_complaints = db.tables.rights_complaints!.map((c) => (c.id === CASE ? { ...c, user_id: OTHER } : c))) }
    expect(await refusal(apply({ kind: "closed" }))).toMatchObject({ code: "not_supported" })
    expect(blocks.blockAccount).not.toHaveBeenCalled()
  })

  it("an import block or a closure in force is not taken again, and a closure in force blocks nobody again", async () => {
    seed({ ...threeStanding(), account_sanctions: [measure({ ends_at: "2026-11-20T00:00:00.000Z" }), measure({ kind: "closed" })] })
    expect(await refusal(apply({ kind: "imports_blocked", days: 30, departureReason: "d" }))).toMatchObject({ code: "in_force" })
    expect(await refusal(apply({ kind: "closed" }))).toMatchObject({ code: "in_force" })
    expect(blocks.blockAccount).not.toHaveBeenCalled()
    await expect(apply({ departureReason: "Another warning" })).resolves.toBeTruthy()
  })

  it("one that ended, or was lifted, leaves room for a new one", async () => {
    seed({
      account_infringements: [infringement(), infringement()],
      account_sanctions: [measure({ applied_at: "2026-09-01T00:00:00.000Z", ends_at: "2026-10-01T00:00:00.000Z" }), measure({ lifted_at: RECENT, lift_reason: "x" })],
    })
    await expect(apply({ kind: "imports_blocked", days: 30 })).resolves.toBeTruthy()
  })

  it("two administrators at once: the database refuses the second as in force", async () => {
    seed({ account_infringements: [infringement(), infringement()] })
    db.beforeWrite = { account_sanctions: () => (db.tables.account_sanctions = [measure({})]) }
    expect(await refusal(apply({ kind: "imports_blocked", days: 30 }))).toMatchObject({ code: "in_force" })
  })

  it("follows only a standing infringement of the same account, asked before a closure blocks anyone", async () => {
    const theirs = infringement({ user_id: OTHER })
    const withdrawn = infringement({ withdrawn_at: RECENT, withdraw_reason: "x" })
    seed({ account_infringements: [infringement(), infringement(), infringement(), theirs, withdrawn] })
    expect(await refusal(apply({ kind: "closed", infringementId: theirs.id }))).toMatchObject({ code: "not_supported" })
    expect(await refusal(apply({ kind: "closed", infringementId: withdrawn.id }))).toMatchObject({ code: "not_supported" })
    expect(await refusal(apply({ kind: "closed", infringementId: "00000000-0000-4000-8000-0000000000ff" }))).toMatchObject({ code: "not_supported" })
    expect(blocks.blockAccount).not.toHaveBeenCalled()
  })

  it("is taken from a verified case that names the account", async () => {
    expect(await refusal(apply({ complaintId: "c-unverified" }))).toMatchObject({ code: "unverified" })
    expect(await refusal(apply({ complaintId: "c-nobody" }))).toMatchObject({ code: "no_account" })
    expect(await refusal(apply({ complaintId: "c-missing" }))).toMatchObject({ code: "not_found" })
  })
})

describe("liftMeasure", () => {
  it("lifts an import block in force once, with the reason, logged on its case", async () => {
    const block = measure({ ends_at: "2026-11-20T00:00:00.000Z" })
    seed({ account_sanctions: [block] })
    const lifted = await liftMeasure(String(block.id), "Appeal upheld", ADMIN)
    expect(lifted).toMatchObject({ measure: { id: block.id, lift_reason: "Appeal upheld" }, stillBlocked: null })
    expect(db.tables.account_sanctions![0]).toMatchObject({ lifted_by: ADMIN })
    expect(log.events).toEqual([[CASE, "measure_lifted", ADMIN, { measureId: block.id, kind: "imports_blocked", reason: "Appeal upheld" }]])
    expect(await refusal(liftMeasure(String(block.id), "again", ADMIN))).toMatchObject({ code: "lifted" })
  })

  it("lifting a closure records the reversal and never unblocks: it says whether the account is still blocked", async () => {
    const closure = measure({ kind: "closed" })
    seed({ account_sanctions: [closure] })
    const lifted = await liftMeasure(String(closure.id), "Closed in error", ADMIN)
    expect(lifted.stillBlocked).toBe(true)
    expect(blocks.isBlockedNow).toHaveBeenCalledWith(OWNER)
    expect(blocks.blockAccount).not.toHaveBeenCalled()
  })

  it("a block that cannot be read after the lift is unknown, and the lift still answers", async () => {
    const closure = measure({ kind: "closed" })
    seed({ account_sanctions: [closure] })
    blocks.isBlockedNow.mockRejectedValueOnce(new Error("blocks down"))
    await expect(liftMeasure(String(closure.id), "Closed in error", ADMIN)).resolves.toMatchObject({ stillBlocked: null, measure: { lift_reason: "Closed in error" } })
  })

  it("a warning stands; a measure that ended is not lifted after the fact; an unknown one is not found", async () => {
    const warning = measure({ kind: "warning" })
    const ended = measure({ ends_at: "2026-11-01T00:00:00.000Z" })
    seed({ account_sanctions: [warning, ended] })
    expect(await refusal(liftMeasure(String(warning.id), "x", ADMIN))).toMatchObject({ code: "warning_stands" })
    expect(await refusal(liftMeasure(String(ended.id), "x", ADMIN))).toMatchObject({ code: "ended" })
    expect(await refusal(liftMeasure("00000000-0000-4000-8000-0000000000ff", "x", ADMIN))).toMatchObject({ code: "not_found" })
    expect(log.events).toEqual([])
  })

  it("a measure taken from no case logs on no case", async () => {
    const block = measure({ complaint_id: null })
    seed({ account_sanctions: [block] })
    await liftMeasure(String(block.id), "x", ADMIN)
    expect(log.events).toEqual([])
  })
})
