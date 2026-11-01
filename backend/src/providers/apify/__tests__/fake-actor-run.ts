/**
 * A test double of Apify's start-then-wait (providers/apify/run.ts) driven by
 * a `.call()`-shaped mock. `actor(id).call(input, opts)` is exactly
 * `start(input, opts)` followed by `run(runId).waitForFinish({ waitSecs })`,
 * so a suite written against `call` keeps its assertions: the mock is invoked
 * at the wait, with the start's input and options plus the wait's `waitSecs`.
 */
import { vi, type Mock } from "vitest"

export interface CallBackedRuns {
  /** `actor(id).start` — remembers the input and options under a new run id. */
  readonly start: Mock<(input: unknown, opts?: Record<string, unknown>) => Promise<{ id: string }>>
  /** `run(id)` for a run `start` made: its `waitForFinish` invokes the call mock; `extra` adds the rest (abort, …). */
  runOf(id: string, extra?: Record<string, unknown>): Record<string, unknown>
}

export function callBackedRuns(call: (input: unknown, opts: Record<string, unknown>) => unknown): CallBackedRuns {
  const started = new Map<string, { input: unknown; opts: Record<string, unknown> }>()
  let n = 0
  const start = vi.fn(async (input: unknown, opts: Record<string, unknown> = {}) => {
    const id = `started-${++n}`
    started.set(id, { input, opts })
    return { id }
  })
  return {
    start,
    runOf: (id, extra = {}) => ({
      ...extra,
      waitForFinish: async ({ waitSecs }: { waitSecs?: number } = {}) => {
        const s = started.get(id)
        if (!s) throw new Error(`no started run ${id}`)
        return call(s.input, { ...s.opts, waitSecs })
      },
    }),
  }
}
