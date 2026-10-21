/**
 * Cancel ONE job the caller owns — the single-job cancel route's body, lifted
 * so a parent can cancel a child it spawned through the exact CAS + refund
 * path the route uses. First consumer: `POST /v1/llm/structured/jobs` parents
 * cancelling their `video-analysis` child (`input_data.analysisJobId`).
 *
 * Ownership is verified here, not assumed. The decision table is the route's:
 *   - unknown row → not_found; another owner → forbidden;
 *   - terminal row → invalid_status;
 *   - row parked in review → withdrawn (refund + delete the withheld object +
 *     record the decision), never in_flight;
 *   - provider task already out and not in recovery → in_flight (cannot be
 *     killed; the user keeps what they paid for);
 *   - otherwise: best-effort queue removal, CAS flip to `cancelled` on live
 *     statuses only (never the parked one — a row parked while we emptied the
 *     queue re-enters the withdrawal instead of being flipped), refund ONLY
 *     when we flipped the row (a concurrent terminal writer owns the credits),
 *     and the analysis child id if any. A use-case wrapper's hidden run is
 *     cancelled with it.
 */
import { supabase } from "./supabase.js"
import { tryRemoveFromQueue } from "./queue.js"
import { IN_FLIGHT_JOB_STATUSES, isParkedJobStatus } from "./job-status.js"

export type CancelOwnedJobResult =
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "invalid_status"; status: string }
  | { kind: "in_flight" }
  | { kind: "lost_race" }
  | { kind: "cancelled"; analysisJobId: string | null }

/**
 * Every in-flight status, `pending_review` included (spec D17).
 *
 * Derived, never hand-rolled: a re-declared list silently omits `pending_review`
 * and the omission is invisible — the API answers 400 "cannot be cancelled"
 * while `node-executor.ts`'s DAG cancel flips the same row anyway. A
 * reservation must not be strandable behind a reviewer's SLA.
 */
const CANCELLABLE_STATUSES = IN_FLIGHT_JOB_STATUSES

/**
 * The statuses the GENERIC CAS below may flip straight to `cancelled` — every
 * in-flight status EXCEPT the parked one. A different question from
 * `CANCELLABLE_STATUSES` above, and the two must not share an answer.
 *
 * A parked row is cancellable, but only through `withdrawHeldJob`, which also
 * deletes the withheld objects, clears the `held_*` columns and records the
 * `withdrawn` decision. The read at :81 decides which path to take, and the
 * work in between — two BullMQ `getJobs` sweeps plus a dynamic import — is long
 * enough for the result gate to park the row underneath us. Admitting
 * `pending_review` here would let the generic UPDATE win that race and cancel
 * the row with none of the three.
 */
const FLIPPABLE_STATUSES: readonly string[] = IN_FLIGHT_JOB_STATUSES.filter((s) => !isParkedJobStatus(s))

/**
 * Refund every reserved credit hold for the given job IDs — the ONE refund
 * path both cancel flows use (`cancelOwnedJob` passes a single id, the
 * `cancel-all` route passes the whole batch it flipped in one query).
 *
 * Without this, cancelling a job leaves its `usage_logs` row stuck at
 * `status='reserved'` forever — the user's balance was decremented when the
 * job was reserved but never restored. Net effect: silent credit theft on
 * every cancellation.
 *
 * Best-effort — `CreditsService.refundCredits` already short-circuits on rows
 * that aren't `status='reserved'` (see PR #1502), so it's safe if the worker
 * happens to commit/refund the same row concurrently. `ee/` is reached through
 * a dynamic import (core may not import it statically; the route that used to
 * own this copy is allowlisted, `lib/` is not — `credits-job-lifecycle.ts`
 * does the same).
 */
