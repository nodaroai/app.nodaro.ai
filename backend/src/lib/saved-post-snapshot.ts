import { SOCIAL_PLATFORMS, type SocialPlatform, type SocialPost } from "@nodaro/shared"

/**
 * A saved post's snapshot as it is stored: the Social Search post shape with
 * every field checked. A post arrives from a client (the picker, an SDK
 * caller, a model through MCP), so nothing about it is trusted.
 *
 * Required fields that are wrong refuse the save (`null`). Optional fields
 * that are wrong are dropped, never stored: a wrongly typed number or a link
 * that is not http(s) would otherwise break every reader of the wall later.
 */

const MAX_ID = 300
const MAX_URL = 2000
const MAX_TEXT = 20_000
const MAX_SHORT = 300
const MAX_TAGS = 100

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function str(value: unknown, max: number): string | undefined {
  return typeof value === "string" ? value.slice(0, max) : undefined
}

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > MAX_URL) return undefined
  try {
    const u = new URL(value)
    return u.protocol === "http:" || u.protocol === "https:" ? value : undefined
  } catch {
    return undefined
  }
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** Keeps only the defined values, so an absent field stays absent. */
function defined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T
}

const MEDIA_KINDS = ["video", "image", "text"] as const
const ASPECTS = ["9:16", "16:9", "1:1"] as const

export function cleanSocialPostSnapshot(raw: unknown): SocialPost | null {
  if (!isRecord(raw)) return null
  const id = typeof raw.id === "string" && raw.id.length >= 1 && raw.id.length <= MAX_ID ? raw.id : null
  const platform = typeof raw.platform === "string" && (SOCIAL_PLATFORMS as readonly string[]).includes(raw.platform) ? (raw.platform as SocialPlatform) : null
  const url = httpUrl(raw.url)
  const author = isRecord(raw.author) ? raw.author : null
  if (!id || !platform || !url || !author || typeof raw.text !== "string") return null
  if (typeof author.handle !== "string" || typeof author.name !== "string") return null

  const metrics = isRecord(raw.metrics) ? raw.metrics : {}
  const media = isRecord(raw.media) ? raw.media : {}
  const kind = MEDIA_KINDS.find((k) => k === media.kind) ?? "text"
  const aspect = ASPECTS.find((a) => a === media.aspect)

  return defined({
    id,
    platform,
    url,
    title: str(raw.title, MAX_TEXT),
    text: raw.text.slice(0, MAX_TEXT),
    author: defined({
      handle: author.handle.slice(0, MAX_SHORT),
      name: author.name.slice(0, MAX_SHORT),
      avatarUrl: httpUrl(author.avatarUrl),
      followers: count(author.followers),
      verified: typeof author.verified === "boolean" ? author.verified : undefined,
      url: httpUrl(author.url),
    }),
    container: str(raw.container, MAX_SHORT),
    publishedAt: typeof raw.publishedAt === "string" && !Number.isNaN(Date.parse(raw.publishedAt)) ? raw.publishedAt.slice(0, 64) : undefined,
    metrics: defined({
      views: count(metrics.views),
      likes: count(metrics.likes),
      comments: count(metrics.comments),
      shares: count(metrics.shares),
      saves: count(metrics.saves),
      score: typeof metrics.score === "number" && Number.isFinite(metrics.score) ? metrics.score : undefined,
    }),
    media: defined({
      kind,
      thumbnailUrl: httpUrl(media.thumbnailUrl),
      videoUrl: httpUrl(media.videoUrl),
      durationSec: count(media.durationSec),
      aspect,
    }),
    hashtags: Array.isArray(raw.hashtags)
      ? raw.hashtags.filter((t): t is string => typeof t === "string").map((t) => t.slice(0, MAX_SHORT)).slice(0, MAX_TAGS)
      : [],
    extra: isRecord(raw.extra) ? raw.extra : {},
  }) as SocialPost
}
