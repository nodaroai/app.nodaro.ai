/**
 * `job_policy_decisions` — the audit of every gate decision and every review
 * outcome (migration 377, spec §7, D22-D25).
 *
 * Three rules this file exists to hold:
 *
 * 1. **It never throws.** An audit failure logs and the gate proceeds: the
 *    audit is the RECORD of the check, not the check. A decision that failed to
 *    be written must not turn a successful generation into a 500.
 *
 * 2. **The write is AWAITED, not fire-and-forget.** `lib/http-errors.ts:18-33`
 *    documents at length why unawaited best-effort writes are a test-isolation
 *    hazard in this repo (a write landing during a later test's control of the
 *    shared supabase mock). One INSERT is cheaper than that class of flake.
 *
 * 3. **`allow` IS recorded** — once some registered policy implements that hook
 *    point (D23). An audit that records only denials cannot answer "was this
 *    checked?", which is the only question a review ever actually gets asked;
 *    and on the result hook the `allow` row IS the idempotency key. With
 *    nothing registered, zero rows: the caller's fast path never gets here.
 *
 * Service-role only by construction: 377 enables RLS with NO policies and
 * REVOKEs from anon/authenticated, so these rows are unreachable from a browser
 * even though the moderation reason they carry is the deployment's business.
 */
import { createHash } from "node:crypto"
import { supabase } from "./supabase.js"

/** `request`/`result` are the gate hook points; `review` is a human decision
 *  (approve/reject) and the TTL expiry. Wider than `JobPolicyHookPoint` on
 *  purpose — the CHECK in 377 admits all three. */
export type DecisionHookPoint = "request" | "result" | "review"

export type DecisionVerdict = "allow" | "flag" | "block" | "hold" | "approve" | "reject" | "withdrawn"

/** The verdicts the idempotency lookup will REUSE. `approve`/`reject`/
 *  `withdrawn` are review records that share the original payload hash, and
 *  must never shadow the machine verdict at that hash (D24). */
export const REUSABLE_VERDICTS = ["allow", "flag", "block", "hold"] as const

export interface JobPolicyDecisionInput {
  /** NULL for a request-gate BLOCK: no row was ever created, which is the whole
   *  point of gating pre-insert. Such a row is joined by user_id + created_at +
   *  payload_hash instead (D25). */
  readonly jobId: string | null
  readonly hookPoint: DecisionHookPoint
  readonly policyId: string
  readonly verdict: DecisionVerdict
  /** MACHINE text. The user's copy lives in `jobs.error_hint.reason`. */
  readonly reason?: string | null
  /** USER-SAFE text — the sentence this decision actually put in front of the
   *  job's owner, recorded so a RE-APPLY of a stored verdict reproduces exactly
   *  what the first application said (D13). NULL when the decision showed
   *  nothing: an `allow`/`flag`, and a `hold`, which parks the job without a
   *  message. NEVER `reason` — that is the leak the column exists to close. */
  readonly userMessage?: string | null
  readonly labels?: readonly string[] | null
  readonly payloadHash?: string | null
  /** Whether the verdict's ACTION landed, in three states. NULL = not
   *  applicable (an allow/flag writes nothing, and the request gate's action is
   *  simply not inserting the job) OR not yet applied — a block/hold row is
   *  written BEFORE its CAS on purpose. TRUE = the action completed. FALSE =
   *  the CAS matched no row: a concurrent terminal writer won. */
  readonly applied?: boolean | null
  readonly holdDowngraded?: boolean
  readonly userId?: string | null
  readonly jobType?: string | null
  readonly latencyMs?: number | null
  readonly resolverUserId?: string | null
  readonly resolverEmail?: string | null
}

/** Returns the new row's id, or null when the write failed (logged, never
 *  thrown) — the id is what lets the gate flip `applied` after its CAS. */
export async function recordJobPolicyDecision(input: JobPolicyDecisionInput): Promise<string | null> {
  try {
    const { data, error } = await (supabase.from("job_policy_decisions" as "assets") as any)
      .insert({
        job_id: input.jobId,
        hook_point: input.hookPoint,
        policy_id: input.policyId,
        verdict: input.verdict,
        reason: input.reason ?? null,
        user_message: input.userMessage ?? null,
        labels: input.labels ? [...input.labels] : null,
        payload_hash: input.payloadHash ?? null,
        applied: input.applied ?? null,
        hold_downgraded: input.holdDowngraded ?? false,
        user_id: input.userId ?? null,
        job_type: input.jobType ?? null,
        latency_ms: input.latencyMs ?? null,
        resolver_user_id: input.resolverUserId ?? null,
        resolver_email: input.resolverEmail ?? null,
      })
      .select("id")
      .single()
    if (error) {
      console.warn(`[job-policy-audit] decision insert failed: ${error.message}`)
      return null
    }
    return (data as { id?: string } | null)?.id ?? null
  } catch (err) {
    console.warn(`[job-policy-audit] decision insert threw: ${(err as Error).message}`)
    return null
  }
}

/** Flip `applied` after the fact. Both directions are used: `true` once the
 *  verdict's CAS has actually flipped a row (the INSERT writes the record
 *  BEFORE acting, so it cannot honestly claim `applied` yet), and `false` when
 *  the CAS matched zero rows because a concurrent terminal writer won. */
