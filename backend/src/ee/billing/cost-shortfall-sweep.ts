/**
 * COST-SHORTFALL SWEEP (Cloud only) — reads completed jobs back after settlement,
 * records the ones charged less than its provider cost, alerts, and switches off a model that
 * keeps losing money.
 *
 * WHY A SWEEP AND NOT A HOOK. Completion and settlement have no single place
 * where both the provider cost and the final charge are known: media lanes
 * complete through `markJobCompleted` and settle afterwards through one of
 * several commits (`commitJobCredits`, the charged-price settles, the managed
 * `job-once` settle, the metered LLM settle), and the text lanes write their
 * own completed rows in-route (see `job-policy-result-totality.test.ts`). A
 * hook on any one of those would miss the others, and a hook at completion
 * runs before the charge is settled. Every one of them ends in the same rows,
 * though: `jobs.provider_cost` and the job's usage log once it is committed.
 * Reading those back covers every lane, a new one included, with nothing to
 * register — at the price of a few minutes' delay (`COST_SHORTFALL_SWEEP`).
 *
 * The sweep only reads and records; it never touches a job or a charge. Every
 * write it makes is idempotent across processes (staging and production share
 * one database, and both run it):
 *   - one `credit_anomalies` row per job (a unique index on cost-shortfall rows);
 *   - the pause is a compare-and-set on the model's switch, so only the
 *     process that flips it files the pause alert.
 *
 * Storage is behind `CostShortfallStore` so the rules here are tested without a
 * database; `cost-shortfall-store.ts` is the Supabase implementation.
 */
import type { AppReportInput } from "../../lib/app-reports.js"
import {
  COST_SHORTFALL_RULE,
  COST_SHORTFALL_SWEEP,
  judgeCostShortfall,
  pauseWindow,
  type PauseCandidate,
} from "./cost-shortfall.js"

/** A completed job with a provider cost, as the sweep lists it. */
export interface SweepJob {
  id: string
  userId: string
  usageLogId: string
  providerCostUsd: number
  completedAt: string
  provider: string | null
}

/** A usage log as the sweep reads it. */
export interface SweepUsageLog {
  status: string | null
  credits_used: number | null
  credits_charged: number | null
  /** The model identifier the run reserved under (`usage_logs.action`). */
  action: string | null
  provider: string | null
}

/** The `credit_anomalies` row a cost-shortfall job writes. */
export interface CostShortfallAnomalyRow {
  job_id: string
  user_id: string
  usage_log_id: string
  model_identifier: string
  /** The `model_pricing` row that switches this run on and off. */
  model_switch_id: string
  provider: string | null
  /** The provider cost in credits (its USD converted, no markup). */
  credits_estimated: number
  /** Credits charged. */
  credits_actual: number
  /** Provider cost in credits minus charged. */
  diff: number
  provider_cost_usd: number
  job_completed_at: string
}

/** A model's switch (`model_pricing.is_enabled`) as the pause reads it. */
export type ModelSwitchState =
  | { kind: "missing" }
  | { kind: "unreadable" }
  | { kind: "row"; enabled: boolean; switchedOnAt: string | null }

export interface CostShortfallStore {
  /** Completed jobs with a provider cost > 0 and a usage log, completed since `sinceIso`, newest first. */
  listJobs(sinceIso: string, from: number, size: number): Promise<SweepJob[]>
  /**
   * Which of these jobs already have a cost-shortfall row. Null when the read
   * failed (as for every read below that can answer null): the page is then
   * left for the next tick, and no job of it is judged or remembered.
   */
  recordedJobIds(jobIds: readonly string[]): Promise<Set<string> | null>
  usageLogs(ids: readonly string[]): Promise<Map<string, SweepUsageLog> | null>
  /** Settled side-hold charges per job (`lib/job-step-charge.ts`). */
  sideCharges(jobIds: readonly string[]): Promise<ReadonlyMap<string, number>>
  /** Usage logs that more than one job points at. */
  sharedUsageLogIds(usageLogIds: readonly string[]): Promise<Set<string> | null>
  insertAnomaly(row: CostShortfallAnomalyRow): Promise<"inserted" | "duplicate" | "failed">
  /** The model row's recorded cost-shortfall jobs completed since `sinceIso`. */
  costShortfallJobs(modelSwitchId: string, sinceIso: string): Promise<PauseCandidate[]>
  /** Was an alert of `kind` for this model row filed since `sinceIso`? */
  alertedSince(kind: string, modelSwitchId: string, sinceIso: string): Promise<boolean>
  report(input: AppReportInput): Promise<boolean>
  readSwitch(modelSwitchId: string): Promise<ModelSwitchState>
  /** Compare-and-set: switch the row off only if it is on. True when THIS call switched it off. */
  switchOff(modelSwitchId: string): Promise<boolean>
  /** The admin switch for automatic pausing (`cost_shortfall_auto_pause_enabled`). */
  autoPauseEnabled(): Promise<boolean>
  /** The `model_pricing` row that switches a run reserved under `action`. */
  switchIdOf(action: string): string
}

