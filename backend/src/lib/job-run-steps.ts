/**
 * A job's STEPS: the child jobs a worker-side handler ran for it
 * (`parent_job_id`, `tk.http.workerRequest` — a Cast Swap run's reference
 * preparation, its mask, its video), their children, and so on. Each step is
 * billed on its own usage log, so a run's charge is its own plus its steps'
 * (lib/job-credit-status.ts `runCreditsFor`, the one reader).
 *
 * One read per level of the tree (in batches of ids), never one per job. The
 * walk stops after `MAX_CHILD_JOB_DEPTH` levels and never expands a job twice,
 * so a bad loop in `parent_job_id` cannot run away. A job in the Trash is still
 * a step: totals of credits spent count it until the purge (TRASHED_JOB_COLUMN).
 *
 * A row that is itself one of the asked-for jobs (an admin list shows a parent
 * and its child side by side) is a step of its ancestor AND has its own steps:
 * each asked-for job gets every job below it.
 *
 * The owner filter is part of the QUERY (each asked-for job names its owner;
 * a step is read as its parent's owner's): another user's row is never read,
 * whatever `parent_job_id` it carries (migration 480 also keeps a child with
 * its parent's owner).
 *
 * Without credits there is nothing to sum and nothing is read.
 */
import { supabase } from "./supabase.js"
import { hasCredits } from "./config.js"
import { CHILD_JOB_COLUMN, MAX_CHILD_JOB_DEPTH } from "./public-job-data.js"

/** What a run's charge reads off one step. */
export interface RunStepRow {
  id: string
  parent_job_id: string | null
  usage_log_id: string | null
  /** The step's hold (`jobs.credits`). */
  credits: number | null
  /** Its owner: a row that is not its parent's owner's is dropped (defence in depth beside the query filter). */
  user_id?: string | null
}

/** Every step below each asked-for job, and which jobs' steps could not all be read. */
export interface RunSteps {
  steps: ReadonlyMap<string, readonly RunStepRow[]>
  /**
   * Asked-for jobs whose steps are NOT all known: a read below them failed.
   * Their figures must read as unknown (never a lower number), and a workflow
   * total must read them again rather than keep a partial figure.
   */
  incomplete: ReadonlySet<string>
}

/** Ids per request — the `parent_job_id` list and the owners together (what the gateway reliably accepts). */
const IN_BATCH = 200

/** One job to walk below, and whose it is. */
export interface RunStepRoot {
  id: string
  owner: string
}

/**
 * The frontier in requests: grouped by owner, packed so each request's parent
 * ids and owner ids together stay within `IN_BATCH` (an admin page mixes many
 * owners; a user's page has one).
 */
function packByOwner(frontier: readonly RunStepRoot[]): Array<{ owners: string[]; ids: string[] }> {
  const sorted = [...frontier].sort((a, b) => (a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0))
  const chunks: Array<{ owners: string[]; ids: string[] }> = []
  let current: { owners: string[]; ids: string[] } | null = null
  for (const { id, owner } of sorted) {
    const newOwner = !current || current.owners[current.owners.length - 1] !== owner
    if (!current || current.ids.length + current.owners.length + (newOwner ? 1 : 0) + 1 > IN_BATCH) {
      current = { owners: [owner], ids: [] }
      chunks.push(current)
    } else if (newOwner) {
      current.owners.push(owner)
    }
    current.ids.push(id)
  }
  return chunks
}

/**
 * Every step below each of `jobs`, by job id. A job with no steps is absent.
 * A step is read as its parent's owner's only. A read that fails is logged,
 * never thrown (a display figure never fails the request that shows it), and
 * every asked-for job above that batch is reported in `incomplete`.
 */
export async function runStepsOf(jobs: readonly RunStepRoot[]): Promise<RunSteps> {
  const ownerOf = new Map<string, string>()
  for (const j of jobs) if (j?.id && j.owner && !ownerOf.has(j.id)) ownerOf.set(j.id, j.owner)
  const roots = [...ownerOf.keys()]
  const out = new Map<string, RunStepRow[]>()
  const incomplete = new Set<string>()
  if (roots.length === 0 || !hasCredits()) return { steps: out, incomplete }
  const asked = new Set(roots)

  const read = new Map<string, RunStepRow>()
  const expanded = new Set<string>()
  let level: RunStepRoot[] = roots.map((id) => ({ id, owner: ownerOf.get(id)! }))
  for (let depth = 1; depth <= MAX_CHILD_JOB_DEPTH && level.length > 0; depth++) {
    for (const { id } of level) expanded.add(id)
    const next: RunStepRoot[] = []
    for (const chunk of packByOwner(level)) {
      // A batch that cannot be read leaves every asked-for job above it unknown.
      const failed = (why: string) => {
        console.error(`[job-run-steps] could not read the steps of ${chunk.ids.length} job(s): ${why}`)
        for (const id of chunk.ids) {
          const seen = new Set<string>()
          let at: string | null = id
          while (at && !seen.has(at)) {
            seen.add(at)
            if (asked.has(at)) incomplete.add(at)
            at = read.get(at)?.parent_job_id ?? null
          }
        }
      }
      try {
        // trash-read: a run's charge counts a step in the Trash until the purge.
        const query = supabase
          .from("jobs")
          .select("id, parent_job_id, usage_log_id, credits, user_id")
        const owned = chunk.owners.length === 1 ? query.eq("user_id", chunk.owners[0]!) : query.in("user_id", chunk.owners)
        const { data, error } = await owned.in(CHILD_JOB_COLUMN, chunk.ids)
        if (error) {
          failed(error.message)
          continue
        }
        for (const row of (data ?? []) as RunStepRow[]) {
          if (!row?.id || read.has(row.id)) continue
          const owner = row.parent_job_id ? ownerOf.get(row.parent_job_id) : undefined
          if (!owner) continue
          // Defence in depth: the query is owner-scoped, and a step is its parent's owner's.
          if (row.user_id != null && row.user_id !== owner) continue
          read.set(row.id, row)
          if (!ownerOf.has(row.id)) ownerOf.set(row.id, owner)
          if (!expanded.has(row.id)) next.push({ id: row.id, owner })
        }
      } catch (err) {
        failed(err instanceof Error ? err.message : String(err))
      }
    }
    level = next
  }

  // Each step belongs to every asked-for job above it.
  for (const step of read.values()) {
    const seen = new Set<string>([step.id])
    let parent = step.parent_job_id
    while (parent && !seen.has(parent)) {
      seen.add(parent)
      if (asked.has(parent)) {
        const list = out.get(parent)
        if (list) list.push(step)
        else out.set(parent, [step])
      }
      parent = read.get(parent)?.parent_job_id ?? null
    }
  }
  return { steps: out, incomplete }
}
