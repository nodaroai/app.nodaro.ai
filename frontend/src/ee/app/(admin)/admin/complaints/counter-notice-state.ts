import type { CaseCounterNotice, CounterNoticeField } from "@/ee/hooks/queries/use-admin-complaints-queries"

/**
 * Where a counter-notice stands, in words, from its record: what is done, and
 * what (if anything) holds a restore back. The server refuses the same
 * restores in the same order (ee/lib/counter-notice-cases.ts); the screen
 * says why before the button is pressed.
 */

/** A window's day as written (`YYYY-MM-DD`, a New York calendar date), shown without any time zone moving it. */
export function windowDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? day : date.toLocaleDateString(undefined, { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" })
}

/** The same day in English, for the text the complainant is sent. */
function englishDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? day : date.toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" })
}

const FIELD_NAMES: Readonly<Record<CounterNoticeField, string>> = {
  name: "name",
  email: "email",
  address: "address",
  phone: "phone",
  signature: "signature",
  courtActionNote: "court action note",
  courtActionEndedNote: "note on the court action's end",
}

/** The details that could not be read, by the names the screen uses. */
export function unreadableFields(n: CaseCounterNotice): string[] {
  return n.unreadable.map((field) => FIELD_NAMES[field] ?? field)
}

/** Neither restored, held by a court action, nor declined: the case cannot be closed while one waits (migration 587). */
export function waitingForDecision(n: CaseCounterNotice): boolean {
  return !n.restoredAt && !n.courtActionAt && !n.declinedAt
}

/** Why the content cannot be restored from the counter-notice now, in the order the server refuses, or null when it can. */
export function restoreBlocker(n: CaseCounterNotice, caseClosed: boolean): string | null {
  if (n.restoredAt) return "The content was restored."
  if (n.declinedAt) return "The counter-notice was declined: lift the restriction itself to restore the content."
  if (n.courtActionAt && !n.courtActionEndedAt) return "A court action was received: the content stays restricted until the court action is recorded as ended."
  if (!n.forwardedAt) return "Send the counter-notice to the complainant, and mark it sent, before restoring the content."
  if (!n.courtActionAt && n.position === "before") return `The content can be restored from ${windowDay(n.opensOn)}, not before.`
  if (caseClosed) return "The case is closed: reopen it to restore its content."
  if (n.restrictionLiftedAt) return "The restriction was lifted already."
  if (n.otherRestrictionIds.length > 0) {
    return `Another restriction stands on the same content (${n.otherRestrictionIds.join(", ")}): it rests on another ground and is handled first.`
  }
  if (n.otherCaseReferences.length > 0) return `Another open case concerns the same content (${n.otherCaseReferences.join(", ")}): it is handled first.`
  return null
}

/** The restore is due and late: past the window's last day, still waiting for a decision. */
export function restoreOverdue(n: CaseCounterNotice): boolean {
  return n.position === "after" && waitingForDecision(n)
}

/** A multi-line value, its continuation lines indented under its label: no line of it can pass for a line of the notice itself. */
const indented = (value: string) => value.replace(/\n/g, "\n    ")

/**
 * The counter-notice as the complainant is sent it (the law has it forwarded
 * to them, with word that the content will be restored unless they go to
 * court): the sender's details, what they identified and affirmed, and the
 * dates. Copied for the administrator's own mail; nothing here sends it.
 */
export function counterNoticeText(n: CaseCounterNotice, caseReference: string): string {
  const line = (label: string, value: string | null) => `${label}: ${value === null ? "(not readable)" : indented(value)}`
  return [
    `Counter-notification ${n.reference}, regarding complaint ${caseReference}`,
    `Received: ${englishDay(n.receivedOn)} (New York)`,
    "",
    line("Name", n.name),
    line("Address", n.address),
    line("Phone", n.phone),
    line("Email", n.email),
    "",
    line("Material identified", n.contentIdentification),
    line("Location before removal", n.locationBefore),
    "",
    "The sender declared, under penalty of perjury, a good-faith belief that the material was removed or disabled as a result of mistake or misidentification, consented to the jurisdiction of the applicable United States Federal District Court (17 U.S.C. § 512(g)(3)), and agreed to accept service of process from the person who submitted the original notification or that person's agent.",
    "",
    line("Signature", n.signature),
    "",
    `Unless you notify us, before ${englishDay(n.opensOn)}, that you have filed an action seeking a court order to restrain the sender from engaging in infringing activity relating to this material, the material will be restored between ${englishDay(n.opensOn)} and ${englishDay(n.closesOn)} (New York dates).`,
  ].join("\n")
}
