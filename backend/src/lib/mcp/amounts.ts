/**
 * THE ONE FUNNEL every amount the MCP lane states goes through (decided
 * 2026-11-15).
 *
 * A deployment can show its own unit instead of credits (`billing.unitLabel` /
 * `unitLabels` / `unitRate` / `unitDecimals` on the surface profile), hold each
 * user's balance in an external wallet, and withhold self-serve purchase
 * (`billing.selfServe: false`). REST answers in those terms ADDITIVELY: a
 * `display` object rides beside the raw credits (`ee/billing/credit-display.ts`).
 * An MCP client is a language model, and it repeats whatever number it reads,
 * so here the raw figure must not sit beside the converted one: on such a
 * deployment everything the lane says about credits, used or left, is in the
 * deployment's unit and from the deployment's own balance — never the
 * platform's raw credits.
 *
 * WITH NOTHING CONFIGURED (no unit, no external wallet, self-serve on) every
 * function here is the identity: `statedAmount(x) === x`, `amountWord()` is
 * "credits", `unitFields()` is `{}`, and every reply is byte-identical to what
 * it was before this module existed (`__tests__/deployment-amounts.test.ts`
 * holds the recordings, `tool-list-wire.test.ts` the tool list).
 *
 * THE CONVERSION IS `toUnits` (`lib/billing-display-unit.ts`), the one every
 * surface uses: `null` stays null (unavailable — never 0), `undefined` stays
 * undefined (an absent key stays absent), a figure that cannot be converted
 * becomes null. The rate itself is never stated: a client is told converted
 * amounts and the unit's word, not "× N".
 *
 * Core code, loaded on every edition: it reads the surface profile and the
 * environment, never `ee/` (the balance read that needs `ee/` goes through a
 * dynamic import in `tools/models.ts`).
 *
 * `__tests__/deployment-amounts-totality.test.ts` fails an MCP file that states
 * an amount without coming through here.
 */
import { configuredDisplayUnit, toUnits, type DisplayUnit } from "../billing-display-unit.js"
import { runtimeSurfaceProfile } from "../surface-profile.js"
import { externalWalletConfigured } from "../external-wallet.js"

/** The deployment's billing terms, as the MCP lane states amounts in them. */
export interface AmountTerms {
  /** The deployment's own unit, or null: amounts are stated in credits, as they always were. */
  readonly unit: DisplayUnit | null
  /** `billing.selfServe`: whether a user may buy the platform's plans or credits here. */
  readonly selfServe: boolean
  /** Whether an external wallet holds each user's balance. */
  readonly externalWallet: boolean
}

/** Read at call time (the profile and the environment are fixed for a process, and tests change them). */
export function amountTerms(): AmountTerms {
  return { unit: configuredDisplayUnit(), selfServe: runtimeSurfaceProfile().billing.selfServe, externalWallet: externalWalletConfigured() }
}

/** True when the deployment states amounts in its own terms: a unit, an external wallet, or no self-serve billing. */
export function ownTermsActive(t: AmountTerms = amountTerms()): boolean {
  return t.unit !== null || t.externalWallet || !t.selfServe
}

/** The balance is the deployment's to manage: nobody tops it up, upgrades or buys more here. */
export function balanceManagedByDeployment(t: AmountTerms = amountTerms()): boolean {
  return !t.selfServe || t.externalWallet
}

/**
 * One credit figure as the lane states it: in the deployment's unit when it has
 * one, unchanged otherwise. `null` stays null, `undefined` stays undefined.
 */
export function statedAmount(credits: number): number | null
export function statedAmount(credits: number | null): number | null
export function statedAmount(credits: number | null | undefined): number | null | undefined
export function statedAmount(credits: number | null | undefined): number | null | undefined {
  if (credits === undefined || credits === null) return credits
  const u = configuredDisplayUnit()
  return u === null ? credits : toUnits(credits, u.rate, u.decimals)
}

/** `value` when it is a number, converted; anything else as it is (a field that is not a figure is not touched). */
function statedIfNumber(value: unknown): unknown {
  return typeof value === "number" ? statedAmount(value) : value
}

/**
 * A copy of `row` with each named key that holds a number converted. A key the
 * row does not have stays absent, a non-number stays as it is. With no unit the
 * row itself is returned, so nothing about it can move.
 */
export function statedAmountFields<T extends object>(row: T, keys: readonly string[]): T {
  if (configuredDisplayUnit() === null) return row
  const out: Record<string, unknown> = { ...(row as Record<string, unknown>) }
  for (const key of keys) if (key in out) out[key] = statedIfNumber(out[key])
  return out as T
}