export async function setDecisionApplied(decisionId: string | null, applied: boolean): Promise<void> {
  if (!decisionId) return
  try {
    const { error } = await (supabase.from("job_policy_decisions" as "assets") as any)
      .update({ applied })
      .eq("id", decisionId)
    if (error) console.warn(`[job-policy-audit] applied flag update failed: ${error.message}`)
  } catch (err) {
    console.warn(`[job-policy-audit] applied flag update threw: ${(err as Error).message}`)
  }
}

export interface ReusedDecision {
  /** The audit row's own id, so a verdict that has to be re-applied flips
   *  `applied` on the EXISTING record instead of writing a second one. */
  readonly id: string | null
  readonly verdict: (typeof REUSABLE_VERDICTS)[number]
  /** MACHINE text (D13) — kept for logs and the admin decisions tab, and read
   *  by NOTHING user-visible. The sentence a re-apply shows comes from
   *  `userMessage` below, or from a platform-owned constant when that is null;
   *  it is never derived from this field. */
  readonly reason: string | null
  /** USER-SAFE text: the sentence the FIRST application of this verdict showed.
   *  NULL for a row written before migration 380 and for any verdict that
   *  showed nothing — the caller substitutes a platform sentence, never
   *  `reason`. */
  readonly userMessage: string | null
  readonly policyId: string
  /** Reported, deliberately NOT filtered on. `applied` is written after the CAS
   *  now, but a process that died between the INSERT and the CAS can still
   *  leave any value here — the JOB ROW's status is the authority on whether a
   *  verdict landed, and this flag is the record, not the test. */
  readonly applied: boolean | null
  /** A `hold` the platform downgraded to `block` (D8). Its `reason` is the
   *  policy's machine text, which is exactly what D13 keeps off a user's canvas. */
  readonly holdDowngraded: boolean
}

/**
 * The idempotency lookup (D24): gate ONCE per `(job_id, hook_point,
 * payload_hash)`. A BullMQ stall re-pick, the inline reconcile and the
 * reconcile cron all re-derive the SAME `output_data` from the same provider
 * result, so the hash matches and the stored verdict is reused instead of
 * re-calling — and re-paying for — the moderation service.
 *
 * What is reused is the VERDICT, never the check: the policy is asked exactly
 * once per hash, so a moderation call is never paid for twice. Whether the
 * verdict still has to be APPLIED is a question about the job row, not about
 * this table (`applyResultGate` re-reads the status), because the audit row is
 * written BEFORE the action: a crash in that window leaves a stored `block`
 * whose row is still `processing` with its credits reserved. Filtering this
 * query on `applied` would answer the wrong question and re-ask (re-pay for)
 * the policy; returning the row and letting the caller check the status
 * answers the right one.
 */
export async function findReusableDecision(
  jobId: string,
  hookPoint: DecisionHookPoint,
  payloadHash: string,
): Promise<ReusedDecision | null> {
  try {
    const { data, error } = await (supabase.from("job_policy_decisions" as "assets") as any)
      .select("id, verdict, reason, user_message, policy_id, applied, hold_downgraded")
      .eq("job_id", jobId)
      .eq("hook_point", hookPoint)
      .eq("payload_hash", payloadHash)
      .in("verdict", [...REUSABLE_VERDICTS])
      .order("created_at", { ascending: false })
      .limit(1)
    if (error) {
      console.warn(`[job-policy-audit] reuse lookup failed: ${error.message}`)
      return null
    }
    const row = (
      data as Array<{
        id?: string
        verdict: string
        reason: string | null
        user_message?: string | null
        policy_id: string
        applied?: boolean | null
        hold_downgraded?: boolean | null
      }> | null
    )?.[0]
    if (!row) return null
    return {
      id: row.id ?? null,
      verdict: row.verdict as ReusedDecision["verdict"],
      reason: row.reason,
      // `?? null` and not `?? row.reason`: a database that has not run 380 yet
      // returns the key undefined, and the honest answer there is "no user-safe
      // text was recorded", which the caller resolves to a platform sentence.
      userMessage: row.user_message ?? null,
      policyId: row.policy_id,
      applied: row.applied ?? null,
      holdDowngraded: row.hold_downgraded === true,
    }
  } catch (err) {
    console.warn(`[job-policy-audit] reuse lookup threw: ${(err as Error).message}`)
    return null
  }
}

/** Recursively key-sorted JSON, so two encodings of the same payload collide.
 *  (`lib/dedup-fingerprint.ts` does the same for request bodies; this one is
 *  local because the gate must not depend on the dedup module's DB helpers.) */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`
}

/** The gate's idempotency key: sha256 over the GATED CONTENT — `output_data`
 *  for the result hook, `{jobType, userId, inputData}` for the request hook —
 *  never the whole row, so an incidental column change does not re-gate.
 *  Truncated to 32 hex chars: the space is per-job, so collisions are not a
 *  concern and the column stays readable in the admin decisions tab. */
export function hashGateSubject(subject: unknown): string {
  return createHash("sha256").update(canonicalJson(subject)).digest("hex").slice(0, 32)
}
