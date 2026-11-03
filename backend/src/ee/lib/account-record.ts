/**
 * An account's record of infringements and measures (migration 588) as the
 * complaint handler's screen shows it (complaint-case-view.ts):
 *
 *  - for every account a case matched, its standing: the standing
 *    infringements within the policy's window and the measures in force;
 *  - for the account the case names, the whole record: each infringement with
 *    its case (reference, status, kind) and whether that case's content was
 *    restored after a counter-notice (an infringement then is usually
 *    withdrawn, an administrator's step), each measure with whether it is in
 *    force, the step the policy names now, and the account's block as it is
 *    now, with its reason and time (a closure lifted, or an unblock from the
 *    account's page, never moves the other: the screen shows both, and the
 *    block's own reason says whether a closure placed it).
 *
 * The tables not there yet (staging runs ahead of the migration) read as an
 * empty record.
 */
import { supabase } from "../../lib/supabase.js"
import { isMissingTableError } from "../../lib/postgrest-errors.js"
import { inForceAt } from "../../lib/account-measures.js"
import { stepFor, windowStart, type MeasureKind, type PolicyStep, type RepeatInfringerPolicy } from "../../lib/repeat-infringer-policy.js"
import { readBlock, type AccountBlockRow } from "./account-blocking.js"
import { INFRINGEMENT_COLUMNS, MEASURE_COLUMNS, type InfringementRow, type MeasureRow } from "./repeat-infringers.js"

/** Rows read per account: a record is short; this bounds a long one. */
export const RECORD_LIMIT = 200

export interface AccountStanding {
  /** Standing infringements recorded within the policy's window. */
  readonly inWindow: number
  /** The measures in force now, by kind (a warning is an event, never in force). */
  readonly inForce: readonly MeasureKind[]
}

export interface RecordInfringement {
  readonly id: string
  readonly complaintId: string
  readonly caseReference: string | null
  readonly caseStatus: string | null
  readonly caseKind: "copyright" | "other" | null
  readonly note: string | null
  readonly recordedAt: string
  readonly withdrawnAt: string | null
  readonly withdrawReason: string | null
  /** Recorded within the policy's window and standing: it counts. */
  readonly counts: boolean
  /** The account's content on that case was restored after its counter-notice. */
  readonly restoredAfterCounterNotice: boolean
}

export interface RecordMeasure {
  readonly id: string
  readonly kind: MeasureKind
  readonly appliedAt: string
  readonly endsAt: string | null
  readonly reason: string
  readonly note: string | null
  readonly complaintId: string | null
  readonly caseReference: string | null
  readonly infringementId: string | null
  readonly infringementsInWindow: number
  readonly policyStep: Record<string, unknown> | null
  readonly departureReason: string | null
  readonly liftedAt: string | null
  readonly liftReason: string | null
  readonly inForce: boolean
}

export interface AccountRecord {
  readonly userId: string
  readonly windowMonths: number
  /** Standing infringements within the window. */
  readonly inWindow: number
  /** The step the policy names for that count: what the next measure follows. */
  readonly step: PolicyStep | null
  readonly infringements: readonly RecordInfringement[]
  readonly measures: readonly RecordMeasure[]
  /** Whether the account is blocked now; null when that could not be read. */
  readonly blocked: boolean | null
  /** The block itself, when there is one: its reason (a closure's names its case) and when it was placed. */
  readonly block: AccountBlockRow | null
}

/** The account's block now, or unknown when it could not be read. */
async function blockOf(userId: string): Promise<{ blocked: boolean | null; block: AccountBlockRow | null }> {
  try {
    const block = await readBlock(userId)
    return { blocked: block !== null, block }
  } catch {
    return { blocked: null, block: null }
  }
}

type Read<T> = { data: T[]; missing: boolean }

async function rows<T>(query: PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>, what: string): Promise<Read<T>> {
  const { data, error } = await query
  if (error) {
    if (isMissingTableError(error)) return { data: [], missing: true }
    throw new Error(`${what} read failed: ${error.message}`)
  }
  return { data: (data ?? []) as T[], missing: false }
}

