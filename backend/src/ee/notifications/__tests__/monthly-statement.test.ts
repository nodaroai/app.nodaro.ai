import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/lib/config.js", () => ({ config: { LOOPS_MONTHLY_STATEMENT_ID: "tx_statement", PUBLIC_URL: "https://app.example.com/" } }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/deployment-payer.js", () => ({ deploymentPayerActive: vi.fn(() => false), deploymentPayerId: vi.fn(() => null) }))
vi.mock("@/ee/lib/loops-client.js", () => ({ sendTransactional: vi.fn() }))
vi.mock("@/ee/billing/usage-summary.js", () => ({ usageSummaryFor: vi.fn() }))
vi.mock("@/ee/notifications/notify-config.js", () => ({ readNotifyState: vi.fn(), writeNotifyState: vi.fn() }))
vi.mock("@/ee/notifications/founder-notify.js", () => ({ isStandbySender: vi.fn(() => false) }))

import { supabase } from "../../../lib/supabase.js"
import { config } from "../../../lib/config.js"
import { deploymentPayerActive, deploymentPayerId } from "../../../lib/deployment-payer.js"
import { sendTransactional } from "../../lib/loops-client.js"
import { usageSummaryFor } from "../../billing/usage-summary.js"
import { readNotifyState, writeNotifyState } from "../notify-config.js"
import { isStandbySender } from "../founder-notify.js"
import { STATEMENT_MAX_ATTEMPTS, maybeSendMonthlyStatements, monthBounds, monthLabel, previousMonthOf, sendMonthlyStatements, statementVariables } from "../monthly-statement.js"

type Result = { data: unknown; error: { message: string } | null }

/** A fluent chain that records every call; `range` and awaiting answer `result`. */
function chain(result: Result) {
  const calls: Array<[string, unknown[]]> = []
  const self: Record<string, unknown> = {}
  for (const name of ["select", "eq", "is", "not", "order", "gte", "lte", "limit", "insert", "upsert", "update", "delete"]) {
    self[name] = vi.fn((...args: unknown[]) => {
      calls.push([name, args])
      return self
    })
  }
  self.range = vi.fn((from: number, to: number) => {
    calls.push(["range", [from, to]])
    const data = Array.isArray(result.data) ? result.data.slice(from, to + 1) : result.data
    return Promise.resolve({ data, error: result.error })
  })
  self.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
  return { self, calls }
}

const FIRST = { id: "u1", email: "first@example.com", display_name: "Pat", subscription_credits: 100, topup_credits: 2850 }
const SECOND = { id: "u2", email: "second@example.com", display_name: null, subscription_credits: 0, topup_credits: 10 }

const SUMMARY = {
  period: { from: "2026-10-01T00:00:00.000Z", to: "2026-10-31T23:59:59.999Z", bucket: "month" },
  totals: { used: 1250, purchased: 3000, granted: 100, refunded: 7, runs: 42, avgPerRun: 29.8 },
  mostUsed: { model: "nano-banana", provider: "kie", credits: 900, runs: 30, share: 0.72 },
  byModel: [], byCategory: [{ category: "image", credits: 1000, runs: 40 }, { category: "video", credits: 250, runs: 2 }],
  overTime: [], bySession: [], byWorkflow: [], truncated: false, partial: false,
}

/**
 * The tables. `monthly_statements` answers its reads from `statements`; a
 * claim (an upsert or update followed by select) answers a fresh pending row
 * for the person, unless `claimRefused` — the unique constraint saying
 * someone else holds it.
 */
function tables(over: Partial<Record<string, Result>> = {}, statements: Array<{ id: string; user_id: string; status: string; attempts: number }> = [], claimRefused = false) {
  const made: Record<string, ReturnType<typeof chain>[]> = {}
  const results: Record<string, Result> = {
    profiles: { data: [FIRST, SECOND], error: null },
    transactions: { data: [{ type: "topup", amount_usd: "35.00" }, { type: "refund", amount_usd: "5.00" }], error: null },
    ...over,
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const c = chain(table === "monthly_statements" ? { data: statements, error: null } : (results[table] ?? { data: [], error: null }))
    if (table === "monthly_statements") {
      const record = c.self.select as (...a: unknown[]) => unknown
      c.self.select = vi.fn((...args: unknown[]) => {
        record(...args)
        const upsert = c.calls.find(([name]) => name === "upsert")
        const reclaim = c.calls.find(([name, a]) => name === "update" && (a[0] as { status?: string }).status === "pending")
        if (!upsert && !reclaim) return c.self
        if (claimRefused) return Promise.resolve({ data: [], error: null })
        if (upsert) {
          const row = upsert[1][0] as { user_id: string }
          return Promise.resolve({ data: [{ id: `row-${row.user_id}`, user_id: row.user_id, status: "pending", attempts: 0 }], error: null })
        }
        const id = (c.calls.find(([name, a]) => name === "eq" && a[0] === "id")?.[1][1] as string) ?? "?"
        const before = statements.find((s) => s.id === id)!
        return Promise.resolve({ data: [{ ...before, status: "pending" }], error: null })
      })
    }
    ;(made[table] ??= []).push(c)
    return c.self
  }) as never)
  return made
}