export async function refundReservedHolds(
  jobIds: string[],
  /** Ids whose metered holds the caller already ran through {@link settleMeteredHoldsBeforeCancel} (before its flip). */
  opts: { meteredSettled?: ReadonlySet<string> } = {},
): Promise<void> {
  if (jobIds.length === 0) return
  try {
    await refundJobsOwnHolds(jobIds, opts)
  } finally {
    // 554: the jobs' metered SIDE holds (a call a job made beside its own
    // reservation — a UGC clip's frame check) are no hold OF the job: their
    // usage logs carry no job, so nothing above reads them and the job's own
    // decision is unchanged. Each is settled on its own call-start marker,
    // after the flip (this runs after it): not started → its noted actual or
    // a refund; started → kept for its worker's settle. Never throws.
    const { settleSideHoldsAfterFlip } = await import("./llm-side-hold.js")
    await settleSideHoldsAfterFlip(jobIds)
  }
}

async function refundJobsOwnHolds(jobIds: string[], opts: { meteredSettled?: ReadonlySet<string> }): Promise<void> {
  const { data: usageLogs, error } = await supabase
    .from("usage_logs")
    .select("id, job_id, action")
    .in("job_id", jobIds)
    .eq("status", "reserved")
  if (error) {
    // Silently refunding nothing would leave the hold `reserved` forever.
    console.error(`[cancel-job] Failed to read reserved holds for ${jobIds.join(",")}:`, error)
    return
  }
  if (!usageLogs || usageLogs.length === 0) return
  const rows = usageLogs as Array<{ id: string; job_id?: string | null; action?: unknown }>
  // D10, per job (cancel-all passes a batch): a billed metered hold is
  // committed, never refunded. This runs AFTER the flip, where a hold that
  // could not be settled is no longer the sweep's — it is left reserved and
  // reported, and only the job's other holds are refunded. A committed hold is
  // skipped by the refund itself (it refunds `reserved` rows only).
  const { parseMeteredLlmId } = await import("../ee/billing/metered-llm-id.js")
  const { ledgerBilled, ledgerInFlight } = await import("../ee/billing/llm-cancel-settle.js")
  const { holdCanCarryLlmLedger } = await import("./llm-ledger-holds.js")
  const unchecked = [...new Set(rows.flatMap((r) => (typeof r.job_id === "string" ? [r.job_id] : [])))]
    .filter((jobId) => !opts.meteredSettled?.has(jobId))
  // Each job's billing evidence, from what this batch ALREADY read — a metered
  // hold id from the rows above, else its ledger from ONE jobs read — handed to
  // the settle so nothing is re-read (a re-read that failed would refund).
  const evidence = new Map<string, MeteredBillingEvidence>()
  const meteredHoldJobs = new Set(
    rows.flatMap((r) => (typeof r.job_id === "string" && typeof r.action === "string" && parseMeteredLlmId(r.action) !== null ? [r.job_id] : [])),
  )
  // R63: the ledger is read ONLY for a job holding a hold that can carry one
  // (a fixed + calls scrape hold, `lib/llm-ledger-holds.ts`). Every other
  // job's holds — an image, a video, a tier id — refund exactly as before,
  // with no ledger read, so no read failure can keep them.
  const ledgerCapableJobs = new Set(
    rows.flatMap((r) => (typeof r.job_id === "string" && holdCanCarryLlmLedger(r.action, parseMeteredLlmId) ? [r.job_id] : [])),
  )
  const ledgerUnread = unchecked.filter((jobId) => !meteredHoldJobs.has(jobId) && ledgerCapableJobs.has(jobId))
  for (const jobId of unchecked) if (meteredHoldJobs.has(jobId)) evidence.set(jobId, "metered-hold")
  if (ledgerUnread.length > 0) {
    // The server-only ledger column (R32), through its helper — the batch read
    // retried once, then each job read on its own before any is declared
    // unknown (one failed batch read must not keep every job's hold).
    const { readLlmBillingLedgers } = await import("./llm-billing-ledger.js")
    let read = await readLlmBillingLedgers(ledgerUnread)
    if (!read.ok) read = await readLlmBillingLedgers(ledgerUnread)
    if (!read.ok) {
      console.warn(`[cancel-job] the batch ledger read failed twice (${read.error}) — reading each job's evidence on its own`)
      for (const jobId of ledgerUnread) {
        // An unread ledger is never refunded on a guess (D10): `unknown` keeps
        // and reports the hold wherever the metered schema exists.
        const own = await meteredBillingEvidence(jobId)
        if (own !== "none") evidence.set(jobId, own)
      }
    } else {
      for (const [jobId, ledger] of read.ledgers) {
        // A call in flight (the scrapes' call-start marker) is evidence too: never refunded under it.
        if (ledgerBilled(ledger) || ledgerInFlight(ledger)) evidence.set(jobId, "billed-ledger")
      }
    }
  }
  const meteredJobs = [...evidence.keys()]
  const keep = new Set<string>()
  for (const jobId of meteredJobs) {
    if ((await settleMeteredHoldsBeforeCancel(jobId, { evidence: evidence.get(jobId), afterFlip: true })) === "retry") {
      await reportKeptHoldOnCancel(jobId, evidence.get(jobId))
      keep.add(jobId)
    }
  }
  const refundable = rows.filter((r) => !(typeof r.job_id === "string" && keep.has(r.job_id)))
  if (refundable.length === 0) return
  const { CreditsService } = await import("../ee/billing/credits.js")
  await Promise.all(
    refundable.map((row) =>
      CreditsService.refundCredits(row.id).catch((err: unknown) =>
        console.error(`[cancel-job] Failed to refund usage_log ${row.id}:`, err),
      ),
    ),
  )
}

