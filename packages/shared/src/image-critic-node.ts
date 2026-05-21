import { z } from "zod"

export const IMAGE_CRITIC_LEAF_MODES = [
  "character-consistency",
  "realism",
  "prompt-adherence",
  "anatomy",
  "aesthetic",
  "style-match",
] as const

export const IMAGE_CRITIC_MODES = [
  ...IMAGE_CRITIC_LEAF_MODES,
  "all",
] as const

export type ImageCriticLeafMode = (typeof IMAGE_CRITIC_LEAF_MODES)[number]
export type ImageCriticMode = (typeof IMAGE_CRITIC_MODES)[number]

const modeResult = z.object({
  score: z.number().min(0).max(1),
  feedback: z.string().min(1).max(300),
})

const issue = z.object({
  category: z.string(),
  severity: z.enum(["blocking", "warning", "info"]),
  description: z.string().max(400),
})

export const ImageCriticResultSchema = z.object({
  score: z.number().min(0).max(1),
  feedback: z.string().min(1).max(600),
  issues: z.array(issue).optional(),
  perMode: z
    .object({
      "character-consistency": modeResult.optional(),
      "realism": modeResult.optional(),
      "prompt-adherence": modeResult.optional(),
      "anatomy": modeResult.optional(),
      "aesthetic": modeResult.optional(),
      "style-match": modeResult.optional(),
    })
    .strict()
    .optional(),
})

export type ImageCriticResult = z.infer<typeof ImageCriticResultSchema>
export type ImageCriticNodeIssue = z.infer<typeof issue>
