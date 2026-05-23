import type { FastifyBaseLogger } from "fastify"
import type { ReduceMeta } from "@nodaro/shared"

export type StrategyContext = {
  readonly userId: string
  readonly jobId: string
  readonly logger: FastifyBaseLogger
}

/**
 * Per-strategy result-meta shape — re-exported from `@nodaro/shared` so the
 * backend, the SDK client, and the frontend node share a single source of
 * truth. Backward-compat alias `ResultMeta` left in for any in-flight code
 * still importing it from this file or `./index.js`.
 */
export type { ReduceMeta }
export type ResultMeta = ReduceMeta

export type StrategyResult<T = string | number> = {
  readonly result: T
  readonly meta: ReduceMeta
}

export class EmptyInputError extends Error {
  constructor() { super("All upstream iterations failed; nothing to reduce.") }
}
