/**
 * The handler's side of a complaint (ee/lib/complaint-cases.ts, with the
 * case view of complaint-case-view.ts) over an in-memory store: the queue
 * (its filters, an email by its keyed hash, a reference that never acts as a
 * pattern, a page past the end, a detail that cannot be read, the count of
 * open and verified cases), one case with everything the screen shows
 * (bounded reads, a section that fails named and shown empty, matched files
 * that are gone), and the moves, each from the case as the handler saw it: a
 * status, a decision, a note, a matched account, a rematch that only adds, a
 * restriction of what the case matched that moves an early case on and
 * stands when the case cannot be moved.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type Row = Record<string, unknown>

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  events: [] as Array<{ id: string; kind: string; actor: string; data: Row }>,
  /** Runs once, right before the next update of a case: another handler's write landing between the read and the write. */
  beforeUpdate: null as null | (() => void),
  /** The next update answers this error. */
  updateError: null as null | { code?: string; message: string },
  /** Tables whose reads fail. */
  down: new Set<string>(),
  /** The case's log cannot be written. */
  eventsDown: false,
  selects: [] as Array<[string, string]>,
  stamps: 0,
  restrictCalls: [] as Array<[string, string, Row]>,
  listCalls: [] as Row[],
  matchCalls: [] as string[][],
  matches: { assetIds: [] as string[], confirmationIds: [] as string[], userIds: [] as string[] },
}))

vi.mock("../../../lib/supabase.js", () => {
  const sortBy = (rows: Row[], sorts: ReadonlyArray<[string, boolean]>) =>
    [...rows].sort((a, b) => {
      for (const [column, ascending] of sorts) {
        const x = String(a[column] ?? "")
        const y = String(b[column] ?? "")
        if (x !== y) return (x < y ? -1 : 1) * (ascending ? 1 : -1)
      }
      return 0
    })
  const table = (name: string) => {
    const filters: Array<(r: Row) => boolean> = []
    const sorts: Array<[string, boolean]> = []
    let patch: Row | null = null
    let range: [number, number] | null = null
    let cap: number | null = null
    let counted = false
    let head = false
    const run = (single: boolean) => {
      if (patch && name === "rights_complaints" && db.beforeUpdate) {
        const race = db.beforeUpdate
        db.beforeUpdate = null
        race()
      }
      if (!patch && db.down.has(name)) return { data: null, count: null, error: { message: `${name} is down` } }
      const rows = db.tables[name] ?? []
      const hit = sortBy(rows.filter((r) => filters.every((f) => f(r))), sorts)
      if (patch) {
        if (db.updateError) {
          const error = db.updateError
          db.updateError = null
          return { data: null, error }
        }
        const ids = new Set(hit.map((r) => r.id))
        // The table's trigger stamps every change (migration 580).
        const stamp = name === "rights_complaints" ? { updated_at: `stamp-${++db.stamps}` } : {}
        db.tables[name] = rows.map((r) => (ids.has(r.id) ? { ...r, ...patch, ...stamp } : r))
        const updated = db.tables[name]!.filter((r) => ids.has(r.id))
        return single ? { data: updated[0] ?? null, error: null } : { data: updated, error: null }
      }
      if (single) return { data: hit[0] ?? null, error: null }
      // PostgREST answers a range past the end with 416 PGRST103.
      if (range && range[0] > 0 && range[0] >= hit.length) return { data: null, count: null, error: { code: "PGRST103", message: "Requested range not satisfiable" } }
      const paged = range ? hit.slice(range[0], range[1] + 1) : cap !== null ? hit.slice(0, cap) : hit
      return { data: head ? null : paged, count: counted ? hit.length : null, error: null }
    }
    const q: Record<string, unknown> = {}
    Object.assign(q, {
      select: (cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (!patch) db.selects.push([name, cols ?? ""])
        counted = !!opts?.count
        head = !!opts?.head
        return q
      },
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), q),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
      is: (c: string, v: unknown) => (filters.push((r) => (v === null ? r[c] === null || r[c] === undefined : r[c] === v)), q),
      not: (c: string, op: string, v: unknown) => (filters.push((r) => (op === "is" && v === null ? r[c] !== null && r[c] !== undefined : true)), q),
      overlaps: (c: string, vs: unknown[]) => (filters.push((r) => ((r[c] as unknown[] | null) ?? []).some((x) => vs.includes(x))), q),
      // As PostgREST reads a like pattern: `%` and `*` any run, `_` any one character, the whole value matched, any case.
      ilike: (c: string, pattern: string) => {
        const source = [...pattern].map((ch) => (ch === "%" || ch === "*" ? ".*" : ch === "_" ? "." : ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))).join("")
        const re = new RegExp(`^${source}$`, "i")
        filters.push((r) => re.test(String(r[c] ?? "")))
        return q
      },
      order: (c: string, opts?: { ascending?: boolean }) => (sorts.push([c, opts?.ascending !== false]), q),
      limit: (n: number) => ((cap = n), q),
      range: (from: number, to: number) => ((range = [from, to]), q),
      update: (p: Row) => ((patch = p), q),
      maybeSingle: async () => run(true),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run(false)).then(resolve, reject),
    })
    return q
  }
  return { supabase: { from: table } }
})

