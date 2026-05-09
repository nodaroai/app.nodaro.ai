/**
 * L1#11 — Reference-image wiring coverage.
 *
 * Three sources of truth describe ref-image support:
 *
 *   1. `MODELS_WITH_REFERENCE_IMAGE_SUPPORT` (set of model IDs that accept
 *      reference images at all) — packages/shared/src/model-constants.ts
 *   2. `REF_IMAGE_MAX_LIMITS` (max count per model) — same file
 *   3. `MODEL_CATALOG[id].features` array containing "reference-image" —
 *      packages/shared/src/model-catalog.ts
 *
 * Drift between these means: a model "claims" ref-image support somewhere
 * but the wiring isn't complete elsewhere. Failure modes:
 *   - Set says yes, catalog feature missing → MCP `list_models` doesn't
 *     advertise the capability, agents miss the model.
 *   - Catalog says yes, set missing → frontend shows the upload widget but
 *     the route Zod silently strips the field (no enforcement on the way in).
 *   - Limits map has a model not in the set → dead-code limit, never queried.
 *
 * Bug class: developer adds a new model with reference-image support, lands
 * the route + provider client, but forgets to update one of the registries.
 * The user-facing experience silently degrades on whichever side is missing.
 */

import { describe, it, expect } from "vitest"
import {
  MODELS_WITH_REFERENCE_IMAGE_SUPPORT,
  REF_IMAGE_MAX_LIMITS,
  MODEL_CATALOG,
} from "@nodaro/shared"

/**
 * Allowlist of ref-image drifted models. Empty after the Phase 2 cleanup:
 * (a) all 12 image-model gaps (catalog feature missing) were fixed by
 *     adding "reference-image" to their MODEL_CATALOG entries.
 * (b) the 6 video-model false-positives (veo3/seedance-2/etc.) are now
 *     handled by scoping the catalog→set check to image models only —
 *     video models use the catalog feature legitimately for start-frame
 *     support, but image-configs.tsx (the consumer of
 *     MODELS_WITH_REFERENCE_IMAGE_SUPPORT) is image-only by design.
 */
const REF_IMAGE_DRIFT_ALLOWLIST: ReadonlySet<string> = new Set<string>([])

// ---------------------------------------------------------------------------
// Test 1 — every model in MODELS_WITH_REFERENCE_IMAGE_SUPPORT has a
// MODEL_CATALOG entry with `features` containing "reference-image".
// ---------------------------------------------------------------------------

describe('MODELS_WITH_REFERENCE_IMAGE_SUPPORT × MODEL_CATALOG.features = "reference-image"', () => {
  it.each([...MODELS_WITH_REFERENCE_IMAGE_SUPPORT].sort())(
    'MODEL_CATALOG["%s"].features contains "reference-image"',
    (modelId) => {
      if (REF_IMAGE_DRIFT_ALLOWLIST.has(modelId)) return
      const entry = MODEL_CATALOG[modelId]
      expect(
        entry,
        `Model "${modelId}" is in MODELS_WITH_REFERENCE_IMAGE_SUPPORT but has no MODEL_CATALOG entry. Add one in packages/shared/src/model-catalog.ts.`,
      ).toBeDefined()
      const features = entry?.features ?? []
      expect(
        features.includes("reference-image"),
        `Model "${modelId}" is in MODELS_WITH_REFERENCE_IMAGE_SUPPORT (so the route accepts ref images) but MODEL_CATALOG.${modelId}.features does NOT contain "reference-image". MCP \`list_models\` won't advertise the capability — Claude won't know to use it. Add "reference-image" to the features array in packages/shared/src/model-catalog.ts.`,
      ).toBe(true)
    },
  )
})

