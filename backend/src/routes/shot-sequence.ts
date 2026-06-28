import type { FastifyInstance } from "fastify"
import { z, ZodError } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { alignmentWordSchema } from "../lib/plan-schemas.js"
import { rateLimiter } from "../middleware/rate-limit.js"
import { formatZodError } from "../lib/zod-error.js"
import {
  shotSequenceBriefSchema,
  bakeShotSequence,
  EmptyAlignmentError,
  SceneOverlapError,
  MAX_ALIGNMENT_WORDS,
} from "../services/shot-sequence/index.js"

const resolveBody = z.object({
  brief: shotSequenceBriefSchema,
  audioUrl: safeUrlSchema,
  alignment: z.array(alignmentWordSchema).max(MAX_ALIGNMENT_WORDS),
})

export async function shotSequenceRoutes(app: FastifyInstance) {
  app.post(
    "/v1/shot-sequence/resolve",
    { preHandler: rateLimiter({ windowMs: 60_000, max: 30, keyPrefix: "shot-resolve" }) },
    async (req, reply) => {
      const parsed = resolveBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
      }

      const { brief, audioUrl, alignment } = parsed.data
      try {
        const { plan, warnings } = bakeShotSequence(brief, alignment, audioUrl)
        return { plan, warnings }
      } catch (err) {
        if (err instanceof EmptyAlignmentError) {
          return reply.status(422).send({ error: { code: "empty_alignment", message: err.message } })
        }
        if (err instanceof SceneOverlapError) {
          return reply.status(422).send({ error: { code: "scene_overlap", message: err.message } })
        }
        if (err instanceof ZodError) {
          return reply.status(400).send({ error: { code: "plan_validation_error", message: err.message } })
        }
        throw err
      }
    },
  )
}
