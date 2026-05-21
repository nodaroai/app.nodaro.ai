import { filterSurvivors } from "./_normalize"
import { EmptyInputError, type StrategyContext, type StrategyResult } from "./types"

type Config = { strategy: "deep" | "shallow" }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a }
  for (const [k, v] of Object.entries(b)) {
    const existing = out[k]
    if (isPlainObject(existing) && isPlainObject(v)) {
      out[k] = deepMerge(existing, v)
    } else {
      out[k] = v
    }
  }
  return out
}

export async function execute(
  items: string[],
  config: Config,
  _ctx: StrategyContext,
): Promise<StrategyResult<string>> {
  const survivors = filterSurvivors(items)
  if (survivors.length === 0) throw new EmptyInputError()

  const parsed: Record<string, unknown>[] = []
  for (let i = 0; i < survivors.length; i++) {
    try {
      const obj = JSON.parse(survivors[i])
      if (!isPlainObject(obj)) throw new Error("not a plain object")
      parsed.push(obj)
    } catch (e) {
      throw new Error(`Invalid JSON at item ${items.indexOf(survivors[i])}: ${(e as Error).message}`)
    }
  }

  const merge = config.strategy === "deep" ? deepMerge : Object.assign
  const merged = parsed.reduce((acc, obj) => merge(acc, obj), {} as Record<string, unknown>)

  return {
    result: JSON.stringify(merged),
    meta: { summary: `Merged ${survivors.length} of ${items.length} JSON objects (${config.strategy})` },
  }
}
