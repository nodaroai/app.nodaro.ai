/**
 * The handler's moves on an account's record (migration 588; the policy is
 * lib/repeat-infringer-policy.ts): record an infringement from a case,
 * withdraw one, take a measure, lift one. Each move is the database's to
 * refuse as well as this module's (a stale screen, two administrators at
 * once), is written to its case's log with the administrator as the actor,
 * and the route audits it. Once a move has been written, its log entry is
 * best effort: the move happened. A move from a case names the account the
 * screen showed, and is refused when the case has named another since.
 *
 * A measure follows the step the policy names for the account's standing
 * infringements in the window, or the administrator says why it departs; the
 * step is kept on the measure as applied. The policy is read fresh for it, as
 * the case's record is.
 *
 * Closing an account records the decision first, then places the platform's
 * account block (block-account.ts): nothing here blocks an account without a
 * record of the decision. An account the block refuses (an administrator, the
 * platform's owner and operators, the payer, oneself) is refused before
 * anything is written; one whose role changed between that check and the
 * block has its closure taken back at once, lifted with why. A block that
 * could not be placed leaves the closure standing on an unblocked account:
 * the answer says so, the case shows it, and the account's imports are
 * refused meanwhile (a closure in force refuses them). From then on the block
 * alone decides access, and the two never move each other: lifting a closure
 * records that the decision was reversed and leaves the block as it is (the
 * answer says whether the account is still blocked, and the screen offers
 * the unblock), and an unblock from the account's page leaves the closure
 * standing on the record, where the case shows the account as not blocked
 * (account-record.ts).
 *
 * Suspending an account (migration 589) follows the same order: refused up
 * front for an account the block refuses, recorded first, and the record is
 * itself the refusal (every process's access snapshot reads it, until its
 * end); then its sign-in is banned until the end. One whose role changed in
 * between has its suspension taken back at once, lifted with why. A sign-in
 * ban that failed leaves the suspension refusing every request, and the
 * answer says so. Lifting it early lets the account back in, its sign-in
 * included, unless it is blocked; it ends by itself at its end.
 */
import { supabase } from "../../lib/supabase.js"
import { isMissingTableError } from "../../lib/postgrest-errors.js"
import { recordComplaintEventQuietly } from "../../lib/rights-complaints.js"
import {
  measureFollowsStep,
  measureNeedsDays,
  measureTakesDays,
  stepFor,
  windowStart,
  type MeasureKind,
  type PolicyStep,
  type RepeatInfringerPolicy,
} from "../../lib/repeat-infringer-policy.js"
import { currentRepeatInfringerPolicy } from "../../lib/repeat-infringer-policy-store.js"
import { BLOCK_REFUSAL_MESSAGE, SUSPEND_REFUSAL_MESSAGE, blockRefusal, isBlockedNow, type BlockRefusal } from "./account-blocking.js"
import { blockAccount, enforceSuspension, releaseSuspension } from "./block-account.js"
import { alertPolicyNamesClosure } from "./repeat-infringer-alerts.js"
import { RepeatInfringerError } from "./repeat-infringer-error.js"

export { RepeatInfringerError, type RepeatInfringerErrorCode } from "./repeat-infringer-error.js"

const DAY_MS = 86_400_000

export const INFRINGEMENT_COLUMNS = "id, complaint_id, user_id, note, recorded_at, withdrawn_at, withdraw_reason"
export const MEASURE_COLUMNS =
  "id, user_id, kind, applied_at, ends_at, reason, note, complaint_id, infringement_id, infringements_in_window, policy_step, departure_reason, lifted_at, lift_reason"

export interface InfringementRow {
  id: string
  complaint_id: string
  user_id: string | null
  note: string | null
  recorded_at: string
  withdrawn_at: string | null
  withdraw_reason: string | null
}

