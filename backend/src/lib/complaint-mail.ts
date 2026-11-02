/**
 * The two emails a content complaint sends: the verification link, and the
 * acknowledgment once the email is proven (the policy's "complaint received"
 * notice, with the reference number).
 *
 * Mail goes through Loops, which lives in `ee/` (Cloud): core code may not
 * import it statically, so this is the shim pattern of `middleware/credit-guard.ts`,
 * a dynamic import behind `isCloud()`. Where there is no mailer, or no
 * template, the answer says so and the caller records it on the case: a
 * complaint is never dropped for want of an email, it waits for the handler.
 */
import { config, isCloud } from "./config.js"

export type ComplaintMailResult =
  | { readonly sent: true; readonly messageId: string | null }
  | { readonly sent: false; readonly reason: "no_mailer" | "no_template" | "failed"; readonly error?: string }

async function send(templateId: string, email: string, variables: Readonly<Record<string, string>>): Promise<ComplaintMailResult> {
  if (!isCloud()) return { sent: false, reason: "no_mailer" }
  if (!templateId) return { sent: false, reason: "no_template" }
  const { isLoopsConfigured, sendTransactional } = await import("../ee/lib/loops-client.js")
  if (!isLoopsConfigured()) return { sent: false, reason: "no_mailer" }
  const result = await sendTransactional(templateId, email, variables)
  if (!result.ok) return { sent: false, reason: "failed", error: result.error ?? "unknown" }
  return { sent: true, messageId: result.messageId ?? null }
}

/** The one-time link that proves the complainant's email. */
export function sendComplaintVerification(input: { email: string; reference: string; verifyUrl: string }): Promise<ComplaintMailResult> {
  return send(config.LOOPS_COMPLAINT_VERIFY_ID, input.email, { reference: input.reference, verifyUrl: input.verifyUrl })
}

/** "Complaint received", with the reference number, once the email is proven. */
export function sendComplaintAcknowledgment(input: { email: string; reference: string }): Promise<ComplaintMailResult> {
  return send(config.LOOPS_COMPLAINT_RECEIVED_ID, input.email, { reference: input.reference })
}
