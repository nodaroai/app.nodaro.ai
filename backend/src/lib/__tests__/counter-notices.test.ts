/**
 * Sending a counter-notice (lib/counter-notices.ts) over an in-memory store,
 * with the real instance cipher: only the content's owner, for a restriction
 * a copyright case led to, while it stands and the case is open, once, under
 * the declaration in force. The sender's details are stored encrypted, bound
 * to the row and the column; the window is fixed at receipt; the case's log
 * says it arrived and the case moves to counter_notice_received only when it
 * had not got that far and nobody moved it meanwhile, and neither can fail
 * the submission. A lift or a closing that lands between the read and the
 * write is refused by the database (migration 587), and named.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { MemoryDb, Row } from "../../test/memory-tables.js"

const db = vi.hoisted(() => ({ tables: {}, unique: { rights_counter_notices: ["restriction_id"] }, beforeWrite: {}, onUpdate: {} }) as MemoryDb)
const log = vi.hoisted(() => ({ events: [] as Array<[string, string, string, Record<string, unknown>]> }))
const mockConfig = vi.hoisted(() => ({ NODARO_ENCRYPTION_KEY: "ab".repeat(32), SOCIAL_ENCRYPTION_KEY: "" }))

vi.mock("../config.js", () => ({ config: mockConfig }))
vi.mock("../supabase.js", async () => {
  const { memorySupabase } = await import("../../test/memory-tables.js")
  return { supabase: memorySupabase(db) }
})
vi.mock("../rights-complaints.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../rights-complaints.js")>()),
  recordComplaintEventQuietly: vi.fn(async (id: string, kind: string, actor: string, data: Record<string, unknown>) => {
    log.events.push([id, kind, actor, data])
  }),
}))

import { resetInstanceCipherForTests } from "../instance-cipher.js"
import {
  COUNTER_NOTICE_DECLARATION,
  COUNTER_NOTICE_DECLARATION_HASH,
  createCounterNotice,
  openCounterNotice,
  openCounterNoticeField,
  sealCounterNoticeField,
} from "../counter-notices.js"

const OWNER = "00000000-0000-4000-8000-0000000000a1"
const RECEIVED = new Date("2026-11-23T20:00:00Z")

const submission = (over: Partial<Parameters<typeof createCounterNotice>[0]> = {}) => ({
  userId: OWNER,
  restrictionId: "r-1",
  name: "Sam Owner",
  email: " sam@example.test ",
  address: "1 Road, Town",
  phone: "+1 555 0101",
  signature: "Sam Owner",
  contentIdentification: "my-clip.mp4",
  locationBefore: "https://cdn.example.test/uploads/my-clip.mp4",
  declarationHash: COUNTER_NOTICE_DECLARATION_HASH,
  networkHash: "net-1",
  userAgent: "browser/1.0",
  ...over,
})

const caseRow = () => db.tables.rights_complaints!.find((r) => r.id === "c-1")!
const setCase = (patch: Row) => {
  db.tables.rights_complaints = db.tables.rights_complaints!.map((r) => (r.id === "c-1" ? { ...r, ...patch } : r))
}

/** Migration 587's insert check, as the database runs it at the write. */
const insertCheck: MemoryDb["guards"] = {
  rights_counter_notices: ({ kind, row }) => {
    if (kind !== "insert") return null
    const restriction = db.tables.content_restrictions!.find((r) => r.id === row.restriction_id)
    const complaint = db.tables.rights_complaints!.find((c) => c.id === row.complaint_id)
    if (restriction?.lifted_at) return { code: "55027", message: "A counter-notice answers a standing restriction; this one was lifted" }
    if (complaint && ["resolved", "closed"].includes(String(complaint.status))) return { code: "55027", message: "A counter-notice answers an open case" }
    return null
  },
}

