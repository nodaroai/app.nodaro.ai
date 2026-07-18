import { fetchPinterestUser, pinterestPublisher } from "../platforms/pinterest.js"
import type { SocialProvider } from "./types.js"

export const pinterestProvider: SocialProvider = {
  id: "pinterest",
  label: "Pinterest",
  connectKind: "oauth2",
  editor: "normal",
  capabilities: { schedule: true, comment: false, media: ["image"], refresh: "real" },
  requiredEnv: ["PINTEREST_CLIENT_ID", "PINTEREST_CLIENT_SECRET"],
  setupHint: "oauth-flow#pinterest",
  oauth: {
    authUrl: "https://www.pinterest.com/oauth/",
    tokenUrl: "https://api.pinterest.com/v5/oauth/token",
    scopes: ["boards:read", "pins:read", "pins:write", "user_accounts:read"],
    clientId: () => process.env.PINTEREST_CLIENT_ID || "",
    clientSecret: () => process.env.PINTEREST_CLIENT_SECRET || "",
    tokenAuth: "basic",
  },
  async fetchUserInfo(accessToken) {
    const user = await fetchPinterestUser(accessToken)
    return {
      id: user.id,
      username: user.username,
      avatarUrl: user.avatarUrl,
      metadata: user.boardId ? { default_board: user.boardId } : {},
    }
  },
  publisher: pinterestPublisher,
}
