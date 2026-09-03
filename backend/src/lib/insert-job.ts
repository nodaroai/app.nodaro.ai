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
import type { BillingContext } from "./billing-context.js"
import {
  ALL_POLICIES_ALLOWED_ID,
  applyJobRequestPolicies,
  hasJobPolicyFor,
  JobBlockedError,
  type InsertJobBlock,
  type JobRequestContext,
} from "./job-policy.js"
import { hashGateSubject, recordJobPolicyDecision } from "./job-policy-audit.js"

/** Re-exported so a caller that handles a block never has to know the registry
 *  exists — and so `job-policy.ts` can own the type without an import cycle
 *  back into these helpers. */
export type { InsertJobBlock }
export { JobBlockedError }

/**
 * The P14 payer pair for a job/execution row, from a resolved context.
 * Personal (or absent) adds NOTHING — a personal row is byte-identical to
 * pre-P14. A workspace pair also flips the row private via the DB's own
 * clamp trigger (migration 337): class work never rides a public gallery.
 */
export function billingPairColumns(ctx: BillingContext | undefined): Record<string, unknown> {
  return ctx?.payer === "workspace" ? { workspace_id: ctx.workspaceId, org_id: ctx.orgId } : {}
}

/**
 * Request-derived columns every job row should carry.
 *
 * Caller-supplied columns WIN: the orchestrator and the plugin toolkit create
 * jobs on behalf of a caller whose surface they know better than the current
 * request does, and must be able to say so.
 *
 * The ONE exception is the P14 payer pair (`workspace_id`/`org_id`), spread
 * AFTER the caller's row: who pays was resolved once for this request and a
 * job attributed to it must not be able to claim otherwise — reporting joins
 * and the privacy clamp both key on these columns. It is an OVERRIDE, not a
 * clear: with a personal context the spread adds nothing, so a caller-
 * supplied pair survives — required by the component wrapper, whose honored
 * context rides the body where the request-level stamp cannot see it.
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
    ...billingPairColumns(req.billingContext),
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
  | { data: null; error: { message: string; blocked?: InsertJobBlock } }


/* -------------------------------------------------------------------------
 * The REQUEST gate (spec §5.3, D4).
 *
 * One pre-flight, four call sites. It runs AFTER provenance stamping — so
 * `source` / `source_detail` / `mcp_client` in the context are the values that
 * will actually land on the row — and BEFORE the `supabase.insert`. At that
 * point no row exists and no reservation exists (every creator is
 * insert → reserve → enqueue), so a block leaves nothing to refund and nothing
 * to clean up. That is the whole reason this hook point is at the insert and
 * not at pickup.
 *
 * With no policy implementing `checkRequest` this is one boolean and a return:
 * no context object, no hash, no audit row (D23).
 * ---------------------------------------------------------------------- */

/** `null` = the fast path (nothing registered for this hook). */
type InsertGate =
  | { readonly block: InsertJobBlock }
  | { readonly allow: { readonly userId: string | null; readonly jobType: string | null; readonly hash: string } }
  | null

function requestContextOf(rows: ReadonlyArray<Record<string, unknown>>): JobRequestContext {
  const first = rows[0] ?? {}
  const input = (first.input_data as Record<string, unknown> | undefined) ?? {}
  return {
    jobType: (first.job_type as string | null) ?? (typeof input.type === "string" ? input.type : null),
    userId: (first.user_id as string | null) ?? null,
    source: (first.source as string | null) ?? null,
    sourceDetail: (first.source_detail as string | null) ?? null,
    provider: (first.provider as string | null) ?? null,
    // On entity/character rows `input_data.provider` is the MODEL id, not the
    // vendor — pass both and let the policy decide which it meant.
    modelIdentifier: typeof input.provider === "string" ? input.provider : null,
    inputData: input,
    workflowExecutionId: (first.workflow_execution_id as string | null) ?? null,
    parentJobId: (first.parent_job_id as string | null) ?? null,
    pipelineId: (first.pipeline_id as string | null) ?? null,
    mcpClient: (first.mcp_client as string | null) ?? null,
    rowCount: rows.length,
  }
}

/**
 * Judge an insert. A BATCH is judged ALL-OR-NOTHING ON THE FIRST ROW: a batch
 * is one user action (variants, per-segment children) and a partial insert
 * would be worse than a whole denial. Stated here so the first `insertJobs`
 * caller inherits the rule rather than discovering it.
 */
