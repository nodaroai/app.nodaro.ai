import { describe, it, expect, beforeEach } from "vitest"
import { usdToCredits } from "@nodaro/shared/credits"
import type { AppReportInput } from "../../../lib/app-reports.js"
import {
  COST_SHORTFALL_REPORT_KINDS,
  __resetCostShortfallSweepForTests,
  sweepCostShortfallJobs,
  type CostShortfallAnomalyRow,
  type CostShortfallStore,
  type ModelSwitchState,
  type SweepJob,
  type SweepUsageLog,
} from "../cost-shortfall-sweep.js"
import { COST_SHORTFALL_RULE } from "../cost-shortfall.js"

const MODEL = "lipsync-model-a"
const minute = 60_000
const T0 = Date.parse("2026-11-18T10:00:00Z")
const at = (m: number) => new Date(T0 + m * minute)

/** An in-memory store with the database's guarantees: a unique cost-shortfall row per job, a compare-and-set switch. */
class FakeStore implements CostShortfallStore {
  jobs: SweepJob[] = []
  logs = new Map<string, SweepUsageLog>()
  anomalies: CostShortfallAnomalyRow[] = []
  reports: Array<AppReportInput & { at: number }> = []
  switches = new Map<string, { enabled: boolean; switchedOnAt: string | null }>([[MODEL, { enabled: true, switchedOnAt: null }]])
  autoPause = true
  now = T0
  insertWorks = true
  /** Reads that fail on their next call, once. */
  failNext = new Set<"recorded" | "logs" | "shared">()

  private tick = () => new Promise<void>((r) => setTimeout(r, 0))

  addJob(id: string, opts: { completedAt: Date; cost?: number; charged?: number; status?: string; used?: number; action?: string }) {
    const usageLogId = `log-${id}`
    this.jobs.push({ id, userId: "user-1", usageLogId, providerCostUsd: opts.cost ?? 0.159, completedAt: opts.completedAt.toISOString(), provider: "replicate" })
    this.logs.set(usageLogId, {
      status: opts.status ?? "committed",
      credits_used: opts.used ?? opts.charged ?? 8,
      credits_charged: opts.status === "reserved" ? null : opts.charged ?? 8,
      action: opts.action ?? MODEL,
      provider: "reserved",
    })
  }

  switchIdOf = (action: string) => action
  async listJobs(sinceIso: string, from: number, size: number) {
    await this.tick()
    return this.jobs
      .filter((j) => j.completedAt >= sinceIso)
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
      .slice(from, from + size)
  }
  private fails(read: "recorded" | "logs" | "shared") {
    return this.failNext.delete(read)
  }
  async recordedJobIds(ids: readonly string[]) {
    await this.tick()
    if (this.fails("recorded")) return null
    return new Set(this.anomalies.filter((a) => ids.includes(a.job_id)).map((a) => a.job_id))
  }
  async usageLogs(ids: readonly string[]) {
    if (this.fails("logs")) return null
    return new Map(ids.flatMap((id) => (this.logs.has(id) ? [[id, this.logs.get(id)!] as const] : [])))
  }
  async sideCharges() {
    return new Map<string, number>()
  }
  async sharedUsageLogIds() {
    if (this.fails("shared")) return null
    return new Set<string>()
  }
  async insertAnomaly(row: CostShortfallAnomalyRow) {
    await this.tick()
    if (!this.insertWorks) return "failed" as const
    if (this.anomalies.some((a) => a.job_id === row.job_id)) return "duplicate" as const
    this.anomalies.push(row)
    return "inserted" as const
  }
  async costShortfallJobs(id: string, sinceIso: string) {
    await this.tick()
    return this.anomalies
      .filter((a) => a.model_switch_id === id && a.job_completed_at >= sinceIso)
      .map((a) => ({ jobId: a.job_id, completedAtMs: Date.parse(a.job_completed_at), chargedCredits: a.credits_actual, costCredits: a.credits_estimated }))
  }
  async alertedSince(kind: string, id: string, sinceIso: string) {
    return this.reports.some((r) => r.kind === kind && (r.payload as { modelSwitchId?: string }).modelSwitchId === id && r.at >= Date.parse(sinceIso))
  }
  async report(input: AppReportInput) {
    this.reports.push({ ...input, at: this.now })
    return true
  }
  async readSwitch(id: string): Promise<ModelSwitchState> {
    await this.tick()
    const s = this.switches.get(id)
    return s ? { kind: "row", enabled: s.enabled, switchedOnAt: s.switchedOnAt } : { kind: "missing" }
  }
  async switchOff(id: string) {
    await this.tick()
    const s = this.switches.get(id)
    if (!s || !s.enabled) return false
    s.enabled = false
    return true
  }
  async autoPauseEnabled() {
    return this.autoPause
  }
  /** What an admin does at Admin → Models (the trigger stamps switched_on_at). */
  liftAt(when: Date) {
    this.switches.set(MODEL, { enabled: true, switchedOnAt: when.toISOString() })
  }

