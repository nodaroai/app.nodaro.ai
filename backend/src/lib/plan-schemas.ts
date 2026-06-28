import { z } from "zod"
import { safeUrlSchema } from "./url-validator.js"
import { KINETIC_CAPTION_STYLES, SUPPORTED_FONT_NAMES } from "@nodaro/shared"

// ── Plan Types ──────────────────────────────────────────────────────────

export const PLAN_TYPES = [
  "scene-graph",
  "after-effects",
  "lottie-overlay",
  "3d-title",
  "motion-graphics",
  "composite",
  "burn-captions",
  "lottie-graphic",
  "shot-sequence",
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
  samples: z.number().min(1).max(8),
})

const animatedBlurEffectSchema = z.object({
  type: z.literal("animated-blur"),
  startBlur: z.number().min(0).max(50),
  endBlur: z.number().min(0).max(50),
  startFrame: z.number().min(0),
  durationFrames: z.number().min(1).max(54000),
  easing: z.enum(["linear", "easeIn", "easeOut", "easeInOut"]).optional(),
})

const trailEffectSchema = z.object({
  type: z.literal("trail"),
  layers: z.number().int().min(1).max(5),
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
  durationInFrames: z.number().min(1).max(54000),
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
    durationInFrames: z.number().min(1).max(54000),
    sourceVideo: safeUrlSchema,
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
  src: safeUrlSchema,
  startFrame: z.number().min(0),
  durationInFrames: z.number().min(1).max(54000),
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
    durationInFrames: z.number().min(1).max(54000),
    sourceVideo: safeUrlSchema,
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
  durationFrames: z.number().min(1).max(54000),
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
    durationInFrames: z.number().min(1).max(54000),
    backgroundColor: z.string(),
    backgroundMedia: safeUrlSchema.optional(),
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
  durationFrames: z.number().min(0).max(54000),
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
  durationFrames: z.number().min(0).max(54000),
})

export const motionGraphicsPlanSchema = z
  .object({
    planType: z.literal("motion-graphics"),
    fps: z.number().min(15).max(60),
    width: z.number().min(100).max(3840),
    height: z.number().min(100).max(3840),
    durationInFrames: z.number().min(1).max(54000),
    backgroundColor: z.string(),
    elements: z.array(mgElementSchema).min(1),
    exitAnimation: mgExitAnimationSchema.optional(),
  })
  .passthrough()

// ── Lottie Graphic Plan ─────────────────────────────────────────────────
// Render-time envelope for an LLM-authored Lottie document. The `lottie`
// field is the raw Lottie JSON; it is structurally validated by the
// dedicated lottie-graphic validator at generation time, so here it is only
// typed as an opaque record. `slots`/`slotValues` carry the slot bindings
// applied via applySlots before render.

export const lottieGraphicPlanSchema = z
  .object({
    planType: z.literal("lottie-graphic"),
    fps: z.number().min(15).max(60),
    width: z.number().min(100).max(3840),
    height: z.number().min(100).max(3840),
    durationInFrames: z.number().min(1).max(54000),
    backgroundColor: z.string(),
    lottie: z.record(z.unknown()),
    slots: z.record(z.unknown()).default({}),
    slotValues: z.record(z.unknown()).default({}),
  })
  .passthrough()

// ── Composite Plan ────────────────────────────────────────────────────

const compositeLayerSchema = z.object({
  id: z.string(),
  sourceVideo: safeUrlSchema,
  position: z.enum(["fullscreen", "positioned"]),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  width: z.number().min(0).max(100),
  height: z.number().min(0).max(100),
  startFrame: z.number().min(0),
  durationInFrames: z.number().min(1).max(54000).optional(),
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
    durationInFrames: z.number().min(1).max(54000),
    backgroundColor: z.string(),
    layers: z.array(compositeLayerSchema).min(1),
  })
  .passthrough()

// ── Burn Captions Plan ──────────────────────────────────────────────────

const captionSchema = z.object({
  text: z.string(),
  startMs: z.number().min(0),
  endMs: z.number().min(0),
  timestampMs: z.number().min(0).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
})

export const burnCaptionsPlanSchema = z
  .object({
    planType: z.literal("burn-captions"),
    sourceVideo: safeUrlSchema,
    captions: z.array(captionSchema).min(1),
    style: z.enum(KINETIC_CAPTION_STYLES),
    position: z.enum(["top", "center", "bottom"]),
    fontSize: z.number().min(12).max(200),
    color: z.string(),
    backgroundColor: z.string().optional(),
    fps: z.number().min(15).max(60),
    width: z.number().min(100).max(3840),
    height: z.number().min(100).max(3840),
    durationInFrames: z.number().min(1).max(108000),
  })
  .passthrough()

