/**
 * Provider Routing Configuration
 *
 * Maps ProviderCapability values to provider preference chains.
 * KIE.ai is the sole primary provider; Replicate participates only as the
 * image-generation fallback for the models that live exclusively there.
 *
 * The legacy `ai_provider` app-setting deliberately does NOT affect routing:
 * migration 005 seeds it to "replicate" on every fresh database, nothing
 * rewrites it on self-host (community has no admin routes, and the admin PUT
 * only accepts "kie"), and the old non-"kie" branch returned an empty chain —
 * which made every registry-routed node throw on a fresh install even with a
 * valid KIE_API_KEY. Pinned by config.test.ts.
 *
 * This file does NOT import any of the LEGACY routing code; it is consumed
 * only by providers/router.ts. It does read the ProviderRegistry (a sync
 * lookup) so the Nodaro Cloud chain extension reflects actual availability.
 */

import type { ProviderCapability } from "./provider.interface.js"
import { providerRegistry } from "./registry.js"
import {
  getAppSettings,
  calculateDisplayCost,
  type AppSettings,
} from "../lib/app-settings.js"

// ─── Types ────────────────────────────────────────────────────────

export type ProviderUsed = "kie" | "replicate" | "nodaro"

export interface RoutingDecision {
  /** Ordered list of provider IDs to attempt */
  providerChain: string[]
  /** Markup % to apply to the cost of the provider actually used */
  markupPercent: number
  /** Which raw AI provider setting is active (always "kie" in practice) */
  activeProvider: ProviderUsed
  /** The full settings object (cached) */
  settings: AppSettings
}

// ─── Constants ────────────────────────────────────────────────────

/**
 * Capabilities that only KIE.ai supports (no Replicate fallback exists).
 * These operations have no fallback provider — the chain is always ["kie"].
 */
const KIE_ONLY_CAPABILITIES: ReadonlySet<ProviderCapability> = new Set([
  "video-to-video",
  "motion-transfer",
  "video-upscale",
  "lip-sync",
  "text-to-speech",
])

/**
 * Capabilities the Nodaro Cloud connection can serve (community
 * cloud-connect, Phase 4a). When the "nodaro" provider is registered — which
 * happens at boot only when the instance holds a cloud token (see
 * providers/nodaro/index.ts) — these chains gain "nodaro" as their FINAL
 * entry. Strictly ADDITIVE: the base chain is computed exactly as before and
 * only ever extended, never replaced or emptied (the migration-307 lesson) —
 * user-key providers always win for the models they declare; the cloud
 * connection is a fallback, not a hijack. When the provider is not
 * registered the chains are byte-identical to the pre-connect behavior.
 */
const NODARO_CONNECT_CAPABILITIES: ReadonlySet<ProviderCapability> = new Set([
  "image-generation",
  "image-editing",
  "image-to-video",
  "text-to-video",
  "video-to-video",
  "motion-transfer",
  "video-upscale",
  "lip-sync",
])

// ─── Public API ───────────────────────────────────────────────────

/**
 * Build a routing decision for a given capability + model.
 *
 * @param capability  e.g. "image-generation", "image-to-video"
 * @param model       e.g. "nano-banana", "veo3", "minimax"
 * @returns           RoutingDecision with providerChain & markup
 */
export async function buildRoutingDecision(
  capability: ProviderCapability,
  model: string
): Promise<RoutingDecision> {
  const settings = await getAppSettings()

  // KIE-only capabilities have no fallback; image-generation falls through to
  // Replicate for the "Open" (uncensored) models that only live there
  // (flux-2-klein, kontext-multi) — the router.ts walker uses each provider's
  // `supportedModels`, so KIE-routed ids never reach Replicate. Everything else
  // is KIE-only. (All three KIE-mode chains share the same markup/provider.)
  const baseChain: RoutingDecision["providerChain"] = KIE_ONLY_CAPABILITIES.has(capability)
    ? ["kie"]
    : capability === "image-generation"
      ? ["kie", "replicate"]
      : ["kie"]
  // Nodaro Cloud extension — append-only, and only when the provider is
  // actually registered (i.e. the instance was connected at boot). See
  // NODARO_CONNECT_CAPABILITIES above.
  const providerChain =
    NODARO_CONNECT_CAPABILITIES.has(capability) &&
    providerRegistry.getProviderInfo("nodaro") !== null
      ? [...baseChain, "nodaro"]
      : baseChain
  return {
    providerChain,
    markupPercent: settings.cost_markup_percent,
    activeProvider: "kie",
    settings,
  }
}

/**
 * Calculate display cost with markup applied.
 * Re-exports the existing helper so router.ts only imports from config.
 */
export function applyMarkup(
  providerCost: number | null,
  markupPercent: number
): number | null {
  if (providerCost === null) return null
  return calculateDisplayCost(providerCost, markupPercent)
}

/**
 * Determine the markup to use when a specific provider was used.
 * The configured markup applies uniformly across KIE and the Replicate
 * fallback (self-host simply seeds cost_markup_percent = 0).
 * `providerUsed` is kept in the signature so a future per-provider markup
 * (e.g. cheaper rate for Replicate fallback) can branch without an API break.
 */
export function resolveMarkup(
  decision: RoutingDecision,
  providerUsed: ProviderUsed
): number {
  void providerUsed
  if (decision.activeProvider !== "kie") return 0
  return decision.settings.cost_markup_percent
}
