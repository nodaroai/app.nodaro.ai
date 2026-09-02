/**
 * `llm-structured` — the async twin of POST /v1/llm/structured. The route
 * (`routes/llm-structured-jobs.ts`) inserted the row, reserved the LLM
 * credits and, for a movie run, created a `video-analysis` child through the
 * analysis route; this handler waits for the child, composes the input, runs
 * the completion and completes the row. Handler body: see below (Task 6).
 */
import type { LlmStructuredBody } from "../../lib/llm-structured-request.js"

/** The BullMQ `job.data` the route enqueues and this handler reads. The full
 *  `system` / `jsonSchema` ride HERE, not on the row (the row stores a digest
 *  and a size — a 100k-char prompt per row is not something to store; a
 *  1000-entry `removeOnComplete` window in Redis is). */
export interface LlmStructuredJobPayload extends LlmStructuredBody {
  jobId: string
  usageLogId?: string | null
  /** Set by the route for movie runs: the `video-analysis` child to wait on. */
  analysisJobId?: string
}
