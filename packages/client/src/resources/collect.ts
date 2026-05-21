import type { NodaroClient } from "../client.js"

/**
 * Strategy id for the Collect (fan-in) node. The six built-in strategies:
 *   - `pick-best-llm` — Sonnet picks the best item against your criteria.
 *   - `concat` — Join all survivors with a separator.
 *   - `first-non-empty` — Return the first survivor (empty strings filtered).
 *   - `count` — Return how many survivors came through.
 *   - `vote` — Return the most common survivor (ties → first).
 *   - `merge-json` — Parse each survivor as JSON and merge into one object.
 *
 * Kept as a string union so consumers don't have to import from
 * `@nodaro/shared` separately; the canonical registry lives at
 * `packages/shared/src/collect-strategy-registry.ts`.
 */
export type CollectStrategyId =
  | "pick-best-llm"
  | "concat"
  | "first-non-empty"
  | "count"
  | "vote"
  | "merge-json"

export interface CollectMeta {
  /** Set by `pick-best-llm` and `vote`: zero-based index of the picked input. */
  selectedIndex?: number
  /** Set by `pick-best-llm`: the LLM's plain-language rationale. */
  reasoning?: string
  /** Always set — a human-readable summary of what the strategy did. */
  summary: string
}

export interface CollectInput {
  /** Which fan-in strategy to run. */
  strategyId: CollectStrategyId
  /**
   * Strategy-specific config. Defaults to `{}` server-side, which uses every
   * strategy's `defaultConfig`. Schemas (from `@nodaro/shared`):
   *   - `pick-best-llm`: `{ criteria: string, inputKind?: "text" | "image-url" }`
   *   - `concat`: `{ separator?: string }`
   *   - `vote`: `{ caseSensitive?: boolean }`
   *   - `merge-json`: `{ strategy?: "deep" | "shallow" }`
   *   - `first-non-empty`, `count`: `{}`
   */
  strategyConfig?: Record<string, unknown>
  /** Up to 1000 input strings (URLs, text fragments, etc.). */
  inputs: string[]
  /**
   * Optional — associates this collect run with a workflow execution. The
   * server reads this from the body before Zod strips it (same path as
   * other job-creating routes).
   */
  workflowExecutionId?: string
}

export interface CollectResult {
  jobId: string
  /**
   * Stringified result — for `count` this is a numeric string, for
   * `merge-json` this is the JSON-encoded merged object, otherwise the
   * chosen / joined text.
   */
  output: string
  meta: CollectMeta
}

export class CollectResource {
  constructor(private client: NodaroClient) {}

  /**
   * Run the Collect (fan-in) node directly — useful for scripted batch
   * scoring, picking the best of N generations outside a workflow, or
   * one-shot programmatic merges.
   *
   * Throws `BadRequestError` (code: `no_valid_inputs`) when every input is
   * empty / whitespace; the underlying `EmptyInputError` is mapped to a
   * 400 server-side.
   */
  execute(input: CollectInput): Promise<CollectResult> {
    return this.client.request("POST", "/v1/collect", {
      body: {
        strategyId: input.strategyId,
        strategyConfig: input.strategyConfig ?? {},
        inputs: input.inputs,
        ...(input.workflowExecutionId !== undefined
          ? { workflowExecutionId: input.workflowExecutionId }
          : {}),
      },
    })
  }
}
