import type { SocialPost } from "@nodaro/shared"
import type { TFunction } from "@/lib/i18n"
import { formatNumber } from "@/lib/i18n/format"
import { SOCIAL_PLATFORM_META } from "@/components/research/social-platforms"
import { httpLink, linkSiteName } from "@/lib/post-site"
import { initialOf, postDateLabel, viewsLabel } from "@/lib/post-display"
import type { FeedPost } from "./feed-post"

/** A post a reader emits: a Social Search post, plus when it was saved for a Read Inspiration post. */
export type ReaderPost = SocialPost & { readonly savedAt?: string }

/**
 * A social post (Read Inspiration, Read Competitor) on the shared post feed
 * card: its title, else who posted it, as the heading; its views; the day it
 * was published and, for a saved post, the day it was saved; "Open in <its
 * platform>" for its page.
 */
export function socialPostFeedPost(post: ReaderPost, t: TFunction): FeedPost {
  const handle = post.author.handle.trim() ? `@${post.author.handle.trim().replace(/^@/, "")}` : ""
  const who = handle || post.author.name.trim() || post.container?.trim() || ""
  const title = post.title?.trim() ?? ""
  const openUrl = httpLink(post.url)
  const site = SOCIAL_PLATFORM_META[post.platform]?.name ?? linkSiteName(openUrl) ?? ""
  const views = typeof post.metrics.views === "number" && Number.isFinite(post.metrics.views) && post.metrics.views >= 0 ? formatNumber(post.metrics.views) : null
  const saved = post.savedAt ? postDateLabel(post.savedAt) : ""
  const hasVideo = post.media.kind === "video" || Boolean(post.media.videoUrl)
  return {
    key: post.id,
    previewUrl: httpLink(post.media.thumbnailUrl),
    video: hasVideo ? { url: httpLink(post.media.videoUrl) } : null,
    initial: initialOf(who || site),
    heading: title || who,
    headingDir: !title && handle ? "ltr" : "auto",
    ...(views ? { stat: viewsLabel(views, t) } : {}),
    text: post.text.trim() === title ? "" : post.text,
    meta: [postDateLabel(post.publishedAt), title ? who : "", saved ? t("collections.savedOn", { date: saved }) : ""],
    openUrl,
    site,
  }
}
