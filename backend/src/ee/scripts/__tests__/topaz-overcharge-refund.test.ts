/**
 * Topaz overcharge refund script.
 *
 * The pure exports are driven directly; every gate, the idempotency probes and
 * the CLI refusals are driven through `main(argv)` against a mocked Supabase
 * client and a mocked `CreditsService`, mirroring the `vi.hoisted` chain-mock
 * pattern in `ee/billing/__tests__/deployment-payer-credits.test.ts`.
 *
 * `main` RETURNS its outcome instead of setting `process.exitCode`, so a test
 * that drives a refusal cannot poison the exit status of the whole vitest run.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockFrom, mockAdjust, mockPrice, state } = vi.hoisted(() => {
  const state = {
    jobs: [] as Array<Record<string, unknown>>,
    usageLogs: [] as Array<Record<string, unknown>>,
    anomalies: [] as Array<Record<string, unknown>>,
    tagTxs: [] as Array<Record<string, unknown>>,
    goodwillTxs: [] as Array<Record<string, unknown>>,
    /** Consumed one entry per query when set — drives the paging test. */
    goodwillPages: [] as Array<Array<Record<string, unknown>>>,
    prices: {} as Record<string, number>,
    insertError: null as null | { message: string },
    inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
  }

  type Op = { fn: string; args: unknown[] }
  const BUILDERS = ["select", "eq", "in", "gte", "lt", "lte", "order", "range", "ilike", "not", "is", "limit"]

  function chain(table: string) {
    const ops: Op[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proxy: any = {}
    for (const fn of BUILDERS) {
      proxy[fn] = (...args: unknown[]) => { ops.push({ fn, args }); return proxy }
    }
    proxy.insert = (values: Record<string, unknown>) => {
      state.inserts.push({ table, values })
      ops.push({ fn: "insert", args: [values] })
      return proxy
    }
    const resolveResponse = () => {
      if (table === "jobs") return { data: state.jobs, error: null }
      if (table === "usage_logs") return { data: state.usageLogs, error: null }
      if (table === "credit_anomalies") {
        if (ops.some((o) => o.fn === "insert")) return { data: null, error: state.insertError }
        return { data: state.anomalies, error: null }
      }
      if (table === "credit_transactions") {
        // The tag probe is the one that filters with `ilike`; the goodwill
        // probe filters with two `in`s.
        if (ops.some((o) => o.fn === "ilike")) return { data: state.tagTxs, error: null }
        // The goodwill probe pages, so serve one page per call when the test
        // supplied a page list; a single short page otherwise ends the loop.
        if (state.goodwillPages.length > 0) return { data: state.goodwillPages.shift() ?? [], error: null }
        return { data: state.goodwillTxs, error: null }
      }
      return { data: [], error: null }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    proxy.then = (res: any, rej: any) => Promise.resolve(resolveResponse()).then(res, rej)
    return proxy
  }

  return {
    mockFrom: vi.fn((table: string) => chain(table)),
    mockAdjust: vi.fn().mockResolvedValue({ newBalance: 0 }),
    mockPrice: vi.fn(async (id: string) => ({ creditCost: state.prices[id] ?? 0 })),
    state,
  }
})

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mockFrom } }))
vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { adminAdjustCredits: mockAdjust },
  getModelCreditCostFromDB: mockPrice,
}))

import { deliveredIdentifierFor, topazRefundRowFrom, parseArgs, main, isWorkspacePayer } from "../topaz-overcharge-refund.js"

const input = (o: Record<string, unknown>) => ({ provider: "topaz-image-upscale", ...o })

// ── the pure exports ──

