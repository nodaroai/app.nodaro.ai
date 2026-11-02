/**
 * Content complaints (migration 580): the case a complaint from the public form
 * opens, and what happens to it.
 *
 * A submission ALWAYS opens a case, at once and unverified: the row is written
 * before anything else is tried (matching, events, mail), so nothing a
 * complainant sent is ever dropped, and the reference number they are given
 * is the case's. They then prove their email with a one-time link
 * (`verifyComplaint`), which is when the acknowledgment goes out. What they
 * submitted is frozen by the table's trigger; the complainant's personal
 * details are stored encrypted, bound to the case and the column, with a
 * keyed digest of the email for lookups, so a read of the table without the
 * instance key reads nothing about a person.
 *
 * The links a complainant gives are matched against our OWN records (the
 * confirmations' normalized link, an asset's source link, an asset's own
 * address) after the case exists, and the matches kept on it for the handler;
 * a matching failure is an event on the case, never a refusal. The
 * complainant is never told whether anything matched: the form's answer is
 * the same for a link we hold and one we never saw.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { supabase } from "./supabase.js"
import { boundCipher, boundDigest, encryptionKeySource } from "./instance-cipher.js"
import { normalizeSourceUrl } from "./content-rights.js"

export const COMPLAINT_CATEGORIES = [
  "copyright_infringement",
  "likeness",
  "voice",
  "impersonation",
  "privacy",
  "other",
] as const
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number]

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

/** The two statements a copyright notice affirms, verbatim; the form shows them and the record hashes them. */
export const GOOD_FAITH_STATEMENT =
  "I have a good-faith belief that the use of the material identified in this notice is not authorized by the copyright owner, its agent, or the law."
export const ACCURACY_STATEMENT =
  "I declare, under penalty of perjury, that the information in this notice is accurate and that I am the copyright owner or am authorized to act on behalf of the owner of an exclusive right that is allegedly infringed."
export const COMPLAINT_STATEMENTS_HASH = sha256(`${GOOD_FAITH_STATEMENT}\n${ACCURACY_STATEMENT}`)

/** How long the one-time verification link is good for. */
export const VERIFICATION_TTL_MS = 72 * 60 * 60 * 1000
/** The most links one submission is matched on (the rest stay in the text for the handler). */
export const MAX_MATCHED_LINKS = 50
/** The longest user agent the record keeps (the table's own limit). */
export const USER_AGENT_MAX = 1000

const CIPHER_PURPOSE = "rights-complaints"
const EMAIL_DIGEST_PURPOSE = "rights-complaints-email"

export type RightsComplaintErrorCode = "complaints_unavailable"

export class RightsComplaintError extends Error {
  constructor(
    readonly code: RightsComplaintErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "RightsComplaintError"
  }
}

export interface ComplaintSubmission {
  readonly kind: "copyright" | "other"
  readonly category: ComplaintCategory
  readonly name: string
  readonly email: string
  readonly address?: string
  readonly phone?: string
  /** A copyright notice: the rights holder, or someone authorized to act for them. */
  readonly claimantRole?: "owner" | "agent"
  readonly originalWork?: string
  readonly originalWorkUrl?: string
  /** Where the complained-of content is: links, or any other identification. */
  readonly reportedContent: string
  readonly explanation: string
  readonly signature?: string
  /** A copyright notice: both statements were affirmed. */
  readonly statementsAffirmed?: boolean
  /** The hidden field a form-filling bot fills was filled: the case opens, flagged, and is not mailed. */
  readonly honeypot?: boolean
  readonly networkHash: string | null
  readonly userAgent: string | null
}

export interface ComplaintReceipt {
  readonly id: string
  readonly reference: string
  /** The one-time token the verification link carries; only its hash is stored. */
  readonly verificationToken: string
  readonly verificationExpiresAt: string
}

export interface ComplaintMatches {
  readonly assetIds: readonly string[]
  readonly confirmationIds: readonly string[]
  readonly userIds: readonly string[]
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

/** The email, lower-cased and trimmed, under a keyed digest: the lookup key, never the address and never guessable from the table. */
export function complainantEmailHash(email: string): string {
  return boundDigest(EMAIL_DIGEST_PURPOSE, email.trim().toLowerCase())
}

/** Whether complaints can be recorded: the instance key encrypts the complainant's details. */
export function complaintsAvailable(): boolean {
  return encryptionKeySource() !== null
}

/** The http(s) links in a free-text field, each once, in order. */
export function extractLinks(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"']+/gi) ?? []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of found) {
    const trimmed = raw.replace(/[.,;:)\]]+$/, "")
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

/** A link with its query and fragment dropped: how an asset's own address is compared. */
function bareUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch {
    return null
  }
}

function normalizedOrNull(raw: string): string | null {
  try {
    return normalizeSourceUrl(raw)
  } catch {
    return null
  }
}

/** A link as `new URL` reads it back: percent-encoded, so nothing in it can reach a filter as syntax. */
function parsedOrNull(raw: string): string | null {
  try {
    return new URL(raw).toString()
  } catch {
    return null
  }
}

function unique(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === "string" && v.length > 0))]
}