vi.mock("../../../lib/rights-complaints.js", async () => {
  const real = await vi.importActual<typeof import("../../../lib/rights-complaints.js")>("../../../lib/rights-complaints.js")
  // A ciphertext "enc:!" does not open; every other opens to what follows "enc:".
  const columns = ["complainant_name_enc", "complainant_email_enc", "complainant_address_enc", "complainant_phone_enc", "signature_enc"] as const
  const attempt = (value: unknown) => {
    if (value === undefined || value === null) return { value: null, failed: false }
    if (String(value) === "enc:!") return { value: null, failed: true }
    return { value: String(value).replace("enc:", ""), failed: false }
  }
  const log = async (id: string, kind: string, actor: string, data: Row) => {
    if (db.eventsDown) throw new Error("Complaint event write failed: down")
    db.events.push({ id, kind, actor, data })
  }
  return {
    ...real,
    complainantEmailHash: (email: string) => `hash:${email.trim().toLowerCase()}`,
    openComplainant: (row: Row) => {
      const opened = Object.fromEntries(columns.map((c) => [c, attempt(row[c])]))
      return {
        name: opened.complainant_name_enc!.value,
        email: opened.complainant_email_enc!.value,
        address: opened.complainant_address_enc!.value,
        phone: opened.complainant_phone_enc!.value,
        signature: opened.signature_enc!.value,
        unreadable: columns.filter((c) => opened[c]!.failed),
      }
    },
    recordComplaintEvent: vi.fn(log),
    recordComplaintEventQuietly: vi.fn(async (id: string, kind: string, actor: string, data: Row) => {
      try {
        await log(id, kind, actor, data)
      } catch {
        // swallowed, as the real one does
      }
    }),
    matchReportedUrls: vi.fn(async (links: string[]) => {
      db.matchCalls.push(links)
      return db.matches
    }),
  }
})

vi.mock("../../../lib/content-restrictions.js", async () => {
  const real = await vi.importActual<typeof import("../../../lib/content-restrictions.js")>("../../../lib/content-restrictions.js")
  const restriction = (over: Row) => ({ id: "r-1", assetId: null, jobId: null, complaintId: null, ...over })
  return {
    ...real,
    restrictAsset: vi.fn(async (assetId: string, input: Row) => {
      db.restrictCalls.push(["asset", assetId, input])
      return restriction({ assetId, complaintId: input.complaintId })
    }),
    restrictJob: vi.fn(async (jobId: string, input: Row) => {
      db.restrictCalls.push(["job", jobId, input])
      return restriction({ jobId, complaintId: input.complaintId })
    }),
    listRestrictions: vi.fn(async (opts: Row) => {
      db.listCalls.push(opts)
      if (db.down.has("content_restrictions_list")) throw new Error("Restrictions read failed: down")
      return [restriction({ id: "r-7", assetId: "a-1", complaintId: opts.complaintId })]
    }),
  }
})

import {
  ComplaintCaseError,
  addComplaintNote,
  countOpenComplaints,
  ensureCaseTarget,
  listComplaintCases,
  moveComplaintStatus,
  nameComplaintUser,
  readComplaintCase,
  rematchComplaint,
  restrictFromComplaint,
} from "../complaint-cases.js"
import { CASE_ACCOUNT_LIMIT, CASE_EVENT_LIMIT, HISTORY_LIMIT } from "../complaint-case-view.js"

const ADMIN = "admin-1"

