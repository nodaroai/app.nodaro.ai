/**
 * The two emails a complaint's handler sends from the case, the policy's
 * notices (lib/complaint-mail.ts sends them through Loops):
 *  - "Content access restricted", to the account whose content a restriction
 *    made from a copyright complaint covers: which of ITS files were
 *    restricted, the link they came from, the reason the handler writes for
 *    the account (never the restriction's own reason, which is the record's:
 *    lib/my-restrictions.ts never shows it to the owner either), the case's
 *    reference, and the page to send a counter-notice from;
 *  - "Complaint update", to the complainant: the case's status and what was
 *    done (the handler's decision).
 *
 * Nothing is sent on its own: the handler sends each from the screen after
 * reading its preview. The preview and the send are built by the same
 * function, and the preview carries a digest of what it showed (address and
 * values): a send whose email no longer matches it (the case, the decision or
 * the account changed meanwhile) is refused, so what goes out is exactly what
 * the handler approved. Every send is written to the case's log
 * (`user_notified`, `complainant_notified`) without the address it went to:
 * sent (with the service's id), not sent (with why), or unknown (the service
 * did not answer in time, and may have taken it). A notice delivered to the
 * account moves an earlier case on to `user_notified`.
 *
 * Loops puts each value into the email without escaping it
 * (admin-message-templates.ts), so every value is escaped here, the handler's
 * own text keeping its line breaks.
 */
import { createHash } from "node:crypto"
import { config } from "../../lib/config.js"
import { supabase } from "../../lib/supabase.js"
import { sendComplaintUpdate, sendContentRestricted, type ComplaintMailResult } from "../../lib/complaint-mail.js"
import { listRestrictions, type ContentRestriction } from "../../lib/content-restrictions.js"
import { CLOSED_COMPLAINT_STATUSES, recordComplaintEventQuietly, statusComesBefore, type ComplaintStatus } from "../../lib/rights-complaints.js"
import { escapeHtml, renderAdminMessageBody } from "./admin-message-markdown.js"
import { ComplaintCaseError, readCaseRow, readComplainant, summaryOf, type CaseRow, type ComplaintSummary } from "./complaint-case-rows.js"
import { moveComplaintStatus } from "./complaint-cases.js"

/** The page an account sends a counter-notice from (its content restrictions, in Settings). */
export const COUNTER_NOTICE_PATH = "/settings/content-restrictions"

/** The case's status as the complainant reads it in an update. */
export const STATUS_WORDS: Readonly<Record<ComplaintStatus, string>> = {
  received: "Received",
  under_review: "Under review",
  additional_information_requested: "Additional information requested",
  content_restricted: "Content restricted",
  content_removed: "Content removed",
  user_notified: "User notified",
  counter_notice_received: "Counter-notice received",
  counter_notice_under_review: "Counter-notice under review",
  awaiting_legal_action: "Awaiting legal action",
  content_restored: "Content restored",
  resolved: "Resolved",
  closed: "Closed",
}

/** An email as the handler previews it: where it goes, each value as the recipient reads it, and the digest a send must name. */
export interface ComplaintNotice {
  readonly to: string
  readonly values: Readonly<Record<string, string>>
  readonly digest: string
}

export type ComplaintNoticeFailure = "no_mailer" | "no_template" | "no_link" | "failed" | "unknown"

/** A notice that did not go out, or whose fate is not known. */
export class ComplaintNoticeError extends Error {
  constructor(
    readonly reason: ComplaintNoticeFailure,
    message: string,
  ) {
    super(message)
    this.name = "ComplaintNoticeError"
  }
}

const FAILURE_MESSAGES: Readonly<Record<ComplaintNoticeFailure, string>> = {
  no_mailer: "Emails cannot be sent from this deployment",
  no_template: "This email's template is not set on this deployment",
  no_link: "The app's public address is not set, so the email would have no link to the counter-notice page",
  failed: "The mail service did not take the email; try again later",
  unknown: "The mail service did not answer in time: the email may have been sent. Check before sending it again",
}

/** The most files a notice reads to name the account's restricted files. */
const MAX_FILES = 50

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })

function dayOf(iso: string | null | undefined): string | null {
  if (!iso) return null
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? null : DAY.format(at)
}

function noticeOf(to: string, values: Readonly<Record<string, string>>): ComplaintNotice {
  const digest = createHash("sha256").update(JSON.stringify({ to, values })).digest("hex").slice(0, 32)
  return { to, values, digest }
}

interface RestrictedFile {
  readonly filename: string | null
  readonly type: string | null
  readonly created_at: string | null
}

