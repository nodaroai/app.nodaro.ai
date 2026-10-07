import type { TelegramChannelPost } from "@nodaro/shared"
import type { TFunction } from "@/lib/i18n"
import { httpLink } from "@/lib/post-site"
import { viewsLabel } from "@/lib/post-display"
import { telegramPostDateLabel, telegramPostInitial, telegramPostPreviewUrl, telegramPostVideo } from "../telegram-feed-run-state"
import type { FeedPost } from "./feed-post"

/** A Telegram channel post on the shared post feed card: "@channel · #3392", its views, date · forwarded-from. */
export function telegramFeedPost(post: TelegramChannelPost, t: TFunction): FeedPost {
  const video = telegramPostVideo(post)
  return {
    key: String(post.id),
    previewUrl: telegramPostPreviewUrl(post),
    video: video ? { url: httpLink(video.url) } : null,
    initial: telegramPostInitial(post),
    heading: `@${post.channel} · #${post.id}`,
    headingDir: "ltr",
    ...(post.views ? { stat: viewsLabel(post.views, t) } : {}),
    text: post.text,
    meta: [telegramPostDateLabel(post), post.forwardedFrom ? t("tgfeed.forwardedFrom", { name: post.forwardedFrom.name }) : ""],
    rowLabel: `#${post.id}`,
    openUrl: httpLink(post.postUrl),
    site: "Telegram",
  }
}
