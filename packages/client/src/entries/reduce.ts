/**
 * `@nodaro/sdk/reduce` — the `reduce` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { ReduceResource } from "../resources/reduce.js"

export type {
  ReduceStrategyId,
  ReduceMeta,
  ReduceInput,
  ReduceResult,
} from "../resources/reduce.js"
