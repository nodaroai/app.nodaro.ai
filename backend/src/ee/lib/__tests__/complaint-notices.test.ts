/**
 * The two emails a complaint's handler sends from the case
 * (ee/lib/complaint-notices.ts): each previewed exactly as it is sent, and
 * sent only as previewed (its digest); every value escaped for the template;
 * the account told only of its own files and only the reason written for it;
 * refused when the case cannot send it (and then nothing is sent or logged);
 * each send written to the case's log without the address it went to, a wait
 * that ran out never logged as a failure; and a notice delivered to the
 * account moving an earlier case on to `user_notified`, never a later one back.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type Row = Record<string, unknown>

const h = vi.hoisted(() => ({
  cfg: { PUBLIC_URL: "https://app.example.test" } as Record<string, string>,
  files: [] as Row[],
  profiles: [] as Row[],
  row: null as null | Row,
  restrictions: [] as Row[],
  complainantEmail: "dana@example.test" as string | null,
  sendRestricted: vi.fn(),
  sendUpdate: vi.fn(),
  events: [] as Array<[string, string, string, Row]>,
  moves: [] as Array<[string, Row, string]>,
  moveError: null as null | Error,
}))

vi.mock("../../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/config.js")>()
  return {
    ...actual,
    config: new Proxy(actual.config, {
      get: (target, key) => (typeof key === "string" && key in h.cfg ? h.cfg[key] : Reflect.get(target, key)),
    }),
  }
})

vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      const filters: Array<(r: Row) => boolean> = []
      let sortBy: string | null = null
      const rows = () => {
        const hit = (table === "assets" ? h.files : table === "profiles" ? h.profiles : []).filter((r) => filters.every((f) => f(r)))
        return sortBy ? [...hit].sort((a, b) => String(a[sortBy!] ?? "").localeCompare(String(b[sortBy!] ?? ""))) : hit
      }
      const q: Record<string, unknown> = {}
      Object.assign(q, {
        select: () => q,
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        order: (c: string) => ((sortBy = c), q),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
      })
      return q
    },
  },
}))

vi.mock("../../../lib/complaint-mail.js", () => ({ sendContentRestricted: h.sendRestricted, sendComplaintUpdate: h.sendUpdate }))

vi.mock("../../../lib/content-restrictions.js", () => ({
  listRestrictions: vi.fn(async (opts: { complaintId?: string }) => h.restrictions.filter((r) => r.complaintId === opts.complaintId)),
}))

vi.mock("../../../lib/rights-complaints.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/rights-complaints.js")>()),
  recordComplaintEventQuietly: vi.fn(async (id: string, kind: string, actor: string, data: Row) => {
    h.events.push([id, kind, actor, data])
  }),
}))

vi.mock("../complaint-case-rows.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../complaint-case-rows.js")>()
  return {
    ...actual,
    readCaseRow: vi.fn(async (id: string) => {
      if (!h.row || h.row.id !== id) throw new actual.ComplaintCaseError("not_found", "No such complaint")
      return h.row
    }),
    readComplainant: () => ({ email: h.complainantEmail }),
    summaryOf: (row: Row) => ({ id: row.id, reference: row.reference, status: row.status }),
  }
})

vi.mock("../complaint-cases.js", () => ({
  moveComplaintStatus: vi.fn(async (id: string, move: Row, admin: string) => {
    h.moves.push([id, move, admin])
    if (h.moveError) throw h.moveError
    return { id, reference: "CR-2026-000001", status: move.status }
  }),
}))

import { escapeHtml, renderAdminMessageBody } from "../admin-message-markdown.js"
import {
  ComplaintNoticeError,
  previewAccountNotice,
  previewComplainantUpdate,
  sendAccountNotice,
  sendComplainantUpdate,
} from "../complaint-notices.js"

const CASE = "00000000-0000-4000-8000-0000000000c1"
const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const OWNER_EMAIL = "owner@example.test"
const COUNTER_NOTICE = "https://app.example.test/settings/content-restrictions"
/** The reason the handler writes for the account; the restriction's own reason is the record's. */
const TOLD = "The rights holder of the original film reported this file."