function complaint(over: Row): Row {
  return {
    id: "c-1",
    reference: "CR-2026-000001",
    kind: "copyright",
    category: "copyright_infringement",
    status: "received",
    received_at: "2026-11-01T00:00:00Z",
    verified_at: "2026-11-01T00:10:00Z",
    user_id: null,
    handler_user_id: null,
    closed_at: null,
    updated_at: "2026-11-01T00:10:00Z",
    reported_urls: ["https://example.test/clip"],
    matched_asset_ids: ["a-1", "a-2"],
    matched_confirmation_ids: ["k-1"],
    matched_user_ids: ["u-1"],
    complainant_name_enc: "enc:Dana Holder",
    complainant_email_enc: "enc:dana@example.test",
    complainant_email_hash: "hash:dana@example.test",
    complainant_address_enc: "enc:1 Main St",
    complainant_phone_enc: "enc:555",
    signature_enc: "enc:Dana H.",
    claimant_role: "owner",
    original_work: "My short film",
    original_work_url: "https://example.test/original?lang=en",
    reported_content: "It is here: https://example.test/clip?utm_source=x, and a copy at https://cdn.test/uploads/b.mp4.",
    explanation: "Uploaded without permission",
    good_faith_affirmed_at: "2026-11-01T00:00:00Z",
    accuracy_affirmed_at: "2026-11-01T00:00:00Z",
    statements_hash: "h",
    decision: null,
    user_agent: "UA",
    created_at: "2026-11-01T00:00:00Z",
    ...over,
  }
}

const caseRow = (id = "c-1") => db.tables.rights_complaints!.find((r) => r.id === id)!

beforeEach(() => {
  db.tables = {
    rights_complaints: [
      complaint({}),
      complaint({ id: "c-2", reference: "CR-2026-000002", received_at: "2026-10-31T00:00:00Z", kind: "other", category: "privacy", status: "under_review", user_id: "u-1", matched_user_ids: [], complainant_email_enc: "enc:sam@example.test", complainant_email_hash: "hash:sam@example.test" }),
      complaint({ id: "c-3", reference: "CR-2026-000003", received_at: "2026-10-30T00:00:00Z", status: "closed", matched_user_ids: ["u-1"] }),
      complaint({ id: "c-4", reference: "CR-2026-000004", received_at: "2026-10-29T00:00:00Z", status: "received", verified_at: null, matched_user_ids: ["u-1"] }),
    ],
    rights_complaint_events: [
      { id: "e-1", complaint_id: "c-1", kind: "received", actor: "complainant", data: { links: 1 }, created_at: "2026-11-01T00:00:00Z" },
      { id: "e-2", complaint_id: "c-1", kind: "verified", actor: "complainant", data: null, created_at: "2026-11-01T00:10:00Z" },
      { id: "e-3", complaint_id: "c-2", kind: "received", actor: "complainant", data: {}, created_at: "2026-11-01T00:00:00Z" },
    ],
    assets: [
      { id: "a-1", user_id: "u-1", r2_key: "uploads/a.mp4", r2_url: "https://cdn.test/uploads/a.mp4", filename: "a.mp4", type: "video", job_id: null, created_at: "2026-10-01T00:00:00Z", restricted_at: "2026-11-01T01:00:00Z" },
      { id: "a-2", user_id: "u-1", r2_key: "uploads/b.mp4", r2_url: "https://cdn.test/uploads/b.mp4", filename: "b.mp4", type: "video", job_id: "j-1", created_at: "2026-10-02T00:00:00Z", restricted_at: null },
    ],
    content_rights_confirmations: [
      { id: "k-1", user_id: "u-1", kind: "checkbox", source_url: "https://example.test/clip", platform: "web", lane: "video", created_at: "2026-10-01T00:00:00Z" },
    ],
    profiles: [{ id: "u-1", email: "owner@example.test" }],
    content_restrictions: [
      { id: "r-a", owner_user_id: "u-1", lifted_at: null },
      { id: "r-b", owner_user_id: "u-1", lifted_at: "2026-10-20T00:00:00Z" },
      { id: "r-c", owner_user_id: "u-2", lifted_at: null },
    ],
  }
  db.events = []
  db.beforeUpdate = null
  db.updateError = null
  db.down = new Set()
  db.eventsDown = false
  db.selects = []
  db.stamps = 0
  db.restrictCalls = []
  db.listCalls = []
  db.matchCalls = []
  db.matches = { assetIds: [], confirmationIds: [], userIds: [] }
})

const seenOf = (id = "c-1") => String(caseRow(id).updated_at)