describe("deliveredIdentifierFor — what the worker actually rendered", () => {
  it("a 4K/8K target with no explicit factor rendered the KIE default 2x = the bare tier", () => {
    expect(deliveredIdentifierFor(input({ targetResolution: "4K" }))).toBe("topaz-image-upscale")
    expect(deliveredIdentifierFor(input({ targetResolution: "8K" }))).toBe("topaz-image-upscale")
  })
  it("an explicit factor was forwarded verbatim", () => {
    expect(deliveredIdentifierFor(input({ targetResolution: "8K", upscaleFactor: "4" }))).toBe("topaz-image-upscale:4K")
    expect(deliveredIdentifierFor(input({ targetResolution: "8K", upscaleFactor: "1" }))).toBe("topaz-image-upscale")
  })
  it("an out-of-enum factor fell through to the model default", () => {
    expect(deliveredIdentifierFor(input({ targetResolution: "4K", upscaleFactor: "8" }))).toBe("topaz-image-upscale")
  })
  it("inherits the shared resolver's parsing rather than re-implementing it", () => {
    // Padding is trimmed by resolveTopazUpscale, which is the ONLY place this
    // script decides what a factor string means. A hand-rolled parser here
    // would answer "topaz-image-upscale" and silently over-refund a user who
    // really did buy — and receive — the 4x render.
    expect(deliveredIdentifierFor(input({ targetResolution: "8K", upscaleFactor: "  4  " }))).toBe("topaz-image-upscale:4K")
  })
  it("returns null for a non-topaz job", () => {
    expect(deliveredIdentifierFor({ provider: "recraft-upscale" })).toBeNull()
  })
})

describe("topazRefundRowFrom — charged comes from the usage log, never a static table", () => {
  const job = { id: "j1", user_id: "u1", usage_log_id: "l1", input_data: input({ targetResolution: "4K" }) }
  const log = (o: Record<string, unknown> = {}) => ({ id: "l1", user_id: "u1", credits_used: 60, ...o })

  it("refunds the difference between the logged charge and the recomputed correct charge", () => {
    const row = topazRefundRowFrom(job, log(), 30)
    expect(row).toMatchObject({ jobId: "j1", userId: "u1", charged: 60, correct: 30, refund: 30 })
  })

  it("carries the marked-up numbers through unchanged (no static-table arithmetic)", () => {
    // 50 and 25 are the BASE tiers; a 20% markup makes the real debit 60/30.
    const row = topazRefundRowFrom(job, log(), 30)
    expect(row?.charged).not.toBe(50)
    expect(row?.correct).not.toBe(25)
  })

  it("refunds nothing when the job already got what it paid for", () => {
    const ok = { ...job, input_data: input({ targetResolution: "4K", upscaleFactor: "4" }) }
    expect(topazRefundRowFrom(ok, log(), 60)?.refund).toBe(0)
  })

  it("never produces a negative refund", () => {
    expect(topazRefundRowFrom(job, log({ credits_used: 20 }), 30)?.refund).toBe(0)
  })

  it("returns null when the usage log is missing — the caller must refuse, not guess", () => {
    expect(topazRefundRowFrom(job, null, 30)).toBeNull()
  })

  it("returns null when the usage log carries no usable amount", () => {
    expect(topazRefundRowFrom(job, log({ credits_used: null }), 30)).toBeNull()
  })

  it("returns null when the usage log names no payee", () => {
    expect(topazRefundRowFrom(job, log({ user_id: null }), 30)).toBeNull()
  })

  it("pays usage_logs.user_id, NOT jobs.user_id — the deployment payer is the debited account", () => {
    const row = topazRefundRowFrom(
      { ...job, user_id: "requester-1" },
      log({ user_id: "payer-1", on_behalf_of: "requester-1" }),
      30,
    )
    expect(row?.userId).toBe("payer-1")
    expect(row?.requesterUserId).toBe("requester-1")
    expect(row?.onBehalfOf).toBe("requester-1")
  })

  it("marks a workspace/org-paid row so it can be set aside", () => {
    const ws = topazRefundRowFrom(job, log({ workspace_id: "ws-1" }), 30)
    expect(isWorkspacePayer(ws!)).toBe(true)
    const org = topazRefundRowFrom(job, log({ org_id: "org-1" }), 30)
    expect(isWorkspacePayer(org!)).toBe(true)
    expect(isWorkspacePayer(topazRefundRowFrom(job, log(), 30)!)).toBe(false)
  })
})

// ── the CLI ──

