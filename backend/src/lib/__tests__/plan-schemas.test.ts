import { describe, it, expect } from "vitest"
import {
  PLAN_TYPES,
  validatePlanByType,
  afterEffectsPlanSchema,
  lottieOverlayPlanSchema,
  threeDTitlePlanSchema,
  motionGraphicsPlanSchema,
  compositePlanSchema,
  sceneGraphPlanSchema,
  renderPlanSchema,
} from "../plan-schemas.js"

// ── Helpers ──────────────────────────────────────────────────────────────

function makeAfterEffectsPlan(overrides: Record<string, unknown> = {}) {
  return {
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 900,
    sourceVideo: "https://example.com/v.mp4",
    effects: [
      {
        type: "color-grade",
        brightness: 1,
        contrast: 1,
        saturation: 1,
        temperature: 0,
      },
    ],
    ...overrides,
  }
}

function makeLottieOverlayPlan(overrides: Record<string, unknown> = {}) {
  return {
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 900,
    sourceVideo: "https://example.com/v.mp4",
    overlays: [
      {
        id: "1",
        src: "https://example.com/a.json",
        startFrame: 0,
        durationInFrames: 100,
        position: { x: 10, y: 10, width: 50, height: 50 },
        opacity: 1,
        playbackRate: 1,
        loop: true,
      },
    ],
    ...overrides,
  }
}

function makeThreeDTitlePlan(overrides: Record<string, unknown> = {}) {
  return {
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 300,
    backgroundColor: "#000",
    camera: { fov: 75, position: [0, 0, 5], lookAt: [0, 0, 0] },
    lighting: {
      ambient: { intensity: 0.5, color: "#fff" },
      directional: [{ intensity: 1, color: "#fff", position: [5, 5, 5] }],
    },
    objects: [
      {
        id: "1",
        type: "3d-text",
        text: "HELLO",
        font: "Arial",
        size: 1,
        depth: 0.5,
        material: { type: "metallic", color: "#gold" },
        position: [0, 0, 0],
        animation: { type: "fade-in", startFrame: 0, durationFrames: 30 },
      },
    ],
    ...overrides,
  }
}

function makeMotionGraphicsPlan(overrides: Record<string, unknown> = {}) {
  return {
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 300,
    backgroundColor: "#000",
    elements: [
      {
        id: "1",
        type: "shape",
        shape: "rectangle",
        fill: "#ff0000",
        x: 100,
        y: 100,
        width: 200,
        height: 200,
        animation: { type: "fade", startFrame: 0, durationFrames: 30 },
      },
    ],
    ...overrides,
  }
}

function makeCompositePlan(overrides: Record<string, unknown> = {}) {
  return {
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 300,
    backgroundColor: "#000",
    layers: [
      {
        id: "1",
        sourceVideo: "https://example.com/v.mp4",
        position: "fullscreen",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        startFrame: 0,
        opacity: 1,
        blendMode: "normal",
        zIndex: 0,
      },
    ],
    ...overrides,
  }
}

function makeSceneGraphPlan(overrides: Record<string, unknown> = {}) {
  return {
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 300,
    backgroundColor: "#000",
    tracks: [
      {
        type: "media",
        id: "t1",
        zIndex: 0,
        segments: [
          {
            id: "s1",
            src: "https://example.com/img.jpg",
            mediaType: "image",
            startFrame: 0,
            durationInFrames: 150,
            layout: { mode: "fullscreen" },
          },
        ],
      },
    ],
    ...overrides,
  }
}

// ── PLAN_TYPES ───────────────────────────────────────────────────────────

describe("PLAN_TYPES", () => {
  it("has exactly 7 entries", () => {
    expect(PLAN_TYPES).toHaveLength(7)
  })

  it("contains all expected types", () => {
    expect(PLAN_TYPES).toContain("scene-graph")
    expect(PLAN_TYPES).toContain("after-effects")
    expect(PLAN_TYPES).toContain("lottie-overlay")
    expect(PLAN_TYPES).toContain("3d-title")
    expect(PLAN_TYPES).toContain("motion-graphics")
    expect(PLAN_TYPES).toContain("composite")
    expect(PLAN_TYPES).toContain("burn-captions")
  })
})

// ── after-effects ────────────────────────────────────────────────────────

describe("validatePlanByType — after-effects", () => {
  it("accepts a valid after-effects plan", () => {
    const plan = makeAfterEffectsPlan()
    const result = validatePlanByType("after-effects", plan)
    expect(result).toBeDefined()
    expect(result.planType).toBe("after-effects")
  })

  it("throws when effects array is missing", () => {
    const { effects, ...noEffects } = makeAfterEffectsPlan()
    expect(() => validatePlanByType("after-effects", noEffects)).toThrow()
  })

  it("throws when fps is below minimum (5)", () => {
    const plan = makeAfterEffectsPlan({ fps: 5 })
    expect(() => validatePlanByType("after-effects", plan)).toThrow()
  })

  it("throws when effect brightness is out of range", () => {
    const plan = makeAfterEffectsPlan({
      effects: [
        {
          type: "color-grade",
          brightness: 10,
          contrast: 1,
          saturation: 1,
          temperature: 0,
        },
      ],
    })
    expect(() => validatePlanByType("after-effects", plan)).toThrow()
  })
})

