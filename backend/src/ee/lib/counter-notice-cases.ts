/**
 * The handler's side of a counter-notice (migration 587; lib/counter-notices.ts):
 * the counter-notices a case received, the sender's details opened for the
 * screen (the law has them forwarded to the complainant), and the steps a
 * person takes, each once (587's trigger): forwarding it to the complainant,
 * recording a court action and its end, declining it, and restoring the content.
 *
 * A restore from here is refused while anything holds it back, in this order:
 * the counter-notice was declined; a court action holds the content (until it
 * is recorded as ended); it was never forwarded to the complainant; the window
 * has not opened (moot once a court action ended); the case is closed; the
 * restriction is lifted already; another restriction, of another case, stands
 * on the same content; another open case concerns the same content. A restore
 * past the window's last day is still allowed (late is better than never), and
 * the screen says it is late.
 *
 * Two rules hold in the database whatever the route (587): every lift of the
 * restriction settles its counter-notice, and a court action holds the content
 * until it is recorded as ended. Nothing here is automatic: every step is an
 * administrator's. Each is written to the case's log; the case moves with it
 * only forward, and only when nobody moved it meanwhile.
 */
import { supabase } from "../../lib/supabase.js"
import { openCounterNotice, openCounterNoticeField, sealCounterNoticeField, type CounterNoticeColumn } from "../../lib/counter-notices.js"
import { newYorkDate, windowPosition, type WindowPosition } from "../../lib/business-days.js"
import { ContentRestrictionError, liftRestriction, type ContentRestriction } from "../../lib/content-restrictions.js"
import { CLOSED_COMPLAINT_STATUSES, recordComplaintEventQuietly, statusComesBefore, type ComplaintStatus } from "../../lib/rights-complaints.js"
import { postgresTextArray } from "../../lib/postgrest-array.js"
import { ComplaintCaseError } from "./complaint-case-rows.js"

/** The counter-notices a case view reads: one per restriction, so as many as the case's restrictions it shows. */
const PER_CASE = 200

/** What holds a restore back, read per counter-notice; past this many, the first ones already say enough. */
const BLOCKERS_LIMIT = 20

const COLUMNS =
  "id, reference, complaint_id, restriction_id, name_enc, email_enc, address_enc, phone_enc, signature_enc, content_identification, location_before, received_at, window_opens_on, window_closes_on, forwarded_at, forwarded_by, court_action_at, court_action_by, court_action_note_enc, court_action_ended_at, court_action_ended_by, court_action_ended_note_enc, declined_at, declined_by, declined_reason, restored_at, restored_by"

interface NoticeRow {
  id: string
  reference: string
  complaint_id: string
  restriction_id: string
  name_enc: string
  email_enc: string
  address_enc: string
  phone_enc: string
  signature_enc: string
  content_identification: string
  location_before: string
  received_at: string
  window_opens_on: string
  window_closes_on: string
  forwarded_at: string | null
  forwarded_by: string | null
  court_action_at: string | null
  court_action_by: string | null
  court_action_note_enc: string | null
  court_action_ended_at: string | null
  court_action_ended_by: string | null
  court_action_ended_note_enc: string | null
  declined_at: string | null
  declined_by: string | null
  declined_reason: string | null
  restored_at: string | null
  restored_by: string | null
}

interface RestrictionRow {
  id: string
  complaint_id: string | null
  r2_keys: string[] | null
  content_hash: string | null
  asset_ids: string[] | null
  lifted_at: string | null
}

/** The sender's details and an administrator's notes, by the name the screen gives them. */
export type CounterNoticeField = "name" | "email" | "address" | "phone" | "signature" | "courtActionNote" | "courtActionEndedNote"

const FIELD_OF: Readonly<Record<CounterNoticeColumn, CounterNoticeField>> = {
  name_enc: "name",
  email_enc: "email",
  address_enc: "address",
  phone_enc: "phone",
  signature_enc: "signature",
}

