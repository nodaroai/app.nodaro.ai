import { supabase } from "./supabase.js"
import { workflowAccess } from "./workflow-access.js"
import {
  jobRowNeedsRunRelation,
  jobRowProviderWordsTo,
  runIdOf,
  runStatesNeedReaderRelation,
  webhookBodyNeedsRunRelation,
  type ProviderWordsReader,
} from "./provider-words.js"

/**
 * Who may read a RUN's provider words (lib/provider-words.ts): the lookups the
 * funnel itself never makes, kept here so the funnel stays free of database
 * reads (every job read imports it).
 *
 * A run's node states carry each failed node's `errorDetail`, which can quote
 * the prompt of the workflow the run executed — so a run is read with its
 * words only by a reader who can open that workflow (its creator; with
 * workspaces, a member it is shared with), or an admin. The person who ran
 * someone else's share link or published app owns the run but cannot open the
 * workflow, and so never reads them. A share link's own reads go further, by
 * decision: the workflow's creator only (`readerCreatedWorkflow`).
 *
 * A run's JOBS are judged by the same workflow (decided 2026-11-11): the job
 * of a run (`jobs.workflow_execution_id` set) belongs to whoever started the
 * run, so its owner reads its words only when they can open the run's
 * workflow (`runJobsProviderWords`). A job with no run is its owner's, as
 * before, and so is the job of a run that names no workflow (the inner run a
 * use-case node starts): its row does not say which workflow it served.
 *
 * Every lookup is made only when its answer can change a response (a state or
 * a run's job carries words, the reader is not an admin, and the deployment
 * lets such a reader read them); otherwise none is made and the response is
 * exactly what it was. A lookup that fails counts as "may not read": the words
 * are display only, and a missed one returns on the next read.
 */

/** Can this reader open this workflow (any access but none)? False when it cannot be told. */
export async function readerCanOpenWorkflow(readerId: string, workflowId: unknown): Promise<boolean> {
  if (typeof workflowId !== "string" || workflowId === "") return false
  try {
    return (await workflowAccess(readerId, workflowId)) !== "none"
  } catch {
    return false
  }
}

/** Which of these workflows the reader can open, each looked up once. */
export async function workflowsReaderCanOpen(readerId: string, workflowIds: Iterable<unknown>): Promise<Set<string>> {
  const ids = [...new Set([...workflowIds].filter((id): id is string => typeof id === "string" && id !== ""))]
  const answers = await Promise.all(ids.map(async (id) => [id, await readerCanOpenWorkflow(readerId, id)] as const))
  return new Set(answers.filter(([, open]) => open).map(([id]) => id))
}

/** Did this reader create this workflow? False when it cannot be told. */
export async function readerCreatedWorkflow(readerId: string, workflowId: unknown): Promise<boolean> {
  if (typeof workflowId !== "string" || workflowId === "") return false
  // A lookup that throws means "not the creator", as readerCanOpenWorkflow treats one: the words stay withheld.
  try {
    const { data, error } = await supabase
      // tenant-scope-ignore: reads a workflow's creator in order to compare it with the reader.
      .from("workflows")
      .select("user_id")
      .eq("id", workflowId)
      .maybeSingle()
    if (error || !data) return false
    return (data as { user_id?: unknown }).user_id === readerId
  } catch {
    return false
  }
}

/** The columns a run is judged by: whose it is, the workflow it names, and its lane and `trigger_data` (its stamps). */
export const RUN_RELATION_COLUMNS = "id, user_id, workflow_id, trigger_type, trigger_data"

/** A run as read back with `RUN_RELATION_COLUMNS` (or more: a whole row). */
export interface RunRelationRow {
  readonly id: string
  readonly user_id?: unknown
  readonly workflow_id?: unknown
  readonly trigger_type?: unknown
  readonly trigger_data?: unknown
}

/**
 * THE run rule, for a run's states and its jobs alike (decided 2026-11-11):
 * which of these runs' provider words this reader may read.
 *
 *  - A run that names a workflow: when the reader can open that workflow.
 *  - A run that names none — the inner run a use-case node starts outside any
 *    workflow run (a standalone use-case job) — is its owner's, as a job with
 *    no run is.
 *
 * One access lookup per distinct workflow. A lookup that fails withholds.
 */
export async function runsWordsReadable(readerId: string, runs: readonly RunRelationRow[]): Promise<Set<string>> {
  const openable = await workflowsReaderCanOpen(readerId, runs.map((run) => run.workflow_id))
  const readable = runs.filter((run) => {
    if (typeof run.workflow_id === "string" && run.workflow_id !== "") return openable.has(run.workflow_id)
    return run.workflow_id == null && run.user_id === readerId
  })
  return new Set(readable.map((run) => run.id))
}

/** `runsWordsReadable` for one run. */
export async function runWordsReadable(readerId: string, run: RunRelationRow): Promise<boolean> {
  return (await runsWordsReadable(readerId, [run])).has(run.id)
}

/**
 * The reader of one run's states, by the run rule (`runsWordsReadable`),
 * looked up only when `states` carry words a non-admin reader could be shown.
 * (`canRead: true` otherwise, which then changes nothing.) `run` is the run's
 * row as read back.
 */
