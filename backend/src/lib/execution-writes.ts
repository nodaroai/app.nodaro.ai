import { setTimeout as sleep } from "node:timers/promises"
import { supabase } from "./supabase.js"

export interface ExecutionUpdateResult {
  /** True iff the UPDATE matched at least one row AND no error was returned. */
  ok: boolean
  /** How many round-trips we made. Useful for telemetry / log filtering. */
  attempts: number
  /** True when the UPDATE returned 0 rows because the row was concurrently
   *  flipped to "cancelled" by the user, BLOCKING our `.neq("status",
   *  "cancelled")` predicate. Distinct from `ok: false` due to a transient
   *  DB error — cancellation is a documented outcome, not a failure. */
  cancelledRace?: boolean
}

const TERMINAL_RETRIES = 3
const BACKOFF_BASE_MS = 100

/**
 * Race-aware, retry-aware write to `workflow_executions`.
 *
 * Three properties this guarantees that the previous fire-and-forget
 * `updateExecution()` did not:
 *
 *   1. **No silent failures on terminal writes.** When `updates.status` is
 *      "completed" or "failed", a transient DB error is retried up to 3×
 *      with exponential backoff. If all retries fail, this THROWS — so the
 *      orchestrator's BullMQ wrapper sees a job failure and the stalled-job
 *      handler can re-pick the execution. Prior behavior swallowed the
 *      error and left the row stuck in "running" with completed_nodes ==
 *      total_nodes, which is the user-facing "stuck at 100%" bug.
 *
 *   2. **Cancellation race is a known outcome, not an error.** When the
 *      UPDATE includes `.neq("status", "cancelled")` and the user cancelled
 *      mid-flight, the UPDATE matches zero rows. That's not a retryable
 *      error — the cancellation is correct and the orchestrator should
 *      respect it. We surface `cancelledRace: true` so callers can stop
 *      processing without throwing.
 *
 *   3. **Per-level writes stay cheap.** Non-terminal updates (per-level
 *      `node_states` writes, fan-out `completed_nodes` ticks) do NOT
 *      retry — the next level write would catch up anyway, and retrying
 *      every intermediate write would multiply DB load. Only the FINAL
 *      terminal write needs hard guarantees.
 *
 * Postconditions: when this resolves with `ok=true`, the row IS persisted
 * with `updates`. When it resolves with `ok=false, cancelledRace=true`,
 * the user already cancelled and the orchestrator should bail. When it
 * resolves with `ok=false, cancelledRace=undefined`, the write failed but
 * the failure was non-terminal (intermediate write); caller can ignore.
 * When it throws, the terminal write failed permanently and a higher-level
 * retry mechanism (BullMQ stalled-job, reconcile cron) must pick up the
 * execution.
 */
export async function updateExecutionWithRetry(
  executionId: string,
  updates: Record<string, unknown>,
): Promise<ExecutionUpdateResult> {
  const isTerminal = updates.status === "completed" || updates.status === "failed"
  const maxAttempts = isTerminal ? TERMINAL_RETRIES : 1

  let lastError: { message: string; code?: string } | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // We need `.select("id")` here for TWO reasons:
    //  1. Without it Supabase's UPDATE sends no `Prefer: return=*` and
    //     PostgREST replies 204 + empty body → postgrest-js leaves `data`
    //     as `null` regardless of how many rows were matched. That makes
    //     `data.length === 0` (our zero-row / cancelled-race signal) fire
    //     on EVERY successful terminal write — inverting ok/cancelled-race.
    //  2. `.select("id")` causes PostgREST to return the matched rows so
    //     `data` is either `[]` (cancelled-race: 0 rows updated) or a
    //     non-empty array (the actual write). The check below relies on
    //     that distinction.
    // The `.neq("status", "cancelled")` predicate for terminal writes is
    // reassigned into a new local instead of discarded — postgrest-js v2
    // happens to mutate in place AND return `this`, but reassigning
    // protects against any future change to an immutable builder.
    const base = supabase
      .from("workflow_executions")
      .update(updates)
      .eq("id", executionId)
    const filtered = isTerminal ? base.neq("status", "cancelled") : base
    const builder = filtered.select("id")

    const { data, error } = (await builder) as unknown as {
      data: unknown[] | null
      error: { message: string; code?: string } | null
    }

    if (!error) {
      // With `.select("id")` chained: `data` is `[]` when zero rows matched
      // (e.g. terminal write blocked by `.neq("status","cancelled")` because
      // the user already cancelled), and `[{ id }]` on a successful update.
      // The cancelled-race outcome is correct — we don't retry.
      if (isTerminal && (!data || data.length === 0)) {
        return { ok: false, cancelledRace: true, attempts: attempt }
      }
      return { ok: true, attempts: attempt }
    }

    lastError = error

    if (attempt === maxAttempts) {
      if (isTerminal) {
        throw new Error(
          `Failed to write terminal status for ${executionId} after ${attempt} attempts: ${error.message}`,
        )
      }
      // Non-terminal writes: return ok=false so the caller can decide
      // (most callers just log + continue; the next level write retries
      // implicitly).
      return { ok: false, attempts: attempt }
    }

    // Exponential backoff before next retry: 100ms, 400ms, 1.6s.
    await sleep(BACKOFF_BASE_MS * Math.pow(4, attempt - 1))
  }

  // Unreachable in practice (the loop returns or throws), but TS needs it.
  throw new Error(
    `updateExecutionWithRetry exhausted for ${executionId}: ${lastError?.message ?? "unknown"}`,
  )
}
