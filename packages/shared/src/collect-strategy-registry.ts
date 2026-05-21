import { z, type ZodType, type ZodTypeDef } from "zod"
// Reuse the canonical `OutputType` from presentation-utils so a single union
// is the source of truth across the package. Re-exporting it here would
// collide with the explicit named re-export in `index.ts`.
import type { OutputType } from "./presentation-utils.js"

// `ZodType<Output, Def, Input>` with `Input = any` lets us accept schemas
// like `z.object({ x: z.string().default("") })` where the parsed output is
// `{ x: string }` but the input is `{ x?: string }`. Pinning Input to TConfig
// would force input === output and reject `.default()` schemas.
export type CollectStrategy<TConfig = unknown> = {
  readonly id: string
  readonly label: string
  readonly description: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly configSchema: ZodType<TConfig, ZodTypeDef, any>
  readonly defaultConfig: TConfig
  readonly outputType: OutputType
  readonly creditCostKey: string
}

const PICK_BEST_LLM_STRATEGY = {
  id: "pick-best-llm",
  label: "Pick best (LLM judge)",
  description: "Sonnet picks the best item against your criteria.",
  configSchema: z.object({
    criteria: z.string().min(1, "criteria is required"),
    inputKind: z.enum(["text", "image-url"]).default("text"),
  }),
  defaultConfig: { criteria: "Pick the highest-quality result.", inputKind: "text" as const },
  outputType: "text" as OutputType,
  creditCostKey: "collect:pick-best-llm",
} as const satisfies CollectStrategy<{ criteria: string; inputKind: "text" | "image-url" }>

const CONCAT_STRATEGY = {
  id: "concat",
  label: "Concatenate",
  description: "Join all survivors with a separator.",
  configSchema: z.object({ separator: z.string().default("\n\n") }),
  defaultConfig: { separator: "\n\n" },
  outputType: "text" as OutputType,
  creditCostKey: "collect:concat",
} as const satisfies CollectStrategy<{ separator: string }>

const FIRST_NON_EMPTY_STRATEGY = {
  id: "first-non-empty",
  label: "First non-empty",
  description: "Return the first survivor (empty strings filtered).",
  configSchema: z.object({}),
  defaultConfig: {},
  outputType: "text" as OutputType,
  creditCostKey: "collect:first-non-empty",
} as const satisfies CollectStrategy<Record<string, never>>

const COUNT_STRATEGY = {
  id: "count",
  label: "Count",
  description: "Return how many survivors came through.",
  configSchema: z.object({}),
  defaultConfig: {},
  outputType: "data" as OutputType,
  creditCostKey: "collect:count",
} as const satisfies CollectStrategy<Record<string, never>>

const VOTE_STRATEGY = {
  id: "vote",
  label: "Majority vote",
  description: "Return the most common survivor (ties → first).",
  configSchema: z.object({ caseSensitive: z.boolean().default(false) }),
  defaultConfig: { caseSensitive: false },
  outputType: "text" as OutputType,
  creditCostKey: "collect:vote",
} as const satisfies CollectStrategy<{ caseSensitive: boolean }>

const MERGE_JSON_STRATEGY = {
  id: "merge-json",
  label: "Merge JSON",
  description: "Parse each survivor as JSON and merge into one object.",
  configSchema: z.object({ strategy: z.enum(["deep", "shallow"]).default("deep") }),
  defaultConfig: { strategy: "deep" as const },
  outputType: "data" as OutputType,
  creditCostKey: "collect:merge-json",
} as const satisfies CollectStrategy<{ strategy: "deep" | "shallow" }>

/**
 * Result-meta shape returned by every collect strategy. Shared between the
 * backend route, the SDK client, and the frontend node so all three layers
 * agree on field names. `selectedIndex` + `reasoning` are set by the
 * `pick-best-llm` and `vote` strategies (the former also fills `reasoning`);
 * `summary` is always populated.
 */
export type CollectMeta = {
  readonly selectedIndex?: number
  readonly reasoning?: string
  readonly summary: string
}

export const COLLECT_STRATEGIES = [
  PICK_BEST_LLM_STRATEGY,
  CONCAT_STRATEGY,
  FIRST_NON_EMPTY_STRATEGY,
  COUNT_STRATEGY,
  VOTE_STRATEGY,
  MERGE_JSON_STRATEGY,
] as const

export const COLLECT_STRATEGY_IDS = COLLECT_STRATEGIES.map((s) => s.id) as readonly CollectStrategyId[]

export type CollectStrategyId = typeof COLLECT_STRATEGIES[number]["id"]

const BY_ID = new Map<string, CollectStrategy>(COLLECT_STRATEGIES.map((s) => [s.id, s]))

export function getStrategy(id: CollectStrategyId): CollectStrategy {
  const s = BY_ID.get(id)
  if (!s) throw new Error(`unknown collect strategy: ${id}`)
  return s
}
