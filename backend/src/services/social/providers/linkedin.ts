import { linkedinPublisher } from "../platforms/linkedin.js"
import type { SocialProvider } from "./types.js"

export const linkedinProvider: SocialProvider = { // gitleaks:allow — type annotation, no credential (linkedin-client-id FP)
  id: "linkedin",
  label: "LinkedIn",
  connectKind: "oauth2",
  editor: "normal",
  capabilities: {
    schedule: true,
    comment: false,
    media: ["image", "video", "text"],
    refresh: "real",
  },
  requiredEnv: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
  maxConcurrentJob: 2,
  setupHint: "oauth-flow#linkedin",
  oauth: {
    authUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    scopes: ["w_member_social", "openid", "profile"],
    clientId: () => process.env.LINKEDIN_CLIENT_ID || "",
    clientSecret: () => process.env.LINKEDIN_CLIENT_SECRET || "",
    pkce: true,
  },
  async fetchUserInfo(accessToken) {
    const res = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = (await res.json()) as { sub: string; name?: string; picture?: string }
    return {
      id: data.sub,
      username: data.name,
      avatarUrl: data.picture,
      metadata: { person_urn: `urn:li:person:${data.sub}` },
    }
  },
  publisher: linkedinPublisher,
}
