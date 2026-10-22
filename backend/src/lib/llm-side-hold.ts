// @reads-none reserves, stamps and settles metered side holds through the service-role client; reads no repo file
/**
 * Metered LLM SIDE holds (migration 554) — a metered hold for ONE LLM call a
 * job makes beside its own reservation, reserved, started and settled from a
 * WORKER (no request / reply), that never touches the job's billing.
 *
 * The first user is the UGC Clip's per-take frame check: the clip holds one
 * managed `job-once` reservation, settled from its checkpoints; its reading is
 * charged what it really cost (D1), a billed failure included (D10). That hold
 * cannot live on the clip's row (the plugins report: `usage_log_id`
 * overwritten, 391's "job already has usage", a second settle racing the
 * clip's `credits_actual`, the clip's cancel decided by it). A side hold is a
 * usage log with NO `job_id` — nothing keyed on the job's holds can reach it —
 * linked to its job, with its own call-start marker, ledger and sweep state, by
 * its `llm_side_holds` row (server-only: the ledger is provider $).
 *
 * The life of one:
 *  1. {@link reserveLlmSideHold} — the hold (one attempt of each planned call
 *     on its primary lane, `llmHoldForCalls`, marked up at
 *     `<feature>:<model>`), after the credit guard's own checks, paid by the
 *     JOB's payer (the job's owner and workspace are checked in SQL). A refusal
 *     is an answer, never a throw, and never touches the job;
 *  2. {@link LlmSideHold.callStarting} immediately before the call — a CAS on
 *     the job being live: a cancelled job's call is never sent (the hold is
 *     released) — `JobCancelledError`;
 *  3. {@link LlmSideHold.noteSpend} after each answered call (the sweep's
 *     evidence should the process die), then {@link LlmSideHold.settle} — the
 *     actual through `commit_credits_metered` (an overrun collected, the rest
 *     released), nothing billed refunded. Call it exactly once per hold, on
 *     success, failure and cancel alike.
 *
 * A cancel of the job settles its side holds AFTER its flip
 * ({@link settleSideHoldsAfterFlip}: not started → settled from the ledger or
 * refunded; started → kept for the worker's own settle), and the side-hold
 * sweep (`lib/reconcile/side-llm-holds.ts`) settles any hold nobody settled,
 * after the grace, with the D10 attempt cap.
 *
 * Under the rollback (`!llmMeteredPricing()`) no side hold is reserved
 * (`unavailable`): a plugin keeps its fixed price. One reserved before the
 * flip still settles — every settle keys off the hold, never the switch. Cloud-only — every money
 * path is in `ee/billing/llm-side-hold-impl.ts`, loaded by dynamic import.
 */
import type { FastifyRequest } from "fastify"
import { hasCredits, llmMeteredPricing } from "./config.js"
import { supabase } from "./supabase.js"
import { JobCancelledError } from "./job-cancellation.js"
import { llmMeteredSchemaReady } from "./llm-metered-schema-gate.js"
import { LlmSpend, type LlmPlannedCall, type LlmSettleOutcome, type MeteredLlmFeature } from "./llm-billing.js"
import type { BillingContext } from "./billing-context.js"

let implPromise: Promise<typeof import("../ee/billing/llm-side-hold-impl.js")> | null = null
function loadImpl(): Promise<typeof import("../ee/billing/llm-side-hold-impl.js")> {
  return (implPromise ??= import("../ee/billing/llm-side-hold-impl.js"))
}

/**
 * Who pays, as the job's admitting request resolved it — carried on the job's
 * payload (the resolve-once rule: a worker reads it, never re-resolves it).
 * {@link sideHoldPayerOf} takes it from the request. Absent fields read as
 * the personal payer, as everywhere.
 */
export interface LlmSideHoldPayer {
  billingContext?: BillingContext
  isAppRun?: boolean
  webFreeMode?: boolean
  /** A third-party app's request: never pumps the owner's card. */
  skipAutoRecharge?: boolean
  /** A connected community instance: no daily cap. */
  communityInstance?: boolean
}

