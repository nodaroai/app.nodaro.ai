/**
 * Which route each routable video model takes, per service: the admin's
 * `video_route_policy` row (docs/design/alternate-routes.md, "Routing per
 * model"). Pure: the shape, its parser and the lookup. The store is
 * `video-route-policy-store.ts`; the decision that reads it is
 * `video-route-decision.ts`.
 *
 * No row (or an unreadable one) means every model on "default": the shipped
 * state, identical to the platform before per-model routing existed.
 *
 * A second row, `video_route_price_factors`, holds the correction factors the
 * routed price is multiplied by (raised automatically when a route bills more
 * than it quoted, editable by an admin). It is a row of its own so an
 * automatic raise can never overwrite an admin's routing change, or the
 * reverse.
 */
import { z } from "zod"
import { SEEDANCE_2_PROVIDERS } from "@nodaro/shared/models"
import { getRuntimeEnv } from "./runtime-env.js"

/**
 * The settings rows are PER ENVIRONMENT (`getRuntimeEnv()`: staging and
 * production share one database): saving "alternate" or a factor on staging
 * never changes production, and a calibration run on one never moves the
 * other's prices. The key names the environment it belongs to.
 */
export function videoRoutePolicyKey(env = getRuntimeEnv()): string {
  return `video_route_policy:${env}`
}

export function videoRoutePriceFactorsKey(env = getRuntimeEnv()): string {
  return `video_route_price_factors:${env}`
}

/** The models a route may be chosen for: the Seedance 2.x family, from its one shared set. */
export const ROUTABLE_VIDEO_MODELS: readonly string[] = Object.freeze([...SEEDANCE_2_PROVIDERS])

export function isRoutableVideoModel(model: unknown): model is string {
  return typeof model === "string" && SEEDANCE_2_PROVIDERS.has(model)
}

/**
 * Whether a usage log's price id may be a routed job's (pure, no read): every
 * id a route prices names a Seedance 2.x model first (`seedance-2…`). Any
 * other id is settled as always, with nothing read about routing.
 */
export function routedRunFee(action: string | null | undefined): boolean {
  return action === "generate-video-pro" || action === "edit-video-pro" || action === "ugc-clip"
}

export function routedSettleCandidate(action: string | null | undefined): boolean {
  return routedRunFee(action) || (typeof action === "string" && action.startsWith("seedance-2"))
}

export type VideoRouteChoice = "default" | "alternate"

const choiceSchema = z.enum(["default", "alternate"])

const modelSettingSchema = z.strictObject({
  route: choiceSchema,
  /** Per service, overriding `route`. */
  services: z.record(z.string().min(1).max(80), choiceSchema).optional(),
})

export type VideoRouteModelSetting = z.infer<typeof modelSettingSchema>

/**
 * How many times its quote a routed run's verified bill may reach and still be
 * charged with no one looking. Above it the settlement is held for an admin to
 * confirm or reject (the clip is delivered either way). The default of the
 * policy's `billAnomalyMultiple`; an admin sets their own in Admin → Video route.
 */
export const ROUTE_BILL_ANOMALY_MULTIPLE_DEFAULT = 5

/** Defaults of the policy's thresholds. */
export const VIDEO_ROUTE_POLICY_DEFAULTS = {
  /** The daily reconciliation alerts when the route's real spend exceeds the recorded cost by more than this. */
  spendDriftAlertPercent: 3,
  /** Route failures of one model within `windowMinutes` that raise an alert. */
  failureAlert: { failures: 5, windowMinutes: 30 },
} as const

