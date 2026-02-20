import { z } from "zod"

// ── Zod schemas for Motion Graphics elements ─────────────────────────

const animationSchema = z.object({
  type: z.enum(["wipe-in", "scale-up", "fade", "draw-path", "slide-up", "slide-down", "slide-left", "slide-right", "none"]),
  direction: z.enum(["left", "right", "up", "down"]).optional(),
  startFrame: z.number().min(0),
  durationFrames: z.number().min(0).max(54000),
  easing: z.enum(["linear", "easeIn", "easeOut", "easeInOut", "spring"]).optional(),
})

const shapeElementSchema = z.object({
  id: z.string(),
  type: z.literal("shape"),
  shape: z.enum(["rectangle", "circle", "line"]),
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().min(0).optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().min(0),
  height: z.number().min(0),
  cornerRadius: z.number().min(0).optional(),
  opacity: z.number().min(0).max(1).optional(),
  animation: animationSchema,
})

const textElementSchema = z.object({
  id: z.string(),
  type: z.literal("text"),
  text: z.string(),
  fontFamily: z.string(),
  fontSize: z.number().min(1).max(500),
  fontWeight: z.number().min(100).max(900).optional(),
  color: z.string(),
  x: z.number(),
  y: z.number(),
  letterSpacing: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  animation: animationSchema,
})

const svgPathElementSchema = z.object({
  id: z.string(),
  type: z.literal("svg-path"),
  path: z.string(),
  stroke: z.string(),
  strokeWidth: z.number().min(0),
  fill: z.string().optional(),
  x: z.number(),
  y: z.number(),
  opacity: z.number().min(0).max(1).optional(),
  animation: animationSchema,
})

const mgElementSchema = z.discriminatedUnion("type", [
  shapeElementSchema,
  textElementSchema,
  svgPathElementSchema,
])

const exitAnimationSchema = z.object({
  type: z.enum(["fade", "slide-down", "slide-up", "slide-left", "slide-right", "none"]),
  startFrame: z.number().min(0),
  durationFrames: z.number().min(0).max(54000),
})

export const motionGraphicsPlanSchema = z.object({
  planType: z.literal("motion-graphics"),
  fps: z.number().min(15).max(60),
  width: z.number().min(100).max(3840),
  height: z.number().min(100).max(3840),
  durationInFrames: z.number().min(1).max(54000),
  backgroundColor: z.string(),
  elements: z.array(mgElementSchema).min(1),
  exitAnimation: exitAnimationSchema.optional(),
})

export type ValidatedMotionGraphicsPlan = z.infer<typeof motionGraphicsPlanSchema>

export interface MotionGraphicsValidationResult {
  valid: boolean
  plan: ValidatedMotionGraphicsPlan | null
  errors: string[]
  autoFixed: string[]
}

/**
 * Validate and auto-fix an AI-generated motion graphics plan.
 */
export function validateMotionGraphicsPlan(
  raw: unknown,
  expectedFps: number,
  expectedDurationFrames: number,
): MotionGraphicsValidationResult {
  const autoFixed: string[] = []

  // Inject/override known values before parsing
  const obj = (typeof raw === "object" && raw !== null ? { ...raw as Record<string, unknown> } : {}) as Record<string, unknown>
  obj.planType = "motion-graphics"

  // Zod parse
  const parsed = motionGraphicsPlanSchema.safeParse(obj)
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

  // Round frame numbers to integers and clamp element values
  const fixedElements = plan.elements.map((element) => {
    const anim = {
      ...element.animation,
      startFrame: Math.round(element.animation.startFrame),
      durationFrames: Math.round(element.animation.durationFrames),
    }

    switch (element.type) {
      case "shape":
        return {
          ...element,
          animation: anim,
          x: Math.round(element.x),
          y: Math.round(element.y),
          width: Math.max(0, Math.round(element.width)),
          height: Math.max(0, Math.round(element.height)),
        }
      case "text":
        return {
          ...element,
          animation: anim,
          x: Math.round(element.x),
          y: Math.round(element.y),
          fontSize: clamp(Math.round(element.fontSize), 1, 500),
        }
      case "svg-path":
        return {
          ...element,
          animation: anim,
          x: Math.round(element.x),
          y: Math.round(element.y),
        }
    }
  })

  // Round exit animation frames
  const fixedExit = plan.exitAnimation
    ? {
        ...plan.exitAnimation,
        startFrame: Math.round(plan.exitAnimation.startFrame),
        durationFrames: Math.round(plan.exitAnimation.durationFrames),
      }
    : undefined

  plan = { ...plan, elements: fixedElements, exitAnimation: fixedExit }

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
