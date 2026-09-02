import { describe, it, expect, vi, afterEach } from "vitest"
import { isSlackWebhookValid, sendSlack } from "../slack-client.js"

const VALID = "https://hooks.slack.com/services/T00000000/B00000000/abcdEFGH1234"

afterEach(() => vi.unstubAllGlobals())

describe("isSlackWebhookValid", () => {
  it("accepts a real incoming-webhook URL", () => {
    expect(isSlackWebhookValid(VALID)).toBe(true)
    expect(isSlackWebhookValid(`  ${VALID}  `)).toBe(true) // trimmed
  })

  it("rejects empty, wrong-host, and http URLs", () => {
    expect(isSlackWebhookValid("")).toBe(false)
    expect(isSlackWebhookValid("http://hooks.slack.com/services/x")).toBe(false)
    expect(isSlackWebhookValid("https://example.com/services/x")).toBe(false)
    expect(isSlackWebhookValid("https://hooks.slack.com/x")).toBe(false)
    expect(isSlackWebhookValid("not a url")).toBe(false)
  })
})

describe("sendSlack", () => {
  it("no-ops (never fetches) when the webhook is not a valid Slack URL", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const r = await sendSlack("", { text: "hi" })
    expect(r.ok).toBe(false)
    expect(r.error).toBe("slack_webhook_not_configured")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("POSTs the message and returns ok on 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "ok" })
    vi.stubGlobal("fetch", fetchMock)
    const r = await sendSlack(VALID, { text: "New signup: a@b.com" })
    expect(r.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(VALID)
    expect(opts.method).toBe("POST")
    expect(JSON.parse(opts.body as string)).toEqual({ text: "New signup: a@b.com" })
  })

  it("includes blocks in the body only when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" })
    vi.stubGlobal("fetch", fetchMock)
    await sendSlack(VALID, { text: "digest", blocks: [{ type: "section" }] })
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body).toEqual({ text: "digest", blocks: [{ type: "section" }] })
  })

  it("returns not-ok with the status on an HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "no_service" }))
    const r = await sendSlack(VALID, { text: "x" })
    expect(r.ok).toBe(false)
    expect(r.status).toBe(404)
  })

  it("returns not-ok (never throws) when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")))
    const r = await sendSlack(VALID, { text: "x" })
    expect(r.ok).toBe(false)
    expect(r.error).toContain("network down")
  })
})
