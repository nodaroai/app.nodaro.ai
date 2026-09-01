import { describe, it, expect } from "vitest"
import {
  GVP_SUPPORTED_PROVIDERS,
  GVP_DEFAULT_PROVIDER,
  isGvpSupportedProvider,
  GVP_EXTEND_PROVIDERS,
  supportsExtendRender,
  GVP_END_FRAME_PROVIDERS,
  supportsEndAnchor,
  segmentDurationsFor,
  minSegmentSecFor,
  maxSegmentSecFor,
  hasContiguousSegmentDurations,
  maxSegmentsFor,
  VIDEO_REF_LIMITS_BY_PROVIDER,
  VIDEO_PROVIDERS_WITHOUT_DISPATCH,
  isSeedance2Provider,
  isMinimaxH3Provider,
} from "../model-constants.js"
import { MODEL_CATALOG } from "../model-catalog.js"

/**
 * Generate Video Pro provider selection (2026-08-05: DERIVED, was a hand-kept
 * literal).
 *
 * The bar is what the pro engine's KEYFRAMES render method minimally needs —
 * a model that takes a generated start still and can carry reference images.
 * Extend (the r2v continuation chain) is a strictly narrower, separately
 * derived tier.
 *
 * The old pin asserted "every blessed SKU is Seedance-2 or MiniMax-H3", which
 * encoded the real invariant *blessed ⇒ rides the shared input resolver*. That
 * invariant did not survive the two-tier transport split, so it is REPLACED
 * here rather than deleted:
 *
 *   blessed         ⇒ i2v ∧ reference-image ∧ durations ∧ ∈ VIDEO_REF_LIMITS_BY_PROVIDER
 *   extend-eligible ⇒ features ∋ "video-reference"   (⊂ blessed)
 */
describe("GVP_SUPPORTED_PROVIDERS", () => {
  it("is the capability derivation, and these are its members today", () => {
    // Not a hand-kept list any more — this pin documents the CURRENT result so
    // a catalog edit that changes the offered SKUs is visible in review, while
    // the derivation itself is what ships.
    expect([...GVP_SUPPORTED_PROVIDERS]).toEqual([
      "seedance-2",
      "seedance-2-fast",
      "seedance-2-mini",
      "seedance-2-5",
      "minimax-h3",
      "veo3",
      "veo3.1",
      "veo3_lite",
      "gemini-omni-video",
      "gemini-omni-flash",
      "grok-i2v",
      "wan-3",
      "wan-3-prime",
      "happyhorse-ref2v",
    ])
  })

  it("lists the default SKU first (dropdowns render this order)", () => {
    expect(GVP_SUPPORTED_PROVIDERS[0]).toBe(GVP_DEFAULT_PROVIDER)
  })

  it("every blessed SKU meets the keyframes bar", () => {
    for (const p of GVP_SUPPORTED_PROVIDERS) {
      const m = MODEL_CATALOG[p]
      expect(m, `${p} must be in the catalog`).toBeDefined()
      expect(m!.kind).toBe("video")
      expect(m!.modes as readonly string[]).toContain("i2v")
      expect(m!.features ?? [], `${p} must accept reference images`).toContain("reference-image")
      // Segmentable: a model with no declared durations cannot be split, and a
      // silent 4-15s fallback would send lengths the provider rejects.
      expect(segmentDurationsFor(p).length, `${p} must declare durations`).toBeGreaterThan(0)
    }
  })

  /**
   * The cross-check that makes the catalog flag trustworthy.
   * VIDEO_REF_LIMITS_BY_PROVIDER was built by the 2026-06-28 audit of actual
   * backend reference-FORWARDING paths (it deliberately omits wan-i2v /
   * hailuo-2.3[-pro] / bytedance-pro[-fast] / grok-imagine-video-1.5, which
   * take a single image_url start frame and drop refs on the floor). If the
   * two signals ever disagree, one of them is lying about what the backend
   * does — fail the build rather than advertise a dropped capability.
   */
  it("agrees with VIDEO_REF_LIMITS_BY_PROVIDER (the forwarding-path audit)", () => {
    const withRefLimits = Object.keys(VIDEO_REF_LIMITS_BY_PROVIDER).filter(
      (id) => MODEL_CATALOG[id]?.kind === "video" && !VIDEO_PROVIDERS_WITHOUT_DISPATCH.has(id),
    )
    expect([...GVP_SUPPORTED_PROVIDERS].sort()).toEqual(withRefLimits.sort())
  })

  /**
   * Capability is necessary but NOT sufficient — a model also has to reach a
   * provider. kling-3-omni passes every capability check (i2v, reference-image,
   * 3-15s durations, a ref-limit row) and still fails at the router: its only
   * implementation is on Replicate while the i2v routing chain is KIE-only,
   * with no worker short-circuit. It was pulled from the frontend picker for
   * exactly that reason, and the pro node must not re-admit it through the
   * capability door.
   */
  it("excludes catalogued models that have no dispatch path", () => {
    expect(VIDEO_PROVIDERS_WITHOUT_DISPATCH.has("kling-3-omni")).toBe(true)
    // It would otherwise qualify: every capability check passes.
    const m = MODEL_CATALOG["kling-3-omni"]!
    expect(m.modes as readonly string[]).toContain("i2v")
    expect(m.features ?? []).toContain("reference-image")
    expect(VIDEO_REF_LIMITS_BY_PROVIDER["kling-3-omni"]).toBeDefined()
    for (const id of VIDEO_PROVIDERS_WITHOUT_DISPATCH) {
      expect(isGvpSupportedProvider(id), `${id} has no dispatch path`).toBe(false)
    }
  })

  it("predicate matches the list and rejects outsiders", () => {
    for (const p of GVP_SUPPORTED_PROVIDERS) expect(isGvpSupportedProvider(p)).toBe(true)
    // Start-frame-only i2v models: no reference-forwarding path, so no anchor
    // identity refs and no cast continuity — deliberately out.
    expect(isGvpSupportedProvider("wan-i2v")).toBe(false)
    expect(isGvpSupportedProvider("hailuo-2.3-pro")).toBe(false)
    expect(isGvpSupportedProvider("bytedance-pro")).toBe(false)
    expect(isGvpSupportedProvider("grok-imagine-video-1.5")).toBe(false)
    // Not i2v at all.
    expect(isGvpSupportedProvider("seedance-2-extend")).toBe(false)
    expect(isGvpSupportedProvider("runway-aleph")).toBe(false)
    expect(isGvpSupportedProvider(undefined)).toBe(false)
  })
})

