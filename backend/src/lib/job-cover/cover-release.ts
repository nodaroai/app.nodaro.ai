/**
 * The covers a delete or a clear is about to orphan (review round, decided
 * 2026-11-23): a job's cover copy (`job-covers/<userId>/…`) is recorded only
 * in its `jobs.cover_url`, so whatever removes that value — a permanent job
 * delete (the Trash's "delete forever", its 30-day purge, a trend run's
 * delete), a workflow or project delete that cascades its jobs away, an app
 * expunge that clears the column — reads the covers FIRST and releases them
 * after (lib/job-cover/cover-store.ts `releaseCoversOfJobs`: each owner's,
 * only once nothing names them).
 *
 * Reading never blocks the delete: a failed read is logged and answers no
 * covers (the copies stay in storage, the job still goes). The column is
 * asked about only once this database has it — and a caller that must not
 * miss it at boot (the expunge, which may run before the column's first
 * probe) passes `probe: true`.
 */
import { supabase } from "../supabase.js"
import { coverColumnPresent, probeCoverColumn } from "../jobs-cover-column.js"
import type { ReleasedJobCover } from "./cover-store.js"

export type CoverScope =
  | { readonly jobIds: readonly string[] }
  | { readonly workflowId: string; readonly userId: string }
  | { readonly projectId: string; readonly userId: string }

const CHUNK = 100

interface Logger {
  warn(fields: Record<string, unknown>, message: string): void
}

/** The workflow ids of a project (the owner's), or null when they cannot be read. */
async function projectWorkflowIds(projectId: string, userId: string): Promise<string[] | null> {
  const { data, error } = await supabase.from("workflows").select("id").eq("project_id", projectId).eq("user_id", userId)
  if (error) return null
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
}

/** One read of the covers of jobs whose `column` is among `ids`. */
async function coversWhere(column: "id" | "workflow_id", ids: readonly string[], userId?: string): Promise<ReleasedJobCover[] | null> {
  const out: ReleasedJobCover[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const base = supabase
      .from("jobs")
      // trash-read: the covers of jobs about to be deleted or erased, Trash included.
      .select("user_id, cover_url")
      .in(column, ids.slice(i, i + CHUNK) as string[])
      .not("cover_url", "is", null)
    const { data, error } = await (userId ? base.eq("user_id", userId) : base)
    if (error) return null
    for (const row of (data ?? []) as Array<{ user_id: string | null; cover_url: string | null }>) {
      out.push({ userId: row.user_id, coverUrl: row.cover_url })
    }
  }
  return out
}

/**
 * The covers of the jobs in `scope`, with their owners. Never throws: a read
 * that fails is logged and answers none.
 */
export async function readCoversInScope(scope: CoverScope, opts: { probe?: boolean; logger?: Logger } = {}): Promise<ReleasedJobCover[]> {
  try {
    if (!coverColumnPresent() && !(opts.probe && (await probeCoverColumn()))) return []
    let covers: ReleasedJobCover[] | null
    if ("jobIds" in scope) covers = scope.jobIds.length > 0 ? await coversWhere("id", scope.jobIds) : []
    else if ("workflowId" in scope) covers = await coversWhere("workflow_id", [scope.workflowId], scope.userId)
    else {
      const workflows = await projectWorkflowIds(scope.projectId, scope.userId)
      covers = workflows === null ? null : await coversWhere("workflow_id", workflows, scope.userId)
    }
    if (covers === null) throw new Error("cover read failed")
    return covers
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (opts.logger) opts.logger.warn({ err: message }, "job covers not read before the delete: their copies stay in storage")
    else console.warn("[job-cover] covers not read before the delete; their copies stay in storage:", message)
    return []
  }
}