/**
 * A cancelled job's metered hold that could not be settled at the cancel is
 * kept reserved — never refunded (D10), never silent: an app report (one per
 * job: the (kind, job_id) index). It is not stranded: the worker still running
 * the job settles it when its call ends (R38), and the reconcile sweep settles
 * a cancelled row's reserved metered hold from its ledger after the grace
 * (`lib/reconcile/cancelled-metered-holds.ts`).
 */
async function reportKeptHoldOnCancel(jobId: string, evidence: MeteredBillingEvidence | undefined): Promise<void> {
  console.warn(`[cancel-job] cancelled job ${jobId}: its metered LLM hold is kept (a call may be in flight) — settled at the actual by the worker or the sweep, never refunded on a guess`)
  const { insertAppReport } = await import("./app-reports.js")
  await insertAppReport({
    node: "llm-billing-cancel",
    kind: "metered-hold-unsettled-on-cancel",
    // A warning, not an error (R38): the hold is not stranded — the worker or
    // route running the call settles it at the actual, the reconcile sweep's
    // cancelled-hold pass otherwise (an error is filed there at its cap).
    severity: "warning",
    title: `Cancelled metered LLM job ${jobId}: hold kept — settled by the worker or sweep`,
    // billed-unknown (R36): its provider call had started with nothing billed recorded yet.
    payload: { jobId, verdict: evidence === "unknown" ? "evidence-unreadable" : "billed-or-billed-unknown" },
    jobId,
  })
}

/**
 * R38 / N1, for a pre-flip cancel whose verdict was `not-started` (nothing in
 * flight: the worker's pre-call marker was on the row, or it was never
 * stamped). Nothing was committed before the flip — the worker may have
 * cleared its marker and sent its call between that read and the flip, and a
 * commit made while the row was live would have charged an earlier attempt's
 * actual and left the new call's cost uncollected. Once the row is cancelled
 * the worker's own CAS can no longer start a call, so this read is
 * authoritative:
 *  - `kept` — the call started meanwhile (or may have): the caller must NOT
 *    refund the job's holds (kept and reported; the worker settles them at the
 *    actual when its call ends, the sweep otherwise);
 *  - `settled` — nothing in flight, and what an earlier attempt billed was
 *    charged at its actual (the rest released): the caller refunds only what
 *    is still reserved, never through a metered settle again;
 *  - `refund` — nothing billed: refund as the cancel planned.
 */
