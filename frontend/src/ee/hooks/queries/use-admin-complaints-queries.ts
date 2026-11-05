import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getAuthHeaders } from "@/lib/api"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import type { AccountRecord, AccountStanding } from "./use-admin-repeat-infringers"

/**
 * Admin → Complaints: the queue the public form fills, one case, and the
 * moves (backend ee/routes/admin-complaints.ts). Every move refreshes the
 * whole ["admin", "complaints"] family, the open count in the nav included,
 * whether it was made or refused: a refusal (the case moved meanwhile) means
 * the screen is behind.
 */

export const COMPLAINT_STATUSES = [
  "received",
  "under_review",
  "additional_information_requested",
  "content_restricted",
  "content_removed",
  "user_notified",
  "counter_notice_received",
  "counter_notice_under_review",
  "awaiting_legal_action",
  "content_restored",
  "resolved",
  "closed",
] as const
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number]

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
  /** The complainant's details the server could not read; empty when all were read. */
  readonly complainantUnreadable: readonly ComplainantField[]
  readonly reportedUrls: readonly string[]
  readonly matchedAssetIds: readonly string[]
  readonly matchedConfirmationIds: readonly string[]
  readonly matchedUserIds: readonly string[]
}

/** A detail of the complainant, by what the screen calls it. */
export type ComplainantField = "name" | "email" | "address" | "phone" | "signature"

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

export interface MatchedUser {
  readonly id: string
  readonly email: string | null
  /** The account's other cases by status, the verified apart from the unverified. */
  readonly otherCases: {
    readonly verified: Readonly<Record<string, number>>
    readonly unverified: Readonly<Record<string, number>>
  }
  /** Restrictions standing on the account's content. */
  readonly activeRestrictions: number
  /** Its infringements within the policy's window and its measures in force; null when that could not be read. */
  readonly standing: AccountStanding | null
}

/** What happened to one key of a restriction (backend lib/content-restriction-bytes.ts). */
export interface RestrictionKeyRecord {
  readonly state: "moved" | "restored" | "skipped" | "deferred" | "failed"
  readonly at: string
  readonly why?: string
  readonly error?: string
}

export interface RestrictionBytesPhase {
  readonly keys: Readonly<Record<string, RestrictionKeyRecord>>
  readonly purge: { readonly status: "done" | "not_configured" | "failed"; readonly at: string; readonly error?: string }
}

/** The bytes' record of a restriction: the restriction's phase, and the lift's once lifted. */
export interface RestrictionBytes {
  readonly restrict?: RestrictionBytesPhase
  readonly lift?: RestrictionBytesPhase
}

export interface CaseRestriction {
  readonly id: string
  readonly assetId: string | null
  readonly jobId: string | null
  readonly r2Keys: readonly string[]
  readonly reason: string
  readonly restrictedAt: string
  readonly liftedAt: string | null
  readonly liftReason: string | null
  readonly bytes?: RestrictionBytes
}

/** A part of the case the server could not read; it is shown empty. */
export type CaseSection = "events" | "files" | "confirmations" | "accounts" | "restrictions" | "counterNotices" | "record"

/** A counter-notice's details and an administrator's notes, by name (the ones that could not be read are listed). */
export type CounterNoticeField = "name" | "email" | "address" | "phone" | "signature" | "courtActionNote" | "courtActionEndedNote"

