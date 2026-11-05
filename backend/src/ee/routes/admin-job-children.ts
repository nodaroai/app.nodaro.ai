/**
 * A job's child jobs for the admin job page (`GET /v1/admin/jobs/:jobId/children`):
 * every step a worker-side handler ran for it (`parent_job_id` — a Cast Swap
 * run's reference preparation, its mask, its video), their children, and so on.
 *
 * One read per level of the tree (in batches of parent ids), never one per job,
 * like the run's charge (lib/job-run-steps.ts). The walk stops after
 * `MAX_CHILD_JOB_DEPTH` levels, never reads a job twice, and stops at
 * `MAX_ADMIN_CHILD_JOBS` rows (then `truncated`), so a bad loop in
 * `parent_job_id` cannot run away. A child is read as its root's owner's only:
 * the owner filter is part of the query (migration 480 keeps a child with its
 * parent's owner).
 *
 * The rows come back in FLOW order: depth first, each job followed by its own
 * children, siblings oldest first — the order the run did its work in.
 */
import { supabase } from "../../lib/supabase.js"
import { CHILD_JOB_COLUMN, MAX_CHILD_JOB_DEPTH } from "../../lib/public-job-data.js"

/** The most child jobs one page lists. */
export const MAX_ADMIN_CHILD_JOBS = 200

/** Parent ids per request. */
const IN_BATCH = 150

export type ChildRow = Record<string, unknown> & {
  id: string
  parent_job_id: string | null
  created_at?: string | null
}

export interface ChildJobs {
  /** The child jobs in flow order, each with its depth below the root (1 = a direct child). */
  rows: Array<ChildRow & { depth: number }>
  /** True when the tree has more jobs than `MAX_ADMIN_CHILD_JOBS` or goes deeper than `MAX_CHILD_JOB_DEPTH`. */
  truncated: boolean
}

/**
 * Every job below `root`, read with `columns` (which must include
 * `parent_job_id` and `created_at`). Throws when a read fails: the page says
 * it could not load the child jobs rather than show part of the flow as whole.
 */
export async function adminChildJobs(
  root: { id: string; user_id: string },
  columns: string,
  limit = MAX_ADMIN_CHILD_JOBS,
): Promise<ChildJobs> {
  const read = new Map<string, ChildRow>()
  let level = [root.id]
  let truncated = false
  for (let depth = 1; level.length > 0; depth++) {
    if (depth > MAX_CHILD_JOB_DEPTH) {
      // Past the deepest level listed: cut short only if a job there really has a child.
      truncated = await anyChildOf(root.user_id, level)
      break
    }
    const next: string[] = []
    for (let i = 0; i < level.length; i += IN_BATCH) {
      const room = limit - read.size
      if (room <= 0) {
        truncated = true
        break
      }
      // Admin read: a child in the Trash is still a step of the run.
      const { data, error } = await supabase
        .from("jobs")
        .select(columns)
        .eq("user_id", root.user_id)
        .in(CHILD_JOB_COLUMN, level.slice(i, i + IN_BATCH))
        .order("created_at", { ascending: true })
        .limit(room + 1)
      if (error) throw error
      const rows = (data ?? []) as unknown as ChildRow[]
      if (rows.length > room) truncated = true
      for (const row of rows.slice(0, room)) {
        if (!row?.id || row.id === root.id || read.has(row.id)) continue
        read.set(row.id, row)
        next.push(row.id)
      }
    }
    level = next
  }
  return { rows: flowOrder(root.id, [...read.values()]), truncated }
}

/** Whether any of `parents` (the owner's) has a child job: one row is enough. */
async function anyChildOf(owner: string, parents: readonly string[]): Promise<boolean> {
  for (let i = 0; i < parents.length; i += IN_BATCH) {
    // Admin read: a child in the Trash is still a step of the run.
    const { data, error } = await supabase
      .from("jobs")
      .select("id")
      .eq("user_id", owner)
      .in(CHILD_JOB_COLUMN, parents.slice(i, i + IN_BATCH))
      .limit(1)
    if (error) throw error
    if ((data ?? []).length > 0) return true
  }
  return false
}

/** Depth first from `rootId`: each job, then its children oldest first. */
export function flowOrder(rootId: string, rows: readonly ChildRow[]): Array<ChildRow & { depth: number }> {
  const byParent = new Map<string, ChildRow[]>()
  for (const row of rows) {
    const parent = row.parent_job_id ?? ""
    const list = byParent.get(parent)
    if (list) list.push(row)
    else byParent.set(parent, [row])
  }
  const time = (row: ChildRow) => (typeof row.created_at === "string" ? Date.parse(row.created_at) || 0 : 0)
  for (const list of byParent.values()) list.sort((a, b) => time(a) - time(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const out: Array<ChildRow & { depth: number }> = []
  const seen = new Set<string>([rootId])
  const visit = (parent: string, depth: number) => {
    for (const row of byParent.get(parent) ?? []) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      out.push({ ...row, depth })
      visit(row.id, depth + 1)
    }
  }
  visit(rootId, 1)
  return out
}