const patchesOf = (made: Record<string, ReturnType<typeof chain>[]>) =>
  (made.monthly_statements ?? []).flatMap((c) => c.calls.filter(([name]) => name === "update").map(([, args]) => args[0] as Record<string, unknown>))

beforeEach(() => {
  vi.mocked(supabase.from).mockReset()
  vi.mocked(sendTransactional).mockReset()
  vi.mocked(usageSummaryFor).mockReset().mockResolvedValue(SUMMARY as never)
  vi.mocked(readNotifyState).mockReset().mockResolvedValue(null)
  vi.mocked(writeNotifyState).mockReset().mockResolvedValue(undefined)
  vi.mocked(isStandbySender).mockReturnValue(false)
  vi.mocked(deploymentPayerActive).mockReturnValue(false)
  vi.mocked(deploymentPayerId).mockReturnValue(null)
  config.PUBLIC_URL = "https://app.example.com/"
})

describe("the month", () => {
  it("names the month before a date, its UTC bounds, and its label", () => {
    expect(previousMonthOf("2026-11-01")).toBe("2026-10")
    expect(previousMonthOf("2027-01-02")).toBe("2026-12")
    expect(monthBounds("2026-10")).toEqual({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-31T23:59:59.999Z" })
    expect(monthBounds("2026-02")).toEqual({ from: "2026-02-01T00:00:00.000Z", to: "2026-02-28T23:59:59.999Z" })
    expect(monthLabel("2026-10")).toBe("October 2026")
  })
})

describe("statementVariables", () => {
  it("is every template variable as a non-empty string, from the person's own figures; payments are net of refunds", () => {
    const vars = statementVariables(FIRST, "2026-10", SUMMARY as never, [{ type: "topup", amount_usd: "35.00" }, { type: "subscription", amount_usd: 12 }, { type: "refund", amount_usd: "5.00" }])
    expect(vars).toEqual({
      name: "Pat",
      month: "October 2026",
      monthKey: "2026-10",
      used: "1,250",
      runs: "42",
      avgPerRun: "29.8",
      purchased: "3,000",
      granted: "100",
      refunded: "7",
      topModel: "nano-banana",
      topModelCredits: "900",
      categories: "image 1,000 · video 250",
      paymentsCount: "2",
      paymentsUsd: "$42.00",
      refundsUsd: "$5.00",
      balance: "2,950",
      billingUrl: "https://app.example.com/billing",
    })
    for (const v of Object.values(vars)) {
      expect(typeof v).toBe("string")
      expect(v).not.toBe("")
    }
  })

  it("falls back to the email's local part, to dashes for a quiet month, to the Nodaro app without a public URL, and never to an empty string", () => {
    const quiet = { ...SUMMARY, totals: { used: 0, purchased: 0, granted: 0, refunded: 0, runs: 0, avgPerRun: 0 }, mostUsed: { model: "", provider: null, credits: 0, runs: 0, share: 0 }, byCategory: [] }
    config.PUBLIC_URL = ""
    const vars = statementVariables(SECOND, "2026-10", quiet as never, [])
    expect(vars).toMatchObject({ name: "second", topModel: "—", topModelCredits: "0", categories: "—", paymentsCount: "0", paymentsUsd: "$0.00", refundsUsd: "$0.00", balance: "10", billingUrl: "https://app.nodaro.ai/billing" })
    for (const v of Object.values(vars)) expect(v).not.toBe("")
  })
})

describe("sendMonthlyStatements", () => {
  it("claims each opted-in person's row BEFORE sending, sends once, settles the row, and closes the month when everyone is settled", async () => {
    const made = tables({}, [{ id: "row-u2", user_id: "u2", status: "sent", attempts: 0 }])
    vi.mocked(sendTransactional).mockResolvedValue({ ok: true, messageId: "m1" } as never)

    const result = await sendMonthlyStatements("2026-10")

    expect(result).toEqual({ sent: 1, unknown: 0, failed: 0, skipped: 1 })
    expect(sendTransactional).toHaveBeenCalledTimes(1)
    expect(sendTransactional).toHaveBeenCalledWith("tx_statement", "first@example.com", expect.objectContaining({ month: "October 2026", used: "1,250", paymentsUsd: "$30.00" }))
    expect(usageSummaryFor).toHaveBeenCalledWith("u1", { from: "2026-10-01T00:00:00.000Z", to: "2026-10-31T23:59:59.999Z", bucket: "month" })
    // The opted-in people only, with an email; the person's own, personal payments.
    expect(made.profiles![0]!.calls).toContainEqual(["eq", ["monthly_statement_email", true]])
    expect(made.profiles![0]!.calls).toContainEqual(["not", ["email", "is", null]])
    expect(made.transactions![0]!.calls).toContainEqual(["eq", ["user_id", "u1"]])
    expect(made.transactions![0]!.calls).toContainEqual(["is", ["org_id", null]])
    // The claim — refused by the unique constraint when the row exists — came before the send.
    const claimAt = vi.mocked(supabase.from).mock.calls.findIndex((_, i) => made.monthly_statements!.some((c) => c.calls.some(([n]) => n === "upsert")) && i === 2)
    expect(claimAt).toBeGreaterThanOrEqual(0)
    const claim = made.monthly_statements!.find((c) => c.calls.some(([name]) => name === "upsert"))!
    expect(claim.calls).toContainEqual(["upsert", [{ user_id: "u1", month: "2026-10", recipient_email: "first@example.com", status: "pending", attempts: 0 }, { onConflict: "user_id,month", ignoreDuplicates: true }]])
    expect(vi.mocked(sendTransactional).mock.invocationCallOrder[0]!).toBeGreaterThan((claim.self.upsert as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!)
    // The row was then marked sent.
    expect(patchesOf(made)).toContainEqual(expect.objectContaining({ status: "sent", message_id: "m1" }))
    expect(writeNotifyState).toHaveBeenCalledWith("notify_last_statement_month", "2026-10")
  })

  it("sends nothing when the claim is refused — another tick or replica holds the row", async () => {
    tables({}, [], true)
    vi.mocked(sendTransactional).mockResolvedValue({ ok: true } as never)
    const result = await sendMonthlyStatements("2026-10")
    expect(result).toEqual({ sent: 0, unknown: 0, failed: 0, skipped: 2 })
    expect(sendTransactional).not.toHaveBeenCalled()
    expect(writeNotifyState).not.toHaveBeenCalled()
  })

  it("skips a pending, sent or unknown row and a failed row that used its attempts; retries a failed row that has some left", async () => {
    tables({}, [
      { id: "r1", user_id: "u1", status: "pending", attempts: 0 },
      { id: "r2", user_id: "u2", status: "failed", attempts: STATEMENT_MAX_ATTEMPTS },
    ])
    vi.mocked(sendTransactional).mockResolvedValue({ ok: true } as never)
    expect(await sendMonthlyStatements("2026-10")).toEqual({ sent: 0, unknown: 0, failed: 0, skipped: 2 })
    expect(sendTransactional).not.toHaveBeenCalled()
    expect(writeNotifyState).not.toHaveBeenCalled() // u1 is still pending: the month stays open

    const made = tables({ profiles: { data: [SECOND], error: null } }, [{ id: "r2", user_id: "u2", status: "failed", attempts: 1 }])
    expect(await sendMonthlyStatements("2026-10")).toEqual({ sent: 1, unknown: 0, failed: 0, skipped: 0 })
    const reclaim = made.monthly_statements!.find((c) => c.calls.some(([name, args]) => name === "update" && (args[0] as { status?: string }).status === "pending"))!
    expect(reclaim.calls).toContainEqual(["eq", ["status", "failed"]])
    expect(sendTransactional).toHaveBeenCalledWith("tx_statement", "second@example.com", expect.anything())
    expect(writeNotifyState).toHaveBeenCalledWith("notify_last_statement_month", "2026-10")
  })

  it("records a timeout as unknown (the email may have gone, never again) and a provider refusal as a failed attempt; the month stays open", async () => {
    const made = tables()
    vi.mocked(sendTransactional)
      .mockResolvedValueOnce({ ok: false, failureKind: "timeout", error: "timeout" } as never)
      .mockResolvedValueOnce({ ok: false, failureKind: "provider", error: "bad template" } as never)
    const log = vi.fn()

    const result = await sendMonthlyStatements("2026-10", log)

    expect(result).toEqual({ sent: 0, unknown: 1, failed: 1, skipped: 0 })
    expect(patchesOf(made)).toContainEqual(expect.objectContaining({ status: "unknown" }))
    expect(patchesOf(made)).toContainEqual({ status: "failed", attempts: 1 })
    expect(writeNotifyState).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(expect.stringContaining("bad template"))
  })

  it("a failed summary read turns the claim into a failed attempt for that person alone", async () => {
    const made = tables()
    vi.mocked(usageSummaryFor).mockResolvedValueOnce({ error: { message: "down" } } as never).mockResolvedValueOnce(SUMMARY as never)
    vi.mocked(sendTransactional).mockResolvedValue({ ok: true } as never)
    const result = await sendMonthlyStatements("2026-10")
    expect(result).toEqual({ sent: 1, unknown: 0, failed: 1, skipped: 0 })
    expect(sendTransactional).toHaveBeenCalledTimes(1)
    expect(sendTransactional).toHaveBeenCalledWith("tx_statement", "second@example.com", expect.anything())
    expect(patchesOf(made)).toContainEqual({ status: "failed", attempts: 1 })
  })

  it("under a deployment payer only the payer's own statement goes: the end users' money is the payer's", async () => {
    vi.mocked(deploymentPayerActive).mockReturnValue(true)
    vi.mocked(deploymentPayerId).mockReturnValue("u2")
    tables()
    vi.mocked(sendTransactional).mockResolvedValue({ ok: true } as never)
    expect(await sendMonthlyStatements("2026-10")).toEqual({ sent: 1, unknown: 0, failed: 0, skipped: 0 })
    expect(sendTransactional).toHaveBeenCalledTimes(1)
    expect(sendTransactional).toHaveBeenCalledWith("tx_statement", "second@example.com", expect.anything())
    expect(writeNotifyState).toHaveBeenCalledWith("notify_last_statement_month", "2026-10")
  })
})

describe("maybeSendMonthlyStatements", () => {
  // 2026-11-01 09:30 Israel time (UTC+2 in November) is 07:30 UTC.
  const FIRST_MORNING = new Date("2026-11-01T07:30:00.000Z")

  it("runs from the digest hour of the 1st, for the month that just ended", async () => {
    tables()
    vi.mocked(sendTransactional).mockResolvedValue({ ok: true } as never)
    await maybeSendMonthlyStatements(FIRST_MORNING, 8, () => {})
    expect(sendTransactional).toHaveBeenCalledTimes(2)
    expect(usageSummaryFor).toHaveBeenCalledWith("u1", expect.objectContaining({ from: "2026-10-01T00:00:00.000Z" }))
  })

  it("waits before the digest hour, stops after the 3rd, and does nothing once the month is closed or on the standby sender", async () => {
    tables()
    vi.mocked(sendTransactional).mockResolvedValue({ ok: true } as never)
    await maybeSendMonthlyStatements(new Date("2026-11-01T05:30:00.000Z"), 8, () => {}) // 07:30 Israel, before 08
    await maybeSendMonthlyStatements(new Date("2026-11-04T07:30:00.000Z"), 8, () => {}) // the 4th
    vi.mocked(readNotifyState).mockResolvedValueOnce("2026-10")
    await maybeSendMonthlyStatements(FIRST_MORNING, 8, () => {})
    vi.mocked(isStandbySender).mockReturnValueOnce(true)
    await maybeSendMonthlyStatements(FIRST_MORNING, 8, () => {})
    expect(sendTransactional).not.toHaveBeenCalled()
  })

  it("keeps trying on the 2nd for a month still open, one tick at a time: an overlapping tick is refused by the latch", async () => {
    tables()
    let release: (v: unknown) => void = () => {}
    vi.mocked(sendTransactional).mockImplementationOnce(() => new Promise((r) => (release = r)) as never).mockResolvedValue({ ok: true } as never)
    const first = maybeSendMonthlyStatements(new Date("2026-11-02T10:00:00.000Z"), 8, () => {})
    await new Promise((r) => setTimeout(r, 0))
    await maybeSendMonthlyStatements(new Date("2026-11-02T10:05:00.000Z"), 8, () => {})
    release({ ok: true })
    await first
    expect(sendTransactional).toHaveBeenCalledTimes(2) // the first tick's two people, nothing from the second
  })

  it("never throws: a failed profiles read is logged", async () => {
    tables({ profiles: { data: null, error: { message: "down" } } })
    const log = vi.fn()
    await maybeSendMonthlyStatements(FIRST_MORNING, 8, log)
    expect(log).toHaveBeenCalledWith(expect.stringContaining("profiles read failed"))
  })
})