describe("the queue", () => {
  it("lists every case, newest first, with the name and email opened and nothing more read", async () => {
    const { cases, total, page, limit } = await listComplaintCases()
    expect(total).toBe(4)
    expect([page, limit]).toEqual([1, 50])
    expect(cases.map((c) => c.id)).toEqual(["c-1", "c-2", "c-3", "c-4"])
    expect(cases[0]).toMatchObject({ id: "c-1", complainantName: "Dana Holder", complainantEmail: "dana@example.test", complainantUnreadable: [], matchedAssetIds: ["a-1", "a-2"] })
    const columns = db.selects.filter(([t]) => t === "rights_complaints").map(([, c]) => c)
    expect(columns[0]).toContain("complainant_email_enc")
    for (const secret of ["complainant_address_enc", "complainant_phone_enc", "signature_enc", "reported_content"]) expect(columns[0]).not.toContain(secret)
  })

  it("filters: the open cases, one status, one kind, a reference, an email by its hash", async () => {
    expect((await listComplaintCases({ status: "open" })).cases.map((c) => c.id)).toEqual(["c-1", "c-2", "c-4"])
    expect((await listComplaintCases({ status: "closed" })).cases.map((c) => c.id)).toEqual(["c-3"])
    expect((await listComplaintCases({ kind: "other" })).cases.map((c) => c.id)).toEqual(["c-2"])
    expect((await listComplaintCases({ reference: "000003" })).cases.map((c) => c.id)).toEqual(["c-3"])
    expect((await listComplaintCases({ email: " Sam@Example.test " })).cases.map((c) => c.id)).toEqual(["c-2"])
  })

  it("a reference is matched as text: what was typed never acts as a wildcard", async () => {
    expect((await listComplaintCases({ reference: "%_*" })).total).toBe(4)
    // Read as patterns these would match: CR_2026 and CR*2026 every case, 2026%3 the third.
    for (const reference of ["CR_2026", "CR*2026", "2026%3"]) {
      expect((await listComplaintCases({ reference })).total, reference).toBe(0)
    }
    // A backslash is dropped, never read as an escape of what follows.
    expect((await listComplaintCases({ reference: "2026\\" })).total).toBe(4)
  })

  it("pages and bounds the page size; a page past the end is empty with the count as it is now", async () => {
    const second = await listComplaintCases({ page: 2, limit: 3 })
    expect(second.cases.map((c) => c.id)).toEqual(["c-4"])
    expect(second.total).toBe(4)
    expect((await listComplaintCases({ limit: 5000 })).limit).toBe(100)
    const past = await listComplaintCases({ page: 9, limit: 3, status: "open" })
    expect(past).toEqual({ cases: [], total: 3, page: 9, limit: 3 })
  })

  it("a row whose complainant cannot be read says which details; the rest of the queue is answered", async () => {
    db.tables.rights_complaints![1] = { ...db.tables.rights_complaints![1]!, complainant_name_enc: "enc:!" }
    const { cases } = await listComplaintCases()
    expect(cases.find((c) => c.id === "c-2")).toMatchObject({ complainantName: null, complainantEmail: "sam@example.test", complainantUnreadable: ["name"] })
    expect(cases.find((c) => c.id === "c-1")).toMatchObject({ complainantName: "Dana Holder", complainantUnreadable: [] })
  })

  it("counts the cases waiting on a handler: open and verified", async () => {
    expect(await countOpenComplaints()).toBe(2)
  })
})

