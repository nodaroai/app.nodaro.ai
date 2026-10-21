/**
 * The credit audit's LLM mode (D6 monitoring): per (feature, model), the real
 * provider cost of the metered calls (the server-only ledger's `costUsd`)
 * against what the payers were CHARGED, with theoretical mode's thresholds —
 * UNDERPRICED when the charge falls short of cost + markup, OVERPRICED when it
 * is more than double. An uncollected overrun (credit_anomalies
 * `uncollected_overrun`, or a workspace's `org_usage_variance`) is what makes a
 * group UNDERPRICED; the 2-credit floor dominating tiny calls is what makes
 * one OVERPRICED.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import Fastify from "fastify"

type Row = Record<string, unknown>

const { tables, admin, fixedPrices, settings } = vi.hoisted(() => ({
  tables: {
    jobs: [] as Row[],
    usage_logs: [] as Row[],
    credit_anomalies: [] as Row[],
    credit_transactions: [] as Row[],
    llm_side_holds: [] as Row[],
  } as Record<string, Row[]>,
  admin: { yes: true },
  fixedPrices: {} as Record<string, number>,
  settings: { cost_markup_percent: 10, service_margin_percent: {} as Record<string, number> },
}))

vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: async (_req: unknown, reply: { status: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (!admin.yes) return reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
  },
}))
vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: async () => settings,
}))
vi.mock("@/ee/billing/credits.js", () => ({
  getModelCreditCostFromDB: async (id: string) => ({ creditCost: fixedPrices[id] ?? 0 }),
}))

/**
 * A chainable PostgREST double: filters apply on await; `.order` sorts, `.limit`
 * and `.range` page; `.or` parses PostgREST's logic-tree syntax (`and(...)`,
 * `or(...)`, `col.op.value` with eq/gt/gte/like) so the key-set cursor is real.
 */
