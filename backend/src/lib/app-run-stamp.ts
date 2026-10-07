/**
 * Which app run an execution was started for (decided 2026-10-06).
 *
 * `app_runs.execution_id` names a run's CURRENT execution only. A run that is
 * re-run (Retry / re-run in the app runner, the draft lane of
 * `POST /v1/app/:slug/run`) gets a new execution and the pointer moves to it,
 * so nothing pointed at the earlier one any more — and the admin expunge,
 * which finds a run's executions through its pointers, left the earlier
 * executions' results and their jobs' prompts in place.
 *
 * So every execution an app run starts is stamped, at insert, with the run it
 * belongs to (`workflow_executions.trigger_data.appRun.appRunId`): the first
 * one (`executeAppRun`, which picks the run's id before either row exists) and
 * every re-run (the draft lane). A Render final carries its own stamp naming
 * the run (`appRenderFinal.appRunId`, `lib/app-run-final-column.ts`). Reading
 * by stamp finds every execution of a run, whatever the pointers say now.
 *
 * The stamp is a pointer like the others: a reader takes a stamped execution
 * only when it is the run's runner's own run of the app's workflow
 * (`executionBelongsToRun`).
 *
 * Executions started before this stamp existed carry none; a re-run's earlier
 * execution from before then is not findable this way.
 */

const STAMP_KEY = "appRun"

/** The `trigger_data` an app run's execution is created with. */
export function appRunStamp(appRunId: string): { appRun: { appRunId: string } } {
  return { [STAMP_KEY]: { appRunId } } as { appRun: { appRunId: string } }
}

/** The run a `trigger_data` value names, or `null` when it carries no app-run stamp. */
export function appRunStampOf(triggerData: unknown): string | null {
  if (typeof triggerData !== "object" || triggerData === null || Array.isArray(triggerData)) return null
  const stamp = (triggerData as Record<string, unknown>)[STAMP_KEY]
  if (typeof stamp !== "object" || stamp === null || Array.isArray(stamp)) return null
  const id = (stamp as Record<string, unknown>).appRunId
  return typeof id === "string" && id.length > 0 ? id : null
}

/** PostgREST filter path to the run an app run's execution is stamped with. */
export const APP_RUN_STAMP_PATH = `trigger_data->${STAMP_KEY}->>appRunId`

/** PostgREST filter path to the run a Render final's execution is stamped with. */
export const APP_RENDER_FINAL_STAMP_PATH = "trigger_data->appRenderFinal->>appRunId"
