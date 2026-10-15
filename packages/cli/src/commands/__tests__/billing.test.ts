import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { billingCommand } from "../billing.js"
import { emit, table, detail, info } from "../../output.js"

const mocks = {
  plans: vi.fn(),
  subscription: vi.fn(),
  surface: vi.fn(),
  account: vi.fn(),
}

// The wiring of each subcommand. Which client the public ones build (no
// credential, any instance) is billing-public.test.ts, unmocked.
vi.mock("../../client.js", () => ({
  buildClient: () => ({ billing: mocks }),
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

  it("registers plans, subscription, account and surface", () => {
    expect(billingCommand().commands.map((c) => c.name()).sort()).toEqual(["account", "plans", "subscription", "surface"])
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
