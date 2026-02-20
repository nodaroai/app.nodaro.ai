import { z } from "zod"

// ── Plan Types ──────────────────────────────────────────────────────────

export const PLAN_TYPES = [
  "scene-graph",
  "after-effects",
  "lottie-overlay",
  "3d-title",
  "motion-graphics",
  "composite",
] as const

export type PlanType = (typeof PLAN_TYPES)[number]

// ── After Effects Plan ──────────────────────────────────────────────────

const colorGradeEffectSchema = z.object({
  type: z.literal("color-grade"),
  brightness: z.number().min(0.5).max(2.0),
  contrast: z.number().min(0.5).max(2.0),
  saturation: z.number().min(0).max(3.0),
  temperature: z.number().min(-100).max(100),
})

const vignetteEffectSchema = z.object({
  type: z.literal("vignette"),
  intensity: z.number().min(0).max(1),
  radius: z.number().min(0.2).max(1.0),
})

const filmGrainEffectSchema = z.object({
  type: z.literal("film-grain"),
  intensity: z.number().min(0).max(1),
  size: z.number().min(1).max(4),
  seed: z.number().optional(),
})

const noiseOverlayEffectSchema = z.object({
  type: z.literal("noise-overlay"),
  opacity: z.number().min(0).max(0.5),
  scale: z.number().min(0.001).max(0.01),
  animated: z.boolean(),
  noiseType: z.enum(["perlin", "simplex"]).optional(),
})

const letterboxEffectSchema = z.object({
  type: z.literal("letterbox"),
  ratio: z.number(),
  color: z.string(),
})

const motionBlurEffectSchema = z.object({
  type: z.literal("motion-blur"),
  shutterAngle: z.number().min(0).max(360),
  samples: z.number().min(1).max(16),
})

const animatedBlurEffectSchema = z.object({
  type: z.literal("animated-blur"),
  startBlur: z.number().min(0).max(50),
  endBlur: z.number().min(0).max(50),
  startFrame: z.number().min(0),
  durationFrames: z.number().min(1),
  easing: z.enum(["linear", "easeIn", "easeOut", "easeInOut"]).optional(),
})

const trailEffectSchema = z.object({
  type: z.literal("trail"),
  layers: z.number().int().min(1).max(10),
  lagInFrames: z.number().min(0.5).max(5),
  trailOpacity: z.number().min(0).max(1),
})

const afterEffectSchema = z.discriminatedUnion("type", [
  colorGradeEffectSchema,
  vignetteEffectSchema,
  filmGrainEffectSchema,
  noiseOverlayEffectSchema,
  letterboxEffectSchema,
  motionBlurEffectSchema,
  animatedBlurEffectSchema,
  trailEffectSchema,
])

const afterEffectsTextOverlaySchema = z.object({
  id: z.string(),
  text: z.string(),
  startFrame: z.number().min(0),
  durationInFrames: z.number().min(1),
  position: z.enum(["top", "center", "bottom"]),
  fontSize: z.number(),
  fontFamily: z.string().optional(),
  color: z.string(),
  animation: z.enum(["fade", "slide-up", "typewriter", "none"]),
})

export const afterEffectsPlanSchema = z
  .object({
    planType: z.literal("after-effects"),
    fps: z.number().min(15).max(60),
    width: z.number().min(100).max(3840),
    height: z.number().min(100).max(3840),
    durationInFrames: z.number().min(1),
    sourceVideo: z.string(),
    effects: z.array(afterEffectSchema),
    textOverlays: z.array(afterEffectsTextOverlaySchema).optional(),
  })
  .passthrough()

// ── Lottie Overlay Plan ─────────────────────────────────────────────────

const lottieOverlayPositionSchema = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  width: z.number().min(0).max(100),
  height: z.number().min(0).max(100),
})

const lottieOverlayItemSchema = z.object({
  id: z.string(),
  src: z.string().url(),
  startFrame: z.number().min(0),
  durationInFrames: z.number().min(1),
  position: lottieOverlayPositionSchema,
  opacity: z.number().min(0).max(1),
  playbackRate: z.number().min(0.1).max(3.0),
  loop: z.boolean(),
  renderer: z.enum(["svg", "canvas", "html"]).optional(),
})

