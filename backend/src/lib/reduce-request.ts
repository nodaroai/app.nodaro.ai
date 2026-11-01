// backend/src/lib/reduce-request.ts — what the reduce route reads off a raw
// (pre-Zod) body: the strategy it asks for and the AI judge's model. Its own
// module so the route's lane rule (concurrency-lanes/sync-route-lanes.ts) can
// read them without importing the route.
import { REDUCE_STRATEGY_IDS, type ReduceStrategyId } from "@nodaro/shared/workflow"
import { LLM_MODEL_IDS } from "@nodaro/shared/llm-models"

/** The strategy this raw (pre-Zod) body asks for, when it is a known one. */
export function requestedStrategy(body: unknown): ReduceStrategyId | null {
  const id = (body as { strategyId?: unknown } | undefined)?.strategyId
  return typeof id === "string" && (REDUCE_STRATEGY_IDS as readonly string[]).includes(id) ? (id as ReduceStrategyId) : null
}

/** The AI judge's model a raw body names, when it is a registry id (else the default prices it; Zod answers the rest). */
export function judgeModelOf(body: unknown): string | undefined {
  const model = (body as { strategyConfig?: { llmModel?: unknown } } | undefined)?.strategyConfig?.llmModel
  return typeof model === "string" && (LLM_MODEL_IDS as readonly string[]).includes(model) ? model : undefined
}