describe("one case", () => {
  it("has the complainant opened, the log oldest first, every match (a restricted file included), and the case's restrictions", async () => {
    const c = await readComplaintCase("c-1")
    expect(c).toMatchObject({
      complainantName: "Dana Holder",
      complainantEmail: "dana@example.test",
      complainantAddress: "1 Main St",
      complainantPhone: "555",
      signature: "Dana H.",
      complainantUnreadable: [],
      claimantRole: "owner",
      originalWork: "My short film",
      explanation: "Uploaded without permission",
      eventsTruncated: false,
      moreAccounts: 0,
      historyTruncated: false,
      missingAssetIds: [],
      partial: [],
    })
    expect(c.events.map((e) => [e.kind, e.data])).toEqual([["received", { links: 1 }], ["verified", {}]])
    expect(c.matchedAssets.map((a) => [a.id, a.restrictedAt !== null])).toEqual([["a-1", true], ["a-2", false]])
    expect(c.matchedConfirmations).toEqual([expect.objectContaining({ id: "k-1", sourceUrl: "https://example.test/clip", lane: "video" })])
    expect(c.restrictions).toEqual([expect.objectContaining({ id: "r-7", complaintId: "c-1" })])
    expect(db.listCalls).toEqual([{ complaintId: "c-1", limit: 200 }])
  })

  it("names each account with its other cases, the verified apart from the unverified, and its standing restrictions only", async () => {
    const c = await readComplaintCase("c-1")
    expect(c.matchedUsers).toEqual([
      { id: "u-1", email: "owner@example.test", otherCases: { verified: { under_review: 1, closed: 1 }, unverified: { received: 1 } }, activeRestrictions: 1 },
    ])
  })

  it("names the matched files that no longer exist, and says when the accounts' history was cut", async () => {
    db.tables.rights_complaints![0] = { ...db.tables.rights_complaints![0]!, matched_asset_ids: ["a-1", "a-2", "gone"] }
    db.tables.rights_complaints = [
      ...db.tables.rights_complaints!,
      ...Array.from({ length: HISTORY_LIMIT }, (_, i) => complaint({ id: `h-${i}`, reference: `CR-2025-${String(i).padStart(6, "0")}`, received_at: "2025-01-01T00:00:00Z", user_id: "u-1", matched_user_ids: [] })),
    ]
    const c = await readComplaintCase("c-1")
    expect(c.missingAssetIds).toEqual(["gone"])
    expect(c.matchedAssets.map((a) => a.id)).toEqual(["a-1", "a-2"])
    expect(c.historyTruncated).toBe(true)
  })

  it("reads the named account first and a bounded number of accounts; the rest are counted", async () => {
    const many = Array.from({ length: CASE_ACCOUNT_LIMIT + 5 }, (_, i) => `m-${String(i).padStart(2, "0")}`)
    db.tables.rights_complaints![0] = { ...db.tables.rights_complaints![0]!, user_id: "named", matched_user_ids: many }
    const c = await readComplaintCase("c-1")
    expect(c.matchedUsers).toHaveLength(CASE_ACCOUNT_LIMIT)
    expect(c.matchedUsers[0]!.id).toBe("named")
    expect(c.moreAccounts).toBe(6)
  })

  it("keeps the log's newest entries, oldest first, and says older ones exist", async () => {
    const entries = Array.from({ length: CASE_EVENT_LIMIT + 1 }, (_, i) => ({
      id: `n-${String(i).padStart(4, "0")}`,
      complaint_id: "c-1",
      kind: "note",
      actor: ADMIN,
      data: { text: String(i) },
      created_at: `2026-11-02T00:00:00.${String(i).padStart(4, "0")}Z`,
    }))
    db.tables.rights_complaint_events = entries
    const c = await readComplaintCase("c-1")
    expect(c.eventsTruncated).toBe(true)
    expect(c.events).toHaveLength(CASE_EVENT_LIMIT)
    expect(c.events[0]!.data).toEqual({ text: "1" })
    expect(c.events.at(-1)!.data).toEqual({ text: String(CASE_EVENT_LIMIT) })
  })

  it("a section that cannot be read is named and shown empty; the rest of the case is answered", async () => {
    db.down.add("content_rights_confirmations")
    db.down.add("content_restrictions_list")
    db.down.add("assets")
    const c = await readComplaintCase("c-1")
    expect(c.partial).toEqual(["files", "confirmations", "restrictions"])
    expect(c.matchedConfirmations).toEqual([])
    expect(c.restrictions).toEqual([])
    expect(c.matchedAssets).toEqual([])
    // A read that did not answer says nothing about which files are gone.
    expect(c.missingAssetIds).toEqual([])
    expect(c.events).toHaveLength(2)
  })

  it("a detail of the complainant that cannot be read is named; the others, and the case, are still shown", async () => {
    db.tables.rights_complaints![0] = { ...db.tables.rights_complaints![0]!, signature_enc: "enc:!" }
    const c = await readComplaintCase("c-1")
    expect(c).toMatchObject({
      complainantUnreadable: ["signature"],
      signature: null,
      complainantName: "Dana Holder",
      complainantEmail: "dana@example.test",
      complainantAddress: "1 Main St",
      explanation: "Uploaded without permission",
    })
  })

  it("an unknown case is not found", async () => {
    await expect(readComplaintCase("nope")).rejects.toBeInstanceOf(ComplaintCaseError)
    await expect(readComplaintCase("nope")).rejects.toMatchObject({ code: "not_found" })
  })
})

