/**
 * The cut budget the real-browser test asserts (review-cut.perf.spec.ts):
 * §2.4's 16 ms, times `PERF_BUDGET_ALLOWANCE` when it is set. A manual run
 * leaves it unset and asserts 16 ms. CI sets 2 (decided 2026-10-07): 32 ms on
 * a shared runner, a tripwire for a regression rather than the budget itself.
 * Plain JS so the CI guard test (tools/__tests__) imports it as is.
 */
export const CUT_BUDGET_MS = 16

/**
 * @param {Record<string, string | undefined>} env
 * @returns {number}
 */
export function cutBudgetMs(env) {
  const raw = env.PERF_BUDGET_ALLOWANCE
  if (raw === undefined || raw === "") return CUT_BUDGET_MS
  const allowance = Number(raw)
  if (!Number.isFinite(allowance) || allowance < 1) {
    throw new Error(`PERF_BUDGET_ALLOWANCE must be a number of at least 1 (got "${raw}")`)
  }
  return CUT_BUDGET_MS * allowance
}
