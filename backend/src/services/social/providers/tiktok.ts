import { tiktokPublisher } from "../platforms/tiktok.js"
import type { SocialProvider } from "./types.js"

export const tiktokProvider: SocialProvider = {
  id: "tiktok",
  label: "TikTok",
  connectKind: "oauth2",
  editor: "normal",
  capabilities: {
    schedule: true,
    comment: false,
    media: ["video"],
    refresh: "real",
  },
  requiredEnv: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  setupHint: "oauth-flow#tiktok",
  oauth: {
    authUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    scopes: ["video.publish", "user.info.basic"],
    clientId: () => process.env.TIKTOK_CLIENT_KEY || "",
    clientSecret: () => process.env.TIKTOK_CLIENT_SECRET || "",
    pkce: true,
    // TikTok uses client_key instead of client_id — in the authorize URL AND
    // the token-exchange body.
    decorateAuthParams: (params, cfg) => {
      params.delete("client_id")
      params.set("client_key", cfg.clientId)
    },
    decorateTokenBody: (body, cfg) => {
      body.client_key = cfg.clientId
    },
  },
  async fetchUserInfo(accessToken) {
    const res = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = (await res.json()) as { data: { user: { open_id: string; display_name: string; avatar_url: string } } }
    return {
      id: data.data.user.open_id,
      username: data.data.user.display_name,
      avatarUrl: data.data.user.avatar_url,
    }
  },
  publisher: tiktokPublisher,
}
