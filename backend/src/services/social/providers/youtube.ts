import { youtubePublisher } from "../platforms/youtube.js"
import type { SocialProvider } from "./types.js"

export const youtubeProvider: SocialProvider = {
  id: "youtube",
  label: "YouTube",
  connectKind: "oauth2",
  editor: "normal",
  capabilities: {
    schedule: true,
    comment: false,
    media: ["video"],
    refresh: "real",
  },
  requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  setupHint: "oauth-flow#youtube",
  oauth: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
    ],
    clientId: () => process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET || "",
    // Google only issues refresh tokens with offline access + forced consent.
    decorateAuthParams: (params) => {
      params.set("access_type", "offline")
      params.set("prompt", "consent")
    },
  },
  async fetchUserInfo(accessToken) {
    const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = (await res.json()) as {
      items: Array<{ id: string; snippet: { title: string; thumbnails: { default: { url: string } } } }>
    }
    const channel = data.items?.[0]
    if (!channel) throw new Error("No YouTube channel found.")
    return {
      id: channel.id,
      username: channel.snippet.title,
      avatarUrl: channel.snippet.thumbnails.default.url,
      metadata: { channel_id: channel.id },
    }
  },
  publisher: youtubePublisher,
}