export interface CaseCounterNotice {
  readonly id: string
  readonly reference: string
  readonly restrictionId: string
  readonly receivedAt: string
  /** The receipt's date in New York, which the window counts from. */
  readonly receivedOn: string
  readonly opensOn: string
  readonly closesOn: string
  /** Where today, in New York, stands against the window. */
  readonly position: WindowPosition
  readonly name: string | null
  readonly email: string | null
  readonly address: string | null
  readonly phone: string | null
  readonly signature: string | null
  /** The fields that could not be read; the others are still shown. */
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
  /** Why it was declined: shown to the sender too. */
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

const NONE = { data: [] as Array<{ id: string; complaint_id: string | null }>, error: null }

/**
 * Restrictions of another case (or of none) standing on any of this one's
 * storage keys or its content hash. One case's own restrictions rest on the
 * same ground and never hold each other back: lifting one leaves the bytes
 * another still covers restricted (migration 581).
 */
async function othersStandingOn(restriction: RestrictionRow): Promise<string[]> {
  const keys = restriction.r2_keys ?? []
  const [byKeys, byHash] = await Promise.all([
    keys.length > 0
      ? supabase
          .from("content_restrictions")
          .select("id, complaint_id")
          .is("lifted_at", null)
          .neq("id", restriction.id)
          .overlaps("r2_keys", postgresTextArray(keys))
          .limit(BLOCKERS_LIMIT)
      : Promise.resolve(NONE),
    restriction.content_hash
      ? supabase
          .from("content_restrictions")
          .select("id, complaint_id")
          .is("lifted_at", null)
          .neq("id", restriction.id)
          .eq("content_hash", restriction.content_hash)
          .limit(BLOCKERS_LIMIT)
      : Promise.resolve(NONE),
  ])
  if (byKeys.error) throw new Error(`Restrictions read failed: ${byKeys.error.message}`)
  if (byHash.error) throw new Error(`Restrictions read failed: ${byHash.error.message}`)
  const rows = [...((byKeys.data ?? []) as Array<{ id: string; complaint_id: string | null }>), ...((byHash.data ?? []) as Array<{ id: string; complaint_id: string | null }>)]
  return [...new Set(rows.filter((r) => r.complaint_id !== restriction.complaint_id).map((r) => r.id))]
}

/**
 * Other open, verified cases whose matched files include this restriction's
 * (the same predicate as the legal hold, migration 582): their complaints are
 * about the same content, and a restore waits for each of them.
 */
async function openCasesOn(restriction: RestrictionRow): Promise<string[]> {
  const assets = restriction.asset_ids ?? []
  if (assets.length === 0) return []
  let query = supabase
    .from("rights_complaints")
    .select("id, reference")
    .not("verified_at", "is", null)
    .not("status", "in", `(${[...CLOSED_COMPLAINT_STATUSES].join(",")})`)
    .overlaps("matched_asset_ids", assets)
    .limit(BLOCKERS_LIMIT)
  if (restriction.complaint_id) query = query.neq("id", restriction.complaint_id)
  const { data, error } = await query
  if (error) throw new Error(`Complaints read failed: ${error.message}`)
  return ((data ?? []) as Array<{ reference: string }>).map((c) => c.reference)
}

async function restrictionsOf(ids: readonly string[]): Promise<Map<string, RestrictionRow>> {
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase.from("content_restrictions").select("id, complaint_id, r2_keys, content_hash, asset_ids, lifted_at").in("id", [...ids])
  if (error) throw new Error(`Restrictions read failed: ${error.message}`)
  return new Map(((data ?? []) as RestrictionRow[]).map((r) => [r.id, r]))
}

/** Whether a counter-notice may still lead to a restore from here: neither restored nor declined. */
const undecided = (row: NoticeRow) => !row.restored_at && !row.declined_at

function toCaseNotice(row: NoticeRow, restriction: RestrictionRow | undefined, blockers: readonly [string[], string[]], today: string): CaseCounterNotice {
  const opened = openCounterNotice(row)
  const courtNote = openCounterNoticeField(row.id, "court_action_note_enc", row.court_action_note_enc)
  const endedNote = openCounterNoticeField(row.id, "court_action_ended_note_enc", row.court_action_ended_note_enc)
  const unreadable: CounterNoticeField[] = [
    ...opened.unreadable.map((column) => FIELD_OF[column]),
    ...(courtNote.failed ? (["courtActionNote"] as const) : []),
    ...(endedNote.failed ? (["courtActionEndedNote"] as const) : []),
  ]
  return {
    id: row.id,
    reference: row.reference,
    restrictionId: row.restriction_id,
    receivedAt: row.received_at,
    receivedOn: newYorkDate(new Date(row.received_at)),
    opensOn: row.window_opens_on,
    closesOn: row.window_closes_on,
    position: windowPosition({ opensOn: row.window_opens_on, closesOn: row.window_closes_on }, today),
    name: opened.name,
    email: opened.email,
    address: opened.address,
    phone: opened.phone,
    signature: opened.signature,
    unreadable,
    contentIdentification: row.content_identification,
    locationBefore: row.location_before,
    forwardedAt: row.forwarded_at,
    forwardedBy: row.forwarded_by,
    courtActionAt: row.court_action_at,
    courtActionBy: row.court_action_by,
    courtActionNote: courtNote.value,
    courtActionEndedAt: row.court_action_ended_at,
    courtActionEndedBy: row.court_action_ended_by,
    courtActionEndedNote: endedNote.value,
    declinedAt: row.declined_at,
    declinedBy: row.declined_by,
    declinedReason: row.declined_reason,
    restoredAt: row.restored_at,
    restoredBy: row.restored_by,
    restrictionLiftedAt: restriction?.lifted_at ?? null,
    otherRestrictionIds: blockers[0],
    otherCaseReferences: blockers[1],
  }
}

/** The counter-notices a case received, oldest first, each with what would hold its restore back. */
export async function counterNoticesOfCase(caseId: string, now: Date = new Date()): Promise<CaseCounterNotice[]> {
  const { data, error } = await supabase
    .from("rights_counter_notices")
    .select(COLUMNS)
    .eq("complaint_id", caseId)
    .order("received_at", { ascending: true })
    .limit(PER_CASE)
  if (error) throw new Error(`Counter-notices read failed: ${error.message}`)
  const rows = (data ?? []) as unknown as NoticeRow[]
  if (rows.length === 0) return []
  const restrictions = await restrictionsOf(rows.map((r) => r.restriction_id))
  const today = newYorkDate(now)
  const blockers = await Promise.all(
    rows.map((row) => {
      const restriction = restrictions.get(row.restriction_id)
      return restriction && !restriction.lifted_at && undecided(row)
        ? Promise.all([othersStandingOn(restriction), openCasesOn(restriction)])
        : Promise.resolve([[], []] as [string[], string[]])
    }),
  )
  return rows.map((row, i) => toCaseNotice(row, restrictions.get(row.restriction_id), blockers[i] ?? [[], []], today))
}

async function readNotice(id: string): Promise<NoticeRow> {
  const { data, error } = await supabase.from("rights_counter_notices").select(COLUMNS).eq("id", id).maybeSingle()
  if (error) throw new Error(`Counter-notice read failed: ${error.message}`)
  if (!data) throw new ComplaintCaseError("not_found", "No such counter-notice")
  return data as unknown as NoticeRow
}

/**
 * The case moves to `to` from the case as it is now, when `from` allows its
 * current status; a case moved meanwhile keeps its status. Never fails the step.
 */
async function moveCaseQuietly(caseId: string, to: ComplaintStatus, adminUserId: string, from: (status: string) => boolean): Promise<void> {
  try {
    const read = await supabase.from("rights_complaints").select("status, updated_at").eq("id", caseId).maybeSingle()
    if (read.error || !read.data) return
    const before = read.data as { status: string; updated_at: string }
    if (!from(before.status)) return
    const { data, error } = await supabase
      .from("rights_complaints")
      .update({ status: to, handler_user_id: adminUserId })
      .eq("id", caseId)
      .eq("updated_at", before.updated_at)
      .select("id")
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (data) await recordComplaintEventQuietly(caseId, "status_changed", adminUserId, { from: before.status, to })
  } catch (e) {
    console.warn(`[counter-notice-cases] case ${caseId} kept its status:`, e instanceof Error ? e.message : e)
  }
}

/**
 * The case moves to `content_restored` once every counter-notice on it is
 * settled (restored or declined) and it had not got that far: one still held
 * by a court action, or still in its window, keeps the case where it is.
 */
async function moveCaseWhenSettled(caseId: string, adminUserId: string): Promise<void> {
  const { data, error } = await supabase.from("rights_counter_notices").select("restored_at, declined_at").eq("complaint_id", caseId).limit(PER_CASE)
  if (error) {
    console.warn(`[counter-notice-cases] case ${caseId} kept its status:`, error.message)
    return
  }
  const rows = (data ?? []) as Array<{ restored_at: string | null; declined_at: string | null }>
  if (rows.some((r) => !r.restored_at && !r.declined_at)) return
  await moveCaseQuietly(caseId, "content_restored", adminUserId, (status) => statusComesBefore(status, "content_restored"))
}

export interface StepResult {
  readonly id: string
  readonly reference: string
  readonly complaintId: string
}

const STEP_COLUMNS = "id, reference, complaint_id"

function stepResult(data: unknown): StepResult {
  const row = data as { id: string; reference: string; complaint_id: string }
  return { id: row.id, reference: row.reference, complaintId: row.complaint_id }
}

/**
 * The counter-notice was sent to the complainant (by the administrator, from
 * their own mail: nothing here sends it). Recorded once; not for a declined one.
 */
export async function markCounterNoticeForwarded(id: string, adminUserId: string): Promise<StepResult> {
  const { data, error } = await supabase
    .from("rights_counter_notices")
    .update({ forwarded_at: new Date().toISOString(), forwarded_by: adminUserId })
    .eq("id", id)
    .is("forwarded_at", null)
    .is("declined_at", null)
    .select(STEP_COLUMNS)
    .maybeSingle()
  if (error) throw new Error(`Counter-notice write failed: ${error.message}`)
  if (!data) {
    const row = await readNotice(id)
    throw new ComplaintCaseError("conflict", row.declined_at ? "The counter-notice was declined" : "The counter-notice was marked forwarded already")
  }
  const step = stepResult(data)
  await recordComplaintEventQuietly(step.complaintId, "counter_notice_forwarded", adminUserId, { reference: step.reference })
  return step
}

/**
 * The complainant answered with a court action to restrain the activity: the
 * content stays restricted (on every route, 587) until the court action is
 * recorded as ended, and the case waits on the court. Recorded once, and only
 * while the counter-notice is neither restored nor declined. The note (the
 * court, the case number) is kept encrypted on the counter-notice: a caption
 * names people, and the case's log is forever.
 */
export async function recordCourtAction(id: string, note: string | null, adminUserId: string): Promise<StepResult> {
  const { data, error } = await supabase
    .from("rights_counter_notices")
    .update({
      court_action_at: new Date().toISOString(),
      court_action_by: adminUserId,
      ...(note ? { court_action_note_enc: sealCounterNoticeField(id, "court_action_note_enc", note) } : {}),
    })
    .eq("id", id)
    .is("court_action_at", null)
    .is("restored_at", null)
    .is("declined_at", null)
    .select(STEP_COLUMNS)
    .maybeSingle()
  if (error) throw new Error(`Counter-notice write failed: ${error.message}`)
  if (!data) {
    const row = await readNotice(id)
    const why = row.restored_at ? "The content was restored already" : row.declined_at ? "The counter-notice was declined" : "A court action was recorded already"
    throw new ComplaintCaseError("conflict", why)
  }
  const step = stepResult(data)
  await recordComplaintEventQuietly(step.complaintId, "court_action_received", adminUserId, { reference: step.reference, note: Boolean(note) })
  await moveCaseQuietly(step.complaintId, "awaiting_legal_action", adminUserId, (status) => status !== "awaiting_legal_action" && !CLOSED_COMPLAINT_STATUSES.has(status as ComplaintStatus))
  return step
}

/**
 * The court action ended (dismissed, withdrawn, decided): from now the content
 * may be restored from here, or kept restricted and the case closed, as the
 * outcome says. Recorded once, only after a court action; the note is kept
 * encrypted like the court action's.
 */
export async function recordCourtActionEnded(id: string, note: string | null, adminUserId: string): Promise<StepResult> {
  const { data, error } = await supabase
    .from("rights_counter_notices")
    .update({
      court_action_ended_at: new Date().toISOString(),
      court_action_ended_by: adminUserId,
      ...(note ? { court_action_ended_note_enc: sealCounterNoticeField(id, "court_action_ended_note_enc", note) } : {}),
    })
    .eq("id", id)
    .not("court_action_at", "is", null)
    .is("court_action_ended_at", null)
    .select(STEP_COLUMNS)
    .maybeSingle()
  if (error) throw new Error(`Counter-notice write failed: ${error.message}`)
  if (!data) {
    const row = await readNotice(id)
    if (!row.court_action_at) throw new ComplaintCaseError("invalid_move", "No court action was recorded on this counter-notice")
    throw new ComplaintCaseError("conflict", "The court action was recorded as ended already")
  }
  const step = stepResult(data)
  await recordComplaintEventQuietly(step.complaintId, "court_action_ended", adminUserId, { reference: step.reference, note: Boolean(note) })
  return step
}

/**
 * The counter-notice is declined as not a valid one (it identifies nothing
 * that was restricted, say, or misses an element the law requires): the
 * content stays restricted, and the reason is shown to the sender. Recorded
 * once, and only while it is neither restored nor held by a court action.
 */
export async function declineCounterNotice(id: string, reason: string, adminUserId: string): Promise<StepResult> {
  const { data, error } = await supabase
    .from("rights_counter_notices")
    .update({ declined_at: new Date().toISOString(), declined_by: adminUserId, declined_reason: reason })
    .eq("id", id)
    .is("declined_at", null)
    .is("restored_at", null)
    .is("court_action_at", null)
    .select(STEP_COLUMNS)
    .maybeSingle()
  if (error) throw new Error(`Counter-notice write failed: ${error.message}`)
  if (!data) {
    const row = await readNotice(id)
    const why = row.declined_at ? "The counter-notice was declined already" : row.restored_at ? "The content was restored already" : "A court action was recorded: the counter-notice stands"
    throw new ComplaintCaseError("conflict", why)
  }
  const step = stepResult(data)
  await recordComplaintEventQuietly(step.complaintId, "counter_notice_declined", adminUserId, { reference: step.reference })
  return step
}

/** Why a restore cannot be done now, from the counter-notice alone (the order the screen shows it), or null. */
function heldBack(row: NoticeRow, today: string): ComplaintCaseError | null {
  if (row.restored_at) return new ComplaintCaseError("conflict", "The content was restored already")
  if (row.declined_at) return new ComplaintCaseError("invalid_move", "The counter-notice was declined: lift the restriction itself to restore the content")
  if (row.court_action_at && !row.court_action_ended_at) {
    return new ComplaintCaseError("invalid_move", "A court action was received: the content stays restricted until the court action is recorded as ended")
  }
  if (!row.forwarded_at) return new ComplaintCaseError("invalid_move", "Send the counter-notice to the complainant, and mark it sent, before restoring the content")
  if (!row.court_action_at && windowPosition({ opensOn: row.window_opens_on, closesOn: row.window_closes_on }, today) === "before") {
    return new ComplaintCaseError("invalid_move", `The content can be restored from ${row.window_opens_on}, not before`)
  }
  return null
}

/**
 * Restores the content a counter-notice answers: lifts its restriction
 * (lib/content-restrictions.ts, which moves the bytes back and writes the
 * lift on the case's log; the database stamps the counter-notice restored in
 * the lift's own transaction), then logs the restore and moves the case to
 * `content_restored` once every counter-notice on it is settled. The case
 * stays open: closing it is a decision of its own.
 */
export async function restoreFromCounterNotice(id: string, adminUserId: string, now: Date = new Date()): Promise<StepResult & { readonly restriction: ContentRestriction }> {
  const row = await readNotice(id)
  const held = heldBack(row, newYorkDate(now))
  if (held) throw held
  const caseRead = await supabase.from("rights_complaints").select("status").eq("id", row.complaint_id).maybeSingle()
  if (caseRead.error) throw new Error(`Complaint read failed: ${caseRead.error.message}`)
  const caseStatus = (caseRead.data as { status: string } | null)?.status
  if (caseStatus && CLOSED_COMPLAINT_STATUSES.has(caseStatus as ComplaintStatus)) {
    throw new ComplaintCaseError("invalid_move", "The case is closed: reopen it to restore its content")
  }
  const restriction = (await restrictionsOf([row.restriction_id])).get(row.restriction_id)
  if (!restriction) throw new ComplaintCaseError("not_found", "The counter-notice's restriction is gone")
  if (restriction.lifted_at) throw new ComplaintCaseError("conflict", "The restriction was lifted already")
  const [others, cases] = await Promise.all([othersStandingOn(restriction), openCasesOn(restriction)])
  if (others.length > 0) {
    throw new ComplaintCaseError("invalid_move", `Another restriction stands on the same content (${others.join(", ")}): it rests on another ground and is handled first`)
  }
  if (cases.length > 0) {
    throw new ComplaintCaseError("invalid_move", `Another open case concerns the same content (${cases.join(", ")}): it is handled first`)
  }
  let lifted: ContentRestriction
  try {
    lifted = await liftRestriction(restriction.id, { reason: `Restored after counter-notice ${row.reference}`, adminUserId })
  } catch (e) {
    if (e instanceof ContentRestrictionError && e.code === "already_lifted") throw new ComplaintCaseError("conflict", "The restriction was lifted already")
    if (e instanceof ContentRestrictionError && e.code === "court_action") {
      throw new ComplaintCaseError("conflict", "A court action was recorded meanwhile: the content stays restricted")
    }
    throw e
  }
  // The content is restored and the counter-notice settled with it: from here nothing fails the step.
  await recordComplaintEventQuietly(row.complaint_id, "content_restored", adminUserId, { reference: row.reference, restrictionId: restriction.id })
  await moveCaseWhenSettled(row.complaint_id, adminUserId)
  return { id: row.id, reference: row.reference, complaintId: row.complaint_id, restriction: lifted }
}
