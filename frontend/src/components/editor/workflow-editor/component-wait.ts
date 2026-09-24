import { getComponentWaitLimit, type ComponentWaitLimit } from "@/lib/api"

/** The editor's own wait on a component run — unchanged for a run with
 *  nothing budgeted inside (and the floor for every run). */
export const COMPONENT_CLIENT_TIMEOUT_MS = 30 * 60 * 1000

/** Consecutive failed lookups tolerated before the wait falls back to the limit
 *  it already knows. Each retry rides the executor's next poll tick, so one
 *  transient error at the moment the limit is reached cannot abandon a
 *  multi-hour run. */
export const COMPONENT_WAIT_LOOKUP_ATTEMPTS = 3

/**
 * The editor's wait on a component run: "waits as long as the server allows"
 * (decision 2026-09-24, podcast Track 0.11 follow-up).
 *
 * A component whose inner run dispatches a long render (apply-edl) is allowed
 * hours by the server — its own wait is the base plus that run's budget excess
 * (`GET /v1/component/execute/:jobId/wait-limit`, the same figure the server's
 * background wait and a parent DAG's component node read). The client used to
 * give up at a flat 30 minutes and paint the node failed while the render kept
 * going. Now, when the current limit is reached, it asks the server:
 *  - a long render already dispatched (`budgetExcessMs > 0`) → the limit
 *    becomes the server's (base + excess);
 *  - a long render in the run that has not been dispatched yet
 *    (`pendingBudgetedNodes`) → the limit becomes at least the server's base,
 *    so a render that starts after minute 30 is not abandoned;
 *  - neither → the limit stays 30 minutes, so such a run times out exactly as
 *    before (one extra request, at the moment it times out).
 * It asks again each time the grown limit is reached (an execution's excess
 * only grows as it dispatches), exactly like the server's `BudgetedDeadline` —
 * so a render still undispatched at the server's base times out on both sides
 * together. A failed lookup is retried on the next poll ticks, up to
 * `COMPONENT_WAIT_LOOKUP_ATTEMPTS` in a row, then the known limit stands.
 *
 * `reached` is `elapsed >= limit` — the exit condition of the `while (elapsed <
 * TIMEOUT_MS)` loop it replaces.
 */
export class ComponentWaitDeadline {
  private limit = COMPONENT_CLIENT_TIMEOUT_MS
  private failedLookups = 0

  constructor(
    private readonly jobId: string,
    private readonly readLimit: (jobId: string) => Promise<ComponentWaitLimit> = getComponentWaitLimit,
  ) {}

  get limitMs(): number {
    return this.limit
  }

  async reached(elapsedMs: number): Promise<boolean> {
    if (elapsedMs < this.limit) return false
    try {
      const { budgetExcessMs, waitLimitMs, pendingBudgetedNodes } = await this.readLimit(this.jobId)
      this.failedLookups = 0
      const serverWaits = budgetExcessMs > 0 || pendingBudgetedNodes === true
      if (serverWaits && Number.isFinite(waitLimitMs) && waitLimitMs > this.limit) this.limit = waitLimitMs
    } catch {
      // Keep polling and ask again on the next tick — a bounded number of times.
      this.failedLookups++
      if (this.failedLookups < COMPONENT_WAIT_LOOKUP_ATTEMPTS) return false
    }
    return elapsedMs >= this.limit
  }
}