export const videoRoutePolicySchema = z.strictObject({
  models: z.record(z.string(), modelSettingSchema),
  /** Alert when the route's account (`account().availableUsd`) is below this. null = no alert. */
  routeBalanceAlertUsd: z.number().nonnegative().max(1_000_000).nullable(),
  /** Alert when the default provider's account balance (its own credits, as snapshotted) is below this. null = no alert. */
  defaultProviderBalanceAlertCredits: z.number().nonnegative().max(1_000_000_000).nullable(),
  spendDriftAlertPercent: z.number().min(0).max(100),
  failureAlert: z.strictObject({
    failures: z.number().int().min(1).max(1000),
    windowMinutes: z.number().int().min(1).max(24 * 60),
  }),
  /** A verified bill above this many times the run's quote is held for an admin instead of charged. */
  billAnomalyMultiple: z.number().min(1).max(1000).default(ROUTE_BILL_ANOMALY_MULTIPLE_DEFAULT),
  /**
   * Whether an unpaid part of a routed charge is ENFORCED: new paid runs are
   * blocked until it is paid, later funding repays it first, and an external
   * wallet is asked for its routed-debt contract. Off (the default): it is
   * recorded and alerted, and nothing else changes.
   */
  enforceUnpaidCharges: z.boolean().default(false),
})

export type VideoRoutePolicy = z.infer<typeof videoRoutePolicySchema>

/** The policy with nothing saved: every model on "default", no balance alerts. */
export function defaultVideoRoutePolicy(): VideoRoutePolicy {
  return {
    models: {},
    routeBalanceAlertUsd: null,
    defaultProviderBalanceAlertCredits: null,
    spendDriftAlertPercent: VIDEO_ROUTE_POLICY_DEFAULTS.spendDriftAlertPercent,
    failureAlert: { ...VIDEO_ROUTE_POLICY_DEFAULTS.failureAlert },
    billAnomalyMultiple: ROUTE_BILL_ANOMALY_MULTIPLE_DEFAULT,
    enforceUnpaidCharges: false,
  }
}

/** The multiple a bill is held above, from the stored policy (the default when none is saved). */
export function billAnomalyMultipleOf(policy: Pick<VideoRoutePolicy, "billAnomalyMultiple"> | null | undefined): number {
  const m = policy?.billAnomalyMultiple
  return typeof m === "number" && Number.isFinite(m) && m >= 1 ? m : ROUTE_BILL_ANOMALY_MULTIPLE_DEFAULT
}

/**
 * Whether a verified bill is far enough above its quote to be held: more than
 * `multiple` times the quote the run was held at (already scaled by its price
 * factor). A run with no positive quote to compare against is held too.
 */
export function routeBillAnomalous(billedUsd: number, quotedUsd: number | null | undefined, multiple: number): boolean {
  if (!(typeof quotedUsd === "number" && Number.isFinite(quotedUsd) && quotedUsd > 0)) return billedUsd > 0
  // (A hair of tolerance: a bill of exactly the multiple is not an anomaly, whatever the floats say.)
  return billedUsd > quotedUsd * multiple * (1 + 1e-9)
}

/** Whether unpaid routed charges are enforced (off unless an admin turned it on). */
export function unpaidChargesEnforced(policy: Pick<VideoRoutePolicy, "enforceUnpaidCharges"> | null | undefined): boolean {
  return policy?.enforceUnpaidCharges === true
}

/**
 * The stored row, read field by field so one bad entry never routes anything:
 * a model that is not routable, or an entry that does not parse, is dropped
 * (and so on "default"). Never throws; null for a value that is not an object.
 */
export function parseVideoRoutePolicy(value: unknown): VideoRoutePolicy | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const out = defaultVideoRoutePolicy()
  if (typeof raw.models === "object" && raw.models !== null && !Array.isArray(raw.models)) {
    for (const [model, entry] of Object.entries(raw.models as Record<string, unknown>)) {
      if (!isRoutableVideoModel(model)) continue
      const parsed = modelSettingSchema.safeParse(entry)
      if (parsed.success) out.models[model] = parsed.data
    }
  }
  const field = <K extends keyof VideoRoutePolicy>(key: K): void => {
    const parsed = videoRoutePolicySchema.shape[key].safeParse(raw[key])
    if (parsed.success) (out as Record<string, unknown>)[key] = parsed.data
  }
  field("routeBalanceAlertUsd")
  field("defaultProviderBalanceAlertCredits")
  field("spendDriftAlertPercent")
  field("failureAlert")
  field("billAnomalyMultiple")
  field("enforceUnpaidCharges")
  return out
}

