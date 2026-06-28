import { z } from "zod"
import {
  shotElementSchema,
  enterMotionSchema,
  exitMotionSchema,
  alignmentWordSchema,
} from "../../lib/plan-schemas.js"

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

const briefRevealSchema = z.object({
  id: z.string(),
  element: shotElementSchema,
  revealAt: revealAnchorSchema,
  enter: enterMotionSchema,
  hold: z.number().min(0).optional(),
  exit: exitMotionSchema.optional(),
})

const briefShotSchema = z.object({
  id: z.string(),
  reveals: z.array(briefRevealSchema).min(1).max(500),
})

const briefSceneSchema = z.object({
  id: z.string(),
  background: z.object({ color: z.string().optional() }).optional(),
  shots: z.array(briefShotSchema).min(1).max(200),
})

export const shotSequenceBriefSchema = z
  .object({
    fps: z.number().min(15).max(60),
    width: z.number().min(100).max(3840),
    height: z.number().min(100).max(3840),
    backgroundColor: z.string(),
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

/** Resolve-route body cap: forced-alignment over a 20k-char script stays well under this. */
export const MAX_ALIGNMENT_WORDS = 20_000
