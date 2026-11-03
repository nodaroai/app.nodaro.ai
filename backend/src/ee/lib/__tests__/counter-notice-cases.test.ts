/**
 * The handler's steps on a counter-notice (ee/lib/counter-notice-cases.ts)
 * over an in-memory store whose lift behaves as migration 587's does (it
 * settles the counter-notice in the same transaction, and a court action not
 * yet ended refuses it): each step once; a court action moves the case to
 * awaiting_legal_action and holds the content until it is recorded as ended;
 * a declined counter-notice restores nothing; a restore is refused while
 * anything holds it back, in the order the screen shows, and otherwise lifts
 * the restriction with the counter-notice's reference and moves the case on
 * only once every counter-notice on it is settled; the case view opens the
 * sender's details and the notes, and says where the window stands and what
 * holds a restore back.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { MemoryDb, Row } from "../../../test/memory-tables.js"

const db = vi.hoisted(() => ({ tables: {}, beforeWrite: {}, onUpdate: {} }) as MemoryDb)
const log = vi.hoisted(() => ({
  events: [] as Array<[string, string, string, Record<string, unknown>]>,
  lifts: [] as Array<[string, Record<string, unknown>]>,
  liftLosesTheRace: false,
}))

vi.mock("../../../lib/supabase.js", async () => {
  const { memorySupabase } = await import("../../../test/memory-tables.js")
  return { supabase: memorySupabase(db) }
})
vi.mock("../../../lib/rights-complaints.js", async () => ({
  ...(await vi.importActual<typeof import("../../../lib/rights-complaints.js")>("../../../lib/rights-complaints.js")),
  recordComplaintEventQuietly: vi.fn(async (id: string, kind: string, actor: string, data: Record<string, unknown>) => {
    log.events.push([id, kind, actor, data])
  }),
}))
vi.mock("../../../lib/counter-notices.js", () => {
  // The sender's details "open" to what follows "enc:"; a sealed note opens only on its own row and column. Their cipher has a test of its own.
  const open = (v: unknown) => (typeof v === "string" && v.startsWith("enc:") ? v.slice(4) : null)
  const columns = ["name_enc", "email_enc", "address_enc", "phone_enc", "signature_enc"] as const
  return {
    openCounterNotice: (row: Record<string, unknown>) => ({
      name: open(row.name_enc),
      email: open(row.email_enc),
      address: open(row.address_enc),
      phone: open(row.phone_enc),
      signature: open(row.signature_enc),
      unreadable: columns.filter((c) => typeof row[c] === "string" && !String(row[c]).startsWith("enc:")),
    }),
    sealCounterNoticeField: (id: string, column: string, value: string) => `sealed:${id}:${column}:${value}`,
    openCounterNoticeField: (id: string, column: string, value: string | null | undefined) => {
      if (!value) return { value: null, failed: false }
      const prefix = `sealed:${id}:${column}:`
      return value.startsWith(prefix) ? { value: value.slice(prefix.length), failed: false } : { value: null, failed: true }
    },
  }
})
vi.mock("../../../lib/content-restrictions.js", async () => {
  const real = await vi.importActual<typeof import("../../../lib/content-restrictions.js")>("../../../lib/content-restrictions.js")
  return {
    ...real,
    // Migration 587's lift_content_restriction: a court action not ended refuses it; it settles the counter-notice.
    liftRestriction: vi.fn(async (id: string, input: { reason: string | null; adminUserId: string | null }) => {
      log.lifts.push([id, input])
      const row = db.tables.content_restrictions!.find((r) => r.id === id)
      if (!row || row.lifted_at || log.liftLosesTheRace) throw new real.ContentRestrictionError("already_lifted", "The restriction was lifted before")
      const notice = db.tables.rights_counter_notices!.find((n) => n.restriction_id === id)
      if (notice && !notice.restored_at && notice.court_action_at && !notice.court_action_ended_at) {
        throw new real.ContentRestrictionError("court_action", "A court action holds the content")
      }
      db.tables.content_restrictions = db.tables.content_restrictions!.map((r) => (r.id === id ? { ...r, lifted_at: "now" } : r))
      db.tables.rights_counter_notices = db.tables.rights_counter_notices!.map((n) =>
        n.restriction_id === id && !n.restored_at ? { ...n, restored_at: "now", restored_by: input.adminUserId } : n,
      )
      return { id, assetId: "a-1", jobId: null, liftedAt: "now" }
    }),
  }
})

import {
  counterNoticesOfCase,
  declineCounterNotice,
  markCounterNoticeForwarded,
  recordCourtAction,
  recordCourtActionEnded,
  restoreFromCounterNotice,
} from "../counter-notice-cases.js"

const ADMIN = "admin-1"
/** New York: Tuesday 8 December 2026 (before the window), Wednesday 9 (its first day), Monday 14 (past it). */
const BEFORE = new Date("2026-12-08T17:00:00Z")
const OPENS = new Date("2026-12-09T17:00:00Z")
const LATE = new Date("2026-12-14T17:00:00Z")

