/**
 * The ONE rule both engines use when a text-shaped wire reaches a social post:
 * a value that is exactly one media LINK — and nothing else — carries the
 * medium, not the caption. An Extract Field over a saved record's cover posts
 * the picture; a page link, a sentence with a link in it, a JSON value or a
 * format no platform posts stays the caption (decided 2026-10-08).
 *
 * The file name is read from the parsed URL's PATH, anchored at its end: a host
 * that merely contains a file ending (`movistar.es`, `webmd.com`, `gifs.com`)
 * or a file name in the query (`?img=a.png`) is a page link. Only the formats
 * the platforms accept count — avif / heic / svg / bmp are not pictures to
 * Telegram, X or Instagram and would fail the post.
 */
import { AUDIO_PRODUCER_TYPES, DYNAMIC_PRODUCER_TYPES, IMAGE_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES } from "./producer-types.js"
import { ENTITY_NODE_KINDS } from "./entity-node-fields.js"

export type LoneMediaUrlKind = "image" | "video"

const IMAGE_FILE_RE = /\.(png|jpe?g|gif|webp)$/i
const VIDEO_FILE_RE = /\.(mp4|mov|webm|m4v)$/i

/** Which medium a text value is when its WHOLE value is one media link; `null`
 *  for anything else (empty, several words, a comma-joined pair of links, a
 *  page link, a file ending in the host or the query, an unsupported format). */
export function loneMediaUrlKind(value: string): LoneMediaUrlKind | null {
  const s = value.trim()
  if (s.length === 0 || /[\s,]/.test(s) || !/^https?:\/\//i.test(s)) return null
  let pathname: string
  try {
    pathname = new URL(s).pathname
  } catch {
    return null
  }
  if (IMAGE_FILE_RE.test(pathname)) return "image"
  if (VIDEO_FILE_RE.test(pathname)) return "video"
  return null
}

/** A trigger whose ONE wire carries a message's text AND its medium (the
 *  caption and the photo of an incoming Telegram message): both engines route
 *  the two together from the message itself, so the wire's single value is
 *  never read as "one media link". */
const MESSAGE_TRIGGER_TYPES: ReadonlySet<string> = new Set(["telegram-trigger", "telegram-account-trigger"])

/** A source whose wire a social post reads as TEXT: not a declared image, video
 *  or audio producer, not a dynamic (multi-typed) one such as List — whose typed
 *  columns route by column type — not a message trigger, and not an entity
 *  whose picture is a reference. Derived from the producer sets, so a new text
 *  node is covered and a new media node (which must join its producer set to
 *  connect at all) is excluded, with nothing to remember. */
export function isLoneMediaLinkSource(nodeType: string | null | undefined): boolean {
  if (!nodeType) return false
  if (IMAGE_PRODUCER_TYPES.has(nodeType) || VIDEO_PRODUCER_TYPES.has(nodeType) || AUDIO_PRODUCER_TYPES.has(nodeType)) return false
  if (DYNAMIC_PRODUCER_TYPES.has(nodeType) || MESSAGE_TRIGGER_TYPES.has(nodeType)) return false
  if ((ENTITY_NODE_KINDS as readonly string[]).includes(nodeType) || nodeType === "face") return false
  return true
}
