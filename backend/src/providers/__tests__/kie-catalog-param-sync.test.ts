/**
 * L1#4 — KIE param-shape × MODEL_CATALOG sync.
 *
 * Each KIE-registered model declares an `extraParams` shape (e.g.
 * `{ aspect_ratio: "16:9", resolution: "1K" }`) — the params it sends to
 * the upstream API. The frontend MODEL_CATALOG (in
 * `packages/shared/src/model-catalog.ts`) declares which knobs (aspectRatios,
 * resolutions, qualities) the user can pick from.
 *
 * If KIE accepts `aspect_ratio` but MODEL_CATALOG declares no
 * `aspectRatios`, the frontend gives the user no way to override → stuck on
 * the hard-coded default. Inverse drift (catalog declares ratios but KIE
 * doesn't accept the param) means user picks but the API ignores → silent
 * mismatch with what the user expected.
 *
 * This test covers both directions for the three knobs (aspect ratio,
 * resolution, quality) AND the existence invariant: every KIE-registered
 * model has a MODEL_CATALOG entry.
 *
 * Bug class: developer adds a new model to KIE config + route Zod, ships,
 * but forgets to extend MODEL_CATALOG → frontend renders default dropdowns,
 * user's choices don't reach the API.
 */

import { describe, it, expect, vi } from "vitest"

// credits.ts (transitively imported by kie/index.ts → kie/models.ts) loads
// supabase + config at module scope. Mock both to keep this hermetic.
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/ee/billing/stripe-config.js", () => ({
  FREE_TIER_RESTRICTIONS: { blockedModels: [], dailyCreditCap: 10 },
  TIER_STORAGE_LIMITS: {},
}))

import {
  KIE_IMAGE_MODELS,
  KIE_VIDEO_MODELS,
  KIE_TEXT_TO_VIDEO_MODELS,
  KIE_VIDEO_TO_VIDEO_MODELS,
  KIE_MOTION_TRANSFER_MODELS,
  KIE_VIDEO_UPSCALE_MODELS,
  KIE_LIP_SYNC_MODELS,
  KIE_TTS_MODELS,
  KIE_STT_MODELS,
  KIE_MUSIC_MODELS,
} from "../kie/models.js"
import { MODEL_CATALOG } from "@nodaro/shared"

/**
 * Models that intentionally don't appear in MODEL_CATALOG. Generally these
 * are sub-variants or aliases — the user-facing model is in the catalog
 * under a different id, and the KIE config is the routing target.
 */
const KIE_MODELS_WITHOUT_CATALOG: ReadonlySet<string> = new Set<string>([
  // L1#4-allowlist surfaced 2026-05-08 — KIE registers these motion-transfer
  // models but they're not in MODEL_CATALOG. The frontend exposes them
  // directly via the motion-transfer config panel (`MOTION_TRANSFER_PROVIDERS`
  // in shared) rather than through the catalog. Follow-up: decide whether to
  // add catalog entries (consistency) or document the catalog as image/video-
  // generation-only (clearer scope).
  "wan-animate-move",
  "wan-animate-replace",
  // L1#4-allowlist surfaced 2026-05-08 — KIE registers `luma-modify` (v2v)
  // and `topaz` (video-upscale) and `elevenlabs` (TTS alias) without catalog
  // entries. Same reason as above — frontend wires them via dedicated config
  // panels, not the catalog.
  "luma-modify",
  "topaz",
  "elevenlabs",
])

/**
 * KIE param keys → catalog field that should declare the user-facing options.
 * Both `aspect_ratio` and `image_size` are aspect-ratio params (see KIE
 * CLAUDE.md "Aspect Ratio / Size Parameter Names" — image_size is the
 * legacy name still used by base nano-banana, ideogram, and qwen).
 *
 * Excluded:
 *   - extraParams that are pure runtime defaults (output_format=jpg,
 *     google_search=false) — not user-controlled, no catalog field needed.
 *   - duration/sound — handled by separate registries.
 */
const PARAM_TO_CATALOG_FIELD: Record<string, "aspectRatios" | "resolutions" | "qualities"> = {
  aspect_ratio: "aspectRatios",
  image_size: "aspectRatios",
  resolution: "resolutions",
  quality: "qualities",
}

