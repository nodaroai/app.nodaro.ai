import type { NodaroClient } from "../client.js"
import type { ReduceStrategyId, ReduceMeta } from "@nodaro/shared"

// Re-export the canonical types from `@nodaro/shared` (single source of
// truth — the registry lives at `packages/shared/src/reduce-strategy-registry.ts`).
// `@nodaro/shared` is already a hard dep of this package, so there's no
// bundle-size cost to importing from it.
export type { ReduceStrategyId, ReduceMeta }

export interface ReduceInput {
  /** Which fan-in strategy to run. */
  strategyId: ReduceStrategyId
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
   * Optional — associates this reduce run with a workflow execution. The
   * server reads this from the body before Zod strips it (same path as
   * other job-creating routes).
   */
  workflowId?: string
}

export interface ReduceResult {
  jobId: string
  /**
   * Stringified result — for `count` this is a numeric string, for
   * `merge-json` this is the JSON-encoded merged object, otherwise the
   * chosen / joined text.
   */
  output: string
  meta: ReduceMeta
}

export class ReduceResource {
  constructor(private client: NodaroClient) {}

  /**
   * Run the Reduce (fan-in) node directly — useful for scripted batch
   * scoring, picking the best of N generations outside a workflow, or
   * one-shot programmatic merges.
   *
   * Throws `NodaroError` on 4xx/5xx responses (e.g. `code: "no_valid_inputs"`
   * with status 400 when every input is empty / whitespace; the underlying
   * `EmptyInputError` is mapped to a 400 server-side).
   */
  run(input: ReduceInput): Promise<ReduceResult> {
    return this.client.request("POST", "/v1/reduce", {
      body: {
        strategyId: input.strategyId,
        strategyConfig: input.strategyConfig ?? {},
        inputs: input.inputs,
        ...(input.workflowId !== undefined
          ? { workflowId: input.workflowId }
          : {}),
      },
    })
  }
}
