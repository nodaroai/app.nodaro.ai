/**
 * One content complaint as the handler's screen shows it: what the
 * complainant sent (decrypted for this view only), the case's log, what the
 * links matched in our records (the files, a restricted one included; the
 * import confirmations; the accounts behind them, each with its other cases,
 * its active restrictions and its standing under the repeat-infringer
 * policy), the restrictions the case led to, and the whole record of the
 * account the case names (account-record.ts).
 *
 * Each section is read on its own: one that fails is named in `partial` and
 * shown empty, and the rest of the case is answered. The reads are bounded:
 * id lists are read in chunks, the log's newest entries are kept, and the
 * accounts past a cap are counted, not read.
 */
import { supabase } from "../../lib/supabase.js"
import { currentRepeatInfringerPolicy } from "../../lib/repeat-infringer-policy-store.js"
import { listRestrictions, type ContentRestriction } from "../../lib/content-restrictions.js"
import { readCaseRow, readComplainant, summaryOf, type ComplaintSummary } from "./complaint-case-rows.js"
import { counterNoticesOfCase, type CaseCounterNotice } from "./counter-notice-cases.js"
import { accountRecordOf, standingOf, type AccountRecord, type AccountStanding } from "./account-record.js"

/** The log's newest entries a case view keeps; an older entry is past `eventsTruncated`. */
export const CASE_EVENT_LIMIT = 500
/** The accounts a case view reads in full; the rest are counted in `moreAccounts`. */
export const CASE_ACCOUNT_LIMIT = 25
/** Ids per `in` filter: a request's address stays well under every proxy's limit. */
const IN_CHUNK = 100
/** Other cases read per account question, the most recent first: the history is counted, never listed. */
export const HISTORY_LIMIT = 1000

export type CaseSection = "events" | "files" | "confirmations" | "accounts" | "restrictions" | "counterNotices" | "record"

export interface ComplaintEvent {
  readonly id: string
  readonly kind: string
  readonly actor: string
  readonly data: Record<string, unknown>
  readonly createdAt: string
}

export interface MatchedAsset {
  readonly id: string
  readonly userId: string | null
  readonly r2Key: string | null
  readonly r2Url: string | null
  readonly filename: string | null
  readonly type: string | null
  readonly jobId: string | null
  readonly createdAt: string | null
  readonly restrictedAt: string | null
}

export interface MatchedConfirmation {
  readonly id: string
  readonly userId: string | null
  readonly kind: string
  readonly sourceUrl: string
  readonly platform: string | null
  readonly lane: string | null
  readonly createdAt: string
}

/** An account's other cases by status, the verified apart from the unverified (an unverified case is anyone's claim). */
export interface AccountHistory {
  readonly verified: Readonly<Record<string, number>>
  readonly unverified: Readonly<Record<string, number>>
}

export interface MatchedUser {
  readonly id: string
  readonly email: string | null
  readonly otherCases: AccountHistory
  /** Restrictions standing (not lifted) on this account's content. */
  readonly activeRestrictions: number
  /** Its infringements within the policy's window and its measures in force (account-record.ts); null when that could not be read. */
  readonly standing: AccountStanding | null
}