/** `app_reports` kinds this sweep files. */
export const COST_SHORTFALL_REPORT_KINDS = {
  /** Jobs of one model were charged less than its provider cost (throttled per model). */
  costShortfall: "cost-shortfall-job",
  /** A losing model was switched off automatically. */
  paused: "model-auto-paused",
  /** A losing model met the pause rule but has no pricing row to switch off. */
  pauseImpossible: "model-auto-pause-failed",
} as const

const REPORT_NODE = "cost-shortfall-sweep"
const SAMPLE_JOBS = 5

export interface CostShortfallSweepSummary {
  scanned: number
  recorded: number
  alerted: number
  paused: string[]
}

/**
 * Jobs this process already judged settled (covered or recorded). A committed
 * charge does not change, so a later tick skips them without reading their
 * usage log again. Bounded: cleared whole when it grows past the cap.
 */
const judged = new Set<string>()
const JUDGED_CAP = 50_000

export function __resetCostShortfallSweepForTests(): void {
  judged.clear()
}

interface NewLoss {
  jobId: string
  modelIdentifier: string
  provider: string | null
}

export async function sweepCostShortfallJobs(store: CostShortfallStore, now: Date = new Date()): Promise<CostShortfallSweepSummary> {
  const summary: CostShortfallSweepSummary = { scanned: 0, recorded: 0, alerted: 0, paused: [] }
  const since = new Date(now.getTime() - COST_SHORTFALL_SWEEP.lookbackMinutes * 60_000).toISOString()
  const newLosses = new Map<string, NewLoss[]>()

  for (let page = 0; page < COST_SHORTFALL_SWEEP.maxPages; page++) {
    const jobs = await store.listJobs(since, page * COST_SHORTFALL_SWEEP.pageSize, COST_SHORTFALL_SWEEP.pageSize)
    summary.scanned += jobs.length
    const fresh = jobs.filter((j) => !judged.has(j.id))
    if (fresh.length > 0) await judgePage(store, fresh, newLosses, summary)
    if (jobs.length < COST_SHORTFALL_SWEEP.pageSize) break
  }

  for (const [modelSwitchId, losses] of newLosses) {
    if (await alertCostShortfall(store, modelSwitchId, losses, now)) summary.alerted += 1
    if (await maybePause(store, modelSwitchId, losses, now)) summary.paused.push(modelSwitchId)
  }
  return summary
}

async function judgePage(
  store: CostShortfallStore,
  jobs: readonly SweepJob[],
  newLosses: Map<string, NewLoss[]>,
  summary: CostShortfallSweepSummary,
): Promise<void> {
  const recorded = await store.recordedJobIds(jobs.map((j) => j.id))
  // A failed read decides nothing: never a job judged on a missing figure,
  // and never one remembered as judged on it.
  if (!recorded) return
  const open = jobs.filter((j) => {
    if (!recorded.has(j.id)) return true
    remember(j.id)
    return false
  })
  if (open.length === 0) return
  const usageLogIds = open.map((j) => j.usageLogId)
  const [logs, side, shared] = await Promise.all([
    store.usageLogs(usageLogIds),
    store.sideCharges(open.map((j) => j.id)),
    store.sharedUsageLogIds(usageLogIds),
  ])
  if (!logs || !shared) return
  for (const job of open) {
    const log = logs.get(job.usageLogId) ?? null
    const verdict = judgeCostShortfall({
      providerCostUsd: job.providerCostUsd,
      usageLog: log,
      sideCharged: side.get(job.id) ?? 0,
      sharedUsageLog: shared.has(job.usageLogId),
    })
    if (verdict.kind === "skip") {
      // A hold still open is read again next tick; every other skip is final.
      if (verdict.reason !== "settlement_pending") remember(job.id)
      continue
    }
    if (verdict.kind === "covered") {
      remember(job.id)
      continue
    }
    const modelIdentifier = log?.action ?? "unknown"
    const modelSwitchId = store.switchIdOf(modelIdentifier)
    const provider = log?.provider && log.provider !== "reserved" ? log.provider : job.provider
    const outcome = await store.insertAnomaly({
      job_id: job.id,
      user_id: job.userId,
      usage_log_id: job.usageLogId,
      model_identifier: modelIdentifier,
      model_switch_id: modelSwitchId,
      provider,
      credits_estimated: verdict.costCredits,
      credits_actual: verdict.chargedCredits,
      diff: verdict.shortfallCredits,
      provider_cost_usd: job.providerCostUsd,
      job_completed_at: job.completedAt,
    })
    // A failed write is tried again next tick; never acted on.
    if (outcome === "failed") continue
    remember(job.id)
    if (outcome !== "inserted") continue
    summary.recorded += 1
    console.warn(
      `[cost-shortfall] job ${job.id} charged ${verdict.chargedCredits} credits, provider cost ${verdict.costCredits} credits (model ${modelIdentifier})`,
    )
    const list = newLosses.get(modelSwitchId) ?? []
    list.push({ jobId: job.id, modelIdentifier, provider })
    newLosses.set(modelSwitchId, list)
  }
}

