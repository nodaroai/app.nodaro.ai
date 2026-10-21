import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { openApiRegistry } from "../../lib/openapi-registry.js"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { resolveSeedanceDraftFinalize } from "../../lib/seedance-draft-finalize.js"
import { mayUseChildJobAsSource } from "../../lib/job-submission-context.js"
import { handlePriceNotConfigured } from "../lib/credit-guard-impl.js"
import {
  seedanceDraftFinalizeChargedCredits,
  seedanceDraftFinalizeMinimumCredits,
} from "../billing/seedance-draft-finalize-credits.js"

const ROUTE = "/v1/credits/seedance-hd-estimate"

const estimateBody = z.object({
  /** The draft's job id. */
  sourceJobId: z.string().min(1).max(64).optional(),
  /** The draft's provider task id — what a workflow edge carries. */
  taskId: z.string().min(1).max(256).optional(),
})

/**
 * Read-only price of a Seedance 2.5 HD (from draft) finalize — nothing is
 * created or reserved.
 *
 * With a draft named, it runs the finalize's own gate
 * (`resolveSeedanceDraftFinalize` — ownership, draft flag, completion, the
 * draft's billable length) and prices the plan the way the reservation does
 * (`seedanceDraftFinalizeChargedCredits`), so the number equals what a run of
 * that draft reserves; a draft the run would refuse is refused here with the
 * same coded 4xx. With none named, it answers the lowest price any draft can
 * finalize for (`minimum: true`) — the "from N" the editor shows before a
 * draft is wired.
 */
export function registerSeedanceHdEstimate(app: FastifyInstance): void {
  openApiRegistry.registerPath({
    method: "post", path: ROUTE,
    description:
      "Credits to finalize a Seedance 2.5 draft at 1080p (Video Upscale, provider seedance-2-5-hd), without creating a job. " +
      "Name the draft by sourceJobId or taskId for its exact price; send neither for the lowest price any draft can finalize for (minimum: true).",
    security: [{ bearerAuth: [] }],
    request: { body: { content: { "application/json": { schema: estimateBody } } } },
    responses: {
      200: { description: "Credit estimate", content: { "application/json": { schema: z.object({
        data: z.object({ credits: z.number(), minimum: z.boolean() }),
      }) } } },
    },
  })

  // The path is written out (not ROUTE) so route-path-parity's static scan
  // sees the registration the frontend's estimateSeedanceHdCredits calls.
  app.post("/v1/credits/seedance-hd-estimate", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    const parsed = estimateBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    const { sourceJobId, taskId } = parsed.data

    try {
      if (!sourceJobId && !taskId) {
        return { data: { credits: await seedanceDraftFinalizeMinimumCredits(), minimum: true } }
      }
      const resolved = await resolveSeedanceDraftFinalize({ userId: req.userId, taskId, sourceJobId, allowChildSource: mayUseChildJobAsSource(req) })
      if (!resolved.ok) {
        return reply.status(resolved.status).send({ error: { code: resolved.code, message: resolved.message } })
      }
      return { data: { credits: await seedanceDraftFinalizeChargedCredits(resolved), minimum: false } }
    } catch (err) {
      if (handlePriceNotConfigured(err, reply, ROUTE)) return reply
      return sendInternalError(reply, req, err, "Failed to estimate the finalize credits")
    }
  })
}
