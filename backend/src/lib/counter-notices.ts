/**
 * Counter-notices (migration 587): what the owner of content restricted after
 * a copyright notice sends to have it restored (17 U.S.C. § 512(g)(3)).
 *
 * Only the content's owner sends one, in their own session, for a restriction
 * a copyright case led to, while the restriction stands and the case is open;
 * one per restriction. The database checks the same under lock as the row is
 * written, so a lift or a case closing at that moment refuses the counter-notice
 * instead of slipping past these checks. They give their name, address, phone,
 * email and signature (stored encrypted, bound to the row and the column, like
 * a complainant's), identify what was restricted and where it was, and affirm
 * the declaration below, verbatim. The window within which the content may be
 * restored is fixed at receipt (lib/business-days.ts). The case's log says it
 * arrived, and the case moves to `counter_notice_received` when it had not got
 * that far; neither can fail the submission once it is recorded.
 *
 * Nothing here forwards anything or restores anything: an administrator
 * forwards the counter-notice to the complainant and restores the content
 * from the case (ee/lib/counter-notice-cases.ts), inside the window and only
 * when nothing else holds the content back.
 */
import { createHash, randomUUID } from "node:crypto"
import { supabase } from "./supabase.js"
import { boundCipher, encryptionKeySource } from "./instance-cipher.js"
import { restoreWindow, type RestoreWindow } from "./business-days.js"
import { CLOSED_COMPLAINT_STATUSES, recordComplaintEventQuietly, statusComesBefore, type ComplaintStatus } from "./rights-complaints.js"

const CIPHER_PURPOSE = "rights-counter-notices"

/** The declaration the sender affirms, verbatim: good faith under penalty of perjury, then jurisdiction and service of process. */
export const COUNTER_NOTICE_DECLARATION: readonly string[] = [
  "I declare, under penalty of perjury, that I have a good-faith belief that the material identified in this counter-notification was removed or disabled as a result of mistake or misidentification.",
  "I consent to the jurisdiction of the applicable United States Federal District Court as required by 17 U.S.C. § 512(g)(3), and I will accept service of process from the person who submitted the original infringement notification or that person's agent.",
]

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

/** What the record keeps of the text affirmed: a client shows the text and sends this back. */
export const COUNTER_NOTICE_DECLARATION_HASH = sha256(COUNTER_NOTICE_DECLARATION.join("\n"))

/** The invisible marks that change how text reads without being seen: direction marks, embeddings, overrides, isolates, and the Unicode line and paragraph separators. */
const INVISIBLE_MARKS: ReadonlySet<number> = new Set([0x061c, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069])

/**
 * Whether text holds what a sender may not type. The counter-notice is
 * forwarded to the complainant as written, so it must read there as it reads
 * here: no control character and no invisible mark, and a line break only
 * where `lineBreaks` allows one (an address, what was restricted, where it was).
 */
export function hasRefusedCharacters(text: string, opts: { readonly lineBreaks: boolean }): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (code === 0x0a && opts.lineBreaks) continue
    if (code < 0x20 || code === 0x7f || INVISIBLE_MARKS.has(code)) return true
  }
  return false
}

/** A multi-line field's line breaks, whatever the client sent, as a line feed. */
export function normalizeLineBreaks(text: string): string {
  return text.replace(/\r\n?/g, "\n")
}

export type CounterNoticeErrorCode = "unavailable" | "not_found" | "not_copyright" | "lifted" | "case_closed" | "already_sent" | "declaration_changed"

/** A counter-notice refused for a reason the sender can be told (routes/counter-notices.ts maps each code to a status). */
export class CounterNoticeError extends Error {
  constructor(
    readonly code: CounterNoticeErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "CounterNoticeError"
  }
}

/** Whether counter-notices can be recorded: the instance key encrypts the sender's details. */
export function counterNoticesAvailable(): boolean {
  return encryptionKeySource() !== null
}

export interface CounterNoticeSubmission {
  readonly userId: string
  readonly restrictionId: string
  readonly name: string
  readonly email: string
  readonly address: string
  readonly phone: string
  readonly signature: string
  readonly contentIdentification: string
  readonly locationBefore: string
  readonly declarationHash: string
  readonly networkHash: string | null
  readonly userAgent: string | null
}

export interface CounterNoticeReceipt {
  readonly id: string
  readonly reference: string
  readonly receivedAt: string
  readonly window: RestoreWindow
}

const USER_AGENT_MAX = 1000

interface RestrictionRow {
  id: string
  complaint_id: string | null
  owner_user_id: string | null
  lifted_at: string | null
}

