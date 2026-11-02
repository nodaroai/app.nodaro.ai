// backend/src/lib/concurrency-lanes/vocabulary.ts — the closed lists of lanes
// and wait reasons as values, for what must enumerate them (the OpenAPI
// schema of the `queue` field). types.ts derives its unions from these, so a
// list and its type cannot drift. No imports.

/** Every concurrency lane (types.ts ConcurrencyLane). */
export const CONCURRENCY_LANES = ["provider", "llm", "local", "run"] as const

/** Every reason a job waits (types.ts WaitReason). */
export const WAIT_REASONS = ["user_lane", "provider_ceiling", "server_busy"] as const

/** What a waiting row's `queue.upgradeHint` can name, besides null (queue-info.ts). */
export const UPGRADE_HINTS = ["plan", "workspace"] as const
