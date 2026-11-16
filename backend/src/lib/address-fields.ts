/**
 * WHICH FIELDS OF A REQUEST CAN CARRY AN ADDRESS, AND WHICH VALUES ARE JUDGED
 * (decided 2026-11-11 for MCP tool calls, `lib/mcp/tool-addresses.ts`; shared
 * since 2026-11-16 with the media-input funnel, `lib/input-links.ts`). One rule
 * for both lanes: a field's NAME says what it holds, and a value is judged
 * only when it reads as a web address. What is judged about the address itself
 * is `isOutsideLink` (`lib/link-imports.ts`), never anything here.
 *
 * A pure leaf: no imports.
 */

/** How a field's value is read for addresses. */
export type AddressForm = "address" | "text" | "subtree" | "json"

/** A name's last word, as snake_case or camelCase writes it, a trailing number skipped (`audio_url_1` → `url`). */
export function lastWord(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[_\-\s]+/)
    .filter((w) => w && !/^\d+$/.test(w))
  return (words.at(-1) ?? "").toLowerCase()
}

/** Last words that name an address. */
export const ADDRESS_WORDS: ReadonlySet<string> = new Set(["url", "urls", "uri", "uris", "href", "link", "links", "website", "homepage"])

/** Last words that name media, whose value may be an address. */
export const MEDIA_WORDS: ReadonlySet<string> = new Set([
  "image", "images", "photo", "photos", "picture", "pictures", "video", "videos", "audio", "audios", "clip", "clips",
  "media", "logo", "logos", "avatar", "avatars", "poster", "posters", "thumbnail", "thumbnails", "source", "sources", "file", "files",
])

/**
 * The form a string field takes by its name alone: an ADDRESS (`…url`,
 * `…link`, `website`), TEXT that may hold one (`…image`, `…video`, `…source`),
 * a JSON text the reader parses (`…json`), or undefined — a field whose name
 * says nothing of an address (a prompt, an id, a mode).
 */
export function fieldFormByName(name: string): Exclude<AddressForm, "subtree"> | undefined {
  const word = lastWord(name)
  if (ADDRESS_WORDS.has(word)) return "address"
  if (word === "json") return "json"
  if (MEDIA_WORDS.has(word)) return "text"
  return undefined
}

const FETCHED_SCHEME = /^(?:https?|wss?|ftp|file):/i
const SCHEMELESS_HOST = /^(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}\.?|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#\\]|$)/i

/** The value as a URL parser starts reading it: tabs and line breaks dropped, leading spaces and controls skipped. */
function asParsed(value: string): string {
  return value.replace(/[\t\n\r]/g, "").replace(/^[\u0000- ]+/, "")
}

/**
 * Whether a string value of a field of this form reads as a web address, and
 * is judged: a scheme a URL parser fetches from (http, https, ws, wss, ftp,
 * file) after the tabs and line breaks a parser drops; in an ADDRESS also a
 * host written without its scheme (`example.com/a.png`) and a `//host` start.
 */
export function readsAsAddress(value: string, form: AddressForm): boolean {
  const v = asParsed(value)
  if (FETCHED_SCHEME.test(v)) return true
  return form === "address" && (/^[\\/]{2}/.test(v) || SCHEMELESS_HOST.test(v))
}

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * The value a string holds when a reader may read it as JSON — an array or an
 * object written as text (a reference list, an edit decision list); undefined
 * when it is not one.
 */
export function asJsonText(value: string): unknown {
  const t = value.trim()
  if (!t.startsWith("[") && !t.startsWith("{")) return undefined
  try {
    return JSON.parse(t) as unknown
  } catch {
    return undefined
  }
}

/** Every string anywhere inside `value`, the value itself included, and inside any JSON text among them. */
export function stringsIn(value: unknown): string[] {
  const out: string[] = []
  const stack: unknown[] = [value]
  while (stack.length > 0) {
    const v = stack.pop()
    if (typeof v === "string") {
      out.push(v)
      const parsed = asJsonText(v)
      if (parsed !== undefined) stack.push(parsed)
    } else if (Array.isArray(v)) stack.push(...v)
    else if (isRecord(v)) stack.push(...Object.values(v))
  }
  return out
}

/**
 * The values of one string field of this form that are judged: the value
 * itself, and — a list or an object the reader takes from text — every string
 * inside it, each that reads as a web address.
 */
export function judgedValues(value: string, form: Exclude<AddressForm, "subtree" | "json">): string[] {
  return [value, ...stringsIn(asJsonText(value))].filter((s) => readsAsAddress(s, form))
}

/** Every string inside a value taken whole (a subtree), each that reads as a web address. */
export function judgedSubtreeValues(value: unknown): string[] {
  return stringsIn(value).filter((s) => readsAsAddress(s, "text"))
}
