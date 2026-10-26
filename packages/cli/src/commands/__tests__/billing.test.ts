import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { billingCommand } from "../billing.js"
import { emit, table, detail, info } from "../../output.js"

const mocks = {
  plans: vi.fn(),
  subscription: vi.fn(),
  surface: vi.fn(),
  account: vi.fn(),
  history: vi.fn(),
  exportHistory: vi.fn(),
}

// The wiring of each subcommand. Which client the public ones build (no
// credential, any instance) is billing-public.test.ts, unmocked.
vi.mock("../../client.js", () => ({
  buildClient: () => ({ billing: mocks, credits: mocks }),
  buildPublicClient: () => ({ billing: mocks }),
  handleError: (err: unknown) => {
    throw err
  },
}))

vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return { ...actual, emit: vi.fn(), table: vi.fn(), detail: vi.fn(), info: vi.fn(), dim: vi.fn() }
})

const GIB = 1024 * 1024 * 1024

const BASIC = {
  id: "basic",
  name: "Basic",
  prices: {
    monthly: { amount: 12, currency: "USD", credits: { amount: 400, per: "month" } },
    yearly: { amount: 120, currency: "USD", perMonth: 10, credits: null as { amount: number; per: string } | null },
  },
  signupCredits: null,
  parallelism: 4,
  storageBytes: 10 * GIB,
}

const PLANS = {
  data: [{ id: "free", name: "Free", prices: null, signupCredits: 100, parallelism: 2, storageBytes: GIB }, BASIC],
  topUps: [
    { id: "topup-10", credits: 300, price: { amount: 10, currency: "USD" } },
    { id: "topup-25", credits: 800, price: null },
  ],
  topUpRange: { min: 5, max: 1000, currency: "USD" },
}

async function runCmd(...args: string[]): Promise<void> {
  const program = new Command().exitOverride()
  program.addCommand(billingCommand())
  await program.parseAsync(["node", "test", ...args])
}

