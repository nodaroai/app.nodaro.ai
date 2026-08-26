/**
 * Admin-tunable per-tier caps and the default tier.
 *
 * The caps and the default tier live in `app_settings` (two JSON keys), read
 * through the same cached `getAppSettings()` as every other runtime setting.
 * They are OVERRIDES: an absent key, or an absent field within it, falls back
 * to the compiled `COPILOT_TIERS` defaults — so a self-host with no rows, or
 * the window before a write reaches the shared DB, behaves exactly as the code
 * says.
 *
 * Two invariants an admin cannot break from the panel, enforced HERE rather
 * than trusted from the input:
 *  - every number is clamped to a sane range (a zero would wedge every turn;
 *    an enormous one would let a runaway spend the reservation dry);
 *  - `hardTimeoutMs` is DERIVED as the wall clock plus one minute, never entered
 *    — so the "hard stop must outlast the soft stop" invariant holds by
 *    construction and the admin never sees, or can invert, that pair.
 */
import { getAppSettings } from "../../lib/app-settings.js"
import {
  COPILOT_TIERS,
  DEFAULT_COPILOT_TIER,
  resolveCopilotTier,
  type CopilotModelTier,
  type TierCaps,
} from "./constants.js"

/** What the admin edits — minutes, not milliseconds, and no hard timeout. */
export interface AdminTierCaps {
  maxIterations: number
  maxToolCalls: number
  wallClockMinutes: number
}

export const CAP_BOUNDS = {
  maxIterations: { min: 1, max: 100 },
  maxToolCalls: { min: 1, max: 400 },
  wallClockMinutes: { min: 1, max: 30 },
} as const

function clampInt(value: unknown, fallback: number, bounds: { min: number; max: number }): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(value)))
}

/** Merge one tier's admin override onto its compiled defaults. */
export function mergeTierCaps(defaults: TierCaps, override: Partial<AdminTierCaps> | undefined): TierCaps {
  const defaultMinutes = Math.round(defaults.wallClockMs / 60_000)
  const wallMinutes = clampInt(override?.wallClockMinutes, defaultMinutes, CAP_BOUNDS.wallClockMinutes)
  return {
    maxIterations: clampInt(override?.maxIterations, defaults.maxIterations, CAP_BOUNDS.maxIterations),
    maxToolCalls: clampInt(override?.maxToolCalls, defaults.maxToolCalls, CAP_BOUNDS.maxToolCalls),
    wallClockMs: wallMinutes * 60_000,
    // Derived, never entered: the hard timer always outlasts the soft wall by a
    // minute, so a turn that reaches its wall-clock stop reports "capped"
    // cleanly instead of being cut off mid-write.
    hardTimeoutMs: (wallMinutes + 1) * 60_000,
  }
}

export type CopilotTierCapsOverride = Partial<Record<CopilotModelTier, Partial<AdminTierCaps>>>

/**
 * The effective caps for every tier — compiled defaults with the admin
 * override merged and clamped. One read of the settings cache for all three.
 */
export async function resolveEffectiveTierCaps(): Promise<Record<CopilotModelTier, TierCaps>> {
  const settings = await getAppSettings()
  const override = ((settings as { copilot_tier_caps?: unknown }).copilot_tier_caps ?? {}) as CopilotTierCapsOverride
  return {
    economy: mergeTierCaps(COPILOT_TIERS.economy.caps, override.economy),
    standard: mergeTierCaps(COPILOT_TIERS.standard.caps, override.standard),
    premium: mergeTierCaps(COPILOT_TIERS.premium.caps, override.premium),
  }
}

/**
 * The tier a NEW thread starts on when the user has not chosen one. Applied at
 * thread creation and written to `model_tier`, so from then on the thread row
 * is the single authority and the reservation ceiling can never diverge from
 * what actually runs.
 */
export async function resolveDefaultTier(): Promise<CopilotModelTier> {
  const settings = await getAppSettings()
  const value = (settings as { copilot_default_tier?: unknown }).copilot_default_tier
  // Anything not a known tier falls back to the compiled default.
  return typeof value === "string" && value !== DEFAULT_COPILOT_TIER
    ? resolveCopilotTier(value)
    : DEFAULT_COPILOT_TIER
}
