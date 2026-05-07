import { supabase } from "./supabase.js"
import { r2KeyFromUrl } from "../ee/billing/cleanup-service.js"

/**
 * Walk every R2 key referenced by an app: the app row's own media (icon,
 * preview, snapshot_nodes), every app_runs row's input/output JSONB, the
 * linked workflow_executions node_states, and the linked jobs.output_data
 * (worker handlers write URLs here that don't always mirror to node_states —
 * skipping jobs would leak files past expunge). Used by the admin expunge
 * handler to prepare the batchDeleteFromR2 call.
 *
 * Pages app_runs in batches of 500 to bound memory.
 */
export async function collectAppR2Keys(appId: string): Promise<string[]> {
  const seen = new Set<string>()

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
    let q = supabase
      .from("app_runs")
      .select("id, input_data, output_data, execution_id")
      .eq("app_id", appId)
      .order("id", { ascending: true })
      .limit(500)
    if (cursor) q = q.gt("id", cursor)

    const { data, error } = await q
    if (error) throw new Error(`collectAppR2Keys failed at runs page: ${error.message}`)
    if (!data || data.length === 0) break

    for (const row of data) {
      harvest(row.input_data)
      harvest(row.output_data)
    }

    const execIds = data.map((r) => r.execution_id).filter((x): x is string => !!x)
    if (execIds.length > 0) {
      const [execsRes, jobsRes] = await Promise.all([
        supabase.from("workflow_executions").select("node_states").in("id", execIds),
        supabase.from("jobs").select("output_data").in("workflow_execution_id", execIds),
      ])
      if (execsRes.error) throw new Error(`collectAppR2Keys failed at executions: ${execsRes.error.message}`)
      if (jobsRes.error) throw new Error(`collectAppR2Keys failed at jobs: ${jobsRes.error.message}`)
      for (const e of execsRes.data ?? []) harvest(e.node_states)
      for (const j of jobsRes.data ?? []) harvest(j.output_data)
    }

    if (data.length < 500) break
    const lastId = data[data.length - 1].id
    if (typeof lastId !== "string") break
    cursor = lastId
  }

  return Array.from(seen)
}
