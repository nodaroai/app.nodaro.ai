/**
 * Imports started WITHOUT a content rights confirmation, and the share of
 * imports that carried one (migration 597): what an administrator reads before
 * turning `content_rights_required` on (Admin, Settings, Content rights).
 *
 * Written by the import gate's spend half (`lib/import-gate.ts`), the one
 * funnel every import passes right before its fetch, for an import that goes
 * ahead with no confirmation (only possible while the setting is off), and by
 * its check of an accountless import in a lane the declaration reaches (those
 * would share one cap, under the empty account; today no such lane exists —
 * the branch is the fail-closed default for one). A private plugin's own
 * download is NOT counted: its lane is exempt from the declaration
 * (2026-11-05), so the setting will never refuse it, and the count measures
 * what the setting will refuse. Only
 * the link's host is kept, and no account: a full link can carry a name or a
 * token, and nothing reads who imported. The request is kept only as a hash
 * under a key of the server's, the same for every retry of it (a retry is the
 * same import: one row per request and host), which no job or run id can be
 * matched against. A download with no request is a row for each attempt.
 *
 * Counting is best effort and bounded: an import never waits for it or fails
 * because of it; one account adds at most `COUNT_CAP_PER_MINUTE` rows a minute
 * to a server process's count (past that the count is a lower bound); rows
 * older than the longest window are deleted daily. Only an edition with the
 * admin screen counts at all.
 */
import { createHmac } from "node:crypto"
import { supabase } from "./supabase.js"
import { config, hasAdmin } from "./config.js"
import type { ImportVia } from "./content-rights.js"

const DAY_MS = 24 * 60 * 60 * 1000
/** The longest window the admin screen reads; older rows are deleted. */
export const IMPORT_SHARE_MAX_DAYS = 90
/** Rows one account adds to a server process's count per minute. */
export const COUNT_CAP_PER_MINUTE = 120
const INSERT_TIMEOUT_MS = 3_000
const SWEEP_TIMEOUT_MS = 60_000
const SWEEP_INTERVAL_MS = DAY_MS
/** The table is not there yet (a server ahead of its database: staging before the migration reaches it). */
const MISSING_TABLE_CODES: ReadonlySet<string> = new Set(["PGRST205", "42P01"])

export interface UnconfirmedImport {
  /** The account the import is for ("" for a download with no account): only its per-minute cap reads it; it is never stored. */
  readonly userId: string
  readonly url: string
  readonly lane: string
  readonly via: ImportVia | null
  readonly appId: string | null
  readonly requestId: string | null
}

/** The link's host, lower-cased, or null when it is not a link. */
function hostOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host.length > 0 && host.length <= 255 ? host : null
  } catch {
    return null
  }
}

let requestHashKey: Buffer | null = null

/** This table's own key, derived from the server's secret (the same in every process of one deployment). */
function requestKeyMaterial(): Buffer {
  requestHashKey ??= createHmac("sha256", config.INTERNAL_ORCHESTRATOR_SECRET).update("nodaro:rights-unconfirmed-imports:request").digest()
  return requestHashKey
}

/** The request as the table holds it: a keyed hash, the same for every retry, that no job or run id can be matched against. */
function requestKey(requestId: string | null): string | null {
  if (requestId === null) return null
  return createHmac("sha256", requestKeyMaterial()).update(requestId).digest("hex")
}

let capWindowStart = 0
let countedThisMinute = new Map<string, number>()

/** Whether this account may add one more row to this process's count this minute. */
function underCap(userId: string, nowMs: number): boolean {
  if (nowMs - capWindowStart >= 60_000) {
    capWindowStart = nowMs
    countedThisMinute = new Map()
  }
  const counted = (countedThisMinute.get(userId) ?? 0) + 1
  countedThisMinute.set(userId, counted)
  return counted <= COUNT_CAP_PER_MINUTE
}

export function __resetUnconfirmedImportCapForTests(): void {
  capWindowStart = 0
  countedThisMinute = new Map()
}

