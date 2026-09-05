/**
 * The RESULT-gate APPLIER (spec §5.5-§5.6).
 *
 * Separate from `lib/job-policy.ts` so the registry stays a pure,
 * dependency-light thing anything may import, while the applier — which reads
 * the row, moves money, deletes objects and writes the audit — is allowed its
 * dependencies. The direction is one-way: `workers/shared.ts` reaches this
 * module, never the reverse (`markJobCompleted` lives there and this file must
 * not import it, or a hold would re-enter the completion CAS it is bypassing).
 *
 * WHERE IT RUNS. Inside `markJobCompleted`, after the caller's media is already
 * at its deterministic R2 key and BEFORE the completion CAS. So at the moment
 * the gate speaks: no asset row exists and no credit is committed. That is what
 * makes `block` and `hold` cheap — they are mostly the ABSENCE of the next
 * three statements, not a rollback.
 *
 * ONE HALF OF THAT IS NOT FREE: `output_data` is not reliably unwritten. A
 * plugin job read-merges checkpoints into the column mid-run
 * (`tk.jobs.updateJobCheckpoint`), and generate-video-pro persists per-segment
 * R2 URLs and a rolling stitched final there — all owner-readable through
 * GET /v1/jobs/:id. NULL `output_data` is D19's security boundary, so both the
 * block and the hold WRITE the null; declining to write the key would leave the
 * residue in place.
 */
import { supabase } from "./supabase.js"
import { hasAdmin } from "./config.js"
import { markJobFailed, markJobFailedDetailed, type JobFailureOutcome } from "./job-failure.js"
import { IN_FLIGHT_JOB_STATUSES, isParkedJobStatus } from "./job-status.js"
import { refundReservedCreditsForJob } from "./credits-job-lifecycle.js"
import { insertAppReport } from "./app-reports.js"
import { policyBlockHint } from "./safety-block.js"
import {
  ALL_POLICIES_ALLOWED_ID,
  applyJobResultPolicies,
  DEFAULT_RESULT_BLOCK_MESSAGE,
  hasJobPolicyFor,
  HOLD_DOWNGRADED_MESSAGE,
  PLATFORM_POLICY_ID,
  POLICY_UNAVAILABLE_MESSAGE,
  POLICY_UNAVAILABLE_REASON,
  REVIEW_POLICY_ID,
  splitHeldCompletionFields,
  type HeldCommitReplay,
  type JobResultContext,
  type JobResultDecision,
} from "./job-policy.js"
import {
  findReusableDecision,
  hashGateSubject,
  recordJobPolicyDecision,
  setDecisionApplied,
  type DecisionHookPoint,
  type ReusedDecision,
} from "./job-policy-audit.js"
import {
  allOwnedObjects,
  deleteOwnedObjects,
  deleteOwnedOutputObjects,
  extractJobOutputs,
  mediaKindOf,
  ownedHeldObjects,
  type HeldObject,
} from "./job-policy-outputs.js"

export type ResultGateOutcome = "allow" | "blocked" | "held"

interface GateJobRow {
  id: string
  job_type: string | null
  user_id: string | null
  workflow_execution_id: string | null
  pipeline_id: string | null
  parent_job_id: string | null
  provider: string | null
  started_at: string | null
  status: string
  /** What is ALREADY on the row. Normally unwritten at completion time — but a
   *  plugin job read-merges checkpoints into it mid-run (`updateJobCheckpoint`),
   *  so a block has to CLEAR it rather than merely decline to write it. */
  output_data: Record<string, unknown> | null
}

const GATE_ROW_COLUMNS =
  "id, job_type, user_id, workflow_execution_id, pipeline_id, parent_job_id, provider, started_at, status, output_data"

/**
 * The statuses a verdict can still act on: in-flight, minus the parked one. A
 * row outside this set has already been resolved by somebody — us on an earlier
 * attempt, a reviewer, or a concurrent terminal writer.
 *
 * DERIVED, never hand-listed (D14): the hold CAS must not admit `pending_review`
 * (a second gate pass must never re-park an already-parked row), and that is a
 * property of the vocabulary, not a literal to keep in sync by hand.
 */
const LIVE_JOB_STATUSES: readonly string[] = IN_FLIGHT_JOB_STATUSES.filter((s) => !isParkedJobStatus(s))
const isLiveStatus = (status: string): boolean => LIVE_JOB_STATUSES.includes(status)