export async function settleMeteredHoldAfterFlip(jobId: string): Promise<"kept" | "settled" | "refund"> {
  const evidence = await meteredBillingEvidence(jobId)
  const verdict = await settleMeteredHoldsBeforeCancel(jobId, { evidence, afterFlip: true })
  if (verdict === "settled") return "settled"
  if (verdict !== "retry") return "refund"
  await reportKeptHoldOnCancel(jobId, evidence)
  return "kept"
}

/**
 * A cancel's metered rule (D10: never refund a billed metered call; R45/D14:
 * never commit a hold WHOLE because something billed — the actual is charged,
 * the rest released):
 *  - `not-metered` — no metered hold: refund as before;
 *  - `not-started` (R38) — nothing in flight (never stamped, or still
 *    pre-call). BEFORE the flip nothing is settled (N1): the worker could
 *    still clear its marker and send its call before the flip lands — the
 *    caller flips, then settles through {@link settleMeteredHoldAfterFlip}
 *    (or `refundReservedHolds` without `meteredSettled`). After the flip
 *    (`afterFlip`): nothing billed — refund. A fixed-price hold with a billed
 *    ledger (a scrape's analyses) answers `not-started` before the flip too;
 *    after it, its ledger is committed (`settled`);
 *  - `settled` — after the flip only: nothing in flight, and what the row
 *    billed (an earlier attempt's calls) was charged at its ACTUAL (R45):
 *    refund what remains;
 *  - `retry` — a call may be in flight (started, or unreadable: R36), or a
 *    settle was not confirmed. The hold is never committed whole here: before
 *    the flip the caller leaves the job live (its own settle charges the
 *    actual); after one the hold is kept — the worker or route settles it at
 *    the actual, the reconcile sweep otherwise — and reported.
 * `known.reconcile_*` is accepted for the callers' convenience and unused.
 */
