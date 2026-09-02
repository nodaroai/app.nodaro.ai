/**
 * The structured-LLM request, shared by POST /v1/llm/structured (synchronous),
 * POST /v1/llm/structured/jobs (asynchronous) and the `llm-structured` worker:
 * the body schema, the pre-flight that refuses before any money moves, the
 * stored `input_data` projection, and the ONE completion call. A route or
 * worker that re-implemented any of these would drift from the others.
 */
import { createHash } from "node:crypto"
import { z, type ZodType } from "zod"
import {
  buildLlmCreditIdentifier,
  getLlmModel,
  LLM_FEATURE_DEFAULTS,
  LLM_MODEL_IDS,
  LLM_REASONING_EFFORTS,
  LLM_TEXT_INPUT_MAX,
  type LlmModelDef,
} from "@nodaro/shared"
import { llmCompleteStructured, type StructuredLlmOutput } from "./llm-client.js"
import { LLM_ADVANCED_SHAPE, advancedModeError, resolveLlmParams } from "./llm-advanced-mode.js"
import { buildJobInputData } from "./job-input-data.js"

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

export type LlmStructuredBody = z.infer<typeof llmStructuredBody>

export type PreparedStructuredRequest =
  | { ok: true; model: LlmModelDef; schema: ZodType; modelIdentifier: string }
  | { ok: false; status: 400; error: { code: string; message: string } }

/**
 * Everything that can be refused BEFORE a row or a reservation exists:
 * model resolution, Advanced-mode legality, the output cap, schema
 * conversion — and the credit id the request bills under.
 */
export function prepareStructuredRequest(body: LlmStructuredBody): PreparedStructuredRequest {
  // No `llm-structured` entry in LLM_FEATURE_DEFAULTS: the route is generic
  // and has no opinion about the task, so it borrows the generic chat
  // default. Billing is a separate axis and uses its OWN feature id below.
  const llmModelId = body.llmModel ?? LLM_FEATURE_DEFAULTS["llm-chat"]
  const model = getLlmModel(llmModelId)
  if (!model) {
    return { ok: false, status: 400, error: { code: "validation_error", message: "Unknown llmModel" } }
  }
  const advancedError = advancedModeError(body, model.id)
  if (advancedError) return { ok: false, status: 400, error: advancedError }
  // `deriveParams` floors the output cap UP when reasoning shares the
  // budget but never clamps it DOWN, so an over-cap value would reach the
  // vendor and be rejected there — after the credits are reserved. Refuse
  // it here, where nothing has been spent.
  if (body.maxTokens !== undefined && body.maxTokens > model.maxOutputTokens) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "validation_error",
        message: `maxTokens ${body.maxTokens} exceeds the ${model.id} output limit of ${model.maxOutputTokens}`,
      },
    }
  }
  const converted = convertJsonSchema(body.jsonSchema)
  if ("error" in converted) {
    return { ok: false, status: 400, error: { code: "validation_error", message: converted.error } }
  }
  return {
    ok: true,
    model,
    schema: converted.schema,
    modelIdentifier: buildLlmCreditIdentifier("llm-structured", llmModelId, body.reasoningEffort, body.advancedMode),
  }
}

export type StructuredCompletionBody = Pick<
  LlmStructuredBody,
  "system" | "schemaName" | "reasoningEffort" | "maxRetries" | "maxTokens" | "advancedMode" | "temperature"
>

/** The one completion call. `input` is passed separately because the async
 *  worker composes it (caller text + analysis) after the body was stored. */
export function runStructuredCompletion(
  body: StructuredCompletionBody,
  prepared: { model: { id: string }; schema: ZodType },
  input: string,
): Promise<StructuredLlmOutput<unknown>> {
  return llmCompleteStructured(
    {
      modelId: prepared.model.id,
      system: body.system,
      messages: [{ role: "user", content: input }],
      reasoningEffort: body.reasoningEffort,
      timeoutMs: STRUCTURED_LLM_TIMEOUT_MS,
      // The caller's maxTokens is the DEFAULT, not an Advanced-only lever: a
      // generic route has no tuned literal of its own to protect, and a bare
      // resolveLlmParams(body) would discard the value outside Advanced mode.
      ...resolveLlmParams(body, { maxTokens: body.maxTokens }),
    },
    prepared.schema,
    { schemaName: body.schemaName, maxRetries: body.maxRetries },
  )
}

/**
 * The `jobs.input_data` projection: the body minus the two things not to
 * store per row — a 100k-char system prompt and a 64 KB schema. The digest
 * identifies the prompt, the head makes it recognisable in the admin job
 * view; the schema's name and size answer "what config produced this".
 */
export function structuredJobInputData(body: LlmStructuredBody, type: string = "llm-structured"): Record<string, unknown> {
  return {
    ...buildJobInputData(body, type),
    system: digestText(body.system),
    jsonSchema: {
      name: body.schemaName ?? null,
      bytes: Buffer.byteLength(JSON.stringify(body.jsonSchema), "utf8"),
    },
  }
}
