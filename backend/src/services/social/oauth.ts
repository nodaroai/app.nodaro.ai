import { createHash, randomBytes } from "node:crypto"
import { config } from "../../lib/config.js"
import type { OAuth2Config, SocialProvider } from "./providers/types.js"
import { saveOAuthState } from "./state-store.js"

/**
 * Generic OAuth2 helpers, fully descriptor-driven. Per-platform knowledge
 * (endpoints, scopes, PKCE, client_key quirks, Meta config_id) lives on each
 * provider's `oauth` config in `providers/` — there is no platform switch or
 * hardcoded platform list here anymore. CSRF state + PKCE verifiers live in
 * Redis (`state-store.ts`), so any instance can serve the callback.
 */

export function getRedirectUri(providerId: string): string {
  const base = config.PUBLIC_URL || process.env.PUBLIC_URL || "http://localhost:8000"
  return `${base}/v1/social/callback/${providerId}`
}

function requireOAuth(provider: SocialProvider): OAuth2Config {
  if (!provider.oauth) {
    throw new Error(`Provider ${provider.id} has no OAuth config (connectKind: ${provider.connectKind})`)
  }
  return provider.oauth
}

export async function generateAuthUrl(provider: SocialProvider, userId: string): Promise<string> {
  const oauth = requireOAuth(provider)
  const state = crypto.randomUUID()
  const codeVerifier = oauth.pkce ? randomBytes(32).toString("base64url") : undefined

  await saveOAuthState(state, { providerId: provider.id, userId, codeVerifier })

  const clientId = oauth.clientId()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(provider.id),
    response_type: "code",
    state,
  })

  // Facebook Login for Business uses config_id instead of scope
  const configId = oauth.configId?.()
  if (configId) {
    params.set("config_id", configId)
  } else {
    params.set("scope", oauth.scopes.join(" "))
  }

  if (codeVerifier) {
    const challenge = createHash("sha256").update(codeVerifier).digest("base64url")
    params.set("code_challenge", challenge)
    params.set("code_challenge_method", "S256")
  }

  oauth.decorateAuthParams?.(params, { clientId })

  return `${oauth.authUrl}?${params.toString()}`
}

export interface TokenSet {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
  scopes?: string[]
}

export async function exchangeCodeForTokens(
  provider: SocialProvider,
  code: string,
  codeVerifier?: string,
): Promise<TokenSet> {
  const oauth = requireOAuth(provider)
  const clientId = oauth.clientId()

  const body: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: getRedirectUri(provider.id),
    client_id: clientId,
    client_secret: oauth.clientSecret(),
  }
  if (oauth.pkce && codeVerifier) {
    body.code_verifier = codeVerifier
  }
  oauth.decorateTokenBody?.(body, { clientId })

  const res = await fetch(oauth.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Token exchange failed for ${provider.id}: ${errText}`)
  }

  const data = (await res.json()) as Record<string, unknown>
  if (!data.access_token) {
    throw new Error(`Token exchange for ${provider.id} returned no access_token`)
  }

  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string | undefined,
    expiresIn: data.expires_in as number | undefined,
    scopes: data.scope ? (data.scope as string).split(" ") : undefined,
  }
}

export async function refreshAccessToken(
  provider: SocialProvider,
  refreshToken: string,
): Promise<Omit<TokenSet, "scopes">> {
  const oauth = requireOAuth(provider)
  const clientId = oauth.clientId()

  const body: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: oauth.clientSecret(),
  }
  oauth.decorateTokenBody?.(body, { clientId })

  const res = await fetch(oauth.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  })

  if (!res.ok) {
    throw new Error(`Token refresh failed for ${provider.id}`)
  }

  const data = (await res.json()) as Record<string, unknown>
  if (!data.access_token) {
    throw new Error(`Token refresh for ${provider.id} returned no access_token`)
  }

  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string | undefined,
    expiresIn: data.expires_in as number | undefined,
  }
}