export interface ComplaintCase extends ComplaintSummary {
  readonly claimantRole: "owner" | "agent" | null
  readonly originalWork: string | null
  readonly originalWorkUrl: string | null
  readonly reportedContent: string
  readonly explanation: string
  readonly goodFaithAffirmedAt: string | null
  readonly accuracyAffirmedAt: string | null
  readonly statementsHash: string | null
  readonly decision: string | null
  readonly complainantAddress: string | null
  readonly complainantPhone: string | null
  readonly signature: string | null
  readonly userAgent: string | null
  readonly events: readonly ComplaintEvent[]
  /** Older log entries exist past the ones answered. */
  readonly eventsTruncated: boolean
  readonly matchedAssets: readonly MatchedAsset[]
  /** Files the case matched that no longer exist (deleted before anything held them). */
  readonly missingAssetIds: readonly string[]
  readonly matchedConfirmations: readonly MatchedConfirmation[]
  readonly matchedUsers: readonly MatchedUser[]
  /** Matched accounts past `CASE_ACCOUNT_LIMIT`, not read. */
  readonly moreAccounts: number
  /** The accounts' other cases were counted from the most recent ones only: the counts may be low. */
  readonly historyTruncated: boolean
  readonly restrictions: readonly ContentRestriction[]
  /** The counter-notices the case received (ee/lib/counter-notice-cases.ts), oldest first. */
  readonly counterNotices: readonly CaseCounterNotice[]
  /** The record of the account the case names (account-record.ts); null when it names none, or the record could not be read. */
  readonly record: AccountRecord | null
  /** The sections that could not be read, shown empty. */
  readonly partial: readonly CaseSection[]
}

function chunked<T>(values: readonly T[], size = IN_CHUNK): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, i) => values.slice(i * size, (i + 1) * size))
}

type ReadResult = { data: unknown; error: { message: string } | null }

/** A read by id list, chunked; any chunk's failure fails the read. */
async function readByIds<Row>(ids: readonly string[], what: string, read: (chunk: string[]) => PromiseLike<ReadResult>): Promise<Row[]> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return []
  const results = await Promise.all(chunked(unique).map((chunk) => read(chunk)))
  return results.flatMap((r) => {
    if (r.error) throw new Error(`${what} read failed: ${r.error.message}`)
    return (r.data ?? []) as Row[]
  })
}

/** The log, newest entries kept, answered oldest first; entries written at the same instant keep one order. */
async function eventsOf(id: string): Promise<{ events: ComplaintEvent[]; truncated: boolean }> {
  const { data, error } = await supabase
    .from("rights_complaint_events")
    .select("id, kind, actor, data, created_at")
    .eq("complaint_id", id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(CASE_EVENT_LIMIT + 1)
  if (error) throw new Error(`Complaint events read failed: ${error.message}`)
  const rows = (data ?? []) as Array<{ id: string; kind: string; actor: string; data: Record<string, unknown> | null; created_at: string }>
  const kept = rows.slice(0, CASE_EVENT_LIMIT).reverse()
  return {
    events: kept.map((e) => ({ id: e.id, kind: e.kind, actor: e.actor, data: e.data ?? {}, createdAt: e.created_at })),
    truncated: rows.length > CASE_EVENT_LIMIT,
  }
}

async function matchedAssetsOf(ids: readonly string[]): Promise<MatchedAsset[]> {
  const rows = await readByIds<Record<string, unknown>>(ids, "Matched files", (chunk) =>
    // restricted-read: the handler's screen is the one reader that must see a
    // restricted row — the case is about it.
    supabase
      .from("assets") // tenant-scope-ignore: the administrator's case view reaches the matched rows of any account
      .select("id, user_id, r2_key, r2_url, filename, type, job_id, created_at, restricted_at")
      .in("id", chunk),
  )
  return rows.map((a) => ({
    id: String(a.id),
    userId: (a.user_id as string | null) ?? null,
    r2Key: (a.r2_key as string | null) ?? null,
    r2Url: (a.r2_url as string | null) ?? null,
    filename: (a.filename as string | null) ?? null,
    type: (a.type as string | null) ?? null,
    jobId: (a.job_id as string | null) ?? null,
    createdAt: (a.created_at as string | null) ?? null,
    restrictedAt: (a.restricted_at as string | null) ?? null,
  }))
}

async function matchedConfirmationsOf(ids: readonly string[]): Promise<MatchedConfirmation[]> {
  const rows = await readByIds<Record<string, unknown>>(ids, "Matched confirmations", (chunk) =>
    supabase
      .from("content_rights_confirmations") // tenant-scope-ignore: the administrator's case view
      .select("id, user_id, kind, source_url, platform, lane, created_at")
      .in("id", chunk),
  )
  return rows.map((c) => ({
    id: String(c.id),
    userId: (c.user_id as string | null) ?? null,
    kind: String(c.kind),
    sourceUrl: String(c.source_url),
    platform: (c.platform as string | null) ?? null,
    lane: (c.lane as string | null) ?? null,
    createdAt: String(c.created_at),
  }))
}

type OtherCase = { id: string; user_id: string | null; matched_user_ids: string[] | null; status: string; verified_at: string | null }

/** Each account's other cases (named by, or matched in, another case), by status, verified apart from unverified. */
function historyOf(id: string, others: readonly OtherCase[]): AccountHistory {
  const mine = others.filter((c) => c.user_id === id || (c.matched_user_ids ?? []).includes(id))
  const tally = (cases: readonly OtherCase[]) =>
    cases.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }), {})
  return { verified: tally(mine.filter((c) => c.verified_at)), unverified: tally(mine.filter((c) => !c.verified_at)) }
}

