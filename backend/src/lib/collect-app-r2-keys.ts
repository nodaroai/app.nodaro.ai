import { supabase } from "./supabase.js"
import { ownedJobOutputKeys, r2KeyFromUrl } from "./job-output-keys.js"
import { isOwnedObjectKey, objectKeyJobIdCandidates } from "./job-policy-outputs.js"
import { familyJobOwners, keyNamespaceOwner, keysHeldByOtherLibraryRows } from "./key-ownership.js"
import { APP_RUN_USER_CONTENT_COLUMNS } from "./app-run-content.js"
import { appRenderFinalStampOf, finalExecutionIdOf, selectWithFinalExecution } from "./app-run-final-column.js"

/**
 * Walk every R2 key referenced by an app: the app row's own media (icon,
 * preview, snapshot_nodes), every app_runs row's user-content columns
 * (`APP_RUN_USER_CONTENT_COLUMNS`: the runner's inputs, edited results and
 * run label), the linked workflow_executions node_states (the run's, its
 * Render final's, and the earlier finals of a chain, by their stamps), and the
 * linked jobs.output_data
 * (worker handlers write URLs here that don't always mirror to node_states —
 * skipping jobs would leak files past expunge). Used by the admin expunge
 * handler to prepare the batchDeleteFromR2 call.
 *
 * Keys are harvested only from rows that are the run's own: an execution its
 * runner owns, and that execution's owner's jobs (decided 2026-10-06; migration
 * 474). A run's execution ids are server-written (migration 469), but a
 * chain's earlier finals are found by their executions' stamps, which the
 * runner can write; a job row naming the execution is a pointer; and the
 * service-role read bypasses RLS. What this collects is DELETED — a planted
 * pointer would delete someone else's file. So an execution (the run's, its
 * Render final's, or an earlier final of the chain) is harvested only when it
 * is the run's runner's own, and a job only when its owner is that
 * execution's. For the same reason a job's `output_data` yields only keys in
 * that job's own key family (`isOwnedObjectKey`: `<prefix>/<jobId>` or
 * `<prefix>/<jobId>-<suffix>`): before 474 a client could insert its own job
 * as 'completed' with any output, so owning the row does not vouch for the
 * URLs in it. A job's output that names another object (an upload, a relayed
 * far-end file) is left alone. The walk and the fence are `lib/job-output-keys.ts`,
 * the same ones the retention reapers use (decided 2026-10-08).
 *
 * Whose file (decided 2026-10-06; migration 480): a url a person wrote — the
 * creator's app media, a runner's run columns (client-writable through the run
 * PATCH) — yields only objects that person made or that nobody's job made;
 * an execution's `node_states` (client-writable before 474) yield only keys in
 * the family of one of the app's own jobs. See `writtenOwnObjects` and
 * `inAppJobFamily`.
 *
 * Returns only the keys this app owns — see `appOwnedKeys`. A runner's inputs
 * can point at objects the app never made, and those are not expunge's to
 * delete. Only jobs that pass the owner check above count as this app's jobs
 * there, so a key must clear both fences to be deleted.
 *
 * `scope` narrows and widens the walk for the expunge (decided 2026-10-06):
 * a run in `skipRunIds` is still in flight and is left whole — and while any
 * run is skipped the app row stays, so its own media does too; each of
 * `extraExecutions` (an execution no run pointer names — an earlier execution
 * of a re-run run, a component's inner run — found by the expunge's
 * owner-checked walk, `lib/app-expunge-targets.ts`) is harvested with its
 * owner's jobs, when it is that owner's.
 *
 * Pages app_runs in batches of 500, and every jobs read by id, to bound memory
 * and stay under the PostgREST row cap.
 */
export interface AppR2KeyScope {
  readonly skipRunIds?: ReadonlySet<string>
  readonly extraExecutions?: ReadonlyArray<{ readonly id: string; readonly owner: string }>
}

const JOB_PAGE = 500
const EXECUTION_CHUNK = 100

interface JobRow {
  readonly id: unknown
  readonly user_id: unknown
  readonly workflow_execution_id: unknown
  readonly output_data: unknown
}