function caseRow(over: Row = {}): Row {
  return {
    id: CASE,
    reference: "CR-2026-000001",
    kind: "copyright",
    status: "content_restricted",
    updated_at: "stamp-1",
    verified_at: "2026-11-01T00:00:00Z",
    decision: "Access to the reported video was disabled.",
    ...over,
  }
}

function restriction(over: Row = {}): Row {
  return {
    id: "r-1",
    complaintId: CASE,
    assetId: "a-1",
    assetIds: ["a-1"],
    jobId: null,
    jobIds: [],
    sourceUrl: "https://example.test/watch/1",
    ownerUserId: "u-1",
    reason: "Per the claimant's agent, internal note: checked against the master.",
    restrictedAt: "2026-11-02T10:00:00Z",
    liftedAt: null,
    ...over,
  }
}

/** Preview the account's notice, then send exactly it. */
async function previewAndSendAccountNotice(reason = TOLD) {
  const preview = await previewAccountNotice(CASE, "r-1", reason)
  return { preview, sent: await sendAccountNotice(CASE, "r-1", reason, preview.digest, ADMIN) }
}

async function previewAndSendUpdate() {
  const preview = await previewComplainantUpdate(CASE)
  return { preview, sent: await sendComplainantUpdate(CASE, preview.digest, ADMIN) }
}

beforeEach(() => {
  h.cfg.PUBLIC_URL = "https://app.example.test"
  h.files = [{ id: "a-1", user_id: "u-1", filename: "clip.mp4", type: "video", created_at: "2026-11-02T09:00:00Z" }]
  h.profiles = [{ id: "u-1", email: OWNER_EMAIL }]
  h.row = caseRow()
  h.restrictions = [restriction()]
  h.complainantEmail = "dana@example.test"
  h.sendRestricted.mockReset()
  h.sendRestricted.mockResolvedValue({ sent: true, messageId: "m-1" })
  h.sendUpdate.mockReset()
  h.sendUpdate.mockResolvedValue({ sent: true, messageId: "m-2" })
  h.events = []
  h.moves = []
  h.moveError = null
})

