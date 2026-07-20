import type { PlatformPublisher } from "../platforms/index.js"

/**
 * Social provider descriptor — the single source of truth for one network.
 *
 * Everything the platform knows about a network (connect flow, env
 * requirements, capabilities, publish implementation) hangs off ONE object
 * registered in `registry.ts`. Route Zod enums, the `/v1/social/providers`
 * discovery endpoint, connect-time availability gates, and the publish
 * dispatch are all DERIVED from the registry — never hand-maintained lists.
 */

/** How a user connects an account of this network. */
export type ConnectKind =
  | "oauth2" // standard browser OAuth2 popup -> callback
  | "oauth2_between_steps" // OAuth2 then pick a Page/account (Meta family)
  | "custom_fields" // no browser OAuth — API key / app-password form
  | "self_hosted_oauth" // per-instance dynamic app registration (mastodon-custom)
  | "bot_token" // paste a bot token (telegram)
  | "web3" // managed-signer handshake (farcaster)
  | "extension" // companion browser extension (skool)

export type MediaKind = "image" | "video" | "carousel" | "story" | "text"

/** One input in a `custom_fields` connect form (rendered by the frontend). */
export interface FieldSpec {
  key: string
  label: string
  type: "text" | "password"
  hint?: string
  defaultValue?: string
  /** RegExp source string the frontend validates against before submit. */
  validation?: string
}

export interface ProviderCapabilities {
  /** Can posts to this network be scheduled (Phase 1 worker)? */
  schedule: boolean
  /** Does the provider implement follow-up comments on a published post? */
  comment: boolean
  media: readonly MediaKind[]
  /**
   * "real"      — refresh token self-heals via the token endpoint.
   * "reconnect" — token cannot self-heal (Meta business tokens); surface a
   *               Reconnect chip via `social_connections.reconnect_needed`.
   * "none"      — credential never expires (telegram bot token).
   */
  refresh: "real" | "reconnect" | "none"
}

/** Resolved identity of the connected account (existing wire/DB shape). */
export interface PlatformUserInfo {
  id: string
  username?: string
  avatarUrl?: string
  metadata?: Record<string, unknown>
}

/** One selectable account in the between-steps picker. */
export interface AccountChoice {
  id: string
  name: string
  avatarUrl?: string
  /** Groups accounts belonging to one login (FB user behind pages). */
  rootId?: string
}

/** OAuth2 wire config. Values come from env at call time (never cached). */
export interface OAuth2Config {
  /** Static, or a thunk for env-derived hosts (mastodon's MASTODON_URL). */
  authUrl: string | (() => string)
  tokenUrl: string | (() => string)
  scopes: readonly string[]
  clientId(): string
  clientSecret(): string
  /** Meta "Facebook Login for Business": config_id replaces scope. */
  configId?(): string | undefined
  /** S256 PKCE (x, linkedin, tiktok, reddit). */
  pkce?: boolean
  /**
   * Where client credentials go on token calls: request body (default) or an
   * HTTP Basic Authorization header (reddit, pinterest).
   */
  tokenAuth?: "body" | "basic"
  /** Authorize-URL quirks (YouTube offline access, TikTok client_key). */
  decorateAuthParams?(params: URLSearchParams, cfg: { clientId: string }): void
  /** Token-exchange body quirks (TikTok client_key). */
  decorateTokenBody?(body: Record<string, string>, cfg: { clientId: string }): void
  /** Non-standard refresh flows (threads' GET th_refresh_token). */
  customRefresh?(refreshToken: string): Promise<{
    accessToken: string
    refreshToken?: string
    expiresIn?: number
  }>
}

export interface SocialProvider {
  /** Matches route param + `social_connections.platform` DB value. */
  readonly id: string
  readonly label: string
  readonly connectKind: ConnectKind
  readonly editor: "none" | "normal" | "markdown" | "html"
  readonly capabilities: ProviderCapabilities
  /**
   * Env vars this deployment must set for connect to work (§2.5 availability).
   * Guard-test rule: `oauth2`/`oauth2_between_steps` MUST declare a non-empty
   * list; `custom_fields`/`bot_token` MUST declare an empty one (they work out
   * of the box). Availability = every listed var present and non-empty.
   */
  readonly requiredEnv: readonly string[]
  /** Per-provider platform rate cap for the Phase 1 worker. Default 1. */
  readonly maxConcurrentJob?: number
  /** Docs anchor surfaced with unavailable tiles / 400s. */
  readonly setupHint?: string
  /** Present for `oauth2` + `oauth2_between_steps`. */
  readonly oauth?: OAuth2Config
  /** Present for `custom_fields`. */
  readonly customFields?: () => FieldSpec[]
  /**
   * `custom_fields`: validate the submitted form against the network and
   * resolve the account. `accessToken` is the primary secret (API key /
   * app password) — the route encrypts it into `access_token_encrypted`;
   * non-secret extras (service host, publication id, …) go in
   * `userInfo.metadata`. Publishers then receive the decrypted secret as
   * their `accessToken`, same as OAuth providers.
   */
  connectWithFields?(fields: Record<string, string>): Promise<{
    userInfo: PlatformUserInfo
    accessToken: string
  }>
  /** `oauth2`: resolve the single connected account. */
  fetchUserInfo?(accessToken: string): Promise<PlatformUserInfo>
  /** `oauth2_between_steps`: list candidate accounts for the picker. */
  listAccounts?(accessToken: string): Promise<AccountChoice[]>
  /** `oauth2_between_steps`: resolve the chosen account. */
  finalizeAccount?(accessToken: string, accountId: string): Promise<PlatformUserInfo>
  /** `oauth2_between_steps`: shown when `listAccounts()` returns empty. */
  readonly noAccountsMessage?: string
  readonly publisher: PlatformPublisher
}

/**
 * Typed publish errors (Phase 1 worker retry semantics — declared with the
 * descriptor so provider implementations can adopt them incrementally):
 * RefreshTokenError -> refresh + bounded retry (or mark reconnect_needed),
 * BadBodyError -> permanent content failure, never retried,
 * NotPublishedError -> transient failure the publisher PROVED did not post.
 */
export class RefreshTokenError extends Error {}
export class BadBodyError extends Error {}

/**
 * The publisher established that NOTHING was posted, and the cause is
 * transient — so a retry is both safe and worth attempting.
 *
 * This is the third point on the outcome axis, and the distinction is the
 * whole reason it exists:
 * - BadBodyError        — definitely not posted, and never will be. No retry.
 * - NotPublishedError   — definitely not posted, but a retry may succeed.
 * - UnknownOutcomeError — MAY have posted. Never blind-retry (duplicate risk).
 *
 * Only throw this where the publisher can prove no post exists — e.g.
 * Instagram's container phase, which runs entirely before `media_publish`,
 * and its 9007 ("media not ready") rejection, which is the platform refusing
 * to publish. Collapsing these into UnknownOutcomeError tells the user their
 * post "may have gone out" when it provably did not, and suppresses a retry
 * that would have worked.
 */
export class NotPublishedError extends Error {}
