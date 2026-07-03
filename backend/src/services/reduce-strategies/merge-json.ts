import { filterSurvivors } from "./_normalize.js"
import { EmptyInputError, type StrategyContext, type StrategyResult } from "./types.js"

type Config = { strategy: "deep" | "shallow" }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

// Keys that can hijack an object's prototype chain. The items merged here come
// from upstream node output (user-controlled JSON via JSON.parse, which creates
// real own `__proto__`/`constructor`/`prototype` keys), so they must never be
// allowed to drive a merge. The copy-style merge below already avoids in-place
// mutation of Object.prototype, but dropping these keys makes the guard explicit
// and robust to any future refactor that mutates in place. Standard prototype-
// pollution defense (matches lodash/deepmerge behavior).
const PROTO_POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"])

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a }
  for (const [k, v] of Object.entries(b)) {
    if (PROTO_POLLUTION_KEYS.has(k)) continue
    const existing = out[k]
    if (isPlainObject(existing) && isPlainObject(v)) {
      out[k] = deepMerge(existing, v)
    } else {
      out[k] = v
    }
  }
  return out
}

// Shallow variant with the same guard. Replaces Object.assign, whose [[Set]]
// semantics would reparent the accumulator on a user-supplied `__proto__` key.
function shallowMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a }
  for (const [k, v] of Object.entries(b)) {
    if (PROTO_POLLUTION_KEYS.has(k)) continue
    out[k] = v
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

  const merge = config.strategy === "deep" ? deepMerge : shallowMerge
  const merged = parsed.reduce((acc, obj) => merge(acc, obj), {} as Record<string, unknown>)

  return {
    result: JSON.stringify(merged),
    meta: { summary: `Merged ${survivors.length} of ${items.length} JSON objects (${config.strategy})` },
  }
}
