import { loneMediaUrlKind, type CollectionFieldValue, type CollectionRecord, type CollectionRecordSource } from "@nodaro/shared"
import { httpLink, linkSiteName } from "@/lib/post-site"

/**
 * The four tints the record cards cycle through, so neighbours read apart:
 * the card, its border and the accent stripe on its leading edge, per theme.
 */
export const CARD_TINTS = [
  "bg-[#eef5fb] border-[#c9dff0] border-s-[#2b8ac4] dark:bg-[#141a1f] dark:border-[#24343f] dark:border-s-[#3b9fd1]",
  "bg-[#fbeff6] border-[#efc8de] border-s-[#c8237f] dark:bg-[#1a1418] dark:border-[#3a2531] dark:border-s-[#c8237f]",
  "bg-[#eef8f3] border-[#c4e6d6] border-s-[#2a9a72] dark:bg-[#15191a] dark:border-[#273832] dark:border-s-[#3cb389]",
  "bg-[#fbf4e8] border-[#efdcb7] border-s-[#b97f1f] dark:bg-[#1a1713] dark:border-[#3a3022] dark:border-s-[#d19a3b]",
] as const

/** The tint of the record at a position in the list (the running number, so a page keeps its colours as it scrolls). */
export function cardTint(index: number): string {
  return CARD_TINTS[((index % CARD_TINTS.length) + CARD_TINTS.length) % CARD_TINTS.length]!
}

/** The fields a record names its source in, in the order they are trusted. */
export const SOURCE_NAME_FIELDS = ["primarySource", "source", "channel", "author"] as const
/** The fields the card shows elsewhere (the source line, the thumbnail), so they are not repeated as chips. */
export const FIELDS_SHOWN_ELSEWHERE: ReadonlySet<string> = new Set([...SOURCE_NAME_FIELDS, "mediaUrl", "mediaKind"])

/**
 * Where a record came from: the source it names among its fields (an article's
 * publisher, a channel, an author), else its link's site; the link is the
 * record's own link, when it has one — a named source without a link stays text.
 */
export function recordSource(record: CollectionRecord): { readonly name: string; readonly href: string | null } | null {
  const href = httpLink(record.url)
  for (const key of SOURCE_NAME_FIELDS) {
    const v = record.fields[key]
    if (typeof v === "string" && v.trim()) return { name: v.trim(), href }
  }
  return href ? { name: linkSiteName(href) ?? href, href } : null
}

/** The record's first video, when it has one (in `media`, else named among its fields): its link and its poster. */
export function recordVideo(record: CollectionRecord): { readonly url: string; readonly posterUrl: string | null } | null {
  const video = record.media.find((m) => m.type === "video")
  if (video) return { url: video.url, posterUrl: video.posterUrl ?? null }
  const named = fieldMedium(record)
  return named?.kind === "video" ? { url: named.url, posterUrl: null } : null
}

/**
 * How a collection record reads on a card — the Collections page and the
 * Read Collection node show the same picture, date and author for it.
 */

/**
 * Where a record's origin — who saved it, or who used it — links in the app:
 * the workflow's editor, and the run inside it (the editor opens on its
 * Executions tab with that run expanded). Both need the workflow's project,
 * which the API adds when it lists records; a workflow that is not the
 * person's, or a record written by hand, has no link.
 */
export function recordOrigin(source: CollectionRecordSource | undefined): { readonly workflowHref: string | null; readonly runHref: string | null } {
  if (!source?.workflowId || !source.projectId) return { workflowHref: null, runHref: null }
  const workflowHref = `/projects/${encodeURIComponent(source.projectId)}/workflows/${encodeURIComponent(source.workflowId)}`
  const runHref = source.executionId ? `${workflowHref}?tab=executions&execution=${encodeURIComponent(source.executionId)}` : null
  return { workflowHref, runHref }
}

/** The day a timestamp falls on, in the browser's timezone (`YYYY-MM-DD`) — what the page groups records by. */
export function localDayOf(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Local midnight of a `YYYY-MM-DD` day (plus `offsetDays`), as the ISO instant the API filters on. */
export function localDayStartIso(day: string, offsetDays = 0): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) return undefined
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + offsetDays)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

/**
 * A medium the record names among its fields rather than in `media` — a
 * `mediaUrl` with its kind beside it (`mediaKind`), else by the file's ending.
 * Records saved before the ingest learned the key carry it only here.
 */
function fieldMedium(record: CollectionRecord): { readonly kind: "image" | "video"; readonly url: string } | null {
  const url = httpLink(record.fields.mediaUrl)
  if (!url) return null
  const kind = record.fields.mediaKind
  if (kind === "image" || kind === "photo") return { kind: "image", url }
  if (kind === "video") return { kind, url }
  const byEnding = loneMediaUrlKind(url)
  return byEnding ? { kind: byEnding, url } : null
}

/** The picture a record shows: its first image, else its first video's poster, else an image named among its fields. */
export function recordStill(record: CollectionRecord): string | undefined {
  const image = record.media.find((m) => m.type === "image")
  if (image) return image.url
  const poster = record.media.find((m) => m.type === "video" && m.posterUrl)?.posterUrl
  if (poster) return poster
  const named = fieldMedium(record)
  return named?.kind === "image" ? named.url : undefined
}

/**
 * The fields a saved post carries its own date in: Social Search's
 * `publishedAt`, a Telegram post's `date`, Instagram Scrape's `timestamp`.
 * A record keeps every other scalar of the item it came from in `fields`.
 */
const POSTED_AT_FIELDS = ["publishedAt", "date", "timestamp"] as const

/**
 * Only an ISO date counts ("2026-10-06", "2026-10-06T09:00:00Z"): a looser
 * parse reads "6.10.2026" as June 10 and "Post 1" as 2001, and a wrong date
 * is worse than none (the card then says when the record was saved).
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]|$)/

const asDate = (v: CollectionFieldValue | undefined): string | null =>
  typeof v === "string" && ISO_DATE.test(v.trim()) && !Number.isNaN(Date.parse(v)) ? v.trim() : null

/** When the post itself went out, if the item it was saved from said so; null otherwise. */
export function recordPostedAt(record: CollectionRecord): string | null {
  for (const key of POSTED_AT_FIELDS) {
    const at = asDate(record.fields[key])
    if (at) return at
  }
  return null
}

/** The fields an author's handle arrives in, then the fields a name does. */
const HANDLE_FIELDS = ["handle", "username", "ownerUsername", "channel"] as const
const NAME_FIELDS = ["author", "authorName", "ownerFullName"] as const
/** A handle is one word of letters, digits, `_` and `.`; anything else in a handle field is a name. */
const HANDLE = /^@?[\w.]{1,64}$/

const text = (v: CollectionFieldValue | undefined): string => (typeof v === "string" ? v.trim() : "")

/** Who posted it: "@handle" when the item carried one, else a name, else empty. */
export function recordAuthor(record: CollectionRecord): { readonly label: string; readonly isHandle: boolean } {
  let name = ""
  for (const key of HANDLE_FIELDS) {
    const v = text(record.fields[key])
    if (!v) continue
    if (HANDLE.test(v)) return { label: `@${v.replace(/^@/, "")}`, isHandle: true }
    name ||= v
  }
  for (const key of NAME_FIELDS) {
    const v = text(record.fields[key])
    if (v) return { label: v, isHandle: false }
  }
  return { label: name, isHandle: false }
}