const notice = (over: Row = {}): Row => ({
  id: "n-1",
  reference: "CN-2026-000001",
  complaint_id: "c-1",
  restriction_id: "r-1",
  name_enc: "enc:Sam Owner",
  email_enc: "enc:sam@example.test",
  address_enc: "enc:1 Road",
  phone_enc: "enc:555",
  signature_enc: "enc:Sam",
  content_identification: "my-clip.mp4",
  location_before: "https://cdn.example.test/uploads/my-clip.mp4",
  received_at: "2026-11-24T02:00:00Z",
  window_opens_on: "2026-12-09",
  window_closes_on: "2026-12-11",
  forwarded_at: "2026-11-24T10:00:00Z",
  forwarded_by: ADMIN,
  court_action_at: null,
  court_action_by: null,
  court_action_note_enc: null,
  court_action_ended_at: null,
  court_action_ended_by: null,
  court_action_ended_note_enc: null,
  declined_at: null,
  declined_by: null,
  declined_reason: null,
  restored_at: null,
  restored_by: null,
  ...over,
})

const caseRow = () => db.tables.rights_complaints!.find((r) => r.id === "c-1")!
const noticeRow = (id = "n-1") => db.tables.rights_counter_notices!.find((r) => r.id === id)!
const setNotice = (patch: Row) => {
  db.tables.rights_counter_notices = db.tables.rights_counter_notices!.map((n) => (n.id === "n-1" ? { ...n, ...patch } : n))
}
const addRestriction = (row: Row) => {
  db.tables.content_restrictions = [...db.tables.content_restrictions!, row]
}
const addCase = (row: Row) => {
  db.tables.rights_complaints = [...db.tables.rights_complaints!, row]
}

beforeEach(() => {
  db.tables = {
    rights_counter_notices: [notice()],
    content_restrictions: [
      { id: "r-1", complaint_id: "c-1", r2_keys: ["uploads/my-clip.mp4"], content_hash: "h-1", asset_ids: ["a-1"], lifted_at: null },
      { id: "r-old", complaint_id: "c-9", r2_keys: ["uploads/my-clip.mp4"], content_hash: "h-1", asset_ids: ["a-1"], lifted_at: "2026-10-01T00:00:00Z" },
    ],
    rights_complaints: [{ id: "c-1", reference: "CR-2026-000001", status: "counter_notice_received", verified_at: "2026-11-01T00:00:00Z", matched_asset_ids: ["a-1"], updated_at: "u-1" }],
  }
  db.beforeWrite = {}
  let stamp = 0
  db.onUpdate = { rights_complaints: () => ({ updated_at: `stamp-${++stamp}` }) }
  log.events = []
  log.lifts = []
  log.liftLosesTheRace = false
})

