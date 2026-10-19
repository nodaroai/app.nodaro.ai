/**
 * What an app run has spent, as every run surface reports it (`creditsUsed`).
 *
 * It is `app_runs.credits_used`: the run's TOTAL across its attempts — the execution the run points
 * at plus every execution that one continued (a Retry's `resumedFrom`, lib/app-run-stamp.ts), back
 * to the run's first attempt (decided 2026-10-19). The database keeps it (migration 537,
 * `app_run_credits_total`): re-totalled whenever an execution's spend changes and whenever the run's
 * pointer moves, so it is live while an attempt runs. Each attempt's own spend stays on its execution
 * (`execution.totalCreditsUsed`). A Render final is a continuation outside the run and is not in it;
 * a start-over (the ordinary run of the run's id) begins a total of its own.
 *
 * It is never reported below the current execution's own spend. The chain includes that execution,
 * so a current total is never below it; a column that is (before migration 537 applies, when the
 * column was written only as an execution ended, or after a trigger that could only warn) would
 * otherwise show less than the run has visibly spent.
 */
export function appRunCreditsUsed(
  run: { readonly credits_used?: unknown },
  execution?: { readonly total_credits_used?: unknown } | null,
): number {
  const total = finite(run.credits_used)
  const own = finite(execution?.total_credits_used)
  return Math.max(total ?? 0, own ?? 0)
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
