import { fetchMastodonUser, mastodonBaseUrl, mastodonPublisher } from "../platforms/mastodon.js"
import type { SocialProvider } from "./types.js"

export const mastodonProvider: SocialProvider = {
  id: "mastodon",
  label: "Mastodon",
  connectKind: "oauth2",
  editor: "normal",
  capabilities: { schedule: true, comment: false, media: ["image", "text"], refresh: "none" },
  requiredEnv: ["MASTODON_CLIENT_ID", "MASTODON_CLIENT_SECRET"],
  setupHint: "oauth-flow#mastodon",
  oauth: {
    // Env-derived instance host — resolved per call, never cached.
    authUrl: () => `${mastodonBaseUrl()}/oauth/authorize`,
    tokenUrl: () => `${mastodonBaseUrl()}/oauth/token`,
    scopes: ["read", "write"],
    clientId: () => process.env.MASTODON_CLIENT_ID || "",
    clientSecret: () => process.env.MASTODON_CLIENT_SECRET || "",
  },
  async fetchUserInfo(accessToken) {
    const user = await fetchMastodonUser(accessToken)
    return {
      id: user.id,
      username: user.username,
      avatarUrl: user.avatarUrl,
      // The publish host is pinned per-connection at connect time.
      metadata: { service: user.service },
    }
  },
  publisher: mastodonPublisher,
}
