/**
 * Whether this database has the columns the stop rule and the send marker
 * read (`jobs.video_send_started_at`, added by the routed-video schema).
 *
 * The schema is released before this code, so they are there. If a server is
 * ever started against a database without them, this says so ONCE, loudly, and
 * the callers keep the behaviour they had before the columns existed: a send
 * is not marked, and a cancel reads without the marker. Without it every
 * Seedance send and every cancel-all would fail on the missing column.
 *
 * Probed once per process and cached. A probe that fails for any other reason
 * proves nothing: the columns are assumed there (the designed behaviour), and
 * the next call probes again.
 */
import { isMissingColumnError, isMissingTableError } from "./postgrest-errors.js"
import { STOP_RULE_COLUMNS, STOP_RULE_COLUMNS_BEFORE_MIGRATION } from "./stop-rule.js"

let known: boolean | undefined
let probing: Promise<boolean> | undefined

export function videoRouteSchemaReady(): Promise<boolean> {
  if (known !== undefined) return Promise.resolve(known)
  probing ??= (async () => {
    try {
      const { supabase } = await import("./supabase.js")
      // trash-read: a probe for the column itself; no row is read for anyone, a deleted one included.
      const { error } = await supabase.from("jobs").select("video_send_started_at").limit(1)
      // The first answer also starts the one check of the WHOLE schema (it alerts on its own).
      void videoRouteSchemaMissing(supabase)
      if (!error) return (known = true)
      if (isMissingColumnError(error)) {
        console.error("[ALERT] this database does not have the routed-video columns (jobs.video_send_started_at). The schema must be applied before this code: until it is, a started video send is not marked and a stop cancels as it did before.")
        return (known = false)
      }
      return true
    } catch {
      return true
    } finally {
      probing = undefined
    }
  })()
  return probing
}

/**
 * A select that names the stop rule's columns (`STOP_RULE_COLUMNS`), as this
 * database can answer it: unchanged when the columns are there, without the
 * send marker when they are not (the row then simply carries none, which is
 * what "no send is marked" means). Typed as the full select either way.
 */
export async function stopRuleSelect<T extends string>(select: T): Promise<T> {
  if (await videoRouteSchemaReady()) return select
  return select.replace(STOP_RULE_COLUMNS, STOP_RULE_COLUMNS_BEFORE_MIGRATION) as T
}

let missingKnown: readonly string[] | undefined
let missingProbe: Promise<readonly string[]> | undefined

/**
 * What the routed-video schema lacks in this database, by name: its tables
 * and functions, the job's columns, each trigger, the index (the database
 * answers from its catalog, `video_route_schema_state`). Empty when it is
 * whole. The schema is applied as a chain of small files, and most of its
 * pieces fail SILENTLY when missing — a trigger that is not attached blocks
 * nothing and repays nothing — so this is asked once per process and alerts,
 * naming each missing piece; a routing policy is not saved over one
 * (ee/routes/admin-video-route.ts). A read that fails proves nothing: empty,
 * and asked again.
 */
export function videoRouteSchemaMissing(client?: unknown): Promise<readonly string[]> {
  if (missingKnown !== undefined) return Promise.resolve(missingKnown)
  missingProbe ??= (async () => {
    try {
      const supabase = client ?? (await import("./supabase.js")).supabase
      const { data, error } = await (supabase as unknown as { rpc(name: string): Promise<{ data: unknown; error: { code?: string; message: string } | null }> }).rpc("video_route_schema_state")
      if (error) {
        // The check itself is not installed yet. That alone blocks nothing: what CAN be read
        // without it (the tables and the job's columns) is probed, and only a piece PROVEN
        // missing is reported. The triggers and the index cannot be seen from here.
        if (error.code === "PGRST202" || error.code === "42883") return report(await probeWithoutCheck(supabase), true)
        return []
      }
      const listed = data && typeof data === "object" ? (data as { missing?: unknown }).missing : undefined
      return report(Array.isArray(listed) ? listed.filter((m): m is string => typeof m === "string") : [])
    } catch {
      return []
    } finally {
      missingProbe = undefined
    }
  })()
  return missingProbe
}

const SCHEMA_TABLES = ["video_route_ledger", "video_route_debts", "video_route_repayments", "video_route_deferred_repayments"] as const
const SCHEMA_JOB_COLUMNS = ["video_send_started_at", "metadata", "video_route_addons_base", "video_assembly_recovery"] as const

/** What can be proven missing with no check function: each table and each job column, by one empty read. A read that fails for another reason proves nothing. */
async function probeWithoutCheck(client: unknown): Promise<string[]> {
  const db = client as { from(table: string): { select(cols: string): { limit(n: number): PromiseLike<{ error: { code?: string | null } | null }> } } }
  const missing: string[] = []
  for (const table of SCHEMA_TABLES) {
    try {
      const { error } = await db.from(table).select("*").limit(0)
      if (error && isMissingTableError(error)) missing.push(`table ${table}`)
    } catch {
      // Proves nothing.
    }
  }
  for (const column of SCHEMA_JOB_COLUMNS) {
    try {
      // trash-read: a probe for the column itself; no row is read for anyone.
      const { error } = await db.from("jobs").select(column).limit(0)
      if (error && isMissingColumnError(error)) missing.push(`column jobs.${column}`)
    } catch {
      // Proves nothing.
    }
  }
  return missing
}

function report(missing: readonly string[], checkNotInstalled = false): readonly string[] {
  missingKnown = missing
  if (checkNotInstalled) console.error(`[ALERT] routed video: schema check function not installed (video_route_schema_state). The tables and the job's columns were probed directly${missing.length > 0 ? "" : " and are all there"}; the triggers and the index could not be verified.`)
  if (missing.length > 0) console.error(`[ALERT] this database's routed-video schema is incomplete. Missing: ${missing.join("; ")}. Apply the remaining schema files before any model is routed: until then a routing policy cannot be saved here.`)
  return missing
}

/** Test seam. */
export function _resetVideoRouteSchemaForTests(value?: boolean, missing?: readonly string[]): void {
  known = value
  probing = undefined
  missingKnown = missing
  missingProbe = undefined
}
