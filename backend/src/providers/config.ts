/**
 * Provider Routing Configuration
 *
 * Maps ProviderCapability values to provider preference chains.
 * For each operation, defines which provider to try first and what
 * the fallback is. Reads app settings (ai_provider) to determine
 * whether "kie" or "replicate" is the primary provider.
 *
 * This file does NOT import any existing routing code; it is a
 * self-contained config consumed only by the new providers/router.ts.
 */

import type { ProviderCapability } from "./provider.interface.js"
import {
  getAppSettings,
  calculateDisplayCost,
  type AppSettings,
} from "../lib/app-settings.js"

// ─── Types ────────────────────────────────────────────────────────

export type ProviderUsed = "kie" | "replicate"

export interface RoutingDecision {
  /** Ordered list of provider IDs to attempt */
  providerChain: string[]
  /** Markup % to apply to the cost of the provider actually used */
  markupPercent: number
  /** Which raw AI provider setting is active */
  activeProvider: "kie" | "replicate"
  /** The full settings object (cached) */
  settings: AppSettings
}

// ─── Constants ────────────────────────────────────────────────────

// Replicate disabled — KIE.ai is the sole provider
// /** Markup applied when KIE mode falls back to Replicate for an unsupported model */
// const [constant removed]

/**
 * Capabilities that only KIE.ai supports (no Replicate fallback exists).
 * If ai_provider=replicate these operations are unavailable.
 */
const KIE_ONLY_CAPABILITIES: ReadonlySet<ProviderCapability> = new Set([
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

  // ── Self-hosted / non-KIE mode (Replicate disabled) ─────────
  if (settings.ai_provider !== "kie") {
    return {
      providerChain: [],
      markupPercent: 0,
      activeProvider: "kie",
      settings,
    }
  }

  // ── Cloud / KIE mode ──────────────────────────────────────────
  // KIE-only capabilities: no fallback
  if (KIE_ONLY_CAPABILITIES.has(capability)) {
    return {
      providerChain: ["kie"],
      markupPercent: settings.cost_markup_percent,
      activeProvider: "kie",
      settings,
    }
  }

  // image-generation: KIE first, fall through to Replicate for "Open"
  // (uncensored) models that only live there (flux-2-klein, kontext-multi).
  // Walker in router.ts uses each provider's `supportedModels`, so KIE-routed
  // ids never reach Replicate.
  if (capability === "image-generation") {
    return {
      providerChain: ["kie", "replicate"],
      markupPercent: settings.cost_markup_percent,
      activeProvider: "kie",
      settings,
    }
  }

  // Other shared capabilities: KIE only
  return {
    providerChain: ["kie"],
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
 * Cloud mode applies the configured markup uniformly across KIE and the
 * Replicate fallback; self-hosted ("ai_provider != kie") applies none.
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
