import { describe, expect, it } from "vitest"
import type { TelegramChannelPost } from "@nodaro/shared"
import type { TelegramChannelFeedData } from "@/types/nodes"
import {
  deriveTelegramFeedCardState,
  telegramFeedPosts,
  telegramPostDateLabel,
  telegramPostInitial,
  telegramPostPreviewUrl,
  telegramPostVideo,
} from "../telegram-feed-run-state"

const post = (id: number, extra: Partial<TelegramChannelPost> = {}): TelegramChannelPost => ({
  id,
  channel: "acme",
  postUrl: `https://t.me/acme/${id}`,
  text: `post ${id}`,
  media: [],
  ...extra,
})

const data = (extra: Partial<TelegramChannelFeedData> = {}): TelegramChannelFeedData =>
  ({ label: "Feed", channel: "acme", limit: 5, ...extra }) as TelegramChannelFeedData

describe("telegramFeedPosts", () => {
  it("leads with the NEWEST post and pages back — whatever order the run stored them in", () => {
    expect(telegramFeedPosts([post(10), post(12), post(11)]).map((p) => p.id)).toEqual([12, 11, 10])
    expect(telegramFeedPosts(undefined)).toEqual([])
    expect(telegramFeedPosts("not posts")).toEqual([])
  })
})

describe("a post's picture and video", () => {
  it("the picture is the post's own imageUrl, else its first photo, else a video's poster, else nothing", () => {
    expect(telegramPostPreviewUrl(post(1, { imageUrl: "https://cdn/a.jpg" }))).toBe("https://cdn/a.jpg")
    expect(telegramPostPreviewUrl(post(1, { media: [{ type: "photo", url: "https://cdn/p.jpg" }] }))).toBe("https://cdn/p.jpg")
    expect(telegramPostPreviewUrl(post(1, { media: [{ type: "video", url: "https://cdn/v.mp4", posterUrl: "https://cdn/poster.jpg" }] }))).toBe("https://cdn/poster.jpg")
    expect(telegramPostPreviewUrl(post(1))).toBeNull()
  })

  it("a video: the file to play when the page embedded one, and its poster; a 'Watch in Telegram' player has no file", () => {
    expect(telegramPostVideo(post(1, { media: [{ type: "video", url: "https://cdn/v.mp4", posterUrl: "https://cdn/poster.jpg" }] }))).toEqual({ url: "https://cdn/v.mp4", posterUrl: "https://cdn/poster.jpg" })
    expect(telegramPostVideo(post(1, { media: [{ type: "video", posterUrl: "https://cdn/poster.jpg" }] }))).toEqual({ url: null, posterUrl: "https://cdn/poster.jpg" })
    expect(telegramPostVideo(post(1, { media: [{ type: "video" }] }))).toEqual({ url: null, posterUrl: null })
    expect(telegramPostVideo(post(1, { media: [{ type: "photo", url: "https://cdn/p.jpg" }] }))).toBeNull()
  })

  it("the tile initial is the channel's first letter; the date label is empty without a date", () => {
    expect(telegramPostInitial(post(1))).toBe("A")
    expect(telegramPostInitial(post(1, { channel: "" }))).toBe("?")
    expect(telegramPostDateLabel(post(1))).toBe("")
    expect(telegramPostDateLabel(post(1, { date: "2026-10-06T08:45:00+00:00" }))).not.toBe("")
    expect(telegramPostDateLabel(post(1, { date: "not a date" }))).toBe("")
  })
})

describe("deriveTelegramFeedCardState", () => {
  it("never ran → running → failed → empty → success, read off the node's data", () => {
    expect(deriveTelegramFeedCardState(data())).toEqual({ kind: "never-ran" })
    expect(deriveTelegramFeedCardState(data({ executionStatus: "running" }))).toEqual({ kind: "running" })
    expect(deriveTelegramFeedCardState(data({ executionStatus: "failed", errorMessage: "Channel is private" }))).toEqual({ kind: "failed", errorMessage: "Channel is private" })
    expect(deriveTelegramFeedCardState(data({ executionStatus: "completed", generatedJson: [], generatedText: "" }))).toEqual({ kind: "empty" })
    expect(deriveTelegramFeedCardState(data({ executionStatus: "completed", generatedJson: [post(1), post(2)], generatedText: "x" }))).toEqual({ kind: "success", count: 2 })
  })

  it("a run that left only text (an older save) still counts as a run, with nothing to show as posts", () => {
    expect(deriveTelegramFeedCardState(data({ generatedText: "post 1\n\n---\n\npost 2" }))).toEqual({ kind: "empty" })
  })
})