/**
 * What the complainant's links match in our own records: a confirmation made
 * for that link, an asset imported from it (assets keep the link as pasted,
 * so both the pasted and the normalized forms are asked for), or an asset
 * whose own address it is. Answers ids only; the handler reads the rest.
 * Every value has been through `new URL`, which percent-encodes anything the
 * filter would read as syntax; a caller must never hand raw strings here.
 */
export async function matchReportedUrls(links: readonly string[]): Promise<ComplaintMatches> {
  const parsed = unique(links.map(parsedOrNull))
  const normalized = unique(links.map(normalizedOrNull))
  const sources = unique([...parsed, ...normalized])
  const bare = unique(links.map(bareUrl))
  if (sources.length === 0 && bare.length === 0) return { assetIds: [], confirmationIds: [], userIds: [] }

  const confirmations =
    normalized.length > 0
      ? await supabase.from("content_rights_confirmations").select("id, user_id").in("normalized_url", normalized).limit(200)
      : { data: [], error: null }
  if (confirmations.error) throw new Error(`Complaint match failed (confirmations): ${confirmations.error.message}`)

  const bySource =
    sources.length > 0
      ? await supabase.from("assets").select("id, user_id").in("metadata->>source_url", sources).limit(200)
      : { data: [], error: null }
  if (bySource.error) throw new Error(`Complaint match failed (assets by source): ${bySource.error.message}`)

  const byAddress =
    bare.length > 0 ? await supabase.from("assets").select("id, user_id").in("r2_url", bare).limit(200) : { data: [], error: null }
  if (byAddress.error) throw new Error(`Complaint match failed (assets by address): ${byAddress.error.message}`)

  const confirmationRows = (confirmations.data ?? []) as Array<{ id: string; user_id: string | null }>
  const assetRows = [...((bySource.data ?? []) as Array<{ id: string; user_id: string | null }>), ...((byAddress.data ?? []) as Array<{ id: string; user_id: string | null }>)]
  return {
    assetIds: unique(assetRows.map((r) => r.id)),
    confirmationIds: unique(confirmationRows.map((r) => r.id)),
    userIds: unique([...assetRows, ...confirmationRows].map((r) => r.user_id)),
  }
}

/** The AAD of one encrypted column: the case and the column, so a ciphertext opens only where it was written. */
function aadOf(complaintId: string, column: string): string {
  return `${complaintId}:${column}`
}

/**
 * Opens the case: encrypts the complainant's details, writes the row, and
 * answers the reference and the one-time verification token (its hash is
 * what the row keeps). Then, best effort and never failing the submission:
 * the first event, and the matching of the links onto the case.
 */
export async function createComplaint(input: ComplaintSubmission): Promise<ComplaintReceipt> {
  if (!complaintsAvailable()) {
    throw new RightsComplaintError("complaints_unavailable", "Complaints cannot be recorded here right now.")
  }
  const id = randomUUID()
  const links = extractLinks(`${input.reportedContent}\n${input.originalWorkUrl ?? ""}`).slice(0, MAX_MATCHED_LINKS)
  const token = randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS).toISOString()
  const emailHash = complainantEmailHash(input.email)
  const cipher = boundCipher(CIPHER_PURPOSE)
  const enc = (column: string, value: string | undefined): string | null => (value ? cipher.encrypt(value, aadOf(id, column)) : null)
  const now = new Date().toISOString()
  const copyright = input.kind === "copyright"

  const { data, error } = await supabase
    .from("rights_complaints")
    .insert({
      id,
      kind: input.kind,
      category: input.category,
      complainant_name_enc: enc("complainant_name_enc", input.name),
      complainant_email_enc: enc("complainant_email_enc", input.email.trim()),
      complainant_email_hash: emailHash,
      complainant_address_enc: enc("complainant_address_enc", input.address),
      complainant_phone_enc: enc("complainant_phone_enc", input.phone),
      claimant_role: copyright ? (input.claimantRole ?? null) : null,
      original_work: input.originalWork ?? null,
      original_work_url: input.originalWorkUrl ?? null,
      reported_content: input.reportedContent,
      explanation: input.explanation,
      signature_enc: enc("signature_enc", input.signature),
      good_faith_affirmed_at: copyright && input.statementsAffirmed ? now : null,
      accuracy_affirmed_at: copyright && input.statementsAffirmed ? now : null,
      statements_hash: copyright && input.statementsAffirmed ? COMPLAINT_STATEMENTS_HASH : null,
      reported_urls: unique(links.map(normalizedOrNull)),
      verification_token_hash: sha256(token),
      verification_expires_at: expiresAt,
      network_hash: input.networkHash,
      user_agent: input.userAgent ? input.userAgent.slice(0, USER_AGENT_MAX) : null,
    })
    .select("id, reference")
    .single()
  if (error || !data) throw new Error(`Complaint insert failed: ${error?.message ?? "no row"}`)
  const receipt: ComplaintReceipt = { id: data.id, reference: data.reference, verificationToken: token, verificationExpiresAt: expiresAt }

  // The case exists: from here nothing fails the submission.
  await recordComplaintEventQuietly(id, input.honeypot ? "honeypot_filled" : "received", "complainant", {
    kind: input.kind,
    category: input.category,
    links: links.length,
  })
  try {
    const matches = await matchReportedUrls(links)
    const { error: matchError } = await supabase
      .from("rights_complaints")
      .update({ matched_asset_ids: matches.assetIds, matched_confirmation_ids: matches.confirmationIds, matched_user_ids: matches.userIds })
      .eq("id", id)
    if (matchError) throw new Error(matchError.message)
    await recordComplaintEventQuietly(id, "matched", "system", {
      assets: matches.assetIds.length,
      confirmations: matches.confirmationIds.length,
    })
  } catch (e) {
    await recordComplaintEventQuietly(id, "match_failed", "system", { error: e instanceof Error ? e.message : String(e) })
  }
  return receipt
}