describe("the case view", () => {
  it("opens the sender's details, dates the receipt in New York, and says where the window stands", async () => {
    const [n] = await counterNoticesOfCase("c-1", BEFORE)
    expect(n).toMatchObject({
      reference: "CN-2026-000001",
      name: "Sam Owner",
      email: "sam@example.test",
      unreadable: [],
      // 02:00 UTC on the 24th is still the 23rd in New York.
      receivedOn: "2026-11-23",
      opensOn: "2026-12-09",
      closesOn: "2026-12-11",
      position: "before",
      restrictionLiftedAt: null,
      otherRestrictionIds: [],
      otherCaseReferences: [],
    })
    expect((await counterNoticesOfCase("c-1", OPENS))[0]!.position).toBe("open")
    expect((await counterNoticesOfCase("c-1", LATE))[0]!.position).toBe("after")
    expect(await counterNoticesOfCase("c-none", OPENS)).toEqual([])
  })

  it("names what would hold a restore back: another case's restriction (by key or hash) and another open case; never the case's own", async () => {
    addRestriction({ id: "r-key", complaint_id: "c-2", r2_keys: ["uploads/my-clip.mp4"], content_hash: null, asset_ids: [], lifted_at: null })
    addRestriction({ id: "r-hash", complaint_id: null, r2_keys: ["elsewhere.mp4"], content_hash: "h-1", asset_ids: [], lifted_at: null })
    addRestriction({ id: "r-same-case", complaint_id: "c-1", r2_keys: ["uploads/my-clip.mp4"], content_hash: "h-1", asset_ids: ["a-1"], lifted_at: null })
    addCase({ id: "c-3", reference: "CR-2026-000003", status: "under_review", verified_at: "2026-11-02T00:00:00Z", matched_asset_ids: ["a-1"] })
    addCase({ id: "c-4", reference: "CR-2026-000004", status: "under_review", verified_at: null, matched_asset_ids: ["a-1"] })
    addCase({ id: "c-5", reference: "CR-2026-000005", status: "closed", verified_at: "2026-11-02T00:00:00Z", matched_asset_ids: ["a-1"] })
    const [n] = await counterNoticesOfCase("c-1", OPENS)
    expect([...n!.otherRestrictionIds].sort()).toEqual(["r-hash", "r-key"])
    expect(n!.otherCaseReferences).toEqual(["CR-2026-000003"])
  })

  it("a storage key with a comma still finds the restriction on it", async () => {
    db.tables.content_restrictions = db.tables.content_restrictions!.map((r) => (r.id === "r-1" ? { ...r, r2_keys: ["uploads/a,b.mp4"], content_hash: null } : r))
    addRestriction({ id: "r-comma", complaint_id: "c-2", r2_keys: ["uploads/a,b.mp4"], content_hash: null, asset_ids: [], lifted_at: null })
    addRestriction({ id: "r-split", complaint_id: "c-2", r2_keys: ["uploads/a"], content_hash: null, asset_ids: [], lifted_at: null })
    const [n] = await counterNoticesOfCase("c-1", OPENS)
    expect(n!.otherRestrictionIds).toEqual(["r-comma"])
  })

  it("a decided counter-notice, or a lifted restriction, carries no blockers", async () => {
    addRestriction({ id: "r-key", complaint_id: "c-2", r2_keys: ["uploads/my-clip.mp4"], content_hash: null, asset_ids: [], lifted_at: null })
    setNotice({ declined_at: "2026-12-01T00:00:00Z", declined_by: ADMIN, declined_reason: "No address." })
    expect((await counterNoticesOfCase("c-1", OPENS))[0]!.otherRestrictionIds).toEqual([])
    setNotice({ declined_at: null, declined_by: null, declined_reason: null })
    db.tables.content_restrictions = db.tables.content_restrictions!.map((r) => (r.id === "r-1" ? { ...r, lifted_at: "2026-12-02T00:00:00Z" } : r))
    const [n] = await counterNoticesOfCase("c-1", OPENS)
    expect(n).toMatchObject({ otherRestrictionIds: [], restrictionLiftedAt: "2026-12-02T00:00:00Z" })
  })

  it("a detail that cannot be read is named, never hiding the others; the notes open on their own row only", async () => {
    setNotice({
      phone_enc: "damaged",
      court_action_at: "2026-12-01T00:00:00Z",
      court_action_note_enc: "sealed:n-1:court_action_note_enc:District Court, 1:26-cv-1",
      court_action_ended_at: "2026-12-05T00:00:00Z",
      court_action_ended_note_enc: "sealed:n-2:court_action_ended_note_enc:moved from another row",
    })
    const [n] = await counterNoticesOfCase("c-1", OPENS)
    expect(n).toMatchObject({
      phone: null,
      email: "sam@example.test",
      courtActionNote: "District Court, 1:26-cv-1",
      courtActionEndedNote: null,
      unreadable: ["phone", "courtActionEndedNote"],
    })
  })
})