/** The payer of a request, to stamp on the job's payload for its worker's side holds. */
export function sideHoldPayerOf(req: FastifyRequest): LlmSideHoldPayer {
  return {
    ...(req.billingContext ? { billingContext: req.billingContext } : {}),
    ...(req.isAppRun !== undefined ? { isAppRun: req.isAppRun } : {}),
    ...(req.webFreeMode !== undefined ? { webFreeMode: req.webFreeMode } : {}),
    ...(req.appAuthorization ? { skipAutoRecharge: true } : {}),
    ...(req.appAuthorization?.appKind === "community_instance" ? { communityInstance: true } : {}),
  }
}

export interface LlmSideHoldReserveArgs {
  /** The job the call is made for — live (`pending` / `processing`) and owned by `userId`. */
  jobId: string
  /** The job's owner (the requester). */
  userId: string
  feature: MeteredLlmFeature
  /** The call(s) this hold covers, as they will be sent: one attempt of each on its primary lane is held. */
  calls: readonly [LlmPlannedCall, ...LlmPlannedCall[]]
  payer?: LlmSideHoldPayer
  /** REQUIRED.
   * Idempotency key, unique per job (e.g. `take:3`): a reserve with a key that
   * already names this job's open hold returns THAT hold (`replayed`), with
   * the spend it recorded so far carried into its settle — a lost response or
   * a retried attempt never stacks a second hold.
   */
  key: string
}

/** Why a side hold was not reserved. */
export type LlmSideHoldRefusalCode =
  /** Metered pricing is off (rollback, no credits, schema not confirmed): bill as before. */
  | "unavailable"
  /** The job is not live (cancelled, finished, gone) or not this user's. */
  | "job_not_live"
  /**
   * The key names a hold already SETTLED (its reading ran and was charged, or
   * it was released): a retried attempt keeps what that reading answered when
   * it checkpointed it, else reserves under a NEW key (e.g. `take:3:r2`).
   */
  | "key_settled"
  /** The same key is being reserved by another attempt right now: retry. */
  | "key_in_use"
  /** The key names another or a settled hold, or the payer is not the job's. */
  | "conflict"
  /** The model has no price on a lane it may be served on. */
  | "llm_model_unpriced"
  | "insufficient_credits"
  | "subscription_required"
  | "free_video_limit"
  | "consent_required"
  /** Bad arguments (an unknown feature, a malformed payer). */
  | "invalid_request"
  /** A refusal the reserve RPC raised (workspace budget, member cap, allowance, blocked account …). */
  | "budget_exceeded"
  | "member_cap_exceeded"
  | "workspace_archived"
  | "member_suspended"
  | "not_a_member"
  | "workspace_not_found"
  | "user_allowance_exceeded"
  | "allowance_unconfigured"
  | "external_wallet_denied"
  | "external_wallet_unavailable"
  | "access_blocked"
  /** Anything else (a transport error): nothing is known to be reserved; the sweep releases a hold that was. */
  | "reservation_failed"

export type LlmSideHoldRefusal = { ok: false; code: LlmSideHoldRefusalCode; message: string; required?: number; balance?: number }

export type LlmSideReserveResult = { ok: true; hold: LlmSideHold } | LlmSideHoldRefusal

/** What the impl answers a reserve with (no handle yet). */
export type LlmSideReserveImplResult =
  | { ok: true; usageLogId: string; chargeId: string; holdCredits: number; replayed: boolean; priorAttempts: unknown[] }
  | LlmSideHoldRefusal

import { sideHoldsAvailable } from "./llm-side-hold-availability.js"
/** Whether side holds can be reserved RIGHT NOW — the leaf `llm-side-hold-availability.ts` (re-exported). */
export { sideHoldsAvailable }

/** Reserve a side hold (see the module doc). Never throws for a refusal. */
export async function reserveLlmSideHold(args: LlmSideHoldReserveArgs): Promise<LlmSideReserveResult> {
  if (!sideHoldsAvailable()) return { ok: false, code: "unavailable", message: "Metered LLM billing is not available" }
  const reserved = await (await loadImpl()).reserveLlmSideHoldImpl(args)
  if (!reserved.ok) return reserved
  return { ok: true, hold: new LlmSideHold(args.jobId, reserved) }
}