describe("parseArgs — a malformed flag refuses, it never defaults", () => {
  const UNTIL = ["--until", "2026-09-02T00:00:00Z"]

  it("requires --until", () => {
    const r = parseArgs([])
    expect("error" in r && r.error[0]).toContain("--until")
  })
  it("rejects an unparseable --until", () => {
    const r = parseArgs(["--until", "nonsense"])
    expect("error" in r && r.error[0]).toContain("not a parseable timestamp")
  })
  it("rejects a non-numeric --limit", () => {
    const r = parseArgs([...UNTIL, "--limit", "one"])
    expect("error" in r && r.error[0]).toContain("--limit must be a positive integer")
  })
  it("rejects --limit 0", () => {
    const r = parseArgs([...UNTIL, "--limit", "0"])
    expect("error" in r && r.error[0]).toContain("--limit must be a positive integer")
  })
  it("rejects --dry-run together with --apply", () => {
    const r = parseArgs([...UNTIL, "--dry-run", "--apply", "--admin-user-id", "admin-1"])
    expect("error" in r && r.error[0]).toContain("contradictory")
  })
  it("rejects --apply without an admin id", () => {
    const r = parseArgs([...UNTIL, "--apply"])
    expect("error" in r && r.error[0]).toContain("--admin-user-id")
  })
  it("defaults to a dry run with a sane window", () => {
    const r = parseArgs(UNTIL)
    expect("args" in r && r.args.apply).toBe(false)
    expect("args" in r && r.args.limit).toBe(Infinity)
    expect("args" in r && r.args.since).toBe("2026-03-10T00:00:00.000Z")
  })
  it("accepts an explicit --dry-run and a positive --limit", () => {
    const r = parseArgs([...UNTIL, "--dry-run", "--limit", "1"])
    expect("args" in r && r.args.apply).toBe(false)
    expect("args" in r && r.args.limit).toBe(1)
  })
})

// ── the gates, end to end ──

const UNTIL = ["--until", "2026-09-02T00:00:00Z"]
const APPLY = ["--apply", "--admin-user-id", "admin-1"]

/** A 4K job with no factor: billed the :4K tier, rendered the bare one. */
function seed(over: { job?: Record<string, unknown>; log?: Record<string, unknown> } = {}) {
  state.jobs = [{
    id: "job-1",
    user_id: "user-1",
    usage_log_id: "log-1",
    input_data: input({ targetResolution: "4K" }),
    created_at: "2026-08-01T00:00:00Z",
    ...over.job,
  }]
  state.usageLogs = [{
    id: "log-1",
    user_id: "user-1",
    on_behalf_of: null,
    workspace_id: null,
    org_id: null,
    credits_used: 50,
    credits_charged: 50,
    status: "committed",
    ...over.log,
  }]
}

beforeEach(() => {
  state.jobs = []
  state.usageLogs = []
  state.anomalies = []
  state.tagTxs = []
  state.goodwillTxs = []
  state.goodwillPages = []
  state.inserts = []
  state.insertError = null
  // Charged 50 for the :4K tier; the bare tier it actually got is 25.
  state.prices = { "topaz-image-upscale": 25, "topaz-image-upscale:4K": 50 }
  mockAdjust.mockClear()
  mockFrom.mockClear()
})