describe("the account's notice: Content access restricted", () => {
  it("is previewed as it is sent: the account's file, where it came from, the reason written for it, the case's reference and the counter-notice page", async () => {
    const preview = await previewAccountNotice(CASE, "r-1", TOLD)
    expect(preview).toMatchObject({
      to: OWNER_EMAIL,
      values: {
        content: "clip.mp4 (video, stored 2 Nov 2026)",
        source: "https://example.test/watch/1",
        reason: TOLD,
        reference: "CR-2026-000001",
        counterNoticeUrl: COUNTER_NOTICE,
      },
    })
    expect(preview.digest).toMatch(/^[0-9a-f]{32}$/)
    // A preview sends and logs nothing.
    expect(h.sendRestricted).not.toHaveBeenCalled()
    expect(h.events).toEqual([])
    await sendAccountNotice(CASE, "r-1", TOLD, preview.digest, ADMIN)
    expect(h.sendRestricted).toHaveBeenCalledWith(OWNER_EMAIL, preview.values)
  })

  it("never tells the account the restriction's own reason: that note is the record's", async () => {
    const { preview } = await previewAndSendAccountNotice()
    expect(JSON.stringify(preview)).not.toContain("internal note")
    expect(JSON.stringify(h.sendRestricted.mock.calls)).not.toContain("internal note")
  })

  it("names only the account's own files, never another account's copy of the same bytes", async () => {
    h.files = [
      { id: "a-1", user_id: "u-1", filename: "clip.mp4", type: "video", created_at: "2026-11-02T09:00:00Z" },
      { id: "a-2", user_id: "u-2", filename: "AcmeClient-unreleased-cut.mp4", type: "video", created_at: "2026-11-01T09:00:00Z" },
    ]
    h.restrictions = [restriction({ assetIds: ["a-1", "a-2"] })]
    const preview = await previewAccountNotice(CASE, "r-1", TOLD)
    expect(preview.values.content).toBe("clip.mp4 (video, stored 2 Nov 2026)")
    expect(JSON.stringify(preview)).not.toContain("AcmeClient")
  })

  it("escapes every value for the template; the handler's reason keeps its line breaks", async () => {
    h.files = [{ id: "a-1", user_id: "u-1", filename: "<b>poster</b>.png", type: "image", created_at: "2026-11-02T09:00:00Z" }]
    h.restrictions = [restriction({ sourceUrl: "https://example.test/?a=1&b=<2>" })]
    await previewAndSendAccountNotice("The claimant's poster.\nSee <i>their</i> site.")
    const [, sent] = h.sendRestricted.mock.calls[0] as [string, Record<string, string>]
    expect(sent.content).toBe("&lt;b&gt;poster&lt;/b&gt;.png (image, stored 2 Nov 2026)")
    expect(sent.source).toBe(escapeHtml("https://example.test/?a=1&b=<2>"))
    expect(sent.reason).toBe(renderAdminMessageBody("The claimant's poster.\nSee <i>their</i> site."))
    expect(sent.reason).toContain("<br />")
    expect(sent.reason).not.toContain("<i>")
  })

  it("names several files by count, oldest first; a restriction with no file of the account's by its day; a source that is not a web address as not available", async () => {
    h.files = ["d.png", "a.png", "b.png", "c.png"].map((filename, i) => ({ id: `a-${i}`, user_id: "u-1", filename, type: "image", created_at: `2026-11-0${4 - i}T00:00:00Z` }))
    h.restrictions = [restriction({ assetId: null, assetIds: ["a-0", "a-1", "a-2", "a-3"], jobId: "j-1" })]
    expect((await previewAccountNotice(CASE, "r-1", TOLD)).values.content).toBe("4 files: c.png, b.png, a.png, and more")
    h.files = []
    h.restrictions = [restriction({ assetId: null, assetIds: [], sourceUrl: "javascript:alert(1)" })]
    const preview = await previewAccountNotice(CASE, "r-1", TOLD)
    expect(preview.values.content).toBe("Content restricted on 2 Nov 2026")
    expect(preview.values.source).toBe("Not available")
    h.restrictions = [restriction({ sourceUrl: null })]
    expect((await previewAccountNotice(CASE, "r-1", TOLD)).values.source).toBe("Not available")
  })

  it.each([
    ["a complaint that is not about copyright", () => (h.row = caseRow({ kind: "other" })), "invalid_move"],
    ["a closed case", () => (h.row = caseRow({ status: "resolved" })), "invalid_move"],
    ["a restriction another case made", () => (h.restrictions = [restriction({ complaintId: "another-case" })]), "invalid_move"],
    ["a lifted restriction", () => (h.restrictions = [restriction({ liftedAt: "2026-11-03T00:00:00Z" })]), "invalid_move"],
    ["content that belongs to no account", () => (h.restrictions = [restriction({ ownerUserId: null })]), "invalid_move"],
    ["an account with no email address", () => (h.profiles = [{ id: "u-1", email: null }]), "invalid_move"],
    ["an unknown case", () => (h.row = null), "not_found"],
  ])("is refused for %s: nothing previewed, sent or logged", async (_label, arrange, code) => {
    arrange()
    await expect(previewAccountNotice(CASE, "r-1", TOLD)).rejects.toMatchObject({ code })
    await expect(sendAccountNotice(CASE, "r-1", TOLD, "any", ADMIN)).rejects.toMatchObject({ code })
    expect(h.sendRestricted).not.toHaveBeenCalled()
    expect(h.events).toEqual([])
    expect(h.moves).toEqual([])
  })

  it("is refused with no reason written for the account", async () => {
    await expect(previewAccountNotice(CASE, "r-1", "   ")).rejects.toMatchObject({ code: "invalid_move" })
    expect(h.sendRestricted).not.toHaveBeenCalled()
  })

  it("is refused when the app's public address is not set: the email would have no counter-notice link", async () => {
    h.cfg.PUBLIC_URL = ""
    const refusal = await previewAccountNotice(CASE, "r-1", TOLD).catch((e: unknown) => e)
    expect(refusal).toBeInstanceOf(ComplaintNoticeError)
    expect(refusal).toMatchObject({ reason: "no_link" })
    expect(h.sendRestricted).not.toHaveBeenCalled()
  })

  it.each([
    ["another reason than the one previewed", () => ({ reason: "Another reason.", change: () => {} })],
    ["the account's email changed since", () => ({ reason: TOLD, change: () => (h.profiles = [{ id: "u-1", email: "new@example.test" }]) })],
    ["the restriction's source changed since", () => ({ reason: TOLD, change: () => (h.restrictions = [restriction({ sourceUrl: "https://example.test/watch/2" })]) })],
  ])("sends only the email its preview showed: refused (%s) as a conflict, nothing sent or logged", async (_label, arrange) => {
    const preview = await previewAccountNotice(CASE, "r-1", TOLD)
    const { reason, change } = arrange()
    change()
    await expect(sendAccountNotice(CASE, "r-1", reason, preview.digest, ADMIN)).rejects.toMatchObject({ code: "conflict" })
    expect(h.sendRestricted).not.toHaveBeenCalled()
    expect(h.events).toEqual([])
  })

  it("a delivered notice is logged with the service's id and without its address, and moves an earlier case on to user_notified", async () => {
    const { sent } = await previewAndSendAccountNotice()
    expect(h.events).toEqual([[CASE, "user_notified", ADMIN, { restrictionId: "r-1", sent: true, messageId: "m-1" }]])
    expect(JSON.stringify(h.events)).not.toContain(OWNER_EMAIL)
    expect(h.moves).toEqual([[CASE, { seen: "stamp-1", status: "user_notified" }, ADMIN]])
    expect(sent).toMatchObject({ status: "user_notified" })
  })

  it("never moves a case that stands later back, and a case that moved meanwhile keeps its status", async () => {
    h.row = caseRow({ status: "counter_notice_received" })
    expect((await previewAndSendAccountNotice()).sent).toMatchObject({ status: "counter_notice_received" })
    expect(h.moves).toEqual([])

    h.row = caseRow()
    h.moveError = new Error("The case changed meanwhile")
    expect((await previewAndSendAccountNotice()).sent).toMatchObject({ status: "content_restricted" })
  })

  it.each([
    ["failed", "the mail service did not take it"],
    ["no_template", "the template is not set"],
    ["no_mailer", "this deployment sends no email"],
  ] as const)("an email not sent (%s: %s) is logged as not sent and answered as a refusal; the case does not move", async (reason, _what) => {
    h.sendRestricted.mockResolvedValueOnce({ sent: false, reason })
    const refusal = await previewAndSendAccountNotice().catch((e: unknown) => e)
    expect(refusal).toBeInstanceOf(ComplaintNoticeError)
    expect(refusal).toMatchObject({ reason })
    expect(h.events).toEqual([[CASE, "user_notified", ADMIN, { restrictionId: "r-1", sent: false, reason }]])
    expect(h.moves).toEqual([])
  })

  it("logs the mail service's own words for a refusal, without any address they quote", async () => {
    h.sendRestricted.mockResolvedValueOnce({ sent: false, reason: "failed", error: "Invalid recipient owner@example.test: mailbox unavailable" })
    await previewAndSendAccountNotice().catch(() => undefined)
    expect(h.events[0]![3]).toEqual({ restrictionId: "r-1", sent: false, reason: "failed", error: "Invalid recipient [address]: mailbox unavailable" })
  })

  it("a wait for the mail service that ran out is logged as unknown, never as not sent, and answered so; the case does not move", async () => {
    h.sendRestricted.mockResolvedValueOnce({ sent: false, reason: "unknown", error: "timeout" })
    const refusal = await previewAndSendAccountNotice().catch((e: unknown) => e)
    expect(refusal).toMatchObject({ reason: "unknown" })
    expect((refusal as Error).message).toMatch(/may have been sent/)
    expect(h.events).toEqual([[CASE, "user_notified", ADMIN, { restrictionId: "r-1", sent: "unknown" }]])
    expect(h.moves).toEqual([])
  })
})

