/**
 * What a completed Grok Imagine video job (`grok` / `grok-i2v`) records on its
 * output for a Grok Extend after it: its provider task, and beside it the
 * resolution its request RECORDED (`input_data.resolution`, exactly as
 * stored) — the fact a Grok Extend's charge reads off this job
 * (lib/grok-extend-source.ts), which the lanes that land the take copy onto
 * its result row so the quote reads the same fact.
 *
 * ONE definition, read in the one completion funnel (`finalizeJobWithMedia`
 * step 3c), so every lane that completes such a job records it the same way:
 * the worker, which hands the task on its output (`buildProviderMeta`), and a
 * recovery that has only the row — the reconcile cron and the stall re-pick's
 * inline reconcile, whose output carries no task. For those the task is the
 * one the row carries (`jobs.provider_task_id`), when that task is on this
 * install's KIE account ({@link taskRanOnKieHere}).
 *
 * Pure: reads nothing. Every other job gets nothing here.
 */
import { isGrokExtendSourceModel } from "@nodaro/shared/models"

/** The columns of a `jobs` row that say where its provider task lives. */
export interface JobTaskRow {
  readonly provider_task_id?: string | null
  readonly provider_kind?: string | null
  readonly relay_job_id?: string | null
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined)

/**
 * The row's task lives on this install's KIE account: not relayed through a
 * connected account (`nodaro-cloud`), nor run by another vendor. A KIE kind,
 * or none, or the pickup's `pre-task` stamp — which the task's own stamp
 * replaces best-effort, so a failed write leaves it on a finished KIE run.
 */
export function taskRanOnKieHere(row: Pick<JobTaskRow, "provider_kind" | "relay_job_id">): boolean {
  if (str(row.relay_job_id)) return false
  const kind = str(row.provider_kind)
  return kind === undefined || kind === "pre-task" || kind.startsWith("kie-")
}

/**
 * The fields a completed job adds to its output for a Grok Extend after it,
 * given the output built so far (`output`):
 *
 * - only for a video result (`video`) of a Grok Imagine video job — the model
 *   its request recorded (`provider`, else `resolvedModel`), trimmed;
 * - with a provider task: the output's own (`kieTaskId`, as the worker hands
 *   it), else the row's KIE task (a recovery's), which is then added as the
 *   worker would add it (`providerTaskId` + `kieTaskId`);
 * - `recordedResolution` beside that task when the request recorded a
 *   non-empty string resolution.
 *
 * Empty for every other job, and for one without a task.
 */
export function grokSourceOutputFields(args: {
  readonly video: boolean
  readonly inputData: Record<string, unknown> | null | undefined
  readonly output: Record<string, unknown>
  readonly row: JobTaskRow
}): Record<string, string> {
  const input = args.inputData ?? {}
  const model = input.provider ?? input.resolvedModel
  if (!args.video || !isGrokExtendSourceModel(typeof model === "string" ? model.trim() : model)) return {}
  const ownTask = typeof args.output.kieTaskId === "string" && args.output.kieTaskId !== "" ? args.output.kieTaskId : undefined
  const rowTask = ownTask === undefined && taskRanOnKieHere(args.row) ? str(args.row.provider_task_id) : undefined
  if (ownTask === undefined && rowTask === undefined) return {}
  const recordedResolution = input.resolution
  return {
    ...(rowTask !== undefined ? { providerTaskId: rowTask, kieTaskId: rowTask } : {}),
    ...(typeof recordedResolution === "string" && recordedResolution !== "" ? { recordedResolution } : {}),
  }
}