interface CaseRow {
  id: string
  reference: string
  kind: "copyright" | "other"
  status: string
  updated_at: string
}

/**
 * The restriction and its case, when its owner may answer them now. A
 * restriction that is not theirs, or not a case's, is "not found": its
 * existence is nobody else's to learn. Then: a copyright case, the
 * restriction standing, the case open.
 */
async function answerable(userId: string, restrictionId: string): Promise<{ restriction: RestrictionRow; complaint: CaseRow }> {
  const { data, error } = await supabase
    .from("content_restrictions")
    .select("id, complaint_id, owner_user_id, lifted_at")
    .eq("id", restrictionId)
    .maybeSingle()
  if (error) throw new Error(`Restriction read failed: ${error.message}`)
  const restriction = data as RestrictionRow | null
  if (!restriction || restriction.owner_user_id !== userId || !restriction.complaint_id) {
    throw new CounterNoticeError("not_found", "No such restriction on your account")
  }
  const read = await supabase.from("rights_complaints").select("id, reference, kind, status, updated_at").eq("id", restriction.complaint_id).maybeSingle()
  if (read.error) throw new Error(`Complaint read failed: ${read.error.message}`)
  if (!read.data) throw new CounterNoticeError("not_found", "No such restriction on your account")
  const complaint = read.data as CaseRow
  if (complaint.kind !== "copyright") {
    throw new CounterNoticeError("not_copyright", "A counter-notification answers a copyright notice; this restriction followed another kind of complaint")
  }
  if (restriction.lifted_at) throw new CounterNoticeError("lifted", "This restriction was lifted already")
  if (CLOSED_COMPLAINT_STATUSES.has(complaint.status as ComplaintStatus)) throw new CounterNoticeError("case_closed", "The complaint behind this restriction is closed")
  return { restriction, complaint }
}

/** The row a counter-notice is stored as: the sender's details sealed to the row and the column, the window fixed at receipt. */
function counterNoticeRow(id: string, input: CounterNoticeSubmission, answered: { restriction: RestrictionRow; complaint: CaseRow }, window: RestoreWindow, at: string) {
  const enc = (column: CounterNoticeColumn, value: string) => sealCounterNoticeField(id, column, value)
  return {
    id,
    complaint_id: answered.complaint.id,
    restriction_id: answered.restriction.id,
    user_id: input.userId,
    name_enc: enc("name_enc", input.name),
    email_enc: enc("email_enc", input.email.trim()),
    address_enc: enc("address_enc", input.address),
    phone_enc: enc("phone_enc", input.phone),
    signature_enc: enc("signature_enc", input.signature),
    content_identification: input.contentIdentification,
    location_before: input.locationBefore,
    declaration_hash: COUNTER_NOTICE_DECLARATION_HASH,
    perjury_affirmed_at: at,
    jurisdiction_affirmed_at: at,
    received_at: at,
    window_opens_on: window.opensOn,
    window_closes_on: window.closesOn,
    network_hash: input.networkHash,
    user_agent: input.userAgent ? input.userAgent.slice(0, USER_AGENT_MAX) : null,
  }
}

/**
 * Records a counter-notice and answers its reference and restore window.
 * Refuses one that cannot stand: no instance key, a restriction that is not
 * the sender's or not a case's, a case that is not a copyright notice or is
 * closed, a restriction already lifted, a counter-notice already sent for it,
 * or a declaration that is not the one in force.
 */
export async function createCounterNotice(input: CounterNoticeSubmission, now: Date = new Date()): Promise<CounterNoticeReceipt> {
  if (!counterNoticesAvailable()) throw new CounterNoticeError("unavailable", "Counter-notices cannot be recorded here right now.")
  if (input.declarationHash !== COUNTER_NOTICE_DECLARATION_HASH) {
    throw new CounterNoticeError("declaration_changed", "The declaration changed; read it again and confirm it")
  }
  const answered = await answerable(input.userId, input.restrictionId)
  const { restriction, complaint } = answered

  const window = restoreWindow(now)
  const { data, error } = await supabase
    .from("rights_counter_notices")
    .insert(counterNoticeRow(randomUUID(), input, answered, window, now.toISOString()))
    .select("id, reference, received_at")
    .single()
  // 23505: one counter-notice per restriction (migration 587).
  if (error?.code === "23505") throw new CounterNoticeError("already_sent", "A counter-notification was sent for this restriction already")
  // 55027: the database's own check, under lock, refused it: the restriction
  // was lifted or the case closed since it was read. Read again to say which.
  if (error?.code === "55027") {
    await answerable(input.userId, input.restrictionId)
    throw new Error(`Counter-notice refused: ${error.message}`)
  }
  if (error || !data) throw new Error(`Counter-notice insert failed: ${error?.message ?? "no row"}`)
  const row = data as { id: string; reference: string; received_at: string }

  // The counter-notice is recorded: from here nothing fails the submission.
  await recordComplaintEventQuietly(complaint.id, "counter_notice_received", "owner", {
    counterNoticeId: row.id,
    reference: row.reference,
    restrictionId: restriction.id,
    opensOn: window.opensOn,
    closesOn: window.closesOn,
  })
  await moveCaseToCounterNotice(complaint)
  return { id: row.id, reference: row.reference, receivedAt: row.received_at, window }
}

