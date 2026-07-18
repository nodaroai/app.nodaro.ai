import { facebookPublisher } from "../platforms/facebook.js"
import { listFacebookChoices, finalizeFacebookAccount, NO_FB_PAGE_MSG } from "./meta-accounts.js"
import type { SocialProvider } from "./types.js"

export const facebookProvider: SocialProvider = {
  id: "facebook",
  label: "Facebook",
  connectKind: "oauth2_between_steps",
  editor: "normal",
  capabilities: {
    schedule: true,
    comment: false,
    media: ["image", "video"],
    refresh: "reconnect", // Meta page tokens don't self-heal
  },
  requiredEnv: ["META_APP_ID", "META_APP_SECRET"],
  maxConcurrentJob: 500,
  setupHint: "oauth-flow#meta",
  oauth: {
    authUrl: "https://www.facebook.com/v25.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v25.0/oauth/access_token",
    scopes: ["pages_manage_posts", "pages_read_engagement", "pages_show_list"],
    clientId: () => process.env.META_APP_ID || "",
    clientSecret: () => process.env.META_APP_SECRET || "",
    configId: () => process.env.META_FACEBOOK_CONFIG_ID,
  },
  listAccounts: listFacebookChoices,
  finalizeAccount: finalizeFacebookAccount,
  noAccountsMessage: NO_FB_PAGE_MSG,
  publisher: facebookPublisher,
}
