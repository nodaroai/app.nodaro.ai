import { supabase } from "../supabase.js"
import { getRuntimeEnv } from "../runtime-env.js"
import type { PluginTelegramBotTextInput, PluginTelegramBotTextResult } from "./types.js"

/**
 * `tk.social.sendTelegramBotText` — one plain-text message from the USER'S
 * OWN connected bot (Integrations → Telegram) to the USER'S OWN connected
 * Telegram account. Both ends are resolved here, by their owner:
 *   - the bot: one of the user's Telegram connections (their default when none
 *     is named);
 *   - the chat: the Telegram identity of one of the user's connected Telegram
 *     accounts in this environment — read from the account row, so a caller
 *     can name no other chat at all.
 * A bot never answers a run started in the chat of any of the user's bots
 * (`own_chat`): its replies would start the next run, and two bots of one
 * owner would answer each other for ever.
 *
 * Arguments a caller got wrong throw; everything else comes back as a typed
 * result (see services/social/platforms/telegram-text.ts). The social
 * services are imported when a message is sent, not when the toolkit is
 * built: they pull the OAuth and provider modules in, and the toolkit loads
 * with every plugin at boot.
 */

/** Mirrors TELEGRAM_TEXT_LIMIT (services/social/platforms/telegram-text.ts). */
const TEXT_LIMIT = 4096
/** The account-secret rows a Telegram user account lives in (the connector plugin's id). */
const TELEGRAM_ACCOUNT_PLUGIN = "telegram-account"
const NUMERIC_ID = /^-?\d{1,20}$/

/** A bot token is `<bot user id>:<secret>`; the id is public (it is the bot's chat id). */
function botUserIdOf(token: string): string | null {
  const id = token.split(":")[0] ?? ""
  return /^\d{1,20}$/.test(id) ? id : null
}

export async function sendTelegramBotTextFor(input: PluginTelegramBotTextInput): Promise<PluginTelegramBotTextResult> {
  const { userId, connectionId, toAccountId, text, startedFromChatId } = input
  if (typeof userId !== "string" || userId.trim() === "") throw new Error("sendTelegramBotText: userId is required")
  if (typeof toAccountId !== "string" || toAccountId.trim() === "") throw new Error("sendTelegramBotText: toAccountId is required")
  if (typeof text !== "string" || text.trim() === "" || text.length > TEXT_LIMIT) {
    throw new Error(`sendTelegramBotText: text must be 1..${TEXT_LIMIT} characters`)
  }

  const { data: account, error: accountError } = await supabase
    .from("plugin_account_secrets")
    .select("external_id, status")
    .eq("id", toAccountId)
    .eq("user_id", userId)
    .eq("plugin", TELEGRAM_ACCOUNT_PLUGIN)
    .eq("runtime_env", getRuntimeEnv())
    .maybeSingle()
  if (accountError) throw new Error(`plugin_account_secrets read failed: ${accountError.message}`)
  const chatId = typeof account?.external_id === "string" ? account.external_id : ""
  if (!account || account.status === "disabled" || !NUMERIC_ID.test(chatId)) return { status: "no_account" }

  // All of the user's bots: the one that writes, and every one whose chat may have started this run.
  const { data: rows, error } = await supabase.from("social_connections").select("*").eq("user_id", userId).eq("platform", "telegram")
  if (error) throw new Error(`social_connections read failed: ${error.message}`)
  const { pickDefaultConnection } = await import("../../services/social/execute-publish.js")
  type Row = Parameters<typeof pickDefaultConnection>[0][number]
  const bots = (rows ?? []) as Row[]
  const connection = connectionId ? bots.find((row) => row.id === connectionId) : pickDefaultConnection(bots)
  if (!connection) return { status: "not_connected" }

  const [{ decryptToken }, { sendTelegramBotText }] = await Promise.all([
    import("../../services/social/encryption.js"),
    import("../../services/social/platforms/telegram-text.js"),
  ])
  // A run started in the chat of ANY of the user's bots is never answered by a
  // bot: two bots of one owner would otherwise answer each other for ever.
  if (startedFromChatId !== undefined) {
    const started = String(startedFromChatId)
    const ownBotChat = bots.some((row) => {
      try {
        return botUserIdOf(decryptToken(row.access_token_encrypted)) === started
      } catch {
        return false
      }
    })
    if (ownBotChat) return { status: "own_chat" }
  }
  const token = decryptToken(connection.access_token_encrypted)

  const outcome = await sendTelegramBotText(token, chatId, text)
  if (outcome.status !== "token_rejected") return outcome
  // The Integrations page asks the user to connect the bot again.
  await supabase
    .from("social_connections")
    .update({ reconnect_needed: true, updated_at: new Date().toISOString() })
    .eq("id", connection.id)
    .eq("user_id", userId)
    .then(
      () => undefined,
      () => undefined,
    )
  return { status: "not_connected" }
}