/** What a single-row read can honestly say. Collapsing the last two into `null`
 *  is what made the gate fail OPEN on a transient DB failure (D20). */
type GateRowRead = { kind: "row"; row: GateJobRow } | { kind: "missing" } | { kind: "failed"; message: string }

/** A CAS says three things, not two: it flipped, it matched nothing, or it
 *  never ran. Only the middle one means "somebody else won". Shared with
 *  `job-failure.ts` rather than re-spelled: the hold's own UPDATE and the
 *  block's `markJobFailed` are the same kind of statement and must be read the
 *  same way. */
type CasOutcome = JobFailureOutcome

/**
 * `hold` is only honest when the platform can (a) keep the job parked without
 * another writer killing it and (b) replay the completion tail on approve.
 * Both fail for whole classes of job, so eligibility is the PLATFORM's
 * computation and never the policy's (D8):
 *
 *  - `funnel === "finalize"` — the only tail that is replayable. The ~44 direct
 *    `markJobCompleted` callers have bespoke post-`ok` side effects (five entity
 *    auto-attaches, the collage character attach, surround's refine-addon
 *    refund) that approve cannot reproduce.
 *  - `hasAdmin()` — an edition with no admin surface has no reviewer, so a hold
 *    there would be a job parked forever. Making that a property of the
 *    PLATFORM beats leaving it an omission a deployment trips over (Q17).
 *  - no `workflow_execution_id` / `pipeline_id` / `parent_job_id` — an
 *    orchestrated, pipeline or child job's lifecycle is owned by something with
 *    its own clock, which would time out around the review.
 *  - not `video-director` — its output IS the child render's already-gated
 *    object.
 *
 * "Internal" is decided by COLUMNS, not by provenance strings: `source='app'`
 * is a developer app token and IS holdable; a `workflow_execution_id` is not.
 */
function computeHoldEligible(row: GateJobRow, funnel: "finalize" | "direct"): boolean {
  return (
    funnel === "finalize" &&
    hasAdmin() &&
    row.workflow_execution_id === null &&
    row.pipeline_id === null &&
    row.parent_job_id === null &&
    row.job_type !== "video-director"
  )
}

async function readGateRow(jobId: string): Promise<GateRowRead> {
  const { data, error } = await supabase.from("jobs").select(GATE_ROW_COLUMNS).eq("id", jobId).single()
  if (error) {
    // PGRST116 is PostgREST's "0 rows for a .single()" — the ONE error that
    // means "no such row". Every other error (a 500 carrying a statement
    // timeout, a 502 from a restarting PostgREST, a 504 from the edge, a 401 on
    // a stale key) is a READ FAILURE, and a read failure is not evidence of
    // anything about the job. The two arrive in the same shape (`data: null`),
    // which is exactly why they have to be told apart here.
    if ((error as { code?: string }).code === "PGRST116") return { kind: "missing" }
    return { kind: "failed", message: error.message ?? "unknown read error" }
  }
  const row = (data as GateJobRow | null) ?? null
  return row ? { kind: "row", row } : { kind: "missing" }
}

/**
 * The gate's one row read, with a single retry.
 *
 * The retry is not belt-and-braces: a failed read now fails CLOSED (D20), and a
 * fail-closed block is user-visible and irreversible (`markJobFailed` is
 * terminal, and the recorded block at that `payload_hash` is what the next
 * stall re-pick reuses). One extra GET on a path that only runs when a policy
 * is registered turns most 502/504 blips back into a normal verdict.
 */
async function loadGateRow(jobId: string): Promise<GateRowRead> {
  const first = await readGateRow(jobId)
  if (first.kind !== "failed") return first
  return await readGateRow(jobId)
}

/** Sum of the job's `usage_logs` rows still `reserved` — the same query shape as
 *  `fetchReservedLogIds` (credits-job-lifecycle.ts:14-21), which is not exported. */
async function reservedCreditsFor(jobId: string): Promise<number | null> {
  const { data } = await supabase
    .from("usage_logs")
    // `credits_used` is the column (001:180) — `credits` is the JOB's field.
    .select("id, credits_used")
    .eq("job_id", jobId)
    .eq("status", "reserved")
  const rows = (data as Array<{ credits_used?: number | null }> | null) ?? null
  if (!rows || rows.length === 0) return null
  return rows.reduce((sum, r) => sum + (typeof r.credits_used === "number" ? r.credits_used : 0), 0)
}

