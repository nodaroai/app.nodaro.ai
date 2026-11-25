/**
 * The one email per plan-drop reset of private outputs to public. The database
 * enqueues it on the reset itself (migration 713, proven in
 * supabase/tests/private-outputs-hide-existing.behavior.sql P13); this pins the
 * sender: once per row, never again, nothing without the template, and stale
 * news skipped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { MemoryDb, Row } from "../../../test/memory-tables.js"

const state = vi.hoisted(() => ({
  db: { tables: {} } as MemoryDb,
  credits: true,
  templateId: "tpl_outputs_public",
  loops: true,
  standby: false,
  send: null as null | ((id: string, email: string, vars: Record<string, string>) => Promise<unknown>),
}))

vi.mock("@/lib/supabase.js", async () => {
  const { memorySupabase } = await import("../../../test/memory-tables.js")
  return { supabase: { from: (table: string) => memorySupabase(state.db).from(table) } }
})
vi.mock("@/lib/config.js", () => ({
  get config() {
    return { LOOPS_OUTPUTS_PUBLIC_ID: state.templateId }
  },
  hasCredits: () => state.credits,
}))
vi.mock("@/lib/deployment-urls.js", () => ({ flowBaseUrl: () => "https://app.example.test" }))
vi.mock("@/ee/notifications/founder-notify.js", () => ({ isStandbySender: () => state.standby }))
const sendTransactional = vi.fn((id: string, email: string, vars: Record<string, string>) =>
  state.send ? state.send(id, email, vars) : Promise.resolve({ ok: true, messageId: "msg_1" }),
)
vi.mock("@/ee/lib/loops-client.js", () => ({
  isLoopsConfigured: () => state.loops,
  sendTransactional: (id: string, email: string, vars: Record<string, string>) => sendTransactional(id, email, vars),
}))

import { NOTICE_MAX_ATTEMPTS, noticeDate, sendOutputsPublicNotices } from "../outputs-public-notice.js"

const USER = "00000000-0000-4000-8000-0000000000e1"
const SINCE = "2026-11-25T08:00:00.000Z"
const NOW = new Date("2026-11-25T08:05:00.000Z")

const notice = (over: Row = {}): Row => ({ user_id: USER, public_since: SINCE, status: "pending", attempts: 0, message_id: null, sent_at: null, created_at: SINCE, ...over })
const profile = (over: Row = {}): Row => ({ id: USER, email: "person@example.test", tier: "basic", public_outputs: true, outputs_public_since: SINCE, outputs_public_reason: "plan", ...over })
const row = () => (state.db.tables.outputs_public_notices as Row[])[0]!

beforeEach(() => {
  state.db = { tables: { profiles: [profile()], outputs_public_notices: [notice()] } }
  state.credits = true
  state.templateId = "tpl_outputs_public"
  state.loops = true
  state.standby = false
  state.send = null
  sendTransactional.mockClear()
})

describe("the outputs-public notice", () => {
  it("sends one email with the day and the plans link, and records it", async () => {
    const result = await sendOutputsPublicNotices(NOW, () => {})
    expect(result.sent).toBe(1)
    expect(sendTransactional).toHaveBeenCalledWith("tpl_outputs_public", "person@example.test", {
      date: "November 25, 2026",
      plansUrl: "https://app.example.test/pricing",
    })
    expect(row()).toMatchObject({ status: "sent", message_id: "msg_1" })
  })

  it("never sends the same reset twice", async () => {
    await sendOutputsPublicNotices(NOW, () => {})
    await sendOutputsPublicNotices(NOW, () => {})
    expect(sendTransactional).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["no template", () => (state.templateId = "")],
    ["no credits (a self-hosted edition)", () => (state.credits = false)],
    ["no Loops key", () => (state.loops = false)],
    ["the standby sender", () => (state.standby = true)],
  ])("sends nothing with %s, and leaves the row waiting", async (_label, arrange) => {
    arrange()
    await sendOutputsPublicNotices(NOW, () => {})
    expect(sendTransactional).not.toHaveBeenCalled()
    expect(row()).toMatchObject({ status: "pending" })
  })

  it.each([
    ["private again", profile({ public_outputs: false })],
    ["reset again since (a newer stamp)", profile({ outputs_public_since: "2026-11-26T00:00:00.000Z" })],
  ])("skips the news when the person is %s", async (_label, p) => {
    state.db.tables.profiles = [p]
    await sendOutputsPublicNotices(NOW, () => {})
    expect(sendTransactional).not.toHaveBeenCalled()
    expect(row()).toMatchObject({ status: "skipped" })
  })

  it("skips a notice older than three days", async () => {
    await sendOutputsPublicNotices(new Date("2026-11-29T08:00:00.000Z"), () => {})
    expect(sendTransactional).not.toHaveBeenCalled()
    expect(row()).toMatchObject({ status: "skipped" })
  })

  it("a provider refusal is retried, and the last refusal is final (given_up)", async () => {
    state.send = async () => ({ ok: false, status: 400, error: "bad", failureKind: "provider" })
    for (let i = 0; i < NOTICE_MAX_ATTEMPTS + 2; i++) await sendOutputsPublicNotices(NOW, () => {})
    expect(sendTransactional).toHaveBeenCalledTimes(NOTICE_MAX_ATTEMPTS)
    expect(row()).toMatchObject({ status: "given_up", attempts: NOTICE_MAX_ATTEMPTS })
  })

  it("rows that ran out of attempts never fill the batch: a newer notice still goes", async () => {
    const exhausted = Array.from({ length: 150 }, (_, i) =>
      notice({ user_id: `exhausted-${i}`, status: "failed", attempts: NOTICE_MAX_ATTEMPTS, created_at: "2026-11-25T07:00:00.000Z" }),
    )
    state.db.tables.outputs_public_notices = [...exhausted, notice({ created_at: "2026-11-25T07:59:00.000Z" })]
    const result = await sendOutputsPublicNotices(NOW, () => {})
    expect(result.sent).toBe(1)
    expect(sendTransactional).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["no template", () => (state.templateId = "")],
    ["the standby sender", () => (state.standby = true)],
  ])("expires old waiting notices even with %s (nothing piles up)", async (_label, arrange) => {
    arrange()
    state.db.tables.outputs_public_notices = [notice({ created_at: "2026-11-20T00:00:00.000Z" }), notice({ user_id: "fresh", created_at: "2026-11-25T08:00:00.000Z" })]
    await sendOutputsPublicNotices(NOW, () => {})
    const rows = state.db.tables.outputs_public_notices as Row[]
    expect(rows.map((r) => r.status)).toEqual(["skipped", "pending"])
    expect(sendTransactional).not.toHaveBeenCalled()
  })

  it("skips the email when the person is back on a plan with private outputs", async () => {
    state.db.tables.profiles = [profile({ tier: "pro", subscription_tier: "pro" })]
    await sendOutputsPublicNotices(NOW, () => {})
    expect(sendTransactional).not.toHaveBeenCalled()
    expect(row()).toMatchObject({ status: "skipped" })
  })

  it("logs a refusal by status and kind, never the provider's body", async () => {
    state.send = async () => ({ ok: false, status: 422, error: "invalid email person@example.test", failureKind: "provider" })
    const lines: string[] = []
    await sendOutputsPublicNotices(NOW, (line) => lines.push(line))
    expect(lines.join("\n")).toContain("422")
    expect(lines.join("\n")).not.toContain("person@example.test")
  })

  it("a timeout may have delivered: recorded unknown, never sent again", async () => {
    state.send = async () => ({ ok: false, error: "timeout", failureKind: "timeout" })
    await sendOutputsPublicNotices(NOW, () => {})
    await sendOutputsPublicNotices(NOW, () => {})
    expect(sendTransactional).toHaveBeenCalledTimes(1)
    expect(row()).toMatchObject({ status: "unknown" })
  })

  it("never throws, even when the send itself throws", async () => {
    state.send = async () => {
      throw new Error("boom")
    }
    await expect(sendOutputsPublicNotices(NOW, () => {})).resolves.toMatchObject({ failed: 1 })
  })

  it("formats the day in English, in UTC", () => {
    expect(noticeDate("2026-01-02T23:30:00.000Z")).toBe("January 2, 2026")
  })
})
