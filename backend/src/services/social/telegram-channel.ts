import type { TelegramChannelPost, TelegramChannelPostMedia } from "@nodaro/shared"
import { safeFetch } from "../../lib/safe-fetch.js"

/**
 * Read-only scraper for PUBLIC Telegram channels via the preview page
 * (`t.me/s/<channel>`). No auth, no bot — anyone can read a public channel's
 * recent posts this way. Used by the Telegram Channel Feed source node.
 *
 * Honest limits: public channels with the web preview ENABLED only; one page
 * renders ~20 posts, and `?after=<id>` pages forward from an id (oldest
 * first) — verified live 2026-10-06: `/s/telegram` → 441..460, `?after=441` →
 * 442..460, `?after=460` → an empty page that still carries the channel's
 * markup. Markup-dependent — the parser is guarded by a fixture test (real
 * snippets captured from the page) so a Telegram markup change is caught in
 * CI rather than silently returning nothing.
 *
 * What a post carries (`TelegramChannelPost`, @nodaro/shared): id, channel,
 * link, text (a reply's quoted text excluded), date, forwarded-from, EVERY
 * photo and video (an album is several; a video's file when the page embeds
 * it, else its poster only), the first picture, and the view counter.
 */

/** @deprecated The post shape lives in `@nodaro/shared` as `TelegramChannelPost`. */
export type ChannelPost = TelegramChannelPost

const CHANNEL_RE = /^[a-zA-Z0-9_]{3,64}$/

/** Normalize user input (@name, t.me/name, https://t.me/s/name) to a bare id. */
export function normalizeChannel(input: string): string | null {
  let s = input.trim()
  s = s.replace(/^https?:\/\//i, "").replace(/^(t\.me|telegram\.me)\//i, "").replace(/^s\//i, "")
  s = s.replace(/^@/, "").split(/[/?#]/)[0] ?? ""
  return CHANNEL_RE.test(s) ? s : null
}

function decodeEntities(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/[ \t]+\n/g, "\n")
    .trim()
}

/** The post's own text — `js-message_text`, never the quoted `js-message_reply_text` of a reply. */
function parseText(chunk: string): string {
  const m = chunk.match(/class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/)
  return m ? decodeEntities(m[1]!) : ""
}

/** Every photo and video, in page order. An album wraps several photo wraps; a video player carries a poster and, when the page embeds the file, a `<video src>`. */
function parseMedia(chunk: string): TelegramChannelPostMedia[] {
  const found: Array<{ index: number; media: TelegramChannelPostMedia }> = []
  for (const m of chunk.matchAll(/tgme_widget_message_photo_wrap[^>]*?background-image:url\('([^']+)'/g)) {
    found.push({ index: m.index ?? 0, media: { type: "photo", url: m[1]! } })
  }
  const players = [...chunk.matchAll(/tgme_widget_message_video_player/g)]
  players.forEach((player, i) => {
    const start = player.index ?? 0
    const end = players[i + 1]?.index ?? chunk.length
    const block = chunk.slice(start, end)
    const poster = block.match(/tgme_widget_message_video_thumb[^>]*?background-image:url\('([^']+)'/)?.[1]
    const src = block.match(/<video[^>]*\ssrc="([^"]+)"/)?.[1]
    found.push({ index: start, media: { type: "video", ...(src ? { url: src } : {}), ...(poster ? { posterUrl: poster } : {}) } })
  })
  return found.sort((a, b) => a.index - b.index).map((f) => f.media)
}

/** `<a class="tgme_widget_message_forwarded_from_name" href="…">Name</a>`, or the `<span>` form for a sender without a link. */
function parseForwardedFrom(chunk: string): TelegramChannelPost["forwardedFrom"] {
  const m = chunk.match(/tgme_widget_message_forwarded_from_name"(?:[^>]*?href="([^"]+)")?[^>]*>([\s\S]*?)<\/(?:a|span)>/)
  if (!m) return undefined
  const name = decodeEntities(m[2]!)
  if (!name) return undefined
  return { name, ...(m[1] ? { url: m[1] } : {}) }
}

/** The post's own timestamp — the footer's date link; a video's `<time>` is its duration and carries no `datetime`. */
function parseDate(chunk: string): string | undefined {
  return chunk.match(/tgme_widget_message_date[^>]*>\s*<time[^>]*datetime="([^"]+)"/)?.[1] ?? chunk.match(/<time[^>]*datetime="([^"]+)"/)?.[1]
}

/**
 * Parse the preview HTML into posts (oldest→newest, as the page renders them).
 * Exported for the guard test.
 */
export function parseChannelHtml(html: string, channel: string): TelegramChannelPost[] {
  const posts: TelegramChannelPost[] = []
  // Each post is a .tgme_widget_message wrapper carrying data-post="chan/<id>".
  const wrappers = html.split(/<div class="tgme_widget_message[ "]/).slice(1)
  for (const chunk of wrappers) {
    const idMatch = chunk.match(/data-post="[^"/]+\/(\d+)"/)
    if (!idMatch) continue
    const id = Number(idMatch[1])

    const text = parseText(chunk)
    const media = parseMedia(chunk)
    // Skip service/empty entries with neither text nor media.
    if (!text && media.length === 0) continue

    const imageUrl = media.find((m) => m.type === "photo")?.url ?? media.find((m) => m.type === "video")?.posterUrl
    const date = parseDate(chunk)
    const views = chunk.match(/tgme_widget_message_views"[^>]*>([^<]+)</)?.[1]?.trim()
    const forwardedFrom = parseForwardedFrom(chunk)

    posts.push({
      id,
      channel,
      postUrl: `https://t.me/${channel}/${id}`,
      text,
      ...(date ? { date } : {}),
      ...(forwardedFrom ? { forwardedFrom } : {}),
      media,
      ...(imageUrl ? { imageUrl } : {}),
      ...(views ? { views } : {}),
    })
  }
  // De-dup by id (the page can repeat a pinned post) and sort ascending.
  const byId = new Map(posts.map((p) => [p.id, p]))
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

export interface FetchChannelPostsOptions {
  /** Page forward from this post id: only posts above it, oldest first (`?after=<id>`). */
  readonly after?: number
}

/** Fetch + parse a public channel's posts — the newest page, or the page after `after`. Throws with a clear message
 *  on a private/nonexistent channel or preview-disabled channel; an empty page past the newest post is not an error. */
export async function fetchChannelPosts(channelInput: string, opts: FetchChannelPostsOptions = {}): Promise<TelegramChannelPost[]> {
  const channel = normalizeChannel(channelInput)
  if (!channel) throw new Error(`"${channelInput}" is not a valid Telegram channel name`)

  const after = typeof opts.after === "number" && Number.isFinite(opts.after) && opts.after > 0 ? Math.floor(opts.after) : undefined
  const url = `https://t.me/s/${channel}${after !== undefined ? `?after=${after}` : ""}`
  const res = await safeFetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Nodaro channel reader)" },
  })
  if (!res.ok) {
    throw new Error(`Could not read t.me/s/${channel} (HTTP ${res.status})`)
  }
  const html = await res.text()
  const posts = parseChannelHtml(html, channel)
  if (posts.length === 0) {
    // The page loads but renders no posts → private, empty, or preview disabled.
    // (A page past the newest post is empty too, but still carries the channel's markup.)
    if (!/tgme_channel_info|tgme_widget_message/.test(html)) {
      throw new Error(`Channel "${channel}" is private, doesn't exist, or has its web preview disabled`)
    }
  }
  // The page may render the anchor post itself; only what lies above it counts.
  return after === undefined ? posts : posts.filter((p) => p.id > after)
}