/** Each account's standing (see the module comment); an account with nothing on record stands at zero. */
export async function standingOf(userIds: readonly string[], policy: RepeatInfringerPolicy, now: Date): Promise<ReadonlyMap<string, AccountStanding>> {
  if (userIds.length === 0) return new Map()
  const since = windowStart(policy, now).toISOString()
  const [infringements, measures] = await Promise.all([
    rows<{ user_id: string }>(
      supabase.from("account_infringements").select("user_id").in("user_id", [...userIds]).is("withdrawn_at", null).gte("recorded_at", since).limit(RECORD_LIMIT * userIds.length),
      "Account infringements",
    ),
    rows<{ user_id: string; kind: MeasureKind; ends_at: string | null; lifted_at: string | null }>(
      supabase.from("account_sanctions").select("user_id, kind, ends_at, lifted_at").in("user_id", [...userIds]).is("lifted_at", null).neq("kind", "warning").limit(RECORD_LIMIT * userIds.length),
      "Account measures",
    ),
  ])
  return new Map(
    userIds.map((id) => [
      id,
      {
        inWindow: infringements.data.filter((i) => i.user_id === id).length,
        inForce: [...new Set(measures.data.filter((m) => m.user_id === id && inForceAt(m, now)).map((m) => m.kind))],
      },
    ]),
  )
}

type CaseRef = { id: string; reference: string; status: string; kind: "copyright" | "other" }

/** The cases the record names, and which of them had this account's content restored after a counter-notice. */
async function casesOf(userId: string, caseIds: readonly string[]): Promise<{ cases: Map<string, CaseRef>; restored: Set<string> }> {
  if (caseIds.length === 0) return { cases: new Map(), restored: new Set() }
  const [cases, notices] = await Promise.all([
    rows<CaseRef>(supabase.from("rights_complaints").select("id, reference, status, kind").in("id", [...caseIds]), "Complaints"),
    rows<{ complaint_id: string }>(
      supabase.from("rights_counter_notices").select("complaint_id").eq("user_id", userId).in("complaint_id", [...caseIds]).not("restored_at", "is", null),
      "Counter-notices",
    ),
  ])
  return { cases: new Map(cases.data.map((c) => [c.id, c])), restored: new Set(notices.data.map((n) => n.complaint_id)) }
}

function toRecordInfringement(i: InfringementRow, cases: Map<string, CaseRef>, restored: Set<string>, since: Date): RecordInfringement {
  const c = cases.get(i.complaint_id)
  return {
    id: i.id,
    complaintId: i.complaint_id,
    caseReference: c?.reference ?? null,
    caseStatus: c?.status ?? null,
    caseKind: c?.kind ?? null,
    note: i.note,
    recordedAt: i.recorded_at,
    withdrawnAt: i.withdrawn_at,
    withdrawReason: i.withdraw_reason,
    counts: i.withdrawn_at === null && Date.parse(i.recorded_at) >= since.getTime(),
    restoredAfterCounterNotice: restored.has(i.complaint_id),
  }
}

function toRecordMeasure(m: MeasureRow, cases: Map<string, CaseRef>, now: Date): RecordMeasure {
  return {
    id: m.id,
    kind: m.kind,
    appliedAt: m.applied_at,
    endsAt: m.ends_at,
    reason: m.reason,
    note: m.note,
    complaintId: m.complaint_id,
    caseReference: m.complaint_id ? (cases.get(m.complaint_id)?.reference ?? null) : null,
    infringementId: m.infringement_id,
    infringementsInWindow: m.infringements_in_window,
    policyStep: m.policy_step,
    departureReason: m.departure_reason,
    liftedAt: m.lifted_at,
    liftReason: m.lift_reason,
    inForce: m.kind !== "warning" && inForceAt(m, now),
  }
}

/** The whole record of the account a case names (see the module comment). */
export async function accountRecordOf(userId: string, policy: RepeatInfringerPolicy, now: Date): Promise<AccountRecord> {
  const [infringements, measures] = await Promise.all([
    rows<InfringementRow>(
      supabase.from("account_infringements").select(INFRINGEMENT_COLUMNS).eq("user_id", userId).order("recorded_at", { ascending: false }).limit(RECORD_LIMIT),
      "Account infringements",
    ),
    rows<MeasureRow>(
      supabase.from("account_sanctions").select(MEASURE_COLUMNS).eq("user_id", userId).order("applied_at", { ascending: false }).limit(RECORD_LIMIT),
      "Account measures",
    ),
  ])
  const caseIds = [...new Set([...infringements.data.map((i) => i.complaint_id), ...measures.data.flatMap((m) => (m.complaint_id ? [m.complaint_id] : []))])]
  const [{ cases, restored }, { blocked, block }] = await Promise.all([casesOf(userId, caseIds), blockOf(userId)])
  const since = windowStart(policy, now)
  const recorded = infringements.data.map((i) => toRecordInfringement(i, cases, restored, since))
  const inWindow = recorded.filter((i) => i.counts).length
  return {
    userId,
    windowMonths: policy.windowMonths,
    inWindow,
    step: stepFor(policy, inWindow),
    infringements: recorded,
    measures: measures.data.map((m) => toRecordMeasure(m, cases, now)),
    blocked,
    block,
  }
}
