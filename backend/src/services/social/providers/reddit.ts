import { fetchRedditUser, redditPublisher } from "../platforms/reddit.js"
import type { SocialProvider } from "./types.js"

export const redditProvider: SocialProvider = {
  id: "reddit",
  label: "Reddit",
  connectKind: "oauth2",
  editor: "markdown",
  capabilities: { schedule: true, comment: false, media: ["image", "video", "text"], refresh: "real" },
  requiredEnv: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"],
  maxConcurrentJob: 1, // Reddit rate limits are strict
  setupHint: "oauth-flow#reddit",
  oauth: {
    authUrl: "https://www.reddit.com/api/v1/authorize",
    tokenUrl: "https://www.reddit.com/api/v1/access_token",
    scopes: ["identity", "submit", "read"],
    clientId: () => process.env.REDDIT_CLIENT_ID || "",
    clientSecret: () => process.env.REDDIT_CLIENT_SECRET || "",
    tokenAuth: "basic",
    decorateAuthParams: (params) => {
      params.set("duration", "permanent") // otherwise no refresh token
    },
  },
  fetchUserInfo: fetchRedditUser,
  publisher: redditPublisher,
}
