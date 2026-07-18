import type { PlatformPublisher, PublishRequest, PublishResult } from "./index.js"

/**
 * Twitch — publishes a chat message to the user's OWN channel. Helix
 * requires the app's Client-Id header alongside the user token.
 */

const HELIX = "https://api.twitch.tv/helix"

function clientIdHeader(): string {
  return process.env.TWITCH_CLIENT_ID || ""
}

export async function fetchTwitchUser(accessToken: string): Promise<{ id: string; username: string; avatarUrl?: string }> {
  const res = await fetch(`${HELIX}/users`, {
    headers: { Authorization: `Bearer ${accessToken}`, "Client-Id": clientIdHeader() },
  })
  const data = (await res.json()) as { data?: Array<{ id: string; display_name: string; profile_image_url?: string }>; message?: string }
  const user = data.data?.[0]
  if (!res.ok || !user) throw new Error(data.message || "Twitch user lookup failed")
  return { id: user.id, username: user.display_name, avatarUrl: user.profile_image_url }
}

export const twitchPublisher: PlatformPublisher = {
  async publish(
    accessToken: string,
    request: PublishRequest,
    metadata: Record<string, unknown>,
  ): Promise<PublishResult> {
    const broadcasterId = metadata.broadcaster_id as string | undefined
    if (!broadcasterId) return { success: false, error: "Twitch connection is missing its channel id" }
    const text = request.caption ?? request.title
    if (!text) return { success: false, error: "Twitch chat messages need text" }

    const res = await fetch(`${HELIX}/chat/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": clientIdHeader(),
      },
      body: JSON.stringify({
        broadcaster_id: broadcasterId,
        sender_id: broadcasterId,
        message: text.slice(0, 500),
      }),
    })
    const data = (await res.json()) as { data?: Array<{ message_id: string; is_sent: boolean }>; message?: string }
    const sent = data.data?.[0]
    if (!res.ok || !sent?.is_sent) return { success: false, error: data.message || "Twitch send failed" }
    return { success: true, platformPostId: sent.message_id }
  },
}