/**
 * Every job of `executionIds` (optionally only `owner`'s), keyed-paged on id: a
 * read with no limit stops at the PostgREST row cap (1000) without an error.
 */
async function jobsOfExecutions(
  executionIds: readonly string[],
  owner: string | null,
): Promise<JobRow[]> {
  const out: JobRow[] = []
  for (let i = 0; i < executionIds.length; i += EXECUTION_CHUNK) {
    const chunk = executionIds.slice(i, i + EXECUTION_CHUNK)
    let cursor: string | null = null
    while (true) {
      let q = owner
        ? supabase.from("jobs").select("id, user_id, workflow_execution_id, output_data").eq("user_id", owner).in("workflow_execution_id", chunk)
        : supabase.from("jobs").select("id, user_id, workflow_execution_id, output_data").in("workflow_execution_id", chunk)
      q = q.order("id", { ascending: true }).limit(JOB_PAGE)
      if (cursor) q = q.gt("id", cursor)
      const { data, error } = await q
      if (error) throw new Error(`collectAppR2Keys failed at jobs: ${error.message}`)
      const rows = (data ?? []) as JobRow[]
      out.push(...rows)
      if (rows.length < JOB_PAGE) break
      const last = rows[rows.length - 1]!.id
      if (typeof last !== "string") break
      cursor = last
    }
  }
  return out
}

