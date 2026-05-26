import { AsyncLocalStorage } from "node:async_hooks"

/**
 * Per-pipeline-run async context. Carries an `AbortSignal` that any
 * downstream LLM / HTTP call inside the pipeline-worker can subscribe
 * to without having to thread the signal through 10+ function
 * signatures (engine → stage → LLM helper → callLLM).
 *
 * Set ONCE in `pipeline-worker.ts` per BullMQ job. Read from anywhere
 * downstream via `getPipelineSignal()`. Returns `undefined` outside of
 * a pipeline-worker job (the orchestrator-worker process, API routes,
 * tests, etc.) so callers just no-op the abort wiring when there's no
 * active pipeline context.
 *
 * Why ALS instead of explicit signal threading:
 *   - Adding `signal` to every helper signature touches ~10 files and
 *     leaks an implementation detail (cancellation) into pure-logic
 *     LLM call helpers that have no business knowing about it.
 *   - ALS is the standard Node mechanism for "ambient" request context
 *     (Fastify uses it for `requestContext`, OpenTelemetry for spans).
 *   - All `await`s preserve the ALS frame, so the signal is reachable
 *     anywhere in the async tree without further plumbing.
 */
export interface PipelineRunContext {
  signal: AbortSignal
  pipelineId: string
}

export const pipelineContext = new AsyncLocalStorage<PipelineRunContext>()

/**
 * Returns the in-flight pipeline's abort signal, or `undefined` when
 * called outside a pipeline-worker job. Pass the result directly to
 * Anthropic SDK / fetch / etc. as their `signal` option.
 */
export function getPipelineSignal(): AbortSignal | undefined {
  return pipelineContext.getStore()?.signal
}

/**
 * Returns the in-flight pipeline's id, or `undefined`. Useful for
 * structured-logging breadcrumbs without an explicit param.
 */
export function getPipelineId(): string | undefined {
  return pipelineContext.getStore()?.pipelineId
}
