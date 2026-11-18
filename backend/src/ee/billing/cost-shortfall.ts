/**
 * COST-SHORTFALL CHECK — the pure rules (Cloud only).
 *
 * A completed job whose settled charge is below what the provider billed us
 * for it (the provider's USD converted to credits, no markup), is a
 * loss on that run. Nothing used to compare the two outside the metered
 * true-up in `commitJobCredits`, so a flat-priced model whose provider bills
 * by GPU time could lose money on every run without anyone noticing.
 *
 * The check reads the job back from the database AFTER settlement
 * (`cost-shortfall-sweep.ts`), so it covers every lane that records a provider
 * cost, whichever way it completed and settled. This file holds only the
 * decisions, so they are tested without a database:
 *   - `judgeCostShortfall`: is one job short of its provider cost, or why it is skipped;
 *   - `pauseWindow`: are there enough cost-shortfall jobs close together to
 *     switch the model off.
 *
 * Every threshold lives in `COST_SHORTFALL_RULE` / `COST_SHORTFALL_SWEEP`.
 */
import { usdToCredits } from "@nodaro/shared/credits"
import { settledCharge, type UsageAmountRow } from "../../lib/usage-amount.js"
import { anomalyToleranceCredits } from "./credit-anomaly.js"

/** When a losing model is switched off automatically. */
export const COST_SHORTFALL_RULE = {
  /** This many cost-shortfall jobs of one model… */
  pauseAfterJobs: 5,
  /** …completed within this many minutes of each other… */
  windowMinutes: 60,
  /** …each charged less than this share of its provider cost in credits (under half). */
  maxChargedShareOfCost: 0.5,
} as const

/** How the sweep reads completed jobs back. */
export const COST_SHORTFALL_SWEEP = {
  /** The sweep runs every this many minutes (`cleanup-cron.ts`). */
  everyMinutes: 5,
  /**
   * Jobs completed this far back are read. Settlement normally lands within
   * seconds of completion; the margin covers a settle that is retried or a
   * sweep tick that was missed. A job older than this is never read, so the
   * first sweep after a deploy cannot act on an old backlog.
   */
  lookbackMinutes: 180,
  /** Jobs per page, and pages per tick at most. */
  pageSize: 500,
  maxPages: 6,
} as const

/** One job as the check reads it back after settlement. */
export interface CostShortfallJob {
  /** `jobs.provider_cost`: what the provider billed for this job, in USD. */
  providerCostUsd: number | null | undefined
  /** The job's own usage log (`jobs.usage_log_id`); null when it has none. */
  usageLog: (UsageAmountRow & { credits_used?: number | null }) | null
  /** What the job's settled metered side holds charged (0 with none). */
  sideCharged: number
  /** True when another job points at the same usage log: its charge is not this job's alone. */
  sharedUsageLog: boolean
}

export type CostShortfallSkipReason =
  | "no_provider_cost"
  | "no_usage_log"
  | "settlement_pending"
  | "refunded"
  | "free_by_design"
  | "shared_usage_log"

export type CostShortfallVerdict =
  | { kind: "skip"; reason: CostShortfallSkipReason }
  | { kind: "covered"; chargedCredits: number; costCredits: number }
  | {
      kind: "cost_shortfall"
      chargedCredits: number
      costCredits: number
      /** Provider cost in credits minus charged (always positive). */
      shortfallCredits: number
      /** Charged under `maxChargedShareOfCost` of the cost: the job counts toward a pause. */
      countsTowardPause: boolean
    }

/**
 * Is this job charged less than its provider cost? Skips, in order: no provider cost (or ≤ 0), no
 * usage log, a hold still open (never judged before it settles), a refund, a
 * run free by design (a zero-priced model reserves 0 credits), and a usage
 * log shared with another job. A shortfall within the anomaly tolerance
 * (`anomalyToleranceCredits`, the same $0.02 the reserve-vs-actual check
 * ignores) is rounding, not a loss.
 */
export function judgeCostShortfall(job: CostShortfallJob): CostShortfallVerdict {
  const cost = job.providerCostUsd
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost <= 0) return { kind: "skip", reason: "no_provider_cost" }
  const log = job.usageLog
  if (!log) return { kind: "skip", reason: "no_usage_log" }
  if (log.status === "refunded") return { kind: "skip", reason: "refunded" }
  if (log.status !== "committed") return { kind: "skip", reason: "settlement_pending" }
  if ((log.credits_used ?? 0) <= 0) return { kind: "skip", reason: "free_by_design" }
  if (job.sharedUsageLog) return { kind: "skip", reason: "shared_usage_log" }

  const own = settledCharge(log) ?? 0
  const chargedCredits = own + Math.max(0, job.sideCharged)
  const costCredits = usdToCredits(cost)
  const shortfallCredits = costCredits - chargedCredits
  if (shortfallCredits <= anomalyToleranceCredits()) return { kind: "covered", chargedCredits, costCredits }
  return {
    kind: "cost_shortfall",
    chargedCredits,
    costCredits,
    shortfallCredits,
    countsTowardPause: chargedCredits < costCredits * COST_SHORTFALL_RULE.maxChargedShareOfCost,
  }
}

/** One recorded cost-shortfall job, as the pause rule reads it. */
export interface PauseCandidate {
  jobId: string
  /** When the job completed (ms since the epoch). */
  completedAtMs: number
  chargedCredits: number
  costCredits: number
}

/** Does a recorded job count toward a pause (charged under half its cost)? */
export function countsTowardPause(c: Pick<PauseCandidate, "chargedCredits" | "costCredits">): boolean {
  return c.chargedCredits < c.costCredits * COST_SHORTFALL_RULE.maxChargedShareOfCost
}

/**
 * The first window of `windowMinutes` holding `pauseAfterJobs` counting jobs,
 * or null. Only jobs completed after `floorMs` count — the moment the model
 * was last switched on — so the jobs behind an earlier pause, and any that
 * finished while it was off, can never pause it again once an admin lifts it.
 */
export function pauseWindow(
  candidates: readonly PauseCandidate[],
  floorMs: number | null,
): PauseCandidate[] | null {
  const windowMs = COST_SHORTFALL_RULE.windowMinutes * 60_000
  const counted = candidates
    .filter((c) => countsTowardPause(c) && Number.isFinite(c.completedAtMs) && (floorMs === null || c.completedAtMs > floorMs))
    .sort((a, b) => a.completedAtMs - b.completedAtMs)
  const need = COST_SHORTFALL_RULE.pauseAfterJobs
  for (let end = need - 1; end < counted.length; end++) {
    const start = end - need + 1
    if (counted[end]!.completedAtMs - counted[start]!.completedAtMs <= windowMs) return counted.slice(start, end + 1)
  }
  return null
}