export async function settleMeteredHoldsBeforeCancel(
  jobId: string,
  known?: {
    reconcile_attempts?: number | null
    reconcile_last_error?: string | null
    /** The job's billing evidence when the caller already read it (cancel-all's batch): not re-read. */
    evidence?: MeteredBillingEvidence
    /**
     * The row is already cancelled (N1): only then may a hold with nothing in
     * flight be settled at its actual. Before the flip the worker's call-start
     * CAS can still win, so nothing is committed.
     */
    afterFlip?: boolean
  },
): Promise<"not-metered" | "not-started" | "settled" | "retry"> {
  const config = await import("./config.js")
  if (!config.hasCredits()) return "not-metered"
  // Only a job with metered billing evidence goes near the sweep's rule: a
  // reserved hold under a metered id, or a billed ledger on the row. Every
  // other job keeps today's cancel exactly (no reconcile_attempts bump).
  const evidence = known?.evidence ?? (await meteredBillingEvidence(jobId))
  if (evidence === "none") return "not-metered"
  if (evidence === "unknown") {
    // The evidence could not be read. Wherever a metered hold CAN exist — the
    // metered schema is present, whatever the pricing switch says (R15: a hold
    // reserved before a rollback flip is still metered) — a billed one may be
    // behind it, so it is never refunded on a guess (D10): `retry` — before a
    // flip the job is left live; after one the hold is kept and reported. Only
    // a database without the metered schema (no metered hold can exist) keeps
    // today's cancel. Asked of the database now, not the cached gate: a fresh
    // process answers "not ready" until its first probe lands, and here that
    // answer would refund.
    const { probeLlmMeteredSchemaNow } = await import("./llm-metered-schema-gate.js")
    if (!(await probeLlmMeteredSchemaNow())) return "not-metered"
    console.error(`[cancel-job] job ${jobId}: its billing evidence could not be read — its hold is kept (never refunded on a guess)`)
    if (known?.evidence === undefined) {
      // A pre-flip cancel (user cancel, the DAG's, the resume's) leaves the job
      // live for the sweep — reported so the kept hold is never silent. The
      // post-flip batch files its own report (`metered-hold-unsettled-on-cancel`).
      const { insertAppReport } = await import("./app-reports.js")
      await insertAppReport({
        node: "llm-billing-cancel",
        kind: "metered-cancel-evidence-unreadable",
        severity: "warning",
        title: `Cancel of job ${jobId}: its billing evidence could not be read — the job was left live and its hold kept`,
        payload: { jobId },
        jobId,
      })
    }
    return "retry"
  }
  if (evidence === "billed-ledger") {
    // A FIXED-price hold carrying billed metered calls (the Meta Ads /
    // Instagram scrapes' per-item analysis: one usage log under the scrape id,
    // the calls' spend in the server-only billing ledger): the LEDGER decides. What was
    // billed is committed — the spend recorded so far, or the hold whole when
    // the ledger cannot be priced — never refunded.
    // N1 (the same race as the metered hold's): never committed while the row
    // is live — the scrape may record another billed analysis between this
    // read and the flip, and a commit made now would leave it uncollected.
    // Before the flip: `not-started` (nothing committed; the caller flips, then
    // settles through `settleMeteredHoldAfterFlip` / `refundReservedHolds`).
    if (!known?.afterFlip) return "not-started"
    const { settleBilledLedgerBeforeCancelImpl } = await import("../ee/billing/llm-cancel-settle.js")
    return settleBilledLedgerBeforeCancelImpl(jobId)
  }
  // R45 (D14): a cancel never commits a metered hold WHOLE because something
  // billed. Whether a call may be in flight decides:
  //  - started (a sync route's stamp right before its call, or a worker's
  //    stamp WITHOUT its pre-call marker, R38) or unreadable → a call may be
  //    in flight, its spend not on the row yet: `retry` — the hold is kept
  //    for the worker / route that runs it to settle at the actual (R38), or
  //    for the reconcile sweep (D10: never refunded on a guess). Before a
  //    flip the job is left live; after one the hold is kept and reported.
  //  - not started (never stamped, or still pre-call) → nothing is in
  //    flight: what the row recorded billed (an earlier BullMQ attempt's
  //    calls) is charged at its ACTUAL — D1: it may exceed the hold — and the
  //    rest of the hold is released; a hold nothing billed is refunded
  //    (`not-started`).
  const { readLlmCallStart } = await import("./llm-billing-ledger.js")
  const started = await readLlmCallStart(jobId)
  if (started !== "not-started") {
    console.warn(
      `[cancel-job] job ${jobId}: its metered call ${started === "started" ? "has started" : "may have started (unreadable)"} — ` +
        `the hold is kept for its own settle at the actual (never committed whole, never refunded on a guess)`,
    )
    return "retry"
  }
  // N1: never a commit while the row is live — the caller settles after its flip.
  if (!known?.afterFlip) return "not-started"
  return settleMeteredHoldsAtActual(jobId)
}

/**
 * R45: a metered job with nothing in flight — its reserved metered holds
 * settled from what its ROW recorded billed (`meteredSpendFromRow`), at the
 * actual (`settleLlmUsageLog`: D1's metered commit, the rest released).
 * `settled` — a billed hold was charged; `not-started` — nothing billed: the
 * caller refunds; `retry` — the row or the holds could not be read, or a
 * settle was not confirmed: never refunded on a guess.
 */