export async function collectAppR2Keys(appId: string, scope: AppR2KeyScope = {}): Promise<string[]> {
  /** Keys in the key family of one of this app's own jobs (already fenced). */
  const jobKeys = new Set<string>()
  /** Keys found in the app's executions' node_states — fenced at the end. */
  const nodeStateKeys = new Set<string>()
  /** Keys a user wrote (the creator's app media, a runner's run columns) →
   *  the users who wrote them. Fenced at the end by whose object it is. */
  const writtenBy = new Map<string, Set<string>>()
  const appJobIds = new Set<string>()
  const skipRunIds = scope.skipRunIds ?? new Set<string>()

  const walk = (val: unknown, visit: (key: string) => void): void => {
    if (typeof val === "string") {
      const key = r2KeyFromUrl(val)
      if (key) visit(key)
    } else if (Array.isArray(val)) {
      for (const v of val) walk(v, visit)
    } else if (val && typeof val === "object") {
      for (const v of Object.values(val)) walk(v, visit)
    }
  }
  const writtenByUser = (userId: unknown) => (key: string) => {
    const writers = writtenBy.get(key) ?? new Set<string>()
    if (typeof userId === "string") writers.add(userId)
    writtenBy.set(key, writers)
  }

  // The app's own media goes with the app row, which stays while a run is skipped.
  const { data: appRow } =
    skipRunIds.size === 0
      ? await supabase.from("published_apps").select("creator_id, icon_url, preview_media_url, snapshot_nodes").eq("id", appId).single()
      : { data: null }
  if (appRow) {
    const byCreator = writtenByUser(appRow.creator_id)
    walk(appRow.icon_url, byCreator)
    walk(appRow.preview_media_url, byCreator)
    walk(appRow.snapshot_nodes, byCreator)
  }

  let cursor: string | null = null
  while (true) {
    // A run's Render final (`final_execution_id`, through the column guard)
    // is a second execution of the run: its renders are the run's too.
    const page = (columns: string) => {
      let q = supabase
        .from("app_runs")
        .select(columns)
        .eq("app_id", appId)
        .order("id", { ascending: true })
        .limit(500)
      if (cursor) q = q.gt("id", cursor)
      return q as unknown as PromiseLike<{ data: Array<Record<string, unknown>> | null; error: { code?: string | null; message?: string } | null }>
    }

    const { data, error } = await selectWithFinalExecution(["id", "runner_id", "execution_id", ...APP_RUN_USER_CONTENT_COLUMNS].join(", "), page)
    if (error) throw new Error(`collectAppR2Keys failed at runs page: ${error.message}`)
    // The select is built from a list, so the client cannot type the rows.
    const page_ = (data ?? []) as unknown as Array<Record<string, unknown>>
    if (page_.length === 0) break
    // A skipped run is still in flight: nothing of it is harvested.
    const rows = page_.filter((r) => !(typeof r.id === "string" && skipRunIds.has(r.id)))

    for (const row of rows) {
      const byRunner = writtenByUser(row.runner_id)
      for (const column of APP_RUN_USER_CONTENT_COLUMNS) walk(row[column], byRunner)
    }

    // Each execution id with the runner of every run that names it.
    const namedBy = new Map<string, Set<string>>()
    for (const r of rows) {
      const runner = r.runner_id
      if (typeof runner !== "string" || runner.length === 0) continue
      for (const id of [r.execution_id, finalExecutionIdOf(r)]) {
        if (typeof id !== "string" || id.length === 0) continue
        const runners = namedBy.get(id) ?? new Set<string>()
        runners.add(runner)
        namedBy.set(id, runners)
      }
    }
    if (namedBy.size > 0) {
      // A chain's earlier finals (decided 2026-10-06): the run links only its
      // newest; each final's stamp names the execution it continued. An
      // earlier final inherits the runners of the final that names it, so it
      // too is harvested only when it is that runner's own.
      const runExecutions = new Set(rows.map((r) => r.execution_id).filter((id): id is string => typeof id === "string"))
      const owned: Array<{ id: string; user_id: string; node_states: unknown }> = []
      const read = new Set<string>()
      let batch = [...namedBy.keys()]
      for (let step = 0; batch.length > 0 && step < 32; step++) {
        for (const id of batch) read.add(id)
        const execsRes = await supabase.from("workflow_executions").select("id, user_id, node_states, trigger_data").in("id", batch)
        if (execsRes.error) throw new Error(`collectAppR2Keys failed at executions: ${execsRes.error.message}`)
        const next = new Set<string>()
        for (const e of (execsRes.data ?? []) as Array<{ id: string; user_id: string | null; node_states: unknown; trigger_data?: unknown }>) {
          const runners = namedBy.get(e.id)
          if (typeof e.user_id !== "string" || !runners?.has(e.user_id)) continue
          owned.push({ id: e.id, user_id: e.user_id, node_states: e.node_states })
          const earlier = appRenderFinalStampOf(e.trigger_data)?.continuedFrom
          if (!earlier || read.has(earlier) || runExecutions.has(earlier)) continue
          namedBy.set(earlier, new Set([...(namedBy.get(earlier) ?? []), e.user_id]))
          next.add(earlier)
        }
        batch = [...next]
      }
      for (const e of owned) walk(e.node_states, (key) => nodeStateKeys.add(key))
      if (owned.length > 0) {
        // execution id → its owner (the runner it was harvested for). Many
        // runners' executions in one read, so no single user filter fits:
        // `user_id` is compared row by row against the execution owner.
        const ownerOf = new Map(owned.map((e) => [e.id, e.user_id] as const))
        for (const j of await jobsOfExecutions([...ownerOf.keys()], null)) {
          const owner = ownerOf.get(j.workflow_execution_id as string)
          if (owner === undefined || j.user_id !== owner || typeof j.id !== "string") continue
          const jobId = j.id
          // Only an owned job is one of this app's jobs for `appOwnedKeys`: a
          // planted job's library row must not make a key deletable.
          appJobIds.add(jobId)
          for (const key of ownedJobOutputKeys(jobId, j.output_data)) jobKeys.add(key)
        }
      }
    }

    if (page_.length < 500) break
    const lastId = page_[page_.length - 1]!.id
    if (typeof lastId !== "string") break
    cursor = lastId
  }

  // The executions no run pointer names, each only when it is its owner's.
  const byOwner = new Map<string, string[]>()
  for (const { id, owner } of scope.extraExecutions ?? []) byOwner.set(owner, [...(byOwner.get(owner) ?? []), id])
  for (const [owner, ids] of byOwner) {
    for (let i = 0; i < ids.length; i += EXECUTION_CHUNK) {
      const chunk = ids.slice(i, i + EXECUTION_CHUNK)
      const { data, error } = await supabase.from("workflow_executions").select("id, node_states").eq("user_id", owner).in("id", chunk)
      if (error) throw new Error(`collectAppR2Keys failed at executions: ${error.message}`)
      for (const e of (data ?? []) as Array<{ node_states: unknown }>) walk(e.node_states, (key) => nodeStateKeys.add(key))
    }
    for (const j of await jobsOfExecutions(ids, owner)) {
      if (typeof j.id !== "string" || j.user_id !== owner) continue
      const jobId = j.id
      appJobIds.add(jobId)
      for (const key of ownedJobOutputKeys(jobId, j.output_data)) jobKeys.add(key)
    }
  }

  // Fenced only now, once every page has added its jobs: a node state on page
  // one can name a job read on page three.
  const seen = new Set(jobKeys)
  for (const key of nodeStateKeys) {
    if (inAppJobFamily(key, appJobIds)) seen.add(key)
  }
  for (const key of await writtenOwnObjects(writtenBy, appJobIds)) seen.add(key)

  return appOwnedKeys(Array.from(seen), appJobIds)
}

