import { createHash, randomBytes } from "node:crypto"
import { config } from "../../lib/config.js"

export type SocialPlatform = "instagram" | "tiktok" | "youtube" | "linkedin" | "x" | "facebook"

interface OAuthConfig {
  clientId: string
  clientSecret: string
  authUrl: string
  tokenUrl: string
  scopes: string[]
  redirectUri: string
}

function getRedirectUri(platform: SocialPlatform): string {
  const base = config.PUBLIC_URL || process.env.PUBLIC_URL || "http://localhost:8000"
  return `${base}/v1/social/callback/${platform}`
}

const OAUTH_CONFIGS: Record<SocialPlatform, () => OAuthConfig> = {
  instagram: () => ({
    clientId: process.env.META_APP_ID || "",
    clientSecret: process.env.META_APP_SECRET || "",
    authUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
    scopes: ["instagram_basic", "instagram_content_publish", "pages_show_list"],
    redirectUri: getRedirectUri("instagram"),
  }),
  facebook: () => ({
    clientId: process.env.META_APP_ID || "",
    clientSecret: process.env.META_APP_SECRET || "",
    authUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
    scopes: ["pages_manage_posts", "pages_read_engagement", "pages_show_list"],
    redirectUri: getRedirectUri("facebook"),
  }),
  tiktok: () => ({
    clientId: process.env.TIKTOK_CLIENT_KEY || "",
    clientSecret: process.env.TIKTOK_CLIENT_SECRET || "",
    authUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    scopes: ["video.publish", "user.info.basic"],
    redirectUri: getRedirectUri("tiktok"),
  }),
  youtube: () => ({
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"],
    redirectUri: getRedirectUri("youtube"),
  }),
  linkedin: () => ({
    clientId: process.env.LINKEDIN_CLIENT_ID || "",
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET || "",
    authUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    scopes: ["w_member_social", "openid", "profile"],
    redirectUri: getRedirectUri("linkedin"),
  }),
  x: () => ({
    clientId: process.env.X_CLIENT_ID || "",
    clientSecret: process.env.X_CLIENT_SECRET || "",
    authUrl: "https://twitter.com/i/oauth2/authorize",
    tokenUrl: "https://api.x.com/2/oauth2/token",
    scopes: ["tweet.write", "tweet.read", "users.read", "offline.access"],
    redirectUri: getRedirectUri("x"),
  }),
}

// In-memory state store for CSRF protection (production should use Redis)
const MAX_STATE_ENTRIES = 1000
const stateStore = new Map<string, { platform: SocialPlatform; userId: string; expiresAt: number; codeVerifier?: string }>()

export function getOAuthConfig(platform: SocialPlatform): OAuthConfig {
  return OAUTH_CONFIGS[platform]()
}

export function generateAuthUrl(platform: SocialPlatform, userId: string): string {
  const cfg = getOAuthConfig(platform)
  const state = crypto.randomUUID()

  // Generate PKCE code verifier for platforms that need it
  const codeVerifier = randomBytes(32).toString("base64url")

  stateStore.set(state, { platform, userId, expiresAt: Date.now() + 10 * 60 * 1000, codeVerifier })

  // Clean expired states + enforce size cap
  const now = Date.now()
  for (const [key, val] of stateStore) {
    if (now >= val.expiresAt) stateStore.delete(key)
  }
  if (stateStore.size > MAX_STATE_ENTRIES) {
    const oldest = [...stateStore.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)
    for (let i = 0; i < oldest.length - MAX_STATE_ENTRIES; i++) {
      stateStore.delete(oldest[i][0])
    }
  }

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: cfg.scopes.join(" "),
    state,
  })

  // Platform-specific params
  if (platform === "x") {
    const challenge = createHash("sha256").update(codeVerifier).digest("base64url")
    params.set("code_challenge", challenge)
    params.set("code_challenge_method", "S256")
  }
  if (platform === "tiktok") {
    // TikTok uses client_key instead of client_id
    params.delete("client_id")
    params.set("client_key", cfg.clientId)
  }

  return `${cfg.authUrl}?${params.toString()}`
}

export function validateState(state: string): { platform: SocialPlatform; userId: string; codeVerifier?: string } | null {
  const entry = stateStore.get(state)
  if (!entry) return null
  stateStore.delete(state)
  if (Date.now() >= entry.expiresAt) return null
  return { platform: entry.platform, userId: entry.userId, codeVerifier: entry.codeVerifier }
}

export async function exchangeCodeForTokens(
  platform: SocialPlatform,
  code: string,
  codeVerifier?: string,
): Promise<{
  accessToken: string
  refreshToken?: string
  expiresIn?: number
  scopes?: string[]
}> {
  const cfg = getOAuthConfig(platform)

  const body: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  }

  if (platform === "x" && codeVerifier) {
    body.code_verifier = codeVerifier
  }
  if (platform === "tiktok") {
    body.client_key = cfg.clientId
  }

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Token exchange failed for ${platform}: ${errText}`)
  }

  const data = await res.json() as Record<string, unknown>

  return {
    accessToken: (data.access_token as string) || "",
    refreshToken: data.refresh_token as string | undefined,
    expiresIn: data.expires_in as number | undefined,
    scopes: data.scope ? (data.scope as string).split(" ") : undefined,
  }
}

export async function refreshAccessToken(
  platform: SocialPlatform,
  refreshToken: string,
): Promise<{
  accessToken: string
  refreshToken?: string
  expiresIn?: number
}> {
  const cfg = getOAuthConfig(platform)

  const body: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  }

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  })

  if (!res.ok) {
    throw new Error(`Token refresh failed for ${platform}`)
  }

  const data = await res.json() as Record<string, unknown>

  return {
    accessToken: (data.access_token as string) || "",
    refreshToken: data.refresh_token as string | undefined,
    expiresIn: data.expires_in as number | undefined,
  }
}