/**
 * The restriction's files that are the account's own, oldest first. A
 * restriction also covers other accounts' copies of the same bytes; their
 * names are theirs, never told to this account.
 */
async function ownRestrictedFiles(restriction: ContentRestriction, ownerUserId: string): Promise<RestrictedFile[]> {
  const ids = [...new Set([...(restriction.assetId ? [restriction.assetId] : []), ...restriction.assetIds])].slice(0, MAX_FILES)
  if (ids.length === 0) return []
  const { data, error } = await supabase
    // restricted-read: the owner is told which of their files were restricted.
    .from("assets") // tenant-scope-ignore: the handler's notice names the restricted files of the account it tells
    .select("filename, type, created_at")
    .in("id", ids)
    .eq("user_id", ownerUserId)
    .order("created_at", { ascending: true })
  if (error) throw new Error(`Restricted files read failed: ${error.message}`)
  return (data ?? []) as RestrictedFile[]
}

function describeFile(file: RestrictedFile): string {
  const day = dayOf(file.created_at)
  const about = [file.type?.trim(), day ? `stored ${day}` : null].filter(Boolean).join(", ")
  const name = file.filename?.trim() || "A file"
  return about ? `${name} (${about})` : name
}

/** What a restriction covers, as its owner can recognise it: a file by its name, kind and day; several files by count and names. */
function describeRestricted(restriction: ContentRestriction, files: readonly RestrictedFile[]): string {
  if (files.length === 1) return describeFile(files[0]!)
  if (files.length > 1) {
    const names = files.slice(0, 3).map((f) => f.filename?.trim() || "a file").join(", ")
    return `${files.length} files: ${names}${files.length > 3 ? ", and more" : ""}`
  }
  const day = dayOf(restriction.restrictedAt)
  return day ? `Content restricted on ${day}` : "Content restricted earlier"
}

/** The link the content came from, when it is a web address; anything else is not shown. */
function sourceOf(restriction: ContentRestriction): string {
  const url = restriction.sourceUrl?.trim() ?? ""
  return /^https?:\/\//i.test(url) ? url : "Not available"
}

async function emailOfAccount(userId: string): Promise<string> {
  const { data, error } = await supabase.from("profiles").select("email").eq("id", userId).maybeSingle()
  if (error) throw new Error(`Account read failed: ${error.message}`)
  const email = (data as { email?: string | null } | null)?.email?.trim()
  if (!email) throw new ComplaintCaseError("invalid_move", "The account the restriction covers has no email address")
  return email
}

function counterNoticeUrl(): string {
  const base = config.PUBLIC_URL.trim().replace(/\/+$/, "")
  if (!base) throw new ComplaintNoticeError("no_link", FAILURE_MESSAGES.no_link)
  return `${base}${COUNTER_NOTICE_PATH}`
}

/**
 * "Content access restricted" for one of the case's restrictions, with the
 * reason the handler wrote for the account: refused unless the case is an
 * open copyright case and the restriction is its own, in force, of an
 * account with an email.
 */
async function accountNotice(row: CaseRow, restrictionId: string, reason: string): Promise<ComplaintNotice> {
  if (row.kind !== "copyright") {
    throw new ComplaintCaseError("invalid_move", "This notice is for a copyright complaint: tell the account about another complaint with a general message")
  }
  // A counter-notice is refused on a closed case (migration 587): the notice must not invite one.
  if (CLOSED_COMPLAINT_STATUSES.has(row.status)) throw new ComplaintCaseError("invalid_move", "The case is closed: the notice would invite a counter-notice the case no longer takes")
  const told = reason.trim()
  if (!told) throw new ComplaintCaseError("invalid_move", "Write the reason the account will read")
  const restriction = (await listRestrictions({ complaintId: row.id, limit: 200 })).find((r) => r.id === restrictionId)
  if (!restriction) throw new ComplaintCaseError("invalid_move", "The restriction is not one this case made")
  if (restriction.liftedAt) throw new ComplaintCaseError("invalid_move", "The restriction was lifted: nothing of it is restricted to tell the account about")
  const owner = restriction.ownerUserId
  if (!owner) throw new ComplaintCaseError("invalid_move", "The restricted content belongs to no account")
  const link = counterNoticeUrl()
  const [to, files] = await Promise.all([emailOfAccount(owner), ownRestrictedFiles(restriction, owner)])
  return noticeOf(to, {
    content: describeRestricted(restriction, files),
    source: sourceOf(restriction),
    reason: told,
    reference: row.reference,
    counterNoticeUrl: link,
  })
}

