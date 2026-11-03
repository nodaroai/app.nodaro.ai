/**
 * The handler's side of a content complaint (migration 580): the queue, and
 * the moves on a case — its status (with a decision), a note, the account it
 * names, its links matched again, a restriction made from it. One case's view
 * is complaint-case-view.ts; the rows both read are complaint-case-rows.ts.
 *
 * Every move is written to the case's log (`rights_complaint_events`) with
 * the administrator as the actor, and the route audits it too. Once a move
 * has been written, its log entry is best effort: the move happened, and an
 * error answered for it would only send the handler to make it again. What
 * the complainant submitted never changes (580's trigger): only the case
 * moves. The complainant's details leave this module decrypted for the screen
 * only, never into an audit payload or a log line.
 */
import { supabase } from "../../lib/supabase.js"
import {
  COMPLAINT_STATUSES,
  MAX_MATCHED_LINKS,
  complainantEmailHash,
  extractLinks,
  matchReportedUrls,
  recordComplaintEvent,
  recordComplaintEventQuietly,
  type ComplaintStatus,
} from "../../lib/rights-complaints.js"
import { restrictAsset, restrictJob, type ContentRestriction } from "../../lib/content-restrictions.js"
import {
  CLOSED_COMPLAINT_STATUSES,
  ComplaintCaseError,
  OPEN_COMPLAINT_STATUSES,
  SUMMARY_COLUMNS,
  readCaseRow,
  summaryOf,
  type CaseRow,
  type ComplaintSummary,
  type SummaryRow,
} from "./complaint-case-rows.js"

export {
  CLOSED_COMPLAINT_STATUSES,
  ComplaintCaseError,
  type ComplaintCaseErrorCode,
  type ComplaintSummary,
} from "./complaint-case-rows.js"
export { readComplaintCase, type ComplaintCase, type ComplaintEvent, type CaseSection } from "./complaint-case-view.js"

export interface ListComplaintsInput {
  readonly status?: ComplaintStatus | "open"
  readonly kind?: "copyright" | "other"
  /** A reference, or part of one (`CR-2026-0001`). */
  readonly reference?: string
  /** The complainant's email, looked up by its keyed hash: never by scanning ciphertext. */
  readonly email?: string
  readonly page?: number
  readonly limit?: number
}

/** The queue's filters, on a select of the given columns. */
function queueQuery(input: ListComplaintsInput, columns: string, head: boolean) {
  let query = supabase.from("rights_complaints").select(columns, { count: "exact", head })
  if (input.status === "open") query = query.in("status", [...OPEN_COMPLAINT_STATUSES])
  else if (input.status) query = query.eq("status", input.status)
  if (input.kind) query = query.eq("kind", input.kind)
  const email = input.email?.trim()
  if (email) query = query.eq("complainant_email_hash", complainantEmailHash(email))
  // Matched as text: the pattern's own wildcards are dropped from what was typed.
  const reference = input.reference?.trim().replace(/[%_*\\]/g, "")
  if (reference) query = query.ilike("reference", `%${reference}%`)
  return query
}

/** The queue: newest first, filtered; `total` is the count under the same filters, a page past the end included. */
export async function listComplaintCases(input: ListComplaintsInput = {}): Promise<{ cases: ComplaintSummary[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, Math.floor(input.page ?? 1))
  const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 50)))
  const from = (page - 1) * limit
  const { data, count, error } = await queueQuery(input, SUMMARY_COLUMNS, false)
    .order("received_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + limit - 1)
  // A page past the end (the queue shrank while it was open): no cases, and the count as it is now.
  if (error?.code === "PGRST103") {
    const counted = await queueQuery(input, "id", true)
    if (counted.error) throw new Error(`Complaints count failed: ${counted.error.message}`)
    return { cases: [], total: counted.count ?? 0, page, limit }
  }
  if (error) throw new Error(`Complaints read failed: ${error.message}`)
  return { cases: ((data ?? []) as unknown as SummaryRow[]).map((row) => summaryOf(row)), total: count ?? 0, page, limit }
}