export async function runStatesReader(
  states: unknown,
  reader: { readonly isAdmin: boolean; readonly userId: string; readonly run: RunRelationRow },
): Promise<ProviderWordsReader> {
  if (!runStatesNeedReaderRelation(states, reader.isAdmin)) return { isAdmin: reader.isAdmin, canRead: true }
  return { isAdmin: reader.isAdmin, canRead: await runWordsReadable(reader.userId, reader.run) }
}

/**
 * Which of these runs — the reader's own (a run's jobs are its owner's,
 * migration 474) — have jobs whose words the reader may read: one read of the
 * runs, then the run rule (`runsWordsReadable`), the same one a read of the
 * run's own states asks. A run that cannot be read is not in the set.
 */
export async function runsReaderMayRead(readerId: string, runIds: Iterable<string>): Promise<Set<string>> {
  const ids = [...new Set(runIds)]
  if (ids.length === 0) return new Set()
  let runs: RunRelationRow[]
  try {
    const { data, error } = await supabase
      .from("workflow_executions")
      .select(RUN_RELATION_COLUMNS)
      .in("id", ids)
      .eq("user_id", readerId)
    if (error) return new Set()
    runs = (data ?? []) as unknown as RunRelationRow[]
  } catch {
    return new Set()
  }
  return runsWordsReadable(readerId, runs)
}

/**
 * Job rows, each read with its `workflow_execution_id`, as this reader may
 * read them: a run's job keeps its words only when the reader can open the
 * run's workflow (or is an admin); a job with no run is judged as before, by
 * the read that returned it. The relation is looked up only for the rows that
 * need it (`jobRowNeedsRunRelation`), once per distinct run and workflow.
 *
 * The run id is read for this alone: it is taken off every row, so no answer
 * carries a key it did not carry before. A row that never had it is returned
 * as it came.
 */
export async function runJobsProviderWords<T extends object>(
  rows: readonly T[],
  reader: { readonly isAdmin: boolean; readonly userId: string },
): Promise<T[]> {
  const needing = rows.filter((row) => jobRowNeedsRunRelation(row, reader.isAdmin))
  const openable = needing.length > 0 ? await runsReaderMayRead(reader.userId, needing.map((row) => runIdOf(row)!)) : new Set<string>()
  return rows.map((row) => {
    const judged = jobRowNeedsRunRelation(row, reader.isAdmin)
      ? jobRowProviderWordsTo(row, { isAdmin: reader.isAdmin, canRead: openable.has(runIdOf(row)!) })
      : row
    if (!("workflow_execution_id" in judged)) return judged
    const { workflow_execution_id: _run, ...rest } = judged as Record<string, unknown>
    return rest as T
  })
}

/**
 * The jobs, among these recorded webhook deliveries, whose kept body may NOT
 * carry its job's words: the job belongs to a run of a workflow its owner (the
 * endpoint's owner) cannot open. Looked up only for the bodies that carry words
 * a reader could be shown (`webhookBodyNeedsRunRelation`): one read of their
 * jobs, then `runsReaderMayRead`. A job that cannot be read is withheld.
 */
export async function webhookJobsWithheld(
  ownerId: string,
  deliveries: ReadonlyArray<{ readonly job_id: string | null; readonly payload: unknown }>,
): Promise<Set<string>> {
  const jobIds = [...new Set(deliveries.filter((d) => d.job_id && webhookBodyNeedsRunRelation(d.payload)).map((d) => d.job_id!))]
  if (jobIds.length === 0) return new Set()
  let jobs: Array<{ id: string; workflow_execution_id: unknown }>
  try {
    const { data, error } = await supabase
      // trash-read: reads only the run of jobs whose delivery log is already shown; a job in the Trash is still judged by its run.
      .from("jobs")
      .select("id, workflow_execution_id")
      .in("id", jobIds)
      .eq("user_id", ownerId)
    if (error) return new Set(jobIds)
    jobs = (data ?? []) as Array<{ id: string; workflow_execution_id: unknown }>
  } catch {
    return new Set(jobIds)
  }
  const runOf = new Map(jobs.map((job) => [job.id, runIdOf(job)]))
  const openable = await runsReaderMayRead(ownerId, [...runOf.values()].filter((id): id is string => id !== null))
  // A job with no run is its owner's; one not found (or of a run not openable) is withheld.
  return new Set(jobIds.filter((id) => {
    if (!runOf.has(id)) return true
    const run = runOf.get(id)!
    return run !== null && !openable.has(run)
  }))
}

/**
 * Whether ONE recorded webhook body of this job may carry its job's words —
 * the retry's question, when the job's run is already known (`runId`, null for
 * a job with no run). Looks the run up only when the body carries words a
 * reader could be shown and the job has a run.
 */
export async function webhookBodyCanRead(ownerId: string, body: unknown, runId: string | null): Promise<boolean> {
  if (runId === null || !webhookBodyNeedsRunRelation(body)) return true
  return (await runsReaderMayRead(ownerId, [runId])).has(runId)
}
