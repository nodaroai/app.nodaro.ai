/**
 * Which run the editor's "Continue from failed" button continues: the open
 * workflow's NEWEST run (the first page of its run list, newest first, the
 * Executions tab's own cache entry), when that run FAILED. A run that ended any
 * other way since (completed, cancelled, still going) means there is nothing
 * to continue from the canvas: continuing an older failure would run again
 * what the newer run did. A single-node job listed beside the runs is not a
 * run of the workflow and is passed over, and an app's run ran a published
 * version, which a run of the live workflow cannot continue.
 *
 * The server stays the authority: a newer continuation of the same run
 * decides there (`continuation_superseded`, `continuation_preview_pending`).
 */

/** The fields of a listed run this reads. */
export interface ListedRunLike {
  readonly id: string
  readonly kind?: string
  readonly status: string
  readonly triggerType?: string
}

/** The trigger lanes whose runs ran a published app version, not the live workflow. */
const OTHER_VERSION_LANES: ReadonlySet<string> = new Set(["app_run"])

/** The id of the run to continue, or `null`. Pure. */
export function continuableFailedRun(rows: readonly ListedRunLike[] | null | undefined): string | null {
  const newest = (rows ?? []).find((row) => row.kind !== "job")
  if (!newest || newest.status !== "failed") return null
  if (newest.triggerType && OTHER_VERSION_LANES.has(newest.triggerType)) return null
  return newest.id
}