async function activeRestrictionsOf(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("content_restrictions")
    .select("id", { count: "exact", head: true })
    .eq("owner_user_id", userId)
    .is("lifted_at", null)
  if (error) throw new Error(`Account restrictions read failed: ${error.message}`)
  return count ?? 0
}

type AccountsRead = { users: MatchedUser[]; more: number; historyTruncated: boolean }

async function matchedUsersOf(ids: readonly string[], thisCaseId: string): Promise<AccountsRead> {
  const unique = [...new Set(ids)]
  const shown = unique.slice(0, CASE_ACCOUNT_LIMIT)
  if (shown.length === 0) return { users: [], more: 0, historyTruncated: false }
  const history = () =>
    supabase.from("rights_complaints").select("id, user_id, matched_user_ids, status, verified_at").neq("id", thisCaseId)
  const [profiles, named, matched, restrictions] = await Promise.all([
    supabase.from("profiles").select("id, email").in("id", shown),
    history().in("user_id", shown).order("received_at", { ascending: false }).limit(HISTORY_LIMIT),
    history().overlaps("matched_user_ids", shown).order("received_at", { ascending: false }).limit(HISTORY_LIMIT),
    Promise.all(shown.map(activeRestrictionsOf)),
  ])
  if (profiles.error) throw new Error(`Accounts read failed: ${profiles.error.message}`)
  if (named.error) throw new Error(`Account history read failed: ${named.error.message}`)
  if (matched.error) throw new Error(`Account history read failed: ${matched.error.message}`)
  const namedRows = (named.data ?? []) as OtherCase[]
  const matchedRows = (matched.data ?? []) as OtherCase[]
  const emails = new Map(((profiles.data ?? []) as Array<{ id: string; email: string | null }>).map((p) => [p.id, p.email]))
  const others = [...new Map([...namedRows, ...matchedRows].map((c) => [c.id, c])).values()]
  const users = shown.map((id, i) => ({ id, email: emails.get(id) ?? null, otherCases: historyOf(id, others), activeRestrictions: restrictions[i] ?? 0, standing: null }))
  return { users, more: unique.length - shown.length, historyTruncated: namedRows.length >= HISTORY_LIMIT || matchedRows.length >= HISTORY_LIMIT }
}

type RecordsRead = { record: AccountRecord | null; standings: ReadonlyMap<string, AccountStanding> }

const NO_RECORDS: RecordsRead = { record: null, standings: new Map() }

/** The named account's record and each shown account's standing, under the repeat-infringer policy as it reads now (fresh: the step shown is the step a measure is checked against). */
async function recordsOf(namedUserId: string | null, userIds: readonly string[]): Promise<RecordsRead> {
  const policy = await currentRepeatInfringerPolicy()
  const now = new Date()
  const [record, standings] = await Promise.all([
    namedUserId ? accountRecordOf(namedUserId, policy, now) : Promise.resolve(null),
    standingOf(userIds.slice(0, CASE_ACCOUNT_LIMIT), policy, now),
  ])
  return { record, standings }
}

