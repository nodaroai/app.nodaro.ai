/**
 * The emails a content complaint sends: the verification link, and the
 * acknowledgment once the email is proven (the policy's "complaint received"
 * notice, with the reference number); and the two its handler sends from the
 * case (ee/lib/complaint-notices.ts): "Content access restricted" to the
 * account whose content was restricted, and "Complaint update" to the
 * complainant.
 *
 * Mail goes through Loops, which lives in `ee/` (Cloud): core code may not
 * import it statically, so this is the shim pattern of `middleware/credit-guard.ts`,
 * a dynamic import behind `isCloud()`. Where there is no mailer, or no
 * template, the answer says so and the caller records it on the case: a
 * complaint is never dropped for want of an email, it waits for the handler.
 */
import { config, isCloud } from "./config.js"

/**
 * What became of an email. `failed` is the mail service saying no: it did not
 * go. `unknown` is a wait that ran out, or a connection that dropped: the
 * service may well have taken it (ee/lib/loops-client.ts `LoopsFailureKind`),
 * so it is never recorded as a failure, nor offered as one to send again.
 */
export type ComplaintMailResult =
  | { readonly sent: true; readonly messageId: string | null }
  | { readonly sent: false; readonly reason: "no_mailer" | "no_template" | "failed" | "unknown"; readonly error?: string }

async function send(templateId: string, email: string, variables: Readonly<Record<string, string>>): Promise<ComplaintMailResult> {
  if (!isCloud()) return { sent: false, reason: "no_mailer" }
  if (!templateId) return { sent: false, reason: "no_template" }
  const { isLoopsConfigured, sendTransactional } = await import("../ee/lib/loops-client.js")
  if (!isLoopsConfigured()) return { sent: false, reason: "no_mailer" }
  const result = await sendTransactional(templateId, email, variables)
  if (result.ok) return { sent: true, messageId: result.messageId ?? null }
  if (result.failureKind === "not_configured") return { sent: false, reason: "no_mailer" }
  const reason = result.failureKind === "timeout" || result.failureKind === "network" ? "unknown" : "failed"
  return { sent: false, reason, error: result.error ?? "unknown" }
}

/** The one-time link that proves the complainant's email. */
export function sendComplaintVerification(input: { email: string; reference: string; verifyUrl: string }): Promise<ComplaintMailResult> {
  return send(config.LOOPS_COMPLAINT_VERIFY_ID, input.email, { reference: input.reference, verifyUrl: input.verifyUrl })
}

/** "Complaint received", with the reference number, once the email is proven. */
export function sendComplaintAcknowledgment(input: { email: string; reference: string }): Promise<ComplaintMailResult> {
  return send(config.LOOPS_COMPLAINT_RECEIVED_ID, input.email, { reference: input.reference })
}

/** The values "Content access restricted" shows, escaped by the caller: Loops puts them in the email as they are. */
export interface ContentRestrictedVariables {
  readonly content: string
  readonly source: string
  readonly reason: string
  readonly reference: string
  readonly counterNoticeUrl: string
}

/** "Content access restricted", to the account whose content a copyright complaint's restriction covers. */
export function sendContentRestricted(email: string, variables: ContentRestrictedVariables): Promise<ComplaintMailResult> {
  return send(config.LOOPS_CONTENT_RESTRICTED_ID, email, { ...variables })
}

/** The values "Complaint update" shows, escaped by the caller. */
export interface ComplaintUpdateVariables {
  readonly reference: string
  readonly status: string
  readonly action: string
}

/** "Complaint update", to the complainant: the case's status and what was done. */
export function sendComplaintUpdate(email: string, variables: ComplaintUpdateVariables): Promise<ComplaintMailResult> {
  return send(config.LOOPS_COMPLAINT_UPDATE_ID, email, { ...variables })
}