describe("main — gates", () => {
  it("GATE 1: a candidate with no usage_log_id aborts the whole run", async () => {
    seed({ job: { usage_log_id: null } })
    const r = await main(UNTIL)
    expect(r.ok).toBe(false)
    expect(r.refusal).toContain("no usage_log_id")
    expect(r.rows).toHaveLength(0)
  })

  it("GATE 2: a usage log with no payee aborts the whole run", async () => {
    seed({ log: { user_id: null } })
    const r = await main(UNTIL)
    expect(r.ok).toBe(false)
    expect(r.refusal).toContain("no payee")
  })

  it("GATE 3: a usage log already reversed aborts the whole run", async () => {
    seed({ log: { status: "refunded" } })
    const r = await main(UNTIL)
    expect(r.ok).toBe(false)
    expect(r.refusal).toContain("status='refunded'")
  })

  it("GATE 4: a true-up row is listed for manual handling, and the run proceeds", async () => {
    // The shape production dry run #1 hit: used=70, charged=30, two pricing eras.
    seed({ log: { credits_used: 70, credits_charged: 30 } })
    const r = await main([...UNTIL, ...APPLY])
    expect(r.ok).toBe(true)
    expect(r.manual.map((m) => m.row.jobId)).toEqual(["job-1"])
    expect(r.manual[0]?.reason).toBe("true-up: used=70 charged=30 — net debit is credits_charged; pricing era differs")
    // never payable, never counted
    expect(r.rows).toHaveLength(0)
    expect(r.total).toBe(0)
    expect(r.refunded).toBe(0)
    expect(mockAdjust).not.toHaveBeenCalled()
  })

  it("GATE 4: one true-up row does not stop the healthy rows beside it", async () => {
    seed()
    state.jobs.push({
      id: "job-2", user_id: "user-2", usage_log_id: "log-2",
      input_data: input({ targetResolution: "4K" }), created_at: "2026-08-02T00:00:00Z",
    })
    state.usageLogs.push({
      id: "log-2", user_id: "user-2", on_behalf_of: null, workspace_id: null, org_id: null,
      credits_used: 70, credits_charged: 30, status: "committed",
    })
    const r = await main([...UNTIL, ...APPLY])
    expect(r.ok).toBe(true)
    expect(r.rows.map((x) => x.jobId)).toEqual(["job-1"])
    expect(r.manual.map((m) => m.row.jobId)).toEqual(["job-2"])
    expect(r.total).toBe(25)
    expect(mockAdjust).toHaveBeenCalledTimes(1)
    expect(mockAdjust).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1" }))
  })

  it("GATE 4: a true-up row that owes nothing under EITHER number is not listed at all", async () => {
    // bare tier prices at 25; both readings are at or below it.
    seed({ log: { credits_used: 25, credits_charged: 20 } })
    const r = await main(UNTIL)
    expect(r.ok).toBe(true)
    expect(r.manual).toHaveLength(0)
    expect(r.rows).toHaveLength(0)
  })

  it("GATE 5: a workspace-paid row is set aside, not refused, and never credited", async () => {
    seed({ log: { workspace_id: "ws-1", org_id: "org-1" } })
    const r = await main([...UNTIL, ...APPLY])
    expect(r.ok).toBe(true)
    expect(r.manual.map((m) => m.row.jobId)).toEqual(["job-1"])
    expect(r.manual[0]?.reason).toContain("workspace/org payer")
    expect(r.rows).toHaveLength(0)
    expect(r.total).toBe(0)
    expect(mockAdjust).not.toHaveBeenCalled()
  })

  it("a healthy personal row is owed the difference and is paid to the debited account", async () => {
    seed()
    const r = await main([...UNTIL, ...APPLY])
    expect(r.ok).toBe(true)
    expect(r.total).toBe(25)
    expect(r.refunded).toBe(1)
    expect(mockAdjust).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1", amount: 25, creditType: "topup", adminUserId: "admin-1",
    }))
  })

  it("pays the PAYER, not the requester, under a deployment payer", async () => {
    seed({ job: { user_id: "requester-1" }, log: { user_id: "payer-1", on_behalf_of: "requester-1" } })
    const r = await main([...UNTIL, ...APPLY])
    expect(r.ok).toBe(true)
    expect(mockAdjust).toHaveBeenCalledWith(expect.objectContaining({ userId: "payer-1" }))
    expect(mockAdjust).not.toHaveBeenCalledWith(expect.objectContaining({ userId: "requester-1" }))
    // and the audit row records both
    expect(state.inserts[0]?.values.user_id).toBe("payer-1")
    expect(String(state.inserts[0]?.values.admin_notes)).toContain("requester-1")
  })

  it("prints both ids in the audit line when payer and requester differ", async () => {
    seed({ job: { user_id: "requester-1" }, log: { user_id: "payer-1", on_behalf_of: "requester-1" } })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await main(UNTIL)
    const line = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes("job-1") && l.includes("payer-1"))
    expect(line).toContain("requester-1")
    warn.mockRestore()
  })

  it("DRIFT: a row whose billed tier no longer prices at what it was charged is excluded and unpaid", async () => {
    seed({ log: { credits_used: 60, credits_charged: 60 } })   // :4K prices at 50 today
    const r = await main([...UNTIL, ...APPLY])
    expect(r.ok).toBe(true)
    expect(r.drifted).toEqual(["job-1"])
    expect(r.total).toBe(0)
    expect(r.refunded).toBe(0)
    expect(mockAdjust).not.toHaveBeenCalled()
  })

  it("a failed audit insert STOPS the run — the only reliable idempotency marker is missing", async () => {
    seed()
    state.insertError = { message: "boom" }
    const r = await main([...UNTIL, ...APPLY])
    expect(r.ok).toBe(false)
    expect(r.refusal).toContain("audit row insert failed")
    expect(mockAdjust).toHaveBeenCalledTimes(1)
  })
})