/**
 * Park a completed-but-unpublished job.
 *
 * `held_output_data` and NOT `output_data` is the choice that cannot leak (D6):
 * `output_data` is on `PUBLIC_JOB_KEYS`, in five explicit selects, and is one of
 * the four columns migration 347 grants to `authenticated` — so it also rides
 * the Realtime UPDATE payload. The `held_*` columns are on neither key list, in
 * no select and outside that grant, so a held output is unreachable through
 * PostgREST and through Realtime BY CONSTRUCTION, for admins too. Gating eleven
 * readers on `status === 'pending_review'` would break the first time a new
 * reader forgot.
 *
 * `completed_at` is deliberately NOT set: the row is not terminal.
 */
async function markJobHeld(
  jobId: string,
  fields: Record<string, unknown>,
  held: HeldObject[],
  commitReplay: HeldCommitReplay | undefined,
): Promise<CasOutcome> {
  const { output_data: heldOutput, ...columns } = fields
  const { data, error } = await supabase
    .from("jobs")
    .update({
      status: "pending_review",
      // The work IS done; only publication is pending.
      progress: 100,
      held_output_data: heldOutput ?? null,
      // NOT redundant with declining to write it: a plugin job may already have
      // checkpointed segment URLs into `output_data` mid-run, and those are
      // owner-readable. The park has to CLEAR the column, not skip it. Approve
      // republishes from `held_output_data`, so nothing is lost.
      output_data: null,
      // The caller's own non-output columns (provider, provider_cost,
      // display_cost, provider_task_id, plugin extras) PLUS the non-column
      // settlement inputs (Q2) — approve replays the first set onto the row and
      // hands the second to commitJobCredits. Both live in the jsonb; neither
      // `metered` nor `extraNonProviderCredits` is a jobs column, so they must
      // not reach the UPDATE above.
      held_completion_fields: { ...columns, ...(commitReplay ?? {}) },
      held_objects: held,
      held_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    // Structurally cannot admit pending_review (LIVE_JOB_STATUSES filters the
    // parked one out): a second gate pass must never re-park a parked row.
    .in("status", [...LIVE_JOB_STATUSES])
    .select("id")
  if (error) {
    // A DB error is NOT a lost race. Reporting "a terminal writer won" for a
    // statement timeout sends an operator chasing a race that never happened —
    // and, worse, records `applied=false` for a verdict that simply has not run
    // yet. The row stays live, so the next attempt re-applies it.
    console.error(`[job-policy] hold CAS failed for job ${jobId}: ${error.message}`)
    return "error"
  }
  return Array.isArray(data) && data.length > 0 ? "flipped" : "missed"
}

/** A verdict's CAS matched no row: a concurrent terminal writer (a user cancel)
 *  won. Touch no money, delete nothing, and say so once. */
async function recordLostRace(jobId: string, decisionId: string | null, what: string): Promise<void> {
  await setDecisionApplied(decisionId, false)
  await insertAppReport({
    node: "job-policy",
    kind: "policy-decision-lost-race",
    severity: "warning",
    title: `job ${jobId}: a ${what} verdict flipped no row — a terminal writer won the race`,
    jobId,
  })
}

/**
 * PARK the job — the whole `hold` action, in one place because it is run twice:
 * once for a fresh verdict, and again by the re-apply path when the row shows
 * the first attempt never landed.
 *
 * `applied` is flipped to true only HERE, after the CAS returned a row. The
 * audit INSERT happens before the action on purpose (a crash in between must
 * leave the record), which means the flag it writes cannot yet be a fact.
 */
async function applyHold(
  jobId: string,
  fields: Record<string, unknown>,
  owned: HeldObject[],
  commitReplay: HeldCommitReplay | undefined,
  decisionId: string | null,
  policyId: string | null,
  jobType: string | null,
  userId: string | null,
): Promise<ResultGateOutcome> {
  const parked = await markJobHeld(jobId, fields, owned, commitReplay)
  // The UPDATE never ran. Say nothing, change nothing: the row is still live,
  // so the next completion attempt re-applies this same stored verdict.
  if (parked === "error") return "held"
  if (parked === "missed") {
    await recordLostRace(jobId, decisionId, "hold")
    return "held"
  }
  // Nobody is pushed anything in this repo, so the surface an operator
  // already watches is the report list (Q16). Deduped by app_reports' partial
  // UNIQUE on (kind, job_id).
  await insertAppReport({
    node: "job-policy",
    kind: "policy-hold-pending",
    severity: "info",
    title: `job ${jobId} is awaiting review`,
    payload: { policyId, jobType },
    userId,
    jobId,
  })
  // LAST, so `applied=true` means the whole action completed. A crash mid-tail
  // leaves the flag unset, which is both the honest record and the predicate an
  // operator can sweep on.
  await setDecisionApplied(decisionId, true)
  return "held"
}

/**
 * FAIL the job and undo it — the whole `block` action, run for a fresh verdict,
 * for the D20 fail-closed path, and by the re-apply path.
 *
 * The row keeps every cost column the caller computed — the provider spend is
 * real and the admin needs to see it — and loses the output.
 */
async function applyBlock(
  jobId: string,
  fields: Record<string, unknown>,
  decisionId: string | null,
  policyId: string,
  userMessage: string,
  /** What was ALREADY on the row, when we could read it. */
  rowOutputData: Record<string, unknown> | null,
): Promise<ResultGateOutcome> {
  const { output_data: _withheld, ...columns } = fields
  const flipped = await markJobFailedDetailed(jobId, {
    error_message: userMessage,
    error_hint: policyBlockHint(policyId, userMessage, "result"),
    extra: {
      ...columns,
      // D19's boundary is a NULL `output_data`, and STRIPPING the key is not
      // CLEARING the column: `markJobFailed` writes only the keys it is handed,
      // so an omitted key leaves whatever a mid-run checkpoint already wrote
      // there (generate-video-pro persists `pro.segments[].r2Url` and a rolling
      // `pro.currentFinal.url`, both owner-readable through GET /v1/jobs/:id).
      output_data: null,
      // Not dropped, MOVED: `held_*` is on neither key list in routes/jobs.ts,
      // in none of its five selects and outside 347's column GRANT, so the
      // checkpoint stays available for forensics without being owner-visible.
      ...(rowOutputData ? { held_output_data: rowOutputData } : {}),
    },
  })
  // The same three arms as the hold, for the same reason: a DB error is not a
  // lost race. The UPDATE never ran, so the row is still live and the next
  // completion attempt re-applies this stored verdict — which only works while
  // `applied` stays unset and no lost-race report has been filed.
  if (flipped === "error") return "blocked"
  if (flipped === "missed") {
    await recordLostRace(jobId, decisionId, "block")
    return "blocked"
  }
  // A platform gate's false positives are OURS — a deliberate exception to the
  // "provider delivered ⇒ never refund" doctrine (D19). Money only ever moves
  // behind the CAS boolean.
  await refundReservedCreditsForJob(jobId)
  // Both sources, uncapped: what the caller was about to publish AND whatever a
  // mid-run checkpoint already wrote onto the row. `held_objects`' cap is a
  // review-UI bound; applying it here would leave a 25-segment job's tail live
  // at its public keys forever.
  await deleteOwnedOutputObjects(jobId, fields.output_data as Record<string, unknown> | undefined, rowOutputData)
  // LAST, for the same reason as the hold: a row that is `failed` with a
  // policy-block hint while its decision still says `applied IS NULL` is a
  // block whose CAS landed and whose refund did not — the one residue this
  // change does not itself repair, made findable instead of invisible.
  await setDecisionApplied(decisionId, true)
  return "blocked"
}

/**
 * The user-visible sentence for a block we are RE-applying.
 *
 * `reason` IS NOT A CANDIDATE HERE, at any point in this function. It is the
 * policy's machine text — `nsfw_score=0.98 label=explicit` — and D13 is flat
 * about it: the reason is for the audit log, only `userMessage` is ever shown
 * to a user. A re-applied block writes `error_message` and `error_hint.reason`,
 * both on PUBLIC_JOB_KEYS, so anything this returns lands on the owner's canvas
 * verbatim. Migration 380 added `user_message` precisely so that the sentence
 * the FIRST application showed can be reproduced instead of guessed at.
 *
 * The order matters, and the two platform checks come first ON PURPOSE: they
 * are the compatibility path for a decision recorded BEFORE 380, where
 * `userMessage` is null and the stored row still identifies itself — a
 * `platform` verdict is an outage rather than a moral judgement, and a
 * downgraded hold's `reason` is raw scores nobody was ever going to be shown.
 *
 * The final fallback is DEFAULT_RESULT_BLOCK_MESSAGE and not
 * POLICY_UNAVAILABLE_MESSAGE:
 * a pre-380 row from a real policy block was a genuine content decision, and
 * relabelling it "could not be verified" would tell the user the platform
 * failed when it did not.
 */
function storedBlockMessage(reused: ReusedDecision): string {
  if (reused.policyId === PLATFORM_POLICY_ID) return POLICY_UNAVAILABLE_MESSAGE
  if (reused.holdDowngraded) return HOLD_DOWNGRADED_MESSAGE
  // `||` and not `??`: an empty or whitespace-only stored string is not a
  // sentence, and printing it would leave the user a blank explanation.
  return reused.userMessage?.trim() || DEFAULT_RESULT_BLOCK_MESSAGE
}

/**
 * The far end's job id for the row being gated, off the completion `fields`.
 *
 * `lib/job-finalize.ts` merges `relayFieldsFrom(result)` into `fields` BEFORE
 * the gate runs, so a relayed completion carries `relay_job_id` here. It is a
 * server-written column (migration 383 grants no UPDATE on it), never caller
 * input — which is what lets `ownedHeldObjects` widen the accepted key stem
 * without turning the review preview into a read-anything proxy.
 */
function relayStemOf(fields: Record<string, unknown>): string | null {
  const value = fields.relay_job_id
  return typeof value === "string" && value ? value : null
}

/**
 * A stored `block`/`hold` was found for this exact payload. Whether it was ever
 * APPLIED is a question about the JOB ROW, not about the audit table.
 *
 * The audit row is written before the action, so a process that dies in that
 * one-round-trip window — or a CAS that errored — leaves a verdict on record
 * and a row still `processing` with its credits reserved. Returning that
 * verdict blindly is what stranded the job forever: finalize returns
 * `{ok:false}`, no reconcile caller inspects it, `reconcile_attempts` never
 * moves, the row is never failed, never parked, never refunded, and is
 * invisible to both the review queue and the hold-expiry sweep.
 *
 * So: re-apply the STORED verdict (never re-ask the policy — D24's no-re-pay
 * rule is the part that matters, and it is untouched) through the same
 * idempotent CAS, and only when the row is still live.
 */
async function reapplyStoredVerdict(
  jobId: string,
  fields: Record<string, unknown>,
  commitReplay: HeldCommitReplay | undefined,
  reused: ReusedDecision,
): Promise<ResultGateOutcome> {
  const stored: ResultGateOutcome = reused.verdict === "block" ? "blocked" : "held"
  const read = await loadGateRow(jobId)
  // Unreadable or gone: return the stored verdict and write nothing. Both are
  // already fail-closed (nothing is published either way), and a second audit
  // row at the same hash would be a lie.
  if (read.kind !== "row") return stored
  // The verdict landed, or something terminal won: D24 in full — RETURNED,
  // never re-applied. No CAS against an already-failed row, no `applied=false`
  // and no `policy-decision-lost-race` report on every stall re-pick.
  if (!isLiveStatus(read.row.status)) return stored

  if (reused.verdict === "hold") {
    const outputData = (fields.output_data as Record<string, unknown> | undefined) ?? {}
    // The relay stem too — under the shared-bucket passthrough the output key
    // is the FAR job's, and without it this re-apply re-writes the same empty
    // held_objects the fresh verdict would have.
    const owned = ownedHeldObjects(jobId, extractJobOutputs(outputData), undefined, relayStemOf(fields))
    return await applyHold(jobId, fields, owned, commitReplay, reused.id, reused.policyId, read.row.job_type, read.row.user_id)
  }
  return await applyBlock(jobId, fields, reused.id, reused.policyId, storedBlockMessage(reused), read.row.output_data)
}

/**
 * D20 on the one input the gate cannot do without.
 *
 * A read failure is not a missing row. The caller's completion CAS is a
 * SEPARATE request that succeeds against the still-`processing` row, so
 * answering `"allow"` here publishes unmoderated output — the exact outcome
 * this feature exists to prevent — on nothing worse than one 500 from a
 * statement timeout.
 *
 * The verdict is `block` and not `hold`: `holdEligible` is unknowable without
 * the row (four of D8's six conditions are columns), and unknown eligibility is
 * NOT eligible — a hold guessed from the two facts we do have would park a
 * workflow or pipeline child in `pending_review`, the lane D8 exists to
 * exclude. The identity and the wording are the PLATFORM's, so an outage never
 * reads as a moral judgement.
 */
async function failClosedOnUnreadableRow(
  jobId: string,
  fields: Record<string, unknown>,
  payloadHash: string,
  message: string,
): Promise<ResultGateOutcome> {
  console.error(`[job-policy] result gate: could not read job ${jobId} (${message}) — failing closed (D20)`)
  const decisionId = await recordJobPolicyDecision({
    jobId,
    hookPoint: "result",
    policyId: PLATFORM_POLICY_ID,
    verdict: "block",
    reason: POLICY_UNAVAILABLE_REASON,
    userMessage: POLICY_UNAVAILABLE_MESSAGE,
    payloadHash,
    applied: null,
    userId: null,
    jobType: null,
  })
  return await applyBlock(jobId, fields, decisionId, PLATFORM_POLICY_ID, POLICY_UNAVAILABLE_MESSAGE, null)
}

/**
 * Run the result gate and APPLY its verdict.
 *
 * Returns `"allow"` when the caller should proceed with its own completion CAS.
 * NEVER throws: every failure path resolves to a verdict (D20/D21), because a
 * throw here would turn a moderation hiccup into a BullMQ retry against a row
 * whose media is already uploaded.
 */
export async function applyResultGate(
  jobId: string,
  fields: Record<string, unknown>,
  funnel: "finalize" | "direct",
  commitReplay?: HeldCommitReplay,
): Promise<ResultGateOutcome> {
  // 1. Fast path (I1): no row read, no audit row, no allocation.
  if (!hasJobPolicyFor("result")) return "allow"

  const outputData = (fields.output_data as Record<string, unknown> | undefined) ?? {}
  const payloadHash = hashGateSubject(outputData)

  // 2. Idempotency: a BullMQ stall re-pick, the inline reconcile and the
  //    reconcile cron all re-derive the SAME output_data, so the stored verdict
  //    is reused rather than re-asking (and re-paying for) the check (D24). An
  //    `allow`/`flag` hit costs no row read at all; a `block`/`hold` hit reads
  //    the row once to answer the OTHER question — did that verdict ever
  //    actually take effect?
  const reused = await findReusableDecision(jobId, "result", payloadHash)
  if (reused) {
    if (reused.verdict === "block" || reused.verdict === "hold") {
      return await reapplyStoredVerdict(jobId, fields, commitReplay, reused)
    }
    return "allow"
  }

  const read = await loadGateRow(jobId)
  if (read.kind === "missing") {
    // A CONFIRMED absent row: nothing to gate and nothing to hold, and the
    // caller's own CAS will miss too.
    console.warn(`[job-policy] result gate: job ${jobId} not found`)
    return "allow"
  }
  if (read.kind === "failed") return await failClosedOnUnreadableRow(jobId, fields, payloadHash, read.message)
  const row = read.row

  const outputs = extractJobOutputs(outputData)
  const ctx: JobResultContext = {
    jobId,
    jobType: row.job_type,
    mediaKind: mediaKindOf(outputData),
    userId: row.user_id,
    statusToBe: "completed",
    outputData,
    outputs,
    creditsReserved: await reservedCreditsFor(jobId),
    provider: (fields.provider as string | undefined) ?? row.provider,
    durationMs: row.started_at ? Date.now() - new Date(row.started_at).getTime() : null,
    holdEligible: computeHoldEligible(row, funnel),
    funnel,
  }

  const startedAt = Date.now()
  const decision: JobResultDecision = await applyJobResultPolicies(ctx)
  const latencyMs = Date.now() - startedAt

  // The user-facing sentence, resolved ONCE and read twice: the audit row below
  // records it and `applyBlock` puts it on the job. Deriving it separately in
  // the two places is how they would drift, and a drifted audit row is exactly
  // what a re-apply then reproduces.
  // `decision.reason` IS NOT A CANDIDATE, here or anywhere: `applyJobResultPolicies`
  // already resolved every block's sentence to the policy's own `userMessage`
  // or to the platform's, so the only thing left to guard is a decision shape
  // that carries neither (a `flag`/`hold`, whose sentence is never shown).
  const userMessage = decision.userMessage ?? DEFAULT_RESULT_BLOCK_MESSAGE

  // 3. The audit row is written BEFORE the action, so a crash in between leaves
  //    the record and the retry's idempotency lookup finds it — and, finding a
  //    row that is still live, re-applies the verdict instead of re-asking for
  //    it. `applied` stays unset until a CAS actually flips something: the
  //    record must not claim an action that has not happened yet.
  const decisionId = await recordJobPolicyDecision({
    jobId,
    hookPoint: "result",
    // An `allow` has no single deciding policy — every registered one agreed.
    policyId: decision.policyId ?? (decision.verdict === "allow" ? ALL_POLICIES_ALLOWED_ID : PLATFORM_POLICY_ID),
    verdict: decision.verdict,
    reason: decision.reason ?? null,
    // ONLY a block. A hold shows the owner nothing — it parks the job behind
    // the "Awaiting review" overlay — so `applyJobResultPolicies` leaves its
    // `userMessage` unset and the local above would resolve it to the generic
    // block sentence. Recording THAT would claim the owner was told something
    // they were not, so a hold records NULL: honest, and nothing downstream can
    // mistake it for a sentence a re-apply should reproduce.
    userMessage: decision.verdict === "block" ? userMessage : null,
    labels: decision.labels ?? null,
    payloadHash,
    applied: null,
    holdDowngraded: decision.holdDowngraded ?? false,
    userId: row.user_id,
    jobType: row.job_type,
    latencyMs,
  })

  if (decision.verdict === "allow" || decision.verdict === "flag") return "allow"

  if (decision.verdict === "hold") {
    // A relayed output's key stem is the FAR job's id, so without this the
    // fence drops every one of them and the reviewer gets an empty preview
    // for media they must decide on (spec §9.2 + the result gate's D7).
    const owned = ownedHeldObjects(jobId, outputs, undefined, relayStemOf(fields))
    return await applyHold(jobId, fields, owned, commitReplay, decisionId, decision.policyId ?? null, row.job_type, row.user_id)
  }

  return await applyBlock(
    jobId,
    fields,
    decisionId,
    decision.policyId ?? PLATFORM_POLICY_ID,
    userMessage,
    row.output_data,
  )
}

/**
 * The shared "this held job is not going to be published" primitive: reject and
 * the TTL expiry are the same three writes with a different `policy_id` and
 * reason, and the user cancel is the same shape with `cancelled` instead of
 * `failed`.
 *
 * Order is deliberate — CAS first, money only if a row flipped, object deletion
 * LAST. A delete before the CAS would destroy the media of a job somebody else
 * just approved.
 *
 * Lives here rather than in `job-policy-review.ts` so the reconcile sweep can
 * reach it without importing `job-finalize.ts` (which imports `workers/shared.js`
 * and with it sharp / youtube-dl-exec / @remotion).
 */
export interface HeldRejectionInput {
  /** USER-SAFE — it lands on `error_hint.reason`, which is on PUBLIC_JOB_KEYS
   *  and reaches the owner's canvas verbatim. */
  readonly userMessage: string
  /** MACHINE text for the audit row. */
  readonly machineReason: string
  readonly policyId: string
  readonly hookPoint: DecisionHookPoint
  readonly verdict: "reject" | "withdrawn"
  readonly resolverUserId?: string | null
  readonly resolverEmail?: string | null
}

/** `refunded` is the number of `usage_logs` rows the refund actually moved —
 *  0 when the reservation was already settled (the smart-loop-cut path commits
 *  at reserved-minus-addon BEFORE the gate speaks, so a later rejection has
 *  nothing left to return). Callers that TELL the user their credits came back
 *  must read it: the user-facing sentence is written by the CAS above, before
 *  the refund runs, so only the caller can correct a promise that turned out
 *  to be false. */
export type HeldResolution =
  | { ok: true; refunded: number }
  | { ok: false; reason: "not_found" | "not_held" | "lost_race" }

export async function rejectHeldJobRow(jobId: string, input: HeldRejectionInput): Promise<HeldResolution> {
  const { data } = await supabase
    .from("jobs")
    // `held_output_data` comes along for the DELETE, not for the reply: it is
    // the complete withheld payload, while `held_objects` is the review UI's
    // bounded list. Deleting only the latter would strand the tail of a job
    // that produced more owned objects than a human would page through.
    .select("id, status, held_completion_fields, held_objects, held_output_data, user_id")
    .eq("id", jobId)
    .single()
  const row = data as
    | {
        id: string
        status: string
        held_completion_fields: Record<string, unknown> | null
        held_objects: HeldObject[] | null
        held_output_data: Record<string, unknown> | null
        user_id: string | null
      }
    | null
  if (!row) return { ok: false, reason: "not_found" }
  if (row.status !== "pending_review") return { ok: false, reason: "not_held" }

  const flipped = await markJobFailed(jobId, {
    error_message: input.userMessage,
    // hookPoint is the GATE point the hint describes; a reviewer's rejection is
    // a decision about a RESULT (PolicyBlockHint admits only request|result).
    error_hint: policyBlockHint(input.policyId, input.userMessage, "result"),
    // The held jsonb carries the caller's real columns AND the non-column
    // settlement inputs (metered / meteredCost / extraNonProviderCredits).
    // Spreading it whole would send `metered` as a jobs column, PostgREST would
    // refuse the UPDATE, markJobFailed would return false — and the reject
    // would answer "lost_race" while the row sat parked forever.
    extra: {
      ...splitHeldCompletionFields(row.held_completion_fields).columns,
      // Symmetry with the block path: a rejected row publishes nothing, and the
      // column may carry a mid-run checkpoint the park cleared.
      output_data: null,
      held_output_data: null,
      held_completion_fields: null,
      held_objects: null,
    },
    // The ONE caller that may fail a parked row.
    from: ["pending_review"],
  })
  if (!flipped) return { ok: false, reason: "lost_race" }

  const refunded = await refundReservedCreditsForJob(jobId)
  await deleteOwnedObjects(jobId, [...(row.held_objects ?? []), ...allOwnedObjects(jobId, row.held_output_data)])
  await recordJobPolicyDecision({
    jobId,
    hookPoint: input.hookPoint,
    policyId: input.policyId,
    verdict: input.verdict,
    reason: input.machineReason,
    // The sentence the reject/expiry just wrote onto `error_message`.
    userMessage: input.userMessage,
    applied: true,
    userId: row.user_id,
    resolverUserId: input.resolverUserId ?? null,
    resolverEmail: input.resolverEmail ?? null,
  })
  return { ok: true, refunded }
}

/**
 * The user's own cancel of a held job (D17). Same shape as a rejection but the
 * row goes to `cancelled`, not `failed`: the user withdrew it, nothing failed.
 * Exposed here so `lib/cancel-job.ts` gets the refund + object cleanup + audit
 * without re-deriving them.
 */
export async function withdrawHeldJob(jobId: string): Promise<HeldResolution> {
  const { data } = await supabase
    .from("jobs")
    .select("id, status, held_objects, held_output_data, user_id")
    .eq("id", jobId)
    .single()
  const row = data as
    | { id: string; status: string; held_objects: HeldObject[] | null; held_output_data: Record<string, unknown> | null; user_id: string | null }
    | null
  if (!row) return { ok: false, reason: "not_found" }
  if (row.status !== "pending_review") return { ok: false, reason: "not_held" }

  const { data: flipped } = await supabase
    .from("jobs")
    .update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
      held_output_data: null,
      held_completion_fields: null,
      held_objects: null,
    })
    .eq("id", jobId)
    .in("status", ["pending_review"])
    .select("id")
  if (!Array.isArray(flipped) || flipped.length === 0) return { ok: false, reason: "lost_race" }

  const refunded = await refundReservedCreditsForJob(jobId)
  await deleteOwnedObjects(jobId, [...(row.held_objects ?? []), ...allOwnedObjects(jobId, row.held_output_data)])
  await recordJobPolicyDecision({
    jobId,
    hookPoint: "review",
    policyId: REVIEW_POLICY_ID,
    verdict: "withdrawn",
    reason: "cancelled by the job owner",
    applied: true,
    userId: row.user_id,
  })
  return { ok: true, refunded }
}