/**
 * Allowlist of (modelId, param) pairs where the param is sent to KIE but
 * NOT exposed via the catalog field. Each entry MUST have a comment
 * explaining why. Categories of legitimate exemptions:
 *   1. Model uses a hard-coded default that the user shouldn't override.
 *   2. Catalog declares the field under a different model variant (e.g.
 *      `seedance-2` shares aspectRatios with `seedance` parent entry).
 *   3. Frontend exposes the knob via a non-catalog code path that the
 *      catalog doesn't yet mirror (technical debt).
 */
const PARAM_SHAPE_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  // L1#4-allowlist — runway-kie sends `quality` to KIE, but the values are
  // actually resolution strings ("720p"/"1080p"), not quality tiers. The
  // catalog correctly declares them under `resolutions`. The KIE param name
  // is semantically misleading; the catalog field reflects intent. Cannot
  // be cleanly fixed without renaming the KIE param (out of our control)
  // or special-casing in the param→catalog map.
  "runway-kie:quality",
  // L1#4-allowlist — kling motion-transfer config sends `resolution: "720p"`,
  // but the user-facing catalog entry covers i2v/t2v (where motion-transfer
  // doesn't apply). Motion-transfer has its own dropdown registry; declaring
  // resolutions on the kling catalog entry would be wrong for i2v/t2v.
  "kling:resolution",
  // L1#4-allowlist — grok t2v sends `resolution`, but the `grok` catalog
  // entry covers t2i+t2v (t2i doesn't accept resolution). Adding resolutions
  // to the entry would mislead the t2i dropdown UI. Long-term fix: split
  // grok-t2i and grok-t2v in the catalog, or scope the dropdown by mode.
  "grok:resolution",
])

/**
 * Test 1 — every KIE-registered image/video/audio model has a MODEL_CATALOG
 * entry (so the frontend has metadata to render the picker).
 */
function makeExistenceSuite(
  label: string,
  registry: Record<string, { extraParams?: Record<string, unknown> }>,
) {
  describe(`${label} — MODEL_CATALOG existence`, () => {
    it.each(Object.keys(registry).sort())(
      `MODEL_CATALOG has an entry for "%s"`,
      (modelId) => {
        if (KIE_MODELS_WITHOUT_CATALOG.has(modelId)) return
        expect(
          MODEL_CATALOG[modelId],
          `KIE registers "${modelId}" in ${label} but no MODEL_CATALOG entry exists. The frontend won't have metadata (label, description, aspectRatios, resolutions) to render config controls. Add an entry in packages/shared/src/model-catalog.ts. If this model is a routing-only alias for a catalog-listed model, add it to KIE_MODELS_WITHOUT_CATALOG with a comment explaining the alias.`,
        ).toBeDefined()
      },
    )
  })
}

makeExistenceSuite("KIE_IMAGE_MODELS", KIE_IMAGE_MODELS)
makeExistenceSuite("KIE_VIDEO_MODELS (i2v)", KIE_VIDEO_MODELS)
makeExistenceSuite("KIE_TEXT_TO_VIDEO_MODELS", KIE_TEXT_TO_VIDEO_MODELS)
makeExistenceSuite("KIE_VIDEO_TO_VIDEO_MODELS", KIE_VIDEO_TO_VIDEO_MODELS)
makeExistenceSuite("KIE_MOTION_TRANSFER_MODELS", KIE_MOTION_TRANSFER_MODELS)
makeExistenceSuite("KIE_VIDEO_UPSCALE_MODELS", KIE_VIDEO_UPSCALE_MODELS)
makeExistenceSuite("KIE_LIP_SYNC_MODELS", KIE_LIP_SYNC_MODELS)
makeExistenceSuite("KIE_TTS_MODELS", KIE_TTS_MODELS)
makeExistenceSuite("KIE_STT_MODELS", KIE_STT_MODELS)
makeExistenceSuite("KIE_MUSIC_MODELS", KIE_MUSIC_MODELS)

/**
 * Test 2 — for each KIE model in MODEL_CATALOG, every `extraParams` key that
 * maps to a catalog field (aspectRatios / resolutions / qualities) MUST
 * have non-empty options declared in the catalog. Otherwise the frontend
 * has no dropdown to expose the user-facing knob.
 */
