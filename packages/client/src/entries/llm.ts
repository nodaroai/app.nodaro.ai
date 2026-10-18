/**
 * `@nodaro/sdk/llm` — the `llm` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { LlmResource } from "../resources/llm.js"

export type {
  LlmStructuredInput,
  LlmStructuredResult,
  LlmStructuredJobInput,
  LlmStructuredJobOutput,
} from "../resources/llm.js"