/**
 * An execution's `node_states` were the runner's to write until migration 474,
 * so a url in them proves nothing about whose object it names. Only a key in
 * the key family of one of this app's own jobs (owner-checked above) is
 * collected from them (decided 2026-10-06). A node output with no job behind
 * it is left in place — kept storage, never someone else's file deleted.
 */
function inAppJobFamily(key: string, appJobIds: ReadonlySet<string>): boolean {
  return objectKeyJobIdCandidates(key).some((id) => appJobIds.has(id) && isOwnedObjectKey(id, key))
}

/**
 * The keys a user wrote (the creator's app media, a runner's run columns —
 * the latter client-writable through the run PATCH, migration 469) minus
 * every object someone else made: a key whose job, or upload namespace,
 * belongs to a user other than the one who wrote the url
 * (lib/key-ownership.ts; decided 2026-10-06). An app job's output is the
 * runner's own and passes. Throws when the lookup fails — the expunge route
 * runs this before it changes anything.
 */
async function writtenOwnObjects(
  writtenBy: ReadonlyMap<string, ReadonlySet<string>>,
  appJobIds: ReadonlySet<string>,
): Promise<string[]> {
  const keys = [...writtenBy.keys()]
  if (keys.length === 0) return []
  const makers = await familyJobOwners(keys)
  return keys.filter((key) => {
    const writers = writtenBy.get(key) ?? new Set<string>()
    const namespace = keyNamespaceOwner(key)
    if (namespace !== null && ![...writers].some((w) => w.toLowerCase() === namespace)) return false
    const maker = makers.get(key)
    if (maker === undefined || appJobIds.has(maker.jobId)) return true
    return maker.userId !== null && writers.has(maker.userId)
  })
}

/**
 * The harvested keys minus every object a library row ties to someone else.
 *
 * The harvest reads the runner's inputs, and an input can point at an object
 * the app never made: a file the runner uploaded (`POST /v1/upload` gives it
 * an `assets` row in their library, with no job), or a url they pasted —
 * their own older library item, or another user's public one. Expunge leaves
 * `assets` rows in place, so deleting such an object would break a library
 * item, still counted against its owner's storage, for a user who is not the
 * subject of the erasure — and an R2 delete cannot be undone.
 *
 * So a key stays deletable only when every `assets` row that points at it was
 * written for one of this app's own jobs (the worker files each output into
 * the runner's library). A key with no `assets` row at all is an object
 * nobody's library holds, and stays deletable. A row with no job — an upload,
 * a gallery save, or an output whose job was deleted from history (the FK is
 * ON DELETE SET NULL) — keeps the key: keeping can be revisited, deleting
 * cannot. Whether expunge should also erase the runner's own uploads, rows and
 * storage accounting included, is an open product decision.
 *
 * A failed lookup throws: this is the only proof that no other library needs
 * the object, and the route runs it before anything is changed.
 */
async function appOwnedKeys(keys: string[], appJobIds: ReadonlySet<string>): Promise<string[]> {
  const foreign = await keysHeldByOtherLibraryRows(keys, (_key, jobId) => appJobIds.has(jobId))
  return foreign.size === 0 ? keys : keys.filter((k) => !foreign.has(k))
}