/** Counts one import that went ahead with no confirmation. Never throws. */
export async function recordUnconfirmedImport(input: UnconfirmedImport): Promise<void> {
  if (!hasAdmin()) return
  const host = hostOf(input.url)
  if (!host || !underCap(input.userId, Date.now())) return
  try {
    const { error } = await supabase
      .from("rights_unconfirmed_imports")
      .insert({ lane: input.lane, via: input.via, app_id: input.appId, request_id: requestKey(input.requestId), host })
      .abortSignal(AbortSignal.timeout(INSERT_TIMEOUT_MS))
    // 23505: this request's import of this host is counted already (a retry).
    if (error && error.code !== "23505" && !MISSING_TABLE_CODES.has(error.code)) {
      console.warn(`[content-rights] an unconfirmed import was not counted: ${error.message}`)
    }
  } catch (e) {
    console.warn(`[content-rights] an unconfirmed import was not counted: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export interface ImportShareRow {
  /** The confirmation the imports carried: `checkbox`, `derived` (from a standing authorization), or `none`. */
  readonly declaration: string
  /** Where imports without a confirmation were made (route, run, mcp, admin; `plugin` only in rows from before that lane's exemption); null for the ones that carried one. */
  readonly lane: string | null
  readonly via: ImportVia | null
  readonly appId: string | null
  readonly imports: number
}

export interface ImportShare {
  /** When counting began, when that is inside the window asked for: the figures start there. Null otherwise. */
  readonly countingSince: string | null
  /** The imports with and without a confirmation, the most first. */
  readonly rows: readonly ImportShareRow[]
}

type ShareRowRecord = { declaration?: unknown; lane?: unknown; via?: unknown; app_id?: unknown; imports?: unknown }

const textOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null)

/** The imports of the last `days` days (or since counting began), with and without a confirmation. */
export async function importDeclarationShare(days: number, nowMs: number = Date.now()): Promise<ImportShare> {
  const since = new Date(nowMs - days * DAY_MS).toISOString()
  const { data, error } = await supabase.rpc("content_rights_import_share", { p_since: since })
  if (error) throw new Error(`content_rights_import_share failed: ${error.message}`)
  const share = (data ?? {}) as { counting_since?: unknown; rows?: unknown }
  const started = textOrNull(share.counting_since)
  const rows = Array.isArray(share.rows) ? (share.rows as ShareRowRecord[]) : []
  return {
    countingSince: started !== null && Date.parse(started) > Date.parse(since) ? started : null,
    rows: rows.map((r) => ({
      declaration: textOrNull(r.declaration) ?? "none",
      lane: textOrNull(r.lane),
      via: textOrNull(r.via) as ImportVia | null,
      appId: textOrNull(r.app_id),
      imports: Number(r.imports),
    })),
  }
}

/** Deletes the rows older than the longest window. Never throws: answers whether it failed. */
export async function deleteExpiredUnconfirmedImports(nowMs: number = Date.now()): Promise<{ readonly failed: boolean }> {
  const before = new Date(nowMs - IMPORT_SHARE_MAX_DAYS * DAY_MS).toISOString()
  try {
    const { error } = await supabase
      .from("rights_unconfirmed_imports")
      .delete()
      .lt("created_at", before)
      .abortSignal(AbortSignal.timeout(SWEEP_TIMEOUT_MS))
    return { failed: error ? !MISSING_TABLE_CODES.has(error.code) : false }
  } catch {
    return { failed: true }
  }
}

/** Deletes on boot, then once a day, where the count is kept. Returns the stop function the server's `onClose` awaits. */
export function startUnconfirmedImportsSweep(report: (message: string) => void): () => Promise<void> {
  if (!hasAdmin()) return async () => {}
  let stopped = false
  let pending: Promise<void> | undefined
  const tick = () => {
    if (stopped || pending) return
    pending = (async () => {
      const result = await deleteExpiredUnconfirmedImports()
      if (result.failed) report("Imports without a declaration: the rows past 90 days were not deleted; the next daily run tries again")
    })().finally(() => {
      pending = undefined
    })
  }
  const timer = setInterval(tick, SWEEP_INTERVAL_MS)
  timer.unref()
  tick()
  return async () => {
    stopped = true
    clearInterval(timer)
    await pending
  }
}
