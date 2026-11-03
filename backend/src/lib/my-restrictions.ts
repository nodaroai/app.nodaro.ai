/**
 * The restrictions a complaint led to on an account's own content, as its
 * owner sees them: what was restricted and when, the case's reference and
 * kind, and the counter-notice sent for it, if any. Never the complainant's
 * identity, and never the administrator's own note on the restriction (it
 * was written for the record, not for the owner): the kind of complaint says
 * why.
 *
 * A restricted file reads as gone everywhere else in the product (migration
 * 581); this is the one place its owner learns what happened to it, and the
 * way to answer it (lib/counter-notices.ts).
 */
import { supabase } from "./supabase.js"
import { CLOSED_COMPLAINT_STATUSES, type ComplaintStatus } from "./rights-complaints.js"

/** The restrictions answered, newest first. */
export const MY_RESTRICTIONS_LIMIT = 100

export interface MyCounterNotice {
  readonly reference: string
  readonly receivedAt: string
  /** The New York dates within which the content may be restored. */
  readonly opensOn: string
  readonly closesOn: string
  readonly forwarded: boolean
  /** The complainant reported a court action: the content stays restricted while it lasts. */
  readonly courtAction: boolean
  readonly courtActionEnded: boolean
  /** Declined as not a valid counter-notice, and why. */
  readonly declined: boolean
  readonly declinedReason: string | null
  readonly restored: boolean
}

export interface MyRestriction {
  readonly id: string
  readonly caseReference: string
  /** copyright: a copyright notice; other: a complaint of another kind (likeness, privacy, …). */
  readonly caseKind: "copyright" | "other"
  readonly restrictedAt: string
  readonly liftedAt: string | null
  /** What was restricted: a stored file by the name it was given, or a job's result. */
  readonly item: { readonly kind: "file" | "result"; readonly name: string | null; readonly type: string | null }
  readonly counterNotice: MyCounterNotice | null
  /** A counter-notice can be sent for it now: a copyright case, still open, the restriction standing, none sent. */
  readonly canSendCounterNotice: boolean
}

interface RestrictionRow {
  id: string
  asset_id: string | null
  job_id: string | null
  complaint_id: string
  restricted_at: string
  lifted_at: string | null
}

interface NoticeRow {
  restriction_id: string
  reference: string
  received_at: string
  window_opens_on: string
  window_closes_on: string
  forwarded_at: string | null
  court_action_at: string | null
  court_action_ended_at: string | null
  declined_at: string | null
  declined_reason: string | null
  restored_at: string | null
}

function toMyCounterNotice(n: NoticeRow): MyCounterNotice {
  return {
    reference: n.reference,
    receivedAt: n.received_at,
    opensOn: n.window_opens_on,
    closesOn: n.window_closes_on,
    forwarded: n.forwarded_at !== null,
    courtAction: n.court_action_at !== null,
    courtActionEnded: n.court_action_ended_at !== null,
    declined: n.declined_at !== null,
    declinedReason: n.declined_reason,
    restored: n.restored_at !== null,
  }
}

interface CaseRow {
  id: string
  reference: string
  kind: "copyright" | "other"
  status: string
}

interface FileRow {
  id: string
  filename: string | null
  type: string | null
}

/** One restriction as its owner sees it. */
function toMyRestriction(r: RestrictionRow, complaint: CaseRow, file: FileRow | undefined, notice: NoticeRow | undefined): MyRestriction {
  return {
    id: r.id,
    caseReference: complaint.reference,
    caseKind: complaint.kind,
    restrictedAt: r.restricted_at,
    liftedAt: r.lifted_at,
    // A job's result, or a file: decided by what was named, which a deleted file's row no longer says.
    item: r.job_id ? { kind: "result", name: null, type: null } : { kind: "file", name: file?.filename ?? null, type: file?.type ?? null },
    counterNotice: notice ? toMyCounterNotice(notice) : null,
    canSendCounterNotice: complaint.kind === "copyright" && !r.lifted_at && !CLOSED_COMPLAINT_STATUSES.has(complaint.status as ComplaintStatus) && !notice,
  }
}

/** The restrictions a case led to on this account's own content, newest first, each with its case and counter-notice. */
export async function listMyRestrictions(userId: string): Promise<MyRestriction[]> {
  const { data, error } = await supabase
    .from("content_restrictions")
    .select("id, asset_id, job_id, complaint_id, restricted_at, lifted_at")
    .eq("owner_user_id", userId)
    .not("complaint_id", "is", null)
    .order("restricted_at", { ascending: false })
    .limit(MY_RESTRICTIONS_LIMIT)
  if (error) throw new Error(`Restrictions read failed: ${error.message}`)
  const rows = (data ?? []) as RestrictionRow[]
  if (rows.length === 0) return []

  const caseIds = [...new Set(rows.map((r) => r.complaint_id))]
  const assetIds = [...new Set(rows.map((r) => r.asset_id).filter((id): id is string => Boolean(id)))]
  const [cases, files, notices] = await Promise.all([
    supabase.from("rights_complaints").select("id, reference, kind, status").in("id", caseIds),
    assetIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : // restricted-read: the owner's own restricted file, named for them on the
        // one page that tells them what happened to it.
        supabase.from("assets").select("id, filename, type").in("id", assetIds).eq("user_id", userId),
    supabase
      .from("rights_counter_notices")
      .select("restriction_id, reference, received_at, window_opens_on, window_closes_on, forwarded_at, court_action_at, court_action_ended_at, declined_at, declined_reason, restored_at")
      .in("restriction_id", rows.map((r) => r.id)),
  ])
  if (cases.error) throw new Error(`Complaints read failed: ${cases.error.message}`)
  if (files.error) throw new Error(`Files read failed: ${files.error.message}`)
  if (notices.error) throw new Error(`Counter-notices read failed: ${notices.error.message}`)

  const caseOf = new Map(((cases.data ?? []) as CaseRow[]).map((c) => [c.id, c]))
  const fileOf = new Map(((files.data ?? []) as FileRow[]).map((f) => [f.id, f]))
  const noticeOf = new Map(((notices.data ?? []) as NoticeRow[]).map((n) => [n.restriction_id, n]))

  return rows.flatMap((r) => {
    const complaint = caseOf.get(r.complaint_id)
    return complaint ? [toMyRestriction(r, complaint, r.asset_id ? fileOf.get(r.asset_id) : undefined, noticeOf.get(r.id))] : []
  })
}
