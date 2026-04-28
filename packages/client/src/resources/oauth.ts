import type { NodaroClient } from "../client.js"
import type { DeveloperAppScope } from "./developer-apps.js"

/**
 * Server-side authorization-code exchange payload. Field names are snake_case
 * per OAuth 2.0 (RFC 6749).
 */
export interface ExchangeCodeInput {
  client_id: string
  client_secret: string
  /** Authorization code received from the consent redirect. */
  code: string
  /** Must match the redirect_uri used when issuing the code. */
  redirect_uri: string
}

/**
 * `POST /v1/oauth/token` response — snake_case per RFC 6749. `expires_in` is
 * the token's lifetime in seconds.
 */
export interface AccessTokenResponse {
  access_token: string
  token_type: "Bearer"
  /** Space-separated list of granted scopes. */
  scope: string
  expires_in: number
}

/**
 * Public app metadata for consent screens. Only safe-to-display fields —
 * no secret, no full origin list, no owner_user_id.
 */
export interface OAuthAppInfo {
  name: string
  description: string | null
  logoUrl: string | null
  homepageUrl: string | null
  scopesRequested: DeveloperAppScope[]
}

export class OAuthResource {
  constructor(private client: NodaroClient) {}

  /**
   * Server-side authorization-code exchange. Sends the standard OAuth 2.0
   * `application/json` body to `POST /v1/oauth/token`.
   *
   * NEVER call this from a browser — `client_secret` must stay on the server.
   */
  exchangeCode(input: ExchangeCodeInput): Promise<AccessTokenResponse> {
    return this.client.request("POST", "/v1/oauth/token", {
      body: { grant_type: "authorization_code", ...input },
    })
  }

  /**
   * Revoke an access token (RFC 7009). Always returns `{ success: true }`,
   * even for unknown tokens — the spec forbids leaking token validity.
   */
  revoke(token: string): Promise<{ success: true }> {
    return this.client.request("POST", "/v1/oauth/revoke", { body: { token } })
  }

  /**
   * Get public app metadata for a consent screen.
   * `GET /v1/oauth/app-info?client_id=<id>`. Public route — no auth needed.
   */
  getAppInfo(clientId: string): Promise<OAuthAppInfo> {
    return this.client.request("GET", "/v1/oauth/app-info", {
      query: { client_id: clientId },
    })
  }
}