/**
 * The case moves to `counter_notice_received` when it had not got that far,
 * from the case as it was read: a case further along (a court action on
 * another of its counter-notices, say) keeps its status, and so does one an
 * administrator moved meanwhile.
 */
async function moveCaseToCounterNotice(complaint: CaseRow): Promise<void> {
  if (!statusComesBefore(complaint.status, "counter_notice_received")) return
  try {
    const { data, error } = await supabase
      .from("rights_complaints")
      .update({ status: "counter_notice_received" })
      .eq("id", complaint.id)
      .eq("updated_at", complaint.updated_at)
      .select("id")
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (data) await recordComplaintEventQuietly(complaint.id, "status_changed", "system", { from: complaint.status, to: "counter_notice_received" })
  } catch (e) {
    console.warn(`[counter-notices] case ${complaint.id} kept its status:`, e instanceof Error ? e.message : e)
  }
}

export type CounterNoticeColumn = "name_enc" | "email_enc" | "address_enc" | "phone_enc" | "signature_enc"
/** Every encrypted column: the sender's details, and what an administrator noted of a court action. */
export type CounterNoticeSealedColumn = CounterNoticeColumn | "court_action_note_enc" | "court_action_ended_note_enc"

const COLUMNS: readonly CounterNoticeColumn[] = ["name_enc", "email_enc", "address_enc", "phone_enc", "signature_enc"]

/** Encrypts one column's value, bound to this purpose, the row and the column. */
export function sealCounterNoticeField(id: string, column: CounterNoticeSealedColumn, value: string): string {
  return boundCipher(CIPHER_PURPOSE).encrypt(value, `${id}:${column}`)
}

type Cipher = ReturnType<typeof boundCipher>

function cipherOrNull(): Cipher | null {
  try {
    return boundCipher(CIPHER_PURPOSE)
  } catch {
    return null
  }
}

function openWith(cipher: Cipher | null, id: string, column: CounterNoticeSealedColumn, value: string | null | undefined): { value: string | null; failed: boolean } {
  if (!value) return { value: null, failed: false }
  if (!cipher) return { value: null, failed: true }
  try {
    return { value: cipher.decrypt(value, `${id}:${column}`), failed: false }
  } catch {
    return { value: null, failed: true }
  }
}

/** One encrypted column opened: its value, or null and `failed` when it does not open. Never throws. */
export function openCounterNoticeField(id: string, column: CounterNoticeSealedColumn, value: string | null | undefined): { value: string | null; failed: boolean } {
  return openWith(cipherOrNull(), id, column, value)
}

export interface OpenedCounterNotice {
  readonly name: string | null
  readonly email: string | null
  readonly address: string | null
  readonly phone: string | null
  readonly signature: string | null
  /** The columns whose ciphertext did not open: their fields are null. */
  readonly unreadable: readonly CounterNoticeColumn[]
}

/**
 * The sender's details, each column opened on its own, for the handler's
 * screen (and the forwarding to the complainant the law requires). Never
 * throws: a column that does not open is null and named.
 */
export function openCounterNotice(row: { id: string } & Partial<Record<CounterNoticeColumn, string | null>>): OpenedCounterNotice {
  const cipher = cipherOrNull()
  const opened = new Map(COLUMNS.map((column) => [column, openWith(cipher, row.id, column, row[column])] as const))
  const valueOf = (column: CounterNoticeColumn) => opened.get(column)?.value ?? null
  return {
    name: valueOf("name_enc"),
    email: valueOf("email_enc"),
    address: valueOf("address_enc"),
    phone: valueOf("phone_enc"),
    signature: valueOf("signature_enc"),
    unreadable: COLUMNS.filter((column) => opened.get(column)?.failed),
  }
}
