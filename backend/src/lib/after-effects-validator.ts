import { z } from "zod"

// ── Zod schemas for each effect type ────────────────────────────────

const colorGradeSchema = z.object({
  type: z.literal("color-grade"),
  brightness: z.number().min(0.5).max(2.0).default(1.0),
  contrast: z.number().min(0.5).max(2.0).default(1.0),
  saturation: z.number().min(0).max(3.0).default(1.0),
  temperature: z.number().min(-100).max(100).default(0),
})

const vignetteSchema = z.object({
  type: z.literal("vignette"),
  intensity: z.number().min(0).max(1).default(0.5),
  radius: z.number().min(0.2).max(1.0).default(0.7),
})

const filmGrainSchema = z.object({
  type: z.literal("film-grain"),
  intensity: z.number().min(0).max(1).default(0.3),
  size: z.number().min(1).max(4).default(2),
  seed: z.number().optional(),
})

const noiseOverlaySchema = z.object({
  type: z.literal("noise-overlay"),
  opacity: z.number().min(0).max(0.5).default(0.1),
  scale: z.number().min(0.001).max(0.01).default(0.005),
  animated: z.boolean().default(true),
})

const letterboxSchema = z.object({
  type: z.literal("letterbox"),
  ratio: z.number().min(1.0).max(3.0).default(2.35),
  color: z.string().default("#000000"),
})

const motionBlurSchema = z.object({
  type: z.literal("motion-blur"),
  shutterAngle: z.number().min(0).max(360).default(180),
  samples: z.number().min(1).max(16).default(10),
})

const animatedBlurSchema = z.object({
  type: z.literal("animated-blur"),
  startBlur: z.number().min(0).max(50),
  endBlur: z.number().min(0).max(50),
  startFrame: z.number().min(0),
  durationFrames: z.number().min(1),
  easing: z.enum(["linear", "easeIn", "easeOut", "easeInOut"]).optional(),
})

const afterEffectSchema = z.discriminatedUnion("type", [
  colorGradeSchema,
  vignetteSchema,
  filmGrainSchema,
  noiseOverlaySchema,
  letterboxSchema,
  motionBlurSchema,
  animatedBlurSchema,
])

const textOverlaySchema = z.object({
  id: z.string(),
  text: z.string(),
  startFrame: z.number().min(0),
  durationInFrames: z.number().min(1),
  position: z.enum(["top", "center", "bottom"]),
  fontSize: z.number().min(8).max(200),
  fontFamily: z.string().optional(),
  color: z.string(),
  animation: z.enum(["fade", "slide-up", "typewriter", "none"]),
})

export const afterEffectsPlanSchema = z.object({
  planType: z.literal("after-effects"),
  fps: z.number().min(15).max(60),
  width: z.number().min(100).max(3840),
  height: z.number().min(100).max(3840),
  durationInFrames: z.number().min(1),
  sourceVideo: z.string(),
  effects: z.array(afterEffectSchema).min(1),
  textOverlays: z.array(textOverlaySchema).optional(),
})

export type ValidatedAfterEffectsPlan = z.infer<typeof afterEffectsPlanSchema>

export interface AfterEffectsValidationResult {
  valid: boolean
  plan: ValidatedAfterEffectsPlan | null
  errors: string[]
  autoFixed: string[]
}

/**
 * Validate and auto-fix an AI-generated after-effects plan.
 */
export function validateAfterEffectsPlan(
  raw: unknown,
  sourceVideoUrl: string,
  expectedFps: number,
  expectedDurationFrames: number,
): AfterEffectsValidationResult {
  const autoFixed: string[] = []

  // Inject/override known values before parsing
  const obj = (typeof raw === "object" && raw !== null ? { ...raw as Record<string, unknown> } : {}) as Record<string, unknown>
  obj.planType = "after-effects"

  // Auto-fix sourceVideo to the actual URL
  if (!obj.sourceVideo || obj.sourceVideo !== sourceVideoUrl) {
    autoFixed.push(`Set sourceVideo to actual input URL`)
    obj.sourceVideo = sourceVideoUrl
  }

  // Zod parse
  const parsed = afterEffectsPlanSchema.safeParse(obj)
  if (!parsed.success) {
    return {
      valid: false,
      plan: null,
      errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      autoFixed: [],
    }
  }

  let plan = parsed.data

  // Auto-fix fps
  if (plan.fps !== expectedFps) {
    autoFixed.push(`Fixed fps from ${plan.fps} to ${expectedFps}`)
    plan = { ...plan, fps: expectedFps }
  }

  // Auto-fix duration to match expected value
  if (plan.durationInFrames !== expectedDurationFrames) {
    autoFixed.push(`Fixed durationInFrames from ${plan.durationInFrames} to ${expectedDurationFrames}`)
    plan = { ...plan, durationInFrames: expectedDurationFrames }
  }

  // Clamp effect values to valid ranges (immutable)
  const clampedEffects = plan.effects.map((effect) => {
    switch (effect.type) {
      case "color-grade":
        return {
          ...effect,
          brightness: clamp(effect.brightness, 0.5, 2.0),
          contrast: clamp(effect.contrast, 0.5, 2.0),
          saturation: clamp(effect.saturation, 0, 3.0),
          temperature: clamp(effect.temperature, -100, 100),
        }
      case "vignette":
        return {
          ...effect,
          intensity: clamp(effect.intensity, 0, 1),
          radius: clamp(effect.radius, 0.2, 1.0),
        }
      case "film-grain":
        return {
          ...effect,
          intensity: clamp(effect.intensity, 0, 1),
          size: clamp(effect.size, 1, 4),
        }
      case "noise-overlay":
        return {
          ...effect,
          opacity: clamp(effect.opacity, 0, 0.5),
          scale: clamp(effect.scale, 0.001, 0.01),
        }
      case "animated-blur":
        return {
          ...effect,
          startBlur: clamp(effect.startBlur, 0, 50),
          endBlur: clamp(effect.endBlur, 0, 50),
        }
      default:
        return effect
    }
  })

  // Round text overlay frames to integers (immutable)
  const fixedOverlays = plan.textOverlays?.map((overlay) => ({
    ...overlay,
    startFrame: Math.round(overlay.startFrame),
    durationInFrames: Math.round(overlay.durationInFrames),
  }))

  plan = { ...plan, effects: clampedEffects, textOverlays: fixedOverlays }

  return {
    valid: true,
    plan,
    errors: [],
    autoFixed,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
