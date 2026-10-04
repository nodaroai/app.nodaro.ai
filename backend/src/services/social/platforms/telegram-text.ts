/**
 * One plain-text message from a Telegram bot — the Bot API's `sendMessage`
 * with no parse mode (what is written is what arrives: no HTML or Markdown
 * is read out of a model's text) and link previews off.
 *
 * Telegram's answer comes back as a typed outcome, never an exception, so a
 * caller can tell apart "the person never pressed Start", "slow down", "the
 * token no longer works" and — the one that matters for a message — "we do
 * not know whether it arrived": the request may have been accepted before
 * the connection broke, so such a send must never be blindly repeated.
 */

/** Telegram refuses a longer message (MESSAGE_TOO_LONG); callers split first. */
export const TELEGRAM_TEXT_LIMIT = 4096
const SEND_TIMEOUT_MS = 15_000
const API_ORIGIN = "https://api.telegram.org"

export type TelegramBotTextOutcome =
  | { status: "sent"; messageId: string }
  /** Telegram does not accept the bot's token any more (revoked or replaced). */
  | { status: "token_rejected" }
  /** The person never pressed Start in the bot, or blocked it: a bot cannot write first. */
  | { status: "chat_not_started" }
  | { status: "rate_limited"; retryAfterSeconds: number | null }
  /** `uncertain`: the request may have reached Telegram — do not send it again. */
  | { status: "failed"; reason: string; uncertain: boolean }

interface BotApiAnswer {
  ok?: boolean
  result?: { message_id?: number }
  error_code?: number
  description?: string
  parameters?: { retry_after?: number }
}

function classify(answer: BotApiAnswer, httpStatus: number): TelegramBotTextOutcome {
  // Accepted is accepted, even when the answer does not name the message.
  if (answer.ok === true) {
    const id = answer.result?.message_id
    return { status: "sent", messageId: typeof id === "number" ? String(id) : "" }
  }
  const code = answer.error_code
  // A server-side error (Telegram's own 5xx, or a proxy's JSON error page)
  // proves nothing about whether the message was taken.
  if (httpStatus >= 500 || (typeof code === "number" && code >= 500)) {
    return { status: "failed", reason: `telegram error ${code ?? httpStatus}`, uncertain: true }
  }
  const description = typeof answer.description === "string" ? answer.description : ""
  if (code === 401 || code === 404) return { status: "token_rejected" }
  if (code === 403 || (code === 400 && /chat not found/i.test(description))) return { status: "chat_not_started" }
  if (code === 429) {
    const after = answer.parameters?.retry_after
    return { status: "rate_limited", retryAfterSeconds: typeof after === "number" && after >= 0 ? after : null }
  }
  // Telegram's own words ("Bad Request: …") — never our request, which carries the token in its URL.
  return { status: "failed", reason: description.slice(0, 200) || `telegram error ${code ?? "unknown"}`, uncertain: false }
}

export async function sendTelegramBotText(
  token: string,
  chatId: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TelegramBotTextOutcome> {
  let response: Response
  try {
    response = await fetchImpl(`${API_ORIGIN}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })
  } catch {
    // The error text can carry the request URL, and the URL carries the token.
    return { status: "failed", reason: "telegram did not answer", uncertain: true }
  }
  const answer = (await response.json().catch(() => null)) as BotApiAnswer | null
  // An edge error (5xx) proves nothing about whether Telegram took the message.
  if (!answer) {
    return { status: "failed", reason: `telegram answered ${response.status} without a body`, uncertain: response.ok || response.status >= 500 }
  }
  return classify(answer, response.status)
}
