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

/** Markup applied when KIE mode falls back to Replicate for an unsupported model */
const [constant removed]

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

  // ── Self-hosted / Replicate mode ──────────────────────────────
  if (settings.ai_provider !== "kie") {
    return {
      providerChain: KIE_ONLY_CAPABILITIES.has(capability)
        ? [] // No provider available for KIE-only ops in Replicate mode
        : ["replicate"],
      markupPercent: 0,
      activeProvider: "replicate",
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

  // Shared capabilities: KIE first, Replicate as unsupported-model fallback
  return {
    providerChain: ["kie", "replicate"],
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
 *
 * - KIE mode + KIE used        → configured markup
 * - KIE mode + Replicate used  → FALLBACK_MARKUP_PERCENT (10%)
 * - Replicate mode              → 0
 */
export function resolveMarkup(
  decision: RoutingDecision,
  providerUsed: ProviderUsed
): number {
  if (decision.activeProvider !== "kie") return 0
  if (providerUsed === "kie") return decision.settings.cost_markup_percent
  return FALLBACK_MARKUP_PERCENT
}
