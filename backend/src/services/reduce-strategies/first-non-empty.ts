import { EmptyInputError, type StrategyContext, type StrategyResult } from "./types.js"

export async function execute(
  items: string[],
  _config: Record<string, never>,
  _ctx: StrategyContext,
): Promise<StrategyResult<string>> {
  const idx = items.findIndex((s) => s !== "")
  if (idx === -1) throw new EmptyInputError()
  return {
    result: items[idx],
    meta: {
      selectedIndex: idx,
      summary: `Selected item ${idx + 1} of ${items.length} (first non-empty)`,
    },
  }
}