describe("the status", () => {
  it("moves a case from the case the handler saw: its status, handler, decision; closing stamps the close, reopening clears it; each move logged from and to", async () => {
    const moved = await moveComplaintStatus("c-1", { seen: seenOf(), status: "under_review", note: "looking" }, ADMIN)
    expect(moved).toMatchObject({ status: "under_review", handlerUserId: ADMIN, closedAt: null })
    const closed = await moveComplaintStatus("c-1", { seen: seenOf(), status: "resolved", decision: "Removed." }, ADMIN)
    expect(closed.closedAt).toBeTruthy()
    expect(caseRow().decision).toBe("Removed.")
    const reopened = await moveComplaintStatus("c-1", { seen: seenOf(), status: "counter_notice_received" }, ADMIN)
    expect(reopened.closedAt).toBeNull()
    expect(caseRow().decision).toBe("Removed.")
    expect(db.events.map((e) => [e.kind, e.actor, e.data])).toEqual([
      ["status_changed", ADMIN, { from: "received", to: "under_review", note: "looking" }],
      ["status_changed", ADMIN, { from: "under_review", to: "resolved", decision: "Removed." }],
      ["status_changed", ADMIN, { from: "resolved", to: "counter_notice_received" }],
    ])
  })

  it("refuses a move from a case that changed since it was seen, and one that lands after another handler's (nothing written, nothing logged)", async () => {
    await expect(moveComplaintStatus("c-1", { seen: "an older read", status: "closed" }, ADMIN)).rejects.toMatchObject({ code: "conflict" })
    db.beforeUpdate = () => {
      db.tables.rights_complaints = db.tables.rights_complaints!.map((r) => (r.id === "c-1" ? { ...r, status: "under_review", updated_at: "elsewhere" } : r))
    }
    await expect(moveComplaintStatus("c-1", { seen: seenOf(), status: "closed" }, ADMIN)).rejects.toMatchObject({ code: "conflict" })
    expect(caseRow().status).toBe("under_review")
    expect(caseRow().closed_at).toBeNull()
    expect(db.events).toEqual([])
  })

  it("a save from an older screen is refused even when it would only add a note: the screen reads the case first", async () => {
    const older = seenOf()
    await moveComplaintStatus("c-1", { seen: older, status: "under_review" }, ADMIN)
    await expect(moveComplaintStatus("c-1", { seen: older, status: "under_review", note: "looked at it" }, "admin-2")).rejects.toMatchObject({ code: "conflict" })
    expect(db.events.map((e) => e.kind)).toEqual(["status_changed"])
  })

  it("one handler's decision is never overwritten by another's made from an older screen", async () => {
    const seenByBoth = seenOf()
    await moveComplaintStatus("c-1", { seen: seenByBoth, status: "received", decision: "Restrict the clip" }, ADMIN)
    await expect(moveComplaintStatus("c-1", { seen: seenByBoth, status: "received", decision: "No action: licence shown" }, "admin-2")).rejects.toMatchObject({ code: "conflict" })
    expect(caseRow().decision).toBe("Restrict the clip")
  })

  it("a save that keeps the status: a decision alone is its own entry, a note alone is a note, and nothing at all is refused", async () => {
    const decided = await moveComplaintStatus("c-1", { seen: seenOf(), status: "received", decision: "  Waiting for the original.  " }, ADMIN)
    expect(decided.status).toBe("received")
    expect(caseRow().decision).toBe("Waiting for the original.")
    const stamp = seenOf()
    await moveComplaintStatus("c-1", { seen: stamp, status: "received", note: "called them" }, ADMIN)
    expect(seenOf()).toBe(stamp)
    await moveComplaintStatus("c-1", { seen: seenOf(), status: "received", decision: "" }, ADMIN)
    expect(caseRow().decision).toBeNull()
    await expect(moveComplaintStatus("c-1", { seen: seenOf(), status: "received", decision: null, note: "  " }, ADMIN)).rejects.toMatchObject({ code: "invalid_move" })
    expect(db.events.map((e) => [e.kind, e.data])).toEqual([
      ["decision_changed", { decision: "Waiting for the original." }],
      ["note", { text: "called them" }],
      ["decision_changed", { decision: null }],
    ])
  })

  it("a move that was written stands when its log entry cannot be: it is answered, not refused", async () => {
    db.eventsDown = true
    const moved = await moveComplaintStatus("c-1", { seen: seenOf(), status: "under_review" }, ADMIN)
    expect(moved.status).toBe("under_review")
    expect(caseRow().status).toBe("under_review")
  })

  it("refuses an unknown status and an unknown case", async () => {
    await expect(moveComplaintStatus("c-1", { seen: seenOf(), status: "gone" as never }, ADMIN)).rejects.toMatchObject({ code: "invalid_status" })
    await expect(moveComplaintStatus("nope", { seen: "x", status: "closed" }, ADMIN)).rejects.toMatchObject({ code: "not_found" })
  })

  it("a case whose counter-notice waits for a decision is not closed (the database refuses it, migration 587), and says what to do", async () => {
    db.updateError = { code: "55026", message: "A counter-notice on this case waits for a decision" }
    await expect(moveComplaintStatus("c-1", { seen: seenOf(), status: "closed" }, ADMIN)).rejects.toMatchObject({
      code: "invalid_move",
      message: expect.stringContaining("restore the content, record a court action, or decline the counter-notice"),
    })
    expect(caseRow().status).toBe("received")
    expect(db.events).toEqual([])
  })
})

