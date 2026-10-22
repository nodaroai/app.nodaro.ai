import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * THE BACK-POINTER at THE funnel: every reservation `reserveCredits` makes
 * against a job links the job to it (`jobs.usage_log_id`), so the job surfaces
 * (`GET /v1/jobs`, the MCP job tools) can read its charge and the worker can
 * commit or refund it — whichever lane reserved (pipeline worker jobs, the
 * internal `POST /v1/credits/reserve`, social publish, the final merge, the
 * route guard, the workflow engine).
 *
 * Pinned:
 *  - a paid reservation and a zero-cost one both write the link, scoped to the
 *    requester's own job and only where no link exists yet;
 *  - a job id that is not a UUID, and the sentinel ids, write nothing;
 *  - `job-once` reservations write nothing here (their RPC links in SQL);
 *  - a failed link never fails the reservation.
 * The source half — no lane reserves around the funnel with a job id — is
 * `reserve-paths-link-jobs.test.ts`.
 */

const JOB = "11111111-1111-4111-8111-111111111111"
const LOG = "22222222-2222-4222-8222-222222222222"

const { mockFrom, mockRpc, tableResponses, writes, failJobUpdate } = vi.hoisted(() => {
  const tableResponses = new Map<string, { data: unknown; error: unknown }>()
  const writes: Array<{ table: string; values: unknown; filters: Array<[string, string, unknown]> }> = []
  const failJobUpdate = { value: false }
  function createChain(table: string, response: { data: unknown; error: unknown } | null) {
    const fallback = response ?? { data: null, error: { code: "PGRST116" } }
    let write: (typeof writes)[number] | null = null
    const filter = (op: string) => vi.fn().mockImplementation((col: string, val: unknown) => {
      write?.filters.push([op, col, val])
      return chain
    })
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: filter("eq"),
      is: filter("is"),
      neq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => Promise.resolve(fallback)),
      maybeSingle: vi.fn().mockImplementation(() => Promise.resolve(fallback)),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockImplementation((values: unknown) => {
        write = { table, values, filters: [] }
        writes.push(write)
        return chain
      }),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(
          table === "jobs" && failJobUpdate.value ? { data: null, error: { message: "boom" } } : { data: null, error: null },
        ).then(resolve, reject),
    }
    return chain
  }
  const mockFrom = vi.fn().mockImplementation((table: string) => createChain(table, tableResponses.get(table) ?? null))
  const mockRpc = vi.fn()
  return { mockFrom, mockRpc, tableResponses, writes, failJobUpdate }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mockFrom, auth: { getUser: vi.fn() }, rpc: mockRpc },
}))
vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: vi.fn().mockResolvedValue({ ai_provider: "kie", cost_markup_percent: 0 }),
}))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  llmMeteredPricing: () => true,
}))

import { CreditsService, invalidateModelPricingCache } from "../credits.js"

function price(credits: number): void {
  tableResponses.set("model_pricing", { data: { credit_cost: credits, is_enabled: true, tier_restriction: null }, error: null })
}

function jobLinks() {
  return writes.filter((w) => w.table === "jobs" && (w.values as Record<string, unknown>).usage_log_id !== undefined)
}

beforeEach(() => {
  vi.clearAllMocks()
  tableResponses.clear()
  writes.length = 0
  failJobUpdate.value = false
  invalidateModelPricingCache()
  tableResponses.set("profiles", {
    data: { tier: "pro", subscription_tier: "pro", lifetime_topup_credits: 0, subscription_credits: 100, topup_credits: 0 },
    error: null,
  })
  price(5)
  mockRpc.mockResolvedValue({ data: LOG, error: null })
})