/**
 * A copy of a record whose every value is an amount (a quote's `breakdown`,
 * an answer keyed by price id): each number converted, nested records too. With
 * no unit the record itself is returned.
 */
export function statedAmountRecord<T>(record: T): T {
  if (configuredDisplayUnit() === null || record === null || typeof record !== "object") return record
  if (Array.isArray(record)) return record.map((v) => statedAmountRecord(v)) as T
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(record as Record<string, unknown>)) {
    out[k] = typeof v === "number" ? statedAmount(v) : v !== null && typeof v === "object" ? statedAmountRecord(v) : v
  }
  return out as T
}

/** The credit figures of a job row as the job tools list it (`jobs.credits` and the run's settled figures). */
export const JOB_AMOUNT_KEYS = ["credits", "credits_charged", "credits_held", "credits_released", "credits_actual"] as const
/** The credit figures a job's `input_data` / `output_data` can carry (a use-case run's fee, an analysis step's hold). */
export const JOB_DATA_AMOUNT_KEYS = ["_feeCredits", "analysisCredits"] as const

/** A job row with every credit figure it carries stated through the funnel — the row itself with no unit. */
export function statedJobRow<T extends object>(row: T): T {
  if (configuredDisplayUnit() === null) return row
  const out = statedAmountFields(row, JOB_AMOUNT_KEYS) as Record<string, unknown>
  for (const key of ["input_data", "output_data"]) {
    const data = out[key]
    if (data && typeof data === "object" && !Array.isArray(data)) out[key] = statedAmountFields(data as Record<string, unknown>, JOB_DATA_AMOUNT_KEYS)
  }
  return out as T
}

/**
 * The unit's word in an English sentence (decided 2026-11-16): the English word
 * the deployment gives it (`billing.unitLabels.en`), else its label. Every
 * sentence the lane writes is English; the fields that name the unit
 * (`unit`, `unitLabels`) keep the label and the map as they are.
 */
export function unitEnglishWord(u: DisplayUnit): string {
  return u.labels?.en ?? u.label
}

/** The word a sentence names an amount in: the unit's English word, or "credits". */
export function amountWord(): string {
  const u = configuredDisplayUnit()
  return u === null ? "credits" : unitEnglishWord(u)
}

/** The short form a description states a price in: the unit's English word, or "cr". */
export function amountAbbreviation(): string {
  const u = configuredDisplayUnit()
  return u === null ? "cr" : unitEnglishWord(u)
}

/** `"<n> <word>"`, the converted figure in a sentence; an amount that could not be stated reads as unavailable. */
export function amountPhrase(credits: number): string {
  const n = statedAmount(credits)
  return n === null ? `an unavailable number of ${amountWord()}` : `${n} ${amountWord()}`
}

/** What a reply carries beside its amounts on a deployment with its own unit. */
export interface UnitFields {
  unit?: string
  unitLabels?: Readonly<Record<string, string>>
  decimals?: number
}

/**
 * The unit's word (and its word per interface language, and the decimals its
 * figures carry) for a reply that states amounts — `{}` when there is no unit,
 * so the reply does not change. Never the rate.
 */
export function unitFields(): UnitFields {
  const u = configuredDisplayUnit()
  if (u === null) return {}
  return { unit: u.label, ...(u.labels ? { unitLabels: u.labels } : {}), decimals: u.decimals }
}

/**
 * The sentence a tool description adds on a deployment with its own unit, so
 * the model reads the fields named `credits…` as that unit; "" otherwise.
 */
export function amountsNote(): string {
  const u = configuredDisplayUnit()
  return u === null ? "" : ` On this deployment every amount (fields named credits included) is in ${unitEnglishWord(u)}, the deployment's own unit.`
}

/**
 * What a balance refusal tells the model to do next. Self-serve: the user tops
 * up (`check_balance` shows the balance). Otherwise the balance is the
 * deployment's to manage, and the user asks its operator.
 */
export function balanceNextStep(t: AmountTerms = amountTerms()): string {
  return balanceManagedByDeployment(t)
    ? "The balance is managed by this deployment: tell the user, who can ask the deployment's operator for more (check_balance shows the balance)"
    : "Ask the user to top up (check_balance shows the balance)"
}

/**
 * A refusal for want of balance (a 402), as the model is told it on a
 * deployment in its own terms — or null with nothing configured, where the
 * caller keeps the words it always had. It states no figure: the figures a
 * route writes into its refusal are raw credits, and here they would sit under
 * the deployment's unit. `what` names what could not be covered ("this
 * generation"), `code` the route's code when it has one.
 */
