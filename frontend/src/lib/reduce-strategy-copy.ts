// Display copy for the Reduce ("Choose Best") strategies. The registry in
// @nodaro/shared owns ids, behaviour and the English label/description the
// API and MCP surfaces read; the editor renders these dictionary keys instead
// so the strategy list follows the chosen language. Keyed by the registry's
// id union, so a strategy added upstream without copy here fails tsc.
import { REDUCE_STRATEGIES } from "@nodaro/shared"
import type { MessageKey } from "@/lib/i18n"

type ReduceStrategyId = (typeof REDUCE_STRATEGIES)[number]["id"]

export const REDUCE_STRATEGY_COPY: Record<ReduceStrategyId, { readonly label: MessageKey; readonly description: MessageKey }> = {
  "pick-best-llm": { label: "cfgext.reduceStrategyPickBest", description: "cfgext.reduceStrategyPickBestDesc" },
  concat: { label: "cfgext.reduceStrategyConcat", description: "cfgext.reduceStrategyConcatDesc" },
  "first-non-empty": { label: "cfgext.reduceStrategyFirst", description: "cfgext.reduceStrategyFirstDesc" },
  count: { label: "cfgext.reduceStrategyCount", description: "cfgext.reduceStrategyCountDesc" },
  vote: { label: "cfgext.reduceStrategyVote", description: "cfgext.reduceStrategyVoteDesc" },
  "merge-json": { label: "cfgext.reduceStrategyMergeJson", description: "cfgext.reduceStrategyMergeJsonDesc" },
}
