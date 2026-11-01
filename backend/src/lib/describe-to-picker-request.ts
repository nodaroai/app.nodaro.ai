// backend/src/lib/describe-to-picker-request.ts — what describe-to-picker
// reads off a raw (unvalidated) request: its defaults, the provider its
// analyzer call is served from, and whether it asks for a stream. Its own
// module so the route's lane rule (concurrency-lanes/sync-route-lanes.ts) can
// read them without importing the route.
import type { FastifyRequest } from "fastify"
import { defaultReasoningEffort, LLM_FEATURE_DEFAULTS } from "@nodaro/shared/llm-models"
import { llmProviderOf } from "./concurrency-lanes/live-routes.js"

/** Stream only when the caller asks for it: an `Accept` naming `text/event-stream`. */
export function wantsEventStream(req: Pick<FastifyRequest, "headers">): boolean {
  const accept = req.headers.accept
  const text = Array.isArray(accept) ? accept.join(",") : (accept ?? "")
  return text.toLowerCase().includes("text/event-stream")
}

/**
 * The raw body with the defaults the handler applies before it reserves: an
 * omitted model is the analyzer's default, and an omitted effort is that
 * model's recipe effort when it has one. The credit guard prices the raw body
 * before validation, so without these it pre-checked a default read at the
 * bare id (the standard rung) while the job reserved the rung the resolved
 * model and effort bill, and a balance in between passed the check, then
 * failed the reservation with a 500 instead of a 402.
 *
 * Shared by the two routes that bill this feature, this one and its text twin
 * text-to-picker. It lives with them, not in the shared `resolveLlmCreditId`
 * every LLM route's guard uses: a default model applied there would move every
 * other feature's pre-check too. A model or effort that is not a string is
 * treated as absent here; the handler's validation refuses it.
 */
export function withDescribeToPickerDefaults(body: unknown): Record<string, unknown> {
  const raw = (body ?? {}) as Record<string, unknown>
  const named = typeof raw.llmModel === "string" ? raw.llmModel : undefined
  const sent = typeof raw.reasoningEffort === "string" ? raw.reasoningEffort : undefined
  return {
    ...raw,
    llmModel: named ?? LLM_FEATURE_DEFAULTS["describe-to-picker"],
    reasoningEffort: sent ?? defaultReasoningEffort("describe-to-picker", named),
  }
}

/** The provider the analyzer's call will be served from, read off the raw body with the same defaults (the route's lane). */
export function pickerAnalyzerProvider(req: Pick<FastifyRequest, "body">): string | null {
  const body = withDescribeToPickerDefaults(req.body)
  return llmProviderOf(String(body.llmModel), typeof body.reasoningEffort === "string" ? body.reasoningEffort : undefined, body.advancedMode === true)
}
