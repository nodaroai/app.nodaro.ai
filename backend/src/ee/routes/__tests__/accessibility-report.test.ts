import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * POST /v1/accessibility/report: a report reaches the founders' Slack channel
 * or the caller is told to email instead. It is never a 200 for a report that
 * was not delivered (the regulations' 60-day clock starts at the report).
 */

const { mockNotifyConfig, mockSendSlack } = vi.hoisted(() => ({
  mockNotifyConfig: vi.fn(),
  mockSendSlack: vi.fn(),
}))

vi.mock("@/ee/notifications/notify-config.js", () => ({ getNotifyConfig: mockNotifyConfig }))
vi.mock("@/ee/notifications/slack-client.js", () => ({ sendSlack: mockSendSlack }))
vi.mock("@/lib/config.js", () => ({ config: { PUBLIC_URL: "https://app.nodaro.ai" } }))

import { accessibilityReportRoutes, buildReportText, slackPlain, ACCESSIBILITY_REPORT_EMAIL } from "../accessibility-report.js"

const WEBHOOK = "https://hooks.slack.com/services/T000/B000/xyz"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  mockNotifyConfig.mockResolvedValue({ slackWebhookUrl: WEBHOOK })
  mockSendSlack.mockResolvedValue({ ok: true, status: 200 })
  app = Fastify({ logger: false })
  await app.register(accessibilityReportRoutes)
  await app.ready()
})

function post(body: unknown) {
  return app.inject({ method: "POST", url: "/v1/accessibility/report", payload: body as Record<string, unknown> })
}

describe("POST /v1/accessibility/report", () => {
  it("posts the report to the founders' Slack webhook and answers ok", async () => {
    const res = await post({ message: "The Run button has no name", page: "/projects", contact: "dana@example.com" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(mockSendSlack).toHaveBeenCalledTimes(1)
    const [url, msg] = mockSendSlack.mock.calls[0] as [string, { text: string }]
    expect(url).toBe(WEBHOOK)
    expect(msg.text).toContain("app.nodaro.ai")
    expect(msg.text).toContain("/projects")
    expect(msg.text).toContain("dana@example.com")
    expect(msg.text).toContain("The Run button has no name")
  })

  it("refuses an empty or over-long description before sending anything", async () => {
    expect((await post({ message: "   " })).statusCode).toBe(400)
    expect((await post({ message: "x".repeat(2001) })).statusCode).toBe(400)
    expect(mockSendSlack).not.toHaveBeenCalled()
  })

  it("answers 503 with the email when no Slack webhook is set", async () => {
    mockNotifyConfig.mockResolvedValue({ slackWebhookUrl: "" })
    const res = await post({ message: "Focus is invisible" })
    expect(res.statusCode).toBe(503)
    expect(res.json().error).toMatchObject({ code: "report_unavailable", email: ACCESSIBILITY_REPORT_EMAIL })
    expect(mockSendSlack).not.toHaveBeenCalled()
  })

  it("answers 503 with the email when the Slack post fails", async () => {
    mockSendSlack.mockResolvedValue({ ok: false, status: 500, error: "boom" })
    const res = await post({ message: "Focus is invisible" })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.email).toBe(ACCESSIBILITY_REPORT_EMAIL)
  })

  it("drops a honeypot-filled report without posting it", async () => {
    const res = await post({ message: "buy now", website: "http://spam.example" })
    expect(res.statusCode).toBe(200)
    expect(mockSendSlack).not.toHaveBeenCalled()
  })
})

describe("abuse limits", () => {
  it("refuses the sixth report from one network within ten minutes", async () => {
    const { default: rateLimit } = await import("@fastify/rate-limit")
    const limited = Fastify({ logger: false })
    await limited.register(rateLimit, { global: false })
    await limited.register(accessibilityReportRoutes)
    await limited.ready()
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      const res = await limited.inject({ method: "POST", url: "/v1/accessibility/report", payload: { message: `report ${i}` } })
      statuses.push(res.statusCode)
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429])
    await limited.close()
  })

  it("refuses a body far over what the three fields can hold", async () => {
    const res = await post({ message: "x", page: "y".repeat(20_000) })
    expect(res.statusCode).toBe(413)
    expect(mockSendSlack).not.toHaveBeenCalled()
  })

  it("asks Slack not to preview links from the report", async () => {
    await post({ message: "see https://example.com" })
    expect((mockSendSlack.mock.calls[0] as [string, { noUnfurl?: boolean }])[1].noUnfurl).toBe(true)
  })
})

describe("Slack text", () => {
  it("neutralises Slack markup so a report cannot ping the channel or hide a link", () => {
    expect(slackPlain("<!channel> <@U123> <http://x|click> a&b")).toBe("&lt;!channel&gt; &lt;@U123&gt; &lt;http://x|click&gt; a&amp;b")
    const text = buildReportText({ message: "<!here> help", page: "<http://evil|/projects>" })
    expect(text).not.toContain("<!here>")
    expect(text).not.toContain("<http://evil")
  })

  it("names the signed-in user when there is one, and says when no page or contact was given", () => {
    const text = buildReportText({ message: "hi" }, "user-1")
    expect(text).toContain("user-1")
    expect(text).toContain("לא צוין")
    expect(text).toContain("לא נמסרו")
  })
})