describe("notes and the account", () => {
  it("notes a case, names one of its matched accounts (and unnames it) from the case as seen, each in the log", async () => {
    await addComplaintNote("c-1", "asked for the original", ADMIN)
    expect((await nameComplaintUser("c-1", "u-1", seenOf(), ADMIN)).userId).toBe("u-1")
    expect((await nameComplaintUser("c-1", null, seenOf(), ADMIN)).userId).toBeNull()
    expect(db.events.map((e) => [e.kind, e.data])).toEqual([
      ["note", { text: "asked for the original" }],
      ["user_named", { from: null, to: "u-1" }],
      ["user_named", { from: "u-1", to: null }],
    ])
    await expect(addComplaintNote("nope", "x", ADMIN)).rejects.toMatchObject({ code: "not_found" })
    await expect(nameComplaintUser("nope", null, "x", ADMIN)).rejects.toMatchObject({ code: "not_found" })
  })

  it("a note is the whole move: its write failing is the caller's", async () => {
    db.eventsDown = true
    await expect(addComplaintNote("c-1", "x", ADMIN)).rejects.toThrow(/event write failed/)
  })

  it("only an account the case's links matched can be named, from the case as seen; the same one twice, or a missing one, is the handler's mistake", async () => {
    await expect(nameComplaintUser("c-1", "u-somebody", seenOf(), ADMIN)).rejects.toMatchObject({ code: "invalid_move" })
    await expect(nameComplaintUser("c-1", "u-1", "an older read", ADMIN)).rejects.toMatchObject({ code: "conflict" })
    await expect(nameComplaintUser("c-1", null, seenOf(), ADMIN)).rejects.toMatchObject({ code: "invalid_move" })
    db.updateError = { code: "23503", message: "violates foreign key constraint" }
    await expect(nameComplaintUser("c-1", "u-1", seenOf(), ADMIN)).rejects.toMatchObject({ code: "invalid_move", message: "No such account" })
    expect(caseRow().user_id).toBeNull()
    expect(db.events).toEqual([])
  })

  it("naming lands only on the case as it was read: another handler's change in between is a conflict", async () => {
    db.beforeUpdate = () => {
      db.tables.rights_complaints = db.tables.rights_complaints!.map((r) => (r.id === "c-1" ? { ...r, decision: "set elsewhere", updated_at: "elsewhere" } : r))
    }
    await expect(nameComplaintUser("c-1", "u-1", seenOf(), ADMIN)).rejects.toMatchObject({ code: "conflict" })
    expect(caseRow().user_id).toBeNull()
    expect(db.events).toEqual([])
  })
})