describe("GVP_EXTEND_PROVIDERS", () => {
  it("is the r2v-capable subset, and equals the family gate it replaces", () => {
    expect([...GVP_EXTEND_PROVIDERS]).toEqual([
      "seedance-2",
      "seedance-2-fast",
      "seedance-2-mini",
      "seedance-2-5",
      "minimax-h3",
    ])
    // Behaviour-neutral swap: the derived set is exactly what the old
    // hardcoded `isSeedance2Provider || isMinimaxH3Provider` gate admitted.
    for (const p of GVP_EXTEND_PROVIDERS) {
      expect(isSeedance2Provider(p) || isMinimaxH3Provider(p)).toBe(true)
    }
  })

  it("is a strict subset of the blessed set", () => {
    for (const p of GVP_EXTEND_PROVIDERS) expect(isGvpSupportedProvider(p)).toBe(true)
    expect(GVP_EXTEND_PROVIDERS.length).toBeLessThan(GVP_SUPPORTED_PROVIDERS.length)
  })

  it("excludes gemini-omni-video — its video input is a V2V source, not a continuation ref", () => {
    // runGeminiOmni takes `video_list` with a trim window, auto-determines the
    // duration from the clip and prices flat per generation. That is a
    // different transport from an r2v conditioning tail.
    expect(isGvpSupportedProvider("gemini-omni-video")).toBe(true)
    expect(supportsExtendRender("gemini-omni-video")).toBe(false)
  })

  it("excludes wan-3 — reference videos are accepted but the extend chain is unwired", () => {
    // Wan 3.0 takes reference_video_urls, but (a) there is no wan-3 r2v
    // forwarding path yet and (b) KIE caps input-video seconds + output
    // duration at 30, which the segment bounds cannot express. So the catalog
    // deliberately withholds the `video-reference` feature: blessed for
    // keyframes, not for extend. Same precedent as gemini-omni-video.
    for (const p of ["wan-3", "wan-3-prime"]) {
      expect(isGvpSupportedProvider(p)).toBe(true)
      expect(supportsExtendRender(p)).toBe(false)
    }
  })

  it("keyframes-only SKUs reject extend", () => {
    for (const p of ["veo3", "veo3.1", "veo3_lite", "gemini-omni-video", "gemini-omni-flash", "grok-i2v", "happyhorse-ref2v", "wan-3", "wan-3-prime"]) {
      expect(isGvpSupportedProvider(p)).toBe(true)
      expect(supportsExtendRender(p)).toBe(false)
    }
    expect(supportsExtendRender(undefined)).toBe(false)
  })
})