export function balanceRefusal(what: string, code?: string, t: AmountTerms = amountTerms()): string | null {
  if (!ownTermsActive(t)) return null
  const why = `Nodaro: the balance cannot cover ${what}${code ? ` (${code})` : ""}.`
  return balanceManagedByDeployment(t) ? `${why} ${balanceNextStep(t)}.` : `Nodaro: insufficient ${amountWord()} for ${what}${code ? ` (${code})` : ""}.`
}

// ── the balance ────────────────────────────────────────────────────────────

/** The balance figures as `GET /v1/user/credits` assembles them, in raw credits. */
export interface RawBalance {
  total: number
  subscription: number
  topup: number
  dailySpent: number
  dailyLimit: number | null
  monthlyAllocation: number
  tier: string
  effectiveTier: string
  features: Record<string, unknown>
  periodEnd: string | null
  appCreditsAllowance: number
  allowance?: { granted: number; remaining: number; enforced: boolean } | null
  externalWallet?: { available: number | null }
}

/** The same figures converted by the REST projection (`withBalanceDisplay`'s `display`). */
export interface ConvertedBalance {
  total: number | null
  subscription: number | null
  topup: number | null
  dailySpent: number | null
  dailyLimit: number | null
  monthlyAllocation: number | null
  appCreditsAllowance: number | null
  allowance?: { granted: number | null; remaining: number | null } | null
  externalWallet?: { available: number | null }
}

const UNAVAILABLE_NOTE =
  "The balance could not be read just now: it is unknown, not 0. Do not tell the user they have nothing left; try again shortly."
const MANAGED_NOTE =
  "This balance is managed by the deployment: it cannot be topped up, bought or upgraded here. For more, the user asks the deployment's operator."

/**
 * `check_balance` on a deployment in its own terms: what that deployment's own
 * balance display shows this user, once, in its unit.
 *
 *  - `available` is the headline: the external wallet's available amount, else
 *    the allowance's remaining, else the balance. `null` means it could not be
 *    read, never 0, and the platform's balance never stands in for it.
 *  - The figures come from `converted` — the REST route's own projection — when
 *    the deployment has a unit, so the two can not disagree; without a unit
 *    they are the raw credits, which then ARE the deployment's figures.
 *  - The fields that describe the platform's own plans (tier, subscription,
 *    top-up, monthly allocation, daily cap) are left out where the balance is
 *    the deployment's to manage.
 */
export function statedBalance(raw: RawBalance, converted: ConvertedBalance | undefined, t: AmountTerms = amountTerms()): Record<string, unknown> {
  // With a unit, a figure is the REST projection's or it is unavailable — never
  // the raw credits under the unit's name.
  const c = converted
  const pick = (rawValue: number | null, convertedValue: number | null | undefined): number | null =>
    t.unit === null ? rawValue : (convertedValue ?? null)
  const managed = balanceManagedByDeployment(t)
  const head: Record<string, unknown> = { unit: t.unit?.label ?? "credits", ...(t.unit?.labels ? { unitLabels: t.unit.labels } : {}), ...(t.unit ? { decimals: t.unit.decimals } : {}) }

  let available: number | null
  const body: Record<string, unknown> = {}
  if (raw.externalWallet) {
    head.source = "external_wallet"
    available = pick(raw.externalWallet.available, c?.externalWallet?.available)
  } else if ("allowance" in raw) {
    head.source = "allowance"
    const a = raw.allowance
    available = a ? pick(a.remaining, c?.allowance?.remaining) : null
    body.allowance = a ? { granted: pick(a.granted, c?.allowance?.granted), remaining: available, enforced: a.enforced } : null
  } else {
    head.source = "balance"
    available = pick(raw.total, c?.total)
    body.dailySpent = pick(raw.dailySpent, c?.dailySpent)
    if (!managed) {
      body.subscription = pick(raw.subscription, c?.subscription)
      body.topup = pick(raw.topup, c?.topup)
      body.dailyLimit = pick(raw.dailyLimit, c?.dailyLimit)
      body.monthlyAllocation = pick(raw.monthlyAllocation, c?.monthlyAllocation)
      body.appCreditsAllowance = pick(raw.appCreditsAllowance, c?.appCreditsAllowance)
    }
  }
  const plan = managed ? {} : { tier: raw.tier, effectiveTier: raw.effectiveTier, features: raw.features, periodEnd: raw.periodEnd }
  const notes = [available === null ? UNAVAILABLE_NOTE : null, managed ? MANAGED_NOTE : null].filter((n): n is string => n !== null)
  return {
    ...head,
    available,
    ...body,
    ...plan,
    ...(managed ? { managedBy: "deployment" } : {}),
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  }
}
