import { filterSurvivors } from "./_normalize"
import { EmptyInputError, type StrategyContext, type StrategyResult } from "./types"

type Config = { caseSensitive: boolean }

export async function execute(
  items: string[],
  config: Config,
  _ctx: StrategyContext,
): Promise<StrategyResult<string>> {
  const survivors = filterSurvivors(items)
  if (survivors.length === 0) throw new EmptyInputError()

  const norm = (s: string) => (config.caseSensitive ? s : s.toLowerCase())
  const tallies = new Map<string, { count: number; first: string; firstIndex: number }>()
  survivors.forEach((s, i) => {
    const key = norm(s)
    const existing = tallies.get(key)
    if (existing) existing.count++
    else tallies.set(key, { count: 1, first: s, firstIndex: i })
  })

  let winner = survivors[0]
  let winnerCount = 0
  let winnerFirstIndex = Infinity
  for (const t of tallies.values()) {
    if (t.count > winnerCount || (t.count === winnerCount && t.firstIndex < winnerFirstIndex)) {
      winner = t.first
      winnerCount = t.count
      winnerFirstIndex = t.firstIndex
    }
  }

  return {
    result: winner,
    meta: { summary: `Winner: "${winner}" (${winnerCount} of ${survivors.length} votes)` },
  }
}