export interface MeasureRow {
  id: string
  user_id: string | null
  kind: MeasureKind
  applied_at: string
  ends_at: string | null
  reason: string
  note: string | null
  complaint_id: string | null
  infringement_id: string | null
  infringements_in_window: number
  policy_step: Record<string, unknown> | null
  departure_reason: string | null
  lifted_at: string | null
  lift_reason: string | null
}

interface NamedCase {
  id: string
  reference: string
  user_id: string
}

/** A read or write the database refused, as this module's refusal; anything else is the server's. */
function dbFailure(error: { code?: string; message: string }, what: string): Error {
  if (isMissingTableError(error)) return new RepeatInfringerError("unavailable", "The record of infringements is not in this database yet")
  // A kind the record does not take yet: staging runs ahead of the migration that adds it (589's suspension).
  if (error.code === "23514" && error.message.includes("account_sanctions_kind")) {
    return new RepeatInfringerError("unavailable", "The record does not take this measure in this database yet")
  }
  if (error.code === "23505") return new RepeatInfringerError("already_recorded", "An infringement from this case is recorded already")
  if (error.code === "55029") return new RepeatInfringerError("in_force", "A measure of this kind is in force on the account already")
  if (error.code === "55028") return new RepeatInfringerError("not_supported", "The case or the infringement changed meanwhile: read the case again")
  return new Error(`${what}: ${error.message}`)
}

/**
 * The case a move is taken from: its complainant proved their email, and it
 * names the account the screen showed (`userId`); a case that names another
 * account since is refused, so a move never lands on an account the
 * administrator did not see.
 */
async function caseNamingAnAccount(caseId: string, userId: string): Promise<NamedCase> {
  const { data, error } = await supabase.from("rights_complaints").select("id, reference, user_id, verified_at").eq("id", caseId).maybeSingle()
  if (error) throw new Error(`Complaint read failed: ${error.message}`)
  const row = data as { id: string; reference: string; user_id: string | null; verified_at: string | null } | null
  if (!row) throw new RepeatInfringerError("not_found", "No such complaint")
  if (!row.verified_at) throw new RepeatInfringerError("unverified", "The complainant has not proved their email: the case is not evidence yet")
  if (!row.user_id) throw new RepeatInfringerError("no_account", "Name the account the case is about first")
  if (row.user_id !== userId.toLowerCase()) throw new RepeatInfringerError("case_moved", "The case names another account now: read it again")
  return { id: row.id, reference: row.reference, user_id: row.user_id }
}

/** The account's standing infringements recorded within the policy's window. */
export async function infringementsInWindow(userId: string, policy: RepeatInfringerPolicy, now: Date): Promise<number> {
  const { count, error } = await supabase
    .from("account_infringements")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("withdrawn_at", null)
    .gte("recorded_at", windowStart(policy, now).toISOString())
  if (error) {
    if (isMissingTableError(error)) return 0
    throw new Error(`Account infringements read failed: ${error.message}`)
  }
  return count ?? 0
}

/**
 * An infringement, from a case whose complainant proved their email, against
 * the account the case names (the one the screen showed); one per case while
 * it stands. When it brings the account to the step where the policy names
 * closing it, the administrators' Slack is told.
 */
export async function recordInfringement(caseId: string, userId: string, note: string | null, adminUserId: string): Promise<InfringementRow> {
  const named = await caseNamingAnAccount(caseId, userId)
  const { data, error } = await supabase
    .from("account_infringements")
    .insert({ complaint_id: caseId, user_id: named.user_id, note, recorded_by: adminUserId })
    .select(INFRINGEMENT_COLUMNS)
    .single()
  if (error) throw dbFailure(error, "Infringement write failed")
  const row = data as InfringementRow
  await recordComplaintEventQuietly(caseId, "infringement_recorded", adminUserId, { infringementId: row.id })
  await alertWhenClosureNamed(named.reference, named.user_id)
  return row
}

/**
 * Tells the administrators' Slack once, when this infringement brings the
 * account's count to the step where the policy names closing it (not again
 * for each one past it); never fails the recording.
 */
