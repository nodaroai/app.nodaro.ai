import { getStrategy, type CollectStrategyId } from "@nodaro/shared"
import * as concat from "./concat.js"
import * as count from "./count.js"
import * as firstNonEmpty from "./first-non-empty.js"
import * as vote from "./vote.js"
import * as mergeJson from "./merge-json.js"
import * as pickBestLlm from "./pick-best-llm.js"
import type { StrategyContext, StrategyResult } from "./types.js"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const HANDLERS: Record<CollectStrategyId, (items: string[], config: any, ctx: StrategyContext) => Promise<StrategyResult>> = {
  "concat": concat.execute,
  "count": count.execute,
  "first-non-empty": firstNonEmpty.execute,
  "vote": vote.execute,
  "merge-json": mergeJson.execute,
  "pick-best-llm": pickBestLlm.execute,
}

export async function dispatchStrategy(
  strategyId: CollectStrategyId,
  items: string[],
  rawConfig: unknown,
  ctx: StrategyContext,
): Promise<StrategyResult> {
  const strategy = getStrategy(strategyId)
  const config = strategy.configSchema.parse(rawConfig)
  const handler = HANDLERS[strategyId]
  return handler(items, config, ctx)
}

export type { StrategyResult, ResultMeta, CollectMeta } from "./types.js"
export { EmptyInputError } from "./types.js"
