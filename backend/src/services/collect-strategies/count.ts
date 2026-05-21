import { filterSurvivors } from "./_normalize"
import type { StrategyContext, StrategyResult } from "./types"

export async function execute(
  items: string[],
  _config: Record<string, never>,
  _ctx: StrategyContext,
): Promise<StrategyResult<number>> {
  const survivors = filterSurvivors(items)
  return {
    result: survivors.length,
    meta: { summary: `Counted ${survivors.length} of ${items.length} inputs` },
  }
}