async function settleMeteredHoldsAtActual(jobId: string): Promise<"not-started" | "settled" | "retry"> {
  const { data: logs, error } = await supabase
    .from("usage_logs")
    .select("id, action")
    .eq("job_id", jobId)
    .eq("status", "reserved")
  if (error) {
    console.warn(`[cancel-job] could not read the holds of job ${jobId}: ${error.message}`)
    return "retry"
  }
  const { parseMeteredLlmId } = await import("../ee/billing/metered-llm-id.js")
  const metered = ((Array.isArray(logs) ? logs : []) as Array<{ id?: unknown; action?: unknown }>).flatMap((l) =>
    typeof l.id === "string" && typeof l.action === "string" && parseMeteredLlmId(l.action) !== null ? [{ id: l.id, chargeId: l.action }] : [],
  )
  const { meteredSpendFromRow } = await import("./llm-row-spend.js")
  let charged = false
  for (const log of metered) {
    const fromRow = await meteredSpendFromRow(jobId, log.chargeId)
    if (!fromRow || fromRow.readFailed) return "retry"
    if (!fromRow.spend.billedAnything) continue // refunded by the caller with the job's other holds
    const { settleLlmUsageLog } = await import("./llm-billing.js")
    const settled = await settleLlmUsageLog(log.id, jobId, log.chargeId, fromRow.spend)
    if (settled.outcome === "unsettled") return "retry"
    if (settled.outcome === "charged") charged = true
  }
  return charged ? "settled" : "not-started"
}

/** A job's metered billing evidence — see {@link meteredBillingEvidence}. */
export type MeteredBillingEvidence = "metered-hold" | "billed-ledger" | "none" | "unknown"

/**
 * Whether a job carries metered billing evidence: `metered-hold` (one of its
 * reserved logs is a metered LLM id), `billed-ledger` (a fixed + calls hold —
 * the only other kind that can carry a ledger, R63 — whose row recorded
 * billed metered calls), `none` (every other job, with no ledger read), or
 * `unknown` — a read failed twice (never treated as `none` wherever the
 * metered schema exists: D10).
 */
async function meteredBillingEvidence(jobId: string): Promise<MeteredBillingEvidence> {
  const readHolds = () => supabase.from("usage_logs").select("action").eq("job_id", jobId).eq("status", "reserved")
  let { data: logs, error } = await readHolds()
  // One retry before the job is declared unknown (and left live / its hold kept).
  if (error) ({ data: logs, error } = await readHolds())
  if (error) {
    console.warn(`[cancel-job] could not read the holds of job ${jobId}: ${error.message}`)
    return "unknown"
  }
  const rows = (Array.isArray(logs) ? logs : []) as Array<{ action?: unknown }>
  if (rows.length === 0) return "none"
  const { parseMeteredLlmId } = await import("../ee/billing/metered-llm-id.js")
  if (rows.some((r) => typeof r.action === "string" && parseMeteredLlmId(r.action) !== null)) return "metered-hold"
  // R63: only a hold that can carry a ledger (a fixed + calls scrape hold)
  // consults one. Any other job — an image, a video, a tier id — is `none`
  // with no read: no ledger read failure can keep its hold or its job live.
  const { holdCanCarryLlmLedger } = await import("./llm-ledger-holds.js")
  if (!rows.some((r) => holdCanCarryLlmLedger(r.action, parseMeteredLlmId))) return "none"
  const { readLlmBillingLedger } = await import("./llm-billing-ledger.js")
  let read = await readLlmBillingLedger(jobId)
  if (!read.ok) read = await readLlmBillingLedger(jobId)
  if (!read.ok) {
    console.warn(`[cancel-job] could not read the billing ledger of job ${jobId}: ${read.error}`)
    return "unknown"
  }
  const { ledgerBilled, ledgerInFlight } = await import("../ee/billing/llm-cancel-settle.js")
  return ledgerBilled(read.ledger) || ledgerInFlight(read.ledger) ? "billed-ledger" : "none"
}