describe("reserveCredits links the job it reserves for", () => {
  it("a paid reservation links the requester's own, still-unlinked job", async () => {
    const result = await CreditsService.reserveCredits("user-1", JOB, "gpt-image-2", 0, 0, {})
    expect(result.usageLogId).toBe(LOG)
    expect(jobLinks()).toEqual([
      {
        table: "jobs",
        values: { usage_log_id: LOG },
        filters: [["eq", "id", JOB], ["eq", "user_id", "user-1"], ["is", "usage_log_id", null]],
      },
    ])
  })

  it("a zero-cost reservation links its free row the same way", async () => {
    price(0)
    tableResponses.set("usage_logs", { data: { id: LOG }, error: null })
    const result = await CreditsService.reserveCredits("user-1", JOB, "free-model", 0, 0, {})
    expect(result.usageLogId).toBe(LOG)
    expect(mockRpc).not.toHaveBeenCalled()
    expect(jobLinks()).toHaveLength(1)
    expect(jobLinks()[0]!.filters).toContainEqual(["eq", "id", JOB])
  })

  it("a job id that names no job row (the internal route accepts any string) writes nothing", async () => {
    await CreditsService.reserveCredits("user-1", "pipeline:not-a-job", "gpt-image-2", 0, 0, {})
    expect(jobLinks()).toEqual([])
  })

  it("a failed zero-cost insert (log-failed) links nothing", async () => {
    price(0)
    tableResponses.set("usage_logs", { data: null, error: { message: "insert failed" } })
    const result = await CreditsService.reserveCredits("user-1", JOB, "free-model", 0, 0, {})
    expect(result.usageLogId).toBe("log-failed")
    expect(jobLinks()).toEqual([])
  })

  it("a job-once reservation leaves the link to its RPC (migration 391 writes it in SQL)", async () => {
    mockRpc.mockResolvedValue({ data: { usageLogId: LOG, creditsReserved: 5, watermark: false, replayed: false }, error: null })
    await CreditsService.reserveCredits("user-1", JOB, "gpt-image-2", 0, 0, { oncePerJob: true })
    expect(mockRpc.mock.calls[0]![0]).toBe("reserve_job_credits")
    expect(jobLinks()).toEqual([])
  })

  it("554: a metered SIDE hold reserves through its own RPC, names the job only there, and never links or writes the job", async () => {
    mockRpc.mockResolvedValue({ data: { usageLogId: LOG, creditsReserved: 4, replayed: false, ledger: null }, error: null })
    const result = await CreditsService.reserveCredits("user-1", JOB, "image-to-text:claude-sonnet-5.5", 0, 0, {
      creditOverride: 4,
      isAppRun: true,
      sideHold: { key: "take:1" },
    })
    expect(result).toEqual({ usageLogId: LOG, creditsReserved: 4, watermark: false, replayed: false })
    const [fn, args] = mockRpc.mock.calls[0]! as [string, Record<string, unknown>]
    expect(fn).toBe("reserve_llm_side_hold")
    expect(args).toMatchObject({ p_user_id: "user-1", p_credits: 4, p_job_id: JOB, p_charge_id: "image-to-text:claude-sonnet-5.5", p_hold_key: "take:1", p_is_app_run: true })
    expect(writes.filter((w) => w.table === "jobs")).toEqual([])
    // Its ledger line is written by the RPC, in its transaction — never a second one here.
    expect(mockFrom.mock.calls.map(([t]) => t)).not.toContain("credit_transactions")
  })

  it("554: a replayed side hold returns what it recorded so far", async () => {
    const ledger = { calls: 1, attempts: [{ lane: "kie" }] }
    mockRpc.mockResolvedValue({ data: { usageLogId: LOG, creditsReserved: 4, replayed: true, ledger }, error: null })
    const result = await CreditsService.reserveCredits("user-1", JOB, "image-to-text:claude-sonnet-5.5", 0, 0, { creditOverride: 4, sideHold: { key: "take:1" } })
    expect(result).toMatchObject({ replayed: true, sideLedger: ledger })
  })

  it("554: a side-hold response that cannot be verified is an error, never a hold", async () => {
    mockRpc.mockResolvedValue({ data: { usageLogId: LOG, creditsReserved: 99, replayed: false }, error: null })
    await expect(CreditsService.reserveCredits("user-1", JOB, "image-to-text:claude-sonnet-5.5", 0, 0, { creditOverride: 4, sideHold: {} })).rejects.toThrow(/could not be verified/)
  })

  it("a link that cannot be written never fails the reservation", async () => {
    failJobUpdate.value = true
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const result = await CreditsService.reserveCredits("user-1", JOB, "gpt-image-2", 0, 0, {})
      expect(result.usageLogId).toBe(LOG)
      expect(err).toHaveBeenCalledWith(expect.stringContaining(`could not link job ${JOB}`), "boom")
    } finally {
      err.mockRestore()
    }
  })
})
