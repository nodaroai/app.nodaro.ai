import type { FastifyBaseLogger } from "fastify"

export type StrategyContext = {
  readonly userId: string
  readonly jobId: string
  readonly logger: FastifyBaseLogger
}

export type ResultMeta = {
  readonly selectedIndex?: number
  readonly reasoning?: string
  readonly summary: string
}

export type StrategyResult<T = string | number> = {
  readonly result: T
  readonly meta: ResultMeta
}

export class EmptyInputError extends Error {
  constructor() { super("All upstream iterations failed; nothing to collect.") }
}
