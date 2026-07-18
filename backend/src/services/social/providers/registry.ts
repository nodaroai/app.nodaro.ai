import { blueskyProvider } from "./bluesky.js"
import { devtoProvider } from "./devto.js"
import { discordProvider } from "./discord.js"
import { facebookProvider } from "./facebook.js"
import { hashnodeProvider } from "./hashnode.js"
import { instagramProvider } from "./instagram.js"
import { lemmyProvider } from "./lemmy.js"
import { linkedinProvider } from "./linkedin.js"
import { mastodonProvider } from "./mastodon.js"
import { mediumProvider } from "./medium.js"
import { pinterestProvider } from "./pinterest.js"
import { redditProvider } from "./reddit.js"
import { telegramProvider } from "./telegram.js"
import { threadsProvider } from "./threads.js"
import { tiktokProvider } from "./tiktok.js"
import { twitchProvider } from "./twitch.js"
import type { FieldSpec, ProviderCapabilities, SocialProvider } from "./types.js"
import { wordpressProvider } from "./wordpress.js"
import { xProvider } from "./x.js"
import { youtubeProvider } from "./youtube.js"

/**
 * THE provider registry — single source of truth for every social network.
 * Adding a network = adding one descriptor here. Route Zod enums, the
 * discovery endpoint, availability gates, and publish dispatch all derive
 * from this map (guarded by `__tests__/registry.test.ts`).
 */
export const PROVIDERS: Readonly<Record<string, SocialProvider>> = Object.freeze({
  instagram: instagramProvider,
  facebook: facebookProvider,
  tiktok: tiktokProvider,
  youtube: youtubeProvider,
  linkedin: linkedinProvider,
  x: xProvider,
  telegram: telegramProvider,
  // custom_fields wave (2a) — no dev app, no review, work on any deployment
  bluesky: blueskyProvider,
  devto: devtoProvider,
  hashnode: hashnodeProvider,
  medium: mediumProvider,
  wordpress: wordpressProvider,
  lemmy: lemmyProvider,
  // oauth2 wave (2b) — ship dormant; each activates when its app creds land
  // in env (requiredEnv drives `available` in GET /v1/social/providers)
  reddit: redditProvider,
  pinterest: pinterestProvider,
  discord: discordProvider,
  twitch: twitchProvider,
  threads: threadsProvider,
  mastodon: mastodonProvider,
})

/** Non-empty tuple for `z.enum(...)` derivation. */
export function providerIds(): [string, ...string[]] {
  return Object.keys(PROVIDERS) as [string, ...string[]]
}

export function getProvider(id: string): SocialProvider | null {
  return PROVIDERS[id] ?? null
}

/** Env vars from `requiredEnv` that are missing/empty in this deployment. */
export function missingEnv(provider: SocialProvider): string[] {
  return provider.requiredEnv.filter((name) => !process.env[name])
}

/**
 * Deployment-config availability (§2.5): every `requiredEnv` var present and
 * non-empty. `custom_fields`/`bot_token` providers declare none — always true.
 * NOT an edition gate — cloud and self-host run the same check.
 */
export function isConfigured(provider: SocialProvider): boolean {
  return missingEnv(provider).length === 0
}

export interface ProviderPublicInfo {
  id: string
  label: string
  connectKind: SocialProvider["connectKind"]
  editor: SocialProvider["editor"]
  capabilities: ProviderCapabilities
  available: boolean
  /** Present only when unavailable — env var NAMES only, never values. */
  missingEnv?: string[]
  setupHint?: string
  customFields?: FieldSpec[]
}

/** Registry metadata for `GET /v1/social/providers` (frontend grid + SDK). */
export function providerPublicInfo(provider: SocialProvider): ProviderPublicInfo {
  const missing = missingEnv(provider)
  return {
    id: provider.id,
    label: provider.label,
    connectKind: provider.connectKind,
    editor: provider.editor,
    capabilities: provider.capabilities,
    available: missing.length === 0,
    ...(missing.length > 0 ? { missingEnv: missing } : {}),
    ...(provider.setupHint ? { setupHint: provider.setupHint } : {}),
    ...(provider.customFields ? { customFields: provider.customFields() } : {}),
  }
}