describe("forwarding", () => {
  it("is recorded once, on the case's log; not for a declined counter-notice", async () => {
    setNotice({ forwarded_at: null, forwarded_by: null })
    await markCounterNoticeForwarded("n-1", ADMIN)
    expect(noticeRow()).toMatchObject({ forwarded_by: ADMIN })
    expect(noticeRow().forwarded_at).toBeTruthy()
    await expect(markCounterNoticeForwarded("n-1", "admin-2")).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("already") })
    await expect(markCounterNoticeForwarded("nope", ADMIN)).rejects.toMatchObject({ code: "not_found" })
    expect(log.events).toEqual([["c-1", "counter_notice_forwarded", ADMIN, { reference: "CN-2026-000001" }]])
    db.tables.rights_counter_notices = [notice({ id: "n-1", forwarded_at: null, forwarded_by: null, declined_at: "2026-12-01T00:00:00Z", declined_reason: "No address." })]
    await expect(markCounterNoticeForwarded("n-1", ADMIN)).rejects.toMatchObject({ code: "conflict", message: "The counter-notice was declined" })
  })
})

describe("a court action", () => {
  it("is recorded once, its note sealed to the row, and moves the case to awaiting_legal_action", async () => {
    await recordCourtAction("n-1", "District Court, 1:26-cv-1", ADMIN)
    expect(noticeRow()).toMatchObject({ court_action_by: ADMIN, court_action_note_enc: "sealed:n-1:court_action_note_enc:District Court, 1:26-cv-1" })
    expect(caseRow().status).toBe("awaiting_legal_action")
    expect(log.events).toEqual([
      ["c-1", "court_action_received", ADMIN, { reference: "CN-2026-000001", note: true }],
      ["c-1", "status_changed", ADMIN, { from: "counter_notice_received", to: "awaiting_legal_action" }],
    ])
    await expect(recordCourtAction("n-1", null, ADMIN)).rejects.toMatchObject({ code: "conflict", message: "A court action was recorded already" })
  })

  it("holds the content: no restore, here or by the lift itself, until it is recorded as ended", async () => {
    await recordCourtAction("n-1", null, ADMIN)
    await expect(restoreFromCounterNotice("n-1", ADMIN, OPENS)).rejects.toMatchObject({ code: "invalid_move", message: expect.stringContaining("court action") })
    expect(log.lifts).toEqual([])
  })

  it("is refused once the content is restored, or the counter-notice declined", async () => {
    setNotice({ restored_at: "2026-12-09T18:00:00Z", restored_by: ADMIN })
    await expect(recordCourtAction("n-1", null, ADMIN)).rejects.toMatchObject({ code: "conflict", message: "The content was restored already" })
    setNotice({ restored_at: null, restored_by: null, declined_at: "2026-12-01T00:00:00Z", declined_reason: "No address." })
    await expect(recordCourtAction("n-1", null, ADMIN)).rejects.toMatchObject({ code: "conflict", message: "The counter-notice was declined" })
  })

  it("moves a case whose content was restored on another counter-notice, but never a closed one", async () => {
    db.tables.rights_complaints = [{ ...caseRow(), status: "content_restored" }]
    await recordCourtAction("n-1", null, ADMIN)
    expect(caseRow().status).toBe("awaiting_legal_action")
    db.tables.rights_counter_notices = [notice()]
    db.tables.rights_complaints = [{ ...caseRow(), status: "closed" }]
    await recordCourtAction("n-1", null, ADMIN)
    expect(caseRow().status).toBe("closed")
  })
})

