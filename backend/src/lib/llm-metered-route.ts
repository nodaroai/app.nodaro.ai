/**
 * Small pieces the metered structured + picker routes share (llm-structured
 * sync and jobs, text-to-picker, describe-to-picker): the guard's pre-check
 * inputs read off a RAW body, the sentence a charged failure ends with, and a
 * structured call as the hold sizes it.
 *
 * The money moves through `lib/llm-billing.ts` (reserve → spend → settle); this
 * module only shapes what those routes hand it and what the person reads.
 */
import type { ZodType } from "zod"
import { getLlmModel } from "@nodaro/shared/llm-models"
// From its own module, not the client facade a route test replaces: the hold
// must size the schema exactly as the call renders it.
import { structuredJsonSchema } from "./llm/structured.js"
import type { LlmRequest } from "./llm/types.js"
import type { LlmPlannedCall, LlmSettleOutcome } from "./llm-billing.js"

/** What `llmPrecheckBaseCredits` reads off a body. */
export interface LlmPrecheckBody {
  llmModel?: string
  reasoningEffort?: string
  advancedMode?: boolean
  maxTokens?: number
}

/**
 * The pre-check body from a RAW request body — the guard runs BEFORE the
 * handler's Zod. A field of the wrong type is dropped; a model the registry
 * does not know answers `undefined` (no metered pre-check), so the handler's
 * validation gives its own 400 instead of an `llm_model_unpriced`.
 */
export function llmPrecheckBody(raw: unknown): LlmPrecheckBody | undefined {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const llmModel = typeof body.llmModel === "string" ? body.llmModel : undefined
  if (llmModel !== undefined && !getLlmModel(llmModel)) return undefined
  return {
    ...(llmModel !== undefined ? { llmModel } : {}),
    ...(typeof body.reasoningEffort === "string" ? { reasoningEffort: body.reasoningEffort } : {}),
    ...(body.advancedMode === true ? { advancedMode: true } : {}),
    ...(typeof body.maxTokens === "number" && Number.isFinite(body.maxTokens) && body.maxTokens > 0 ? { maxTokens: body.maxTokens } : {}),
  }
}

/**
 * The TEXT characters of a raw body's fields, for the pre-check: each string's
 * length, an object's JSON length; anything else 0. Never media — a base64
 * image counted as text would pre-check as a ~333k-token read (Task 5 C7).
 */
export function llmTextChars(...values: unknown[]): number {
  let chars = 0
  for (const value of values) {
    if (typeof value === "string") chars += value.length
    else if (value && typeof value === "object") chars += JSON.stringify(value).length
  }
  return chars
}

/**
 * The failure message a person reads, with the charge stated when a failed
 * metered call was charged (the provider billed the work done before it
 * failed: a refusal, a cut-off answer, answers that never matched the schema).
 * Unchanged for a refund, a tier reservation or an unsettled hold.
 */
export function chargedFailureMessage(message: string, settled: LlmSettleOutcome): string {
  if (settled.outcome !== "charged") return message
  const credits = settled.charged === 1 ? "1 credit" : `${settled.charged} credits`
  return `${message} Charged ${credits}: the model did billed work before it failed.`
}

/**
 * A forced-schema call as the provider receives it — the request plus the
 * rendered schema the structured client attaches (`runStructuredAttempts`) —
 * for the metered hold (D1: one attempt on the primary lane, sized from the
 * request as sent, the schema's characters included). Shared by every route
 * that holds a structured call: llm-structured (sync and jobs), text-to-picker,
 * describe-to-picker.
 */
export function plannedStructuredCall(request: LlmRequest, schema: ZodType, schemaName?: string): LlmPlannedCall {
  return {
    modelId: request.modelId,
    request: { ...request, failOnRefusal: true, jsonSchema: { name: schemaName ?? "result", schema: structuredJsonSchema(schema) } },
  }
}
