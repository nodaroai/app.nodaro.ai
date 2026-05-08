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
 * Allowlist of ref-image drifted models. Each is currently divergent
 * between the three sources of truth and surfaced by Phase 2 of the
 * test-strategy. Two distinct categories:
 *
 *   (a) Image models in MODELS_WITH_REFERENCE_IMAGE_SUPPORT (set) but
 *       missing from MODEL_CATALOG.features. Frontend gates the ref-image
 *       upload widget correctly, but MCP `list_models` doesn't advertise
 *       the capability — agents may overlook these models. Fix: add
 *       "reference-image" to the catalog `features` array.
 *
 *   (b) Video models in MODEL_CATALOG.features = "reference-image" but not
 *       in MODELS_WITH_REFERENCE_IMAGE_SUPPORT. The set is image-only by
 *       design (used by image-configs.tsx for the upload widget); video
 *       models handle ref images via separate `imageUrls`/`startFrame`
 *       paths. Fix: either rename the set to clarify scope, or split the
 *       catalog feature into "reference-image" (image) and
 *       "reference-video"/"start-frame" (video).
 */
const REF_IMAGE_DRIFT_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  // L1#11-allowlist surfaced 2026-05-08 — category (a): image models with
  // set membership but no catalog feature flag. Quick fix is to add the
  // feature to the catalog entries.
  "flux",
  "flux-flex",
  "gpt-image",
  "gpt-image-2",
  "grok",
  "nano-banana-edit",
  "qwen",
  "recraft-remove-bg",
  "recraft-upscale",
  "seedream",
  "seedream-5-lite",
  "topaz-image-upscale",
  // L1#11-allowlist surfaced 2026-05-08 — category (b): video models with
  // catalog feature but image-only set lacks them by design. The right
  // long-term fix is splitting the catalog feature into image vs video
  // variants.
  "grok-i2v",
  "seedance-2",
  "seedance-2-fast",
  "veo3",
  "veo3.1",
  "veo3_lite",
])

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
// Test 2 — every model in MODEL_CATALOG with `features: ["reference-image"]`
// is in MODELS_WITH_REFERENCE_IMAGE_SUPPORT.
// ---------------------------------------------------------------------------

describe("MODEL_CATALOG ref-image features × MODELS_WITH_REFERENCE_IMAGE_SUPPORT", () => {
  const catalogClaimsRefImage = Object.entries(MODEL_CATALOG)
    .filter(([, entry]) => entry.features?.includes("reference-image"))
    .map(([id]) => id)
    .sort()

  it.each(catalogClaimsRefImage)(
    'MODELS_WITH_REFERENCE_IMAGE_SUPPORT includes "%s" (catalog declares reference-image feature)',
    (modelId) => {
      if (REF_IMAGE_DRIFT_ALLOWLIST.has(modelId)) return
      expect(
        MODELS_WITH_REFERENCE_IMAGE_SUPPORT.has(modelId),
        `MODEL_CATALOG["${modelId}"].features declares "reference-image" but the model is missing from MODELS_WITH_REFERENCE_IMAGE_SUPPORT in packages/shared/src/model-constants.ts. The frontend may render an upload widget but the route Zod will silently strip the ref-image field. Add "${modelId}" to the set, or remove "reference-image" from the catalog features array.`,
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
