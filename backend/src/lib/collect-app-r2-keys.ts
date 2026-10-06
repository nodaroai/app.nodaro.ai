import { supabase } from "./supabase.js"
import { r2KeyFromUrl } from "../ee/billing/cleanup-service.js"
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
 * A run's execution ids are server-written (migration 469), but a chain's
 * earlier finals are found by their executions' stamps, which the runner can
 * write; and the service-role read bypasses RLS. So an execution — and its
 * jobs — is harvested only when it is the run's runner's own: a run pointing at another user's execution must not get that
 * user's media deleted with this app (decided 2026-10-06).
 *
 * Returns only the keys this app owns — see `appOwnedKeys`. A runner's inputs
 * can point at objects the app never made, and those are not expunge's to
 * delete. The app's own jobs are the jobs of the executions harvested above.
 *
 * Pages app_runs in batches of 500 to bound memory.
 */
export async function collectAppR2Keys(appId: string): Promise<string[]> {
  const seen = new Set<string>()
  const appJobIds = new Set<string>()

  const harvest = (val: unknown) => {
    if (typeof val === "string") {
      const key = r2KeyFromUrl(val)
      if (key) seen.add(key)
    } else if (Array.isArray(val)) {
      for (const v of val) harvest(v)
    } else if (val && typeof val === "object") {
      for (const v of Object.values(val)) harvest(v)
    }
  }

  const { data: appRow } = await supabase
    .from("published_apps")
    .select("icon_url, preview_media_url, snapshot_nodes")
    .eq("id", appId)
    .single()
  if (appRow) {
    harvest(appRow.icon_url)
    harvest(appRow.preview_media_url)
    harvest(appRow.snapshot_nodes)
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
    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>
    if (rows.length === 0) break

    for (const row of rows) {
      for (const column of APP_RUN_USER_CONTENT_COLUMNS) harvest(row[column])
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
      const owned: Array<{ id: string; node_states: unknown }> = []
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
          owned.push(e)
          const earlier = appRenderFinalStampOf(e.trigger_data)?.continuedFrom
          if (!earlier || read.has(earlier) || runExecutions.has(earlier)) continue
          namedBy.set(earlier, new Set([...(namedBy.get(earlier) ?? []), e.user_id]))
          next.add(earlier)
        }
        batch = [...next]
      }
      for (const e of owned) harvest(e.node_states)
      if (owned.length > 0) {
        const jobsRes = await supabase.from("jobs").select("id, output_data").in("workflow_execution_id", owned.map((e) => e.id))
        if (jobsRes.error) throw new Error(`collectAppR2Keys failed at jobs: ${jobsRes.error.message}`)
        for (const j of jobsRes.data ?? []) {
          if (typeof j.id === "string") appJobIds.add(j.id)
          harvest(j.output_data)
        }
      }
    }

    if (rows.length < 500) break
    const lastId = rows[rows.length - 1]!.id
    if (typeof lastId !== "string") break
    cursor = lastId
  }

  return appOwnedKeys(Array.from(seen), appJobIds)
}

const LIBRARY_LOOKUP_CHUNK = 100

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
  const foreign = new Set<string>()
  for (let i = 0; i < keys.length; i += LIBRARY_LOOKUP_CHUNK) {
    const chunk = keys.slice(i, i + LIBRARY_LOOKUP_CHUNK)
    const { data, error } = await supabase.from("assets").select("r2_key, job_id").in("r2_key", chunk)
    if (error) throw new Error(`collectAppR2Keys failed at assets: ${error.message}`)
    for (const row of (data ?? []) as Array<{ r2_key: string | null; job_id: string | null }>) {
      if (row.r2_key && !(row.job_id && appJobIds.has(row.job_id))) foreign.add(row.r2_key)
    }
  }
  return foreign.size === 0 ? keys : keys.filter((k) => !foreign.has(k))
}