// ── lottie-overlay ───────────────────────────────────────────────────────

describe("validatePlanByType — lottie-overlay", () => {
  it("accepts a valid lottie-overlay plan", () => {
    const plan = makeLottieOverlayPlan()
    const result = validatePlanByType("lottie-overlay", plan)
    expect(result).toBeDefined()
    expect(result.planType).toBe("lottie-overlay")
  })

  it("throws when overlays array is empty (min 1)", () => {
    const plan = makeLottieOverlayPlan({ overlays: [] })
    expect(() => validatePlanByType("lottie-overlay", plan)).toThrow()
  })
})

// ── 3d-title ─────────────────────────────────────────────────────────────

describe("validatePlanByType — 3d-title", () => {
  it("accepts a valid 3d-title plan", () => {
    const plan = makeThreeDTitlePlan()
    const result = validatePlanByType("3d-title", plan)
    expect(result).toBeDefined()
    expect(result.planType).toBe("3d-title")
  })

  it("throws when objects array is missing", () => {
    const { objects, ...noObjects } = makeThreeDTitlePlan()
    expect(() => validatePlanByType("3d-title", noObjects)).toThrow()
  })
})

// ── motion-graphics ──────────────────────────────────────────────────────

describe("validatePlanByType — motion-graphics", () => {
  it("accepts a valid motion-graphics plan", () => {
    const plan = makeMotionGraphicsPlan()
    const result = validatePlanByType("motion-graphics", plan)
    expect(result).toBeDefined()
    expect(result.planType).toBe("motion-graphics")
  })

  it("throws when elements array is empty (min 1)", () => {
    const plan = makeMotionGraphicsPlan({ elements: [] })
    expect(() => validatePlanByType("motion-graphics", plan)).toThrow()
  })
})

// ── composite ────────────────────────────────────────────────────────────

describe("validatePlanByType — composite", () => {
  it("accepts a valid composite plan", () => {
    const plan = makeCompositePlan()
    const result = validatePlanByType("composite", plan)
    expect(result).toBeDefined()
    expect(result.planType).toBe("composite")
  })

  it("throws when layers array is empty (min 1)", () => {
    const plan = makeCompositePlan({ layers: [] })
    expect(() => validatePlanByType("composite", plan)).toThrow()
  })
})

// ── scene-graph ──────────────────────────────────────────────────────────

describe("validatePlanByType — scene-graph", () => {
  it("accepts a valid scene-graph plan", () => {
    const plan = makeSceneGraphPlan()
    const result = validatePlanByType("scene-graph", plan)
    expect(result).toBeDefined()
    expect(result.planType).toBe("scene-graph")
  })

  it("throws when tracks array is empty (min 1)", () => {
    const plan = makeSceneGraphPlan({ tracks: [] })
    expect(() => validatePlanByType("scene-graph", plan)).toThrow()
  })
})

// ── unknown type ─────────────────────────────────────────────────────────

describe("validatePlanByType — unknown type", () => {
  it("throws with message listing valid types", () => {
    expect(() => validatePlanByType("invalid", {})).toThrow(
      /Unknown planType "invalid".*Expected one of:/,
    )
  })
})

// ── Cross-cutting validation ─────────────────────────────────────────────

describe("cross-cutting validation", () => {
  it("throws when width exceeds 3840", () => {
    const plan = makeAfterEffectsPlan({ width: 4000 })
    expect(() => validatePlanByType("after-effects", plan)).toThrow()
  })

  it("throws when durationInFrames is 0", () => {
    const plan = makeCompositePlan({ durationInFrames: 0 })
    expect(() => validatePlanByType("composite", plan)).toThrow()
  })

  it("preserves extra fields via passthrough", () => {
    const plan = makeAfterEffectsPlan({ customField: "hello" })
    const result = validatePlanByType("after-effects", plan)
    expect((result as Record<string, unknown>).customField).toBe("hello")
  })

  it("preserves extra fields on scene-graph via passthrough", () => {
    const plan = makeSceneGraphPlan({ extraMeta: 42 })
    const result = validatePlanByType("scene-graph", plan)
    expect((result as Record<string, unknown>).extraMeta).toBe(42)
  })

  it("preserves extra fields on motion-graphics via passthrough", () => {
    const plan = makeMotionGraphicsPlan({ notes: "test" })
    const result = validatePlanByType("motion-graphics", plan)
    expect((result as Record<string, unknown>).notes).toBe("test")
  })
})
