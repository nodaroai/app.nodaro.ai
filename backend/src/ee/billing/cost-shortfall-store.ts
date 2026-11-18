/**
 * The Supabase side of the cost-shortfall sweep (`cost-shortfall-sweep.ts`), and the
 * entry the billing cron calls (`runCostShortfallSweep`).
 *
 * Every read degrades to "nothing" and every write to "not done" on an error:
 * the sweep observes and must never fail anything. Before migration 666 is in
 * the database the anomaly insert is refused (the type and columns do not
 * exist yet), so nothing is recorded and nothing can be paused.
 */
import { supabase } from "../../lib/supabase.js"
import { getAppSettings, settingsReadFailed } from "../../lib/app-settings.js"
import { insertAppReport } from "../../lib/app-reports.js"
import { sideHoldChargesFor } from "../../lib/job-step-charge.js"
import { noteModelSwitch } from "../../lib/model-switch.js"
import { pricedAsId } from "../../lib/retired-price-id.js"
import { invalidateModelPricingCache } from "./credits.js"
import { wholeRequestQuoteOf } from "./whole-request-quotes.js"
import type { PauseCandidate } from "./cost-shortfall.js"
import {
  sweepCostShortfallJobs,
  type CostShortfallAnomalyRow,
  type CostShortfallStore,
  type CostShortfallSweepSummary,
  type ModelSwitchState,
  type SweepJob,
  type SweepUsageLog,
} from "./cost-shortfall-sweep.js"

/** Ids per `.in()` list (what the gateway reliably accepts). */
const IN_BATCH = 200
const ANOMALIES = "credit_anomalies" as "assets"
const COST_SHORTFALL = "cost_shortfall"

// The generated database types do not know the tables/columns this reads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (table: string): any => supabase.from(table as "assets")

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += IN_BATCH) out.push(items.slice(i, i + IN_BATCH))
  return out
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v
  return typeof n === "number" && Number.isFinite(n) ? n : null
}

/**
 * The `model_pricing` row that switches a run reserved under `action`: the
 * id it is priced as (a retired model's spelling runs as its successor), and
 * for a whole-request quote (`<rate>:<N>u`, a Voice Changer Pro convert…)
 * the row its guard checks — so every run of one model groups under one row.
 */
export function switchIdOf(action: string): string {
  const pricedAs = pricedAsId(action)
  try {
    return wholeRequestQuoteOf(pricedAs)?.gateRow ?? pricedAs
  } catch {
    return pricedAs
  }
}