describe("GVP_END_FRAME_PROVIDERS", () => {
  it("is the end-frame-capable subset — the keyframes end-anchor gate", () => {
    expect([...GVP_END_FRAME_PROVIDERS]).toEqual([
      "seedance-2",
      "seedance-2-fast",
      "seedance-2-mini",
      "seedance-2-5",
      "minimax-h3",
      "veo3",
      "veo3.1",
      "veo3_lite",
      "wan-3",
      "wan-3-prime",
    ])
  })

  it("covers minimax-h3 — the pre-existing bug this derivation fixes", () => {
    // minimax-h3 shipped as a GVP SKU on 2026-08-02 but wantEndAnchor was
    // `isSeedance2Provider(provider) && …`, so it never received an end anchor
    // despite carrying "end-frame" in the catalog.
    expect(supportsEndAnchor("minimax-h3")).toBe(true)
  })

  it("excludes SKUs with no closing-frame support", () => {
    expect(supportsEndAnchor("gemini-omni-video")).toBe(false)
    // Gemini Omni Flash mirrors its sibling exactly — the KIE schema exposes
    // first/last frame but the path is unwired for BOTH Omni SKUs, so neither
    // declares the catalog `end-frame` feature.
    expect(supportsEndAnchor("gemini-omni-flash")).toBe(false)
    expect(supportsEndAnchor("grok-i2v")).toBe(false)
    expect(supportsEndAnchor("happyhorse-ref2v")).toBe(false)
    expect(supportsEndAnchor(undefined)).toBe(false)
  })
})

describe("segment bounds", () => {
  it("reads each provider's own duration set", () => {
    expect(segmentDurationsFor("seedance-2")).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
    expect(segmentDurationsFor("veo3")).toEqual([4, 6, 8])
    expect(segmentDurationsFor("gemini-omni-video")).toEqual([4, 6, 8, 10])
    expect(segmentDurationsFor("grok-i2v")).toEqual([6, 10])
    expect(segmentDurationsFor("kling-3-omni")).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
    expect(segmentDurationsFor("nope")).toEqual([])
    expect(segmentDurationsFor(undefined)).toEqual([])
  })

  it("min/max are the ends of that set", () => {
    expect(minSegmentSecFor("seedance-2")).toBe(4)
    expect(maxSegmentSecFor("seedance-2")).toBe(15)
    expect(minSegmentSecFor("veo3")).toBe(4)
    expect(maxSegmentSecFor("veo3")).toBe(8)
    expect(minSegmentSecFor("grok-i2v")).toBe(6)
    expect(maxSegmentSecFor("grok-i2v")).toBe(10)
    expect(maxSegmentSecFor("nope")).toBe(0)
  })

  it("separates contiguous from sparse duration sets", () => {
    // Contiguous → the classic arithmetic splitter is valid.
    expect(hasContiguousSegmentDurations("seedance-2")).toBe(true)
    expect(hasContiguousSegmentDurations("seedance-2-fast")).toBe(true)
    expect(hasContiguousSegmentDurations("seedance-2-mini")).toBe(true)
    expect(hasContiguousSegmentDurations("minimax-h3")).toBe(true)
    expect(hasContiguousSegmentDurations("kling-3-omni")).toBe(true)
    expect(hasContiguousSegmentDurations("happyhorse-ref2v")).toBe(true)
    // Sparse → needs the discrete packer.
    expect(hasContiguousSegmentDurations("veo3")).toBe(false)
    expect(hasContiguousSegmentDurations("veo3.1")).toBe(false)
    expect(hasContiguousSegmentDurations("veo3_lite")).toBe(false)
    expect(hasContiguousSegmentDurations("gemini-omni-video")).toBe(false)
    expect(hasContiguousSegmentDurations("grok-i2v")).toBe(false)
    expect(hasContiguousSegmentDurations("nope")).toBe(false)
  })

  it("derives the segment ceiling from the cap and the provider's longest segment", () => {
    // The dynamic replacement for the old fixed 24.
    expect(maxSegmentsFor("seedance-2", 120)).toBe(8)
    expect(maxSegmentsFor("seedance-2", 600)).toBe(40)
    expect(maxSegmentsFor("gemini-omni-video", 600)).toBe(60)
    expect(maxSegmentsFor("grok-i2v", 600)).toBe(60)
    expect(maxSegmentsFor("veo3", 600)).toBe(75)
    expect(maxSegmentsFor("nope", 600)).toBe(0)
  })

  it("every blessed SKU has usable bounds (no silent 0)", () => {
    for (const p of GVP_SUPPORTED_PROVIDERS) {
      expect(minSegmentSecFor(p), p).toBeGreaterThan(0)
      expect(maxSegmentSecFor(p), p).toBeGreaterThanOrEqual(minSegmentSecFor(p))
      expect(maxSegmentsFor(p, 600), p).toBeGreaterThan(0)
    }
  })
})
