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
 * truth.
 */
export type { ReduceMeta }

export type StrategyResult<T = string | number> = {
  readonly result: T
  readonly meta: ReduceMeta
}

export class EmptyInputError extends Error {
  constructor() { super("All upstream iterations failed; nothing to reduce.") }
}