export interface VerifiedComplaint {
  readonly id: string
  readonly reference: string
  /** The complainant's address, decrypted for the acknowledgment. */
  readonly email: string
  /** The link was opened before (a mail scanner, a second click): the case was already verified, nothing to send again. */
  readonly alreadyVerified: boolean
}

/**
 * Proves the complainant's email: the unexpired token's case is marked
 * verified. The token is kept, so the same link opened again (a mail
 * scanner's prefetch, then the person) answers the case as already verified
 * instead of refusing the person. Null when the token names no case, or an
 * unverified case whose link has expired: the caller answers both the same.
 */
export async function verifyComplaint(token: string): Promise<VerifiedComplaint | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null
  const { data, error } = await supabase
    .from("rights_complaints")
    .select("id, reference, complainant_email_enc, verified_at, verification_expires_at")
    .eq("verification_token_hash", sha256(token))
    .maybeSingle()
  if (error) throw new Error(`Complaint verification lookup failed: ${error.message}`)
  if (!data) return null
  const row = data as { id: string; reference: string; complainant_email_enc: string; verified_at: string | null; verification_expires_at: string | null }
  const email = () => boundCipher(CIPHER_PURPOSE).decrypt(row.complainant_email_enc, aadOf(row.id, "complainant_email_enc"))
  if (row.verified_at) return { id: row.id, reference: row.reference, email: email(), alreadyVerified: true }
  if (!row.verification_expires_at || new Date(row.verification_expires_at).getTime() < Date.now()) return null

  const { data: updated, error: updateError } = await supabase
    .from("rights_complaints")
    .update({ verified_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("verified_at", null)
    .select("id")
  if (updateError) throw new Error(`Complaint verification failed: ${updateError.message}`)
  // A second open of the same link raced the first: that one verified.
  const won = Boolean(updated && (updated as unknown[]).length > 0)
  if (won) await recordComplaintEventQuietly(row.id, "verified", "complainant", {})
  return { id: row.id, reference: row.reference, email: email(), alreadyVerified: !won }
}

/** How many cases the same email opened since `since`: the per-recipient mail cap reads it before sending. */
export async function recentComplaintsByEmail(emailHash: string, since: Date): Promise<number> {
  const { count, error } = await supabase
    .from("rights_complaints")
    .select("id", { count: "exact", head: true })
    .eq("complainant_email_hash", emailHash)
    .gte("received_at", since.toISOString())
  if (error) throw new Error(`Complaint count failed: ${error.message}`)
  return count ?? 0
}

/** Appends to the case's log; a write failure is the caller's. */
export async function recordComplaintEvent(
  complaintId: string,
  kind: string,
  actor: "system" | "complainant" | (string & {}),
  data: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("rights_complaint_events").insert({ complaint_id: complaintId, kind, actor, data })
  if (error) throw new Error(`Complaint event write failed: ${error.message}`)
}

/** The same, for a step that must never fail the submission: a failure is logged and swallowed. */
export async function recordComplaintEventQuietly(
  complaintId: string,
  kind: string,
  actor: "system" | "complainant" | (string & {}),
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await recordComplaintEvent(complaintId, kind, actor, data)
  } catch (e) {
    console.warn(`[content-complaints] event "${kind}" on ${complaintId} not recorded:`, e instanceof Error ? e.message : e)
  }
}

/** The complainant's details of a row, decrypted: for the handler's screen, never for an answer to the public. */
export function decryptComplainant(row: {
  id: string
  complainant_name_enc: string
  complainant_email_enc: string
  complainant_address_enc: string | null
  complainant_phone_enc: string | null
  signature_enc: string | null
}): { name: string; email: string; address: string | null; phone: string | null; signature: string | null } {
  const cipher = boundCipher(CIPHER_PURPOSE)
  const open = (column: "complainant_name_enc" | "complainant_email_enc" | "complainant_address_enc" | "complainant_phone_enc" | "signature_enc") => {
    const value = row[column]
    return value ? cipher.decrypt(value, aadOf(row.id, column)) : null
  }
  return {
    name: open("complainant_name_enc") ?? "",
    email: open("complainant_email_enc") ?? "",
    address: open("complainant_address_enc"),
    phone: open("complainant_phone_enc"),
    signature: open("signature_enc"),
  }
}