export const lottieOverlayPlanSchema = z
  .object({
    planType: z.literal("lottie-overlay"),
    fps: z.number().min(15).max(60),
    width: z.number().min(100).max(3840),
    height: z.number().min(100).max(3840),
    durationInFrames: z.number().min(1),
    sourceVideo: z.string(),
    overlays: z.array(lottieOverlayItemSchema).min(1),
  })
  .passthrough()

// ── 3D Title Plan ───────────────────────────────────────────────────────

const vec3Schema = z.tuple([z.number(), z.number(), z.number()])

const threeDEasingSchema = z.enum(["linear", "easeIn", "easeOut", "easeInOut", "spring"])

const cameraAnimationSchema = z.object({
  type: z.enum(["orbit", "dolly", "static"]),
  startPosition: vec3Schema,
  endPosition: vec3Schema,
  easing: threeDEasingSchema.optional(),
})

const cameraSchema = z.object({
  fov: z.number(),
  position: vec3Schema,
  lookAt: vec3Schema,
  animation: cameraAnimationSchema.optional(),
})

const ambientLightSchema = z.object({
  intensity: z.number(),
  color: z.string(),
})

const directionalLightSchema = z.object({
  intensity: z.number(),
  color: z.string(),
  position: vec3Schema,
})

const lightingSchema = z.object({
  ambient: ambientLightSchema,
  directional: z.array(directionalLightSchema),
})

const threeDTextMaterialSchema = z.object({
  type: z.enum(["metallic", "glass", "emissive", "standard"]),
  color: z.string(),
  metalness: z.number().min(0).max(1).optional(),
  roughness: z.number().min(0).max(1).optional(),
  emissiveIntensity: z.number().optional(),
})

const threeDTextAnimationSchema = z.object({
  type: z.enum(["rotate-in", "scale-up", "fade-in", "slide-in", "none"]),
  axis: z.enum(["x", "y", "z"]).optional(),
  startFrame: z.number().min(0),
  durationFrames: z.number().min(1),
  easing: threeDEasingSchema.optional(),
})

const threeDTextObjectSchema = z.object({
  id: z.string(),
  type: z.literal("3d-text"),
  text: z.string(),
  font: z.string(),
  size: z.number(),
  depth: z.number(),
  material: threeDTextMaterialSchema,
  position: vec3Schema,
  animation: threeDTextAnimationSchema,
})

const particleSystemObjectSchema = z.object({
  id: z.string(),
  type: z.literal("particle-system"),
  count: z.number(),
  size: z.number(),
  color: z.string(),
  spread: vec3Schema,
  speed: z.number(),
  opacity: z.number().min(0).max(1),
})

const threeDTitleObjectSchema = z.discriminatedUnion("type", [
  threeDTextObjectSchema,
  particleSystemObjectSchema,
])

export const threeDTitlePlanSchema = z
  .object({
    planType: z.literal("3d-title"),
    fps: z.number().min(15).max(60),
    width: z.number().min(100).max(3840),
    height: z.number().min(100).max(3840),
    durationInFrames: z.number().min(1),
    backgroundColor: z.string(),
    backgroundMedia: z.string().optional(),
    camera: cameraSchema,
    lighting: lightingSchema,
    objects: z.array(threeDTitleObjectSchema).min(1),
  })
  .passthrough()

// ── Motion Graphics Plan ────────────────────────────────────────────────

const mgEasingSchema = z.enum(["linear", "easeIn", "easeOut", "easeInOut", "spring"])

const mgElementAnimationSchema = z.object({
  type: z.enum([
    "wipe-in",
    "scale-up",
    "fade",
    "draw-path",
    "slide-up",
    "slide-down",
    "slide-left",
    "slide-right",
    "none",
  ]),
  direction: z.enum(["left", "right", "up", "down"]).optional(),
  startFrame: z.number().min(0),
  durationFrames: z.number().min(0),
  easing: mgEasingSchema.optional(),
})

const mgShapeElementSchema = z.object({
  id: z.string(),
  type: z.literal("shape"),
  shape: z.enum(["rectangle", "circle", "line"]),
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  cornerRadius: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  animation: mgElementAnimationSchema,
})

