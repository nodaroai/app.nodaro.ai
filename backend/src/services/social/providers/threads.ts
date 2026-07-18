import { fetchThreadsUser, refreshThreadsToken, threadsPublisher } from "../platforms/threads.js"
import type { SocialProvider } from "./types.js"

export const threadsProvider: SocialProvider = {
  id: "threads",
  label: "Threads",
  connectKind: "oauth2",
  editor: "normal",
  capabilities: { schedule: true, comment: false, media: ["image", "text"], refresh: "real" },
  requiredEnv: ["THREADS_APP_ID", "THREADS_APP_SECRET"],
  setupHint: "oauth-flow#threads",
  oauth: {
    authUrl: "https://threads.net/oauth/authorize",
    tokenUrl: "https://graph.threads.net/oauth/access_token",
    scopes: ["threads_basic", "threads_content_publish"],
    clientId: () => process.env.THREADS_APP_ID || "",
    clientSecret: () => process.env.THREADS_APP_SECRET || "",
    customRefresh: refreshThreadsToken,
  },
  async fetchUserInfo(accessToken) {
    const user = await fetchThreadsUser(accessToken)
    return {
      id: user.id,
      username: user.username,
      avatarUrl: user.avatarUrl,
      metadata: { threads_user_id: user.id },
    }
  },
  publisher: threadsPublisher,
}
