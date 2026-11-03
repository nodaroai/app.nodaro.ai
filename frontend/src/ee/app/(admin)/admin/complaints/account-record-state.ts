import type { ComplaintCase } from "@/ee/hooks/queries/use-admin-complaints-queries"
import type { AccountRecord, MeasureKind, PolicyStep, RecordInfringement } from "@/ee/hooks/queries/use-admin-repeat-infringers"

/**
 * What the account's record on a case says to do next (case-account-record.tsx):
 * pure, so each rule is tested on its own.
 */

/** Whether a measure is the one a step names: the same kind, and for an import block the same length (the server's own rule). */
export function followsStep(step: PolicyStep | null, kind: MeasureKind, days: number | null): boolean {
  if (!step || step.kind !== kind) return false
  return kind !== "imports_blocked" || (step.days ?? null) === days
}

/** The standing infringement this case recorded against its account, if any. */
export function standingInfringementOf(record: AccountRecord, caseId: string): RecordInfringement | null {
  return record.infringements.find((i) => i.complaintId === caseId && !i.withdrawnAt) ?? null
}

/** Why an infringement cannot be recorded from this case now, or null when it can. */
export function recordBlocker(c: ComplaintCase): string | null {
  if (!c.verifiedAt) return "The complainant has not proved their email: the case is not evidence yet."
  if (!c.userId) return "Name the case's account first."
  if (c.record && standingInfringementOf(c.record, c.id)) return "An infringement from this case is recorded."
  return null
}

/** Why a measure cannot be taken from this case now, or null when it can. */
export function measureBlocker(c: ComplaintCase): string | null {
  if (!c.verifiedAt) return "The complainant has not proved their email: the case is not evidence yet."
  if (!c.userId) return "Name the case's account first."
  return null
}

export interface MeasureDraft {
  readonly kind: MeasureKind
  /** An import block's length; null: until lifted. */
  readonly days: number | null
}

/** The measure the form starts at: the policy's step, or a warning when it names none. */
export function draftFromStep(step: PolicyStep | null): MeasureDraft {
  if (!step) return { kind: "warning", days: null }
  return { kind: step.kind, days: step.kind === "imports_blocked" ? (step.days ?? null) : null }
}

/** What the account's owner is told, suggested for a measure: the administrator may change it. */
export function suggestedOwnerReason(kind: MeasureKind, caseKind: "copyright" | "other"): string {
  const complaint = caseKind === "copyright" ? "a copyright complaint" : "a complaint"
  if (kind === "warning") {
    return `We upheld ${complaint} about content in your account. Further infringements can lead to importing being blocked, or to the account being closed.`
  }
  if (kind === "imports_blocked") return "We upheld repeated complaints about content in your account, so importing links is blocked on it for now."
  return "We upheld repeated complaints about content in your account, so the account is closed."
}

/**
 * Where the account's block and its closures disagree (neither ever moves
 * the other): a closure lifted while the block stands, or a closure standing
 * while the account was unblocked from its page. Null when they agree, or
 * the block could not be read.
 */
export function blockMismatch(record: AccountRecord): "blocked_after_lift" | "closure_without_block" | null {
  const closures = record.measures.filter((m) => m.kind === "closed")
  const inForce = closures.some((m) => m.inForce)
  if (record.blocked === true && closures.length > 0 && !inForce) return "blocked_after_lift"
  if (record.blocked === false && inForce) return "closure_without_block"
  return null
}

/** A number of days typed in the form: a whole number from 1 to `max`, or null for "until lifted" (an empty field); undefined when it is neither. */
export function parseDays(text: string, max: number): number | null | undefined {
  const trimmed = text.trim()
  if (trimmed === "") return null
  if (!/^\d+$/.test(trimmed)) return undefined
  const days = Number(trimmed)
  return days >= 1 && days <= max ? days : undefined
}