describe("the end of a court action", () => {
  it("needs a court action, is recorded once with its note sealed, and lets the content be restored, window or not", async () => {
    await expect(recordCourtActionEnded("n-1", null, ADMIN)).rejects.toMatchObject({ code: "invalid_move" })
    await recordCourtAction("n-1", null, ADMIN)
    await recordCourtActionEnded("n-1", "Dismissed", ADMIN)
    expect(noticeRow()).toMatchObject({ court_action_ended_by: ADMIN, court_action_ended_note_enc: "sealed:n-1:court_action_ended_note_enc:Dismissed" })
    expect(log.events.at(-1)).toEqual(["c-1", "court_action_ended", ADMIN, { reference: "CN-2026-000001", note: true }])
    await expect(recordCourtActionEnded("n-1", null, ADMIN)).rejects.toMatchObject({ code: "conflict" })
    await expect(restoreFromCounterNotice("n-1", ADMIN, BEFORE)).resolves.toMatchObject({ reference: "CN-2026-000001" })
  })
})

describe("declining", () => {
  it("is recorded once with its reason, and restores nothing", async () => {
    await declineCounterNotice("n-1", "No physical address was given.", ADMIN)
    expect(noticeRow()).toMatchObject({ declined_by: ADMIN, declined_reason: "No physical address was given." })
    expect(log.events).toEqual([["c-1", "counter_notice_declined", ADMIN, { reference: "CN-2026-000001" }]])
    await expect(declineCounterNotice("n-1", "Again.", ADMIN)).rejects.toMatchObject({ code: "conflict" })
    await expect(restoreFromCounterNotice("n-1", ADMIN, OPENS)).rejects.toMatchObject({ code: "invalid_move", message: expect.stringContaining("declined") })
    expect(log.lifts).toEqual([])
  })

  it("is refused after a court action or a restore", async () => {
    setNotice({ court_action_at: "2026-12-01T00:00:00Z", court_action_by: ADMIN })
    await expect(declineCounterNotice("n-1", "Late.", ADMIN)).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("court action") })
    setNotice({ court_action_at: null, court_action_by: null, restored_at: "2026-12-09T18:00:00Z" })
    await expect(declineCounterNotice("n-1", "Late.", ADMIN)).rejects.toMatchObject({ code: "conflict", message: "The content was restored already" })
  })
})

