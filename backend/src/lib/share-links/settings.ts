/**
 * A shared job's `settings` and `references`, read off its `input_data` (pure).
 *
 * `settings` is what the person chose, never what the platform kept beside it:
 *  - the prompt fields are moved out (to `prompt` / `negativePrompt`), and the
 *    model fields become `model`;
 *  - internal keys go at every depth: the server-only `__` keys, ids of rows
 *    (user, job, session, project, workspace, run, …), credits and prices,
 *    webhooks and callbacks, the provider or vendor a model runs on, tokens and
 *    secrets, storage keys, error text, and every key `nonAdminJobInputData`
 *    hides from a non-admin;
 *  - then every VALUE that is an address or names an id (a URL, a uuid, a
 *    path or storage key, a vendor's `maker/model` route, a host or file name,
 *    an email, a long id or hash) goes, whatever its key is called — so a
 *    field this file has never heard of cannot carry a link or an id out. A
 *    nested object that held such a value is a reference (an image and its
 *    role, a mention and its character) and goes whole.
 *
 * Keys are compared without case, `_` or `-` (`user_ID` is `userId`).
 *
 * With "allow copy" the https addresses become `references` — the files the
 * result was made from — read by the same walk, so an address under an
 * internal key (a webhook, a callback) is never one.
 */
import type { SharedMediaKind, SharedReference, SharedSettingValue } from "./types.js"

/** Top-level keys that are moved out to their own fields. */
export const MOVED_INPUT_KEYS: ReadonlySet<string> = new Set([
  "type",
  "prompt",
  "userPrompt",
  "negativePrompt",
  "model",
  "resolvedModel",
  "provider",
  "trend",
])

/** A key as the lists below compare it: lower case, without `_`, `-` or spaces (`user_ID` reads as `userid`). */
function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[_\-\s]/g, "")
}

/**
 * Keys that never leave the server, at any depth, compared normalized. The
 * list `nonAdminJobInputData` hides (`userId`, `jobId`, `usageLogId`,
 * `force_private`, `provider`, `resolvedModel`) is a subset.
 */
const INTERNAL_KEY_NAMES: ReadonlySet<string> = new Set(
  [
    "usageLogId", "force_private", "provider", "resolvedModel", "origin", "idempotencyKey",
    "mcpClient", "source", "sourceDetail", "importVia", "unscoredUrl", "lane", "engine", "units",
  ].map(normalizedKey),
)

/** The id of a row or of something outside (`userId`, `workspace_id`, `chat_id`, `taskIds`), compared normalized. */
const ID_KEY =
  /^(user|job|session|project|workspace|org|organization|workflow|execution|workflowexecution|node|app|apprun|run|parent|parentjob|owner|asset|upload|account|member|thread|turn|chat|message|customer|payment|invoice|subscription|task|providertask|request|trace|team|tenant|device|install|client|batch|cover)ids?$/

/** Key patterns that never leave the server, at any depth, tested on the key as written and normalized. */
const INTERNAL_KEY_PATTERNS: readonly RegExp[] = [
  /^_/, // `__` server-only keys, and any other underscore-private key
  /credit/i,
  /cost/i,
  /pric(e|ing)/i,
  /billing/i,
  /billed/i,
  /payer/i,
  /reservation/i,
  /usage/i,
  /webhook/i,
  /callback/i,
  /notif/i,
  /redirect/i,
  /endpoint/i,
  /provider/i,
  /vendor/i,
  /secret/i,
  /token/i,
  /^headers?$/i,
  /authori[sz]ation/i,
  /cookie/i,
  /credential/i,
  /api_?key/i,
  /password/i,
  /email/i,
  /error/i,
  /signature/i,
  /idempotency/i,
  /storage/i,
  /bucket/i,
  /^r2/i,
  /object_?key/i,
  // A routing vendor's own field (`kieModel`, `fal_request`); case-sensitive, so `falloff` is a setting.
  /^(kie|fal|replicate|wavespeed|openrouter|apify|beeble)(?=[A-Z_]|$)/,
]

