/**
 * The measures in force on an account (migration 588; a suspension 589), as
 * the platform enforces them and as the account's owner sees them.
 *
 * Enforcement: the import gate (import-gate.ts) asks `assertImportsAllowed`
 * before anything else, and so does a private plugin's download through the
 * toolkit. An import block in force, a suspension or a closure refuses every
 * import of a link through those (`imports_blocked`: a 403 to a client, a
 * failed download to a run). It is read afresh each time, so a lift takes
 * effect at once. While the table does not exist yet (staging runs ahead of
 * the migration) nothing is in force; any other failed read throws, and the
 * import fails with it: an import is never let through on a record that was
 * not read. A suspension's and a closure's refusal of sign-in and of every
 * request are the access snapshot's (access-blocks.ts: the suspension itself,
 * the closure's account block); this module makes their imports refuse too,
 * read fresh, for a run already past those checks.
 *
 * The owner's view (`myAccountStanding`): the measures in force with what the
 * owner was told and until when, and the warnings and infringements within
 * the policy's window, each infringement by its case's reference. Never the
 * administrator's own note, nor who took a step.
 */
import { supabase } from "./supabase.js"
import { isMissingTableError } from "./postgrest-errors.js"
import { getAppSettings } from "./app-settings.js"
import { windowStart, type MeasureKind } from "./repeat-infringer-policy.js"
import { AccountMeasureError } from "./account-measure-error.js"

export { AccountMeasureError } from "./account-measure-error.js"

/** Rows read per question: an account's record is short; this bounds a long one. */
export const ACCOUNT_RECORD_LIMIT = 200

export interface MeasureTimes {
  readonly lifted_at: string | null
  readonly ends_at: string | null
}

/** In force at `now`: not lifted, and its end, if it has one, still ahead. */
export function inForceAt(measure: MeasureTimes, now: Date): boolean {
  return measure.lifted_at === null && (measure.ends_at === null || Date.parse(measure.ends_at) > now.getTime())
}

/**
 * The latest measure of a kind on the account that was not lifted: the only
 * one of its kind that can be in force, since 588 takes no second measure of
 * a kind (but a warning) while one is (every earlier one had ended or was
 * lifted when the next was taken, and neither ever comes back). One row, however
 * long the account's record, read through 588's partial index of the measures
 * not lifted (`account_sanctions_standing_idx`). Null when there is none, or
 * while the table does not exist yet; throws when the record could not be read.
 */
export async function latestStandingMeasure(userId: string, kind: MeasureKind): Promise<MeasureTimes | null> {
  const { data, error } = await supabase
    .from("account_sanctions")
    .select("ends_at, lifted_at")
    .eq("user_id", userId)
    .eq("kind", kind)
    .is("lifted_at", null)
    .order("applied_at", { ascending: false })
    .limit(1)
  if (error) {
    if (isMissingTableError(error)) return null
    throw new Error(`Account measures read failed: ${error.message}`)
  }
  return ((data ?? []) as MeasureTimes[])[0] ?? null
}

/**
 * Refuses (`AccountMeasureError`) when a closure, a suspension or an import
 * block is in force on the account, naming the first of them in that order.
 * Answers nothing when none is; throws the read's own error when the record
 * could not be read.
 */
export async function assertImportsAllowed(userId: string, now: Date = new Date()): Promise<void> {
  const [closure, suspension, block] = await Promise.all([
    latestStandingMeasure(userId, "closed"),
    latestStandingMeasure(userId, "suspended"),
    latestStandingMeasure(userId, "imports_blocked"),
  ])
  if (closure && inForceAt(closure, now)) throw new AccountMeasureError(null, "closed")
  if (suspension && inForceAt(suspension, now)) throw new AccountMeasureError(suspension.ends_at, "suspended")
  if (block && inForceAt(block, now)) throw new AccountMeasureError(block.ends_at, "imports_blocked")
}

/**
 * When the suspension in force on the account ends, read fresh (not the
 * access snapshot); null when none is in force, or while the table does not
 * exist yet. Throws when the record could not be read.
 */
