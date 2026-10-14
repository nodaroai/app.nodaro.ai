/**
 * A run CONTINUED from an earlier execution (`continueFromExecutionId` on
 * `POST /v1/workflows/:id/run`): the nodes it does not run hand on what that
 * execution produced, never the workflow's saved results. Render final after a
 * run that stopped at a preview is one, and an app's Render final runs as one,
 * outside the app run.
 *
 * The stable codes a continuation is refused with. A client branches on the
 * code, never on the text.
 */

/** The execution does not exist, or the caller did not start it. */
export const CONTINUATION_NOT_FOUND = "continuation_not_found"

/** The execution ran another workflow. */
export const CONTINUATION_WORKFLOW_MISMATCH = "continuation_workflow_mismatch"

/** The execution ran another version of the graph: a published app version
 *  where this run uses the live workflow, or the reverse, or another version. */
export const CONTINUATION_VERSION_MISMATCH = "continuation_version_mismatch"

/** The execution has not ended `completed` (it is still running, or it
 *  failed or was cancelled). */
export const CONTINUATION_NOT_COMPLETED = "continuation_not_completed"

/** A continuation names the nodes it runs (`nodeIds`); every other node hands
 *  on the execution's output. */
export const CONTINUATION_SUBSET_REQUIRED = "continuation_subset_required"

/** A continue-from-failed run (use-case nodes) needs an execution that ended
 *  `failed`: a completed run has nothing to resume, a running one is not over. */
export const CONTINUATION_NOT_FAILED = "continuation_not_failed"

/** A continue-from-failed (use-case nodes) of a run a later continuation of
 *  it has superseded — that later one failed too: continue it instead. */
export const CONTINUATION_SUPERSEDED = "continuation_superseded"

/** A continue-from-failed (use-case nodes) of a failed run whose wrapper is not
 *  settled yet (its fee not yet refunded): ask again in a moment. A retry
 *  answer, not a refusal — outside `RUN_CONTINUATION_CODES`. */
export const CONTINUATION_SETTLING = "continuation_settling"

/** A Render final (use-case nodes) of a preview with the very edit a COMPLETED
 *  final of it already rendered (decided 2026-10-13): nothing would change, so
 *  nothing runs — the answer names that final. A changed edit renders again. */
export const RENDER_FINAL_ALREADY_RENDERED = "render_final_already_rendered"
export const RENDER_FINAL_ALREADY_RENDERED_MESSAGE = "Already rendered with this edit."

/** Every continuation refusal code. */
export const RUN_CONTINUATION_CODES = [
  CONTINUATION_NOT_FOUND,
  CONTINUATION_WORKFLOW_MISMATCH,
  CONTINUATION_VERSION_MISMATCH,
  CONTINUATION_NOT_COMPLETED,
  CONTINUATION_SUBSET_REQUIRED,
  CONTINUATION_NOT_FAILED,
  CONTINUATION_SUPERSEDED,
] as const

export type RunContinuationCode = (typeof RUN_CONTINUATION_CODES)[number]