/** The 1-attempt hold of `calls` — what {@link reserveLlmSideHold} reserves — or undefined when metered pricing is off. */
export async function sideHoldFor(args: {
  feature: MeteredLlmFeature
  calls: readonly [LlmPlannedCall, ...LlmPlannedCall[]]
}): Promise<{ chargeId: string; holdCredits: number } | undefined> {
  if (!sideHoldsAvailable()) return undefined
  return (await loadImpl()).llmHoldForCalls(args.feature, args.calls)
}

/**
 * What the settle would charge for `spend` under `chargeId`, in credits — the
 * settle's own figure (`computeActualCredits(max(cost, floor), chargeId)`); 0
 * when nothing was billed. Throws `LlmRateMissingError` for a spend that
 * cannot be costed (the settle then charges the hold).
 */
export async function sideCreditsFor(chargeId: string, spend: LlmSpend): Promise<number> {
  if (!hasCredits() || !spend.billedAnything) return 0
  return (await loadImpl()).sideCreditsForImpl(chargeId, spend)
}

/**
 * A reserved side hold. Holds no money logic of its own: the CAS is SQL, the
 * settle is the metered settle with the hold's own ledger as its sink.
 */
export class LlmSideHold {
  readonly jobId: string
  readonly usageLogId: string
  readonly chargeId: string
  readonly holdCredits: number
  /** A replay of an open hold the key already named (its recorded spend is carried into the settle). */
  readonly replayed: boolean
  readonly #prior: unknown[]
  #noted: LlmSpend | undefined

  constructor(jobId: string, r: { usageLogId: string; chargeId: string; holdCredits: number; replayed: boolean; priorAttempts: unknown[] }) {
    this.jobId = jobId
    this.usageLogId = r.usageLogId
    this.chargeId = r.chargeId
    this.holdCredits = r.holdCredits
    this.replayed = r.replayed
    this.#prior = [...r.priorAttempts]
  }

  /**
   * Immediately before the call is sent. Resolves when the call may go
   * (stamped: from now on a cancel keeps this hold for this settle). Throws —
   * and the call must NOT be sent — when:
   *  - the job is no longer live (cancelled, finished, deleted):
   *    `JobCancelledError`, the hold released (what was noted is charged,
   *    the rest refunded);
   *  - the hold was closed or settled (by the sweep, a cancel or a settle):
   *    an Error; whoever closed it settles it;
   *  - the stamp could not be written: an Error, the hold released.
   */
  async callStarting(): Promise<void> {
    let answer: unknown
    let failure: string | undefined
    try {
      const { data, error } = await supabase.rpc("llm_side_hold_call_starting", { p_usage_log_id: this.usageLogId })
      if (error) failure = error.message
      else answer = data
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err)
    }
    if (answer === "started") return
    if (answer === "closed") {
      throw new Error(`Side hold ${this.usageLogId} of job ${this.jobId} is already closed — the call is not sent`)
    }
    const cancelled = answer === "not-live"
    console.warn(
      `[llm-side-hold] job ${this.jobId}: ${cancelled ? "no longer live" : `the call start could not be recorded (${failure ?? String(answer)})`} — ` +
        `the call is not sent; side hold ${this.usageLogId} is released`,
    )
    try {
      await this.settle(this.#noted ?? new LlmSpend())
    } catch (err) {
      console.error(`[llm-side-hold] job ${this.jobId}: releasing side hold ${this.usageLogId} failed — left to the side-hold sweep:`, err)
    }
    if (cancelled) throw new JobCancelledError(this.jobId)
    throw new Error(`The call's start could not be recorded — the call is not sent (job ${this.jobId})`)
  }

  /**
   * Record what the calls billed so far on the hold's ledger — after every
   * answered call, BEFORE anything that may throw. It is the sweep's evidence
   * should this process die before {@link settle}. Never throws.
   */
  async noteSpend(spend: LlmSpend): Promise<void> {
    if (!(spend instanceof LlmSpend)) throw new TypeError("LlmSideHold.noteSpend: the spend must be an LlmSpend (newSpend())")
    this.#noted = spend
    const combined = this.#combined(spend)
    if (!combined.billedAnything) return
    try {
      await (await loadImpl()).noteSideHoldSpendImpl(this.usageLogId, this.chargeId, combined)
    } catch (err) {
      console.warn(`[llm-side-hold] job ${this.jobId}: could not note the spend of side hold ${this.usageLogId}:`, err)
    }
  }

