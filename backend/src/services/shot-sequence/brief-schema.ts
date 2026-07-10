import { z } from "zod"
import {
  shotElementSchema,
  enterMotionSchema,
  exitMotionSchema,
  alignmentWordSchema,
  brandTokensSchema,
} from "../../lib/plan-schemas.js"
import { validateBlueprintParams } from "./blueprint-params.js"

const MAX_BRIEF_FRAMES = 54000

/** A lexical phrase of the script anchored to narration timing. */
const cueSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
})

const revealAnchorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("cue"),
    cueId: z.string(),
    edge: z.enum(["start", "end"]),
    offsetMs: z.number().optional(),
  }),
  z.object({
    kind: z.literal("frame"),
    frame: z.number().min(0),
  }),
])

const briefBlueprintSchema = z.object({
  id: z.string(),
  params: z.record(z.string(), z.unknown()),
})

export const briefRevealSchema = z
  .object({
    id: z.string(),
    revealAt: revealAnchorSchema,
    // element-reveal fields (optional now; required when no blueprint)
    element: shotElementSchema.optional(),
    enter: enterMotionSchema.optional(),
    hold: z.number().min(0).optional(),
    exit: exitMotionSchema.optional(),
    // blueprint-reveal fields
    blueprint: briefBlueprintSchema.optional(),
    durationFrames: z.number().min(1).max(MAX_BRIEF_FRAMES).optional(),
  })
  .superRefine((r, ctx) => {
    const hasEl = r.element !== undefined
    const hasBp = r.blueprint !== undefined
    if (hasEl === hasBp) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a reveal must have exactly one of `element` or `blueprint`" })
      return
    }
    if (hasEl && r.enter === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "an element reveal requires `enter`", path: ["enter"] })
    }
    if (hasBp) {
      const v = validateBlueprintParams(r.blueprint!.id, r.blueprint!.params)
      if (!v.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: v.message, path: ["blueprint", "params"] })
    }
  })

const briefShotSchema = z.object({
  id: z.string(),
  reveals: z.array(briefRevealSchema).min(1).max(500),
})

/**
 * Cut-the-curve — a velocity-matched directional scene-to-scene cut (HF cut
 * catalog). Set on the OUTGOING scene only; the baker mirrors the same type +
 * direction onto the following scene's entry, so a seam always reads as one
 * continuous motion without the author having to set matching fields on two
 * scene objects. Absent → today's plain crossfade (zero behavior change).
 */
const exitTransitionSchema = z.object({
  type: z.literal("cut-the-curve"),
  direction: z.enum(["left", "right", "up", "down"]),
})

const briefSceneSchema = z.object({
  id: z.string(),
  background: z.object({ color: z.string().optional() }).optional(),
  shots: z.array(briefShotSchema).min(1).max(200),
  exitTransition: exitTransitionSchema.optional(),
})

export const shotSequenceBriefSchema = z
  .object({
    fps: z.number().min(15).max(60),
    width: z.number().min(100).max(3840),
    height: z.number().min(100).max(3840),
    backgroundColor: z.string(),
    brandTokens: brandTokensSchema.optional(),
    narration: z.object({
      script: z.string().min(1).max(20_000),
      voice: z.object({ voiceId: z.string().optional(), model: z.string().optional() }).optional(),
      cues: z.array(cueSchema).min(1).max(200),
    }),
    scenes: z.array(briefSceneSchema).min(1).max(50),
  })
  .superRefine((brief, ctx) => {
    const sceneIds = new Set<string>()
    const revealIds = new Set<string>()
    brief.scenes.forEach((scene, i) => {
      if (sceneIds.has(scene.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate scene id "${scene.id}"`, path: ["scenes", i, "id"] })
      }
      sceneIds.add(scene.id)
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

export type ShotSequenceBrief = z.infer<typeof shotSequenceBriefSchema>
export type Cue = z.infer<typeof cueSchema>
export type BriefScene = z.infer<typeof briefSceneSchema>
export type BriefShot = z.infer<typeof briefShotSchema>
export type BriefReveal = z.infer<typeof briefRevealSchema>
export type RevealAnchor = z.infer<typeof revealAnchorSchema>
export type AlignmentWordInput = z.infer<typeof alignmentWordSchema>
export type ExitTransition = z.infer<typeof exitTransitionSchema>

/** Resolve-route body cap: forced-alignment over a 20k-char script stays well under this. */
export const MAX_ALIGNMENT_WORDS = 20_000
