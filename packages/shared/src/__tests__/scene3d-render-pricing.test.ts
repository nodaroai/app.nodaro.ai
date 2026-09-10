import { describe, it, expect } from "vitest"
import {
  PRO3D_RENDER_QUALITY_PROFILES,
  RENDER_VIDEO_CREDIT_ID,
  SCENE3D_LIMITS,
  SCENE3D_RENDER_BASE_MAX_PX,
  SCENE3D_RENDER_TIERS,
  SCENE3D_RENDER_TIER_MULTIPLIERS,
  SCENE3D_RENDER_XLARGE_MIN_AREA_PX,
  pro3DRenderFrameUnit,
  renderVideoCreditId,
  scene3DRenderTier,
  scene3DRenderTierCredits,
} from "../index.js"

/** The three reference frames the tiers are anchored to (PR #1328). */
const REFERENCE_FRAMES = {
  base: { width: 1920, height: 1080 },
  large: { width: 2560, height: 1440 },
  xlarge: { width: 2560, height: 2560 },
} as const

describe("scene3DRenderTier", () => {
  it("places each reference frame in its own tier", () => {
    for (const [tier, frame] of Object.entries(REFERENCE_FRAMES)) {
      expect(scene3DRenderTier(frame.width, frame.height)).toBe(tier)
    }
  })

  it("holds every pre-cap frame at the base price, square ones included", () => {
    // The promise of the 1920 gate: raising maxDimensionPx never reprices a
    // frame that was already renderable. 1920x1920 has the SAME pixel count as
    // 2560x1440 and is still base — area only decides ABOVE the gate.
    expect(scene3DRenderTier(1920, 1080)).toBe("base")
    expect(scene3DRenderTier(1080, 1920)).toBe("base")
    expect(scene3DRenderTier(1920, 1920)).toBe("base")
    expect(scene3DRenderTier(1680, 720)).toBe("base")
    expect(SCENE3D_RENDER_BASE_MAX_PX).toBe(1920)
  })

  it("tiers every aspect the 2560 cap makes reachable", () => {
    expect(scene3DRenderTier(2560, 1440)).toBe("large") // 16:9
    expect(scene3DRenderTier(1440, 2560)).toBe("large") // 9:16
    expect(scene3DRenderTier(2560, 1097)).toBe("large") // 21:9
    expect(scene3DRenderTier(2048, 2560)).toBe("xlarge") // 4:5
    expect(scene3DRenderTier(2560, 2560)).toBe("xlarge") // 1:1
  })

  it("splits large from xlarge at the midpoint of the two upper reference frames", () => {
    const midpoint = (REFERENCE_FRAMES.large.width * REFERENCE_FRAMES.large.height + REFERENCE_FRAMES.xlarge.width * REFERENCE_FRAMES.xlarge.height) / 2
    expect(SCENE3D_RENDER_XLARGE_MIN_AREA_PX).toBe(midpoint)
    // One pixel either side of the boundary, at a width past the gate.
    expect(scene3DRenderTier(2560, 2000)).toBe("large") // 5,120,000 exactly
    expect(scene3DRenderTier(2560, 2001)).toBe("xlarge") // 5,122,560
  })

  it("is base for anything that is not a pair of positive finite numbers", () => {
    expect(scene3DRenderTier(undefined, undefined)).toBe("base")
    expect(scene3DRenderTier("2560", "2560")).toBe("base")
    expect(scene3DRenderTier(Number.NaN, 2560)).toBe("base")
    expect(scene3DRenderTier(Infinity, 2560)).toBe("base")
    expect(scene3DRenderTier(0, 2560)).toBe("base")
    expect(scene3DRenderTier(-2560, -2560)).toBe("base")
  })

  it("covers the whole admissible range with a declared tier", () => {
    const max = SCENE3D_LIMITS.maxDimensionPx
    for (const w of [SCENE3D_LIMITS.minDimensionPx, 640, 1920, 1921, 2048, max]) {
      for (const h of [SCENE3D_LIMITS.minDimensionPx, 640, 1920, 1921, 2048, max]) {
        expect(SCENE3D_RENDER_TIERS).toContain(scene3DRenderTier(w, h))
      }
    }
  })
})

