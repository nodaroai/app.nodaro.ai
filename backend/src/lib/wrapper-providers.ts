/**
 * Jobs that wrap a whole inner execution (`input_data._executionId`): a
 * component node, and a use-case node. Every walk from a wrapper into its
 * inner run (budget excess, app expunge) reads this list.
 */
export const WRAPPER_JOB_PROVIDERS = ["component", "use-case"] as const

/**
 * A use-case node's wrapper. Never stamped with the outer run's
 * `workflow_execution_id` (so job listings never fold it in with that run's
 * jobs): an outer run reaches it only through its node state's job id.
 */
export const USE_CASE_WRAPPER_PROVIDER = "use-case" satisfies (typeof WRAPPER_JOB_PROVIDERS)[number]

export function isWrapperJobProvider(provider: unknown): boolean {
  return typeof provider === "string" && (WRAPPER_JOB_PROVIDERS as readonly string[]).includes(provider)
}