export const supabaseCostShortfallStore: CostShortfallStore = {
  switchIdOf,

  async listJobs(sinceIso, from, size) {
    const { data, error } = await db("jobs")
      .select("id, user_id, usage_log_id, provider_cost, completed_at, provider")
      .eq("status", "completed")
      .gt("provider_cost", 0)
      .not("usage_log_id", "is", null)
      .gte("completed_at", sinceIso)
      .order("completed_at", { ascending: false })
      .range(from, from + size - 1)
    if (error) {
      console.warn(`[cost-shortfall] listing completed jobs failed: ${error.message}`)
      return []
    }
    const out: SweepJob[] = []
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const cost = num(row.provider_cost)
      if (typeof row.id !== "string" || typeof row.user_id !== "string" || typeof row.usage_log_id !== "string") continue
      if (cost === null || typeof row.completed_at !== "string") continue
      out.push({
        id: row.id,
        userId: row.user_id,
        usageLogId: row.usage_log_id,
        providerCostUsd: cost,
        completedAt: row.completed_at,
        provider: typeof row.provider === "string" ? row.provider : null,
      })
    }
    return out
  },

  async recordedJobIds(jobIds) {
    const out = new Set<string>()
    for (const ids of chunks(jobIds)) {
      const { data, error } = await db(ANOMALIES).select("job_id").eq("anomaly_type", COST_SHORTFALL).in("job_id", ids)
      if (error) {
        console.warn(`[cost-shortfall] reading recorded jobs failed: ${error.message}`)
        return null
      }
      for (const row of (data ?? []) as Array<{ job_id?: string | null }>) if (row.job_id) out.add(row.job_id)
    }
    return out
  },

  async usageLogs(ids) {
    const out = new Map<string, SweepUsageLog>()
    for (const batch of chunks([...new Set(ids)])) {
      const { data, error } = await db("usage_logs")
        .select("id, status, credits_used, credits_charged, action, provider")
        .in("id", batch)
      if (error) {
        console.warn(`[cost-shortfall] reading usage logs failed: ${error.message}`)
        return null
      }
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        if (typeof row.id !== "string") continue
        out.set(row.id, {
          status: typeof row.status === "string" ? row.status : null,
          credits_used: num(row.credits_used),
          credits_charged: num(row.credits_charged),
          action: typeof row.action === "string" ? row.action : null,
          provider: typeof row.provider === "string" ? row.provider : null,
        })
      }
    }
    return out
  },

  sideCharges: (jobIds) => sideHoldChargesFor(jobIds),

  async sharedUsageLogIds(usageLogIds) {
    const shared = new Set<string>()
    for (const batch of chunks([...new Set(usageLogIds)])) {
      const { data, error } = await db("jobs").select("id, usage_log_id").in("usage_log_id", batch)
      if (error) {
        console.warn(`[cost-shortfall] reading usage-log sharing failed: ${error.message}`)
        return null
      }
      const seen = new Map<string, number>()
      for (const row of (data ?? []) as Array<{ usage_log_id?: string | null }>) {
        if (!row.usage_log_id) continue
        seen.set(row.usage_log_id, (seen.get(row.usage_log_id) ?? 0) + 1)
      }
      for (const [id, count] of seen) if (count > 1) shared.add(id)
    }
    return shared
  },

  async insertAnomaly(row: CostShortfallAnomalyRow) {
    try {
      const { error } = await db(ANOMALIES).insert({ ...row, anomaly_type: COST_SHORTFALL, status: "pending" })
      if (!error) return "inserted"
      // 23505: the job already has its cost-shortfall row (another process got there first).
      if (error.code === "23505") return "duplicate"
      console.warn(`[cost-shortfall] recording job ${row.job_id} failed: ${error.message}`)
      return "failed"
    } catch (err) {
      console.warn(`[cost-shortfall] recording job ${row.job_id} failed:`, err)
      return "failed"
    }
  },

  async costShortfallJobs(modelSwitchId, sinceIso) {
    const { data, error } = await db(ANOMALIES)
      .select("job_id, job_completed_at, credits_estimated, credits_actual")
      .eq("anomaly_type", COST_SHORTFALL)
      .eq("model_switch_id", modelSwitchId)
      .gte("job_completed_at", sinceIso)
      .order("job_completed_at", { ascending: true })
      .limit(1000)
    if (error) {
      console.warn(`[cost-shortfall] reading ${modelSwitchId}'s cost-shortfall jobs failed: ${error.message}`)
      return []
    }
    const out: PauseCandidate[] = []
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const charged = num(row.credits_actual)
      const providerCredits = num(row.credits_estimated)
      const at = typeof row.job_completed_at === "string" ? Date.parse(row.job_completed_at) : NaN
      if (typeof row.job_id !== "string" || charged === null || providerCredits === null || !Number.isFinite(at)) continue
      out.push({ jobId: row.job_id, completedAtMs: at, chargedCredits: charged, costCredits: providerCredits })
    }
    return out
  },

  async alertedSince(kind, modelSwitchId, sinceIso) {
    const { data, error } = await db("app_reports")
      .select("id")
      .eq("kind", kind)
      .eq("payload->>modelSwitchId", modelSwitchId)
      .gte("created_at", sinceIso)
      .limit(1)
    // Unknown: say "already alerted" — a missed alert is filed next window, a flood is not undone.
    if (error) return true
    return (data ?? []).length > 0
  },

  report: (input) => insertAppReport(input),

  async readSwitch(modelSwitchId): Promise<ModelSwitchState> {
    const { data, error } = await db("model_pricing")
      .select("is_enabled, switched_on_at")
      .eq("model_identifier", modelSwitchId)
      .maybeSingle()
    if (error) return { kind: "unreadable" }
    if (!data) return { kind: "missing" }
    const row = data as { is_enabled?: boolean | null; switched_on_at?: string | null }
    return { kind: "row", enabled: row.is_enabled !== false, switchedOnAt: row.switched_on_at ?? null }
  },

  async switchOff(modelSwitchId) {
    const { data, error } = await db("model_pricing")
      .update({ is_enabled: false, updated_at: new Date().toISOString() })
      .eq("model_identifier", modelSwitchId)
      // On, or never set (the column defaults to true and allows NULL).
      .not("is_enabled", "is", false)
      .select("model_identifier")
    if (error) {
      console.error(`[cost-shortfall] switching off ${modelSwitchId} failed: ${error.message}`)
      return false
    }
    if ((data ?? []).length === 0) return false
    // This process refuses and hides the model at once; the others within
    // their caches' 60 s.
    invalidateModelPricingCache()
    noteModelSwitch(modelSwitchId, false)
    return true
  },

  async autoPauseEnabled() {
    const settings = await getAppSettings()
    // Settings that could not be read are not a yes: an admin may have turned it off.
    return !settingsReadFailed(settings) && settings.cost_shortfall_auto_pause_enabled
  },
}

/** One sweep tick (the billing cron). Never throws. */
export async function runCostShortfallSweep(): Promise<CostShortfallSweepSummary | null> {
  try {
    return await sweepCostShortfallJobs(supabaseCostShortfallStore)
  } catch (err) {
    console.error("[cost-shortfall] sweep failed:", err)
    return null
  }
}