// ---------------------------------------------------------------------------
// Test 2 — every IMAGE model in MODEL_CATALOG with `features:
// ["reference-image"]` is in MODELS_WITH_REFERENCE_IMAGE_SUPPORT.
//
// The set is image-scoped by design — image-configs.tsx and
// reference-support-warning.tsx are the only consumers, and both gate the
// IMAGE upload widget. Video models legitimately declare the feature in
// the catalog (for start-frame support) but route through different
// frontend code paths and don't need set membership.
// ---------------------------------------------------------------------------

describe("MODEL_CATALOG ref-image image features × MODELS_WITH_REFERENCE_IMAGE_SUPPORT", () => {
  const imageCatalogClaimsRefImage = Object.entries(MODEL_CATALOG)
    .filter(([, entry]) => entry.kind === "image" && entry.features?.includes("reference-image"))
    .map(([id]) => id)
    .sort()

  it.each(imageCatalogClaimsRefImage)(
    'MODELS_WITH_REFERENCE_IMAGE_SUPPORT includes "%s" (image-kind catalog declares reference-image feature)',
    (modelId) => {
      if (REF_IMAGE_DRIFT_ALLOWLIST.has(modelId)) return
      expect(
        MODELS_WITH_REFERENCE_IMAGE_SUPPORT.has(modelId),
        `MODEL_CATALOG["${modelId}"] is an image model with "reference-image" feature but is missing from MODELS_WITH_REFERENCE_IMAGE_SUPPORT in packages/shared/src/model-constants.ts. The frontend may render an upload widget but the route Zod will silently strip the ref-image field. Add "${modelId}" to the set, or remove "reference-image" from the catalog features array.`,
      ).toBe(true)
    },
  )
})

// ---------------------------------------------------------------------------
// Test 3 — every model in REF_IMAGE_MAX_LIMITS is in
// MODELS_WITH_REFERENCE_IMAGE_SUPPORT (no orphan limits).
// ---------------------------------------------------------------------------

describe("REF_IMAGE_MAX_LIMITS × MODELS_WITH_REFERENCE_IMAGE_SUPPORT", () => {
  it.each(Object.keys(REF_IMAGE_MAX_LIMITS).sort())(
    'MODELS_WITH_REFERENCE_IMAGE_SUPPORT includes "%s" (which has a configured ref-image limit)',
    (modelId) => {
      if (REF_IMAGE_DRIFT_ALLOWLIST.has(modelId)) return
      expect(
        MODELS_WITH_REFERENCE_IMAGE_SUPPORT.has(modelId),
        `REF_IMAGE_MAX_LIMITS configures a limit for "${modelId}" but the model is missing from MODELS_WITH_REFERENCE_IMAGE_SUPPORT. The limit is dead — never consulted. Either add to the support set, or remove the limit entry. Both live in packages/shared/src/model-constants.ts.`,
      ).toBe(true)
    },
  )
})

// ---------------------------------------------------------------------------
// Test 4 — REF_IMAGE_DRIFT_ALLOWLIST integrity.
// ---------------------------------------------------------------------------

describe("REF_IMAGE_DRIFT_ALLOWLIST integrity", () => {
  it("every allowlist entry is still actually drifted (in one source but not the other)", () => {
    if (REF_IMAGE_DRIFT_ALLOWLIST.size === 0) return // empty list — nothing to verify
    const stale: string[] = []
    for (const id of REF_IMAGE_DRIFT_ALLOWLIST) {
      const inSet = MODELS_WITH_REFERENCE_IMAGE_SUPPORT.has(id)
      const inLimits = id in REF_IMAGE_MAX_LIMITS
      const inCatalog = MODEL_CATALOG[id]?.features?.includes("reference-image") ?? false
      // Drift means at least one source disagrees with the others.
      const allSame = inSet === inLimits && inSet === inCatalog
      if (allSame) stale.push(id)
    }
    expect(
      stale,
      `These REF_IMAGE_DRIFT_ALLOWLIST entries are no longer drifted (all sources agree) — remove from allowlist: ${stale.join(", ")}`,
    ).toEqual([])
  })
})