  kinds = (kind: string) => this.reports.filter((r) => r.kind === kind)
}

let store: FakeStore
const sweep = (when: Date) => {
  store.now = when.getTime()
  return sweepCostShortfallJobs(store, when)
}

beforeEach(() => {
  __resetCostShortfallSweepForTests()
  store = new FakeStore()
})

describe("cost-shortfall sweep: recording", () => {
  it("records a NON-METERED completion that committed a flat reservation smaller than the provider bill (8 credits reserved, 0.159 USD billed)", async () => {
    store.addJob("j1", { completedAt: at(0), cost: 0.159, charged: 8 })
    const summary = await sweep(at(2))
    expect(summary.recorded).toBe(1)
    expect(store.anomalies).toEqual([
      expect.objectContaining({
        job_id: "j1",
        user_id: "user-1",
        usage_log_id: "log-j1",
        model_identifier: MODEL,
        model_switch_id: MODEL,
        provider: "replicate",
        credits_actual: 8,
        credits_estimated: usdToCredits(0.159),
        diff: usdToCredits(0.159) - 8,
        provider_cost_usd: 0.159,
      }),
    ])
    expect(store.kinds(COST_SHORTFALL_REPORT_KINDS.costShortfall)).toHaveLength(1)
  })

  it("records nothing for a job charged at or above cost", async () => {
    store.addJob("j1", { completedAt: at(0), cost: 0.159, charged: usdToCredits(0.159) })
    store.addJob("j2", { completedAt: at(0), cost: 0.159, charged: 200 })
    expect((await sweep(at(2))).recorded).toBe(0)
    expect(store.reports).toHaveLength(0)
  })

  it("waits for a job whose hold is still open, and records it once it settles", async () => {
    store.addJob("j1", { completedAt: at(0), status: "reserved" })
    expect((await sweep(at(1))).recorded).toBe(0)
    store.logs.set("log-j1", { ...store.logs.get("log-j1")!, status: "committed", credits_charged: 8 })
    expect((await sweep(at(6))).recorded).toBe(1)
  })

  it("never records a refunded job or a free-by-design run", async () => {
    store.addJob("j1", { completedAt: at(0), status: "refunded", charged: 0 })
    store.addJob("j2", { completedAt: at(0), charged: 0, used: 0 })
    expect((await sweep(at(2))).recorded).toBe(0)
  })

  it("records each job once, also when two processes sweep at the same time", async () => {
    store.addJob("j1", { completedAt: at(0) })
    const [a, b] = await Promise.all([sweep(at(2)), sweepCostShortfallJobs(store, at(2))])
    expect(a.recorded + b.recorded).toBe(1)
    expect(store.anomalies).toHaveLength(1)
  })

  it.each(["recorded", "logs", "shared"] as const)("judges nothing on a failed %s read, and judges the job on the next tick", async (read) => {
    store.addJob("j1", { completedAt: at(0) })
    store.failNext.add(read)
    expect((await sweep(at(1))).recorded).toBe(0)
    expect((await sweep(at(6))).recorded).toBe(1)
  })

  it("does nothing when the record cannot be written (the migration is not in the database yet)", async () => {
    store.insertWorks = false
    for (let i = 0; i < 6; i++) store.addJob(`j${i}`, { completedAt: at(i) })
    const summary = await sweep(at(10))
    expect(summary.recorded).toBe(0)
    expect(summary.paused).toEqual([])
    expect(store.reports).toHaveLength(0)
  })
})

describe("cost-shortfall sweep: alert throttling", () => {
  it("files one alert per model per window, with the count", async () => {
    store.addJob("j1", { completedAt: at(0) })
    store.addJob("j2", { completedAt: at(1) })
    await sweep(at(2))
    const [first] = store.kinds(COST_SHORTFALL_REPORT_KINDS.costShortfall)
    expect(first?.payload).toMatchObject({ modelSwitchId: MODEL, jobsCostShortfall: 2, windowMinutes: COST_SHORTFALL_RULE.windowMinutes })

    store.addJob("j3", { completedAt: at(10) })
    await sweep(at(12))
    expect(store.kinds(COST_SHORTFALL_REPORT_KINDS.costShortfall)).toHaveLength(1)

    store.addJob("j4", { completedAt: at(70) })
    await sweep(at(72))
    expect(store.kinds(COST_SHORTFALL_REPORT_KINDS.costShortfall)).toHaveLength(2)
  })
})

