import { safeFetch } from "../../lib/safe-fetch.js"

/**
 * Read-only scraper for PUBLIC Telegram channels via the preview page
 * (`t.me/s/<channel>`). No auth, no bot — anyone can read a public channel's
 * recent posts this way. Used by the Telegram Channel Feed source node to pull
 * posts for rewrite/repost workflows.
 *
 * Honest limits: public channels with the web preview ENABLED only; ~20 most
 * recent posts per fetch (what the preview page renders); markup-dependent —
 * the parser is guarded by a fixture test so a Telegram markup change is caught
 * in CI rather than silently returning nothing.
 */

export interface ChannelPost {
  /** Sequential per-channel message id (from data-post="channel/<id>"). */
  id: number
  /** Plain-text content (HTML tags stripped, entities decoded). */
  text: string
  /** First photo URL if the post has one. */
  imageUrl?: string
  /** ISO timestamp of the post. */
  date?: string
  /** Canonical link to the post. */
  url: string
}

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

/**
 * Parse the preview HTML into posts (oldest→newest, as the page renders them).
 * Exported for the guard test.
 */
export function parseChannelHtml(html: string, channel: string): ChannelPost[] {
  const posts: ChannelPost[] = []
  // Each post is a .tgme_widget_message wrapper carrying data-post="chan/<id>".
  const wrappers = html.split(/<div class="tgme_widget_message[ "]/).slice(1)
  for (const chunk of wrappers) {
    const idMatch = chunk.match(/data-post="[^"/]+\/(\d+)"/)
    if (!idMatch) continue
    const id = Number(idMatch[1])

    const textMatch = chunk.match(/tgme_widget_message_text[^"]*"[^>]*>(.*?)<\/div>/s)
    const text = textMatch ? decodeEntities(textMatch[1]) : ""

    const photoMatch = chunk.match(/tgme_widget_message_photo_wrap[^>]*background-image:url\('([^']+)'/)
    const imageUrl = photoMatch?.[1]

    const dateMatch = chunk.match(/datetime="([^"]+)"/)

    // Skip service/empty entries with neither text nor image.
    if (!text && !imageUrl) continue

    posts.push({
      id,
      text,
      ...(imageUrl ? { imageUrl } : {}),
      ...(dateMatch ? { date: dateMatch[1] } : {}),
      url: `https://t.me/${channel}/${id}`,
    })
  }
  // De-dup by id (the page can repeat a pinned post) and sort ascending.
  const byId = new Map(posts.map((p) => [p.id, p]))
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

/** Fetch + parse a public channel's recent posts. Throws with a clear message
 *  on a private/nonexistent channel or preview-disabled channel. */
export async function fetchChannelPosts(channelInput: string): Promise<ChannelPost[]> {
  const channel = normalizeChannel(channelInput)
  if (!channel) throw new Error(`"${channelInput}" is not a valid Telegram channel name`)

  const res = await safeFetch(`https://t.me/s/${channel}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Nodaro channel reader)" },
  })
  if (!res.ok) {
    throw new Error(`Could not read t.me/s/${channel} (HTTP ${res.status})`)
  }
  const html = await res.text()
  const posts = parseChannelHtml(html, channel)
  if (posts.length === 0) {
    // The page loads but renders no posts → private, empty, or preview disabled.
    if (!/tgme_channel_info|tgme_widget_message/.test(html)) {
      throw new Error(`Channel "${channel}" is private, doesn't exist, or has its web preview disabled`)
    }
  }
  return posts
}
