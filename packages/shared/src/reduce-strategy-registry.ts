import { z, type ZodType } from "zod"
// Reuse the canonical `OutputType` from presentation-utils so a single union
// is the source of truth across the package. Re-exporting it here would
// collide with the explicit named re-export in `index.ts`.
import type { OutputType } from "./presentation-utils.js"

// `ZodType<Output, Def, Input>` with `Input = any` lets us accept schemas
// like `z.object({ x: z.string().default("") })` where the parsed output is
// `{ x: string }` but the input is `{ x?: string }`. Pinning Input to TConfig
// would force input === output and reject `.default()` schemas.
export type ReduceStrategy<TConfig = unknown> = {
  readonly id: string
  readonly label: string
  readonly description: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly configSchema: ZodType<TConfig, any>
  readonly defaultConfig: TConfig
  readonly outputType: OutputType
  readonly creditCostKey: string
  /**
   * The strategy calls an LLM (its judge model). Everything that treats
   * "an LLM strategy" specially — the connected-install cloud proxy, the
   * tiered credit id — reads this rather than matching on the id, so a new
   * LLM strategy is covered by declaring it here.
   */
  readonly usesLlm?: boolean
}

// User-facing copy lives HERE (single source of truth) and flows into the node
// body, the config panel dropdown, the SDK docs and the MCP tool. Written for
// the person building the flow, not the engine: say what happens to their
// candidates, never "survivor" / "fan-in" / "reduce" / model names.
const PICK_BEST_LLM_STRATEGY = {
  id: "pick-best-llm",
  label: "AI picks the best",
  description: "AI compares every candidate against your criteria and picks one.",
  configSchema: z.object({
    // Default to the sensible "best quality" criteria when omitted (matches
    // defaultConfig) so a reduce({strategyId:"pick-best-llm"}) call with no
    // criteria degrades gracefully instead of erroring. An explicit "" still
    // rejects via min(1).
    criteria: z.string().min(1, "criteria cannot be empty").default("Pick the highest-quality result."),
    inputKind: z.enum(["text", "image-url"]).default("text"),
    // The judge model, like every other LLM node (llmModel + LlmModelSelect).
    // Optional: omitted → LLM_FEATURE_DEFAULTS["pick-best-llm"]. Validated
    // against LLM_MODEL_IDS at the route (the registry can't import the model
    // list without a cycle), and its tier drives the credit price via
    // buildLlmCreditIdentifier — economy / standard / premium.
    llmModel: z.string().optional(),
  }),
  defaultConfig: { criteria: "Pick the highest-quality result.", inputKind: "text" as const },
  outputType: "text" as OutputType,
  creditCostKey: "reduce:pick-best-llm",
  usesLlm: true,
} as const satisfies ReduceStrategy<{ criteria: string; inputKind: "text" | "image-url"; llmModel?: string }>

const CONCAT_STRATEGY = {
  id: "concat",
  label: "Join into one text",
  description: "Puts every candidate into a single text, one after another, with a separator between them.",
  configSchema: z.object({ separator: z.string().default("\n\n") }),
  defaultConfig: { separator: "\n\n" },
  outputType: "text" as OutputType,
  creditCostKey: "reduce:concat",
} as const satisfies ReduceStrategy<{ separator: string }>

const FIRST_NON_EMPTY_STRATEGY = {
  id: "first-non-empty",
  label: "First that has content",
  description: "Takes the first candidate that is not empty and ignores the rest.",
  configSchema: z.object({}),
  defaultConfig: {},
  outputType: "text" as OutputType,
  creditCostKey: "reduce:first-non-empty",
} as const satisfies ReduceStrategy<Record<string, never>>

const COUNT_STRATEGY = {
  id: "count",
  label: "Count them",
  description: "Outputs how many candidates arrived.",
  configSchema: z.object({}),
  defaultConfig: {},
  outputType: "data" as OutputType,
  creditCostKey: "reduce:count",
} as const satisfies ReduceStrategy<Record<string, never>>

const VOTE_STRATEGY = {
  id: "vote",
  label: "Most common answer",
  description: "Picks the candidate that appears most often (ties go to the first).",
  configSchema: z.object({ caseSensitive: z.boolean().default(false) }),
  defaultConfig: { caseSensitive: false },
  outputType: "text" as OutputType,
  creditCostKey: "reduce:vote",
} as const satisfies ReduceStrategy<{ caseSensitive: boolean }>

const MERGE_JSON_STRATEGY = {
  id: "merge-json",
  label: "Merge JSON objects",
  description: "Reads every candidate as JSON and merges them into one object.",
  configSchema: z.object({ strategy: z.enum(["deep", "shallow"]).default("deep") }),
  defaultConfig: { strategy: "deep" as const },
  outputType: "data" as OutputType,
  creditCostKey: "reduce:merge-json",
} as const satisfies ReduceStrategy<{ strategy: "deep" | "shallow" }>

/**
 * Result-meta shape returned by every reduce strategy. Shared between the
 * backend route, the SDK client, and the frontend node so all three layers
 * agree on field names. `selectedIndex` + `reasoning` are set by the
 * `pick-best-llm` and `vote` strategies (the former also fills `reasoning`);
 * `summary` is always populated.
 */
export type ReduceMeta = {
  readonly selectedIndex?: number
  readonly reasoning?: string
  readonly summary: string
}

export const REDUCE_STRATEGIES = [
  PICK_BEST_LLM_STRATEGY,
  CONCAT_STRATEGY,
  FIRST_NON_EMPTY_STRATEGY,
  COUNT_STRATEGY,
  VOTE_STRATEGY,
  MERGE_JSON_STRATEGY,
] as const

export const REDUCE_STRATEGY_IDS = REDUCE_STRATEGIES.map((s) => s.id) as readonly ReduceStrategyId[]

export type ReduceStrategyId = typeof REDUCE_STRATEGIES[number]["id"]

const BY_ID = new Map<string, ReduceStrategy>(REDUCE_STRATEGIES.map((s) => [s.id, s]))

export function getStrategy(id: ReduceStrategyId): ReduceStrategy {
  const s = BY_ID.get(id)
  if (!s) throw new Error(`unknown reduce strategy: ${id}`)
  return s
}
