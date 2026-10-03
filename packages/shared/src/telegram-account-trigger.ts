/**
 * The Telegram Account Trigger's named outputs — the wire contract between the
 * Cloud connector that starts a run (it writes these keys into the run's
 * trigger data) and everything that reads them: both workflow engines, the
 * canvas card and the public node registry. A handle id IS the trigger-data
 * key, so the two can never disagree.
 *
 * Structural vocabulary only: the keys and what each one carries. How the
 * connector decides which key a post fills is not part of the contract.
 */

/** The message itself — the card's original output. */
export const TELEGRAM_ACCOUNT_TRIGGER_MESSAGE_HANDLE = "out"

/**
 * Named outputs, in the order the card shows them. Exactly one of `videoLink`
 * and `postText` carries a value in a run that is about a shared post; both
 * are empty otherwise. Never undefined — an engine reading an empty one gets
 * "", never the message text in its place.
 */
export const TELEGRAM_ACCOUNT_TRIGGER_POST_FIELDS = [
  /** The post's link, when the post has a video to analyze. */
  "videoLink",
  /** The post's words, when it has no video: the message, the link's preview, or the forwarded post. */
  "postText",
  /** The link of the post this run is about, whatever its kind. */
  "postLink",
] as const

export type TelegramAccountTriggerPostField = (typeof TELEGRAM_ACCOUNT_TRIGGER_POST_FIELDS)[number]

/** Message facts carried alongside — read through trigger tokens and JSON-authored wires. */
export const TELEGRAM_ACCOUNT_TRIGGER_MESSAGE_FIELDS = [
  "chatId",
  "chatType",
  "messageId",
  "senderId",
] as const

/** Every handle the card renders, `out` first. */
export const TELEGRAM_ACCOUNT_TRIGGER_OUTPUT_HANDLES: readonly string[] = [
  TELEGRAM_ACCOUNT_TRIGGER_MESSAGE_HANDLE,
  ...TELEGRAM_ACCOUNT_TRIGGER_POST_FIELDS,
]

const NAMED_HANDLES: ReadonlySet<string> = new Set([...TELEGRAM_ACCOUNT_TRIGGER_POST_FIELDS, ...TELEGRAM_ACCOUNT_TRIGGER_MESSAGE_FIELDS])

/**
 * A handle naming one value of the run (a post field or a message fact) —
 * every handle but the message itself. A wire from one carries that value,
 * "" when the run has none, never the message in its place.
 */
export function isTelegramAccountTriggerNamedHandle(handle: unknown): handle is string {
  return typeof handle === "string" && NAMED_HANDLES.has(handle)
}

/**
 * What an account trigger listens to, and whether it listens: the settings
 * only its owner may set. One canonical string, so the editor that changed a
 * trigger and the server that arms it compare the same thing — the server
 * arms a trigger the owner's editor named only while the stored node still
 * says exactly what that editor set.
 *
 * It states what the trigger hears, not how the node spells it: in inbox mode
 * the owner's own messages are always heard, so `includeOutgoing` reads as on
 * there — a setting the panel does not show in that mode never decides a match.
 * The account id is the one exception: it is read exactly as written, because
 * the server never listens on one that is not written exactly (padded), and
 * the editor shows such an id as no account of the owner's.
 */
export function telegramAccountListeningSignature(data: unknown): string {
  const d = (data !== null && typeof data === "object" ? data : {}) as Record<string, unknown>
  const list = (value: unknown): string[] =>
    Array.isArray(value)
      ? [...new Set(value.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter((x) => x !== ""))].sort()
      : []
  return JSON.stringify({
    accountId: typeof d.accountId === "string" ? d.accountId : "",
    chatIds: list(d.chatIds),
    senderIds: list(d.senderIds),
    messageTypeFilters: list(d.messageTypeFilters),
    keywords: list(d.keywords),
    includeOutgoing: d.inboxMode === true || d.includeOutgoing === true,
    inboxMode: d.inboxMode === true,
    isActive: d.isActive === true,
  })
}

function stringField(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return ""
}

/**
 * The named outputs of one run, from its trigger data: every post field
 * present (possibly ""), each message field only when it has a value.
 */
export function telegramAccountTriggerOutputs(triggerData: Record<string, unknown> | null | undefined): Record<string, string> {
  const td = triggerData ?? {}
  const out: Record<string, string> = {}
  for (const key of TELEGRAM_ACCOUNT_TRIGGER_POST_FIELDS) out[key] = stringField(td[key])
  for (const key of TELEGRAM_ACCOUNT_TRIGGER_MESSAGE_FIELDS) {
    const value = stringField(td[key])
    if (value !== "") out[key] = value
  }
  return out
}
