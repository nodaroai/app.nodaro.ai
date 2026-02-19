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

const afterEffectSchema = z.discriminatedUnion("type", [
  colorGradeSchema,
  vignetteSchema,
  filmGrainSchema,
  noiseOverlaySchema,
  letterboxSchema,
  motionBlurSchema,
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
  const errors: string[] = []
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

  const plan = { ...parsed.data } as z.infer<typeof afterEffectsPlanSchema> & {
    fps: number
    durationInFrames: number
  }

  // Auto-fix fps
  if (plan.fps !== expectedFps) {
    autoFixed.push(`Fixed fps from ${plan.fps} to ${expectedFps}`)
    plan.fps = expectedFps
  }

  // Auto-fix duration within 10% tolerance
  const durationDiff = Math.abs(plan.durationInFrames - expectedDurationFrames)
  const tolerance = Math.ceil(expectedDurationFrames * 0.1)
  if (durationDiff > 0 && durationDiff <= tolerance) {
    autoFixed.push(`Fixed durationInFrames from ${plan.durationInFrames} to ${expectedDurationFrames}`)
    plan.durationInFrames = expectedDurationFrames
  } else if (durationDiff > tolerance) {
    // Force-fix since we know the correct duration
    autoFixed.push(`Overrode durationInFrames from ${plan.durationInFrames} to ${expectedDurationFrames}`)
    plan.durationInFrames = expectedDurationFrames
  }

  // Clamp effect values to valid ranges
  for (const effect of plan.effects) {
    switch (effect.type) {
      case "color-grade": {
        const e = effect as { brightness: number; contrast: number; saturation: number; temperature: number }
        e.brightness = clamp(e.brightness, 0.5, 2.0)
        e.contrast = clamp(e.contrast, 0.5, 2.0)
        e.saturation = clamp(e.saturation, 0, 3.0)
        e.temperature = clamp(e.temperature, -100, 100)
        break
      }
      case "vignette": {
        const e = effect as { intensity: number; radius: number }
        e.intensity = clamp(e.intensity, 0, 1)
        e.radius = clamp(e.radius, 0.2, 1.0)
        break
      }
      case "film-grain": {
        const e = effect as { intensity: number; size: number }
        e.intensity = clamp(e.intensity, 0, 1)
        e.size = clamp(e.size, 1, 4)
        break
      }
      case "noise-overlay": {
        const e = effect as { opacity: number; scale: number }
        e.opacity = clamp(e.opacity, 0, 0.5)
        e.scale = clamp(e.scale, 0.001, 0.01)
        break
      }
    }
  }

  // Round text overlay frames to integers
  if (plan.textOverlays) {
    for (const overlay of plan.textOverlays) {
      const o = overlay as { startFrame: number; durationInFrames: number }
      o.startFrame = Math.round(o.startFrame)
      o.durationInFrames = Math.round(o.durationInFrames)
    }
  }

  return {
    valid: errors.length === 0,
    plan,
    errors,
    autoFixed,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