export async function cancelOwnedJob(jobId: string, userId: string): Promise<CancelOwnedJobResult> {
  const { data: job, error } = await supabase
    .from("jobs") // tenant-scope-ignore: ownership verified post-fetch (user_id mismatch → forbidden)
    .select("id, status, user_id, input_data, provider, provider_task_id, reconcile_attempts, reconcile_last_error")
    .eq("id", jobId)
    .single()
  if (error || !job) return { kind: "not_found" }
  if (job.user_id !== userId) return { kind: "forbidden" }
  if (!(CANCELLABLE_STATUSES as readonly string[]).includes(job.status)) {
    return { kind: "invalid_status", status: job.status as string }
  }
  const input = (job.input_data ?? null) as Record<string, unknown> | null
  const analysisJobId = typeof input?.analysisJobId === "string" ? input.analysisJobId : null

  // A HELD job is cancelled by a different mechanism, and this branch must come
  // BEFORE the `provider_task_id` check below: a held job normally HAS a
  // provider task (the provider already delivered — it is the PLATFORM holding
  // the result), so `in_flight` would refuse it forever. There is also no queue
  // entry left to remove, and the withdrawal has three things the generic path
  // cannot do: refund the reservation, delete the withheld object, and record
  // the `withdrawn` decision against the review audit.
  //
  // Reached through a dynamic import so this module's static graph stays
  // supabase + queue (job-policy-gate pulls storage and the credit lifecycle
  // behind it) — the same reason `refundReservedHolds` loads `ee/` lazily.
  if (isParkedJobStatus(job.status as string)) {
    const { withdrawHeldJob } = await import("./job-policy-gate.js")
    const withdrawal = await withdrawHeldJob(jobId)
    if (!withdrawal.ok) {
      // `not_held` means a reviewer, the TTL sweep or another tab resolved it
      // between our read and the CAS — the same shape as any lost race.
      return withdrawal.reason === "not_found" ? { kind: "not_found" } : { kind: "lost_race" }
    }
    return { kind: "cancelled", analysisJobId }
  }

  const inRecovery = ((job.reconcile_attempts as number | null) ?? 0) > 0
  if (job.provider_task_id && !inRecovery) return { kind: "in_flight" }

  // D10, BEFORE the flip: a billed metered hold is committed, not refunded. One
  // that cannot be committed yet stays with the reconcile sweep — the job is
  // left sweepable (not flipped), and the user keeps what was paid for.
  const metered = await settleMeteredHoldsBeforeCancel(jobId, {
    reconcile_attempts: (job.reconcile_attempts as number | null) ?? 0,
    reconcile_last_error: (job as { reconcile_last_error?: string | null }).reconcile_last_error ?? null,
  })
  if (metered === "retry") return { kind: "in_flight" }

  await tryRemoveFromQueue(jobId)

  const { data: flipped, error: updateError } = await supabase
    .from("jobs")
    .update({ status: "cancelled" })
    .eq("id", jobId)
    .eq("user_id", userId)
    .in("status", [...FLIPPABLE_STATUSES])
    .select("id")
  if (updateError) throw updateError
  if (!flipped || flipped.length === 0) {
    // Zero rows is now two different facts. Re-read once: a row that got PARKED
    // while we were emptying the queue is still perfectly cancellable — it just
    // has to go through the withdrawal. Answering `lost_race` for it would fail
    // a cancel the user is entitled to and leave the reservation sitting behind
    // the reviewer's SLA, which is the stranding D17 exists to prevent.
    const { data: after } = await supabase
      .from("jobs") // tenant-scope-ignore: same row, ownership verified above
      .select("status")
      .eq("id", jobId)
      .single()
    const status = (after as { status?: string } | null)?.status
    if (status && isParkedJobStatus(status)) {
      const { withdrawHeldJob } = await import("./job-policy-gate.js")
      const withdrawal = await withdrawHeldJob(jobId)
      if (withdrawal.ok) return { kind: "cancelled", analysisJobId }
      return withdrawal.reason === "not_found" ? { kind: "not_found" } : { kind: "lost_race" }
    }
    return { kind: "lost_race" }
  }

  // R38: a `not-started` verdict is re-checked AFTER the flip (the worker may
  // have started its call in between): the job is not marked already-settled.
  await refundReservedHolds([jobId], { meteredSettled: metered === "not-started" ? new Set() : new Set([jobId]) })

  // A use-case wrapper owns a hidden run: stop it too (its fee hold was
  // refunded above; the run's finaliser then finds the wrapper final and moves
  // nothing). Dynamic for the same reason as the withdrawal above.
  // A wrapper whose stamp never landed still has its run: the run names it.
  if (job.provider === "use-case") {
    try {
      const { findExecutionIdForWrapper } = await import("./execution-inline-graph.js")
      const executionId =
        typeof input?._executionId === "string" ? input._executionId : await findExecutionIdForWrapper(jobId, userId)
      if (executionId) {
        const { cancelUseCaseInnerExecution } = await import("./use-case/cancel-run.js")
        await cancelUseCaseInnerExecution(executionId, userId, "Cancelled with its node")
      }
    } catch (err) {
      console.warn(`[cancel-job] inner run of ${jobId} not cancelled:`, err)
    }
  }

  return { kind: "cancelled", analysisJobId }
}