describe("billing command", () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset()
    vi.mocked(emit).mockReset()
    vi.mocked(table).mockReset()
    vi.mocked(detail).mockReset()
    vi.mocked(info).mockReset()
  })

  it("registers plans, subscription, account, history and surface", () => {
    expect(billingCommand().commands.map((c) => c.name()).sort()).toEqual(["account", "history", "plans", "subscription", "surface"])
  })

  const ENTRY = {
    id: "l-1",
    at: "2026-10-26T16:07:00.000Z",
    kind: "usage",
    source: "usage",
    amount: -15,
    balanceAfter: 2950,
    pool: "topup",
    description: "Job job-1: nano-banana",
    model: "nano-banana",
    provider: "kie",
    charge: 12,
    status: "committed",
    job: { id: "job-1", type: "generate-image", status: "completed", startedAt: null, completedAt: null, durationMs: null, workflowId: null, sessionId: null },
    receiptUrl: null,
  }
  const PURCHASE = { ...ENTRY, id: "l-2", at: "2026-10-25T22:02:00.000Z", kind: "purchase", source: "one_time_purchase", amount: 3000, balanceAfter: 3085, description: "Credit pack", model: null, provider: null, charge: null, status: null, job: null }

  it("history passes the filters and the page to the SDK, and prints one row per movement with the charge for a run", async () => {
    mocks.history.mockResolvedValueOnce({ data: [ENTRY, PURCHASE], nextCursor: "2026-10-25T22:02:00.000Z" })
    await runCmd("billing", "history", "--kind", "usage", "--model", "nano-banana", "--since", "2026-10-01T00:00:00Z", "--until", "2026-10-31T00:00:00Z", "--search", "nano", "--limit", "20", "--cursor", "c1")
    expect(mocks.history).toHaveBeenCalledWith({ kind: "usage", model: "nano-banana", from: "2026-10-01T00:00:00Z", to: "2026-10-31T00:00:00Z", q: "nano", limit: 20, cursor: "c1" })
    const [rows, cols] = vi.mocked(table).mock.calls[0]!
    expect(cols).toEqual(["at", "kind", "what", "credits", "status", "balance", "job"])
    expect(rows[0]).toEqual({ at: "2026-10-26 16:07", kind: "usage", what: "nano-banana", credits: 12, status: "committed", balance: 2950, job: "job-1" })
    expect(rows[1]).toEqual({ at: "2026-10-25 22:02", kind: "purchase", what: "Credit pack", credits: 3000, status: "", balance: 3085, job: "" })
  })

  it("history --json emits the page whole; --csv writes the SDK's file to stdout without the page options", async () => {
    mocks.history.mockResolvedValueOnce({ data: [], nextCursor: null })
    await runCmd("billing", "history", "--json")
    expect(emit).toHaveBeenCalledWith({ data: [], nextCursor: null }, expect.objectContaining({ json: true }))

    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    mocks.exportHistory.mockResolvedValueOnce("at,kind\r\n")
    await runCmd("billing", "history", "--csv", "--kind", "purchase", "--limit", "5")
    expect(mocks.exportHistory).toHaveBeenCalledWith({ kind: "purchase", model: undefined, from: undefined, to: undefined, q: undefined })
    expect(write).toHaveBeenCalledWith("at,kind\r\n")
    write.mockRestore()
  })

  it("history refuses an unknown --kind and a --limit out of range before calling the SDK", async () => {
    await expect(runCmd("billing", "history", "--kind", "gifts")).rejects.toThrow(/--kind/)
    await expect(runCmd("billing", "history", "--limit", "500")).rejects.toThrow(/--limit/)
    expect(mocks.history).not.toHaveBeenCalled()
  })

  it("plans --json emits the SDK answer whole", async () => {
    mocks.plans.mockResolvedValueOnce(PLANS)
    await runCmd("billing", "plans", "--json")
    expect(mocks.plans).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith(PLANS, expect.objectContaining({ json: true }))
    expect(table).not.toHaveBeenCalled()
  })

  it("plans prints one row per plan and one per credit pack", async () => {
    mocks.plans.mockResolvedValueOnce(PLANS)
    await runCmd("billing", "plans")
    const [planRows, planCols] = vi.mocked(table).mock.calls[0]!
    expect(planRows.map((r) => r.id)).toEqual(["free", "basic"])
    expect(planCols).toEqual(["id", "name", "monthly", "yearly", "credits", "parallel", "storage"])
    // The free plan has nothing to pay, and its credits are a one-time grant.
    expect(planRows[0]).toMatchObject({ monthly: "free", yearly: "free", credits: "100 once", storage: "1 GB" })
    // A paid plan's credits are what each price states; the yearly price states none here.
    expect(planRows[1]).toMatchObject({ credits: "400 / month", parallel: 4, storage: "10 GB" })
    const [packRows] = vi.mocked(table).mock.calls[1]!
    expect(packRows.map((r) => r.credits)).toEqual(["300", "800"])
    expect(packRows[1]).toMatchObject({ price: "unavailable" })
  })

  it("plans says a grant once when both prices state the same one", async () => {
    mocks.plans.mockResolvedValueOnce({
      ...PLANS,
      data: [{ ...BASIC, prices: { ...BASIC.prices, yearly: { ...BASIC.prices.yearly, credits: { amount: 400, per: "month" } } } }],
    })
    await runCmd("billing", "plans")
    const [rows] = vi.mocked(table).mock.calls[0]!
    expect(rows[0]).toMatchObject({ credits: "400 / month" })
  })

  it("plans shows the yearly price's grant beside the monthly one when they differ", async () => {
    mocks.plans.mockResolvedValueOnce({
      ...PLANS,
      data: [{ ...BASIC, prices: { ...BASIC.prices, yearly: { ...BASIC.prices.yearly, credits: { amount: 400, per: "year" } } } }],
    })
    await runCmd("billing", "plans")
    const [rows] = vi.mocked(table).mock.calls[0]!
    expect(rows[0]).toMatchObject({ credits: "400 / month (yearly: 400 / year)" })
  })

  it("plans shows a price it could not read as unavailable, never as free", async () => {
    mocks.plans.mockResolvedValueOnce({
      ...PLANS,
      data: [{ ...BASIC, prices: { monthly: null, yearly: null } }],
    })
    await runCmd("billing", "plans")
    const [rows] = vi.mocked(table).mock.calls[0]!
    expect(rows[0]).toMatchObject({ monthly: "unavailable", yearly: "unavailable", credits: "-" })
  })

  it("subscription prints the record, and the tier when there is none", async () => {
    mocks.subscription.mockResolvedValueOnce({ data: null, effectiveTier: "payg" })
    await runCmd("billing", "subscription")
    expect(info).toHaveBeenCalledWith(expect.stringContaining("payg"))

    mocks.subscription.mockResolvedValueOnce({ data: { tier: "pro", status: "active" }, effectiveTier: "pro" })
    await runCmd("billing", "subscription", "--json")
    expect(emit).toHaveBeenCalledWith({ data: { tier: "pro", status: "active" }, effectiveTier: "pro" }, expect.objectContaining({ json: true }))
  })

  it("account and surface print what the SDK returns", async () => {
    mocks.account.mockResolvedValueOnce({ plan: "pro", balance: 5, dailyAllowance: null, unit: "credits" })
    await runCmd("billing", "account")
    expect(detail).toHaveBeenCalledWith({ plan: "pro", balance: 5, dailyAllowance: null, unit: "credits" })

    mocks.surface.mockResolvedValueOnce({ providerId: "none" })
    await runCmd("billing", "surface", "--json")
    expect(emit).toHaveBeenCalledWith({ providerId: "none" }, expect.objectContaining({ json: true }))
  })

  it("account says so when the provider could not answer", async () => {
    mocks.account.mockResolvedValueOnce(null)
    await runCmd("billing", "account")
    expect(detail).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith(expect.stringContaining("could not"))
  })
})
