import type { FastifyInstance } from "fastify"
import { createHash } from "node:crypto"
import { z, type ZodType } from "zod"
import {
  buildLlmCreditIdentifier,
  getLlmModel,
  resolveLlmCreditId,
  LLM_FEATURE_DEFAULTS,
  LLM_MODEL_IDS,
  LLM_REASONING_EFFORTS,
  LLM_TEXT_INPUT_MAX,
} from "@nodaro/shared"
import { maybeProxyLlmRouteToCloud } from "../lib/cloud-llm-proxy.js"
import { supabase } from "../lib/supabase.js"
import { insertJob } from "../lib/insert-job.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { llmCompleteStructured } from "../lib/llm-client.js"
import { LLM_ADVANCED_SHAPE, advancedModeError, resolveLlmParams } from "../lib/llm-advanced-mode.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { markProviderCallStart } from "../lib/reconcile/persistence.js"
import { commitReservedCreditsForJob, refundReservedCreditsForJob } from "../lib/credits-job-lifecycle.js"

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

/** Serialized ceiling for the caller's JSON Schema — large enough for a
 *  20-scene authoring format with descriptions, small enough that a rejected
 *  body is never a 64 KB-per-row storage problem. */
export const JSON_SCHEMA_MAX_BYTES = 64 * 1024

/**
 * Nesting ceiling for the caller's JSON Schema, counted as RAW container
 * nesting of the parsed body.
 *
 * The bound that matters is recursion, not size — 64 KB of `{"a":{"a":…`
 * nests ~10,000 deep, and both `z.fromJSONSchema` and the depth walk itself
 * recurse. 20 stops that while leaving real headroom: the deepest REAL schema
 * we know of is Nodaro Studio's production format, whose rendered document
 * measures 11 (and a studio-shaped fixture in the schema tests, 13).
 */
export const JSON_SCHEMA_MAX_DEPTH = 20

/**
 * Per-request timeout for the forced-schema call (Task 3 passes it to
 * `llmCompleteStructured`).
 *
 * A forced-schema call carries a rendered catalog legend in and up to
 * `maxTokens` out — several minutes of generation on a premium model. The
 * client's 120 s default (`llm-client.ts` `LLM_TIMEOUT_MS`, applied at
 * `effectiveTimeout`) aborts the very workload this route exists for: studio's
 * planner sends a ≈12-18k-token system prompt with `maxTokens: 16384`, and a
 * 20-scene plan is ≈12k output tokens. The Lottie worker raised its own for the
 * same reason (`workers/handlers/motion-graphics-lottie.ts`). The route answers
 * synchronously, so this is also the ceiling on how long a client waits.
 */
export const STRUCTURED_LLM_TIMEOUT_MS = 240_000

/** How much of an oversized text field the job row keeps verbatim. */
const TEXT_HEAD_CHARS = 500

/**
 * Nesting depth of a parsed JSON value — a scalar is 0, `{}` / `[]` is 1.
 *
 * Recursion stops at `limit` rather than at the stack: the only question a
 * caller asks is "deeper than the ceiling?", so answering `limit` for anything
 * beyond it is a complete answer at a bounded cost.
 */
export function jsonSchemaDepth(value: unknown, limit: number = JSON_SCHEMA_MAX_DEPTH + 1): number {
  if (limit <= 0) return 0
  if (Array.isArray(value)) {
    let deepest = 0
    for (const item of value) deepest = Math.max(deepest, jsonSchemaDepth(item, limit - 1))
    return deepest + 1
  }
  if (value !== null && typeof value === "object") {
    let deepest = 0
    for (const nested of Object.values(value)) deepest = Math.max(deepest, jsonSchemaDepth(nested, limit - 1))
    return deepest + 1
  }
  return 0
}

/** Row-safe stand-in for a text field too big to store whole: the digest, the
 *  size, and enough head to recognise the prompt in the admin job view. */
export function digestText(text: string): { sha256: string; chars: number; head: string } {
  return {
    sha256: createHash("sha256").update(text).digest("hex"),
    chars: text.length,
    head: text.slice(0, TEXT_HEAD_CHARS),
  }
}

/**
 * Convert the caller's JSON Schema into the Zod schema `llmCompleteStructured`
 * validates against.
 *
 * `z.fromJSONSchema` (semi-experimental in zod 4.4) THROWS on a keyword it
 * cannot represent — `not`, `if`/`then`/`else`, `dependent*`, an external
 * `$ref` — so the conversion is the route's last validation gate rather than a
 * runtime hazard: a schema it refuses is a 400 carrying the converter's own
 * sentence, never a 500.
 *
 * NOT converted and NOT rejected: an `anyOf` of bare `required` branches (the
 * at-least-one-of idiom) is accepted, but zod turns those branches into a
 * schema that constrains nothing (measured on 4.4.3: a ZodIntersection whose
 * union branch accepts `{}`), so the constraint vanishes silently rather than
 * throwing. The route's schema is therefore deliberately WEAKER than a client's
 * own validator, and cross-field rules belong on the client. Pinned by
 * `__tests__/llm-structured-schema.test.ts` so a zod upgrade cannot change it
 * unnoticed.
 */