/** "Complaint update": refused until the complainant proved their email and the case has a decision to tell them. */
function complainantUpdate(row: CaseRow): ComplaintNotice {
  if (!row.verified_at) throw new ComplaintCaseError("invalid_move", "The complainant has not proven their email: an update cannot be sent to it")
  const decision = row.decision?.trim()
  if (!decision) throw new ComplaintCaseError("invalid_move", "Write the decision first: the update tells the complainant what was done")
  const email = readComplainant(row).email?.trim()
  if (!email) throw new ComplaintCaseError("invalid_move", "The complainant's email cannot be read")
  return noticeOf(email, { reference: row.reference, status: STATUS_WORDS[row.status] ?? row.status, action: decision })
}

/** A send is of the email the handler previewed, or of nothing. */
function assertPreviewed(notice: ComplaintNotice, digest: string): void {
  if (notice.digest !== digest) throw new ComplaintCaseError("conflict", "The email changed since its preview: preview it again before sending")
}

/** The handler's own text keeps its line breaks; every other value is one escaped line. */
const escapeValue = (prose: boolean, value: string): string => (prose ? renderAdminMessageBody(value) : escapeHtml(value))

/** The mail service's own words, for the log: without any address they quote, and short. */
const redacted = (text: string): string => text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[address]").slice(0, 300)

/** What a send did, for the case's log: never the address it went to. */
function outcome(result: ComplaintMailResult): Record<string, unknown> {
  if (result.sent) return { sent: true, ...(result.messageId ? { messageId: result.messageId } : {}) }
  if (result.reason === "unknown") return { sent: "unknown" }
  return { sent: false, reason: result.reason, ...(result.error ? { error: redacted(result.error) } : {}) }
}

function failureOf(result: Extract<ComplaintMailResult, { sent: false }>): ComplaintNoticeError {
  return new ComplaintNoticeError(result.reason, FAILURE_MESSAGES[result.reason])
}

/** The case moved on to `user_notified` when it stands earlier; a case moved meanwhile keeps its status, and the email was still sent. */
async function moveOnToNotified(before: CaseRow, adminUserId: string): Promise<ComplaintSummary> {
  if (!statusComesBefore(before.status, "user_notified")) return summaryOf(before)
  try {
    return await moveComplaintStatus(before.id, { seen: before.updated_at, status: "user_notified" }, adminUserId)
  } catch (e) {
    console.warn(`[complaint-notices] ${before.id}: the account was told but the case was not moved on:`, e instanceof Error ? e.message : e)
    try {
      return summaryOf(await readCaseRow(before.id))
    } catch {
      return summaryOf(before)
    }
  }
}

export async function previewAccountNotice(caseId: string, restrictionId: string, reason: string): Promise<ComplaintNotice> {
  return accountNotice(await readCaseRow(caseId), restrictionId, reason)
}

/** Sends the previewed "Content access restricted" (its `digest`), logs it, and moves an earlier case on to `user_notified`. */
export async function sendAccountNotice(caseId: string, restrictionId: string, reason: string, digest: string, adminUserId: string): Promise<ComplaintSummary> {
  const row = await readCaseRow(caseId)
  const notice = await accountNotice(row, restrictionId, reason)
  assertPreviewed(notice, digest)
  const v = notice.values
  const result = await sendContentRestricted(notice.to, {
    content: escapeValue(false, v.content!),
    source: escapeValue(false, v.source!),
    reason: escapeValue(true, v.reason!),
    reference: escapeValue(false, v.reference!),
    counterNoticeUrl: escapeValue(false, v.counterNoticeUrl!),
  })
  await recordComplaintEventQuietly(row.id, "user_notified", adminUserId, { restrictionId, ...outcome(result) })
  if (!result.sent) throw failureOf(result)
  return moveOnToNotified(row, adminUserId)
}

export async function previewComplainantUpdate(caseId: string): Promise<ComplaintNotice> {
  return complainantUpdate(await readCaseRow(caseId))
}

/** Sends the previewed "Complaint update" (its `digest`) to the complainant, and logs it with the status it told. */
export async function sendComplainantUpdate(caseId: string, digest: string, adminUserId: string): Promise<ComplaintSummary> {
  const row = await readCaseRow(caseId)
  const notice = complainantUpdate(row)
  assertPreviewed(notice, digest)
  const v = notice.values
  const result = await sendComplaintUpdate(notice.to, {
    reference: escapeValue(false, v.reference!),
    status: escapeValue(false, v.status!),
    action: escapeValue(true, v.action!),
  })
  await recordComplaintEventQuietly(row.id, "complainant_notified", adminUserId, { status: row.status, ...outcome(result) })
  if (!result.sent) throw failureOf(result)
  return summaryOf(row)
}
