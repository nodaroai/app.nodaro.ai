import type { PublishRequest, PublishResult, PlatformPublisher } from "./index.js"

/**
 * Convert standard markdown to Telegram-compatible HTML.
 * Telegram's legacy "Markdown" parse mode doesn't support standard markdown
 * (**bold**, ## headings, etc.), so we convert to HTML which is fully reliable.
 */
function markdownToTelegramHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/__(.+?)__/g, "<b>$1</b>")
    .replace(/~~(.+?)~~/g, "<s>$1</s>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
    .replace(/(?<!\w)\*(.+?)\*(?!\w)/g, "<i>$1</i>")
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, "<i>$1</i>")
}

/** Resolve parse_mode + text: convert Markdown to HTML for reliability. */
function resolveFormat(text: string, parseMode?: string): { text: string; parse_mode?: string } {
  if (parseMode === "Markdown") {
    return { text: markdownToTelegramHtml(text), parse_mode: "HTML" }
  }
  if (parseMode === "HTML") {
    return { text, parse_mode: "HTML" }
  }
  return { text }
}

export const telegramPublisher: PlatformPublisher = {
  async publish(accessToken: string, request: PublishRequest, metadata: Record<string, unknown>): Promise<PublishResult> {
    const chatId = metadata.chatId as string
    const parseMode = metadata.parseMode as string | undefined
    if (!chatId) throw new Error("Telegram chat ID not found in connection metadata")

    const { action, caption, mediaUrl } = request
    const baseUrl = `https://api.telegram.org/bot${accessToken}`

    if (action === "send-message") {
      const raw = caption || ""
      const fmt = resolveFormat(raw, parseMode)
      const body: Record<string, unknown> = {
        chat_id: chatId,
        text: fmt.text,
      }
      if (fmt.parse_mode) body.parse_mode = fmt.parse_mode

      const res = await fetch(`${baseUrl}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json() as { ok: boolean; result?: { message_id: number }; description?: string }
      if (!data.ok) return { success: false, error: data.description ?? "Telegram sendMessage failed" }
      return { success: true, platformPostId: String(data.result?.message_id) }
    }

    if (action === "send-photo") {
      const body: Record<string, unknown> = {
        chat_id: chatId,
        photo: mediaUrl,
      }
      if (caption) {
        const fmt = resolveFormat(caption.slice(0, 1024), parseMode)
        body.caption = fmt.text
        if (fmt.parse_mode) body.parse_mode = fmt.parse_mode
      }

      const res = await fetch(`${baseUrl}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json() as { ok: boolean; result?: { message_id: number }; description?: string }
      if (!data.ok) return { success: false, error: data.description ?? "Telegram sendPhoto failed" }
      return { success: true, platformPostId: String(data.result?.message_id) }
    }

    if (action === "send-video") {
      if (!mediaUrl) throw new Error("mediaUrl is required for send-video")

      const mediaRes = await fetch(mediaUrl)
      if (!mediaRes.ok) throw new Error(`Failed to download video: ${mediaRes.statusText}`)

      const contentLength = mediaRes.headers.get("content-length")
      const MAX_BYTES = 50 * 1024 * 1024
      if (contentLength && parseInt(contentLength, 10) > MAX_BYTES) {
        return { success: false, error: "Video exceeds Telegram 50MB limit" }
      }

      const videoBlob = await mediaRes.blob()
      if (videoBlob.size > MAX_BYTES) {
        return { success: false, error: "Video exceeds Telegram 50MB limit" }
      }

      const form = new FormData()
      form.append("chat_id", chatId)
      form.append("video", videoBlob, "video.mp4")
      if (caption) {
        const fmt = resolveFormat(caption.slice(0, 1024), parseMode)
        form.append("caption", fmt.text)
        if (fmt.parse_mode) form.append("parse_mode", fmt.parse_mode)
      }

      const res = await fetch(`${baseUrl}/sendVideo`, {
        method: "POST",
        body: form,
      })
      const data = await res.json() as { ok: boolean; result?: { message_id: number }; description?: string }
      if (!data.ok) return { success: false, error: data.description ?? "Telegram sendVideo failed" }
      return { success: true, platformPostId: String(data.result?.message_id) }
    }

    if (action === "send-media-group") {
      const { mediaItems } = request
      if (!mediaItems || mediaItems.length === 0) throw new Error("No media items for send-media-group")

      const media = mediaItems.map((item, i) => {
        const entry: Record<string, unknown> = {
          type: item.type,
          media: item.url,
        }
        if (i === 0 && caption) {
          const fmt = resolveFormat(caption.slice(0, 1024), parseMode)
          entry.caption = fmt.text
          if (fmt.parse_mode) entry.parse_mode = fmt.parse_mode
        }
        return entry
      })

      const res = await fetch(`${baseUrl}/sendMediaGroup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, media }),
      })
      const data = await res.json() as { ok: boolean; result?: Array<{ message_id: number }>; description?: string }
      if (!data.ok) return { success: false, error: data.description ?? "Telegram sendMediaGroup failed" }
      return { success: true, platformPostId: String(data.result?.[0]?.message_id) }
    }

    throw new Error(`Unsupported Telegram action: ${action}`)
  },
}
