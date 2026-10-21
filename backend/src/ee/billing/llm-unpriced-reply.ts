/**
 * The refusal of a metered LLM call on a model with no price on a lane it may
 * be served on — one 400, one sentence, for the guard's pre-check, the
 * reserve backstop and the price lookups alike.
 *
 * A LEAF module (type-only imports): `middleware/credit-guard.ts` loads
 * `ee/lib/credit-guard-impl.ts`, which answers with this refusal, and
 * `llm-billing-impl.ts` reserves through the guard; keeping the refusal out of
 * `llm-billing-impl.ts` keeps that an acyclic graph.
 */
import type { FastifyReply } from "fastify"
import type { LlmUnpricedModelError } from "./llm-metered.js"

/** The 400 a model with no price on its lane is refused with — by the guard pre-check and by the reserve backstop alike. */
export function sendLlmModelUnpriced(reply: FastifyReply, err: LlmUnpricedModelError): void {
  reply.status(400).send({
    error: { code: "validation_error", reason: err.code, modelId: err.modelId, message: llmModelUnpricedMessage(err) },
  })
}

/** The user-facing sentence for a model with no price — the 400 and the price lookups say the same. */
export function llmModelUnpricedMessage(err: LlmUnpricedModelError): string {
  return `The model "${err.modelId}" has no price yet, so it cannot be run. Choose another model.`
}