export async function suspensionEndsAt(userId: string, now: Date = new Date()): Promise<string | null> {
  const suspension = await latestStandingMeasure(userId, "suspended")
  return suspension && inForceAt(suspension, now) ? suspension.ends_at : null
}

export interface MyAccountMeasure {
  readonly kind: MeasureKind
  /** What the administrator told the owner. */
  readonly reason: string
  readonly appliedAt: string
  /** When it ends; null: no end of its own. */
  readonly endsAt: string | null
}

export interface MyInfringement {
  /** The case it was recorded from; null if that case could not be read. */
  readonly caseReference: string | null
  readonly recordedAt: string
}

export interface MyAccountStanding {
  /** Import blocks, a suspension and a closure in force now. */
  readonly inForce: readonly MyAccountMeasure[]
  /** Warnings given within the policy's window, newest first. */
  readonly warnings: readonly MyAccountMeasure[]
  /** Standing infringements recorded within the window, newest first. */
  readonly infringements: readonly MyInfringement[]
  /** The window the policy counts over, in months. */
  readonly windowMonths: number
}

interface OwnerMeasureRow extends MeasureTimes {
  kind: MeasureKind
  reason: string
  applied_at: string
}

/** The account's measures, newest first; none while the table does not exist yet. */
async function measuresOf(userId: string): Promise<OwnerMeasureRow[]> {
  const { data, error } = await supabase
    .from("account_sanctions")
    .select("kind, reason, applied_at, ends_at, lifted_at")
    .eq("user_id", userId)
    .order("applied_at", { ascending: false })
    .limit(ACCOUNT_RECORD_LIMIT)
  if (error) {
    if (isMissingTableError(error)) return []
    throw new Error(`Account measures read failed: ${error.message}`)
  }
  return (data ?? []) as OwnerMeasureRow[]
}

/** The account's standing infringements recorded since `since`, newest first, each by its case's reference. */
async function infringementsSince(userId: string, since: Date): Promise<MyInfringement[]> {
  const { data, error } = await supabase
    .from("account_infringements")
    .select("complaint_id, recorded_at")
    .eq("user_id", userId)
    .is("withdrawn_at", null)
    .gte("recorded_at", since.toISOString())
    .order("recorded_at", { ascending: false })
    .limit(ACCOUNT_RECORD_LIMIT)
  if (error) {
    if (isMissingTableError(error)) return []
    throw new Error(`Account infringements read failed: ${error.message}`)
  }
  const rows = (data ?? []) as Array<{ complaint_id: string; recorded_at: string }>
  if (rows.length === 0) return []
  const cases = await supabase.from("rights_complaints").select("id, reference").in("id", [...new Set(rows.map((r) => r.complaint_id))])
  if (cases.error) throw new Error(`Complaints read failed: ${cases.error.message}`)
  const referenceOf = new Map(((cases.data ?? []) as Array<{ id: string; reference: string }>).map((c) => [c.id, c.reference]))
  return rows.map((r) => ({ caseReference: referenceOf.get(r.complaint_id) ?? null, recordedAt: r.recorded_at }))
}

const toMine = (m: OwnerMeasureRow): MyAccountMeasure => ({ kind: m.kind, reason: m.reason, appliedAt: m.applied_at, endsAt: m.ends_at })

/** Where the account stands, as its owner sees it (see the module comment). */
export async function myAccountStanding(userId: string, now: Date = new Date()): Promise<MyAccountStanding> {
  const policy = (await getAppSettings()).rights_repeat_infringer_policy
  const since = windowStart(policy, now)
  const [measures, infringements] = await Promise.all([measuresOf(userId), infringementsSince(userId, since)])
  return {
    inForce: measures.filter((m) => m.kind !== "warning" && inForceAt(m, now)).map(toMine),
    warnings: measures.filter((m) => m.kind === "warning" && Date.parse(m.applied_at) >= since.getTime()).map(toMine),
    infringements,
    windowMonths: policy.windowMonths,
  }
}
