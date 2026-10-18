import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "../model-catalog.js"
import {
  IMAGE_TO_VIDEO_PROVIDERS,
  TEXT_TO_VIDEO_PROVIDERS,
  VIDEO_GEN_PROVIDERS,
  VIDEO_REF_LIMITS_BY_PROVIDER,
  VIDEO_PROVIDERS_WITHOUT_DISPATCH,
  resolveVideoModeForInputs,
  resolveVideoProviderForMode,
  videoProviderRequiresImage,
  videoProviderRunsFromReferences,
} from "../model-constants.js"

/**
 * References-only runs (reference images wired, no start frame) — the
 * catalog-walking totality guard.
 *
 * Every unified-picker video model that takes reference images either declares
 * the `reference-to-video` capability (its provider runs from references
 * alone) and is then NEVER blocked by the "image required" gate, or is listed
 * below with the reason it cannot run that way. A new ref-capable model must
 * pick one, so it cannot silently regress to "image required" again.
 *
 * The resolver is the one rule the editor gate (`video-image-gate.ts`), the
 * browser DAG (`execute-node.ts`) and the orchestrator (`payload-builder.ts`)
 * all read, so asserting it here covers the four surfaces at once (the API's
 * `/v1/generate-video` uses the per-kind `hasMultimodalRef` rule, which the
 * route tests pin).
 */

/** Ref-capable models that CANNOT run from references alone, with the reason. */
const BLOCKED_WITHOUT_A_FRAME: Readonly<Record<string, string>> = {
  // No working dispatch at all (VIDEO_PROVIDERS_WITHOUT_DISPATCH): every run
  // fails at the router, so advertising a references-only run would be a lie.
  "kling-3-omni": "no dispatch path",
}

const T2V = "text-to-video" as const
const I2V = "image-to-video" as const

const refCapable = (VIDEO_GEN_PROVIDERS as readonly string[]).filter(
  (p) => (VIDEO_REF_LIMITS_BY_PROVIDER[p]?.images ?? 0) > 0,
)

describe("reference-to-video capability (catalog)", () => {
  it("is declared only on video models that also take reference images", () => {
    for (const m of Object.values(MODEL_CATALOG)) {
      if (!m.features?.includes("reference-to-video")) continue
      expect(m.kind, m.id).toBe("video")
      expect(m.features, m.id).toContain("reference-image")
      expect(VIDEO_REF_LIMITS_BY_PROVIDER[m.id]?.images ?? 0, m.id).toBeGreaterThan(0)
    }
  })

  it("every ref-capable unified-picker model is either reference-to-video or listed as blocked", () => {
    for (const p of refCapable) {
      const declared = videoProviderRunsFromReferences(p)
      const blocked = p in BLOCKED_WITHOUT_A_FRAME
      expect(declared !== blocked, `${p}: declare "reference-to-video" or list it in BLOCKED_WITHOUT_A_FRAME`).toBe(true)
    }
    for (const p of Object.keys(BLOCKED_WITHOUT_A_FRAME)) {
      expect(refCapable, `${p} is no longer ref-capable — drop it from the list`).toContain(p)
    }
  })

  it("the blocked list is exactly the undispatchable ref-capable models", () => {
    expect(Object.keys(BLOCKED_WITHOUT_A_FRAME).sort()).toEqual(
      refCapable.filter((p) => VIDEO_PROVIDERS_WITHOUT_DISPATCH.has(p)).sort(),
    )
  })
})

describe("references-only runs are never image-gated on a reference-to-video model", () => {
  for (const p of refCapable.filter((id) => videoProviderRunsFromReferences(id))) {
    it(`${p}: refs alone resolve to a lane that takes them`, () => {
      const mode = resolveVideoModeForInputs(p, { hasStartFrame: false, hasImageRefs: true })
      const resolved = resolveVideoProviderForMode(p, mode)
      // The t2v lane refuses an image-required model before looking at refs.
      expect(mode === T2V && videoProviderRequiresImage(resolved), `${p} would be refused as "image required"`).toBe(false)
      // ...and the lane chosen is a route enum member that carries the refs.
      const lane = (mode === I2V ? IMAGE_TO_VIDEO_PROVIDERS : TEXT_TO_VIDEO_PROVIDERS) as readonly string[]
      expect(lane, `${resolved} on ${mode}`).toContain(resolved)
      expect(VIDEO_REF_LIMITS_BY_PROVIDER[resolved]?.images ?? 0, resolved).toBeGreaterThan(0)
    })
  }

  it("a model with no text-to-video mode takes the image-to-video lane for refs alone", () => {
    for (const p of ["vidu-q4", "happyhorse-ref2v"]) {
      expect(resolveVideoModeForInputs(p, { hasStartFrame: false, hasImageRefs: true }), p).toBe(I2V)
    }
  })

  it("a single-id model WITH a text-to-video mode keeps the t2v lane for refs alone (unchanged)", () => {
    for (const p of ["seedance-2", "seedance-2-5", "minimax-h3", "wan-3", "gemini-omni-video", "veo3.1"]) {
      expect(resolveVideoModeForInputs(p, { hasStartFrame: false, hasImageRefs: true }), p).toBe(T2V)
    }
  })
})

describe("the friendly image-required refusal still stands", () => {
  it("nothing wired on an image-required model resolves to the gated t2v lane", () => {
    for (const p of VIDEO_GEN_PROVIDERS as readonly string[]) {
      if (!videoProviderRequiresImage(p)) continue
      const mode = resolveVideoModeForInputs(p, { hasStartFrame: false, hasImageRefs: false })
      expect(mode, p).toBe(T2V)
      expect(videoProviderRequiresImage(resolveVideoProviderForMode(p, mode)), p).toBe(true)
    }
  })

  it("a blocked-without-a-frame model is still refused when only refs are wired", () => {
    for (const p of Object.keys(BLOCKED_WITHOUT_A_FRAME)) {
      const mode = resolveVideoModeForInputs(p, { hasStartFrame: false, hasImageRefs: true })
      expect(mode === T2V && videoProviderRequiresImage(resolveVideoProviderForMode(p, mode)), p).toBe(true)
    }
  })
})