describe("scene3DRenderTierCredits", () => {
  it("is the declared ratio, rounded up", () => {
    // The worked examples the public docs print, from the built-in base of 50.
    expect(scene3DRenderTierCredits(50, "base")).toBe(50)
    expect(scene3DRenderTierCredits(50, "large")).toBe(75)
    expect(scene3DRenderTierCredits(50, "xlarge")).toBe(125)
  })

  it("never rounds a tier down below the base render it multiplies", () => {
    for (const base of [1, 3, 7, 15, 33, 50, 137]) {
      for (const tier of SCENE3D_RENDER_TIERS) {
        expect(scene3DRenderTierCredits(base, tier)).toBeGreaterThanOrEqual(base)
        expect(scene3DRenderTierCredits(base, tier)).toBe(
          Math.ceil(base * SCENE3D_RENDER_TIER_MULTIPLIERS[tier]),
        )
      }
    }
  })

  it("keeps the ladder monotonic", () => {
    expect(SCENE3D_RENDER_TIER_MULTIPLIERS.base).toBe(1)
    expect(SCENE3D_RENDER_TIER_MULTIPLIERS.large).toBeGreaterThan(SCENE3D_RENDER_TIER_MULTIPLIERS.base)
    expect(SCENE3D_RENDER_TIER_MULTIPLIERS.xlarge).toBeGreaterThan(SCENE3D_RENDER_TIER_MULTIPLIERS.large)
  })
})

describe("renderVideoCreditId", () => {
  it("keeps the bare identifier for a base-sized 3D scene plan", () => {
    expect(renderVideoCreditId({ planType: "3d-scene", plan: { width: 1920, height: 1080 } })).toBe(
      RENDER_VIDEO_CREDIT_ID,
    )
  })

  it("names the tier for a plan past the 1920 gate", () => {
    expect(renderVideoCreditId({ planType: "3d-scene", plan: { width: 2560, height: 1440 } })).toBe(
      "render-video:3d-large",
    )
    expect(renderVideoCreditId({ planType: "3d-scene", plan: { width: 2560, height: 2560 } })).toBe(
      "render-video:3d-xlarge",
    )
  })

  it("leaves every non-3D render on the flat identifier", () => {
    // scene-graph admits frames up to 3840 today at the flat price; tiering it
    // would raise the price of work people already run.
    expect(renderVideoCreditId({ planType: "scene-graph", plan: { width: 3840, height: 2160 } })).toBe(
      RENDER_VIDEO_CREDIT_ID,
    )
    expect(renderVideoCreditId({ planType: "lottie-graphic", plan: { width: 2560, height: 2560 } })).toBe(
      RENDER_VIDEO_CREDIT_ID,
    )
    expect(renderVideoCreditId({ template: "slideshow", aspectRatio: "16:9" })).toBe(RENDER_VIDEO_CREDIT_ID)
  })

  it("answers the flat identifier for anything unparseable", () => {
    expect(renderVideoCreditId(undefined)).toBe(RENDER_VIDEO_CREDIT_ID)
    expect(renderVideoCreditId(null)).toBe(RENDER_VIDEO_CREDIT_ID)
    expect(renderVideoCreditId("3d-scene")).toBe(RENDER_VIDEO_CREDIT_ID)
    expect(renderVideoCreditId({ planType: "3d-scene" })).toBe(RENDER_VIDEO_CREDIT_ID)
    expect(renderVideoCreditId({ planType: "3d-scene", plan: "{}" })).toBe(RENDER_VIDEO_CREDIT_ID)
    expect(renderVideoCreditId({ planType: "3d-scene", plan: {} })).toBe(RENDER_VIDEO_CREDIT_ID)
  })
})

describe("pro3DRenderFrameUnit", () => {
  it("keeps the configured spelling for base-sized frames", () => {
    for (const quality of PRO3D_RENDER_QUALITY_PROFILES) {
      expect(pro3DRenderFrameUnit(quality)).toBe(`pro-3d-render:render-frame:${quality}`)
      expect(pro3DRenderFrameUnit(quality, "base")).toBe(`pro-3d-render:render-frame:${quality}`)
    }
  })

  it("suffixes the tier for a frame past the gate", () => {
    expect(pro3DRenderFrameUnit("standard", "large")).toBe("pro-3d-render:render-frame:standard:large")
    expect(pro3DRenderFrameUnit("standard", "xlarge")).toBe("pro-3d-render:render-frame:standard:xlarge")
  })

  it("produces one distinct unit per tier", () => {
    const units = new Set(SCENE3D_RENDER_TIERS.map((tier) => pro3DRenderFrameUnit("standard", tier)))
    expect(units.size).toBe(SCENE3D_RENDER_TIERS.length)
  })
})
