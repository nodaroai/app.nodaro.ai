/**
 * Telegram Channel Feed — the post shape the node emits on its `json` handle,
 * the digest its `text` handle carries, and the ONE cursor rule (where the
 * feed's position goes after a run). Structural vocabulary and a pure rule;
 * the fetching lives in the backend (`services/social/telegram-channel.ts`).
 *
 * Media links (`cdn*.telesco.pe/...`) carry a `?token=` and expire within days:
 * a consumer that needs the picture later copies it (an upload node, a
 * collection), never stores the link alone.
 */

export interface TelegramChannelPostMedia {
  readonly type: "photo" | "video"
  /** The file — a photo's, or a video's when the preview page embeds the file ("Watch in Telegram" players have none). */
  readonly url?: string
  /** A video's poster frame. */
  readonly posterUrl?: string
}

export interface TelegramChannelPost {
  /** Sequential per-channel message id. */
  readonly id: number
  /** The channel's bare id (no `@`). */
  readonly channel: string
  /** Canonical link to the post. */
  readonly postUrl: string
  /** Plain text (HTML stripped, entities decoded); a reply's quoted text is not part of it. */
  readonly text: string
  /** ISO timestamp of the post. */
  readonly date?: string
  /** The channel or person the post was forwarded from. */
  readonly forwardedFrom?: { readonly name: string; readonly url?: string }
  /** Every photo and video of the post, in page order (an album is several). */
  readonly media: readonly TelegramChannelPostMedia[]
  /** The first picture — the first photo, else the first video's poster — for a consumer that takes one image. */
  readonly imageUrl?: string
  /** The view counter as the page shows it ("1.52M"). */
  readonly views?: string
}

/** The most posts a poll emits per run — two preview pages at most. */
export const TELEGRAM_FEED_LIMIT_MAX = 30
/** The most posts a peek ("re-fetch the last N") can show — one preview page. */
export const TELEGRAM_FEED_PEEK_MAX = 20
/** What one preview page (`t.me/s/<channel>[?after=<id>]`) renders. */
export const TELEGRAM_FEED_PAGE_SIZE = 20
/** The default posts per run. */
export const TELEGRAM_FEED_DEFAULT_LIMIT = 5
export const TELEGRAM_FEED_DIGEST_SEPARATOR = "\n\n---\n\n"

/** The `text` handle: the posts' text, oldest first, joined by a rule. Posts with no text (a bare picture) add nothing. */
export function telegramFeedDigest(posts: ReadonlyArray<Pick<TelegramChannelPost, "text">>): string {
  return posts
    .map((p) => p.text)
    .filter((t) => typeof t === "string" && t.trim().length > 0)
    .join(TELEGRAM_FEED_DIGEST_SEPARATOR)
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)

/**
 * The posts held in a saved `generatedJson` / a run's `output.json`, normalized:
 * anything that is not a post with a numeric id and a text is left out, and a
 * post saved before a field existed reads with that field at its default.
 */
export function telegramPostsFrom(value: unknown): TelegramChannelPost[] {
  if (!Array.isArray(value)) return []
  const out: TelegramChannelPost[] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "number" || !Number.isFinite(item.id) || typeof item.text !== "string") continue
    const media = Array.isArray(item.media)
      ? item.media.filter((m): m is TelegramChannelPostMedia => isRecord(m) && (m.type === "photo" || m.type === "video"))
      : []
    const forwarded = isRecord(item.forwardedFrom) && typeof item.forwardedFrom.name === "string"
      ? { name: item.forwardedFrom.name, ...(str(item.forwardedFrom.url) ? { url: item.forwardedFrom.url as string } : {}) }
      : undefined
    const channel = str(item.channel) ?? ""
    out.push({
      id: item.id,
      channel,
      postUrl: str(item.postUrl) ?? str(item.url) ?? (channel ? `https://t.me/${channel}/${item.id}` : ""),
      text: item.text,
      ...(str(item.date) ? { date: item.date as string } : {}),
      ...(forwarded ? { forwardedFrom: forwarded } : {}),
      media,
      ...(str(item.imageUrl) ? { imageUrl: item.imageUrl as string } : {}),
      ...(str(item.views) ? { views: item.views as string } : {}),
    })
  }
  return out
}

export interface FeedEmissionPlan<P extends { readonly id: number }> {
  /** The posts this run emits, oldest first. */
  readonly emitted: P[]
  /** The feed's position after this run (the cursor to store), or undefined when there is nothing to stand on. */
  readonly latestId: number | undefined
}

/**
 * Where the feed stands after a run — the ONE rule both the route and the
 * tests read (decided 2026-10-05):
 *
 *   - no position yet (first run, after Reset): the NEWEST `limit` posts, and
 *     the position jumps to the newest post — the person asked for what is new
 *     from now on; older posts are never revisited;
 *   - a stored position: the OLDEST `limit` posts above it, and the position
 *     becomes the highest post EMITTED — a backlog drains `limit` per run and
 *     nothing is lost (the old rule jumped to the newest post even when `limit`
 *     cut the fetch short, and the posts in between were gone for good).
 *
 * `posts` may come in any order and repeat (a pinned post renders twice).
 */
export function planFeedEmission<P extends { readonly id: number }>(
  posts: ReadonlyArray<P>,
  since: number | undefined,
  limit: number,
  /**
   * The highest message id the fetched page(s) rendered above `since`, posts
   * with nothing to read included. When nothing readable lies above the
   * position but the page went further, the position moves past the unreadable
   * posts — else the feed reads the same page every tick for ever.
   */
  pageMaxId?: number,
): FeedEmissionPlan<P> {
  const cap = Math.max(1, Math.min(TELEGRAM_FEED_LIMIT_MAX, Math.floor(Number.isFinite(limit) ? limit : TELEGRAM_FEED_DEFAULT_LIMIT) || 1))
  const byId = new Map<number, P>()
  for (const post of posts) byId.set(post.id, post)
  const sorted = [...byId.values()].sort((a, b) => a.id - b.id)
  if (since === undefined) {
    const emitted = sorted.slice(-cap)
    return { emitted, latestId: sorted.length > 0 ? sorted[sorted.length - 1]!.id : undefined }
  }
  const fresh = sorted.filter((p) => p.id > since)
  const emitted = fresh.slice(0, cap)
  if (emitted.length > 0) return { emitted, latestId: emitted[emitted.length - 1]!.id }
  const pastUnreadable = pageMaxId !== undefined && Number.isFinite(pageMaxId) && pageMaxId > since
  return { emitted, latestId: pastUnreadable ? pageMaxId : since }
}
