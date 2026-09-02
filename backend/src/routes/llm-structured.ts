import type { FastifyInstance } from "fastify"
import { resolveLlmCreditId } from "@nodaro/shared"
import { maybeProxyLlmRouteToCloud } from "../lib/cloud-llm-proxy.js"
import { supabase } from "../lib/supabase.js"
import { insertJob } from "../lib/insert-job.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { markProviderCallStart } from "../lib/reconcile/persistence.js"
import { commitReservedCreditsForJob, refundReservedCreditsForJob } from "../lib/credits-job-lifecycle.js"
import {
  llmStructuredBody,
  prepareStructuredRequest,
  runStructuredCompletion,
  structuredJobInputData,
} from "../lib/llm-structured-request.js"

/**
 * The pre-flight, the body schema and the completion live in
 * `lib/llm-structured-request.ts` so the asynchronous sibling route and the
 * `llm-structured` worker share them; re-exported here because they are this
 * route's validation surface and its tests read them from the route.
 */
export {
  JSON_SCHEMA_MAX_BYTES,
  JSON_SCHEMA_MAX_DEPTH,
  STRUCTURED_LLM_TIMEOUT_MS,
  jsonSchemaDepth,
  digestText,
  convertJsonSchema,
  llmStructuredBody,
} from "../lib/llm-structured-request.js"

/**
 * POST /v1/llm/structured — one forced-schema LLM call, any caller's JSON
 * Schema in, the validated object out.
 *
 * The generic primitive the platform was missing: a client whose vocabulary
 * the platform cannot know (Nodaro Studio's production format is app-owned —
 * picker keys are the app's) renders its own schema and its own system prompt,
 * and the platform supplies exactly the parts it owns: the model lane, forced
 * structured output with validation + error-fed retries, the job row, and the
 * credit lifecycle. Built like text-to-picker; billed under its OWN
 * `llm-structured` feature id (migration 358).
 */

export async function llmStructuredRoutes(app: FastifyInstance) {
  app.post(
    "/v1/llm/structured",
    { preHandler: creditGuard((req) => resolveLlmCreditId("llm-structured", req.body)) },
    async (req, reply) => {
      // Keyless install with a live connection: the cloud runs the same code,
      // so forward the body and pass its answer straight back. FIRST, before
      // any local row — the proxy mirrors its own job from the cloud's answer,
      // so an insert ahead of it leaves an orphan and a local reservation
      // beside the cloud's billing.
      if (await maybeProxyLlmRouteToCloud(req, reply, "/v1/llm/structured", "llm-structured")) return

      const parsed = llmStructuredBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
      }
      const { input } = parsed.data
      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      }
      // Text-only structured output — either LLM key works (mirrors text-to-picker).
      if (!config.KIE_API_KEY && !config.ANTHROPIC_API_KEY) {
        return reply.status(503).send({ error: { code: "provider_unavailable", message: "LLM API key not configured" } })
      }

      const prepared = prepareStructuredRequest(parsed.data)
      if (!prepared.ok) return reply.status(prepared.status).send({ error: prepared.error })

      const { data: job, error: jobError } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: structuredJobInputData(parsed.data),
      })
      if (jobError) {
        return sendInternalError(reply, req, jobError, "Failed to create job")
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, prepared.modelIdentifier)
      if (reply.sent) return
      void reservation

      await markProviderCallStart(job.id, "anthropic-sync")

      try {
        const { output, inputTokens, outputTokens } = await runStructuredCompletion(parsed.data, prepared, input)
        const usage = { inputTokens, outputTokens }

        await supabase
          .from("jobs")
          .update({ status: "completed", output_data: { output, ...usage } })
          .eq("id", job.id)
          .eq("user_id", userId)
        await commitReservedCreditsForJob(job.id)

        // Usage rides the RESPONSE, not just output_data (text-to-picker's
        // choice): a synchronous caller sizing its next prompt should not have
        // to fetch the job row to learn what the last one cost it.
        return reply.send({ jobId: job.id, output, usage })
      } catch (err) {
        const message = err instanceof Error ? err.message : "Structured generation failed"
        await supabase.from("jobs").update({ status: "failed", output_data: { error: message } }).eq("id", job.id).eq("user_id", userId)
        await refundReservedCreditsForJob(job.id)
        return reply.status(502).send({ error: { code: "llm_error", message } })
      }
    },
  )
}