/** A counter-notice the case received (backend ee/lib/counter-notice-cases.ts). */
export interface CaseCounterNotice {
  readonly id: string
  readonly reference: string
  readonly restrictionId: string
  readonly receivedAt: string
  /** The receipt's date in New York, which the window counts from. */
  readonly receivedOn: string
  /** The New York dates within which the content may be restored. */
  readonly opensOn: string
  readonly closesOn: string
  /** Where today, in New York, stands against the window. */
  readonly position: "before" | "open" | "after"
  readonly name: string | null
  readonly email: string | null
  readonly address: string | null
  readonly phone: string | null
  readonly signature: string | null
  readonly unreadable: readonly CounterNoticeField[]
  readonly contentIdentification: string
  readonly locationBefore: string
  readonly forwardedAt: string | null
  readonly forwardedBy: string | null
  readonly courtActionAt: string | null
  readonly courtActionBy: string | null
  readonly courtActionNote: string | null
  readonly courtActionEndedAt: string | null
  readonly courtActionEndedBy: string | null
  readonly courtActionEndedNote: string | null
  readonly declinedAt: string | null
  readonly declinedBy: string | null
  /** Why it was declined: the sender is shown it too. */
  readonly declinedReason: string | null
  readonly restoredAt: string | null
  readonly restoredBy: string | null
  /** When its restriction was lifted, by whatever route; null while it stands. */
  readonly restrictionLiftedAt: string | null
  /** Restrictions of other cases standing on the same content: a restore waits for each of them. */
  readonly otherRestrictionIds: readonly string[]
  /** Other open cases about the same content: a restore waits for each of them. */
  readonly otherCaseReferences: readonly string[]
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
  readonly eventsTruncated: boolean
  readonly matchedAssets: readonly MatchedAsset[]
  /** Files the case matched that no longer exist (deleted before anything held them). */
  readonly missingAssetIds: readonly string[]
  readonly matchedConfirmations: readonly MatchedConfirmation[]
  readonly matchedUsers: readonly MatchedUser[]
  readonly moreAccounts: number
  /** The accounts' other cases were counted from the most recent only: the counts may be low. */
  readonly historyTruncated: boolean
  readonly restrictions: readonly CaseRestriction[]
  readonly counterNotices: readonly CaseCounterNotice[]
  /** The record of the account the case names; null when it names none, or the record could not be read. */
  readonly record: AccountRecord | null
  readonly partial: readonly CaseSection[]
}

export interface ComplaintFilters {
  /** "open" (the default), "all", or one status. */
  readonly status: ComplaintStatus | "open" | "all"
  readonly kind: "copyright" | "other" | "all"
  /** A reference, or the complainant's email. */
  readonly q: string
  readonly page: number
}

export interface ComplaintPage {
  readonly data: readonly ComplaintSummary[]
  readonly total: number
  readonly page: number
  readonly limit: number
}

export const COMPLAINTS_PAGE_SIZE = 50

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A case id from the address bar, or null when it is not one. */
export function caseIdOrNull(id: string | undefined): string | null {
  return id && UUID.test(id) ? id : null
}

/** A reference's longest form the server takes (`CR-2026-000001`, with room); an email may be longer. */
export const REFERENCE_SEARCH_MAX = 64

/**
 * Why a search cannot be sent as typed, or null when it can: an email (it
 * has an "@") is looked up by its keyed hash, anything else is part of a
 * reference. Either way it is sent in the request's body, never in an
 * address that logs and the browser's history keep.
 */
export function searchProblem(q: string): string | null {
  const text = q.trim()
  if (!text || text.includes("@")) return null
  return text.length > REFERENCE_SEARCH_MAX ? `A reference is at most ${REFERENCE_SEARCH_MAX} characters; search an email by the whole address` : null
}

async function failure(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
  return new Error(body?.error?.message || fallback)
}

/** An admin request with the session's headers; a refusal is thrown as an Error carrying the server's message. */
export async function send<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
  const headers = { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(await getAuthHeaders()) }
  const res = await fetch(path, { ...init, headers })
  if (!res.ok) throw await failure(res, fallback)
  return res.json() as Promise<T>
}

function readQueue(filters: ComplaintFilters): Promise<ComplaintPage> {
  const q = filters.q.trim()
  const status = filters.status !== "all" ? { status: filters.status } : {}
  const kind = filters.kind !== "all" ? { kind: filters.kind } : {}
  if (q) {
    const body = { q, page: filters.page, limit: COMPLAINTS_PAGE_SIZE, ...status, ...kind }
    return send<ComplaintPage>("/v1/admin/complaints/search", { method: "POST", body: JSON.stringify(body) }, "Failed to search the complaints")
  }
  const entries: Array<[string, string]> = [
    ["page", String(filters.page)],
    ["limit", String(COMPLAINTS_PAGE_SIZE)],
    ...(filters.status !== "all" ? [["status", filters.status] as [string, string]] : []),
    ...(filters.kind !== "all" ? [["kind", filters.kind] as [string, string]] : []),
  ]
  return send<ComplaintPage>(`/v1/admin/complaints?${new URLSearchParams(entries)}`, {}, "Failed to load the complaints")
}