export function convertJsonSchema(
  jsonSchema: Record<string, unknown>,
): { schema: ZodType } | { error: string } {
  try {
    return { schema: z.fromJSONSchema(jsonSchema as Parameters<typeof z.fromJSONSchema>[0]) }
  } catch (err) {
    const detail = err instanceof Error ? err.message : "unknown error"
    return { error: `jsonSchema could not be converted: ${detail}` }
  }
}

export const llmStructuredBody = z.object({
  /** The caller's system prompt. Held to the platform's LLM text ceiling like
   *  every other LLM text input — a rendered catalog legend runs ~56k chars. */
  system: z.string().max(LLM_TEXT_INPUT_MAX),
  input: z.string().min(1).max(LLM_TEXT_INPUT_MAX),
  jsonSchema: z
    .record(z.string(), z.unknown())
    .refine((schema) => schema.type === "object", {
      message: 'jsonSchema must declare type "object"',
    })
    .refine((schema) => Buffer.byteLength(JSON.stringify(schema), "utf8") <= JSON_SCHEMA_MAX_BYTES, {
      message: `jsonSchema must serialize to at most ${JSON_SCHEMA_MAX_BYTES} bytes`,
    })
    .refine((schema) => jsonSchemaDepth(schema) <= JSON_SCHEMA_MAX_DEPTH, {
      message: `jsonSchema must nest at most ${JSON_SCHEMA_MAX_DEPTH} levels deep`,
    }),
  /** Names the forced-output tool the provider sees; aids nothing else. */
  schemaName: z.string().max(64).optional(),
  llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
  reasoningEffort: z.enum(LLM_REASONING_EFFORTS).optional(),
  /** Invalid answers fed back to the model with their validation error before
   *  the call fails. `llmCompleteStructured`'s own default is 2. */
  maxRetries: z.number().int().min(0).max(3).default(2),
  /** Originating client app slug ('studio', …) — attribution only. */
  origin: z.string().max(64).optional(),
  ...LLM_ADVANCED_SHAPE,
})

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
      const { system, input, schemaName } = parsed.data
      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      }
      // Text-only structured output — either LLM key works (mirrors text-to-picker).
      if (!config.KIE_API_KEY && !config.ANTHROPIC_API_KEY) {
        return reply.status(503).send({ error: { code: "provider_unavailable", message: "LLM API key not configured" } })
      }

      // No `llm-structured` entry in LLM_FEATURE_DEFAULTS: the route is generic
      // and has no opinion about the task, so it borrows the generic chat
      // default. Billing is a separate axis and uses its OWN feature id below.
      const llmModelId = parsed.data.llmModel ?? LLM_FEATURE_DEFAULTS["llm-chat"]
      const model = getLlmModel(llmModelId)
      if (!model) {
        return reply.status(400).send({ error: { code: "validation_error", message: "Unknown llmModel" } })
      }
      const advancedError = advancedModeError(parsed.data, model.id)
      if (advancedError) return reply.status(400).send({ error: advancedError })
      // `deriveParams` floors the output cap UP when reasoning shares the
      // budget but never clamps it DOWN, so an over-cap value would reach the
      // vendor and be rejected there — after the credits are reserved. Refuse
      // it here, where nothing has been spent.
      if (parsed.data.maxTokens !== undefined && parsed.data.maxTokens > model.maxOutputTokens) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: `maxTokens ${parsed.data.maxTokens} exceeds the ${model.id} output limit of ${model.maxOutputTokens}`,
          },
        })
      }
      const converted = convertJsonSchema(parsed.data.jsonSchema)
      if ("error" in converted) {
        return reply.status(400).send({ error: { code: "validation_error", message: converted.error } })
      }

      const modelIdentifier = buildLlmCreditIdentifier(
        "llm-structured",
        llmModelId,
        parsed.data.reasoningEffort,
        parsed.data.advancedMode,
      )

      const { data: job, error: jobError } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: {
          ...buildJobInputData(parsed.data, "llm-structured"),
          // Route-side overrides of the spread (the helper's doc sanctions
          // them): a 100k-char system prompt and a 64 KB schema PER ROW is not
          // something to store, and neither is needed to answer "what config
          // produced this result" — the digest identifies the prompt, the head
          // makes it recognisable in the admin job view.
          system: digestText(system),
          jsonSchema: {
            name: schemaName ?? null,
            bytes: Buffer.byteLength(JSON.stringify(parsed.data.jsonSchema), "utf8"),
          },
        },
      })
      if (jobError) {
        return sendInternalError(reply, req, jobError, "Failed to create job")
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
      if (reply.sent) return
      void reservation

      await markProviderCallStart(job.id, "anthropic-sync")

      try {
        const { output, inputTokens, outputTokens } = await llmCompleteStructured(
          {
            modelId: model.id,
            system,
            messages: [{ role: "user", content: input }],
            reasoningEffort: parsed.data.reasoningEffort,
            timeoutMs: STRUCTURED_LLM_TIMEOUT_MS,
            // The caller's maxTokens is the DEFAULT, not an Advanced-only
            // lever: a generic route has no tuned literal of its own to
            // protect, and text-to-picker's bare resolveLlmParams(parsed.data)
            // would discard the value outside Advanced mode.
            ...resolveLlmParams(parsed.data, { maxTokens: parsed.data.maxTokens }),
          },
          converted.schema,
          { schemaName, maxRetries: parsed.data.maxRetries },
        )
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