const mgTextElementSchema = z.object({
  id: z.string(),
  type: z.literal("text"),
  text: z.string(),
  fontFamily: z.string(),
  fontSize: z.number(),
  fontWeight: z.number().optional(),
  color: z.string(),
  x: z.number(),
  y: z.number(),
  letterSpacing: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  animation: mgElementAnimationSchema,
})

const mgSvgPathElementSchema = z.object({
  id: z.string(),
  type: z.literal("svg-path"),
  path: z.string(),
  stroke: z.string(),
  strokeWidth: z.number(),
  fill: z.string().optional(),
  x: z.number(),
  y: z.number(),
  opacity: z.number().min(0).max(1).optional(),
  animation: mgElementAnimationSchema,
})

const mgElementSchema = z.discriminatedUnion("type", [
  mgShapeElementSchema,
  mgTextElementSchema,
  mgSvgPathElementSchema,
])

const mgExitAnimationSchema = z.object({
  type: z.enum(["fade", "slide-down", "slide-up", "slide-left", "slide-right", "none"]),
  startFrame: z.number().min(0),
  durationFrames: z.number().min(0),
})

export const motionGraphicsPlanSchema = z
  .object({
    planType: z.literal("motion-graphics"),
    fps: z.number().min(15).max(60),
    width: z.number().min(100).max(3840),
    height: z.number().min(100).max(3840),
    durationInFrames: z.number().min(1),
    backgroundColor: z.string(),
    elements: z.array(mgElementSchema).min(1),
    exitAnimation: mgExitAnimationSchema.optional(),
  })
  .passthrough()

// ── Composite Plan ────────────────────────────────────────────────────

const compositeLayerSchema = z.object({
  id: z.string(),
  sourceVideo: z.string().url(),
  position: z.enum(["fullscreen", "positioned"]),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  width: z.number().min(0).max(100),
  height: z.number().min(0).max(100),
  startFrame: z.number().min(0),
  durationInFrames: z.number().min(1).optional(),
  opacity: z.number().min(0).max(1),
  blendMode: z.enum(["normal", "multiply", "screen", "overlay"]),
  zIndex: z.number(),
})

export const compositePlanSchema = z
  .object({
    planType: z.literal("composite"),
    fps: z.number().min(15).max(60),
    width: z.number().min(100).max(3840),
    height: z.number().min(100).max(3840),
    durationInFrames: z.number().min(1),
    backgroundColor: z.string(),
    layers: z.array(compositeLayerSchema).min(1),
  })
  .passthrough()

// ── Render Plan Envelope (discriminated union) ──────────────────────────

export const renderPlanSchema = z.discriminatedUnion("planType", [
  afterEffectsPlanSchema,
  lottieOverlayPlanSchema,
  threeDTitlePlanSchema,
  motionGraphicsPlanSchema,
  compositePlanSchema,
])

// ── Plan type → schema lookup ───────────────────────────────────────────

const planSchemaMap: Record<string, z.ZodType> = {
  "after-effects": afterEffectsPlanSchema,
  "lottie-overlay": lottieOverlayPlanSchema,
  "3d-title": threeDTitlePlanSchema,
  "motion-graphics": motionGraphicsPlanSchema,
  "composite": compositePlanSchema,
}

/**
 * Validate a plan object against the schema for its planType.
 * Returns the validated (parsed) plan on success, or throws a
 * descriptive error with Zod issue details on failure.
 *
 * Note: "scene-graph" plans are not validated here because they use
 * a separate validation pipeline in scene-graph-validator.ts.
 */
export function validatePlanByType(planType: string, plan: unknown): z.infer<typeof renderPlanSchema> {
  const schema = planSchemaMap[planType]
  if (!schema) {
    throw new Error(
      `Unknown planType "${planType}". Expected one of: ${Object.keys(planSchemaMap).join(", ")}`,
    )
  }

  // Ensure the plan object includes the planType field for discriminated union parsing
  const planObj =
    typeof plan === "object" && plan !== null
      ? { ...(plan as Record<string, unknown>), planType }
      : { planType }

  const result = schema.safeParse(planObj)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ")
    throw new Error(`Plan validation failed for "${planType}": ${issues}`)
  }

  return result.data as z.infer<typeof renderPlanSchema>
}