async function alertWhenClosureNamed(caseReference: string, userId: string): Promise<void> {
  try {
    const policy = await currentRepeatInfringerPolicy()
    const inWindow = await infringementsInWindow(userId, policy, new Date())
    if (stepFor(policy, inWindow)?.kind === "closed" && stepFor(policy, inWindow - 1)?.kind !== "closed") {
      await alertPolicyNamesClosure(caseReference, inWindow, policy.windowMonths)
    }
  } catch (err) {
    console.warn(`[repeat-infringers] case ${caseReference}: the closure alert was not sent:`, err instanceof Error ? err.message : err)
  }
}

/** Withdraws a standing infringement, once, with the reason: it no longer counts. */
export async function withdrawInfringement(id: string, reason: string, adminUserId: string): Promise<InfringementRow> {
  const { data, error } = await supabase
    .from("account_infringements")
    .update({ withdrawn_at: new Date().toISOString(), withdrawn_by: adminUserId, withdraw_reason: reason })
    .eq("id", id)
    .is("withdrawn_at", null)
    .select(INFRINGEMENT_COLUMNS)
    .maybeSingle()
  if (error) throw dbFailure(error, "Infringement write failed")
  if (!data) {
    const known = await supabase.from("account_infringements").select("id").eq("id", id).maybeSingle()
    if (known.error) throw dbFailure(known.error, "Infringement read failed")
    throw known.data ? new RepeatInfringerError("withdrawn", "The infringement was withdrawn already") : new RepeatInfringerError("not_found", "No such infringement")
  }
  const row = data as InfringementRow
  await recordComplaintEventQuietly(row.complaint_id, "infringement_withdrawn", adminUserId, { infringementId: row.id, reason })
  return row
}

export interface ApplyMeasureInput {
  readonly complaintId: string
  /** The account the screen showed the case naming: refused when the case names another now. */
  readonly userId: string
  readonly kind: MeasureKind
  /** A measure's length in days: an import block's (null: until lifted), a suspension's (required). No other measure has one. */
  readonly days: number | null
  /** What the account's owner is told. */
  readonly reason: string
  /** The administrator's own note. */
  readonly note: string | null
  readonly infringementId: string | null
  /** Why the measure departs from the policy's step; needed only when it does. */
  readonly departureReason: string | null
}

/**
 * What became of the refusal of access a recorded measure places: a
 * closure's account block, a suspension's (the record refuses; its sign-in is
 * banned until the end).
 */
export type AccessOutcome =
  /** Placed: whether sign-in is refused now, and a failure to make it so (the refusal of every request stands; see the route's warning). */
  | { readonly placed: true; readonly signInBlocked: boolean; readonly signInError: unknown }
  /** The account's role changed between the check and the refusal, so it was refused: the measure was taken back (lifted, with why). */
  | { readonly placed: false; readonly refused: BlockRefusal; readonly lifted: MeasureRow | null }
  /**
   * The refusal could not be completed. A closure stands on an unblocked
   * account, as the case shows (block it from the account's page); a
   * suspension still refuses every request, but its sign-in ban was not set.
   */
  | { readonly placed: false; readonly failure: unknown }

export interface AppliedMeasure {
  readonly measure: MeasureRow
  /** A closure's or a suspension's refusal of access; null for any other measure. */
  readonly access: AccessOutcome | null
}

/** The step a measure follows, as the policy reads now, or the refusal for a departure that does not say why. */
function followedStep(policy: RepeatInfringerPolicy, inWindow: number, input: ApplyMeasureInput): PolicyStep | null {
  const step = stepFor(policy, inWindow)
  const days = measureTakesDays(input.kind) ? input.days : null
  if (step && measureFollowsStep(step, input.kind, days)) return step
  if (!input.departureReason) {
    throw new RepeatInfringerError(
      "departure_required",
      step
        ? `The policy names another measure for ${inWindow} infringement(s): say why this one departs from it`
        : `The policy names no measure for ${inWindow} infringement(s): say why one is taken`,
    )
  }
  return null
}

