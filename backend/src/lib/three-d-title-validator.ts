import { z } from "zod"

// ── Zod schemas ──────────────────────────────────────────────────────

const vec3Schema = z.tuple([z.number(), z.number(), z.number()])

const cameraAnimationSchema = z.object({
  type: z.enum(["orbit", "dolly", "static"]),
  startPosition: vec3Schema,
  endPosition: vec3Schema,
  easing: z.string().optional(),
})

const cameraSchema = z.object({
  fov: z.number().min(10).max(120),
  position: vec3Schema,
  lookAt: vec3Schema,
  animation: cameraAnimationSchema.optional(),
})

const ambientLightSchema = z.object({
  intensity: z.number().min(0).max(5),
  color: z.string(),
})

const directionalLightSchema = z.object({
  intensity: z.number().min(0).max(10),
  color: z.string(),
  position: vec3Schema,
})

const lightingSchema = z.object({
  ambient: ambientLightSchema,
  directional: z.array(directionalLightSchema).min(1).max(5),
})

const materialSchema = z.object({
  type: z.enum(["metallic", "glass", "emissive", "standard"]),
  color: z.string(),
  metalness: z.number().min(0).max(1).optional(),
  roughness: z.number().min(0).max(1).optional(),
  emissiveIntensity: z.number().min(0).max(10).optional(),
})

const textAnimationSchema = z.object({
  type: z.enum(["rotate-in", "scale-up", "fade-in", "slide-in", "none"]),
  axis: z.enum(["x", "y", "z"]).optional(),
  startFrame: z.number().min(0),
  durationFrames: z.number().min(1),
  easing: z.string().optional(),
})

const threeDTextObjectSchema = z.object({
  id: z.string(),
  type: z.literal("3d-text"),
  text: z.string().min(1).max(200),
  font: z.string(),
  size: z.number().min(0.1).max(10),
  depth: z.number().min(0.01).max(5),
  material: materialSchema,
  position: vec3Schema,
  animation: textAnimationSchema,
})

const particleSystemObjectSchema = z.object({
  id: z.string(),
  type: z.literal("particle-system"),
  count: z.number().min(10).max(5000),
  size: z.number().min(0.01).max(1),
  color: z.string(),
  spread: vec3Schema,
  speed: z.number().min(0).max(10),
  opacity: z.number().min(0).max(1),
})

const threeDTitleObjectSchema = z.discriminatedUnion("type", [
  threeDTextObjectSchema,
  particleSystemObjectSchema,
])

export const threeDTitlePlanSchema = z.object({
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

export type ValidatedThreeDTitlePlan = z.infer<typeof threeDTitlePlanSchema>

export interface ThreeDTitleValidationResult {
  valid: boolean
  plan: ValidatedThreeDTitlePlan | null
  errors: string[]
  autoFixed: string[]
}

/**
 * Validate and auto-fix an AI-generated 3D title plan.
 */
export function validateThreeDTitlePlan(
  raw: unknown,
  expectedFps: number,
  expectedDurationFrames: number,
  expectedWidth: number,
  expectedHeight: number,
  backgroundMediaUrl?: string,
): ThreeDTitleValidationResult {
  const autoFixed: string[] = []

  // Inject/override known values before parsing
  const obj = (typeof raw === "object" && raw !== null ? { ...(raw as Record<string, unknown>) } : {}) as Record<string, unknown>
  obj.planType = "3d-title"

  if (backgroundMediaUrl) {
    obj.backgroundMedia = backgroundMediaUrl
    autoFixed.push("Set backgroundMedia to provided URL")
  }

  // Ensure width/height are set
  if (!obj.width || obj.width !== expectedWidth) {
    autoFixed.push(`Set width to ${expectedWidth}`)
    obj.width = expectedWidth
  }
  if (!obj.height || obj.height !== expectedHeight) {
    autoFixed.push(`Set height to ${expectedHeight}`)
    obj.height = expectedHeight
  }

  // Zod parse
  const parsed = threeDTitlePlanSchema.safeParse(obj)
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

  // Auto-fix durationInFrames
  if (plan.durationInFrames !== expectedDurationFrames) {
    autoFixed.push(`Fixed durationInFrames from ${plan.durationInFrames} to ${expectedDurationFrames}`)
    plan = { ...plan, durationInFrames: expectedDurationFrames }
  }

  // Clamp object values and ensure animation timing stays within plan duration
  const clampedObjects = plan.objects.map((obj) => {
    if (obj.type === "3d-text") {
      let startFrame = Math.round(obj.animation.startFrame)
      let durationFrames = Math.round(obj.animation.durationFrames)

      if (startFrame + durationFrames > plan.durationInFrames) {
        durationFrames = plan.durationInFrames - startFrame
        if (durationFrames < 1) {
          startFrame = Math.max(0, plan.durationInFrames - 1)
          durationFrames = 1
        }
      }

      return {
        ...obj,
        size: clamp(obj.size, 0.1, 10),
        depth: clamp(obj.depth, 0.01, 5),
        material: {
          ...obj.material,
          metalness: obj.material.metalness !== undefined ? clamp(obj.material.metalness, 0, 1) : undefined,
          roughness: obj.material.roughness !== undefined ? clamp(obj.material.roughness, 0, 1) : undefined,
          emissiveIntensity: obj.material.emissiveIntensity !== undefined ? clamp(obj.material.emissiveIntensity, 0, 10) : undefined,
        },
        animation: {
          ...obj.animation,
          startFrame,
          durationFrames,
        },
      }
    }

    if (obj.type === "particle-system") {
      return {
        ...obj,
        count: clamp(Math.round(obj.count), 10, 5000),
        size: clamp(obj.size, 0.01, 1),
        speed: clamp(obj.speed, 0, 10),
        opacity: clamp(obj.opacity, 0, 1),
      }
    }

    return obj
  })

  plan = { ...plan, objects: clampedObjects }

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
