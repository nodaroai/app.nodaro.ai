/**
 * One plain-text bot message: sent as written (no parse mode, previews off),
 * and Telegram's answer as a typed outcome. The one that matters most for a
 * message is "uncertain": the request may have reached Telegram, so it must
 * never be sent again — and its reason never carries the request URL, which
 * holds the bot's token.
 */
import { describe, it, expect, vi } from "vitest"
import { sendTelegramBotText } from "../telegram-text.js"

const TOKEN = "123456:SECRET-token"

function answering(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }))
}

describe("sendTelegramBotText", () => {
  it("posts the text as written, no parse mode, previews off", async () => {
    const fetchImpl = answering(200, { ok: true, result: { message_id: 77 } })
    expect(await sendTelegramBotText(TOKEN, "555", "**not bold** <b>as is</b>", fetchImpl)).toEqual({ status: "sent", messageId: "77" })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`)
    const body = JSON.parse(String(init.body))
    expect(body).toEqual({ chat_id: "555", text: "**not bold** <b>as is</b>", link_preview_options: { is_disabled: true } })
    expect(body).not.toHaveProperty("parse_mode")
  })

  it("a person who never pressed Start (or blocked the bot) is told apart", async () => {
    expect(await sendTelegramBotText(TOKEN, "555", "hi", answering(403, { ok: false, error_code: 403, description: "Forbidden: bot can't initiate conversation with a user" }))).toEqual({ status: "chat_not_started" })
    expect(await sendTelegramBotText(TOKEN, "555", "hi", answering(400, { ok: false, error_code: 400, description: "Bad Request: chat not found" }))).toEqual({ status: "chat_not_started" })
  })

  it("a token Telegram no longer accepts, and a rate limit with its wait", async () => {
    expect(await sendTelegramBotText(TOKEN, "555", "hi", answering(401, { ok: false, error_code: 401, description: "Unauthorized" }))).toEqual({ status: "token_rejected" })
    expect(await sendTelegramBotText(TOKEN, "555", "hi", answering(429, { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 12 } }))).toEqual({ status: "rate_limited", retryAfterSeconds: 12 })
  })

  it("any other refusal is a certain failure, in Telegram's own words", async () => {
    expect(await sendTelegramBotText(TOKEN, "555", "hi", answering(400, { ok: false, error_code: 400, description: "Bad Request: message is too long" }))).toEqual({
      status: "failed",
      reason: "Bad Request: message is too long",
      uncertain: false,
    })
  })

  it("a server-side error is uncertain even when it answers in JSON — Telegram's 5xx or a proxy's error page", async () => {
    expect(await sendTelegramBotText(TOKEN, "555", "hi", answering(502, { ok: false, error_code: 502, description: "Bad Gateway" }))).toMatchObject({ status: "failed", uncertain: true })
    expect(await sendTelegramBotText(TOKEN, "555", "hi", answering(200, { ok: false, error_code: 500, description: "Internal" }))).toMatchObject({ status: "failed", uncertain: true })
    expect(await sendTelegramBotText(TOKEN, "555", "hi", answering(503, { message: "upstream unavailable" }))).toMatchObject({ status: "failed", uncertain: true })
  })

  it("an accepted message is sent, even when the answer does not name it", async () => {
    expect(await sendTelegramBotText(TOKEN, "555", "hi", answering(200, { ok: true, result: {} }))).toEqual({ status: "sent", messageId: "" })
  })

  it("an edge error without Telegram's answer is uncertain; a 4xx without one is not", async () => {
    const bare = (status: number) => vi.fn(async () => new Response("<html>bad gateway</html>", { status }))
    expect(await sendTelegramBotText(TOKEN, "555", "hi", bare(502))).toMatchObject({ status: "failed", uncertain: true })
    expect(await sendTelegramBotText(TOKEN, "555", "hi", bare(200))).toMatchObject({ status: "failed", uncertain: true })
    expect(await sendTelegramBotText(TOKEN, "555", "hi", bare(400))).toMatchObject({ status: "failed", uncertain: false })
  })

  it("no answer is UNCERTAIN, and its reason never carries the token", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`fetch failed: https://api.telegram.org/bot${TOKEN}/sendMessage`)
    })
    const outcome = await sendTelegramBotText(TOKEN, "555", "hi", fetchImpl)
    expect(outcome).toEqual({ status: "failed", reason: "telegram did not answer", uncertain: true })
    expect(JSON.stringify(outcome)).not.toContain("SECRET")
  })
})
