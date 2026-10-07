import { telegramPostsFrom, type TelegramChannelPost } from "@nodaro/shared"
import type { TelegramChannelFeedData } from "@/types/nodes"
import { formatDate } from "@/lib/i18n/format"

/**
 * What the Telegram Channel Feed card shows, read off the node's data the way
 * the Instagram / Meta Ads cards read theirs. The feed keeps no run clock of
 * its own, so there is no "ago" here — the newest post's date stands for it.
 */
export type TelegramFeedCardState =
  | { readonly kind: "never-ran" }
  | { readonly kind: "running" }
  | { readonly kind: "failed"; readonly errorMessage: string }
  | { readonly kind: "empty" }
  | { readonly kind: "success"; readonly count: number }

/** The last run's posts, NEWEST FIRST — the card leads with the newest and pages back. */
export function telegramFeedPosts(json: unknown): TelegramChannelPost[] {
  return [...telegramPostsFrom(json)].sort((a, b) => b.id - a.id)
}

/** The picture the card shows for a post: its first photo, else a video's poster. */
export function telegramPostPreviewUrl(post: TelegramChannelPost): string | null {
  if (typeof post.imageUrl === "string" && post.imageUrl) return post.imageUrl
  const media = Array.isArray(post.media) ? post.media : []
  const photo = media.find((m) => m.type === "photo" && typeof m.url === "string" && m.url)
  if (photo?.url) return photo.url
  const poster = media.find((m) => m.type === "video" && typeof m.posterUrl === "string" && m.posterUrl)
  return poster?.posterUrl ?? null
}

/** A post's first video: the file to play (none for a "Watch in Telegram" player) and its poster. */
export function telegramPostVideo(post: TelegramChannelPost): { readonly url: string | null; readonly posterUrl: string | null } | null {
  const media = Array.isArray(post.media) ? post.media : []
  const video = media.find((m) => m.type === "video")
  if (!video) return null
  return {
    url: typeof video.url === "string" && video.url ? video.url : null,
    posterUrl: typeof video.posterUrl === "string" && video.posterUrl ? video.posterUrl : null,
  }
}

/** The channel's initial, for a tile with no picture. */
export function telegramPostInitial(post: TelegramChannelPost): string {
  const c = (post.channel ?? "").trim()
  return c ? c.charAt(0).toUpperCase() : "?"
}

/** "Oct 6, 08:45" in the interface language; empty when the post carries no date. */
export function telegramPostDateLabel(post: TelegramChannelPost): string {
  const t = typeof post.date === "string" ? Date.parse(post.date) : NaN
  return Number.isNaN(t) ? "" : formatDate(t, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

export function deriveTelegramFeedCardState(d: TelegramChannelFeedData): TelegramFeedCardState {
  if (d.executionStatus === "running") return { kind: "running" }
  if (d.executionStatus === "failed") return { kind: "failed", errorMessage: typeof d.errorMessage === "string" && d.errorMessage ? d.errorMessage : "" }
  if (d.generatedJson === undefined && d.generatedText === undefined) return { kind: "never-ran" }
  const count = telegramPostsFrom(d.generatedJson).length
  return count > 0 ? { kind: "success", count } : { kind: "empty" }
}
