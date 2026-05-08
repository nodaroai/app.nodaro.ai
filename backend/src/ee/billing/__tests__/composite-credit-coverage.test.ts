/**
 * L1#7 — Composite credit identifier coverage.
 *
 * Variable-pricing models charge different credits based on a setting
 * (quality / resolution / rendering-speed). The route handler computes the
 * composite identifier via `buildCreditModelIdentifier()` and looks it up in
 * STATIC_CREDIT_COSTS. If a variant is missing from STATIC_CREDIT_COSTS, the
 * route silently falls back to the base price → free upgrades for the user
 * (revenue leak) or "Unknown model" 500 if the base is also missing.
 *
 * This test walks `VARIABLE_PRICING_MODELS` and PROBES
 * `buildCreditModelIdentifier()` with every plausible input. Because we use
 * the actual runtime function as the variant-naming source of truth, any
 * future change to the variant scheme (new quality tier, new resolution)
 * is automatically picked up — no per-test maintenance required.
 *
 * Bug class: developer adds a new high-quality / 2K / TURBO mode to the
 * frontend and provider routing, but forgets to add the per-variant pricing
 * entry. The user pays the base rate.
 */

import { describe, it, expect } from "vitest"
import { STATIC_CREDIT_COSTS } from "../credits.js"
import {
  VARIABLE_PRICING_MODELS,
  buildCreditModelIdentifier,
} from "@nodaro/shared"

/**
 * Generate every (quality, resolution, renderingSpeed, targetResolution)
 * combination relevant to `buildCreditModelIdentifier`. The dispatch only
 * cares about specific string values so a small Cartesian product is enough.
 */
function probedVariants(provider: string): Set<string> {
  const variants = new Set<string>()
  const QUALITY_VALUES = [undefined, "medium", "high"]
  const RESOLUTION_VALUES = [undefined, "1K", "2K", "4K"]
  const RENDERING_SPEED_VALUES = [undefined, "BALANCED", "TURBO", "QUALITY"]
  const TARGET_RESOLUTION_VALUES = [undefined, "2K", "4K", "8K"]

  for (const quality of QUALITY_VALUES) {
    for (const resolution of RESOLUTION_VALUES) {
      for (const renderingSpeed of RENDERING_SPEED_VALUES) {
        for (const targetResolution of TARGET_RESOLUTION_VALUES) {
          variants.add(
            buildCreditModelIdentifier(
              provider,
              quality,
              resolution,
              renderingSpeed,
              targetResolution,
            ),
          )
        }
      }
    }
  }
  return variants
}

// ---------------------------------------------------------------------------
// Test 1 — every VARIABLE_PRICING_MODELS provider produces at least one
// non-base variant via buildCreditModelIdentifier. If the only output is the
// bare provider, then the model is in VARIABLE_PRICING_MODELS but
// buildCreditModelIdentifier never emits a composite for it — drift between
// the registry and the runtime fn.
// ---------------------------------------------------------------------------

describe("VARIABLE_PRICING_MODELS providers emit at least one composite variant", () => {
  it.each(Object.keys(VARIABLE_PRICING_MODELS))(
    'buildCreditModelIdentifier emits a composite for "%s"',
    (provider) => {
      const variants = probedVariants(provider)
      const composites = [...variants].filter((v) => v !== provider)
      expect(
        composites.length,
        `Provider "${provider}" is in VARIABLE_PRICING_MODELS but buildCreditModelIdentifier never emits a composite identifier (e.g., "${provider}:2K") for any input. Either (a) buildCreditModelIdentifier is missing a branch — add the appropriate provider Set entry in packages/shared/src/model-constants.ts — or (b) remove it from VARIABLE_PRICING_MODELS if it doesn't actually have variable pricing.`,
      ).toBeGreaterThan(0)
    },
  )
})

// ---------------------------------------------------------------------------
// Test 2 — every variant emitted by buildCreditModelIdentifier (base + every
// composite) has an entry in STATIC_CREDIT_COSTS.
// ---------------------------------------------------------------------------

describe("VARIABLE_PRICING_MODELS variants are all in STATIC_CREDIT_COSTS", () => {
  // Build a flat list of (provider, variant) tuples for it.each.
  const cases: Array<[string, string]> = []
  for (const provider of Object.keys(VARIABLE_PRICING_MODELS)) {
    for (const variant of probedVariants(provider)) {
      cases.push([provider, variant])
    }
  }

  it.each(cases)(
    'STATIC_CREDIT_COSTS["%s"] is defined (provider %s)',
    (_provider, variant) => {
      expect(
        STATIC_CREDIT_COSTS[variant],
        `Expected STATIC_CREDIT_COSTS["${variant}"] to be defined. buildCreditModelIdentifier emits this identifier at runtime for variable-pricing provider "${_provider}", but STATIC_CREDIT_COSTS has no entry. The route will fall back to undefined → either a runtime error (best case, surfaced fast) or an under/overcharge (worst case, silent revenue leak). Add an entry in backend/src/ee/billing/credits.ts::STATIC_CREDIT_COSTS, AND a matching INSERT INTO model_pricing migration so admins can see/override (per L1#2 + CLAUDE.md step 9).`,
      ).toBeDefined()
    },
  )
})
