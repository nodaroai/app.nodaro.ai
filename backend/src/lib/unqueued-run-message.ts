/**
 * What a workflow run says when the queue refused to start it and it was
 * failed at once (`workflow_executions.error_message`), kept apart from
 * lib/enqueue-execution.ts so the use-case wrapper's finaliser can recognise
 * such a run without loading the queue helpers.
 *
 * A run failed with this message never ran, so its use-case wrapper (the job
 * the caller holds) is failed with its Idempotency-Key released in the same
 * write: a retry with the same key starts a new run instead of being answered
 * with the dead wrapper (lib/use-case/finalize-wrapper.ts).
 */
export const UNQUEUED_EXECUTION_MESSAGE = "The run could not be queued to start. Run it again."