/**
 * The cases waiting on a handler: open and verified. An unverified case is
 * anyone's claim until its sender proves their email; it stays in the queue,
 * and does not call for attention.
 */
export async function countOpenComplaints(): Promise<number> {
  const { count, error } = await supabase
    .from("rights_complaints")
    .select("id", { count: "exact", head: true })
    .in("status", [...OPEN_COMPLAINT_STATUSES])
    .not("verified_at", "is", null)
  if (error) throw new Error(`Complaints count failed: ${error.message}`)
  return count ?? 0
}

const CHANGED_MEANWHILE = "The case changed meanwhile; reload it and try again"

/**
 * The case as the handler's screen showed it: its `updatedAt`, which the
 * table stamps on every change (migration 580). A change is made from it or
 * not at all, so one handler never overwrites what another saved meanwhile.
 */
function assertSeen(before: CaseRow, seen: string): void {
  if (before.updated_at !== seen) throw new ComplaintCaseError("conflict", CHANGED_MEANWHILE)
}

export interface StatusMove {
  /** The case's `updatedAt` as the handler's screen showed it. */
  readonly seen: string
  readonly status: ComplaintStatus
  /** The handler's decision, written on the case (kept on a later move unless given again); empty clears it. */
  readonly decision?: string | null
  /** A note for the log, beside the move. */
  readonly note?: string | null
}

const blankToNull = (text: string | null | undefined): string | null => {
  const trimmed = text?.trim() ?? ""
  return trimmed === "" ? null : trimmed
}

/**
 * Moves the case: its status (and `closed_at` when the move closes or
 * reopens it), its decision, the handler (the administrator moving it). The
 * move is made from the case as the handler saw it, so two handlers never
 * both move one case or overwrite each other's decision, and the log says
 * where the case came from. A save that changes neither the status nor the
 * decision is a note on the log; one that changes nothing is refused.
 */
export async function moveComplaintStatus(id: string, move: StatusMove, adminUserId: string): Promise<ComplaintSummary> {
  if (!COMPLAINT_STATUSES.includes(move.status)) throw new ComplaintCaseError("invalid_status", "No such status")
  const before = await readCaseRow(id)
  assertSeen(before, move.seen)
  const decision = move.decision === undefined ? undefined : blankToNull(move.decision)
  const decisionChanged = decision !== undefined && decision !== blankToNull(before.decision)
  const statusChanged = move.status !== before.status
  const note = blankToNull(move.note)
  if (!statusChanged && !decisionChanged) {
    if (!note) throw new ComplaintCaseError("invalid_move", "Nothing to change")
    await recordComplaintEvent(id, "note", adminUserId, { text: note })
    return summaryOf(before)
  }
  const closing = CLOSED_COMPLAINT_STATUSES.has(move.status)
  const patch: Record<string, unknown> = {
    handler_user_id: adminUserId,
    ...(statusChanged ? { status: move.status, closed_at: closing ? (before.closed_at ?? new Date().toISOString()) : null } : {}),
    ...(decisionChanged ? { decision } : {}),
  }
  const { data, error } = await supabase
    .from("rights_complaints")
    .update(patch)
    .eq("id", id)
    .eq("updated_at", move.seen)
    .select(SUMMARY_COLUMNS)
    .maybeSingle()
  // 55026: a counter-notice on the case waits for a decision (migration 587); its restore deadline must not pass on a closed case.
  if (error?.code === "55026") {
    throw new ComplaintCaseError(
      "invalid_move",
      "A counter-notice on this case waits for a decision: restore the content, record a court action, or decline the counter-notice before closing the case",
    )
  }
  if (error) throw new Error(`Complaint move failed: ${error.message}`)
  if (!data) throw new ComplaintCaseError("conflict", CHANGED_MEANWHILE)
  const detail = { ...(note ? { note } : {}), ...(decisionChanged ? { decision } : {}) }
  await (statusChanged
    ? recordComplaintEventQuietly(id, "status_changed", adminUserId, { from: before.status, to: move.status, ...detail })
    : recordComplaintEventQuietly(id, "decision_changed", adminUserId, detail))
  return summaryOf(data as unknown as SummaryRow)
}

