import { getAuthHeaders } from "@/lib/api"

/** Admin → Video route (`/v1/admin/video-route`, backend/src/ee/routes/admin-video-route.ts). */
export type VideoRouteChoice = "default" | "alternate"

export interface VideoRoutePolicy {
  models: Record<string, { route: VideoRouteChoice; services?: Record<string, VideoRouteChoice> }>
  routeBalanceAlertUsd: number | null
  defaultProviderBalanceAlertCredits: number | null
  spendDriftAlertPercent: number
  failureAlert: { failures: number; windowMinutes: number }
  /** A verified bill above this many times the run's quote is held for an admin instead of charged. */
  billAnomalyMultiple: number
  /** Whether an unpaid part of a routed charge blocks new paid runs and is repaid from later funding. Off: recorded and alerted only. */
  enforceUnpaidCharges: boolean
  /**
   * What the route's shared account is known to spend per UTC day on work this platform never records
   * (another user of the same account), in USD (0 to 1,000,000; 0: nothing allowed for). The daily account
   * check takes it off the account's spend before it alerts that the account spent more than everything
   * recorded. An allowance the owner sets from what they know.
   */
  accountOtherSpendUsdPerDay: number
}

/** One UTC day of the daily account check: the route's whole account against everything every environment recorded. */
export interface VideoRouteAccountDay {
  /** YYYY-MM-DD (UTC). */
  day: string
  /** `pending`: the account's spend for the day could not be read yet (it is retried). `unmeasured`: it could not be read while the route still reported that day. */
  status: "measured" | "pending" | "unmeasured"
  /** What the route's account spent that whole UTC day. */
  actualUsd: number | null
  /** Every environment's verified bills the route billed that day. */
  ledgerUsd: number
  /** The same, per environment. */
  byEnv: Record<string, number>
  /** Delivered sends with no bill yet, at the route's estimate. */
  pendingUsd: number
  /** Delivered sends with no bill and no estimate. */
  unpricedSends: number
  /** Alternate-route jobs with no routing decision: their recorded cost. */
  unroutedUsd: number
  unroutedJobs: number
  /** The other-spend allowance applied that day (`accountOtherSpendUsdPerDay`). */
  otherSpendUsd: number
  /** The part of the day's difference offset by the neighbouring day (runs that straddle midnight). */
  straddleUsd: number
  /** What the account spent beyond everything recorded (after the allowance and the straddle); null without an account figure. */
  unrecordedUsd: number | null
  /** What was recorded beyond the account's spend (after the straddle); null without an account figure. */
  overRecordedUsd: number | null
  toleranceUsd: number
  /** The pass day this day's gap was first seen past the tolerance (alerts wait for a later pass). */
  unrecordedSince?: string
  overRecordedSince?: string
  alerted?: { unrecordedUsd?: number; overRecordedUsd?: number }
  /** The environment that ran the check. */
  env: string
  /** When the check ran (ISO time). */
  at: string
}

/** A settlement held because its verified bill is far above its quote. */
export interface VideoRouteHold {
  jobId: string
  /** `anomaly`: its bill is far above its quote. `unbilled`: the route never reported a bill. */
  kind: "anomaly" | "unbilled"
  /** The charge the bill comes to, in credits (taken in full on a confirm). */
  credits: number | null
  billedUsd: number | null
  quotedUsd: number | null
  note: string | null
  heldAt: string
  /** What a charge would take right now: the real bill of every billed send plus the quote of every unbilled one. Null: not computable yet. */
  wouldCharge: number | null
  /** What a release records as the loss right now: the route's bill for its sends (the quote where not billed yet), base credits, no markup or fees. Null: not computable yet. */
  wouldLose: number | null
  /** That total is itself far above the quote: settling at the quote would hold it for its own confirmation instead of charging it. */
  totalAnomalous: boolean
}

export interface VideoRoutePriceFactor {
  factor: number
  updatedAt: string
  by: "auto" | "admin"
  reason?: string
}

