/**
 * THE way a route creates a `jobs` row.
 *
 * Every job-creating route used to hand-write its own
 * `supabase.from("jobs").insert({...})`, which meant every cross-cutting column
 * had to be remembered at ~110 sites. `mcp_client` is the cautionary tale: it
 * is genuinely useful and it is absent from a good fraction of those sites
 * purely because nobody remembered — so provenance data was incomplete in a way
 * nothing surfaced until someone asked where a job came from.
 *
 * Routing inserts through here makes the cross-cutting columns
 * (`source` / `source_detail` / `mcp_client`) a property of the REQUEST rather
 * than of the author's memory. A route added tomorrow gets correct provenance
 * without knowing this file exists.
 *
 * `__tests__/no-direct-job-insert.test.ts` is the other half: it fails if any
 * file under `src/routes/` reaches for `.from("jobs").insert(` directly. The
 * helper alone would decay — the repo's rule is an invariant plus a guard test,
 * not a convention.
 *
 * ## Return shape
 *
 * Mirrors the Supabase call it replaces — `{ data, error }`, never throwing —
 * so adopting it is a mechanical substitution at the call site and every
 * route's existing `if (error) return sendInternalError(...)` keeps working
 * unchanged. A helper that threw instead would have turned a rename into a
 * behavioural rewrite of ~110 error paths, which is exactly the kind of churn
 * that hides a regression.
 */
import type { FastifyRequest } from "fastify"
import { supabase } from "./supabase.js"
import { insertWithIdempotencyKey, type IdempotentInsertResult } from "./idempotent-insert.js"
import { jobSourceColumns } from "./job-source.js"
import { extractMcpClient } from "./extract-mcp-client.js"

/**
 * Request-derived columns every job row should carry.
 *
 * Caller-supplied columns WIN: the orchestrator and the plugin toolkit create
 * jobs on behalf of a caller whose surface they know better than the current
 * request does, and must be able to say so.
 */
export function withJobProvenance(
  req: FastifyRequest,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const mcpClient = extractMcpClient(req.body)
  return {
    ...jobSourceColumns(req),
    ...(mcpClient ? { mcp_client: mcpClient } : {}),
    ...row,
  }
}

/**
 * Discriminated on `error`, exactly like the Supabase builder this replaces.
 *
 * That is load-bearing, not cosmetic: every call site is
 * `if (error) return sendInternalError(...)` followed by `job.id`. With
 * independently-nullable fields TypeScript cannot narrow `data` through that
 * guard and all ~110 sites light up with "possibly null" — the union is what
 * makes the substitution truly mechanical.
 */
export type InsertJobResult<T> =
  | { data: T; error: null }
  | { data: null; error: { message: string } }

/**
 * Insert one job row, stamped with request provenance.
 *
 * Drop-in for `supabase.from("jobs").insert(row).select(cols).single()`.
 */
export async function insertJob<T = { id: string }>(
  req: FastifyRequest,
  row: Record<string, unknown>,
  opts: { selectColumns?: string } = {},
): Promise<InsertJobResult<T>> {
  const { data, error } = await supabase
    .from("jobs")
    .insert(withJobProvenance(req, row))
    .select(opts.selectColumns ?? "id")
    .single()
  return (error ? { data: null, error } : { data: data as T, error: null }) as InsertJobResult<T>
}

/**
 * Insert for INTERNAL creators — pipeline services, workers, crons — that have
 * no FastifyRequest to derive provenance from. They still must say who they
 * are: a row with `source: "internal"` and a named creator beats the null the
 * admin table can only render as "—", which reads as data loss (and was
 * reported as exactly that — see the pipeline stages and meterSyncLlm).
 * `sourceDetail` is required on purpose: "internal" alone answers nothing.
 *
 * Caller-supplied columns win, same contract as `withJobProvenance` — a
 * creator that DOES know the originating surface may override `source`.
 * `opts.client` exists for call sites that operate on an injected Supabase
 * client (the pipeline services take one as an argument for testability).
 */
export async function insertInternalJob<T = { id: string }>(
  sourceDetail: string,
  row: Record<string, unknown>,
  opts: { selectColumns?: string; client?: typeof supabase } = {},
): Promise<InsertJobResult<T>> {
  const { data, error } = await (opts.client ?? supabase)
    .from("jobs")
    .insert({ source: "internal", source_detail: sourceDetail, ...row })
    .select(opts.selectColumns ?? "id")
    .single()
  return (error ? { data: null, error } : { data: data as T, error: null }) as InsertJobResult<T>
}

/**
 * Insert many job rows in one statement (variants, per-segment children),
 * stamped with the same request provenance.
 */
export async function insertJobs<T = { id: string }>(
  req: FastifyRequest,
  rows: ReadonlyArray<Record<string, unknown>>,
  opts: { selectColumns?: string } = {},
): Promise<InsertJobResult<T[]>> {
  const { data, error } = await supabase
    .from("jobs")
    .insert(rows.map((r) => withJobProvenance(req, r)))
    .select(opts.selectColumns ?? "id")
  return (error ? { data: null, error } : { data: data as T[], error: null }) as InsertJobResult<T[]>
}

/**
 * Race-proof variant for routes that pass `req.idempotencyKey`. Delegates to
 * `insertWithIdempotencyKey` unchanged, so migration 163's UNIQUE constraint
 * semantics are preserved exactly; this only adds the provenance columns.
 *
 * THROWS on DB error, like the function it wraps — call sites that use it
 * already handle that.
 */
export async function insertJobIdempotent<T = { id: string }>(
  req: FastifyRequest,
  row: Record<string, unknown> & { user_id: string },
  idempotencyKey: string | null | undefined,
  selectColumns = "id",
): Promise<IdempotentInsertResult<T>> {
  return insertWithIdempotencyKey<T>(
    "jobs",
    withJobProvenance(req, row) as Record<string, unknown> & { user_id: string },
    idempotencyKey,
    selectColumns,
  )
}