describe("the complainant's update: Complaint update", () => {
  it("is previewed as it is sent: the case's reference, its status in words, and the decision as what was done", async () => {
    const preview = await previewComplainantUpdate(CASE)
    expect(preview).toMatchObject({
      to: "dana@example.test",
      values: { reference: "CR-2026-000001", status: "Content restricted", action: "Access to the reported video was disabled." },
    })
    await sendComplainantUpdate(CASE, preview.digest, ADMIN)
    expect(h.sendUpdate).toHaveBeenCalledWith("dana@example.test", preview.values)
  })

  it("escapes the decision for the template, keeping its line breaks, and logs the send with the status it told, without the address", async () => {
    h.row = caseRow({ status: "resolved", decision: "Removed <b>both</b> clips.\nThe account was warned." })
    await previewAndSendUpdate()
    const [, sent] = h.sendUpdate.mock.calls[0] as [string, Record<string, string>]
    expect(sent).toEqual({ reference: "CR-2026-000001", status: "Resolved", action: renderAdminMessageBody("Removed <b>both</b> clips.\nThe account was warned.") })
    expect(sent.action).not.toContain("<b>")
    expect(h.events).toEqual([[CASE, "complainant_notified", ADMIN, { status: "resolved", sent: true, messageId: "m-2" }]])
    expect(JSON.stringify(h.events)).not.toContain("dana@example.test")
    expect(h.moves).toEqual([])
  })

  it("sends only the update its preview showed: a decision saved since is a conflict", async () => {
    const preview = await previewComplainantUpdate(CASE)
    h.row = caseRow({ decision: "A decision saved by another handler meanwhile.", status: "resolved" })
    await expect(sendComplainantUpdate(CASE, preview.digest, ADMIN)).rejects.toMatchObject({ code: "conflict" })
    expect(h.sendUpdate).not.toHaveBeenCalled()
    expect(h.events).toEqual([])
  })

  it.each([
    ["a complainant who has not proven their email", () => (h.row = caseRow({ verified_at: null }))],
    ["a case with no decision", () => (h.row = caseRow({ decision: "   " }))],
    ["a complainant's email that cannot be read", () => (h.complainantEmail = null)],
  ])("is refused for %s: nothing sent or logged", async (_label, arrange) => {
    arrange()
    await expect(previewComplainantUpdate(CASE)).rejects.toMatchObject({ code: "invalid_move" })
    await expect(sendComplainantUpdate(CASE, "any", ADMIN)).rejects.toMatchObject({ code: "invalid_move" })
    expect(h.sendUpdate).not.toHaveBeenCalled()
    expect(h.events).toEqual([])
  })

  it("an update the mail service did not take is logged as not sent and answered as a refusal", async () => {
    h.sendUpdate.mockResolvedValueOnce({ sent: false, reason: "failed" })
    await expect(previewAndSendUpdate()).rejects.toBeInstanceOf(ComplaintNoticeError)
    expect(h.events).toEqual([[CASE, "complainant_notified", ADMIN, { status: "content_restricted", sent: false, reason: "failed" }]])
  })
})