  /**
   * Settle the hold: the actual (D1 — an overrun collected from the payer),
   * nothing billed refunded. `unsettled` leaves it reserved, closed, for the
   * side-hold sweep (never refunded on a guess). Idempotent: a second settle
   * of a charged hold answers `charged` again.
   */
  async settle(spend: LlmSpend): Promise<LlmSettleOutcome> {
    if (!(spend instanceof LlmSpend)) throw new TypeError("LlmSideHold.settle: the spend must be an LlmSpend (newSpend())")
    if (!hasCredits()) return { outcome: "not-metered" }
    this.#noted = spend
    return (await loadImpl()).settleSideHoldImpl({
      usageLogId: this.usageLogId,
      jobId: this.jobId,
      chargeId: this.chargeId,
      holdCredits: this.holdCredits,
      spend: this.#combined(spend),
    })
  }

  /** The spend to charge: what a replayed hold recorded before, then `spend`'s attempts. */
  #combined(spend: LlmSpend): LlmSpend {
    if (this.#prior.length === 0) return spend
    const combined = new LlmSpend()
    const modelId = spend.attempts[0]?.modelId ?? this.chargeId.slice(this.chargeId.indexOf(":") + 1)
    const request = { modelId, system: "", messages: [] }
    try {
      combined.add(modelId, request, { output: { attempts: this.#prior } as never })
    } catch (err) {
      console.warn(`[llm-side-hold] job ${this.jobId}: the earlier spend of side hold ${this.usageLogId} could not be read:`, err)
    }
    if (spend.attempts.length > 0) combined.add(modelId, request, { output: { attempts: [...spend.attempts] } as never })
    return combined
  }
}

/**
 * After a cancel's flip, the side holds of the cancelled jobs (R45 / D14 per
 * hold, on its own call-start marker): not started → its noted spend charged
 * at the actual, else refunded; started → kept (a call may be in flight: the
 * worker settles it at the actual, the side-hold sweep otherwise); closed but
 * not confirmed → settled from its ledger. Only a job whose row is
 * `cancelled` is touched — nothing is committed before the flip. Never throws.
 *
 * Keyed off the holds, never the pricing switch (R15): under the rollback no
 * NEW side hold is reserved, but one reserved before the flip is settled here
 * all the same — a cancel without one finds none and writes nothing. Before
 * this process has confirmed the metered schema (R33) it reads nothing; the
 * side-hold sweep settles such a hold later.
 */
export async function settleSideHoldsAfterFlip(jobIds: readonly string[]): Promise<void> {
  if (jobIds.length === 0) return
  try {
    // Keyed off the holds (R15), not the pricing switch: a side hold reserved
    // before a rollback flip is still settled at the cancel. Before this
    // process has confirmed the metered schema it is the side-hold sweep's.
    if (!hasCredits() || !llmMeteredSchemaReady()) return
    await (await loadImpl()).settleSideHoldsAfterFlipImpl(jobIds)
  } catch (err) {
    console.error(`[llm-side-hold] settling the side holds of cancelled job(s) ${jobIds.join(",")} failed — left to the side-hold sweep:`, err)
  }
}

/**
 * R57 / R61: refund a job's side holds already charged — ONLY for a deliberate platform refund of the
 * whole job (a held job its owner withdraws, `billing_force_refund`; a result-policy block or a
 * reviewer's reject — `lib/llm-platform-refund.ts`), never on a cancel (D10). Answers how many were
 * refunded (0 when none, or when the refund could not run). Never throws.
 */
export async function refundSettledSideHolds(jobId: string): Promise<number> {
  if (!hasCredits() || !llmMeteredSchemaReady()) return 0
  try {
    return await (await loadImpl()).refundSettledSideHoldsImpl(jobId)
  } catch (err) {
    console.error(`[llm-side-hold] refunding the side holds of job ${jobId} failed:`, err)
    return 0
  }
}
