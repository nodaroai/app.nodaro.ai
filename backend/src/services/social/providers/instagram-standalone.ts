import {
  fetchInstagramStandaloneUser,
  instagramStandalonePublisher,
  refreshInstagramStandaloneToken,
} from "../platforms/instagram.js"
import type { SocialProvider } from "./types.js"

/**
 * Instagram via Instagram Login — a SECOND way to reach Instagram, alongside
 * the Facebook-chained `instagram` provider.
 *
 * Two reasons it exists:
 *  1. No Facebook Page required. The Page chain (create a Page, link the IG
 *     business account, grant Page permissions) is the single biggest drop-off
 *     in connecting Instagram.
 *  2. Its tokens REFRESH (~60 days, `ig_refresh_token`). Facebook Page and
 *     IG-business tokens can't self-heal, which is why the other provider is
 *     `refresh: "reconnect"` and eventually shows the Reconnect chip. This one
 *     never gets there.
 *
 * Credentials are the Instagram app's own id/secret, NOT META_APP_ID — Meta
 * issues them separately per login product. See meta-apps.ts, which is what
 * keeps the privacy callbacks covering both apps.
 */
export const instagramStandaloneProvider: SocialProvider = {
  id: "instagram-standalone",
  label: "Instagram (no Facebook Page)",
  connectKind: "oauth2",
  editor: "normal",
  capabilities: {
    schedule: true,
    comment: false,
    media: ["image", "video", "carousel", "story"],
    refresh: "real", // the whole point — unlike the Page-chained provider
  },
  requiredEnv: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"],
  maxConcurrentJob: 400,
  setupHint: "oauth-flow#instagram-standalone",
  oauth: {
    // enable_fb_login=0 keeps the dialog on the Instagram-only flow; without it
    // Meta silently routes the user back through the Facebook Page chain.
    authUrl: "https://www.instagram.com/oauth/authorize?enable_fb_login=0&force_authentication=1",
    tokenUrl: "https://api.instagram.com/oauth/access_token",
    // Publishing only — matching what the product can actually demonstrate for
    // App Review. Do not add a scope before the feature behind it ships.
    scopes: ["instagram_business_basic", "instagram_business_content_publish"],
    clientId: () => process.env.INSTAGRAM_APP_ID || "",
    clientSecret: () => process.env.INSTAGRAM_APP_SECRET || "",
    customRefresh: refreshInstagramStandaloneToken,
  },
  async fetchUserInfo(accessToken) {
    const user = await fetchInstagramStandaloneUser(accessToken)
    return {
      id: user.id,
      username: user.username,
      avatarUrl: user.avatarUrl,
      // Same metadata key the Facebook-chained provider writes, so the shared
      // publisher reads one field regardless of how the account was connected.
      metadata: { instagram_user_id: user.id },
    }
  },
  publisher: instagramStandalonePublisher,
}