function valueOr<T>(result: PromiseSettledResult<T>, empty: T, section: CaseSection, caseId: string): T {
  if (result.status === "fulfilled") return result.value
  console.warn(`[complaint-cases] ${section} of ${caseId} could not be read:`, result.reason instanceof Error ? result.reason.message : result.reason)
  return empty
}

type Submission = Pick<
  ComplaintCase,
  | keyof ComplaintSummary
  | "claimantRole"
  | "originalWork"
  | "originalWorkUrl"
  | "reportedContent"
  | "explanation"
  | "goodFaithAffirmedAt"
  | "accuracyAffirmedAt"
  | "statementsHash"
  | "decision"
  | "complainantAddress"
  | "complainantPhone"
  | "signature"
  | "userAgent"
>

/** What the complainant sent, and the case's decision, as the screen shows them. */
function submissionOf(row: Awaited<ReturnType<typeof readCaseRow>>, who: ReturnType<typeof readComplainant>): Submission {
  return {
    ...summaryOf(row, who),
    claimantRole: row.claimant_role,
    originalWork: row.original_work,
    originalWorkUrl: row.original_work_url,
    reportedContent: row.reported_content,
    explanation: row.explanation,
    goodFaithAffirmedAt: row.good_faith_affirmed_at,
    accuracyAffirmedAt: row.accuracy_affirmed_at,
    statementsHash: row.statements_hash,
    decision: row.decision,
    complainantAddress: who.address,
    complainantPhone: who.phone,
    signature: who.signature,
    userAgent: row.user_agent,
  }
}

/** One case, with everything the handler's screen shows. */
export async function readComplaintCase(id: string): Promise<ComplaintCase> {
  const row = await readCaseRow(id)
  const who = readComplainant(row)
  // The account the case names comes first: it is never past the cap.
  const userIds = [...new Set([...(row.user_id ? [row.user_id] : []), ...(row.matched_user_ids ?? [])])]
  const [events, files, confirmations, accounts, restrictions, counterNotices, records] = await Promise.allSettled([
    eventsOf(id),
    matchedAssetsOf(row.matched_asset_ids ?? []),
    matchedConfirmationsOf(row.matched_confirmation_ids ?? []),
    matchedUsersOf(userIds, id),
    listRestrictions({ complaintId: id, limit: 200 }),
    counterNoticesOfCase(id),
    recordsOf(row.user_id, userIds),
  ])
  const sections: ReadonlyArray<readonly [CaseSection, PromiseSettledResult<unknown>]> = [
    ["events", events],
    ["files", files],
    ["confirmations", confirmations],
    ["accounts", accounts],
    ["restrictions", restrictions],
    ["counterNotices", counterNotices],
    ["record", records],
  ]
  const log = valueOr(events, { events: [], truncated: false }, "events", id)
  const people = valueOr<AccountsRead>(accounts, { users: [], more: 0, historyTruncated: false }, "accounts", id)
  const standing = valueOr(records, NO_RECORDS, "record", id)
  const stored = valueOr(files, [], "files", id)
  const found = new Set(stored.map((a) => a.id))
  // Only a read that answered can say a file is gone.
  const missingAssetIds = files.status === "fulfilled" ? [...new Set(row.matched_asset_ids ?? [])].filter((assetId) => !found.has(assetId)) : []
  return {
    ...submissionOf(row, who),
    events: log.events,
    eventsTruncated: log.truncated,
    matchedAssets: stored,
    missingAssetIds,
    matchedConfirmations: valueOr(confirmations, [], "confirmations", id),
    matchedUsers: people.users.map((u) => ({ ...u, standing: standing.standings.get(u.id) ?? null })),
    moreAccounts: people.more,
    historyTruncated: people.historyTruncated,
    restrictions: valueOr(restrictions, [], "restrictions", id),
    counterNotices: valueOr(counterNotices, [], "counterNotices", id),
    record: standing.record,
    partial: sections.filter(([, result]) => result.status === "rejected").map(([section]) => section),
  }
}
