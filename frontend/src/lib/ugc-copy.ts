/**
 * The UGC routes name what they send in English: a product category
 * (`GET /v1/ugc/categories`) and each line of a quote (`POST /v1/ugc/quote`).
 * The editor names each in the person's language by its stable id. English
 * keeps the server's own words, as a server error does (api-error-copy.ts);
 * so does an id this table does not list, a line saved before lines had ids,
 * and a language with no sentence of its own. A sentence a UGC node fails with
 * is read the same way, by the shared sentence itself.
 */
import { UGC_CREATOR_NO_IMAGE_MESSAGE, type UgcQuoteLineKey } from "@nodaro/render-rules"
import { UGC_NODE_MESSAGES, UGC_SCRIPT_NEEDS_CHANGES, type UgcNodeMessageId } from "@nodaro/shared"
import { tx, type MessageKey } from "@/lib/i18n"
import { DICTS } from "@/lib/i18n/dicts"
import { useLocaleStore } from "@/lib/locale-store"
import { ugcSeconds } from "@/lib/ugc-node-cards"

/** The product categories the UGC routes serve, by id. */
export const UGC_CATEGORY_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  skincare: "ugc.category.skincare",
  cosmetics: "ugc.category.cosmetics",
  haircare: "ugc.category.haircare",
  teeth: "ugc.category.teeth",
  sleep: "ugc.category.sleep",
  fitness: "ugc.category.fitness",
  fashion: "ugc.category.fashion",
  tech: "ugc.category.tech",
  food: "ugc.category.food",
  saas: "ugc.category.saas",
  other: "ugc.category.other",
}

/** Every quote line by its id; a clip line is named with its number and length (`ugc.clips.clipLength`). */
export const UGC_QUOTE_LINE_LABEL_KEYS: Readonly<Record<Exclude<UgcQuoteLineKey, "clip">, MessageKey>> = {
  join: "ugc.quote.join",
  alignment: "ugc.quote.alignment",
  speechCheck: "ugc.quote.speechCheck",
  cards: "ugc.quote.cards",
  captions: "ugc.quote.captions",
  script: "ugc.quote.script",
  creatorImage: "ugc.quote.creatorImage",
  creatorCheck: "ugc.quote.creatorCheck",
  speech: "ugc.quote.speech",
  split: "ugc.quote.split",
  finish: "ugc.quote.finish",
}

/**
 * Every fixed sentence a UGC node fails with (`UGC_NODE_MESSAGES`, the English both engines write
 * on the node), by its id. Typed by the id, so a new sentence without its own entry fails tsc.
 */
export const UGC_NODE_MESSAGE_KEYS: Readonly<Record<UgcNodeMessageId, MessageKey>> = {
  notServed: "ugc.msg.notServed",
  version: "ugc.msg.version",
  newerApp: "ugc.msg.newerApp",
  pickGone: "ugc.msg.pickGone",
  creatorMissing: "ugc.msg.creatorMissing",
  minorAge: "ugc.msg.minorAge",
  needsGender: "ugc.msg.needsGender",
  needsPhoto: "ugc.msg.needsPhoto",
  needsCategory: "ugc.msg.needsCategory",
  needsSite: "ugc.msg.needsSite",
  needsPlanOut: "ugc.msg.needsPlanOut",
  needsPlan: "ugc.msg.needsPlan",
  needsTicket: "ugc.msg.needsTicket",
  needsVideo: "ugc.msg.needsVideo",
  needsTranscript: "ugc.msg.needsTranscript",
  needsFinish: "ugc.msg.needsFinish",
  finishNeedsClips: "ugc.msg.finishNeedsClips",
  finishNotReady: "ugc.msg.finishNotReady",
}

/** A UGC Creator option whose image job finished with no image (`UGC_CREATOR_NO_IMAGE_MESSAGE`, `@nodaro/render-rules`). */
export const UGC_CREATOR_NO_IMAGE_KEY: MessageKey = "ugc.msg.creatorNoImage"

/**
 * A script the plugin refuses: `UGC_SCRIPT_NEEDS_CHANGES` and then the plugin's own words, which
 * come as they are (`{details}`).
 */
export const UGC_SCRIPT_NEEDS_CHANGES_KEY: MessageKey = "ugc.msg.scriptNeedsChanges"

/** The dictionary's sentence where the interface language has its own; else the server's words. */
function inOwnLanguage(serverLabel: string, key: MessageKey, vars?: Record<string, string | number>): string {
  const locale = useLocaleStore.getState().locale
  return locale !== "en" && DICTS[locale]?.[key] !== undefined ? tx(key, vars) : serverLabel
}

/** Each fixed sentence a UGC node fails with → its entry, keyed by the shared sentence itself (never retyped here). */
const UGC_NODE_MESSAGE_KEY_BY_TEXT: ReadonlyMap<string, MessageKey> = new Map<string, MessageKey>([
  ...(Object.keys(UGC_NODE_MESSAGES) as UgcNodeMessageId[]).map((id) => [UGC_NODE_MESSAGES[id], UGC_NODE_MESSAGE_KEYS[id]] as const),
  [UGC_CREATOR_NO_IMAGE_MESSAGE, UGC_CREATOR_NO_IMAGE_KEY],
])

/**
 * A sentence a UGC node failed with, as the person reads it. Both engines write it in English (the
 * same shared sentence, on the canvas and on the server); the node stores it as written, and every
 * place that shows it reads it through here. A fixed sentence is said in the person's language; a
 * refused script's opening is too, and the plugin's own words after it stay as they came. English,
 * a language with no sentence of its own, and any other message (a route's own, a forwarded issue)
 * keep the words as written.
 */
export function ugcNodeMessageText(message: string): string {
  const key = UGC_NODE_MESSAGE_KEY_BY_TEXT.get(message)
  if (key) return inOwnLanguage(message, key)
  const opening = `${UGC_SCRIPT_NEEDS_CHANGES} `
  return message.startsWith(opening) && message.length > opening.length
    ? inOwnLanguage(message, UGC_SCRIPT_NEEDS_CHANGES_KEY, { details: message.slice(opening.length) })
    : message
}

/** A product category as the person reads it: by its id, else the server's label. */
export function ugcCategoryLabel(id: string, serverLabel: string): string {
  return Object.hasOwn(UGC_CATEGORY_LABEL_KEYS, id) ? inOwnLanguage(serverLabel, UGC_CATEGORY_LABEL_KEYS[id]!) : serverLabel
}

/** A quote line as the person reads it: by its id (a clip with its number and length), else the server's label. */
export function ugcQuoteLineLabel(line: { readonly label: string; readonly key?: unknown; readonly n?: unknown; readonly seconds?: unknown }): string {
  if (line.key === "clip") {
    return typeof line.n === "number" && typeof line.seconds === "number"
      ? inOwnLanguage(line.label, "ugc.clips.clipLength", { n: line.n, seconds: ugcSeconds(line.seconds) })
      : line.label
  }
  return typeof line.key === "string" && Object.hasOwn(UGC_QUOTE_LINE_LABEL_KEYS, line.key)
    ? inOwnLanguage(line.label, UGC_QUOTE_LINE_LABEL_KEYS[line.key as keyof typeof UGC_QUOTE_LINE_LABEL_KEYS])
    : line.label
}