describe("cost-shortfall sweep: auto-pause", () => {
  it("does not pause on four cost-shortfall jobs", async () => {
    for (const m of [0, 5, 10, 15]) store.addJob(`j${m}`, { completedAt: at(m) })
    expect((await sweep(at(20))).paused).toEqual([])
    expect(store.switches.get(MODEL)?.enabled).toBe(true)
  })

  it("pauses on the fifth, files a high-severity alert, and records why", async () => {
    for (const m of [0, 5, 10, 15]) store.addJob(`j${m}`, { completedAt: at(m) })
    await sweep(at(16))
    store.addJob("j20", { completedAt: at(20) })
    expect((await sweep(at(21))).paused).toEqual([MODEL])
    expect(store.switches.get(MODEL)?.enabled).toBe(false)
    const paused = store.kinds(COST_SHORTFALL_REPORT_KINDS.paused)
    expect(paused).toHaveLength(1)
    expect(paused[0]).toMatchObject({ severity: "error" })
    expect(paused[0]!.payload).toMatchObject({
      modelSwitchId: MODEL,
      jobsCostShortfall: 5,
      windowMinutes: 60,
      sampleJobIds: ["j0", "j5", "j10", "j15", "j20"],
    })
  })

  it("does not pause when the five fall outside one window", async () => {
    for (const m of [0, 20, 40, 55, 61]) store.addJob(`j${m}`, { completedAt: at(m) })
    expect((await sweep(at(62))).paused).toEqual([])
  })

  it("does not pause on small shortfalls (charged at least half the cost)", async () => {
    const half = Math.ceil(usdToCredits(0.159) / 2)
    for (const m of [0, 1, 2, 3, 4]) store.addJob(`j${m}`, { completedAt: at(m), charged: half })
    const summary = await sweep(at(5))
    expect(summary.recorded).toBe(5)
    expect(summary.paused).toEqual([])
  })

  it("pauses exactly once when several processes see the fifth job at once", async () => {
    for (const m of [0, 1, 2, 3, 4]) store.addJob(`j${m}`, { completedAt: at(m) })
    const results = await Promise.all([sweep(at(5)), sweepCostShortfallJobs(store, at(5)), sweepCostShortfallJobs(store, at(5))])
    expect(results.flatMap((r) => r.paused)).toEqual([MODEL])
    expect(store.kinds(COST_SHORTFALL_REPORT_KINDS.paused)).toHaveLength(1)
  })

  it("never pauses on a job whose settlement is still open", async () => {
    for (const m of [0, 1, 2, 3]) store.addJob(`j${m}`, { completedAt: at(m) })
    store.addJob("j4", { completedAt: at(4), status: "reserved" })
    expect((await sweep(at(5))).paused).toEqual([])
  })

  it("does not pause again after an admin switches it back on, until five new jobs lose", async () => {
    for (const m of [0, 1, 2, 3, 4]) store.addJob(`j${m}`, { completedAt: at(m) })
    await sweep(at(5))
    expect(store.switches.get(MODEL)?.enabled).toBe(false)
    // Two runs already in flight finish while it is off.
    store.addJob("late1", { completedAt: at(6) })
    store.addJob("late2", { completedAt: at(7) })
    store.liftAt(at(8))
    store.addJob("after1", { completedAt: at(9) })
    expect((await sweep(at(10))).paused).toEqual([])
    expect(store.switches.get(MODEL)?.enabled).toBe(true)
    for (const m of [11, 12, 13, 14]) store.addJob(`after-${m}`, { completedAt: at(m) })
    expect((await sweep(at(15))).paused).toEqual([MODEL])
  })

  it("records and alerts but never pauses when the admin turned auto-pause off", async () => {
    store.autoPause = false
    for (const m of [0, 1, 2, 3, 4]) store.addJob(`j${m}`, { completedAt: at(m) })
    const summary = await sweep(at(5))
    expect(summary.recorded).toBe(5)
    expect(summary.paused).toEqual([])
    expect(store.kinds(COST_SHORTFALL_REPORT_KINDS.costShortfall)).toHaveLength(1)
  })

  it("does not touch a model an admin already switched off", async () => {
    store.switches.set(MODEL, { enabled: false, switchedOnAt: null })
    for (const m of [0, 1, 2, 3, 4]) store.addJob(`j${m}`, { completedAt: at(m) })
    expect((await sweep(at(5))).paused).toEqual([])
    expect(store.kinds(COST_SHORTFALL_REPORT_KINDS.paused)).toHaveLength(0)
  })

  it("says it could NOT pause a model with no pricing row, once per window", async () => {
    store.switches.clear()
    for (const m of [0, 1, 2, 3, 4]) store.addJob(`j${m}`, { completedAt: at(m) })
    expect((await sweep(at(5))).paused).toEqual([])
    store.addJob("j6", { completedAt: at(6) })
    await sweep(at(7))
    const failed = store.kinds(COST_SHORTFALL_REPORT_KINDS.pauseImpossible)
    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatchObject({ severity: "error" })
  })
})