vi.mock("@/lib/supabase.js", () => {
  type Pred = (r: Row) => boolean
  /** Split `s` on top-level commas. */
  function splitTop(s: string): string[] {
    const out: string[] = []
    let depth = 0
    let cur = ""
    for (const ch of s) {
      if (ch === "(") depth++
      if (ch === ")") depth--
      if (ch === "," && depth === 0) {
        out.push(cur)
        cur = ""
      } else cur += ch
    }
    if (cur) out.push(cur)
    return out
  }
  function cond(expr: string): Pred {
    const m = /^(and|or)\((.*)\)$/.exec(expr)
    if (m) {
      const parts = splitTop(m[2]!).map(cond)
      return m[1] === "and" ? (r) => parts.every((p) => p(r)) : (r) => parts.some((p) => p(r))
    }
    const [col, op, ...rest] = expr.split(".")
    const val = rest.join(".")
    switch (op) {
      case "eq": return (r) => String(r[col!]) === val
      case "gt": return (r) => String(r[col!]) > val
      case "gte": return (r) => String(r[col!]) >= val
      case "like": {
        const re = new RegExp(`^${val.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)
        return (r) => re.test(String(r[col!]))
      }
      default: throw new Error(`mock: unsupported op ${op}`)
    }
  }
  function query(table: string) {
    const filters: Pred[] = []
    const orders: string[] = []
    let range: [number, number] | null = null
    const q = {
      select: () => q,
      order: (col: string) => {
        orders.push(col)
        return q
      },
      not: (col: string, op: string, val: unknown) => {
        if (op === "is" && val === null) filters.push((r) => r[col] != null)
        return q
      },
      is: (col: string, val: unknown) => {
        if (val === null) filters.push((r) => r[col] == null)
        return q
      },
      or: (expr: string) => {
        filters.push(cond(`or(${expr})`))
        return q
      },
      gte: (col: string, val: string) => {
        filters.push((r) => String(r[col]) >= val)
        return q
      },
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val)
        return q
      },
      in: (col: string, vals: unknown[]) => {
        filters.push((r) => vals.includes(r[col]))
        return q
      },
      limit: (n: number) => {
        range = [0, n - 1]
        return q
      },
      range: (from: number, to: number) => {
        range = [from, to]
        return q
      },
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => {
        let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
        if (orders.length) {
          rows = [...rows].sort((a, b) => {
            for (const c of orders) {
              const x = String(a[c])
              const y = String(b[c])
              if (x !== y) return x < y ? -1 : 1
            }
            return 0
          })
        }
        if (range) rows = rows.slice(range[0], range[1] + 1)
        return Promise.resolve({ data: rows, error: null }).then(resolve)
      },
    }
    return q
  }
  return { supabase: { from: (t: string) => query(t) } }
})

const { adminCreditAuditLlmRoutes } = await import("../admin-credit-audit-llm.js")

interface AuditRow {
  feature: string
  model: string
  tasks: number
  providerCostUsd: number
  providerCostInCredits: number
  expectedCredits: number
  chargedCredits: number
  shortfallCredits: number
  estimatedShare: number
  diff: number
  diffPercent: number | null
  status: string
  uncollectedOverruns: number
  unsettledHolds: number
  uncomputableTasks: number
  negativeRemainderTasks: number
  fixedCreditsExcluded: number
  markupPercent: number
  mixedMarkup: boolean
  refundedBilledTasks: number
  refundedBilledCostUsd: number
  refundedBilledUncomputableTasks: number
  missingLedgers: number
}

interface AuditBody {
  mode: string
  models: AuditRow[]
  mismatches: number
  markupPercent: number
  lookbackMinutes: number
  totalJobs: number
  truncated: boolean
  refundedBilled: { tasks: number; costUsd: number; uncomputableTasks: number }
  missingLedgers: number
}

async function audit(payload: Record<string, unknown> = {}) {
  const app = Fastify()
  await app.register(adminCreditAuditLlmRoutes)
  const res = await app.inject({ method: "POST", url: "/v1/admin/credit-audit/llm", payload })
  await app.close()
  return res
}

async function rows(payload: Record<string, unknown> = {}) {
  const res = await audit(payload)
  expect(res.statusCode).toBe(200)
  const body = res.json() as AuditBody
  return { body, byKey: new Map(body.models.map((m) => [`${m.feature}:${m.model}`, m])) }
}

const NOW = new Date().toISOString()

let seq = 0
/** One metered job with its committed usage log. */
function meteredJob(o: {
  action: string
  costUsd: number | null
  charged: number
  source?: string
  chargeId?: string
  status?: string
  logStatus?: string
  workspaceId?: string | null
  calls?: number
}) {
  seq += 1
  const jobId = `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`
  const logId = `10000000-0000-4000-8000-${String(seq).padStart(12, "0")}`
  tables.jobs.push({
    id: jobId,
    usage_log_id: logId,
    status: o.status ?? "completed",
    created_at: NOW,
    llm_billing: {
      costUsd: o.costUsd,
      source: o.source ?? (o.costUsd == null ? "uncomputable" : "kie-stated"),
      calls: o.calls ?? 1,
      lanes: ["kie"],
      ...(o.chargeId ? { chargeId: o.chargeId } : {}),
    },
  })
  tables.usage_logs.push({
    id: logId,
    job_id: jobId,
    action: o.action,
    status: o.logStatus ?? "committed",
    credits_used: o.charged,
    credits_charged: o.charged,
    workspace_id: o.workspaceId ?? null,
    created_at: NOW,
  })
  return { jobId, logId }
}

beforeEach(() => {
  seq = 0
  admin.yes = true
  for (const k of Object.keys(tables)) tables[k] = []
  for (const k of Object.keys(fixedPrices)) delete fixedPrices[k]
  settings.service_margin_percent = {}
})

describe("credit audit — LLM mode (per feature and model, cost vs charge)", () => {
  it("groups by feature and model and flags an uncollected overrun as UNDERPRICED", async () => {
    meteredJob({ action: "llm-chat:claude-fable-5", costUsd: 0.048, charged: 27 })
    const second = meteredJob({ action: "llm-chat:claude-fable-5", costUsd: 1.66507, charged: 468 })
    // The second job settled at 917; the payer held only 468 of it → 449 uncollected.
    tables.credit_anomalies.push({
      usage_log_id: second.logId, model_identifier: "llm-chat:claude-fable-5", anomaly_type: "uncollected_overrun", diff: 449, created_at: NOW,
    })
    // A different model, healthy, kept apart.
    meteredJob({ action: "llm-chat:gemini-3.8-flash", costUsd: 0.01, charged: 6 })

    const { body, byKey } = await rows()
    expect(body.mode).toBe("llm")
    expect(body.markupPercent).toBe(10)
    expect(body.lookbackMinutes).toBe(7 * 1440)

    const r = byKey.get("llm-chat:claude-fable-5")!
    expect(r.tasks).toBe(2)
    // 0.048 + 1.66507 = 1.71307 USD → 856.535 credits → ×1.1 = 942.1885 → 943
    expect(r.providerCostUsd).toBeCloseTo(1.71307, 9)
    expect(r.providerCostInCredits).toBeCloseTo(856.535, 6)
    expect(r.expectedCredits).toBe(943)
    expect(r.chargedCredits).toBe(495)
    expect(r.shortfallCredits).toBe(449)
    expect(r.uncollectedOverruns).toBe(1)
    expect(r.diff).toBe(-448)
    expect(r.status).toBe("UNDERPRICED")

    // 0.01 USD → 5 credits → 5.5 → 6, charged 6 → OK
    const ok = byKey.get("llm-chat:gemini-3.8-flash")!
    expect(ok.expectedCredits).toBe(6)
    expect(ok.diff).toBe(0)
    expect(ok.status).toBe("OK")

    expect(body.mismatches).toBe(1)
    // Mismatches sort first.
    expect(body.models[0]!.status).toBe("UNDERPRICED")
  })

  it("flags the 2-credit floor dominating tiny calls as OVERPRICED", async () => {
    for (let i = 0; i < 10; i++) meteredJob({ action: "llm-structured:gemini-3.8-flash", costUsd: 0.0002, charged: 2 })
    const { byKey } = await rows()
    const r = byKey.get("llm-structured:gemini-3.8-flash")!
    expect(r.tasks).toBe(10)
    // 10 × 0.0002 = 0.002 USD → 1.0 credit → ×1.1 → ceil(1.1) = 2
    expect(r.providerCostInCredits).toBeCloseTo(1, 6)
    expect(r.expectedCredits).toBe(2)
    expect(r.chargedCredits).toBe(20)
    expect(r.diff).toBe(18)
    expect(r.diffPercent).toBe(900)
    expect(r.status).toBe("OVERPRICED")
  })

  it("estimatedShare is the share of jobs whose cost was estimated, not stated", async () => {
    meteredJob({ action: "llm-chat:claude-fable-5", costUsd: 0.01, charged: 6, source: "kie-size-estimate" })
    meteredJob({ action: "llm-chat:claude-fable-5", costUsd: 0.01, charged: 6, source: "abort-estimate" })
    meteredJob({ action: "llm-chat:claude-fable-5", costUsd: 0.01, charged: 6, source: "kie-stated" })
    meteredJob({ action: "llm-chat:claude-fable-5", costUsd: 0.01, charged: 6, source: "provider-usage" })
    const { byKey } = await rows()
    expect(byKey.get("llm-chat:claude-fable-5")!.estimatedShare).toBe(0.5)
  })

  it("a workspace overrun absorbed as org_usage_variance is a shortfall, not a charge", async () => {
    // commit_credits writes credits_charged = the full actual (917) on a workspace row,
    // but the budget only took 468: the 449 rest is an org_usage_variance line.
    const ws = meteredJob({ action: "llm-chat:claude-fable-5", costUsd: 1.66507, charged: 917, workspaceId: "w1" })
    tables.credit_transactions.push({
      source: "org_usage_variance", amount: 449, created_at: NOW,
      description: `Metered overrun beyond workspace headroom, absorbed by the platform (usage_log ${ws.logId})`,
    })
    // A variance line for a usage log that is not an LLM one is not ours.
    tables.credit_transactions.push({
      source: "org_usage_variance", amount: 999, created_at: NOW,
      description: "Metered overrun beyond workspace headroom, absorbed by the platform (usage_log 20000000-0000-4000-8000-000000000001)",
    })
    const { byKey } = await rows()
    const r = byKey.get("llm-chat:claude-fable-5")!
    expect(r.chargedCredits).toBe(468)
    expect(r.shortfallCredits).toBe(449)
    expect(r.uncollectedOverruns).toBe(1)
    // 1.66507 USD → 832.535 → ×1.1 = 915.7885 → 916; 468 − 916 = −448
    expect(r.expectedCredits).toBe(916)
    expect(r.status).toBe("UNDERPRICED")
  })

  it("a scrape's analysis is reported under the ledger's charge id, its fixed price taken out of the charge", async () => {
    fixedPrices["meta-ads-scrape"] = 50
    // Completed scrape: charged 50 (fixed) + 6 (analysis).
    meteredJob({ action: "meta-ads-scrape", chargeId: "meta-ads-analysis:gemini-3.8-flash", costUsd: 0.01, charged: 56 })
    // Failed scrape: the fixed part was refunded; only the billed analysis (6) charged.
    meteredJob({ action: "meta-ads-scrape", chargeId: "meta-ads-analysis:gemini-3.8-flash", costUsd: 0.01, charged: 6, status: "failed" })
    const { byKey } = await rows()
    expect(byKey.has("meta-ads-scrape")).toBe(false)
    const r = byKey.get("meta-ads-analysis:gemini-3.8-flash")!
    expect(r.tasks).toBe(2)
    expect(r.chargedCredits).toBe(12)
    expect(r.fixedCreditsExcluded).toBe(50)
    // 0.02 USD → 10 credits → 11
    expect(r.expectedCredits).toBe(11)
    expect(r.status).toBe("OK")
  })

  it("an unconfirmed metered settle is counted from credit_anomalies even with no committed row", async () => {
    tables.credit_anomalies.push({
      usage_log_id: "30000000-0000-4000-8000-000000000001", model_identifier: "meta-ads-analysis:gemini-3.8-flash",
      anomaly_type: "metered_settle_unconfirmed", diff: -80, created_at: NOW,
    })
    const { byKey } = await rows()
    const r = byKey.get("meta-ads-analysis:gemini-3.8-flash")!
    expect(r.unsettledHolds).toBe(1)
    expect(r.tasks).toBe(0)
    expect(r.status).toBe("OK")
  })

  it("an unconfirmed settle on a known usage log is attributed through it", async () => {
    const held = meteredJob({ action: "llm-chat:claude-fable-5", costUsd: 0.01, charged: 6, logStatus: "reserved" })
    tables.credit_anomalies.push({
      usage_log_id: held.logId, model_identifier: "llm-chat:claude-fable-5", anomaly_type: "metered_settle_unconfirmed", diff: -6, created_at: NOW,
    })
    const { byKey } = await rows()
    const r = byKey.get("llm-chat:claude-fable-5")!
    // A reserved log is not a settled task.
    expect(r.tasks).toBe(0)
    expect(r.chargedCredits).toBe(0)
    expect(r.unsettledHolds).toBe(1)
  })

  it("a job whose usage_log_id was never written is linked through the log's own job_id", async () => {
    const { jobId } = meteredJob({ action: "llm-chat:claude-fable-5", costUsd: 0.01, charged: 6 })
    const job = tables.jobs.find((j) => j.id === jobId)!
    job.usage_log_id = null
    const { byKey } = await rows()
    const r = byKey.get("llm-chat:claude-fable-5")!
    expect(r.tasks).toBe(1)
    expect(r.chargedCredits).toBe(6)
  })

  it("an uncomputable cost is left out of the comparison and counted", async () => {
    meteredJob({ action: "llm-chat:claude-fable-5", costUsd: 0.01, charged: 6 })
    meteredJob({ action: "llm-chat:claude-fable-5", costUsd: null, charged: 300 })
    const { byKey } = await rows()
    const r = byKey.get("llm-chat:claude-fable-5")!
    expect(r.tasks).toBe(1)
    expect(r.uncomputableTasks).toBe(1)
    expect(r.chargedCredits).toBe(6)
    expect(r.status).toBe("OK")
  })

  it("a per-model service margin is the group's markup", async () => {
    settings.service_margin_percent = { "llm-chat:claude-fable-5": 50 }
    meteredJob({ action: "llm-chat:claude-fable-5", costUsd: 0.01, charged: 8 })
    const { body } = await rows()
    const r = body.models[0]!
    // 5 credits × 1.5 = 7.5 → 8
    expect(r.markupPercent).toBe(50)
    expect(r.expectedCredits).toBe(8)
    expect(body.markupPercent).toBe(10)
  })

  it("rejects a lookback outside 1–90 days", async () => {
    expect((await audit({ days: 0 })).statusCode).toBe(400)
    expect((await audit({ days: 91 })).statusCode).toBe(400)
    const { body } = await rows({ days: 90 })
    expect(body.lookbackMinutes).toBe(90 * 1440)
  })

  it("pages by key set: more than a page of jobs sharing one created_at are each read once", async () => {
    for (let i = 0; i < 1001; i++) meteredJob({ action: "llm-chat:gemini-3.8-flash", costUsd: 0.01, charged: 6 })
    const { body, byKey } = await rows()
    expect(body.truncated).toBe(false)
    expect(byKey.get("llm-chat:gemini-3.8-flash")!.tasks).toBe(1001)
    expect(body.totalJobs).toBe(1001)
  })

  it("a refunded log whose ledger billed a call is surfaced, never compared", async () => {
    meteredJob({ action: "llm-chat:gemini-3.8-flash", costUsd: 0.01, charged: 6 })
    const before = (await rows()).byKey.get("llm-chat:gemini-3.8-flash")!
    // D10: billed (calls 1, cost > 0) yet refunded.
    meteredJob({ action: "llm-chat:gemini-3.8-flash", costUsd: 0.4, charged: 0, logStatus: "refunded" })
    // Refunded with nothing billed is correct — not counted.
    meteredJob({ action: "llm-chat:gemini-3.8-flash", costUsd: 0, charged: 0, logStatus: "refunded", calls: 0 })
    // A group that has only a refunded-but-billed job.
    meteredJob({ action: "llm-chat:claude-fable-5", costUsd: 1.2, charged: 0, logStatus: "refunded" })

    const { body, byKey } = await rows()
    const r = byKey.get("llm-chat:gemini-3.8-flash")!
    expect(r.refundedBilledTasks).toBe(1)
    expect(r.refundedBilledCostUsd).toBeCloseTo(0.4, 9)
    // The comparison is byte-identical to before.
    expect({ ...r, refundedBilledTasks: 0, refundedBilledCostUsd: 0 }).toEqual(before)
    expect(r.refundedBilledUncomputableTasks).toBe(0)

    const only = byKey.get("llm-chat:claude-fable-5")!
    expect(only.tasks).toBe(0)
    expect(only.status).toBe("OK")
    expect(only.refundedBilledTasks).toBe(1)
    expect(body.refundedBilled.tasks).toBe(2)
    expect(body.refundedBilled.costUsd).toBeCloseTo(1.6, 9)
    expect(body.mismatches).toBe(0)
  })

  it("a refunded log whose ledger billed a call of uncomputable cost counts, apart from the $", async () => {
    meteredJob({ action: "llm-chat:claude-fable-5", costUsd: 0.3, charged: 0, logStatus: "refunded" })
    // Billed (calls 1) — what the reconcile sweep treats as billed — though the cost is unknown.
    meteredJob({ action: "llm-chat:claude-fable-5", costUsd: null, charged: 0, logStatus: "refunded" })
    const { body, byKey } = await rows()
    const r = byKey.get("llm-chat:claude-fable-5")!
    expect(r.refundedBilledTasks).toBe(2)
    expect(r.refundedBilledUncomputableTasks).toBe(1)
    expect(r.refundedBilledCostUsd).toBeCloseTo(0.3, 9)
    expect(r.uncomputableTasks).toBe(0)
    expect(r.tasks).toBe(0)
    expect(r.status).toBe("OK")
    expect(body.refundedBilled).toEqual({ tasks: 2, costUsd: 0.3, uncomputableTasks: 1 })
  })

  it("marks up each task at its full charge id — a :direct lane's own margin included", async () => {
    settings.service_margin_percent = { "llm-chat:claude-fable-5:direct": 50 }
    meteredJob({ action: "llm-chat:claude-fable-5", costUsd: 0.01, charged: 6 })
    meteredJob({ action: "llm-chat:claude-fable-5:direct", costUsd: 0.01, charged: 8 })
    const { byKey } = await rows()
    const r = byKey.get("llm-chat:claude-fable-5")!
    expect(r.tasks).toBe(2)
    // 5 credits × 1.1 = 5.5, plus 5 × 1.5 = 7.5 → 13 (not 10 × 1.1 → 11)
    expect(r.expectedCredits).toBe(13)
    expect(r.mixedMarkup).toBe(true)
    expect(r.markupPercent).toBe(30)
    expect(r.chargedCredits).toBe(14)
    expect(r.status).toBe("OK")
  })

  it("a scrape whose charge is below today's fixed price is flagged, not compared", async () => {
    fixedPrices["meta-ads-scrape"] = 50
    meteredJob({ action: "meta-ads-scrape", chargeId: "meta-ads-analysis:gemini-3.8-flash", costUsd: 0.01, charged: 56 })
    // Charged under an older, lower fixed price: 30 − 50 < 0.
    meteredJob({ action: "meta-ads-scrape", chargeId: "meta-ads-analysis:gemini-3.8-flash", costUsd: 0.5, charged: 30 })
    const { body, byKey } = await rows()
    const r = byKey.get("meta-ads-analysis:gemini-3.8-flash")!
    expect(r.tasks).toBe(1)
    expect(r.negativeRemainderTasks).toBe(1)
    expect(r.chargedCredits).toBe(6)
    expect(r.fixedCreditsExcluded).toBe(50)
    expect(r.providerCostUsd).toBeCloseTo(0.01, 9)
    expect(r.status).toBe("OK")
    expect(body.totalJobs).toBe(2)
  })

  it("two jobs pointing at one usage log are one task", async () => {
    const { logId } = meteredJob({ action: "llm-chat:gemini-3.8-flash", costUsd: 0.01, charged: 6 })
    tables.jobs.push({ ...tables.jobs[0]!, id: "00000000-0000-4000-8000-999999999999", usage_log_id: logId })
    const { body, byKey } = await rows()
    expect(byKey.get("llm-chat:gemini-3.8-flash")!.tasks).toBe(1)
    expect(body.totalJobs).toBe(1)
  })

  it("totalJobs is the settled jobs across the rows", async () => {
    meteredJob({ action: "llm-chat:claude-fable-5", costUsd: 0.01, charged: 6 })
    meteredJob({ action: "llm-chat:claude-fable-5", costUsd: null, charged: 300 })
    meteredJob({ action: "llm-chat:gemini-3.8-flash", costUsd: 0.01, charged: 6 })
    // A reserved hold and a refund are not settled jobs.
    meteredJob({ action: "llm-chat:gemini-3.8-flash", costUsd: 0.01, charged: 6, logStatus: "reserved" })
    meteredJob({ action: "llm-chat:gemini-3.8-flash", costUsd: 0.01, charged: 0, logStatus: "refunded" })
    const { body } = await rows()
    const settled = body.models.reduce((s, m) => s + m.tasks + m.uncomputableTasks + m.negativeRemainderTasks, 0)
    expect(body.totalJobs).toBe(settled)
    expect(body.totalJobs).toBe(3)
  })

  it("counts committed metered logs whose job carries no ledger", async () => {
    const OLD = new Date(Date.now() - 30 * 86_400_000).toISOString()
    const log = (o: { id: string; jobId: string | null; action: string; status?: string }) =>
      tables.usage_logs.push({ id: o.id, job_id: o.jobId, action: o.action, status: o.status ?? "committed", credits_used: 6, credits_charged: 6, created_at: NOW })
    // Missing: the job exists, its ledger write failed.
    tables.jobs.push({ id: "a0000000-0000-4000-8000-000000000001", usage_log_id: null, status: "completed", created_at: NOW, llm_billing: null })
    log({ id: "b0000000-0000-4000-8000-000000000001", jobId: "a0000000-0000-4000-8000-000000000001", action: "llm-chat:claude-fable-5" })
    // Not missing: a job created before the window still carries its ledger.
    tables.jobs.push({ id: "a0000000-0000-4000-8000-000000000002", usage_log_id: null, status: "completed", created_at: OLD, llm_billing: { costUsd: 0.01, source: "kie-stated", calls: 1, lanes: ["kie"] } })
    log({ id: "b0000000-0000-4000-8000-000000000002", jobId: "a0000000-0000-4000-8000-000000000002", action: "llm-chat:claude-fable-5" })
    // Not metered (a tier id), and not committed — neither counted.
    tables.jobs.push({ id: "a0000000-0000-4000-8000-000000000003", usage_log_id: null, status: "completed", created_at: NOW, llm_billing: null })
    log({ id: "b0000000-0000-4000-8000-000000000003", jobId: "a0000000-0000-4000-8000-000000000003", action: "llm-chat:premium" })
    tables.jobs.push({ id: "a0000000-0000-4000-8000-000000000004", usage_log_id: null, status: "running", created_at: NOW, llm_billing: null })
    log({ id: "b0000000-0000-4000-8000-000000000004", jobId: "a0000000-0000-4000-8000-000000000004", action: "llm-chat:claude-fable-5", status: "reserved" })
    // A settled job with its ledger is not missing either.
    meteredJob({ action: "llm-chat:claude-fable-5", costUsd: 0.01, charged: 6 })

    const { body, byKey } = await rows()
    expect(byKey.get("llm-chat:claude-fable-5")!.missingLedgers).toBe(1)
    expect(body.missingLedgers).toBe(1)
  })

  it("R38: a job carrying only a worker's pre-call marker has no ledger — counted missing (in the window and before it), never read as a ledger", async () => {
    const OLD = new Date(Date.now() - 30 * 86_400_000).toISOString()
    const marker = { preCall: true, chargeId: "llm-chat:claude-fable-5" }
    tables.jobs.push({ id: "a0000000-0000-4000-8000-000000000011", usage_log_id: null, status: "completed", created_at: NOW, llm_billing: marker })
    tables.usage_logs.push({ id: "b0000000-0000-4000-8000-000000000011", job_id: "a0000000-0000-4000-8000-000000000011", action: "llm-chat:claude-fable-5", status: "committed", credits_used: 6, credits_charged: 6, created_at: NOW })
    tables.jobs.push({ id: "a0000000-0000-4000-8000-000000000012", usage_log_id: null, status: "completed", created_at: OLD, llm_billing: marker })
    tables.usage_logs.push({ id: "b0000000-0000-4000-8000-000000000012", job_id: "a0000000-0000-4000-8000-000000000012", action: "llm-chat:claude-fable-5", status: "committed", credits_used: 6, credits_charged: 6, created_at: NOW })
    const { body } = await rows()
    expect(body.missingLedgers).toBe(2)
  })

  it("554: a side hold's reading is audited per (feature, model) from ITS OWN ledger — the job it was made for (and its managed log) stay out", async () => {
    // A UGC clip: its managed job-once log, no ledger on its row (a side hold never writes one).
    tables.jobs.push({ id: "c0000000-0000-4000-8000-000000000001", usage_log_id: "d0000000-0000-4000-8000-000000000001", status: "completed", created_at: NOW, llm_billing: null })
    tables.usage_logs.push({ id: "d0000000-0000-4000-8000-000000000001", job_id: "c0000000-0000-4000-8000-000000000001", action: "ugc-clip", status: "committed", credits_used: 300, credits_charged: 250, created_at: NOW })
    const side = (o: { log: string; status: string; ledger: Row | null; charged: number }) => {
      tables.usage_logs.push({ id: o.log, job_id: null, action: "image-to-text:claude-sonnet-5.5", status: o.status, credits_used: 4, credits_charged: o.charged, created_at: NOW })
      tables.llm_side_holds.push({
        usage_log_id: o.log, job_id: "c0000000-0000-4000-8000-000000000001", charge_id: "image-to-text:claude-sonnet-5.5", created_at: NOW, ledger: o.ledger,
      })
    }
    const ledger = (costUsd: number | null) => ({ costUsd, source: costUsd == null ? "uncomputable" : "provider-usage", calls: 1, lanes: ["direct-anthropic"], chargeId: "image-to-text:claude-sonnet-5.5" })
    // Two settled readings: 0.004 + 0.006 USD → 5 credits → ×1.1 → 6; charged 3 + 5 = 8 (one overran the hold, collected).
    side({ log: "e0000000-0000-4000-8000-000000000001", status: "committed", ledger: ledger(0.004), charged: 3 })
    side({ log: "e0000000-0000-4000-8000-000000000002", status: "committed", ledger: ledger(0.006), charged: 5 })
    // A third overran beyond the payer's balance: its shortfall is the RPC's anomaly on the side log.
    side({ log: "e0000000-0000-4000-8000-000000000003", status: "committed", ledger: ledger(0.01), charged: 4 })
    tables.credit_anomalies.push({ usage_log_id: "e0000000-0000-4000-8000-000000000003", model_identifier: "image-to-text:claude-sonnet-5.5", anomaly_type: "uncollected_overrun", diff: 2, created_at: NOW })
    // A refunded reading whose ledger recorded a billed call (D10) is surfaced, never compared.
    side({ log: "e0000000-0000-4000-8000-000000000004", status: "refunded", ledger: ledger(0.002), charged: 0 })
    // A committed side log whose ledger write failed is a missing ledger.
    side({ log: "e0000000-0000-4000-8000-000000000005", status: "committed", ledger: null, charged: 4 })
    // A hold still open is not a settled task.
    side({ log: "e0000000-0000-4000-8000-000000000006", status: "reserved", ledger: ledger(0.003), charged: 0 })

    const { body, byKey } = await rows()
    const r = byKey.get("image-to-text:claude-sonnet-5.5")!
    expect(r.tasks).toBe(3)
    expect(r.providerCostUsd).toBeCloseTo(0.02, 9)
    // 0.02 USD → 10 credits → ×1.1 → 11
    expect(r.expectedCredits).toBe(11)
    expect(r.chargedCredits).toBe(12)
    expect(r.shortfallCredits).toBe(2)
    expect(r.uncollectedOverruns).toBe(1)
    expect(r.refundedBilledTasks).toBe(1)
    expect(r.refundedBilledCostUsd).toBeCloseTo(0.002, 9)
    expect(r.missingLedgers).toBe(1)
    // The clip itself is no LLM task (its managed log has no metered id, its row no ledger).
    expect([...byKey.keys()]).toEqual(["image-to-text:claude-sonnet-5.5"])
    expect(body.missingLedgers).toBe(1)
  })

  it("R57 / R61: a deliberate platform refund (a withdrawn job's side log, a force-refunded job's log, a blocked job's reversed charge) is never counted refunded-but-billed", async () => {
    const ledger = { costUsd: 0.004, source: "provider-usage", calls: 1, lanes: ["direct-anthropic"], chargeId: "image-to-text:claude-sonnet-5.5" }
    // A side log the withdraw refunded (refund_settled_side_hold stamps side_refund)…
    tables.usage_logs.push({ id: "f0000000-0000-4000-8000-000000000001", job_id: null, action: "image-to-text:claude-sonnet-5.5", status: "refunded", credits_used: 4, credits_charged: 3, metadata: { reservation_mode: "side", side_refund: { credits: 3 } }, created_at: NOW })
    tables.llm_side_holds.push({ usage_log_id: "f0000000-0000-4000-8000-000000000001", job_id: "c0000000-0000-4000-8000-000000000009", charge_id: "image-to-text:claude-sonnet-5.5", created_at: NOW, ledger })
    // …a job withdrawn with billing_force_refund…
    tables.jobs.push({ id: "c0000000-0000-4000-8000-000000000010", usage_log_id: "f0000000-0000-4000-8000-000000000002", status: "cancelled", billing_force_refund: true, created_at: NOW, llm_billing: { ...ledger, chargeId: undefined } })
    tables.usage_logs.push({ id: "f0000000-0000-4000-8000-000000000002", job_id: "c0000000-0000-4000-8000-000000000010", action: "image-to-text:claude-sonnet-5.5", status: "refunded", credits_used: 4, credits_charged: null, created_at: NOW })
    // …R61: a blocked job's own settled metered charge the platform reversed (policy_refund)…
    tables.jobs.push({ id: "c0000000-0000-4000-8000-000000000011", usage_log_id: "f0000000-0000-4000-8000-000000000003", status: "failed", created_at: NOW, llm_billing: { ...ledger, chargeId: undefined } })
    tables.usage_logs.push({ id: "f0000000-0000-4000-8000-000000000003", job_id: "c0000000-0000-4000-8000-000000000011", action: "image-to-text:claude-sonnet-5.5", status: "refunded", credits_used: 4, credits_charged: 3, metadata: { policy_refund: { credits: 3 } }, created_at: NOW })
    // …and a real D10 case: a billed call refunded by mistake.
    const d10 = meteredJob({ action: "image-to-text:claude-sonnet-5.5", costUsd: 0.002, charged: 4, logStatus: "refunded" })
    expect(d10.logId).toBeDefined()
    const { body, byKey } = await rows()
    expect(byKey.get("image-to-text:claude-sonnet-5.5")!.refundedBilledTasks).toBe(1)
    expect(body.refundedBilled.tasks).toBe(1)
  })

  it("non-admin gets 403", async () => {
    admin.yes = false
    const res = await audit()
    expect(res.statusCode).toBe(403)
  })
})
