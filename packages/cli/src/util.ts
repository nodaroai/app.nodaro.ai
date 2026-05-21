import type { ExecutionStatus, JobStatus } from "@nodaro/client"
import { emit, info, success, type OutputOpts } from "./output.js"

/**
 * Commander variadic-arity collector. Used as the second argument to
 * `.option("--flag <pairs...>", ..., collectVariadic)` so repeated occurrences
 * of the flag accumulate into a `string[]` instead of clobbering each other.
 */
export function collectVariadic(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value]
}

/**
 * Coerce the `--count` flag value into the 1 | 2 | 4 union the entity-generate
 * routes accept. Defaults to 1 on absent / unrecognized input; the SDK further
 * validates downstream.
 *
 * Shared across objects, locations, characters command groups.
 */
export function parseCount(raw: string | undefined): 1 | 2 | 4 {
  if (raw === "2") return 2
  if (raw === "4") return 4
  return 1
}

/** Statuses at which a job or execution stops moving — same set for both. */
const TERMINAL: ReadonlySet<ExecutionStatus | JobStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
])

interface PollableResult {
  data: { status: ExecutionStatus | JobStatus }
}

interface WatchOpts<T extends PollableResult> extends OutputOpts {
  /** Closure that fetches the current status. Called on every poll tick. */
  fetch: () => Promise<T>
  /** Display id (job id or execution id) — shown in the per-tick log line. */
  label: string
  /** Poll cadence in ms. Default 2000. */
  intervalMs?: number
}

/**
 * Poll a job or execution until it reaches a terminal status, logging
 * status transitions along the way.
 *
 * Used by both `workflows run --watch` / `executions get --watch` (which
 * poll executions) and `nodes run --watch` (which polls jobs). The
 * terminal-status set is the same for both — completed / failed / cancelled.
 *
 * Resilience: transient `fetch()` errors are caught and retried at the next
 * tick rather than crashing the loop. A user watching a long job through a
 * flaky network sees one warning per blip and keeps going.
 *
 * Exit codes:
 *   - 0  on completed
 *   - 2  on failed (exits via `process.exit`)
 *   - 130 on cancelled (exits via `process.exit`)
 */
export async function watchUntilTerminal<T extends PollableResult>(opts: WatchOpts<T>): Promise<void> {
  const intervalMs = opts.intervalMs ?? 2000
  const start = Date.now()
  let lastStatus = ""

  for (;;) {
    let result: T
    try {
      result = await opts.fetch()
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      info(`[${elapsed(start)}s] poll failed (will retry): ${detail}`)
      await sleep(intervalMs)
      continue
    }

    const status = result.data.status
    if (status !== lastStatus) {
      info(`[${elapsed(start)}s] ${opts.label} → ${status}`)
      lastStatus = status
    }
    if (TERMINAL.has(status)) {
      if (opts.json) emit(result.data, opts)
      else if (status === "completed") success(`completed in ${elapsed(start)}s`)
      else process.exit(status === "failed" ? 2 : 130)
      return
    }
    await sleep(intervalMs)
  }
}

function elapsed(startMs: number): string {
  return ((Date.now() - startMs) / 1000).toFixed(1)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