// ── Scene Graph Plan (for plan-based render pipeline) ──────────────────

const sgTransitionSchema = z.object({
  type: z.enum(["fade", "slide-left", "slide-right", "slide-up", "slide-down", "dissolve", "zoom-in", "zoom-out", "none"]),
  durationFrames: z.number().min(0).max(120),
})

const sgEffectSchema = z.object({
  type: z.enum(["ken-burns", "scale", "opacity", "blur"]),
  startValue: z.number(),
  endValue: z.number(),
})

const sgSegmentLayoutSchema = z.object({
  mode: z.enum(["fullscreen", "positioned"]),
  x: z.number().min(0).max(100).optional(),
  y: z.number().min(0).max(100).optional(),
  width: z.number().min(0).max(100).optional(),
  height: z.number().min(0).max(100).optional(),
  objectFit: z.enum(["cover", "contain", "fill"]).optional(),
})

const sgMediaSegmentSchema = z.object({
  id: z.string(),
  src: safeUrlSchema,
  mediaType: z.enum(["image", "video", "gif"]),
  startFrame: z.number().min(0),
  durationInFrames: z.number().min(1).max(54000),
  layout: sgSegmentLayoutSchema,
  transitionIn: sgTransitionSchema.optional(),
  transitionOut: sgTransitionSchema.optional(),
  effects: z.array(sgEffectSchema).default([]),
})

const sgTextSegmentSchema = z.object({
  id: z.string(),
  text: z.string(),
  startFrame: z.number().min(0),
  durationInFrames: z.number().min(1).max(54000),
  position: z.enum(["top", "center", "bottom"]),
  fontSize: z.number().min(8).max(200),
  fontFamily: z.string().optional(),
  color: z.string(),
  fontWeight: z.number().optional(),
  fontStyle: z.enum(["normal", "italic"]).optional(),
  animation: z.enum(["fade", "slide-up", "typewriter", "word-highlight", "none"]),
})

const sgMediaTrackSchema = z.object({
  type: z.literal("media"),
  id: z.string(),
  zIndex: z.number(),
  segments: z.array(sgMediaSegmentSchema).min(1),
})

const sgAudioTrackSchema = z.object({
  type: z.literal("audio"),
  id: z.string(),
  src: safeUrlSchema,
  volume: z.number().min(0).max(1),
  fadeInFrames: z.number().min(0),
  fadeOutFrames: z.number().min(0),
  startFrame: z.number().min(0).optional(),
})

const sgTextTrackSchema = z.object({
  type: z.literal("text"),
  id: z.string(),
  zIndex: z.number(),
  segments: z.array(sgTextSegmentSchema).min(1),
})

const sgTrackSchema = z.discriminatedUnion("type", [sgMediaTrackSchema, sgAudioTrackSchema, sgTextTrackSchema])

export const sceneGraphPlanSchema = z
  .object({
    planType: z.literal("scene-graph"),
    fps: z.number().min(15).max(60),
    width: z.number().min(100).max(3840),
    height: z.number().min(100).max(3840),
    durationInFrames: z.number().min(1).max(54000),
    backgroundColor: z.string(),
    tracks: z.array(sgTrackSchema).min(1),
  })
  .passthrough()

// ── Shot Sequence Plan (VO-cued reveals) ────────────────────────────────

const MAX_FRAMES = 54000

/** Entrance motion for a reveal (resolved + brief share this). */
export const enterMotionSchema = z.object({
  motion: z.enum([
    "fade",
    "scale-up",
    "wipe-in",
    "slide-up",
    "slide-down",
    "slide-left",
    "slide-right",
    "none",
  ]),
  durationFrames: z.number().min(0).max(MAX_FRAMES),
  easing: z.enum(["linear", "easeIn", "easeOut", "easeInOut", "spring"]).optional(),
  direction: z.enum(["left", "right", "up", "down"]).optional(),
})

/** Exit motion — constrained to what getExitStyle actually implements. */
export const exitMotionSchema = z.object({
  motion: z.enum(["fade", "slide-up", "slide-down", "slide-left", "slide-right", "none"]),
  durationFrames: z.number().min(0).max(MAX_FRAMES),
  easing: z.enum(["linear", "easeIn", "easeOut", "easeInOut", "spring"]).optional(),
  direction: z.enum(["left", "right", "up", "down"]).optional(),
})

const shotTextElementSchema = z.object({
  id: z.string(),
  type: z.literal("text"),
  text: z.string(),
  fontFamily: z.enum(SUPPORTED_FONT_NAMES),
  fontSize: z.number(),
  fontWeight: z.union([z.literal(300), z.literal(400), z.literal(700), z.literal(900)]).optional(),
  color: z.string(),
  x: z.number(),
  y: z.number(),
  letterSpacing: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
})