describe("main — idempotency", () => {
  it("probe 1: a tagged credit_anomalies row skips the job", async () => {
    seed()
    state.anomalies = [{ job_id: "job-1", admin_notes: "topaz-target-resolution-overcharge-2026-09: …" }]
    const r = await main([...UNTIL, ...APPLY])
    expect(r.rows).toHaveLength(0)
    expect(mockAdjust).not.toHaveBeenCalled()
  })

  it("probe 1 ignores an untagged anomaly row for the same job", async () => {
    seed()
    state.anomalies = [{ job_id: "job-1", admin_notes: "some unrelated anomaly" }]
    const r = await main(UNTIL)
    expect(r.rows.map((x) => x.jobId)).toEqual(["job-1"])
  })

  it("probe 2: a tagged admin_adjustment transaction naming the job skips it", async () => {
    seed()
    state.tagTxs = [{ description: "Topaz upscale overcharge refund (topaz-target-resolution-overcharge-2026-09) — job job-1" }]
    const r = await main([...UNTIL, ...APPLY])
    expect(r.rows).toHaveLength(0)
    expect(mockAdjust).not.toHaveBeenCalled()
  })

  it("a second --apply refunds nothing once the audit row exists", async () => {
    seed()
    const first = await main([...UNTIL, ...APPLY])
    expect(first.refunded).toBe(1)
    // the write the first run made is now visible to probe 1
    state.anomalies = [{ job_id: "job-1", admin_notes: String(state.inserts[0]?.values.admin_notes) }]
    mockAdjust.mockClear()
    const second = await main([...UNTIL, ...APPLY])
    expect(second.refunded).toBe(0)
    expect(mockAdjust).not.toHaveBeenCalled()
  })
})

describe("main — prior goodwill", () => {
  it("flags an earlier admin adjustment for the same payer without skipping the row", async () => {
    seed()
    state.goodwillTxs = [{
      user_id: "user-1", amount: 500, source: "admin_adjustment",
      description: "sorry about that", created_at: "2026-08-15T00:00:00Z",
    }]
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const r = await main(UNTIL)
    const line = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes("job-1") && l.includes("+500"))
    warn.mockRestore()
    expect(line).toContain("admin_adjustment")
    expect(r.rows).toHaveLength(1)   // a flag, never a skip
  })

  it("does not count this script's own refunds as prior goodwill", async () => {
    seed()
    state.goodwillTxs = [{
      user_id: "user-1", amount: 25, source: "admin_adjustment",
      description: "Topaz upscale overcharge refund (topaz-target-resolution-overcharge-2026-09) — job job-0",
      created_at: "2026-08-15T00:00:00Z",
    }]
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await main(UNTIL)
    const line = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes("job-1") && l.includes("| 25 |"))
    warn.mockRestore()
    expect(line?.endsWith("| -")).toBe(true)
  })

  it("pages the probe — a hit past the first full page is still found", async () => {
    seed()
    // A full page (PAGE_SIZE=200) forces a second request; the real hit is on it.
    const filler = Array.from({ length: 200 }, (_, i) => ({
      user_id: "someone-else", amount: 1, source: "refund",
      description: `filler ${i}`, created_at: "2026-08-10T00:00:00Z",
    }))
    state.goodwillPages = [filler, [{
      user_id: "user-1", amount: 777, source: "admin_adjustment",
      description: "made whole by hand", created_at: "2026-08-20T00:00:00Z",
    }]]
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await main(UNTIL)
    const line = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes("job-1") && l.includes("| 25 |"))
    warn.mockRestore()
    expect(state.goodwillPages).toHaveLength(0)   // both pages consumed
    expect(line).toContain("+777")
  })

  it("ignores an adjustment that predates the job", async () => {
    seed()
    state.goodwillTxs = [{
      user_id: "user-1", amount: 500, source: "admin_adjustment",
      description: "unrelated", created_at: "2026-07-01T00:00:00Z",
    }]
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await main(UNTIL)
    const line = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes("job-1") && l.includes("| 25 |"))
    warn.mockRestore()
    expect(line).not.toContain("+500")
  })
})