/** The infringement a measure follows is a standing one of the same account. */
async function requireStandingInfringement(id: string | null, userId: string): Promise<void> {
  if (!id) return
  const { data, error } = await supabase.from("account_infringements").select("user_id, withdrawn_at").eq("id", id).maybeSingle()
  if (error) throw dbFailure(error, "Infringement read failed")
  const row = data as { user_id: string | null; withdrawn_at: string | null } | null
  if (!row || row.user_id !== userId || row.withdrawn_at) {
    throw new RepeatInfringerError("not_supported", "A measure follows a standing infringement of the same account")
  }
}

/** A measure that refuses the account access: a closure (its account block) or a suspension. */
function refusesAccess(kind: MeasureKind): kind is "closed" | "suspended" {
  return kind === "closed" || kind === "suspended"
}

/** What the block's refusals say for this measure: a closure blocks, a suspension suspends. */
function refusalMessage(kind: "closed" | "suspended", refusal: BlockRefusal): string {
  return (kind === "suspended" ? SUSPEND_REFUSAL_MESSAGE : BLOCK_REFUSAL_MESSAGE)[refusal]
}

/** A closure or a suspension is refused before anything is written for an account the block refuses. */
async function requireBlockable(adminUserId: string, userId: string, kind: "closed" | "suspended"): Promise<void> {
  const refusal = await blockRefusal(adminUserId, userId)
  if (refusal) throw new RepeatInfringerError(refusal, refusalMessage(kind, refusal))
}

/**
 * A measure on the account a verified case names. What this module can refuse
 * is asked first; a measure of a kind already in force (but a warning) is the
 * database's to refuse, under its lock (`in_force`, two administrators at
 * once included). A closure then records the decision and blocks the
 * account, a suspension records itself and bans the sign-in until its end
 * (see the module comment).
 */
export async function applyMeasure(input: ApplyMeasureInput, adminUserId: string, now: Date = new Date()): Promise<AppliedMeasure> {
  if (measureNeedsDays(input.kind) && !input.days) throw new RepeatInfringerError("days_required", "A suspension lasts a number of days")
  const named = await caseNamingAnAccount(input.complaintId, input.userId)
  const policy = await currentRepeatInfringerPolicy()
  const inWindow = await infringementsInWindow(named.user_id, policy, now)
  const step = followedStep(policy, inWindow, input)
  await requireStandingInfringement(input.infringementId, named.user_id)
  if (refusesAccess(input.kind)) await requireBlockable(adminUserId, named.user_id, input.kind)
  const measure = await insertMeasure(named, input, adminUserId, { inWindow, step, policy, now })
  await recordComplaintEventQuietly(named.id, "measure_applied", adminUserId, { measureId: measure.id, kind: measure.kind, endsAt: measure.ends_at, followsPolicy: step !== null })
  const access = refusesAccess(input.kind) ? await refuseAccess(adminUserId, named, measure, input.kind) : null
  return { measure, access }
}

async function insertMeasure(
  named: NamedCase,
  input: ApplyMeasureInput,
  adminUserId: string,
  at: { readonly inWindow: number; readonly step: PolicyStep | null; readonly policy: RepeatInfringerPolicy; readonly now: Date },
): Promise<MeasureRow> {
  const days = measureTakesDays(input.kind) ? input.days : null
  const { data, error } = await supabase
    .from("account_sanctions")
    .insert({
      user_id: named.user_id,
      kind: input.kind,
      ends_at: days ? new Date(at.now.getTime() + days * DAY_MS).toISOString() : null,
      reason: input.reason,
      note: input.note,
      complaint_id: named.id,
      infringement_id: input.infringementId,
      infringements_in_window: at.inWindow,
      policy_step: at.step ? { ...at.step, windowMonths: at.policy.windowMonths } : null,
      departure_reason: at.step ? null : input.departureReason,
      applied_by: adminUserId,
    })
    .select(MEASURE_COLUMNS)
    .single()
  if (error) throw dbFailure(error, "Measure write failed")
  return data as MeasureRow
}

