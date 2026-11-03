/**
 * The rows of a content complaint (migration 580) as the handler's screen
 * reads them: the columns each view selects, the summary the queue shows, the
 * case's own row, and the module's error. Shared by the queue and the moves
 * (complaint-cases.ts) and the case view (complaint-case-view.ts).
 *
 * The queue selects and opens the complainant's name and email only; the
 * address, phone and signature are read and opened for one case's view. A
 * ciphertext that does not open (a key rotated without its old key, a damaged
 * value) is that row's problem only: the row says it cannot be read, and the
 * rest of the queue or case is answered.
 */
import { supabase } from "../../lib/supabase.js"
import { COMPLAINT_STATUSES, openComplainant, type ComplainantColumn, type ComplaintStatus } from "../../lib/rights-complaints.js"

export type ComplaintCaseErrorCode = "not_found" | "invalid_status" | "invalid_move" | "conflict"

export class ComplaintCaseError extends Error {
  constructor(
    readonly code: ComplaintCaseErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "ComplaintCaseError"
  }
}

/** The statuses that close a case: its hold on the matched files ends with them (migration 582). */
export const CLOSED_COMPLAINT_STATUSES: ReadonlySet<ComplaintStatus> = new Set(["resolved", "closed"])

export const OPEN_COMPLAINT_STATUSES: readonly ComplaintStatus[] = COMPLAINT_STATUSES.filter((s) => !CLOSED_COMPLAINT_STATUSES.has(s))

export const SUMMARY_COLUMNS =
  "id, reference, kind, category, status, received_at, verified_at, user_id, handler_user_id, closed_at, updated_at, reported_urls, matched_asset_ids, matched_confirmation_ids, matched_user_ids, complainant_name_enc, complainant_email_enc"

export const CASE_COLUMNS = `${SUMMARY_COLUMNS}, complainant_address_enc, complainant_phone_enc, signature_enc, claimant_role, original_work, original_work_url, reported_content, explanation, good_faith_affirmed_at, accuracy_affirmed_at, statements_hash, decision, user_agent, created_at`

export interface SummaryRow {
  id: string
  reference: string
  kind: "copyright" | "other"
  category: string
  status: ComplaintStatus
  received_at: string
  verified_at: string | null
  user_id: string | null
  handler_user_id: string | null
  closed_at: string | null
  updated_at: string
  reported_urls: string[] | null
  matched_asset_ids: string[] | null
  matched_confirmation_ids: string[] | null
  matched_user_ids: string[] | null
  complainant_name_enc: string
  complainant_email_enc: string
}

export interface CaseRow extends SummaryRow {
  complainant_address_enc: string | null
  complainant_phone_enc: string | null
  signature_enc: string | null
  claimant_role: "owner" | "agent" | null
  original_work: string | null
  original_work_url: string | null
  reported_content: string
  explanation: string
  good_faith_affirmed_at: string | null
  accuracy_affirmed_at: string | null
  statements_hash: string | null
  decision: string | null
  user_agent: string | null
  created_at: string
}

export interface ComplaintSummary {
  readonly id: string
  readonly reference: string
  readonly kind: "copyright" | "other"
  readonly category: string
  readonly status: ComplaintStatus
  readonly receivedAt: string
  readonly verifiedAt: string | null
  readonly userId: string | null
  readonly handlerUserId: string | null
  readonly closedAt: string | null
  readonly updatedAt: string
  /** Null when that detail cannot be read (named in `complainantUnreadable`). */
  readonly complainantName: string | null
  readonly complainantEmail: string | null
  /** The complainant's details this answer could not read: an empty list when all of them were read. */
  readonly complainantUnreadable: readonly ComplainantField[]
  readonly reportedUrls: readonly string[]
  readonly matchedAssetIds: readonly string[]
  readonly matchedConfirmationIds: readonly string[]
  readonly matchedUserIds: readonly string[]
}

/** A detail of the complainant, by what the screen calls it. */
export type ComplainantField = "name" | "email" | "address" | "phone" | "signature"

const FIELD_OF: Readonly<Record<ComplainantColumn, ComplainantField>> = {
  complainant_name_enc: "name",
  complainant_email_enc: "email",
  complainant_address_enc: "address",
  complainant_phone_enc: "phone",
  signature_enc: "signature",
}

export interface Complainant {
  readonly name: string | null
  readonly email: string | null
  readonly address: string | null
  readonly phone: string | null
  readonly signature: string | null
  /** The details that could not be read; each is null, and the others are still shown. */
  readonly unreadable: readonly ComplainantField[]
}

/** The row's complainant, each detail opened on its own; one that does not open is named, and nothing is said about why. */
export function readComplainant(row: SummaryRow | CaseRow): Complainant {
  const opened = openComplainant(row)
  if (opened.unreadable.length > 0) {
    console.warn(`[complaint-cases] the complainant of ${row.id} cannot be read in full: ${opened.unreadable.join(", ")}`)
  }
  return {
    name: opened.name,
    email: opened.email,
    address: opened.address,
    phone: opened.phone,
    signature: opened.signature,
    unreadable: opened.unreadable.map((column) => FIELD_OF[column]),
  }
}

export function summaryOf(row: SummaryRow, who: Complainant = readComplainant(row)): ComplaintSummary {
  return {
    id: row.id,
    reference: row.reference,
    kind: row.kind,
    category: row.category,
    status: row.status,
    receivedAt: row.received_at,
    verifiedAt: row.verified_at,
    userId: row.user_id,
    handlerUserId: row.handler_user_id,
    closedAt: row.closed_at,
    updatedAt: row.updated_at,
    complainantName: who.name,
    complainantEmail: who.email,
    complainantUnreadable: who.unreadable,
    reportedUrls: row.reported_urls ?? [],
    matchedAssetIds: row.matched_asset_ids ?? [],
    matchedConfirmationIds: row.matched_confirmation_ids ?? [],
    matchedUserIds: row.matched_user_ids ?? [],
  }
}

export async function readCaseRow(id: string): Promise<CaseRow> {
  const { data, error } = await supabase.from("rights_complaints").select(CASE_COLUMNS).eq("id", id).maybeSingle()
  if (error) throw new Error(`Complaint read failed: ${error.message}`)
  if (!data) throw new ComplaintCaseError("not_found", "No such complaint")
  return data as CaseRow
}