export function useAdminComplaints(filters: ComplaintFilters) {
  const q = filters.q.trim()
  return useQuery({
    queryKey: queryKeys.admin.complaints(filters.status, filters.kind, q, filters.page),
    queryFn: () => readQueue({ ...filters, q }),
    enabled: hasAdmin(),
    staleTime: 15_000,
    // The page being left stays on screen until the next one is read.
    placeholderData: keepPreviousData,
  })
}

/** The open, verified cases, for the nav badge: a complaint nobody opens is the one notification the handler gets. */
export function useAdminComplaintCount(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.admin.complaintsCount(),
    queryFn: () => send<{ count: number }>("/v1/admin/complaints/count", {}, "Failed to count the complaints").then((r) => r.count),
    enabled: hasAdmin() && enabled,
    retry: false,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

/** One case; an id that is not a case id is never asked for. */
export function useAdminComplaint(id: string | undefined) {
  const caseId = caseIdOrNull(id)
  return useQuery({
    queryKey: queryKeys.admin.complaint(caseId ?? ""),
    queryFn: () => send<{ data: ComplaintCase }>(`/v1/admin/complaints/${encodeURIComponent(caseId!)}`, {}, "Failed to load the complaint").then((r) => r.data),
    enabled: hasAdmin() && caseId !== null,
  })
}

/** A move on a case: posted, then the whole complaints family read again, made or refused. */
export function useCaseMove<TInput, TResult = unknown>(path: (input: TInput) => string, body: (input: TInput) => unknown | undefined, fallback: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: TInput) => {
      const payload = body(input)
      return send<TResult>(path(input), { method: "POST", ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}) }, fallback)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["admin", "complaints"] }),
  })
}

const casePath = (id: string, move: string) => `/v1/admin/complaints/${encodeURIComponent(id)}/${move}`
const restrictionPath = (id: string, move: string) => `/v1/admin/content-restrictions/${encodeURIComponent(id)}/${move}`

export interface StatusMoveInput {
  readonly id: string
  /** The case's `updatedAt` as this screen showed it: the server moves the case from it or refuses. */
  readonly seen: string
  readonly status: ComplaintStatus
  readonly decision?: string | null
  readonly note?: string | null
}

export function useMoveComplaintStatus() {
  return useCaseMove<StatusMoveInput>(
    (i) => casePath(i.id, "status"),
    (i) => ({ seen: i.seen, status: i.status, ...(i.decision !== undefined ? { decision: i.decision } : {}), ...(i.note ? { note: i.note } : {}) }),
    "Failed to move the complaint",
  )
}

export function useAddComplaintNote() {
  return useCaseMove<{ id: string; text: string }>((i) => casePath(i.id, "notes"), (i) => ({ text: i.text }), "Failed to note the complaint")
}

/** Names one of the case's matched accounts (or none), from the case as this screen showed it (`seen`). */
export function useNameComplaintUser() {
  return useCaseMove<{ id: string; userId: string | null; seen: string }>(
    (i) => casePath(i.id, "user"),
    (i) => ({ userId: i.userId, seen: i.seen }),
    "Failed to name the account",
  )
}

export function useRematchComplaint() {
  return useCaseMove<{ id: string }>((i) => casePath(i.id, "rematch"), () => undefined, "Failed to match the complaint again")
}

export function useRestrictFromComplaint() {
  return useCaseMove<{ id: string; assetId?: string; jobId?: string; reason: string }>(
    (i) => casePath(i.id, "restrict"),
    (i) => ({ ...(i.assetId ? { assetId: i.assetId } : {}), ...(i.jobId ? { jobId: i.jobId } : {}), reason: i.reason }),
    "Failed to restrict the content",
  )
}

/** Finishes a restriction's bytes: the move (or the move back) its record says is left. */
export function useFinishRestrictionBytes() {
  return useCaseMove<{ restrictionId: string }>((i) => restrictionPath(i.restrictionId, "bytes"), () => undefined, "Failed to finish the restriction's files")
}

