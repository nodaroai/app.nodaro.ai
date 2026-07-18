import { xPublisher } from "../platforms/x.js"
import type { SocialProvider } from "./types.js"

export const xProvider: SocialProvider = {
  id: "x",
  label: "X (Twitter)",
  connectKind: "oauth2",
  editor: "normal",
  capabilities: {
    schedule: true,
    comment: false,
    media: ["image", "video", "text"],
    refresh: "real",
  },
  requiredEnv: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
  maxConcurrentJob: 1, // X rate limits are strict (300 posts / 3h)
  setupHint: "oauth-flow#x",
  oauth: {
    authUrl: "https://twitter.com/i/oauth2/authorize",
    tokenUrl: "https://api.x.com/2/oauth2/token",
    scopes: ["tweet.write", "tweet.read", "users.read", "offline.access"],
    clientId: () => process.env.X_CLIENT_ID || "",
    clientSecret: () => process.env.X_CLIENT_SECRET || "",
    pkce: true,
  },
  async fetchUserInfo(accessToken) {
    const res = await fetch("https://api.x.com/2/users/me?user.fields=profile_image_url", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = (await res.json()) as { data: { id: string; username: string; profile_image_url?: string } }
    return {
      id: data.data.id,
      username: `@${data.data.username}`,
      avatarUrl: data.data.profile_image_url,
    }
  },
  publisher: xPublisher,
}