export interface VideoRouteView {
  policy: VideoRoutePolicy
  updatedAt: string | null
  route: { present: boolean; v2: boolean }
  models: Array<{ id: string; name: string; capable: boolean }>
  services: { platform: string[]; plugin: string[] }
  /** Whether this build runs routed jobs; a model can be put on the alternate route only when it does. */
  routesPerModel: boolean
  prices: Record<string, Array<{ id: string; base: number; charged: number; defaultCharged: number | null }>>
  factors: Record<string, VideoRoutePriceFactor>
  factorsUpdatedAt: string | null
  /** The last 7 days: accepted requests, refusals, and historical default-route outcomes. */
  outcomes: Array<{ model: string; service: string; alternate: number; kept: Record<string, number>; refused: Record<string, number> }>
  balances: { route: { availableUsd: number; heldUsd: number; observedAt: string } | null; defaultProviderCredits: number | null }
  /** Newest first: the recorded cost of a day's routed jobs against the route's own spend that day. */
  alerts: Array<{ key: string; kind: string; message: string; jobId?: string; model?: string; createdAt: string; updatedAt: string }>
  holds: VideoRouteHold[]
  /** What the loaded route takes today with no setting saved; null when it does not say. */
  legacyRouting: Array<{ model: string; service: string }> | null
  /** Entries the route reported that this server does not recognise: they cannot be kept and move to the default provider at the first save. */
  legacyRoutingUnrecognised: Array<{ model: string; service: string }>
  /** Whether unpaid-charge enforcement can be turned on here. */
  environmentNameable: boolean
  /** On the answer to a decision only: whether the settlement applied it already (else its next run does). */
  decided?: { jobId: string; decision: "confirmed" | "rejected" | "quote"; settled: boolean; chargedCredits: number | null; heldForTotal?: boolean }
  spendDays: Array<{
    day: string
    recordedUsd: number
    /** Routed jobs that failed after the route billed them (refunded): known losses. */
    lossesUsd: number
    actualUsd: number | null
    videoSeconds: number | null
    /** What the route's SHARED account spent beyond this environment's ledger: context only, never attributed here. */
    unexplainedUsd: number | null
    /** What this environment's ledger recorded beyond the whole account's spend: context only (the account check alerts it, against every environment's bills). */
    overRecordedUsd?: number | null
    jobs: number
    failedJobs: number
    at: string
  }>
  /** Newest first (up to 30): the route's whole account, checked once a day for every environment together. */
  accountDays: VideoRouteAccountDay[]
}

const PATH = "/v1/admin/video-route"

/** A request the server refused. A refusal that knows the page's current state carries it (`view`), so the page shows it at once. */
export class VideoRouteRefused extends Error {
  constructor(message: string, readonly status: number, readonly code: string | undefined, readonly view: VideoRouteView | undefined) {
    super(message)
    this.name = "VideoRouteRefused"
  }
}

async function send(url: string, init: RequestInit, fallback: string): Promise<VideoRouteView> {
  const res = await fetch(url, { ...init, headers: { ...(await getAuthHeaders()), ...(init.body ? { "Content-Type": "application/json" } : {}) } })
  const body = (await res.json().catch(() => null)) as { data?: VideoRouteView; error?: { code?: string; message?: string } } | null
  if (!res.ok || !body?.data) throw new VideoRouteRefused(body?.error?.message ?? fallback, res.status, body?.error?.code, res.ok ? undefined : body?.data)
  return body.data
}

export function fetchVideoRoute(): Promise<VideoRouteView> {
  return send(PATH, { method: "GET" }, "Could not load the video route setting")
}

/** Saves the policy as edited on the page read at `expectedUpdatedAt` (a newer one is refused: reload). */
export function saveVideoRoutePolicy(args: { policy: VideoRoutePolicy; expectedUpdatedAt: string | null }): Promise<VideoRouteView> {
  return send(PATH, { method: "PUT", body: JSON.stringify(args) }, "Could not save the video route setting")
}

export function revertVideoRoutePolicy(): Promise<VideoRouteView> {
  return send(`${PATH}/revert`, { method: "POST" }, "Could not revert the video route setting")
}

/** Saves the whole factor table, as edited on the table read at `expectedUpdatedAt` (a newer one is refused: reload). */
export function saveVideoRouteFactors(args: { factors: Record<string, { factor: number; reason?: string }>; expectedUpdatedAt: string | null }): Promise<VideoRouteView> {
  return send(`${PATH}/factors`, { method: "PUT", body: JSON.stringify(args) }, "Could not save the price factors")
}

/**
 * Confirms (charges in full) or rejects (releases the hold, a recorded loss) a held settlement.
 * A confirm or a settle-at-quote states the total the admin was shown (`expectedChargedCredits`):
 * the server decides nothing when the total is no longer that one.
 */
export function decideVideoRouteHold(args: { jobId: string; decision: "confirm" | "quote" | "reject"; expectedChargedCredits?: number }): Promise<VideoRouteView> {
  return send(`${PATH}/holds/${encodeURIComponent(args.jobId)}`, { method: "POST", body: JSON.stringify({ decision: args.decision, ...(args.expectedChargedCredits !== undefined ? { expectedChargedCredits: args.expectedChargedCredits } : {}) }) }, "Could not decide the held settlement")
}

/** `policy` with each model and service the route takes today set to the alternate route (a first save's starting point). */
export function withLegacyRouting(policy: VideoRoutePolicy, legacy: VideoRouteView["legacyRouting"]): VideoRoutePolicy {
  if (!legacy || legacy.length === 0) return policy
  const models = { ...policy.models }
  for (const { model, service } of legacy) {
    const entry = models[model] ?? { route: "default" as const }
    models[model] = { ...entry, services: { ...(entry.services ?? {}), [service]: "alternate" } }
  }
  return { ...policy, models }
}