function remember(jobId: string): void {
  if (judged.size >= JUDGED_CAP) judged.clear()
  judged.add(jobId)
}

const windowStart = (now: Date) => new Date(now.getTime() - COST_SHORTFALL_RULE.windowMinutes * 60_000).toISOString()

/**
 * One alert per model row per window, carrying how many of its jobs were
 * charged less than its provider cost in that window. A later tick inside the window files
 * nothing for the same model; the rows themselves stay on the Credit
 * Anomalies page.
 */
async function alertCostShortfall(store: CostShortfallStore, modelSwitchId: string, losses: readonly NewLoss[], now: Date): Promise<boolean> {
  const since = windowStart(now)
  if (await store.alertedSince(COST_SHORTFALL_REPORT_KINDS.costShortfall, modelSwitchId, since)) return false
  const inWindow = await store.costShortfallJobs(modelSwitchId, since)
  const count = Math.max(inWindow.length, losses.length)
  const identifiers = [...new Set(losses.map((l) => l.modelIdentifier))]
  return store.report({
    node: REPORT_NODE,
    kind: COST_SHORTFALL_REPORT_KINDS.costShortfall,
    severity: "warning",
    title: `Charged less than provider cost: ${modelSwitchId} — ${count} job${count === 1 ? "" : "s"} in the last ${COST_SHORTFALL_RULE.windowMinutes} min`,
    payload: {
      modelSwitchId,
      modelIdentifiers: identifiers,
      provider: losses[0]?.provider ?? null,
      jobsCostShortfall: count,
      windowMinutes: COST_SHORTFALL_RULE.windowMinutes,
      sampleJobIds: (inWindow.length > 0 ? inWindow.map((c) => c.jobId) : losses.map((l) => l.jobId)).slice(0, SAMPLE_JOBS),
    },
  })
}

/**
 * Switch a model off when the pause rule is met (`COST_SHORTFALL_RULE`). Reads
 * only recorded rows, i.e. settled jobs, so a job whose settlement is still
 * open can never pause anything. Asked only for a model that just gained a
 * row, so jobs already behind a pause never trigger one on their own.
 */
async function maybePause(store: CostShortfallStore, modelSwitchId: string, losses: readonly NewLoss[], now: Date): Promise<boolean> {
  if (!(await store.autoPauseEnabled())) return false
  const state = await store.readSwitch(modelSwitchId)
  // Unreadable (or the switched-on column not there yet): never pause blind.
  if (state.kind === "unreadable") return false
  if (state.kind === "row" && !state.enabled) return false
  const reach = COST_SHORTFALL_SWEEP.lookbackMinutes + COST_SHORTFALL_RULE.windowMinutes
  const candidates = await store.costShortfallJobs(modelSwitchId, new Date(now.getTime() - reach * 60_000).toISOString())
  const floorMs = state.kind === "row" && state.switchedOnAt ? Date.parse(state.switchedOnAt) : null
  const hit = pauseWindow(candidates, Number.isFinite(floorMs) ? floorMs : null)
  if (!hit) return false
  const identifiers = [...new Set(losses.map((l) => l.modelIdentifier))]
  const why = {
    modelSwitchId,
    modelIdentifiers: identifiers,
    jobsCostShortfall: hit.length,
    windowMinutes: COST_SHORTFALL_RULE.windowMinutes,
    rule: { ...COST_SHORTFALL_RULE },
    sampleJobIds: hit.map((c) => c.jobId).slice(0, SAMPLE_JOBS),
    firstCompletedAt: new Date(hit[0]!.completedAtMs).toISOString(),
    lastCompletedAt: new Date(hit[hit.length - 1]!.completedAtMs).toISOString(),
  }
  if (state.kind === "missing") {
    // No pricing row to switch: say so, once per window, and pause nothing.
    if (await store.alertedSince(COST_SHORTFALL_REPORT_KINDS.pauseImpossible, modelSwitchId, windowStart(now))) return false
    await store.report({
      node: REPORT_NODE,
      kind: COST_SHORTFALL_REPORT_KINDS.pauseImpossible,
      severity: "error",
      title: `Losing money and NOT paused: ${modelSwitchId} has no pricing row to switch off — switch it off by hand`,
      payload: why,
    })
    return false
  }
  if (!(await store.switchOff(modelSwitchId))) return false
  console.error(`[cost-shortfall] switched off ${modelSwitchId}: ${hit.length} jobs charged under half their cost within ${COST_SHORTFALL_RULE.windowMinutes} min`)
  await store.report({
    node: REPORT_NODE,
    kind: COST_SHORTFALL_REPORT_KINDS.paused,
    severity: "error",
    title: `Model switched off automatically: ${modelSwitchId} — ${hit.length} jobs charged under half their cost within ${COST_SHORTFALL_RULE.windowMinutes} min. Switch it back on at Admin → Models once its price is fixed.`,
    payload: why,
  })
  return true
}
