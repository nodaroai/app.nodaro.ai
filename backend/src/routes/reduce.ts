import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { REDUCE_STRATEGY_IDS, LLM_MODEL_IDS, buildLlmCreditIdentifier, type ReduceStrategyId } from "@nodaro/shared"
import { supabase } from "../lib/supabase.js"
import { insertJob } from "../lib/insert-job.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import {
  commitReservedCreditsForJob,
  refundReservedCreditsForJob,
} from "../lib/credits-job-lifecycle.js"
import { dispatchStrategy, EmptyInputError } from "../services/reduce-strategies/index.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"

// Zod schema. strategyConfig is validated per-strategy inside the dispatcher
// (each strategy parses its own config), so at the route layer we accept any
// JSON object here — EXCEPT the pick-best-llm judge model, which is checked
// against the LLM registry here (the shared strategy registry can't import
// the model list without a cycle) so an unknown model is a clean 400 rather
// than a failed job after credits reserve.
const reduceBody = z.object({
  strategyId: z.enum(REDUCE_STRATEGY_IDS as [string, ...string[]]),
  strategyConfig: z.record(z.string(), z.unknown()).default({}),
  inputs: z.array(z.string()).max(1000),
}).superRefine((body, ctx) => {
  const model = body.strategyConfig.llmModel
  if (body.strategyId === "pick-best-llm" && model !== undefined && !LLM_MODEL_IDS.includes(model as never)) {
    ctx.addIssue({ code: "custom", path: ["strategyConfig", "llmModel"], message: `Unknown AI model "${String(model)}"` })
  }
})

/**
 * Credit identifier for a reduce call. Every strategy bills at its flat
 * `reduce:<strategyId>` key EXCEPT the AI judge, whose price follows the
 * chosen model's tier exactly like every other LLM node
 * (buildLlmCreditIdentifier: economy → `reduce:pick-best-llm:economy`,
 * standard → `reduce:pick-best-llm`, premium → `reduce:pick-best-llm:premium`).
 * Reads the raw body so the creditGuard preHandler (pre-Zod) and the
 * reservation (post-Zod) resolve the SAME id.
 */
function reduceCreditIdentifier(body: unknown): string {
  const b = body as { strategyId?: unknown; strategyConfig?: { llmModel?: unknown } } | undefined
  const strategyId = String(b?.strategyId ?? "concat")
  if (strategyId !== "pick-best-llm") return `reduce:${strategyId}`
  const model = typeof b?.strategyConfig?.llmModel === "string" ? b.strategyConfig.llmModel : undefined
  return buildLlmCreditIdentifier("reduce:pick-best-llm", model)
}

export async function reduceRoutes(app: FastifyInstance) {
  app.post(
    "/v1/reduce",
    {
      // dedup: false — the same upstream fan-in run may legitimately be invoked
      // multiple times in quick succession (loop iterations, retries) and we
      // never want two distinct runs to silently collapse into one.
      preHandler: creditGuard((req) => reduceCreditIdentifier(req.body), { dedup: false }),
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
      const modelIdentifier = reduceCreditIdentifier(parsed.data)

      const { data: job, error: jobError } = await insertJob(req, {
          workflow_id: extractWorkflowId(req.body),
          node_id: extractNodeId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: buildJobInputData(
            { strategyId, strategyConfig, inputs_count: inputs.length },
            "reduce",
          ),
        })

      if (jobError || !job) {
        return sendInternalError(reply, req, jobError, "Failed to create job")
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