beforeEach(() => {
  mockConfig.NODARO_ENCRYPTION_KEY = "ab".repeat(32)
  resetInstanceCipherForTests()
  db.tables = {
    content_restrictions: [
      { id: "r-1", complaint_id: "c-1", owner_user_id: OWNER, lifted_at: null },
      { id: "r-2", complaint_id: "c-2", owner_user_id: OWNER, lifted_at: null },
      { id: "r-3", complaint_id: null, owner_user_id: OWNER, lifted_at: null },
      { id: "r-4", complaint_id: "c-1", owner_user_id: OWNER, lifted_at: "2026-11-20T00:00:00Z" },
      { id: "r-5", complaint_id: "c-3", owner_user_id: OWNER, lifted_at: null },
      { id: "r-9", complaint_id: "c-1", owner_user_id: "someone-else", lifted_at: null },
    ],
    rights_complaints: [
      { id: "c-1", reference: "CR-2026-000001", kind: "copyright", status: "content_restricted", updated_at: "u-1" },
      { id: "c-2", reference: "CR-2026-000002", kind: "other", status: "content_restricted", updated_at: "u-2" },
      { id: "c-3", reference: "CR-2026-000003", kind: "copyright", status: "closed", updated_at: "u-3" },
    ],
    rights_counter_notices: [],
  }
  db.beforeWrite = {}
  db.guards = insertCheck
  let stamp = 0
  db.onUpdate = { rights_complaints: () => ({ updated_at: `stamp-${++stamp}` }) }
  let sequence = 0
  db.defaults = { rights_counter_notices: () => ({ reference: `CN-2026-${String(++sequence).padStart(6, "0")}` }) }
  log.events = []
})