const newOnly = (found: readonly string[], had: readonly string[]): string[] => found.filter((value) => !had.includes(value))

/**
 * Matches the case's links onto our records again (lib/rights-complaints.ts
 * `matchReportedUrls`, over the links as the complainant wrote them, the same
 * reading the submission made): for a case whose first match failed, or whose
 * links name files stored since. What is found is ADDED to the case's
 * matches; nothing is ever removed, since a verified, open case holds what it
 * matched (migration 582) and a record that changed since must not release
 * it. The log lists what was added.
 */
export async function rematchComplaint(id: string, adminUserId: string): Promise<ComplaintSummary> {
  const before = await readCaseRow(id)
  const links = extractLinks(`${before.reported_content}\n${before.original_work_url ?? ""}`).slice(0, MAX_MATCHED_LINKS)
  const found = await matchReportedUrls(links)
  const had = {
    assets: before.matched_asset_ids ?? [],
    confirmations: before.matched_confirmation_ids ?? [],
    users: before.matched_user_ids ?? [],
  }
  const added = {
    assetIds: newOnly(found.assetIds, had.assets),
    confirmationIds: newOnly(found.confirmationIds, had.confirmations),
    userIds: newOnly(found.userIds, had.users),
  }
  const summary = await addMatches(before, had, added)
  await recordComplaintEventQuietly(id, "rematched", adminUserId, {
    links: links.length,
    assets: found.assetIds.length,
    confirmations: found.confirmationIds.length,
    users: found.userIds.length,
    added,
  })
  return summary
}

/** Writes the union, from the row as it was read: a case changed meanwhile is a conflict, never a union over a stale read. */
async function addMatches(
  before: CaseRow,
  had: { assets: readonly string[]; confirmations: readonly string[]; users: readonly string[] },
  added: { assetIds: readonly string[]; confirmationIds: readonly string[]; userIds: readonly string[] },
): Promise<ComplaintSummary> {
  if (added.assetIds.length + added.confirmationIds.length + added.userIds.length === 0) return summaryOf(before)
  const { data, error } = await supabase
    .from("rights_complaints")
    .update({
      matched_asset_ids: [...had.assets, ...added.assetIds],
      matched_confirmation_ids: [...had.confirmations, ...added.confirmationIds],
      matched_user_ids: [...had.users, ...added.userIds],
    })
    .eq("id", before.id)
    .eq("updated_at", before.updated_at)
    .select(SUMMARY_COLUMNS)
    .maybeSingle()
  if (error) throw new Error(`Complaint rematch failed: ${error.message}`)
  if (!data) throw new ComplaintCaseError("conflict", "The case changed meanwhile; match its links again")
  return summaryOf(data as unknown as SummaryRow)
}

/** A note on the case's log, by the administrator: the note is the whole move, so its write failing is the caller's. */
export async function addComplaintNote(id: string, text: string, adminUserId: string): Promise<void> {
  await readCaseRow(id)
  await recordComplaintEvent(id, "note", adminUserId, { text })
}

/**
 * The account the case names (the one that imported or holds the content):
 * one of the accounts the case's links matched, as the handler's screen
 * offers them; null to unname it. Made from the case as the handler saw it.
 */
