import { filterSurvivors } from "./_normalize"
import type { StrategyContext, StrategyResult } from "./types"

type Config = { separator: string }

export async function execute(
  items: string[],
  config: Config,
  _ctx: StrategyContext,
): Promise<StrategyResult<string>> {
  const survivors = filterSurvivors(items)
  return {
    result: survivors.join(config.separator),
    meta: { summary: `Joined ${survivors.length} of ${items.length} inputs` },
  }
}
