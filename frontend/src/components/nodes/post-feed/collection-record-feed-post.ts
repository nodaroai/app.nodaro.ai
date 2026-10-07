import type { CollectionRecord } from "@nodaro/shared"
import type { TFunction } from "@/lib/i18n"
import { formatNumber } from "@/lib/i18n/format"
import { recordAuthor, recordPostedAt, recordStill } from "@/lib/collection-record-view"
import { httpLink, linkSiteName } from "@/lib/post-site"
import { initialOf, postDateLabel, viewsLabel } from "@/lib/post-display"
import type { FeedPost } from "./feed-post"

/** A view count a saved post carried, as the source wrote it ("1,204" or "1.52M"). */
function viewsOf(record: CollectionRecord): string | null {
  const v = record.fields.views
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return formatNumber(v)
  if (typeof v === "string" && v.trim()) return v.trim()
  return null
}

/**
 * A collection record on the shared post feed card: its title as the heading
 * (else who posted it), its text, its picture, the post's own date (else when
 * it was saved), and "Open in <site>" for its link.
 */
export function collectionRecordFeedPost(record: CollectionRecord, t: TFunction): FeedPost {
  const title = record.title.trim()
  const author = recordAuthor(record)
  const heading = title || author.label
  const body = record.text.trim()
  const postedAt = recordPostedAt(record)
  const savedAt = postDateLabel(record.createdAt)
  const when = postedAt ? postDateLabel(postedAt) : savedAt ? t("collections.savedOn", { date: savedAt }) : ""
  const openUrl = httpLink(record.url)
  const site = linkSiteName(openUrl) ?? ""
  const video = record.media.find((m) => m.type === "video")
  const views = viewsOf(record)
  return {
    key: record.id,
    previewUrl: recordStill(record) ?? null,
    video: video ? { url: httpLink(video.url) } : null,
    initial: initialOf(author.label || title || site),
    heading,
    headingDir: !title && author.isHandle ? "ltr" : "auto",
    ...(views ? { stat: viewsLabel(views, t) } : {}),
    text: body === title ? "" : body,
    meta: [when, title ? author.label : ""],
    openUrl,
    site,
  }
}