async function gateJobInsert(rows: ReadonlyArray<Record<string, unknown>>): Promise<InsertGate> {
  if (!hasJobPolicyFor("request")) return null
  const ctx = requestContextOf(rows)
  const hash = hashGateSubject({ jobType: ctx.jobType, userId: ctx.userId, inputData: ctx.inputData })
  const d = await applyJobRequestPolicies(ctx)
  if (d.verdict === "allow") return { allow: { userId: ctx.userId, jobType: ctx.jobType, hash } }

  // A BLOCK keeps job_id NULL — no row was ever created, which is the point of
  // gating pre-insert (D25). It is joined by user_id + created_at + hash.
  const message = d.userMessage ?? d.reason ?? "This request is not allowed on this deployment"
  await recordJobPolicyDecision({
    jobId: null,
    hookPoint: "request",
    policyId: d.policyId ?? "unknown",
    verdict: "block",
    reason: d.reason ?? null,
    // The 422 body's sentence, recorded alongside the machine reason so the
    // column means the same thing at BOTH hook points: "what the user was
    // told". Nothing re-applies a request-gate verdict (there is no row to
    // re-apply it to), so this one is for the audit alone.
    userMessage: message,
    payloadHash: hash,
    userId: ctx.userId,
    jobType: ctx.jobType,
  })
  return {
    block: {
      code: "job_blocked",
      policyId: d.policyId ?? "unknown",
      message,
    },
  }
}

/** The error arm every non-throwing helper returns on a block. `message` is the
 *  policy's USER-SAFE text, so a route that only logs `error.message` still
 *  says something true. */
function blockedResult<T>(block: InsertJobBlock): InsertJobResult<T> {
  return { data: null, error: { message: block.message, blocked: block } }
}

/** The `allow` row is written AFTER the insert, because the gate runs
 *  pre-insert and a decision row with a NULL `job_id` for an ALLOWED job would
 *  be unjoinable. `policy_id: "*"` = "every registered policy allowed" — an
 *  allow has no single deciding policy. */
async function recordAllowedInsert(
  gate: Extract<InsertGate, { allow: unknown }>,
  data: unknown,
): Promise<void> {
  const ids = (Array.isArray(data) ? data : [data])
    .map((d) => (d && typeof d === "object" ? (d as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === "string")
  for (const id of ids) {
    await recordJobPolicyDecision({
      jobId: id,
      hookPoint: "request",
      policyId: ALL_POLICIES_ALLOWED_ID,
      verdict: "allow",
      payloadHash: gate.allow.hash,
      userId: gate.allow.userId,
      jobType: gate.allow.jobType,
    })
  }
}

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
  const stamped = withJobProvenance(req, row)
  const gate = await gateJobInsert([stamped])
  if (gate && "block" in gate) return blockedResult<T>(gate.block)
  const { data, error } = await supabase
    .from("jobs")
    .insert(stamped)
    .select(opts.selectColumns ?? "id")
    .single()
  if (!error && gate) await recordAllowedInsert(gate, data)
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
  opts: { selectColumns?: string; client?: typeof supabase; billingContext?: BillingContext } = {},
): Promise<InsertJobResult<T>> {
  // Same one-exception rule as withJobProvenance: the carried payer pair
  // (P14) is spread AFTER the caller's row — the execution's resolved payer,
  // never a per-site claim.
  const stamped = {
    source: "internal",
    source_detail: sourceDetail,
    ...row,
    ...billingPairColumns(opts.billingContext),
  }
  const gate = await gateJobInsert([stamped])
  if (gate && "block" in gate) return blockedResult<T>(gate.block)
  const { data, error } = await (opts.client ?? supabase)
    .from("jobs")
    .insert(stamped)
    .select(opts.selectColumns ?? "id")
    .single()
  if (!error && gate) await recordAllowedInsert(gate, data)
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
  const stamped = rows.map((r) => withJobProvenance(req, r))
  const gate = await gateJobInsert(stamped)
  if (gate && "block" in gate) return blockedResult<T[]>(gate.block)
  const { data, error } = await supabase
    .from("jobs")
    .insert(stamped)
    .select(opts.selectColumns ?? "id")
  if (!error && gate) await recordAllowedInsert(gate, data)
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
  const stamped = withJobProvenance(req, row) as Record<string, unknown> & { user_id: string }
  // This helper THROWS on DB error, so it throws on a block too — its four
  // callers already wrap it in `try { … } catch (err) { sendInternalError(…) }`,
  // which now answers 422 job_blocked for free.
  const gate = await gateJobInsert([stamped])
  if (gate && "block" in gate) throw new JobBlockedError(gate.block)
  const result = await insertWithIdempotencyKey<T>("jobs", stamped, idempotencyKey, selectColumns)
  if (gate) await recordAllowedInsert(gate, result.row)
  return result
}
