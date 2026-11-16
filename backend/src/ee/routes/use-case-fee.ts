/**
 * POST /v1/use-case-fee — the fixed per-run fee of a use-case node, charged to
 * a client that runs the node's planning itself and builds the result in its
 * own editor (Edit with AI makes clips, a trailer and chapters this way, cut
 * live in the editor instead of rendered). One price everywhere: the canvas's
 * run of the same node is charged the same fee (`use-case-fee:<type>`, at the
 * charged price) beside its steps.
 *
 * The client calls it once a result is made, so a run that made nothing is
 * never charged it. Refused before anything is held when the body is not a
 * known use-case type, or the deployment does not offer that node.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { USE_CASE_NODE_TYPES, usecaseFeeCreditId, type UseCaseNodeType } from "@nodaro/render-rules"
import { insertSyncJob } from "../../lib/insert-job.js"
import { creditGuard, reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { commitReservedCreditsForJob, refundReservedCreditsForJob } from "../../lib/credits-job-lifecycle.js"
import { completeSettledSyncJob } from "../../lib/metered-sync-completion.js"
import { extractWorkflowId } from "../../lib/request-helpers.js"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"

export const useCaseFeeBody = z.object({
  type: z.enum(USE_CASE_NODE_TYPES as unknown as [UseCaseNodeType, ...UseCaseNodeType[]]),
})

/** The fee's credit id for a body, or the bare prefix (which has no price, so the guard refuses) when the body is not a use-case type. */
export function useCaseFeeCreditIdOf(body: unknown): string {
  const parsed = useCaseFeeBody.safeParse(body)
  return parsed.success ? usecaseFeeCreditId(parsed.data.type) : "use-case-fee"
}

export async function useCaseFeeRoutes(app: FastifyInstance) {
  app.post(
    "/v1/use-case-fee",
    { preHandler: creditGuard((req) => useCaseFeeCreditIdOf(req.body)) },
    async (req, reply) => {
      const parsed = useCaseFeeBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
      }
      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      }
      const creditId = usecaseFeeCreditId(parsed.data.type)
      const { data: job, error } = await insertSyncJob(req, {
        workflow_id: extractWorkflowId(req.body),
        user_id: userId,
        status: "pending",
        input_data: { type: "use-case-fee", feeOf: parsed.data.type },
      })
      if (error || !job) return sendInternalError(reply, req, error, "Failed to create job")

      await reserveCreditsForJob(req, reply, job.id, creditId)
      if (reply.sent) return
      if (!(await completeSettledSyncJob(job.id, { userId }))) {
        await refundReservedCreditsForJob(job.id)
        return sendInternalError(reply, req, new Error(`use-case fee job ${job.id} could not be completed`), "Failed to charge the fee")
      }
      await commitReservedCreditsForJob(job.id)
      return reply.send({ jobId: job.id })
    },
  )
}
