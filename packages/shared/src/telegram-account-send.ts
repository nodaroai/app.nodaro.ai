/**
 * Telegram Reply (`telegram-account-send`) — who writes the message and
 * where it goes, as node data spells it. Structural vocabulary only: every
 * destination is the run's OWNER — the chat of the post they shared, their
 * Saved Messages, or their private chat with their own bot. How the Cloud
 * connector sends is not part of the contract.
 */

export const TELEGRAM_ACCOUNT_SEND_NODE_TYPE = "telegram-account-send"

/** `account`: the owner's connected account writes. `bot`: the owner's own bot writes to them privately. */
export const TELEGRAM_SEND_AS = ["account", "bot"] as const
export type TelegramSendAs = (typeof TELEGRAM_SEND_AS)[number]

/**
 * Where an account-written message goes. `reply`: under the post that started
 * the run, in its chat (a run started by the Telegram Account Trigger only).
 * `saved`: the owner's Saved Messages. A bot always writes to the owner's
 * private chat with it, so it has no destination to choose.
 */
export const TELEGRAM_SEND_DESTINATIONS = ["reply", "saved"] as const
export type TelegramSendDestination = (typeof TELEGRAM_SEND_DESTINATIONS)[number]

/** The node's `sendAs`, as every reader reads it: anything else is the account. */
export function telegramSendAsOf(value: unknown): TelegramSendAs {
  return value === "bot" ? "bot" : "account"
}

/** The node's `destination`, as every reader reads it: anything else is a reply. */
export function telegramSendDestinationOf(value: unknown): TelegramSendDestination {
  return value === "saved" ? "saved" : "reply"
}
