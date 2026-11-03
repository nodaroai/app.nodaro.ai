/**
 * The measures in force on an account (lib/account-measures.ts) over an
 * in-memory store: the import gate's question (an import block in force, or
 * a closure, refuses; one that ended or was lifted does not; a missing table
 * is nothing in force; a failed read is never a pass), and the owner's view
 * (what is in force, the warnings and infringements in the policy's window,
 * never the administrator's note).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { MemoryDb } from "../../test/memory-tables.js"

const db = vi.hoisted(() => ({ tables: {} }) as MemoryDb)
const settings = vi.hoisted(() => ({ policy: { windowMonths: 24, steps: [{ infringements: 1, kind: "warning" }] } as unknown }))

vi.mock("../supabase.js", async () => {
  const { memorySupabase } = await import("../../test/memory-tables.js")
  return { supabase: memorySupabase(db) }
})
vi.mock("../app-settings.js", () => ({ getAppSettings: async () => ({ rights_repeat_infringer_policy: settings.policy }) }))

import { assertImportsAllowed, inForceAt, myAccountStanding } from "../account-measures.js"
import { AccountMeasureError } from "../account-measure-error.js"

const ME = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"
const NOW = new Date("2026-11-03T12:00:00.000Z")

function measure(over: Record<string, unknown>) {
  return { id: `m-${Math.random()}`, user_id: ME, kind: "imports_blocked", reason: "Repeated complaints", note: "admin only", applied_at: "2026-10-01T00:00:00.000Z", ends_at: null, lifted_at: null, ...over }
}

beforeEach(() => {
  db.tables = { account_sanctions: [], account_infringements: [], rights_complaints: [] }
  db.failReads = undefined
  db.missingTables = undefined
  settings.policy = { windowMonths: 24, steps: [{ infringements: 1, kind: "warning" }] }
})

describe("inForceAt", () => {
  it("is in force while not lifted and before its end, if it has one", () => {
    expect(inForceAt({ lifted_at: null, ends_at: null }, NOW)).toBe(true)
    expect(inForceAt({ lifted_at: null, ends_at: "2026-11-03T12:00:00.001Z" }, NOW)).toBe(true)
    expect(inForceAt({ lifted_at: null, ends_at: "2026-11-03T12:00:00.000Z" }, NOW)).toBe(false)
    expect(inForceAt({ lifted_at: "2026-10-02T00:00:00.000Z", ends_at: null }, NOW)).toBe(false)
  })
})

describe("assertImportsAllowed", () => {
  it("lets an account with nothing in force import", async () => {
    db.tables.account_sanctions = [
      measure({ kind: "warning" }),
      measure({ ends_at: "2026-11-01T00:00:00.000Z" }),
      measure({ lifted_at: "2026-10-05T00:00:00.000Z" }),
      measure({ user_id: OTHER }),
      measure({ user_id: OTHER, kind: "closed" }),
    ]
    await expect(assertImportsAllowed(ME, NOW)).resolves.toBeUndefined()
  })

  it("refuses while an import block is in force, saying until when", async () => {
    db.tables.account_sanctions = [measure({ ends_at: "2026-12-03T10:00:00.000Z" })]
    const refusal = await assertImportsAllowed(ME, NOW).catch((e: unknown) => e)
    expect(refusal).toBeInstanceOf(AccountMeasureError)
    expect(refusal).toMatchObject({ code: "imports_blocked", endsAt: "2026-12-03T10:00:00.000Z", closed: false, deterministic: true })
    expect((refusal as Error).message).toBe("Importing links is blocked on this account until 2026-12-03 (UTC). Content restrictions in your settings says why.")
  })

  it("an import block until lifted says so", async () => {
    db.tables.account_sanctions = [measure({})]
    await expect(assertImportsAllowed(ME, NOW)).rejects.toMatchObject({
      endsAt: null,
      message: "Importing links is blocked on this account until an administrator lifts the block. Content restrictions in your settings says why.",
    })
  })

  it("asks the latest block not lifted, so however long the record, the one in force is found", async () => {
    const ended = Array.from({ length: 250 }, (_, i) => {
      const day = new Date(Date.UTC(2025, 0, 1) + i * 86_400_000)
      return measure({ applied_at: day.toISOString(), ends_at: new Date(day.getTime() + 3_600_000).toISOString() })
    })
    db.tables.account_sanctions = [...ended, measure({ applied_at: "2026-10-20T00:00:00.000Z", ends_at: "2026-12-01T00:00:00.000Z" }), ...ended.slice(0, 5)]
    await expect(assertImportsAllowed(ME, NOW)).rejects.toMatchObject({ endsAt: "2026-12-01T00:00:00.000Z" })
    db.tables.account_sanctions = [...ended, measure({ applied_at: "2026-10-20T00:00:00.000Z", lifted_at: "2026-10-21T00:00:00.000Z" })]
    await expect(assertImportsAllowed(ME, NOW)).resolves.toBeUndefined()
  })

  it("refuses a closed account, whatever else is in force", async () => {
    db.tables.account_sanctions = [measure({ ends_at: "2026-12-01T00:00:00.000Z" }), measure({ kind: "closed" })]
    await expect(assertImportsAllowed(ME, NOW)).rejects.toMatchObject({ code: "imports_blocked", closed: true, endsAt: null, message: "This account is closed, so it cannot import links." })
  })

  it("a closure that was lifted refuses nothing", async () => {
    db.tables.account_sanctions = [measure({ kind: "closed", lifted_at: "2026-10-09T00:00:00.000Z" })]
    await expect(assertImportsAllowed(ME, NOW)).resolves.toBeUndefined()
  })

  it("nothing is in force while the table does not exist yet", async () => {
    db.missingTables = new Set(["account_sanctions"])
    await expect(assertImportsAllowed(ME, NOW)).resolves.toBeUndefined()
  })

  it("a read that failed fails the import, and is not a refusal of the gate", async () => {
    db.failReads = new Set(["account_sanctions"])
    const failure = await assertImportsAllowed(ME, NOW).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(Error)
    expect(failure).not.toBeInstanceOf(AccountMeasureError)
    expect((failure as Error).message).toContain("Account measures read failed")
  })
})

describe("myAccountStanding", () => {
  it("answers what is in force, the warnings and the infringements within the window, with each case's reference", async () => {
    db.tables.account_sanctions = [
      measure({ id: "block", applied_at: "2026-10-20T00:00:00.000Z", ends_at: "2026-11-19T00:00:00.000Z" }),
      measure({ id: "old-block", applied_at: "2026-01-01T00:00:00.000Z", ends_at: "2026-01-31T00:00:00.000Z" }),
      measure({ id: "warn", kind: "warning", reason: "A first warning", applied_at: "2026-09-01T00:00:00.000Z" }),
      measure({ id: "stale-warn", kind: "warning", applied_at: "2024-10-01T00:00:00.000Z" }),
      measure({ id: "someone", user_id: OTHER, kind: "closed" }),
    ]
    db.tables.account_infringements = [
      { id: "i1", user_id: ME, complaint_id: "c1", recorded_at: "2026-10-19T00:00:00.000Z", withdrawn_at: null },
      { id: "i2", user_id: ME, complaint_id: "c2", recorded_at: "2026-08-19T00:00:00.000Z", withdrawn_at: "2026-09-01T00:00:00.000Z" },
      { id: "i3", user_id: ME, complaint_id: "c3", recorded_at: "2024-01-01T00:00:00.000Z", withdrawn_at: null },
      { id: "i4", user_id: OTHER, complaint_id: "c1", recorded_at: "2026-10-19T00:00:00.000Z", withdrawn_at: null },
    ]
    db.tables.rights_complaints = [{ id: "c1", reference: "CR-2026-000001" }]
    const standing = await myAccountStanding(ME, NOW)
    expect(standing).toEqual({
      inForce: [{ kind: "imports_blocked", reason: "Repeated complaints", appliedAt: "2026-10-20T00:00:00.000Z", endsAt: "2026-11-19T00:00:00.000Z" }],
      warnings: [{ kind: "warning", reason: "A first warning", appliedAt: "2026-09-01T00:00:00.000Z", endsAt: null }],
      infringements: [{ caseReference: "CR-2026-000001", recordedAt: "2026-10-19T00:00:00.000Z" }],
      windowMonths: 24,
    })
    expect(JSON.stringify(standing)).not.toContain("admin only")
  })

  it("counts over the window the policy reads now", async () => {
    settings.policy = { windowMonths: 1, steps: [{ infringements: 1, kind: "warning" }] }
    db.tables.account_sanctions = [measure({ kind: "warning", applied_at: "2026-09-01T00:00:00.000Z" })]
    db.tables.account_infringements = [{ id: "i1", user_id: ME, complaint_id: "c9", recorded_at: "2026-10-04T00:00:00.000Z", withdrawn_at: null }]
    const standing = await myAccountStanding(ME, NOW)
    expect(standing.warnings).toEqual([])
    expect(standing.infringements).toEqual([{ caseReference: null, recordedAt: "2026-10-04T00:00:00.000Z" }])
    expect(standing.windowMonths).toBe(1)
  })

  it("is empty while the tables do not exist yet", async () => {
    db.missingTables = new Set(["account_sanctions", "account_infringements"])
    await expect(myAccountStanding(ME, NOW)).resolves.toEqual({ inForce: [], warnings: [], infringements: [], windowMonths: 24 })
  })

  it("a failed read is an error, not an empty record", async () => {
    db.failReads = new Set(["account_infringements"])
    await expect(myAccountStanding(ME, NOW)).rejects.toThrow("Account infringements read failed")
  })
})
