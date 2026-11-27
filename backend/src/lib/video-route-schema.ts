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
      // The first answer also starts the check of the WHOLE schema (it alerts on its own).
      void videoRouteSchemaState({ client: supabase })
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

/**
 * What this database says of the routed-video schema:
 *   - `whole`: the check function answered and nothing is missing;
 *   - `incomplete`: a piece is PROVEN missing (`missing` names each);
 *   - `unverified`: nothing is proven missing, but the schema could not be
 *     verified whole — the check function is not installed yet (`checkInstalled:
 *     false`: the tables and the job's columns were probed directly, the
 *     triggers and the index cannot be seen from here), or the check could not
 *     be asked just now (`checkInstalled: undefined`).
 * Only `whole` lets a policy route a model or enforce unpaid charges
 * (ee/routes/admin-video-route.ts); reads and alerts carry on in every case.
 */
export interface VideoRouteSchemaState {
  readonly status: "whole" | "incomplete" | "unverified"
  readonly missing: readonly string[]
  /** false: the check function is not installed. undefined: the check could not be asked (an error). */
  readonly checkInstalled?: boolean
}

/** How long an answer of the check is kept before it is asked again: a process picks up a newly applied schema file without a restart. */
export const VIDEO_ROUTE_SCHEMA_RECHECK_MS = 5 * 60_000

let stateKnown: { state: VideoRouteSchemaState; at: number } | undefined
let stateProbe: Promise<VideoRouteSchemaState> | undefined
/** The last state alerted on: an alert is raised when the state CHANGES, not on every re-check. */
let lastReported: string | undefined

/**
 * The routed-video schema as this database answers it ({@link VideoRouteSchemaState}),
 * from its catalog (`video_route_schema_state`). The schema is applied as a
 * chain of small files, and most of its pieces fail SILENTLY when missing — a
 * trigger that is not attached blocks nothing and repays nothing — so this is
 * asked, and kept for {@link VIDEO_ROUTE_SCHEMA_RECHECK_MS} at most (never for
 * the life of the process: a process picks the check function up as soon as it
 * is applied), with an alert whenever the answer changes. `fresh` asks the
 * database now (a save asks it so). A check that could not be asked is never
 * kept: it is `unverified`, and asked again next time.
 */
export function videoRouteSchemaState(opts: { client?: unknown; fresh?: boolean; now?: number } = {}): Promise<VideoRouteSchemaState> {
  const now = opts.now ?? Date.now()
  if (!opts.fresh && stateKnown && now - stateKnown.at < VIDEO_ROUTE_SCHEMA_RECHECK_MS) return Promise.resolve(stateKnown.state)
  if (opts.fresh) return askSchemaState(opts.client, now)
  stateProbe ??= askSchemaState(opts.client, now).finally(() => {
    stateProbe = undefined
  })
  return stateProbe
}

async function askSchemaState(client: unknown, now: number): Promise<VideoRouteSchemaState> {
  let state: VideoRouteSchemaState
  try {
    const supabase = client ?? (await import("./supabase.js")).supabase
    const { data, error } = await (supabase as unknown as { rpc(name: string): Promise<{ data: unknown; error: { code?: string; message: string } | null }> }).rpc("video_route_schema_state")
    if (error) {
      // The check itself is not installed yet: what CAN be read without it (the tables and the
      // job's columns) is probed, and a piece PROVEN missing is named. The triggers and the index
      // cannot be seen from here, so a schema with nothing proven missing is still only unverified.
      if (error.code === "PGRST202" || error.code === "42883") {
        const missing = await probeWithoutCheck(supabase)
        state = { status: missing.length > 0 ? "incomplete" : "unverified", missing, checkInstalled: false }
      } else {
        // Asking failed (a timeout, a dropped connection): this proves nothing either way. Not kept.
        return { status: "unverified", missing: [] }
      }
    } else {
      const listed = data && typeof data === "object" ? (data as { missing?: unknown }).missing : undefined
      const missing = Array.isArray(listed) ? listed.filter((m): m is string => typeof m === "string") : []
      state = { status: missing.length > 0 ? "incomplete" : "whole", missing, checkInstalled: true }
    }
  } catch {
    return { status: "unverified", missing: [] }
  }
  stateKnown = { state, at: now }
  report(state)
  return state
}

/**
 * What the routed-video schema lacks in this database, by name (see
 * {@link videoRouteSchemaState}); empty when nothing is PROVEN missing, which
 * is not the same as whole. For alerts and reads only: a save asks
 * {@link videoRouteSchemaState} itself.
 */
export async function videoRouteSchemaMissing(client?: unknown): Promise<readonly string[]> {
  return (await videoRouteSchemaState({ client })).missing
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

/** Alerts once per distinct state (a re-check that finds the same state says nothing again). */
function report(state: VideoRouteSchemaState): void {
  const key = `${state.status}|${state.checkInstalled === false ? "no-check" : "check"}|${state.missing.join(";")}`
  if (key === lastReported) return
  lastReported = key
  if (state.checkInstalled === false) console.error(`[ALERT] routed video: schema check function not installed (video_route_schema_state). The tables and the job's columns were probed directly${state.missing.length > 0 ? "" : " and are all there"}; the triggers and the index could not be verified, so no model can be routed and unpaid charges cannot be enforced here until it is.`)
  if (state.missing.length > 0) console.error(`[ALERT] this database's routed-video schema is incomplete. Missing: ${state.missing.join("; ")}. Apply the remaining schema files before any model is routed: until then a routing policy cannot be saved here.`)
}

/** Test seam. */
export function _resetVideoRouteSchemaForTests(value?: boolean, state?: VideoRouteSchemaState): void {
  known = value
  probing = undefined
  stateKnown = state ? { state, at: Date.now() } : undefined
  stateProbe = undefined
  lastReported = undefined
}