export function isInternalKey(key: string): boolean {
  const normalized = normalizedKey(key)
  return INTERNAL_KEY_NAMES.has(normalized) || ID_KEY.test(normalized) || INTERNAL_KEY_PATTERNS.some((re) => re.test(key))
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const URL_LIKE = /(^|[^a-z0-9])[a-z][a-z0-9+.-]*:\/\/|^(data|blob|javascript):|^\/\//i
/** One word with a `/` in it: a path, a storage key, a vendor's `maker/model` route, a host and path. */
const PATH_LIKE = /^\S*\/\S*$/
/** A host name, alone or with a port (`cdn.example.com`), or a file name (`photo.png`). */
const HOST_LIKE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?$/i
/** A long run of letters and digits with no space: an id or a key of something outside (a customer, a task). */
const TOKEN_LIKE = /^(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}$/
/** A hexadecimal run of 16 or more: a hash or an id. */
const HEX_LIKE = /^[0-9a-f]{16,}$/i
/** An email address anywhere in the value: a person's, never a setting to hand out. */
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i
/** The routing lanes a model runs on, never shown (the model's own name is). */
const ROUTE_NAMES: ReadonlySet<string> = new Set(["kie", "kie.ai", "fal", "fal.ai", "replicate", "wavespeed", "openrouter"])

/** A string that names an address or an id, and so is no setting. */
export function isAddressOrId(value: string): boolean {
  const v = value.trim()
  return (
    URL_LIKE.test(v) ||
    UUID.test(v) ||
    PATH_LIKE.test(v) ||
    HOST_LIKE.test(v) ||
    TOKEN_LIKE.test(v) ||
    HEX_LIKE.test(v) ||
    EMAIL.test(v) ||
    ROUTE_NAMES.has(v.toLowerCase())
  )
}

/** The deepest a setting may nest; deeper values are left out. */
const MAX_DEPTH = 4
/** The most items one list keeps. */
const MAX_LIST = 100
/** The longest string a setting keeps (a lyric sheet fits; a pasted document does not). */
const MAX_STRING = 10_000

type Walked = { readonly value: SharedSettingValue | undefined; readonly droppedAddress: boolean }
const NOTHING: Walked = { value: undefined, droppedAddress: false }

function walk(value: unknown, depth: number): Walked {
  if (typeof value === "string") {
    if (isAddressOrId(value)) return { value: undefined, droppedAddress: true }
    return value.length > MAX_STRING ? NOTHING : { value, droppedAddress: false }
  }
  if (typeof value === "number") return Number.isFinite(value) ? { value, droppedAddress: false } : NOTHING
  if (typeof value === "boolean") return { value, droppedAddress: false }
  if (value === null || typeof value !== "object" || depth > MAX_DEPTH) return NOTHING
  if (Array.isArray(value)) {
    const walked = value.slice(0, MAX_LIST).map((item) => walk(item, depth + 1))
    const items = walked.flatMap((w) => (w.value === undefined ? [] : [w.value]))
    // A list that held an address (a list of images) makes its object a reference too.
    const droppedAddress = walked.some((w) => w.droppedAddress)
    return { value: items.length > 0 ? items : undefined, droppedAddress }
  }
  const kept = keptEntries(value as Record<string, unknown>, depth)
  // A nested object that held an address or an id is a reference: it goes whole.
  if (kept.droppedAddress) return { value: undefined, droppedAddress: false }
  return kept.entries.length > 0 ? { value: Object.fromEntries(kept.entries), droppedAddress: false } : NOTHING
}

function keptEntries(
  obj: Record<string, unknown>,
  depth: number,
): { entries: Array<[string, SharedSettingValue]>; droppedAddress: boolean } {
  let droppedAddress = false
  const entries = Object.entries(obj).flatMap(([key, item]): Array<[string, SharedSettingValue]> => {
    if (isInternalKey(key)) return []
    const w = walk(item, depth + 1)
    if (w.droppedAddress) droppedAddress = true
    return w.value === undefined ? [] : [[key, w.value]]
  })
  return { entries, droppedAddress }
}

/**
 * The settings a link shows, from a job's `input_data`. `alsoMoved` names more
 * top-level keys taken out to their own field (`text`, when it was the prompt).
 */
export function publicSettingsOf(
  inputData: unknown,
  alsoMoved: readonly string[] = [],
): { readonly [key: string]: SharedSettingValue } {
  if (inputData === null || typeof inputData !== "object" || Array.isArray(inputData)) return {}
  const moved = new Set([...MOVED_INPUT_KEYS, ...alsoMoved])
  const top = Object.fromEntries(Object.entries(inputData as Record<string, unknown>).filter(([key]) => !moved.has(key)))
  // The top level is the job's input, never a reference: only its own values go.
  return Object.fromEntries(keptEntries(top, 0).entries)
}

/* ------------------------------------------------------------- references */

/** A query that carries a signature, a token or a key: such an address is never handed out. */
const SIGNED_URL = /[?&](x-amz-|x-goog-|__token__=|token=|access_token=|jwt=|hmac=|hdnts=|policy=|key-pair-id=|signature=|sig=|expires=|key=|api_?key=|auth=)/i
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi)(?:[?#]|$)/i
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|weba)(?:[?#]|$)/i
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|bmp|svg)(?:[?#]|$)/i
/** The most references one link lists. */
export const MAX_REFERENCES = 32

/** A whole https address, unsigned: one a link may hand out. */
export function isShareableAddress(value: string): boolean {
  if (!/^https:\/\/[^\s]+$/i.test(value) || SIGNED_URL.test(value)) return false
  try {
    const url = new URL(value)
    // An address that carries a user name or a password is never handed out.
    return url.protocol === "https:" && !url.username && !url.password
  } catch {
    return false
  }
}

function kindOf(url: string, path: readonly string[]): SharedMediaKind {
  if (VIDEO_EXT.test(url) || /\/videos\//.test(url)) return "video"
  if (AUDIO_EXT.test(url) || /\/audios?\//.test(url)) return "audio"
  if (IMAGE_EXT.test(url) || /\/images\//.test(url)) return "image"
  const where = path.join(".")
  if (/video|clip|motion|footage/i.test(where)) return "video"
  if (/audio|voice|music|sound|song|speech|track/i.test(where)) return "audio"
  return "image"
}

/**
 * The files a job was made from: every https address in its `input_data`
 * under a key that is not internal, in the order met, once each, at most
 * `MAX_REFERENCES`. `exclude` drops the job's own outputs (echoed in an input).
 */
export function referencesOf(inputData: unknown, exclude: ReadonlySet<string> = new Set()): SharedReference[] {
  const out: SharedReference[] = []
  const seen = new Set<string>(exclude)
  const visit = (value: unknown, path: readonly string[], depth: number): void => {
    if (out.length >= MAX_REFERENCES || depth > MAX_DEPTH + 1) return
    if (typeof value === "string") {
      const url = value.trim()
      if (!isShareableAddress(url) || seen.has(url)) return
      seen.add(url)
      out.push({ url, kind: kindOf(url, path) })
      return
    }
    if (value === null || typeof value !== "object") return
    if (Array.isArray(value)) {
      for (const item of value.slice(0, MAX_LIST)) visit(item, path, depth + 1)
      return
    }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (depth === 0 && MOVED_INPUT_KEYS.has(key)) continue
      if (isInternalKey(key)) continue
      visit(item, [...path, key], depth + 1)
    }
  }
  visit(inputData, [], 0)
  return out
}
