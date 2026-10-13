/**
 * The credit audit's per-task mode compares each provider task with what its
 * job was CHARGED — the usage log's settled charge (`settledCharge`, through
 * `creditStatusMapFor`) — never `jobs.credits`, the hold the run reserved. A
 * run settled below its hold (a ceiling, a measured length) is not an
 * overcharge, and a refunded one did not charge its hold.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import Fastify from "fastify"

const { tables } = vi.hoisted(() => ({
  tables: {
    jobs: [] as Array<Record<string, unknown>>,
    usage_logs: [] as Array<Record<string, unknown>>,
  },
}))

vi.mock("@/ee/middleware/require-admin.js", () => ({ requireAdmin: async () => {} }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => ({ cost_markup_percent: 0, service_margin_percent: {} }) }))
vi.mock("@/providers/kie/credit-lookup.js", () => ({
  // One successful KIE task per job below, each billed 400 KIE credits.
  fetchAllKieLogs: async () => ({
    records: ["t-settled", "t-held", "t-refunded", "t-legacy"].map((taskId) => ({ taskId, consumeCredits: 400, model: "seedance-2-5", state: "success" })),
    sources: [],
    errors: [],
    rawSamples: [],
  }),
}))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: "jobs" | "usage_logs") => {
      const rows = tables[table]
      const query = {
        select: () => query,
        in: async (column: string, values: unknown[]) => ({ data: rows.filter((r) => values.includes(r[column])), error: null }),
      }
      return query
    },
  },
}))

const { adminCreditAuditRoutes } = await import("../admin-credit-audit.js")

async function perTask() {
  const app = Fastify()
  await app.register(adminCreditAuditRoutes)
  const res = await app.inject({ method: "POST", url: "/v1/admin/credit-audit/sync", payload: { token: "t", mode: "per-task" } })
  await app.close()
  expect(res.statusCode).toBe(200)
  const tasks = (res.json() as { tasks: Array<Record<string, unknown>> }).tasks
  return new Map(tasks.map((t) => [t.kieTaskId as string, t]))
}

beforeEach(() => {
  tables.jobs = [
    { id: "j-settled", provider_task_id: "t-settled", credits: 1080, credits_actual: null, usage_log_id: "u-settled", status: "completed", job_type: "seedance-2-5", provider_kind: "kie", user_id: "x" },
    { id: "j-held", provider_task_id: "t-held", credits: 300, credits_actual: null, usage_log_id: "u-held", status: "processing", job_type: "seedance-2-5", provider_kind: "kie", user_id: "x" },
    { id: "j-refunded", provider_task_id: "t-refunded", credits: 500, credits_actual: null, usage_log_id: "u-refunded", status: "failed", job_type: "seedance-2-5", provider_kind: "kie", user_id: "x" },
    { id: "j-legacy", provider_task_id: "t-legacy", credits: 160, credits_actual: null, usage_log_id: null, status: "completed", job_type: "seedance-2-5", provider_kind: "kie", user_id: "x" },
  ]
  tables.usage_logs = [
    { id: "u-settled", status: "committed", credits_used: 1080, credits_charged: 126 },
    { id: "u-held", status: "reserved", credits_used: 300, credits_charged: null },
    { id: "u-refunded", status: "refunded", credits_used: 500, credits_charged: null },
  ]
})

describe("credit audit (per-task mode) — compares the charge, not the hold", () => {
  it("a run settled below its hold is compared at its charge (126), not its 1,080 hold", async () => {
    const t = (await perTask()).get("t-settled")!
    expect(t.ourCredits).toBe(126)
    expect(t.ourCreditsReserved).toBe(1080)
    expect(t.ourCreditStatus).toBe("committed")
    expect(t.diff).toBe(126 - (t.expectedCredits as number))
  })

  it("a refunded run charged nothing", async () => {
    const t = (await perTask()).get("t-refunded")!
    expect(t.ourCredits).toBe(0)
    expect(t.ourCreditsReserved).toBe(500)
    expect(t.status).toBe("UNDERCHARGED")
  })

  it("a hold still open, and a job with no usage log, read as the hold", async () => {
    const tasks = await perTask()
    expect(tasks.get("t-held")!.ourCredits).toBe(300)
    expect(tasks.get("t-held")!.ourCreditStatus).toBe("reserved")
    expect(tasks.get("t-legacy")!.ourCredits).toBe(160)
    expect(tasks.get("t-legacy")!.ourCreditStatus).toBeNull()
  })
})