/**
 * The refusal of access a recorded closure or suspension places: a closure
 * blocks the account, a suspension's record already refuses it and its
 * sign-in is banned until the end. Never throws (see `AccessOutcome`).
 */
async function refuseAccess(adminUserId: string, named: NamedCase, measure: MeasureRow, kind: "closed" | "suspended"): Promise<AccessOutcome> {
  try {
    const outcome =
      kind === "closed"
        ? await blockAccount(adminUserId, named.user_id, `Closed under the repeat-infringer policy (case ${named.reference})`)
        : await enforceSuspension(adminUserId, named.user_id)
    if (!outcome.refused) return { placed: true, signInBlocked: outcome.signInBlocked, signInError: outcome.signInError }
    const could = kind === "closed" ? "blocked" : "suspended"
    const lifted = await liftMeasure(measure.id, `The account could not be ${could}: ${refusalMessage(kind, outcome.refused)}`, adminUserId)
      .then((l) => l.measure)
      .catch(() => null)
    return { placed: false, refused: outcome.refused, lifted }
  } catch (failure) {
    return { placed: false, failure }
  }
}

export interface LiftedMeasure {
  readonly measure: MeasureRow
  /** A lifted closure: whether the account is still blocked (lifting a closure never unblocks it); null when that could not be read. */
  readonly stillBlocked: boolean | null
  /**
   * A lifted suspension: whether sign-in is still refused (only when the
   * account is blocked as well), and a failure to let it back in (the
   * account's requests are let through anyway). Null for any other measure.
   */
  readonly signIn: { readonly signInBlocked: boolean | null; readonly signInError: unknown } | null
}

/** Lifts a measure in force, once, with the reason. A warning stands; a measure that ended is not lifted after the fact. */
export async function liftMeasure(id: string, reason: string, adminUserId: string): Promise<LiftedMeasure> {
  const { data, error } = await supabase
    .from("account_sanctions")
    .update({ lifted_at: new Date().toISOString(), lifted_by: adminUserId, lift_reason: reason })
    .eq("id", id)
    .is("lifted_at", null)
    .neq("kind", "warning")
    .select(MEASURE_COLUMNS)
    .maybeSingle()
  if (error?.code === "23514") throw new RepeatInfringerError("ended", "The measure ended already: there is nothing to lift")
  if (error) throw dbFailure(error, "Measure write failed")
  if (!data) throw await whyNotLifted(id)
  const measure = data as MeasureRow
  if (measure.complaint_id) {
    await recordComplaintEventQuietly(measure.complaint_id, "measure_lifted", adminUserId, { measureId: measure.id, kind: measure.kind, reason })
  }
  // The lift is made: a block that cannot be read now is unknown, never an error the lift answers.
  const stillBlocked = measure.kind === "closed" && measure.user_id ? await isBlockedNow(measure.user_id).catch(() => null) : null
  const signIn = measure.kind === "suspended" && measure.user_id ? await releaseSuspension(measure.user_id) : null
  return { measure, stillBlocked, signIn }
}

async function whyNotLifted(id: string): Promise<RepeatInfringerError | Error> {
  const { data, error } = await supabase.from("account_sanctions").select("kind, lifted_at").eq("id", id).maybeSingle()
  if (error) return dbFailure(error, "Measure read failed")
  const row = data as { kind: MeasureKind; lifted_at: string | null } | null
  if (!row) return new RepeatInfringerError("not_found", "No such measure")
  if (row.kind === "warning") return new RepeatInfringerError("warning_stands", "A warning stands: it is not lifted")
  return new RepeatInfringerError("lifted", "The measure was lifted already")
}