describe("matching again", () => {
  it("matches the links as the complainant wrote them, query strings included, from the report and the original's address", async () => {
    await rematchComplaint("c-1", ADMIN)
    expect(db.matchCalls).toEqual([["https://example.test/clip?utm_source=x", "https://cdn.test/uploads/b.mp4", "https://example.test/original?lang=en"]])
  })

  it("adds what it finds and never removes a match (a held file stays held); the log lists what was added", async () => {
    db.matches = { assetIds: ["a-2", "a-9"], confirmationIds: [], userIds: ["u-1", "u-7"] }
    const moved = await rematchComplaint("c-1", ADMIN)
    expect(moved).toMatchObject({ matchedAssetIds: ["a-1", "a-2", "a-9"], matchedConfirmationIds: ["k-1"], matchedUserIds: ["u-1", "u-7"] })
    expect(db.events).toEqual([
      {
        id: "c-1",
        kind: "rematched",
        actor: ADMIN,
        data: { links: 3, assets: 2, confirmations: 0, users: 2, added: { assetIds: ["a-9"], confirmationIds: [], userIds: ["u-7"] } },
      },
    ])
  })

  it("finding nothing new writes nothing on the case, and is logged", async () => {
    db.matches = { assetIds: ["a-1"], confirmationIds: [], userIds: [] }
    const stamp = seenOf()
    await rematchComplaint("c-1", ADMIN)
    expect(seenOf()).toBe(stamp)
    expect(db.events.map((e) => e.kind)).toEqual(["rematched"])
  })

  it("a case changed between the read and the write is a conflict, never a union over a stale read", async () => {
    db.matches = { assetIds: ["a-9"], confirmationIds: [], userIds: [] }
    db.beforeUpdate = () => {
      db.tables.rights_complaints = db.tables.rights_complaints!.map((r) => (r.id === "c-1" ? { ...r, status: "under_review", updated_at: "elsewhere" } : r))
    }
    await expect(rematchComplaint("c-1", ADMIN)).rejects.toMatchObject({ code: "conflict" })
    expect(caseRow().matched_asset_ids).toEqual(["a-1", "a-2"])
    expect(db.events).toEqual([])
  })
})

describe("a restriction from the case", () => {
  it("restricts a file the case matched, with the case as the complaint, and moves an early case to content_restricted", async () => {
    const { restriction, case: moved } = await restrictFromComplaint("c-1", { assetId: "a-2", reason: "the claimant's film" }, ADMIN)
    expect(db.restrictCalls).toEqual([["asset", "a-2", { reason: "the claimant's film", complaintId: "c-1", adminUserId: ADMIN }]])
    expect(restriction).toMatchObject({ assetId: "a-2", complaintId: "c-1" })
    expect(moved.status).toBe("content_restricted")
    // The restriction writes itself on the log (lib/content-restrictions.ts); the move is this module's.
    expect(db.events.map((e) => [e.kind, e.data])).toEqual([["status_changed", { from: "received", to: "content_restricted" }]])
  })

  it("only what the case matched: another file, or a job that made none of its files, is refused before anything is restricted", async () => {
    db.tables.assets = [...db.tables.assets!, { id: "a-x", user_id: "u-9", job_id: "j-x", restricted_at: null }]
    await expect(restrictFromComplaint("c-1", { assetId: "a-x", reason: "x" }, ADMIN)).rejects.toMatchObject({ code: "invalid_move" })
    await expect(restrictFromComplaint("c-1", { jobId: "j-x", reason: "x" }, ADMIN)).rejects.toMatchObject({ code: "invalid_move" })
    await expect(ensureCaseTarget("c-1", { jobId: "j-1" })).resolves.toMatchObject({ id: "c-1" })
    await expect(ensureCaseTarget("nope", { assetId: "a-1" })).rejects.toMatchObject({ code: "not_found" })
    expect(db.restrictCalls).toEqual([])
  })

  it("the restriction stands when the case cannot be moved on: it is answered with the case as it now is", async () => {
    db.beforeUpdate = () => {
      db.tables.rights_complaints = db.tables.rights_complaints!.map((r) => (r.id === "c-1" ? { ...r, status: "under_review", updated_at: "elsewhere" } : r))
    }
    const { restriction, case: kept } = await restrictFromComplaint("c-1", { assetId: "a-2", reason: "x" }, ADMIN)
    expect(restriction).toMatchObject({ id: "r-1" })
    expect(kept.status).toBe("under_review")
    expect(db.events).toEqual([])
  })

  it("a case further on keeps its status; the job that made a matched file is restricted the same way; one target exactly", async () => {
    db.tables.rights_complaints![0] = { ...db.tables.rights_complaints![0]!, status: "counter_notice_received" }
    const { case: kept } = await restrictFromComplaint("c-1", { jobId: "j-1", reason: "x" }, ADMIN)
    expect(kept.status).toBe("counter_notice_received")
    expect(db.restrictCalls[0]!.slice(0, 2)).toEqual(["job", "j-1"])
    await expect(restrictFromComplaint("c-1", { reason: "x" }, ADMIN)).rejects.toMatchObject({ code: "invalid_move" })
    await expect(restrictFromComplaint("c-1", { assetId: "a-1", jobId: "j-1", reason: "x" }, ADMIN)).rejects.toMatchObject({ code: "invalid_move" })
    await expect(restrictFromComplaint("nope", { assetId: "a-1", reason: "x" }, ADMIN)).rejects.toMatchObject({ code: "not_found" })
  })
})