/**
 * Cancel the still-running child jobs of a parent that was just cancelled —
 * the rows whose `parent_job_id` names it (a worker-side handler's internal
 * requests, a render a parent spawned). Each goes through `cancelOwnedJob`,
 * so a child gets exactly the single-job cancel: queue removal, the CAS flip,
 * its own refund, a held child's withdrawal, and a child already out at the
 * provider left to finish (`in_flight`), like any in-flight job.
 *
 * A finished child is left alone: only in-flight statuses are read. The owner
 * filter is part of the QUERY — another user's row is never read, whatever
 * `parent_job_id` it carries — and `cancelOwnedJob` checks ownership again.
 * `analysisJobId` is the other kind of child: the `video-analysis` job a
 * `POST /v1/llm/structured/jobs` parent names in `input_data.analysisJobId`
 * (`CancelOwnedJobResult.analysisJobId`). It goes first, the same way, and is
 * not cancelled twice when it also carries `parent_job_id`.
 *
 * The ONE child sweep every cancel path runs once it has cancelled a parent
 * (the single-job cancel route, MCP `tasks/cancel`) — never re-implement it.
 *
 * Best effort and never throws: a read error or one child's failure is logged
 * and the rest go on. Answers how many children it cancelled. One level deep.
 */
export async function cancelRunningChildJobs(
  parentJobId: string,
  userId: string,
  opts: { analysisJobId?: string | null } = {},
): Promise<number> {
  let cancelled = 0
  const { analysisJobId } = opts
  if (analysisJobId) {
    try {
      const result = await cancelOwnedJob(analysisJobId, userId)
      if (result.kind === "cancelled") cancelled++
    } catch (err) {
      console.error(`[cancel-job] child ${analysisJobId} of ${parentJobId}:`, err)
    }
  }

  let children: Array<{ id: string }>
  try {
    const { data, error } = await supabase
      .from("jobs")
      .select("id")
      .eq("user_id", userId)
      .eq("parent_job_id", parentJobId)
      .in("status", [...IN_FLIGHT_JOB_STATUSES])
    if (error) throw error
    children = (data ?? []) as Array<{ id: string }>
  } catch (err) {
    console.error(`[cancel-job] could not read the children of ${parentJobId}:`, err)
    return cancelled
  }

  for (const { id } of children) {
    if (id === analysisJobId) continue
    try {
      const result = await cancelOwnedJob(id, userId)
      if (result.kind === "cancelled") cancelled++
    } catch (err) {
      console.error(`[cancel-job] child ${id} of ${parentJobId}:`, err)
    }
  }
  return cancelled
}