/** The route `model` takes for `service`: the service's own choice, else the model's, else "default". */
export function videoRouteChoiceFor(policy: VideoRoutePolicy | null | undefined, model: string, service: string | undefined): VideoRouteChoice {
  const entry = policy?.models[model]
  if (!entry) return "default"
  const own = service !== undefined ? entry.services?.[service] : undefined
  return own ?? entry.route
}

/** Whether any model, for any service, is on the alternate route. */
export function anyModelRouted(policy: VideoRoutePolicy | null | undefined): boolean {
  if (!policy) return false
  return Object.values(policy.models).some((m) => m.route === "alternate" || Object.values(m.services ?? {}).includes("alternate"))
}

/** The policy with every model back on "default" (thresholds kept): the Admin page's "revert all". */
export function revertedVideoRoutePolicy(policy: VideoRoutePolicy | null | undefined): VideoRoutePolicy {
  return { ...(policy ?? defaultVideoRoutePolicy()), models: {} }
}

// ── Price correction factors ──

/** The kind of run a factor prices. */
export type VideoRoutePriceKind = "generate" | "draft-finalize" | "extend"

/** One factor: what a routed quote of its key is multiplied by. */
export const priceFactorSchema = z.strictObject({
  factor: z.number().min(1).max(10),
  updatedAt: z.string(),
  by: z.enum(["auto", "admin"]),
  /** Why it last changed (an automatic raise names its evidence). */
  reason: z.string().max(500).optional(),
})

export type VideoRoutePriceFactor = z.infer<typeof priceFactorSchema>

export type VideoRoutePriceFactors = Record<string, VideoRoutePriceFactor>

/** The most one automatic raise may move a factor (×1.25 at a time; an admin may set any value). */
export const PRICE_FACTOR_MAX_AUTO_STEP = 1.25

/** The highest a factor rises automatically; past it only an alert (and an admin) can move it. */
export const PRICE_FACTOR_MAX_AUTO = 2

/** The key of a factor: model, resolution, with or without a reference video, kind. */
export function priceFactorKey(args: { model: string; resolution: string | undefined; hasRefVideo: boolean; kind: VideoRoutePriceKind }): string {
  return `${args.model}:${args.resolution ?? "default"}:${args.hasRefVideo ? "ref" : "noref"}:${args.kind}`
}

/** The stored factors, entry by entry (a bad one dropped). Never throws. */
export function parseVideoRoutePriceFactors(value: unknown): VideoRoutePriceFactors {
  const out: VideoRoutePriceFactors = {}
  if (typeof value !== "object" || value === null || Array.isArray(value)) return out
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const parsed = priceFactorSchema.safeParse(entry)
    if (parsed.success) out[key] = parsed.data
  }
  return out
}

/** The factor for `key` (1 when none is stored). */
export function priceFactorOf(factors: VideoRoutePriceFactors | null | undefined, key: string): number {
  const f = factors?.[key]?.factor
  return typeof f === "number" && Number.isFinite(f) && f >= 1 ? f : 1
}

/**
 * The factor an observation moves `current` to, automatically: only up,
 * never down, at most one step (`PRICE_FACTOR_MAX_AUTO_STEP`) per raise.
 * `observedRatio` is what was billed ÷ what the route's own rule quoted
 * BEFORE any factor (or real spend ÷ recorded cost, times the current
 * factor): the factor that observation needs. Returns `current` when it asks
 * for no more than `current`.
 */
export function raisedPriceFactor(current: number, observedRatio: number): number {
  if (!Number.isFinite(observedRatio) || observedRatio <= current) return current
  // Never past the absolute ceiling automatically: beyond it a person decides (the caller alerts).
  if (current >= PRICE_FACTOR_MAX_AUTO) return current
  const wanted = Math.min(observedRatio, PRICE_FACTOR_MAX_AUTO)
  const capped = Math.min(wanted, current * PRICE_FACTOR_MAX_AUTO_STEP)
  // Kept to three decimals so a factor reads the same in the Admin page and the logs.
  return Math.max(current, Math.ceil(capped * 1000) / 1000)
}