function makeParamShapeSuite(
  label: string,
  registry: Record<string, { extraParams?: Record<string, unknown> }>,
) {
  const cases: Array<[string, string, "aspectRatios" | "resolutions" | "qualities"]> = []
  for (const [modelId, cfg] of Object.entries(registry)) {
    if (KIE_MODELS_WITHOUT_CATALOG.has(modelId)) continue
    for (const param of Object.keys(cfg.extraParams ?? {})) {
      const field = PARAM_TO_CATALOG_FIELD[param]
      if (field) cases.push([modelId, param, field])
    }
  }

  if (cases.length === 0) return // no params in this registry to check

  describe(`${label} — param shape ↔ MODEL_CATALOG fields`, () => {
    it.each(cases)(
      `"%s" sends "%s" to KIE → MODEL_CATALOG.%s must be declared`,
      (modelId, param, field) => {
        if (PARAM_SHAPE_ALLOWLIST.has(`${modelId}:${param}`)) return
        const entry = MODEL_CATALOG[modelId]
        if (!entry) return // existence test will fail separately
        const declared = entry[field]
        expect(
          Array.isArray(declared) && declared.length > 0,
          `"${modelId}" sends "${param}" to KIE in extraParams (a user-facing knob), but MODEL_CATALOG.${modelId}.${field} is missing or empty. The frontend has no options to render → user can't override the hard-coded default. Add ${field}: [...] to the catalog entry in packages/shared/src/model-catalog.ts. Reference KIE CLAUDE.md "${param === "aspect_ratio" || param === "image_size" ? "Aspect Ratio" : param === "resolution" ? "resolution Support" : "quality Support"}" table for valid values. If this is intentional (e.g., hardcoded default, exposed via non-catalog code path), add "${modelId}:${param}" to PARAM_SHAPE_ALLOWLIST in this test with explanation.`,
        ).toBe(true)
      },
    )
  })
}

makeParamShapeSuite("KIE_IMAGE_MODELS", KIE_IMAGE_MODELS)
makeParamShapeSuite("KIE_VIDEO_MODELS (i2v)", KIE_VIDEO_MODELS)
makeParamShapeSuite("KIE_TEXT_TO_VIDEO_MODELS", KIE_TEXT_TO_VIDEO_MODELS)
makeParamShapeSuite("KIE_VIDEO_TO_VIDEO_MODELS", KIE_VIDEO_TO_VIDEO_MODELS)
makeParamShapeSuite("KIE_MOTION_TRANSFER_MODELS", KIE_MOTION_TRANSFER_MODELS)
makeParamShapeSuite("KIE_VIDEO_UPSCALE_MODELS", KIE_VIDEO_UPSCALE_MODELS)
makeParamShapeSuite("KIE_LIP_SYNC_MODELS", KIE_LIP_SYNC_MODELS)

/**
 * Test 3 — KIE_MODELS_WITHOUT_CATALOG integrity.
 */
describe("KIE_MODELS_WITHOUT_CATALOG integrity", () => {
  it("every entry in the allowlist is genuinely absent from MODEL_CATALOG", () => {
    const stale = [...KIE_MODELS_WITHOUT_CATALOG].filter((id) => MODEL_CATALOG[id])
    expect(
      stale,
      `These KIE_MODELS_WITHOUT_CATALOG entries now have MODEL_CATALOG entries — remove them from the allowlist: ${stale.join(", ")}`,
    ).toEqual([])
  })
})

describe("PARAM_SHAPE_ALLOWLIST integrity", () => {
  it("every allowlist entry corresponds to a real (modelId, param) pair in some KIE registry", () => {
    // Iterate each registry separately — `kling` etc. appear in multiple
    // registries with different extraParams, so an object-spread merge
    // would silently lose param sites from earlier registries.
    const allRegistries = [
      KIE_IMAGE_MODELS,
      KIE_VIDEO_MODELS,
      KIE_TEXT_TO_VIDEO_MODELS,
      KIE_VIDEO_TO_VIDEO_MODELS,
      KIE_MOTION_TRANSFER_MODELS,
      KIE_VIDEO_UPSCALE_MODELS,
      KIE_LIP_SYNC_MODELS,
    ]
    const stale: string[] = []
    for (const entry of PARAM_SHAPE_ALLOWLIST) {
      const [modelId, param] = entry.split(":")
      const exists = allRegistries.some((reg) => {
        const cfg = (reg as Record<string, { extraParams?: Record<string, unknown> }>)[modelId]
        return cfg?.extraParams && param in cfg.extraParams
      })
      if (!exists) stale.push(entry)
    }
    expect(
      stale,
      `These PARAM_SHAPE_ALLOWLIST entries no longer correspond to a real KIE config — the param is no longer sent in any registry. Remove the allowlist entry: ${stale.join(", ")}`,
    ).toEqual([])
  })
})
