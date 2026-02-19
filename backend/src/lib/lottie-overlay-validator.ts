import { z } from "zod"

// ── Zod schemas ──────────────────────────────────────────────────────

const overlayPositionSchema = z.object({
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
  position: overlayPositionSchema,
  opacity: z.number().min(0).max(1).default(1),
  playbackRate: z.number().min(0.1).max(3.0).default(1),
  loop: z.boolean().default(true),
  renderer: z.enum(["svg", "canvas", "html"]).optional(),
})

export const lottieOverlayPlanSchema = z.object({
  planType: z.literal("lottie-overlay"),
  fps: z.number().min(15).max(60),
  width: z.number().min(100).max(3840),
  height: z.number().min(100).max(3840),
  durationInFrames: z.number().min(1),
  sourceVideo: z.string(),
  overlays: z.array(lottieOverlayItemSchema).min(1),
})

export type ValidatedLottieOverlayPlan = z.infer<typeof lottieOverlayPlanSchema>

export interface LottieOverlayValidationResult {
  valid: boolean
  plan: ValidatedLottieOverlayPlan | null
  errors: string[]
  autoFixed: string[]
}

/**
 * Validate and auto-fix an AI-generated lottie overlay plan.
 */
export function validateLottieOverlayPlan(
  raw: unknown,
  sourceVideoUrl: string,
  expectedFps: number,
  expectedDurationFrames: number,
): LottieOverlayValidationResult {
  const autoFixed: string[] = []

  // Inject/override known values before parsing
  const obj = (typeof raw === "object" && raw !== null ? { ...raw as Record<string, unknown> } : {}) as Record<string, unknown>
  obj.planType = "lottie-overlay"

  // Auto-fix sourceVideo to the actual URL
  if (!obj.sourceVideo || obj.sourceVideo !== sourceVideoUrl) {
    autoFixed.push("Set sourceVideo to actual input URL")
    obj.sourceVideo = sourceVideoUrl
  }

  // Zod parse
  const parsed = lottieOverlayPlanSchema.safeParse(obj)
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

  // Clamp overlay values and ensure timing stays within plan duration
  const clampedOverlays = plan.overlays.map((overlay) => {
    let startFrame = Math.round(overlay.startFrame)
    let durationInFrames = Math.round(overlay.durationInFrames)

    if (startFrame + durationInFrames > plan.durationInFrames) {
      durationInFrames = plan.durationInFrames - startFrame
      if (durationInFrames < 1) {
        startFrame = Math.max(0, plan.durationInFrames - 1)
        durationInFrames = 1
      }
    }

    return {
      ...overlay,
      startFrame,
      durationInFrames,
      opacity: clamp(overlay.opacity, 0, 1),
      playbackRate: clamp(overlay.playbackRate, 0.1, 3.0),
      position: {
        x: clamp(overlay.position.x, 0, 100),
        y: clamp(overlay.position.y, 0, 100),
        width: clamp(overlay.position.width, 0, 100),
        height: clamp(overlay.position.height, 0, 100),
      },
    }
  })

  plan = { ...plan, overlays: clampedOverlays }

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
