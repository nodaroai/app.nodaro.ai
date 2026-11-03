import { MAX_BLOCK_DAYS, measureNeedsDays, measureTakesDays, type MeasureKind, type PolicyStep, type RepeatInfringerPolicy } from "@/ee/hooks/queries/use-admin-repeat-infringers"

/**
 * The repeat-infringer policy as its editor holds it (repeat-infringer-policy-card.tsx):
 * numbers as typed, read back into a policy only once they read as one, by
 * the server's own rules (backend lib/repeat-infringer-policy.ts). Pure.
 */

export interface StepDraft {
  readonly infringements: string
  readonly kind: MeasureKind
  /** An import block's days (empty: until lifted) or a suspension's (required). */
  readonly days: string
}

export interface PolicyDraft {
  readonly windowMonths: string
  readonly steps: readonly StepDraft[]
}

/** The server's bounds (backend lib/repeat-infringer-policy.ts; a test holds the two equal). */
export const MAX_POLICY_STEPS = 10
export const MAX_WINDOW_MONTHS = 120
export const MAX_STEP_INFRINGEMENTS = 100

export function toDraft(policy: RepeatInfringerPolicy): PolicyDraft {
  return {
    windowMonths: String(policy.windowMonths),
    steps: policy.steps.map((s) => ({ infringements: String(s.infringements), kind: s.kind, days: s.days ? String(s.days) : "" })),
  }
}

/** A whole number from `min` to `max` as typed, or null. */
function whole(text: string, min: number, max: number): number | null {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const n = Number(trimmed)
  return n >= min && n <= max ? n : null
}

/** What keeps the draft from being saved, or null when it reads as a policy. */
export function policyProblem(draft: PolicyDraft): string | null {
  if (whole(draft.windowMonths, 1, MAX_WINDOW_MONTHS) === null) return `The window is a whole number of months, from 1 to ${MAX_WINDOW_MONTHS}.`
  if (draft.steps.length < 1 || draft.steps.length > MAX_POLICY_STEPS) return `The policy has from 1 to ${MAX_POLICY_STEPS} steps.`
  const counts = draft.steps.map((s) => whole(s.infringements, 1, MAX_STEP_INFRINGEMENTS))
  if (counts.some((n) => n === null)) return `Each step's count is a whole number of infringements, from 1 to ${MAX_STEP_INFRINGEMENTS}.`
  if (counts.some((n, i) => i > 0 && n! <= counts[i - 1]!)) return "Each step needs more infringements than the one before it."
  if (draft.steps.some((s) => s.kind === "imports_blocked" && s.days.trim() !== "" && whole(s.days, 1, MAX_BLOCK_DAYS) === null)) {
    return `An import block lasts a whole number of days from 1 to ${MAX_BLOCK_DAYS}, or until lifted (empty).`
  }
  if (draft.steps.some((s) => measureNeedsDays(s.kind) && whole(s.days, 1, MAX_BLOCK_DAYS) === null)) {
    return `A suspension lasts a whole number of days, from 1 to ${MAX_BLOCK_DAYS}.`
  }
  if (draft.steps.some((s, i) => s.kind === "closed" && i !== draft.steps.length - 1)) return "Closing the account is the last step."
  return null
}

/** The draft as a policy; null while it has a problem. */
export function fromDraft(draft: PolicyDraft): RepeatInfringerPolicy | null {
  if (policyProblem(draft) !== null) return null
  return {
    windowMonths: Number(draft.windowMonths.trim()),
    steps: draft.steps.map((s): PolicyStep => {
      const infringements = Number(s.infringements.trim())
      if (!measureTakesDays(s.kind) || s.days.trim() === "") return { infringements, kind: s.kind }
      return { infringements, kind: s.kind, days: Number(s.days.trim()) }
    }),
  }
}

/** The draft with one step replaced. */
export function withStep(draft: PolicyDraft, index: number, patch: Partial<StepDraft>): PolicyDraft {
  return { ...draft, steps: draft.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) }
}

/** The draft with a step added after the last: one more infringement than it, a warning. */
export function withNewStep(draft: PolicyDraft): PolicyDraft {
  const last = draft.steps.at(-1)
  const next = last ? String((whole(last.infringements, 1, MAX_STEP_INFRINGEMENTS) ?? 0) + 1) : "1"
  return { ...draft, steps: [...draft.steps, { infringements: next, kind: "warning", days: "" }] }
}

/** The draft without one step. */
export function withoutStep(draft: PolicyDraft, index: number): PolicyDraft {
  return { ...draft, steps: draft.steps.filter((_, i) => i !== index) }
}
