/**
 * The repeat-infringer policy: the measure an administrator takes as an
 * account's substantiated infringements add up, counted over a rolling
 * window (decided 2026-11-03; migration 588 keeps the record).
 *
 * A guide the record follows, not an automaton: recording an infringement
 * shows the step this policy names for the account's count, prefilled, and
 * the administrator applies it, or another measure and says why. Each
 * measure keeps the step it followed as applied, so a later change to the
 * policy never rewrites what was decided under the earlier one.
 *
 * The `app_settings` row `rights_repeat_infringer_policy`; absent or
 * unreadable, the default below. Written only by its own admin route
 * (ee/routes/admin-repeat-infringers.ts), never the generic settings write.
 * Pure: no clock, no database.
 */
import { z } from "zod"

export const REPEAT_INFRINGER_POLICY_KEY = "rights_repeat_infringer_policy"

/** The measures on an account (`account_sanctions.kind`: migration 588, a suspension 589). */
export const MEASURE_KINDS = ["warning", "imports_blocked", "suspended", "closed"] as const
export type MeasureKind = (typeof MEASURE_KINDS)[number]

/** The longest a measure with a number of days may last (an import block, a suspension): about ten years. */
export const MAX_BLOCK_DAYS = 3650

/** Whether a measure lasts a number of days: an import block may (or lasts until lifted); a suspension must. */
export function measureTakesDays(kind: MeasureKind): boolean {
  return kind === "imports_blocked" || kind === "suspended"
}

/** Whether a measure must say its days: a suspension always ends (589). */
export function measureNeedsDays(kind: MeasureKind): boolean {
  return kind === "suspended"
}

export interface PolicyStep {
  /** The standing infringements in the window from which this step applies. */
  readonly infringements: number
  readonly kind: MeasureKind
  /** An import block's or a suspension's length in days; absent on an import block: until an administrator lifts it. */
  readonly days?: number
}

export interface RepeatInfringerPolicy {
  /** The rolling window the infringements are counted over, in months. */
  readonly windowMonths: number
  /** Strictly increasing by `infringements`; a closure only last. */
  readonly steps: readonly PolicyStep[]
}

/** A warning, then imports blocked for 30 days, then the account closed; counted over 24 months. */
export const DEFAULT_REPEAT_INFRINGER_POLICY: RepeatInfringerPolicy = Object.freeze({
  windowMonths: 24,
  steps: Object.freeze([
    Object.freeze({ infringements: 1, kind: "warning" as const }),
    Object.freeze({ infringements: 2, kind: "imports_blocked" as const, days: 30 }),
    Object.freeze({ infringements: 3, kind: "closed" as const }),
  ]),
})

const stepSchema = z
  .strictObject({
    infringements: z.number().int().min(1).max(100),
    kind: z.enum(MEASURE_KINDS),
    days: z.number().int().min(1).max(MAX_BLOCK_DAYS).optional(),
  })
  .refine((step) => step.days === undefined || measureTakesDays(step.kind), { message: "Only an import block or a suspension has a number of days" })
  .refine((step) => step.days !== undefined || !measureNeedsDays(step.kind), { message: "A suspension lasts a number of days" })

/** The policy as it is saved: each step needs more infringements than the one before, and a closure ends the list. */
export const repeatInfringerPolicySchema = z.strictObject({
  windowMonths: z.number().int().min(1).max(120),
  steps: z
    .array(stepSchema)
    .min(1)
    .max(10)
    .refine((steps) => steps.every((step, i) => i === 0 || step.infringements > steps[i - 1]!.infringements), {
      message: "Each step needs more infringements than the one before it",
    })
    .refine((steps) => steps.every((step, i) => step.kind !== "closed" || i === steps.length - 1), {
      message: "Closing the account is the last step",
    }),
})

/** The stored policy, or the default when there is none or it does not read as one. */
export function parseRepeatInfringerPolicy(value: unknown): RepeatInfringerPolicy {
  const parsed = repeatInfringerPolicySchema.safeParse(value)
  return parsed.success ? parsed.data : DEFAULT_REPEAT_INFRINGER_POLICY
}

/** The step the policy names for an account with `count` standing infringements in the window: the highest one reached, or null below the first. */
export function stepFor(policy: RepeatInfringerPolicy, count: number): PolicyStep | null {
  return policy.steps.reduce<PolicyStep | null>((reached, step) => (step.infringements <= count ? step : reached), null)
}

/** Whether a measure is the one a step names: the same kind, and for a measure that lasts days the same length. */
export function measureFollowsStep(step: PolicyStep, kind: MeasureKind, days: number | null): boolean {
  if (step.kind !== kind) return false
  return !measureTakesDays(kind) || (step.days ?? null) === days
}

/**
 * The first instant of the window that ends at `now`: the same day and time,
 * `windowMonths` months before. A day the earlier month does not have is its
 * last day (31 March, one month back, is the last day of February), so the
 * window never counts fewer days than its months hold.
 */
export function windowStart(policy: Pick<RepeatInfringerPolicy, "windowMonths">, now: Date): Date {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() - policy.windowMonths
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(
    Date.UTC(year, month, Math.min(now.getUTCDate(), lastDay), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds()),
  )
}