export async function nameComplaintUser(id: string, userId: string | null, seen: string, adminUserId: string): Promise<ComplaintSummary> {
  const before = await readCaseRow(id)
  assertSeen(before, seen)
  if (before.user_id === userId) throw new ComplaintCaseError("invalid_move", userId ? "The case already names that account" : "The case names no account")
  if (userId && !(before.matched_user_ids ?? []).includes(userId)) {
    throw new ComplaintCaseError("invalid_move", "Name one of the accounts the case's links matched")
  }
  const { data, error } = await supabase
    .from("rights_complaints")
    .update({ user_id: userId, handler_user_id: adminUserId })
    .eq("id", id)
    .eq("updated_at", seen)
    .select(SUMMARY_COLUMNS)
    .maybeSingle()
  // 23503: the account does not exist (the column references it).
  if (error?.code === "23503") throw new ComplaintCaseError("invalid_move", "No such account")
  if (error) throw new Error(`Complaint account write failed: ${error.message}`)
  if (!data) throw new ComplaintCaseError("conflict", CHANGED_MEANWHILE)
  await recordComplaintEventQuietly(id, "user_named", adminUserId, { from: before.user_id, to: userId })
  return summaryOf(data as unknown as SummaryRow)
}

export interface RestrictFromCaseInput {
  readonly assetId?: string | null
  readonly jobId?: string | null
  readonly reason: string
}

/** The statuses a restriction moves on to `content_restricted`. */
const BEFORE_RESTRICTED: readonly ComplaintStatus[] = ["received", "under_review", "additional_information_requested"]

/**
 * Whether a restriction may be made in a case's name: its file must be one
 * the case's links matched, or its job one that made such a file. Throws
 * `not_found` for an unknown case and `invalid_move` for anything else, so a
 * wrong or stale id never restricts unrelated content under a case's name.
 */
export async function ensureCaseTarget(caseId: string, target: { readonly assetId?: string | null; readonly jobId?: string | null }): Promise<CaseRow> {
  const row = await readCaseRow(caseId)
  if ((target.assetId ? 1 : 0) + (target.jobId ? 1 : 0) !== 1) throw new ComplaintCaseError("invalid_move", "Name one of assetId or jobId")
  const matched = row.matched_asset_ids ?? []
  if (target.assetId) {
    if (!matched.includes(target.assetId)) throw new ComplaintCaseError("invalid_move", "The file is not one the case's links matched")
    return row
  }
  // restricted-read: a matched file stays matched once restricted; its job is still the case's.
  const { data, error } = await supabase
    .from("assets") // tenant-scope-ignore: the administrator's case reaches the matched rows of any account
    .select("id")
    .eq("job_id", target.jobId!)
    .limit(1000)
  if (error) throw new Error(`Matched job read failed: ${error.message}`)
  const made = ((data ?? []) as Array<{ id: string }>).map((a) => a.id)
  if (!made.some((assetId) => matched.includes(assetId))) throw new ComplaintCaseError("invalid_move", "The job made none of the files the case's links matched")
  return row
}

/**
 * A restriction made from the case (lib/content-restrictions.ts, with the
 * case as its complaint: the restriction writes itself on the case's log),
 * of a file the case matched or the job that made one, then the case moved
 * to `content_restricted` when it stands earlier than that. The restriction
 * is the move: when the case cannot be moved on (it changed meanwhile), it
 * keeps its status and the restriction is still answered.
 */
export async function restrictFromComplaint(id: string, input: RestrictFromCaseInput, adminUserId: string): Promise<{ restriction: ContentRestriction; case: ComplaintSummary }> {
  const before = await ensureCaseTarget(id, input)
  const restrictInput = { reason: input.reason, complaintId: id, adminUserId }
  const restriction = input.assetId ? await restrictAsset(input.assetId, restrictInput) : await restrictJob(input.jobId!, restrictInput)
  return { restriction, case: await moveOnToRestricted(before, adminUserId) }
}

async function moveOnToRestricted(before: CaseRow, adminUserId: string): Promise<ComplaintSummary> {
  if (!BEFORE_RESTRICTED.includes(before.status)) return summaryOf(before)
  try {
    return await moveComplaintStatus(before.id, { seen: before.updated_at, status: "content_restricted" }, adminUserId)
  } catch (e) {
    console.warn(`[complaint-cases] ${before.id} was restricted but not moved on:`, e instanceof Error ? e.message : e)
    try {
      return summaryOf(await readCaseRow(before.id))
    } catch {
      return summaryOf(before)
    }
  }
}
