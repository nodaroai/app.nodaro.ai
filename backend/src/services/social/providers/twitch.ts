import { fetchTwitchUser, twitchPublisher } from "../platforms/twitch.js"
import type { SocialProvider } from "./types.js"

export const twitchProvider: SocialProvider = {
  id: "twitch",
  label: "Twitch",
  connectKind: "oauth2",
  editor: "normal",
  capabilities: { schedule: true, comment: false, media: ["text"], refresh: "real" },
  requiredEnv: ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET"],
  maxConcurrentJob: 1,
  setupHint: "oauth-flow#twitch",
  oauth: {
    authUrl: "https://id.twitch.tv/oauth2/authorize",
    tokenUrl: "https://id.twitch.tv/oauth2/token",
    scopes: ["user:read:email", "user:write:chat"],
    clientId: () => process.env.TWITCH_CLIENT_ID || "",
    clientSecret: () => process.env.TWITCH_CLIENT_SECRET || "",
  },
  async fetchUserInfo(accessToken) {
    const user = await fetchTwitchUser(accessToken)
    return {
      id: user.id,
      username: user.username,
      avatarUrl: user.avatarUrl,
      metadata: { broadcaster_id: user.id },
    }
  },
  publisher: twitchPublisher,
}
