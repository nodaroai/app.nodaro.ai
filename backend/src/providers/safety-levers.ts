/**
 * The content-filter settings a provider exposes per model: what the request
 * parameter is, what it can be set to, and what we send today. Declared once,
 * on the provider's own config (`KieModelConfig.safetyLevers`,
 * `ReplicateModelSpec.safetyLevers`, the fal config), and read by the admin
 * page, the one function that applies them (`lib/provider-safety.ts`), and a
 * guard test that fails when a built request carries a safety parameter that
 * no config declares.
 *
 * A model with no entry has no setting a provider lets us change: the model's
 * own moderation is whatever the provider runs, and no parameter reaches it.
 */

interface LeverBase {
  /** The request parameter, spelled as the provider's API spells it. */
  readonly param: string
  /**
   * The model is never loosened, whatever an admin sets: it works from a real
   * person's face or body (a character LoRA, a lip-sync), or it always takes an
   * input image or video, which a text check cannot see.
   */
  readonly neverLoosen?: true
  /** The parameter's value is documented but no run has confirmed it yet; the page says so. */
  readonly probePending?: true
  /** The parameter's spelling on the wire is unconfirmed, so the setting cannot be changed yet. */
  readonly wireUnconfirmed?: true
}

export interface BooleanSafetyLever extends LeverBase {
  readonly kind: "boolean"
  /** The value of the parameter that means the filter is ON. */
  readonly filterOnValue: boolean
  /** What the request carries today, or null when the parameter is not sent. */
  readonly shipped: boolean | null
  /** The provider's documented default when the parameter is absent, or null when the docs do not state one. */
  readonly providerDefault: boolean | null
}

export interface ScaleSafetyLever extends LeverBase {
  readonly kind: "scale"
  readonly min: number
  readonly max: number
  /** Which end is strictest: for these scales that is always the low end, stated rather than assumed. */
  readonly strictest: number
  /** What the request carries today, or null when the parameter is not sent. */
  readonly shipped: number | null
  /** The provider's documented default when the parameter is absent, or null when the docs do not state one. */
  readonly providerDefault: number | null
}

export type SafetyLever = BooleanSafetyLever | ScaleSafetyLever
export type SafetyValue = boolean | number

/** KIE's add-on filter, on by request only. Documented default false: not sending it leaves KIE's filter off. */
export const NSFW_CHECKER_LEVER: BooleanSafetyLever = { kind: "boolean", param: "nsfw_checker", filterOnValue: true, shipped: null, providerDefault: false, probePending: true }
/** The same filter, on the lanes that send `nsfw_checker: false` today. */
export const NSFW_CHECKER_SENT_FALSE_LEVER: BooleanSafetyLever = { ...NSFW_CHECKER_LEVER, shipped: false, probePending: undefined }

/** Whether the model's own checker runs. `true` is on; the docs do not state the API default. */
export const ENABLE_SAFETY_CHECKER_LEVER: BooleanSafetyLever = { kind: "boolean", param: "enable_safety_checker", filterOnValue: true, shipped: null, providerDefault: null, probePending: true }

/** What the request says about the model's own checker, reversed: `false` is on, the documented default. */
export const DISABLE_SAFETY_CHECKER_LEVER: BooleanSafetyLever = { kind: "boolean", param: "disable_safety_checker", filterOnValue: false, shipped: null, providerDefault: false, probePending: true }

/**
 * The same lever, on a model where a paid test run has confirmed it: the request
 * was accepted and finished, and the provider's own record kept the field. Per
 * model on purpose, because a run on one model proves nothing about another.
 */
export function confirmedByRun<L extends SafetyLever>(lever: L): L {
  return { ...lever, probePending: undefined }
}

/** The filter the request runs with today, in the terms of its own switch. */
export function leverToday(lever: SafetyLever): SafetyValue {
  if (lever.kind === "boolean") return lever.shipped ?? lever.providerDefault ?? lever.filterOnValue
  return lever.shipped ?? lever.providerDefault ?? lever.strictest
}

/** Whether `value` makes the filter looser than today's request. */
export function isLooserThanToday(lever: SafetyLever, value: SafetyValue): boolean {
  if (lever.kind === "boolean") {
    return value !== lever.filterOnValue && leverToday(lever) === lever.filterOnValue
  }
  const today = leverToday(lever) as number
  return Math.abs((value as number) - lever.strictest) > Math.abs(today - lever.strictest)
}

/** Whether `value` is one the lever accepts. */
export function isLeverValue(lever: SafetyLever, value: unknown): value is SafetyValue {
  if (lever.kind === "boolean") return typeof value === "boolean"
  return typeof value === "number" && Number.isInteger(value) && value >= lever.min && value <= lever.max
}
