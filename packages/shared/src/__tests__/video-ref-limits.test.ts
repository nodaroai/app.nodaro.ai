import { describe, expect, it } from "vitest"
import {
  SEEDANCE_2_REF_LIMITS,
  VIDEO_REF_LIMITS_BY_PROVIDER,
} from "../model-constants.js"
import { MODEL_CATALOG } from "../model-catalog.js"

describe("VIDEO_REF_LIMITS_BY_PROVIDER", () => {
  it("seedance-2 providers get the SEEDANCE_2_REF_LIMITS shape", () => {
    expect(VIDEO_REF_LIMITS_BY_PROVIDER["seedance-2"]).toEqual({
      images: SEEDANCE_2_REF_LIMITS.images,
      videos: SEEDANCE_2_REF_LIMITS.videos,
      audio: SEEDANCE_2_REF_LIMITS.audio,
    })
    expect(VIDEO_REF_LIMITS_BY_PROVIDER["seedance-2-fast"]).toEqual({
      images: SEEDANCE_2_REF_LIMITS.images,
      videos: SEEDANCE_2_REF_LIMITS.videos,
      audio: SEEDANCE_2_REF_LIMITS.audio,
    })
  })
  it("non-seedance providers either have just an images cap or are absent", () => {
    expect(VIDEO_REF_LIMITS_BY_PROVIDER["grok-i2v"]?.images).toBeGreaterThanOrEqual(1)
    expect(VIDEO_REF_LIMITS_BY_PROVIDER["kling-turbo"]).toBeUndefined()
    // Not verified reference-forwarders (2026-06-28 audit) → deliberately absent.
    expect(VIDEO_REF_LIMITS_BY_PROVIDER["wan-i2v"]).toBeUndefined()
    expect(VIDEO_REF_LIMITS_BY_PROVIDER["grok-imagine-video-1.5"]).toBeUndefined()
  })
})

describe("VIDEO_REF_LIMITS_BY_PROVIDER ⇄ MODEL_CATALOG drift guard", () => {
  // The catalog (kind:"video" + features:["reference-image"]) is the SINGLE
  // authority on WHICH video models accept image references;
  // VIDEO_REF_LIMITS_BY_PROVIDER holds the per-provider NUMERIC caps. These two
  // MUST stay in 1:1 correspondence — a ref-capable video model with no cap entry
  // (or a cap entry with no catalog flag) is exactly the drift that silently broke
  // `connectedReferences` coverage (6 ref-capable models had no cap; 6 capped
  // models weren't flagged). This invariant fails CI on any future divergence.
  const catalogRefVideoIds = Object.values(MODEL_CATALOG)
    .filter((m) => m.kind === "video" && m.features?.includes("reference-image"))
    .map((m) => m.id)
    .sort()
  const mapIds = Object.keys(VIDEO_REF_LIMITS_BY_PROVIDER).sort()

  it("every reference-capable video model in the catalog has a numeric cap entry", () => {
    const missing = catalogRefVideoIds.filter((id) => !(id in VIDEO_REF_LIMITS_BY_PROVIDER))
    expect(missing).toEqual([])
  })

  it("every numeric cap entry corresponds to a reference-capable video model in the catalog", () => {
    const orphan = mapIds.filter((id) => !catalogRefVideoIds.includes(id))
    expect(orphan).toEqual([])
  })

  it("the two sets are exactly equal (no drift in either direction)", () => {
    expect(mapIds).toEqual(catalogRefVideoIds)
  })
})

describe("VIDEO_REF_LIMITS_BY_PROVIDER caps for the newly-covered models", () => {
  it("VEO family carries images:3 (the REFERENCE_2_VIDEO slice cap in kie/video.ts)", () => {
    expect(VIDEO_REF_LIMITS_BY_PROVIDER["veo3"]).toEqual({ images: 3 })
    expect(VIDEO_REF_LIMITS_BY_PROVIDER["veo3.1"]).toEqual({ images: 3 })
    expect(VIDEO_REF_LIMITS_BY_PROVIDER["veo3_lite"]).toEqual({ images: 3 })
  })
  it("kling-3-omni and grok-i2v carry images:7", () => {
    expect(VIDEO_REF_LIMITS_BY_PROVIDER["kling-3-omni"]).toEqual({ images: 7 })
    expect(VIDEO_REF_LIMITS_BY_PROVIDER["grok-i2v"]).toEqual({ images: 7 })
  })
  it("happyhorse-ref2v carries images:9", () => {
    expect(VIDEO_REF_LIMITS_BY_PROVIDER["happyhorse-ref2v"]).toEqual({ images: 9 })
  })
})
