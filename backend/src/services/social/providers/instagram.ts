import { instagramPublisher } from "../platforms/instagram.js"
import { listInstagramChoices, finalizeInstagramAccount, NO_IG_ACCOUNT_MSG } from "./meta-accounts.js"
import type { SocialProvider } from "./types.js"

export const instagramProvider: SocialProvider = {
  id: "instagram",
  label: "Instagram",
  connectKind: "oauth2_between_steps",
  editor: "normal",
  capabilities: {
    schedule: true,
    comment: false,
    media: ["image", "video", "carousel", "story"],
    refresh: "reconnect", // Meta business tokens don't self-heal
  },
  requiredEnv: ["META_APP_ID", "META_APP_SECRET"],
  maxConcurrentJob: 400,
  setupHint: "oauth-flow#meta",
  oauth: {
    authUrl: "https://www.facebook.com/v25.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v25.0/oauth/access_token",
    // Publishing only. instagram_manage_comments / _manage_messages were
    // requested here with nothing behind them — no provider implements
    // commenting or DMs (every registry entry is `comment: false`), so App
    // Review has no in-product flow to screencast and rejects the whole
    // submission. Re-add a scope in the same PR that ships the feature.
    scopes: ["instagram_business_basic", "instagram_content_publish"],
    clientId: () => process.env.META_APP_ID || "",
    clientSecret: () => process.env.META_APP_SECRET || "",
    configId: () => process.env.META_INSTAGRAM_CONFIG_ID,
  },
  listAccounts: listInstagramChoices,
  finalizeAccount: finalizeInstagramAccount,
  noAccountsMessage: NO_IG_ACCOUNT_MSG,
  publisher: instagramPublisher,
}
