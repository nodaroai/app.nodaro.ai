import type { CollectionFieldValue, CollectionRecord } from "@nodaro/shared"

/**
 * How a collection record reads on a card — the Collections page and the
 * Read Collection node show the same picture, date and author for it.
 */

/** The picture a record shows: its first image, else its first video's poster. */
export function recordStill(record: CollectionRecord): string | undefined {
  const image = record.media.find((m) => m.type === "image")
  if (image) return image.url
  return record.media.find((m) => m.type === "video" && m.posterUrl)?.posterUrl
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
