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

// The critic LLM frequently emits `issues` as a bare string array even when the
// prompt asks for objects. Coerce strings into the issue shape so an otherwise
// well-formed critique isn't rejected as invalid_llm_output (which surfaced as
// a 502 from the /v1/image-critic route). Objects pass through unchanged.
const issueLenient = z.preprocess(
  (v) =>
    typeof v === "string"
      ? { category: "general", severity: "warning", description: v.slice(0, 400) }
      : v,
  issue,
)

export const ImageCriticResultSchema = z.object({
  score: z.number().min(0).max(1),
  feedback: z.string().min(1).max(600),
  issues: z.array(issueLenient).optional(),
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