const shotShapeElementSchema = z.object({
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
})

/** Visual element (text or shape). svg-path is deferred (Phase 0 boundary). */
export const shotElementSchema = z.discriminatedUnion("type", [
  shotTextElementSchema,
  shotShapeElementSchema,
])

const resolvedRevealSchema = z.object({
  id: z.string(),
  element: shotElementSchema,
  frame: z.number().min(0).max(MAX_FRAMES), // SCENE-RELATIVE baked entrance frame
  enter: enterMotionSchema,
  hold: z.number().min(0).optional(),
  exit: exitMotionSchema.optional(),
})

const resolvedShotSchema = z.object({
  id: z.string(),
  reveals: z.array(resolvedRevealSchema).min(1),
})

const resolvedSceneSchema = z.object({
  id: z.string(),
  startFrame: z.number().min(0), // ABSOLUTE composition frame the scene <Sequence> mounts at
  durationInFrames: z.number().min(1).max(MAX_FRAMES),
  background: z.object({ color: z.string().optional() }).optional(),
  shots: z.array(resolvedShotSchema).min(1),
})

/** Base object — this is what the discriminated union references. */
export const shotSequencePlanBaseSchema = z
  .object({
    planType: z.literal("shot-sequence"),
    fps: z.number().min(15).max(60),
    width: z.number().min(100).max(3840),
    height: z.number().min(100).max(3840),
    durationInFrames: z.number().min(1).max(MAX_FRAMES),
    backgroundColor: z.string(),
    audio: z.object({ src: safeUrlSchema, volume: z.number().min(0).max(1).optional() }),
    scenes: z.array(resolvedSceneSchema).min(1),
  })
  .passthrough()

/**
 * Validated schema (used by planSchemaMap + validatePlanByType): adds the
 * cross-field invariants. MUST stay a ZodEffects here and out of the
 * discriminated union (unions require plain ZodObjects). render_shot_sequence
 * accepts pre-baked plans, so these checks cannot live only in the baker.
 */
export const shotSequencePlanSchema = shotSequencePlanBaseSchema.superRefine((plan, ctx) => {
  const sceneIds = new Set<string>()
  const revealIds = new Set<string>()
  let prevEnd = -1
  plan.scenes.forEach((scene, i) => {
    if (sceneIds.has(scene.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate scene id "${scene.id}"`, path: ["scenes", i, "id"] })
    }
    sceneIds.add(scene.id)
    if (scene.startFrame < prevEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Scene "${scene.id}" window starts at ${scene.startFrame} but the previous scene ends at ${prevEnd}; scenes must be ascending and non-overlapping`,
        path: ["scenes", i, "startFrame"],
      })
    }
    prevEnd = scene.startFrame + scene.durationInFrames
    scene.shots.forEach((shot, j) =>
      shot.reveals.forEach((r, k) => {
        if (revealIds.has(r.id)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate reveal id "${r.id}"`, path: ["scenes", i, "shots", j, "reveals", k, "id"] })
        }
        revealIds.add(r.id)
      }),
    )
  })
})

export type ShotSequencePlan = z.infer<typeof shotSequencePlanSchema>

/** Single ElevenLabs forced-alignment word (SECONDS). Reused by the resolver. */
export const alignmentWordSchema = z.object({
  word: z.string(),
  start: z.number().finite().min(0),
  end: z.number().finite().min(0),
})

// ── Render Plan Envelope (discriminated union) ──────────────────────────

export const renderPlanSchema = z.discriminatedUnion("planType", [
  sceneGraphPlanSchema,
  afterEffectsPlanSchema,
  lottieOverlayPlanSchema,
  threeDTitlePlanSchema,
  motionGraphicsPlanSchema,
  compositePlanSchema,
  burnCaptionsPlanSchema,
  lottieGraphicPlanSchema,
  shotSequencePlanBaseSchema,
])

// ── Plan type → schema lookup ───────────────────────────────────────────

export const planSchemaMap: Record<string, z.ZodType> = {
  "scene-graph": sceneGraphPlanSchema,
  "after-effects": afterEffectsPlanSchema,
  "lottie-overlay": lottieOverlayPlanSchema,
  "3d-title": threeDTitlePlanSchema,
  "motion-graphics": motionGraphicsPlanSchema,
  "composite": compositePlanSchema,
  "burn-captions": burnCaptionsPlanSchema,
  "lottie-graphic": lottieGraphicPlanSchema,
  "shot-sequence": shotSequencePlanSchema,
}

/**
 * Validate a plan object against the schema for its planType.
 * Returns the validated (parsed) plan on success, or throws a
 * descriptive error with Zod issue details on failure.
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
