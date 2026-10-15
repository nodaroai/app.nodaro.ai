import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { openApiRegistry } from "../lib/openapi-registry.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { JOB_RATINGS, setJobRating } from "../lib/job-ratings.js"

const jobIdParams = z.object({ id: z.string().uuid() })

// `rating` is required, so "clear it" is an explicit null — never a missing field.
const rateJobBody = z.object({
  rating: z.enum(JOB_RATINGS).nullable().describe("`good`, `bad`, or null to clear the rating."),
})

const RatingResult = z.object({
  data: z.object({ jobId: z.string().uuid(), rating: z.enum(JOB_RATINGS).nullable() }),
})

openApiRegistry.registerPath({
  method: "put",
  path: "/v1/jobs/{id}/rating",
  description:
    "Rate one of your jobs `good` or `bad`, or clear its rating with `null`. One rating per job, its owner's; " +
    "it reads back as `rating` on the job and filters `GET /v1/jobs?rating=`. OAuth apps need `assets:write`.",
  security: [{ bearerAuth: [] }],
  request: {
    params: jobIdParams,
    body: { content: { "application/json": { schema: rateJobBody } } },
  },
  responses: {
    200: { description: "The job's rating now", content: { "application/json": { schema: RatingResult } } },
    400: { description: "A rating other than good, bad or null" },
    401: { description: "Unauthorized" },
    403: { description: "An OAuth token without assets:write" },
    404: { description: "Job not found (or not yours)" },
    503: { description: "Ratings are not available on this server yet" },
  },
})

/**
 * Ratings on generations (migration 520). Only a job's owner rates it — an
 * admin included, whose rating of someone else's job is a 404 like anyone's.
 */
export async function jobRatingRoutes(app: FastifyInstance) {
  app.put<{ Params: { id: string } }>(
    "/v1/jobs/:id/rating",
    { preHandler: requireAppScope("assets:write") },
    async (req, reply) => {
      if (!req.userId) {
        return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      }
      // An id that cannot be a job is no job of theirs.
      const params = jobIdParams.safeParse(req.params)
      if (!params.success) {
        return reply.status(404).send({ error: { code: "not_found", message: "Job not found" } })
      }
      const body = rateJobBody.safeParse(req.body ?? {})
      if (!body.success) {
        return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(body.error) } })
      }

      let outcome
      try {
        outcome = await setJobRating(req.userId, params.data.id, body.data.rating)
      } catch (err) {
        return sendInternalError(reply, req, err, "Failed to rate job")
      }
      if (outcome.kind === "not_found") {
        return reply.status(404).send({ error: { code: "not_found", message: "Job not found" } })
      }
      if (outcome.kind === "not_available") {
        return reply.status(503).send({
          error: { code: "not_available", message: "Ratings are not available on this server yet." },
        })
      }
      return { data: { jobId: params.data.id, rating: outcome.rating } }
    },
  )
}
