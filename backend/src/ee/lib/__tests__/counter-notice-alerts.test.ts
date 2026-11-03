/**
 * The administrators' Slack told of a counter-notice's window
 * (ee/lib/counter-notice-alerts.ts): nothing without a webhook; the opening
 * and the closing worded for what an administrator does next; the
 * counter-notice and its case named by reference only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { MemoryDb } from "../../../test/memory-tables.js"

const db = vi.hoisted(() => ({ tables: {} }) as MemoryDb)
const slack = vi.hoisted(() => ({ webhook: "https://hooks.slack.test/T/B/x", sent: [] as Array<{ url: string; text: string }>, ok: true }))

vi.mock("../../../lib/supabase.js", async () => {
  const { memorySupabase } = await import("../../../test/memory-tables.js")
  return { supabase: memorySupabase(db) }
})
vi.mock("../../notifications/notify-config.js", () => ({
  getNotifyConfig: vi.fn(async () => ({ slackWebhookUrl: slack.webhook })),
}))
vi.mock("../../notifications/slack-client.js", () => ({
  sendSlack: vi.fn(async (url: string, message: { text: string }) => {
    slack.sent.push({ url, text: message.text })
    return { ok: slack.ok }
  }),
}))

import { alertCounterNoticeWindow } from "../counter-notice-alerts.js"

const alert = { reference: "CN-2026-000001", complaintId: "c-1", opensOn: "2026-12-09", closesOn: "2026-12-11" }

beforeEach(() => {
  db.tables = { rights_complaints: [{ id: "c-1", reference: "CR-2026-000001", complainant_name_enc: "enc-name" }] }
  slack.webhook = "https://hooks.slack.test/T/B/x"
  slack.sent = []
  slack.ok = true
})

describe("alertCounterNoticeWindow", () => {
  it("sends nothing without a webhook", async () => {
    slack.webhook = ""
    expect(await alertCounterNoticeWindow("opened", alert)).toBe(false)
    expect(slack.sent).toEqual([])
  })

  it("the opening: the window's dates, and what may be done now", async () => {
    expect(await alertCounterNoticeWindow("opened", alert)).toBe(true)
    expect(slack.sent).toEqual([
      {
        url: "https://hooks.slack.test/T/B/x",
        text: "Counter-notice CN-2026-000001 on case CR-2026-000001: its restore window is open (2026-12-09 to 2026-12-11, New York dates). Restore the content from the case once it was sent to the complainant, unless a court action was received.",
      },
    ])
  })

  it("the closing: the last day", async () => {
    await alertCounterNoticeWindow("closing", alert)
    expect(slack.sent[0]!.text).toBe(
      "Counter-notice CN-2026-000001 on case CR-2026-000001: its restore window closes on 2026-12-11 (New York). Restore the content from the case by then, unless a court action was received.",
    )
  })

  it("names references only: a case it cannot find is left out, and no person is ever named", async () => {
    db.tables.rights_complaints = []
    await alertCounterNoticeWindow("opened", alert)
    expect(slack.sent[0]!.text).toMatch(/^Counter-notice CN-2026-000001: its restore window is open/)
    expect(slack.sent[0]!.text).not.toMatch(/enc-name/)
  })

  it("answers false when Slack refuses", async () => {
    slack.ok = false
    expect(await alertCounterNoticeWindow("opened", alert)).toBe(false)
  })
})
