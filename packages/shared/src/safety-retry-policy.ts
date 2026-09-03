import { getModel } from "./model-catalog.js"

/**
 * Retry/fallback behavior derived from a catalog entry's `safetyFilter`
 * flag (see `ModelCatalogEntry.safetyFilter` in `model-catalog.ts`).
 */
export interface SafetyRetryPolicy {
  /** 2 when the model declares `safetyFilter.stochastic`, else 1. */
  maxAttempts: 1 | 2
  /**
   * Catalog model id to offer when the retry also blocks. Only present
   * when the entry declares one AND it resolves to a real catalog entry.
   */
  fallback?: string
}

/**
 * The provider's safety filter is known to be non-deterministic on some
 * catalog models — a benign prompt can trip it once and pass on an
 * identical retry. For those models the platform retries a blocked
 * request once (`maxAttempts: 2`) before giving up; `fallback` names the
 * catalog model to offer the user when the retry also blocks.
 *
 * Every model not flagged this way — including an unrecognized id —
 * gets a single attempt and no fallback.
 */
export function safetyRetryPolicy(modelId: string): SafetyRetryPolicy {
  const entry = getModel(modelId)
  const safetyFilter = entry?.safetyFilter
  if (!safetyFilter?.stochastic) return { maxAttempts: 1 }

  const fallback = safetyFilter.fallback
  if (fallback && getModel(fallback)) {
    return { maxAttempts: 2, fallback }
  }
  return { maxAttempts: 2 }
}
