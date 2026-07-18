import type { PlatformPublisher, PublishRequest, PublishResult } from "./index.js"

/**
 * Discord — bot-install OAuth. Messages are sent AS THE BOT
 * (`DISCORD_BOT_TOKEN`), into the channel given per request via `chatId`
 * (same field Telegram uses). The user OAuth token only identifies who
 * connected.
 */

const API = "https://discord.com/api/v10"

export async function fetchDiscordUser(accessToken: string): Promise<{ id: string; username: string; avatarUrl?: string }> {
  const res = await fetch(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const data = (await res.json()) as { id?: string; username?: string; avatar?: string; message?: string }
  if (!res.ok || !data.id) throw new Error(data.message || "Discord user lookup failed")
  return {
    id: data.id,
    username: data.username ?? data.id,
    avatarUrl: data.avatar ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png` : undefined,
  }
}

export const discordPublisher: PlatformPublisher = {
  async publish(
    _accessToken: string,
    request: PublishRequest,
    metadata: Record<string, unknown>,
  ): Promise<PublishResult> {
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (!botToken) return { success: false, error: "DISCORD_BOT_TOKEN is not configured on this deployment" }
    const channelId = (metadata.chatId as string) || (metadata.default_channel as string | undefined)
    if (!channelId) return { success: false, error: "Discord needs a channel id — pass it as chatId" }

    const embeds = []
    if (request.mediaUrl) embeds.push({ image: { url: request.mediaUrl } })
    for (const item of request.mediaItems ?? []) {
      if (item.type === "photo") embeds.push({ image: { url: item.url } })
    }

    const res = await fetch(`${API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bot ${botToken}` },
      body: JSON.stringify({
        content: request.caption ?? request.title ?? "",
        ...(embeds.length ? { embeds: embeds.slice(0, 10) } : {}),
      }),
    })
    const data = (await res.json()) as { id?: string; channel_id?: string; message?: string }
    if (!res.ok || !data.id) return { success: false, error: data.message || "Discord send failed" }
    return {
      success: true,
      platformPostId: data.id,
      platformPostUrl: `https://discord.com/channels/@me/${data.channel_id}/${data.id}`,
    }
  },
}