describe("the declaration", () => {
  it("is the two statements, verbatim, and its hash is what a client sends back", () => {
    expect(COUNTER_NOTICE_DECLARATION).toHaveLength(2)
    expect(COUNTER_NOTICE_DECLARATION[0]).toMatch(/^I declare, under penalty of perjury, that I have a good-faith belief/)
    expect(COUNTER_NOTICE_DECLARATION[1]).toMatch(/17 U\.S\.C\. § 512\(g\)\(3\), and I will accept service of process/)
    expect(COUNTER_NOTICE_DECLARATION_HASH).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("createCounterNotice", () => {
  it("records it with its window, the sender encrypted and bound to the row and the column", async () => {
    const receipt = await createCounterNotice(submission(), RECEIVED)
    expect(receipt.reference).toBe("CN-2026-000001")
    expect(receipt.window).toEqual({ receivedOn: "2026-11-23", opensOn: "2026-12-09", closesOn: "2026-12-11" })
    const row = db.tables.rights_counter_notices![0]!
    expect(row).toMatchObject({
      id: receipt.id,
      complaint_id: "c-1",
      restriction_id: "r-1",
      user_id: OWNER,
      content_identification: "my-clip.mp4",
      declaration_hash: COUNTER_NOTICE_DECLARATION_HASH,
      window_opens_on: "2026-12-09",
      window_closes_on: "2026-12-11",
      received_at: RECEIVED.toISOString(),
      perjury_affirmed_at: RECEIVED.toISOString(),
      jurisdiction_affirmed_at: RECEIVED.toISOString(),
    })
    for (const column of ["name_enc", "email_enc", "address_enc", "phone_enc", "signature_enc"]) {
      expect(String(row[column])).not.toMatch(/Sam|Road|555/)
    }
    expect(openCounterNotice(row as never)).toEqual({ name: "Sam Owner", email: "sam@example.test", address: "1 Road, Town", phone: "+1 555 0101", signature: "Sam Owner", unreadable: [] })
    // A ciphertext moved to another column, or another row, does not open.
    expect(openCounterNotice({ ...(row as Row), signature_enc: row.name_enc } as never).unreadable).toEqual(["signature_enc"])
    expect(openCounterNotice({ ...(row as Row), id: "another" } as never).unreadable).toHaveLength(5)
  })

  it("writes its arrival on the case's log and moves the case to counter_notice_received", async () => {
    const receipt = await createCounterNotice(submission(), RECEIVED)
    expect(caseRow().status).toBe("counter_notice_received")
    expect(log.events).toEqual([
      ["c-1", "counter_notice_received", "owner", { counterNoticeId: receipt.id, reference: receipt.reference, restrictionId: "r-1", opensOn: "2026-12-09", closesOn: "2026-12-11" }],
      ["c-1", "status_changed", "system", { from: "content_restricted", to: "counter_notice_received" }],
    ])
  })

  it("a case moved between the read and the write keeps its status, and the counter-notice stands", async () => {
    db.beforeWrite = { rights_complaints: () => setCase({ status: "under_review", updated_at: "elsewhere" }) }
    const receipt = await createCounterNotice(submission(), RECEIVED)
    expect(receipt.reference).toBeDefined()
    expect(caseRow().status).toBe("under_review")
    expect(log.events.map((e) => e[1])).toEqual(["counter_notice_received"])
  })

  it("a case further along (a court action on another counter-notice) is never moved back", async () => {
    setCase({ status: "awaiting_legal_action" })
    await createCounterNotice(submission(), RECEIVED)
    expect(caseRow().status).toBe("awaiting_legal_action")
    expect(log.events.map((e) => e[1])).toEqual(["counter_notice_received"])
  })

  it("only the content's owner, for a restriction a case led to: anything else is not found", async () => {
    await expect(createCounterNotice(submission({ restrictionId: "r-9" }), RECEIVED)).rejects.toMatchObject({ code: "not_found" })
    await expect(createCounterNotice(submission({ restrictionId: "r-3" }), RECEIVED)).rejects.toMatchObject({ code: "not_found" })
    await expect(createCounterNotice(submission({ restrictionId: "nope" }), RECEIVED)).rejects.toMatchObject({ code: "not_found" })
    expect(db.tables.rights_counter_notices).toEqual([])
  })

  it("answers a copyright case only, while the restriction stands and the case is open", async () => {
    await expect(createCounterNotice(submission({ restrictionId: "r-2" }), RECEIVED)).rejects.toMatchObject({ code: "not_copyright" })
    await expect(createCounterNotice(submission({ restrictionId: "r-4" }), RECEIVED)).rejects.toMatchObject({ code: "lifted" })
    await expect(createCounterNotice(submission({ restrictionId: "r-5" }), RECEIVED)).rejects.toMatchObject({ code: "case_closed" })
    expect(db.tables.rights_counter_notices).toEqual([])
  })

  it("a lift between the read and the write is refused by the database, and named", async () => {
    db.beforeWrite = {
      rights_counter_notices: () => {
        db.tables.content_restrictions = db.tables.content_restrictions!.map((r) => (r.id === "r-1" ? { ...r, lifted_at: "2026-11-23T20:00:01Z" } : r))
      },
    }
    await expect(createCounterNotice(submission(), RECEIVED)).rejects.toMatchObject({ code: "lifted" })
    expect(db.tables.rights_counter_notices).toEqual([])
    expect(log.events).toEqual([])
  })

  it("a case closed between the read and the write is refused by the database, and named", async () => {
    db.beforeWrite = { rights_counter_notices: () => setCase({ status: "closed" }) }
    await expect(createCounterNotice(submission(), RECEIVED)).rejects.toMatchObject({ code: "case_closed" })
    expect(db.tables.rights_counter_notices).toEqual([])
  })

  it("once per restriction, under the declaration in force, and only with the instance key", async () => {
    await createCounterNotice(submission(), RECEIVED)
    await expect(createCounterNotice(submission(), RECEIVED)).rejects.toMatchObject({ code: "already_sent" })
    await expect(createCounterNotice(submission({ restrictionId: "r-1", declarationHash: "0".repeat(64) }), RECEIVED)).rejects.toMatchObject({ code: "declaration_changed" })
    mockConfig.NODARO_ENCRYPTION_KEY = ""
    resetInstanceCipherForTests()
    await expect(createCounterNotice(submission(), RECEIVED)).rejects.toMatchObject({ code: "unavailable" })
    expect(db.tables.rights_counter_notices).toHaveLength(1)
  })
})

describe("an administrator's note on a counter-notice", () => {
  it("is sealed to its row and column, and opens only there", () => {
    const sealed = sealCounterNoticeField("n-1", "court_action_note_enc", "District Court, case 1:26-cv-1")
    expect(sealed).not.toMatch(/District/)
    expect(openCounterNoticeField("n-1", "court_action_note_enc", sealed)).toEqual({ value: "District Court, case 1:26-cv-1", failed: false })
    expect(openCounterNoticeField("n-1", "court_action_ended_note_enc", sealed)).toEqual({ value: null, failed: true })
    expect(openCounterNoticeField("n-2", "court_action_note_enc", sealed)).toEqual({ value: null, failed: true })
    expect(openCounterNoticeField("n-1", "court_action_note_enc", null)).toEqual({ value: null, failed: false })
  })
})
