import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { REDUCE_STRATEGY_IDS, type ReduceStrategyId } from "@nodaro/shared"
import { supabase } from "../lib/supabase.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import {
  commitReservedCreditsForJob,
  refundReservedCreditsForJob,
} from "../lib/credits-job-lifecycle.js"
import { dispatchStrategy, EmptyInputError } from "../services/reduce-strategies/index.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"

// Zod schema. strategyConfig is validated per-strategy inside the dispatcher
// (each strategy parses its own config), so at the route layer we accept any
// JSON object here.
const reduceBody = z.object({
  strategyId: z.enum(REDUCE_STRATEGY_IDS as [string, ...string[]]),
  strategyConfig: z.record(z.unknown()).default({}),
  inputs: z.array(z.string()).max(1000),
})

export async function reduceRoutes(app: FastifyInstance) {
  app.post(
    "/v1/reduce",
    {
      // dedup: false — the same upstream fan-in run may legitimately be invoked
      // multiple times in quick succession (loop iterations, retries) and we
      // never want two distinct runs to silently collapse into one.
      preHandler: creditGuard(
        (req) => {
          const body = req.body as Record<string, unknown> | undefined
          const strategyId = String(body?.strategyId ?? "concat")
          return `reduce:${strategyId}`
        },
        { dedup: false },
      ),
    },
    async (req, reply) => {
      const parsed = reduceBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      const { strategyId, strategyConfig, inputs } = parsed.data
      const modelIdentifier = `reduce:${strategyId}`

      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          workflow_id: extractWorkflowId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: buildJobInputData(
            { strategyId, strategyConfig, inputs_count: inputs.length },
            "reduce",
          ),
        })
        .select("id")
        .single()

      if (jobError || !job) {
        return reply.status(500).send({
          error: { code: "internal_error", message: jobError?.message ?? "job insert failed" },
        })
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
      if (reply.sent) return

      try {
        const { result, meta } = await dispatchStrategy(
          strategyId as ReduceStrategyId,
          inputs,
          strategyConfig,
          { userId, jobId: job.id, logger: req.log },
        )
        const output = typeof result === "number" ? String(result) : result

        await supabase
          .from("jobs")
          .update({ status: "completed", output_data: { output, meta } })
          .eq("id", job.id)
          .eq("user_id", userId)

        if (reservation?.usageLogId) await commitReservedCreditsForJob(job.id)

        return reply.send({ jobId: job.id, output, meta })
      } catch (err) {
        const message = err instanceof Error ? err.message : "Strategy failed"
        await supabase
          .from("jobs")
          .update({ status: "failed", output_data: { error: message } })
          .eq("id", job.id)
          .eq("user_id", userId)

        if (reservation?.usageLogId) await refundReservedCreditsForJob(job.id)

        if (err instanceof EmptyInputError) {
          return reply.status(400).send({
            error: { code: "no_valid_inputs", message },
          })
        }
        return reply.status(500).send({
          error: { code: "strategy_failed", message },
        })
      }
    },
  )
}
