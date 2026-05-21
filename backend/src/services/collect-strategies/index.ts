import { getStrategy, type CollectStrategyId } from "@nodaro/shared"
import * as concat from "./concat"
import * as count from "./count"
import * as firstNonEmpty from "./first-non-empty"
import * as vote from "./vote"
import * as mergeJson from "./merge-json"
import * as pickBestLlm from "./pick-best-llm"
import type { StrategyContext, StrategyResult } from "./types"

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

export type { StrategyResult, ResultMeta } from "./types"
export { EmptyInputError } from "./types"
