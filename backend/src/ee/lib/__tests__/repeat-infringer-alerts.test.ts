/**
 * The administrators' Slack told when the repeat-infringer policy names
 * closing an account (ee/lib/repeat-infringer-alerts.ts): nothing without a
 * webhook; the case named by reference only, with the count and the window,
 * and the decision left to an administrator.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const slack = vi.hoisted(() => ({ webhook: "https://hooks.slack.test/T/B/x", sent: [] as Array<{ url: string; text: string; noUnfurl?: boolean }>, ok: true }))

vi.mock("../../notifications/notify-config.js", () => ({
  getNotifyConfig: vi.fn(async () => ({ slackWebhookUrl: slack.webhook })),
}))
vi.mock("../../notifications/slack-client.js", () => ({
  sendSlack: vi.fn(async (url: string, message: { text: string; noUnfurl?: boolean }) => {
    slack.sent.push({ url, ...message })
    return { ok: slack.ok }
  }),
}))

import { alertPolicyNamesClosure } from "../repeat-infringer-alerts.js"

beforeEach(() => {
  slack.webhook = "https://hooks.slack.test/T/B/x"
  slack.sent = []
  slack.ok = true
})

describe("alertPolicyNamesClosure", () => {
  it("sends nothing without a webhook", async () => {
    slack.webhook = ""
    expect(await alertPolicyNamesClosure("CR-2026-000001", 3, 24)).toBe(false)
    expect(slack.sent).toEqual([])
  })

  it("names the case by reference, the count and the window, and leaves the decision to an administrator", async () => {
    expect(await alertPolicyNamesClosure("CR-2026-000001", 3, 24)).toBe(true)
    expect(slack.sent).toEqual([
      {
        url: "https://hooks.slack.test/T/B/x",
        text: "Case CR-2026-000001: the account it names now has 3 infringements recorded within 24 months, and the repeat-infringer policy names closing it. Review the account's record on the case and decide.",
        noUnfurl: true,
      },
    ])
  })

  it("answers whether Slack took it", async () => {
    slack.ok = false
    expect(await alertPolicyNamesClosure("CR-2026-000001", 3, 24)).toBe(false)
  })
})
