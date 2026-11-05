import type { ComplaintStatus } from "@/ee/hooks/queries/use-admin-complaints-queries"
import type { MeasureKind } from "@/ee/hooks/queries/use-admin-repeat-infringers"

/** What each status means to the handler (the operator pages are English, like the rest of the admin chrome). */
export const STATUS_LABELS: Readonly<Record<ComplaintStatus, string>> = {
  received: "Received",
  under_review: "Under review",
  additional_information_requested: "More information requested",
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

export const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  copyright_infringement: "Copyright infringement",
  likeness: "Image or likeness",
  voice: "Voice",
  impersonation: "Impersonation",
  privacy: "Privacy",
  other: "Other legal complaint",
}

/** The log's entries, by kind; an unknown kind shows as written. */
export const EVENT_LABELS: Readonly<Record<string, string>> = {
  received: "Complaint received",
  honeypot_filled: "Received (filled the hidden field: likely automated)",
  matched: "Links matched against our records",
  match_failed: "Matching the links failed",
  rematched: "Links matched again",
  verification_sent: "Verification email sent",
  verified: "Complainant verified their email",
  acknowledgment_sent: "Acknowledgment sent",
  mail_unavailable: "Email not sent",
  status_changed: "Status changed",
  decision_changed: "Decision changed",
  note: "Note",
  user_named: "Account named",
  content_restricted: "Content restricted",
  restriction_lifted: "Restriction lifted",
  row_updated: "Case record changed",
  counter_notice_received: "Counter-notice received",
  counter_notice_forwarded: "Counter-notice sent to the complainant",
  court_action_received: "Court action received",
  court_action_ended: "Court action ended",
  counter_notice_declined: "Counter-notice declined",
  content_restored: "Content restored",
  restore_window_opened: "Restore window opened",
  restore_window_closing: "Restore window closes on the next weekday",
  infringement_recorded: "Infringement recorded against the account",
  infringement_withdrawn: "Infringement withdrawn",
  measure_applied: "Measure taken on the account",
  measure_lifted: "Measure lifted",
  user_notified: "Email to the account (content restricted)",
  complainant_notified: "Update email to the complainant",
}

/** What became of one of the case's emails, as its log entry recorded it (backend ee/lib/complaint-notices.ts). */
export function emailOutcome(data: Readonly<Record<string, unknown>>): string {
  if (data.sent === true) return "sent"
  if (data.sent === "unknown") return "may have been sent: the mail service did not answer in time"
  return `not sent: ${String(data.reason ?? "unknown")}${data.error ? ` (${String(data.error)})` : ""}`
}

/** A measure on an account, as the handler reads it. */
export const MEASURE_LABELS: Readonly<Record<MeasureKind, string>> = {
  warning: "Warning",
  imports_blocked: "Importing links blocked",
  suspended: "Account suspended",
  closed: "Account closed",
}

/** A policy step, or a measure, as words: "Importing links blocked for 30 days", "Account suspended for 7 days", "Warning". */
export function measureLabel(kind: MeasureKind, days?: number | null): string {
  if (kind !== "imports_blocked" && kind !== "suspended") return MEASURE_LABELS[kind]
  if (days) return `${MEASURE_LABELS[kind]} for ${days} day${days === 1 ? "" : "s"}`
  return kind === "suspended" ? MEASURE_LABELS.suspended : `${MEASURE_LABELS.imports_blocked} until lifted`
}

/** A matched account's standing, as words: its infringements in the window, and what is in force. */
export function standingLabel(standing: { readonly inWindow: number; readonly inForce: readonly MeasureKind[] }, windowMonths?: number): string {
  const within = windowMonths ? ` in ${windowMonths} months` : " in the policy's window"
  const count = `${standing.inWindow} infringement${standing.inWindow === 1 ? "" : "s"}${within}`
  return standing.inForce.length === 0 ? count : `${count} · ${standing.inForce.map((kind) => MEASURE_LABELS[kind].toLowerCase()).join(", ")}`
}

/** Who wrote a log entry: the complainant, the content's owner (a counter-notice), the server, the database's own record of a change, or an administrator. */
export function actorLabel(actor: string): string {
  if (actor === "system" || actor === "complainant" || actor === "database") return actor
  if (actor === "owner") return "the content's owner"
  return `admin ${actor.slice(0, 8)}`
}

/** An account's other cases, as words: the verified by status, the unverified as a count. */
export function historyLabel(history: { readonly verified: Readonly<Record<string, number>>; readonly unverified: Readonly<Record<string, number>> }): string {
  const verified = Object.entries(history.verified).map(([status, n]) => `${n} ${statusLabel(status).toLowerCase()}`)
  const unverified = Object.values(history.unverified).reduce((sum, n) => sum + n, 0)
  const parts = [...verified, ...(unverified > 0 ? [`${unverified} unverified`] : [])]
  return parts.length === 0 ? "no other cases" : `other cases: ${parts.join(", ")}`
}

/** Closed cases end the hold on what they matched (migration 582). */
export const CLOSED_STATUSES: ReadonlySet<ComplaintStatus> = new Set(["resolved", "closed"])

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as ComplaintStatus] ?? status
}

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category
}

/** A badge's tone: new work, in progress, waiting on someone, done. */
export function statusTone(status: string): string {
  if (status === "received") return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
  if (CLOSED_STATUSES.has(status as ComplaintStatus)) return "border-muted-foreground/30 bg-muted text-muted-foreground"
  if (status === "content_restricted" || status === "content_removed") return "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
  if (status.startsWith("counter_notice") || status === "awaiting_legal_action") return "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300"
  return "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300"
}

/** What the screen says of the complainant's details it could not read. */
export function unreadableLabel(fields: readonly string[]): string {
  return fields.length === 0 ? "" : `${fields.join(", ")} cannot be read`
}

/**
 * A mail link to the complainant: each side of the address encoded, so what
 * they typed can only ever be an address (never a `?cc=` or a `&body=`).
 */
export function mailtoHref(email: string, subject: string): string {
  const at = email.lastIndexOf("@")
  const address = at > 0 ? `${encodeURIComponent(email.slice(0, at))}@${encodeURIComponent(email.slice(at + 1))}` : encodeURIComponent(email)
  return `mailto:${address}?subject=${encodeURIComponent(subject)}`
}

/** Whether a stored file's address can be opened from the case: a file that is not restricted, at an https address. */
export function openableAddress(url: string | null, restrictedAt: string | null): url is string {
  if (!url || restrictedAt) return false
  try {
    return new URL(url).protocol === "https:"
  } catch {
    return false
  }
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}