/** Lifts a restriction the case led to (backend ee/routes/admin-content-restrictions.ts). */
export function useLiftCaseRestriction() {
  return useCaseMove<{ restrictionId: string; reason: string | null }>(
    (i) => restrictionPath(i.restrictionId, "lift"),
    (i) => ({ reason: i.reason }),
    "Failed to lift the restriction",
  )
}

const counterNoticePath = (id: string, step: string) => `/v1/admin/counter-notices/${encodeURIComponent(id)}/${step}`

/** The counter-notice was sent to the complainant (backend ee/routes/admin-counter-notices.ts). */
export function useMarkCounterNoticeForwarded() {
  return useCaseMove<{ counterNoticeId: string }>((i) => counterNoticePath(i.counterNoticeId, "forwarded"), () => undefined, "Failed to record the forwarding")
}

/** The complainant went to court: the content stays restricted until the court action is recorded as ended. */
export function useRecordCourtAction() {
  return useCaseMove<{ counterNoticeId: string; note: string | null }>(
    (i) => counterNoticePath(i.counterNoticeId, "court-action"),
    (i) => ({ note: i.note }),
    "Failed to record the court action",
  )
}

/** The court action ended: the content may then be restored, or kept restricted as the outcome says. */
export function useRecordCourtActionEnded() {
  return useCaseMove<{ counterNoticeId: string; note: string | null }>(
    (i) => counterNoticePath(i.counterNoticeId, "court-action-ended"),
    (i) => ({ note: i.note }),
    "Failed to record the end of the court action",
  )
}

/** Declines the counter-notice as not a valid one; the sender is shown the reason. */
export function useDeclineCounterNotice() {
  return useCaseMove<{ counterNoticeId: string; reason: string }>(
    (i) => counterNoticePath(i.counterNoticeId, "decline"),
    (i) => ({ reason: i.reason }),
    "Failed to decline the counter-notice",
  )
}

/** Restores the content a counter-notice answers, once nothing holds it back. */
export function useRestoreFromCounterNotice() {
  return useCaseMove<{ counterNoticeId: string }>((i) => counterNoticePath(i.counterNoticeId, "restore"), () => undefined, "Failed to restore the content")
}

/**
 * An email the case sends, as previewed: where it goes, each value as the
 * recipient reads it, and the digest the send names, so that what is sent is
 * what was shown (backend ee/lib/complaint-notices.ts).
 */
export interface ComplaintNoticePreview {
  readonly to: string
  readonly values: Readonly<Record<string, string>>
  readonly digest: string
}

/** What "Content access restricted" says for one of the case's restrictions, with the reason written for the account, and to whom; nothing is sent. */
export function previewAccountNotice(id: string, restrictionId: string, reason: string): Promise<ComplaintNoticePreview> {
  return send<{ data: { preview: ComplaintNoticePreview } }>(
    casePath(id, "notify-account"),
    { method: "POST", body: JSON.stringify({ restrictionId, reason, preview: true }) },
    "Failed to preview the email",
  ).then((r) => r.data.preview)
}

/** What "Complaint update" says to the complainant; nothing is sent. */
export function previewComplainantUpdate(id: string): Promise<ComplaintNoticePreview> {
  return send<{ data: { preview: ComplaintNoticePreview } }>(
    casePath(id, "notify-complainant"),
    { method: "POST", body: JSON.stringify({ preview: true }) },
    "Failed to preview the email",
  ).then((r) => r.data.preview)
}

/** Sends the "Content access restricted" its preview showed (its digest); the case's log records it. */
export function useSendAccountNotice() {
  return useCaseMove<{ id: string; restrictionId: string; reason: string; digest: string }>(
    (i) => casePath(i.id, "notify-account"),
    (i) => ({ restrictionId: i.restrictionId, reason: i.reason, digest: i.digest }),
    "Failed to email the account",
  )
}

/** Sends the "Complaint update" its preview showed (its digest); the case's log records it. */
export function useSendComplainantUpdate() {
  return useCaseMove<{ id: string; digest: string }>((i) => casePath(i.id, "notify-complainant"), (i) => ({ digest: i.digest }), "Failed to email the complainant")
}