describe("restoring", () => {
  it("waits for the counter-notice to be sent to the complainant", async () => {
    setNotice({ forwarded_at: null, forwarded_by: null })
    await expect(restoreFromCounterNotice("n-1", ADMIN, OPENS)).rejects.toMatchObject({ code: "invalid_move", message: expect.stringContaining("Send the counter-notice") })
    expect(log.lifts).toEqual([])
  })

  it("waits for the window to open", async () => {
    await expect(restoreFromCounterNotice("n-1", ADMIN, BEFORE)).rejects.toMatchObject({ code: "invalid_move", message: expect.stringContaining("2026-12-09") })
    expect(log.lifts).toEqual([])
  })

  it("is refused on a closed case", async () => {
    db.tables.rights_complaints = [{ ...caseRow(), status: "closed" }]
    await expect(restoreFromCounterNotice("n-1", ADMIN, OPENS)).rejects.toMatchObject({ code: "invalid_move", message: expect.stringContaining("closed") })
    expect(log.lifts).toEqual([])
  })

  it("waits for another case's restriction on the same content, by key or by hash; the case's own and a lifted one do not count", async () => {
    addRestriction({ id: "r-same-case", complaint_id: "c-1", r2_keys: ["uploads/my-clip.mp4"], content_hash: "h-1", asset_ids: ["a-1"], lifted_at: null })
    await expect(restoreFromCounterNotice("n-1", ADMIN, OPENS)).resolves.toMatchObject({ reference: "CN-2026-000001" })
    db.tables.rights_counter_notices = [notice()]
    db.tables.content_restrictions = db.tables.content_restrictions!.map((r) => (r.id === "r-1" ? { ...r, lifted_at: null } : r))
    addRestriction({ id: "r-hash", complaint_id: "c-2", r2_keys: ["elsewhere.mp4"], content_hash: "h-1", asset_ids: [], lifted_at: null })
    log.lifts = []
    await expect(restoreFromCounterNotice("n-1", ADMIN, OPENS)).rejects.toMatchObject({ code: "invalid_move", message: expect.stringContaining("r-hash") })
    expect(log.lifts).toEqual([])
  })

  it("waits for another open, verified case about the same content", async () => {
    addCase({ id: "c-3", reference: "CR-2026-000003", status: "under_review", verified_at: "2026-11-02T00:00:00Z", matched_asset_ids: ["a-1", "a-7"] })
    await expect(restoreFromCounterNotice("n-1", ADMIN, OPENS)).rejects.toMatchObject({ code: "invalid_move", message: expect.stringContaining("CR-2026-000003") })
    expect(log.lifts).toEqual([])
  })

  it("inside the window, lifts the restriction with the counter-notice's reference; the lift settles it; the case moves on without closing", async () => {
    const step = await restoreFromCounterNotice("n-1", ADMIN, OPENS)
    expect(step).toMatchObject({ id: "n-1", reference: "CN-2026-000001", complaintId: "c-1" })
    expect(log.lifts).toEqual([["r-1", { reason: "Restored after counter-notice CN-2026-000001", adminUserId: ADMIN }]])
    expect(noticeRow()).toMatchObject({ restored_by: ADMIN })
    expect(caseRow().status).toBe("content_restored")
    expect(log.events).toEqual([
      ["c-1", "content_restored", ADMIN, { reference: "CN-2026-000001", restrictionId: "r-1" }],
      ["c-1", "status_changed", ADMIN, { from: "counter_notice_received", to: "content_restored" }],
    ])
    await expect(restoreFromCounterNotice("n-1", ADMIN, OPENS)).rejects.toMatchObject({ code: "conflict" })
  })

  it("leaves the case where it is while another counter-notice on it is still undecided", async () => {
    addRestriction({ id: "r-2", complaint_id: "c-1", r2_keys: ["uploads/other.mp4"], content_hash: null, asset_ids: [], lifted_at: null })
    db.tables.rights_counter_notices = [...db.tables.rights_counter_notices!, notice({ id: "n-2", reference: "CN-2026-000002", restriction_id: "r-2" })]
    await restoreFromCounterNotice("n-1", ADMIN, OPENS)
    expect(caseRow().status).toBe("counter_notice_received")
    expect(log.events.map((e) => e[1])).toEqual(["content_restored"])
  })

  it("past the window's last day it is still allowed: late is better than never", async () => {
    await expect(restoreFromCounterNotice("n-1", ADMIN, LATE)).resolves.toMatchObject({ reference: "CN-2026-000001" })
  })

  it("a restriction read as lifted is a conflict, and nothing is recorded", async () => {
    db.tables.content_restrictions = db.tables.content_restrictions!.map((r) => (r.id === "r-1" ? { ...r, lifted_at: "earlier" } : r))
    await expect(restoreFromCounterNotice("n-1", ADMIN, OPENS)).rejects.toMatchObject({ code: "conflict" })
    expect(log.lifts).toEqual([])
    expect(log.events).toEqual([])
  })

  it("a lift that loses the race to another lift is a conflict, and nothing is recorded", async () => {
    log.liftLosesTheRace = true
    await expect(restoreFromCounterNotice("n-1", ADMIN, OPENS)).rejects.toMatchObject({ code: "conflict", message: "The restriction was lifted already" })
    expect(log.lifts).toHaveLength(1)
    expect(log.events).toEqual([])
  })

  it("a court action recorded between the read and the lift wins: the lift refuses, and nothing is recorded", async () => {
    const { liftRestriction, ContentRestrictionError } = await import("../../../lib/content-restrictions.js")
    // The court action lands after the restore read the counter-notice, before the lift: the lift (migration 587) refuses.
    vi.mocked(liftRestriction).mockImplementationOnce(async () => {
      throw new ContentRestrictionError("court_action", "A court action holds the content")
    })
    await expect(restoreFromCounterNotice("n-1", ADMIN, OPENS)).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("court action was recorded meanwhile") })
    expect(noticeRow().restored_at).toBeNull()
    expect(log.events).toEqual([])
  })
})
