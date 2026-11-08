/**
 * Media retention under a deployment payer (decided 2026-11-08).
 *
 * On a deployment with a payer, every user is stored on the free tier while
 * the payer holds the plan, so the two plan-keyed sweeps — the free-tier media
 * sweep and the canceled-subscription sweep — would reap everyone's library.
 * The rule (ee/billing/payer-media-retention.ts): while a payer is active they
 * keep every user's media, whatever plan the payer account itself is on.
 *
 * What these pin:
 *  - under a payer, neither sweep reads a single user, library row, job or
 *    location, and nothing is deleted or written — on a paid payer, a payg
 *    payer, a FREE payer (logged as a misconfiguration, never acted on), and a
 *    payer whose row cannot be read (an error, or a read that throws);
 *  - a profile that names a payer this process has not brought up keeps media
 *    too (the fail-safe direction);
 *  - without a payer the rule is inert: no query, no log, and the sweeps take
 *    exactly their previous path (the free-tier user list is still read).
 *
 * Every list read below answers with aged media, so a sweep that got past the
 * rule would have rows to reap; the assertions are on what it never asked for.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"

const h = vi.hoisted(() => {
  /** Each `from(table)` the code under test opened, with the calls made on it. */
  const calls: Array<{ table: string; ops: Array<[string, unknown[]]> }> = []
  const state = {
    /** What the payer's own `profiles` row read answers (an Error = the read throws). */
    payerRow: { data: null, error: null } as { data: unknown; error: unknown } | Error,
    /** `billing.payerAccount` on the surface profile. */
    payerAccount: undefined as string | undefined,
  }
  const AGED = "2020-01-01T00:00:00.000Z"
  /** The answer to a list read that ends in `.limit()`: aged rows everywhere. */
  const listAnswer = (table: string): { data: unknown; error: unknown } => {
    switch (table) {
      case "profiles":
        return {
          data: [
            { id: "user-a", tier: "free", subscription_tier: "free", lifetime_topup_credits: 0, last_topup_at: null },
            { id: "user-b", tier: "pro", subscription_tier: "pro", lifetime_topup_credits: 0, last_topup_at: null },
          ],
          error: null,
        }
      case "assets":
        return { data: [{ id: "asset-1", user_id: "user-a", r2_key: "images/asset-1.png", size_bytes: 1024, created_at: AGED }], error: null }
      case "jobs":
        return { data: [{ id: "job-1", user_id: "user-a", output_data: { imageUrl: "https://cdn.example.com/images/job-1.png" } }], error: null }
      default:
        return { data: [], error: null }
    }
  }
  const from = vi.fn((table: string) => {
    const rec = { table, ops: [] as Array<[string, unknown[]]> }
    calls.push(rec)
    const chain: Record<string, unknown> = {}
    const op =
      (name: string) =>
      (...args: unknown[]) => {
        rec.ops.push([name, args])
        return chain
      }
    for (const name of ["select", "eq", "neq", "or", "not", "is", "lt", "lte", "gt", "gte", "in", "order", "update", "upsert", "insert", "delete"]) {
      chain[name] = op(name)
    }
    const terminal = (name: string) => (...args: unknown[]) => {
      rec.ops.push([name, args])
      const row = state.payerRow
      return row instanceof Error ? Promise.reject(row) : Promise.resolve(row)
    }
    chain.maybeSingle = terminal("maybeSingle")
    chain.single = terminal("single")
    chain.limit = (...args: unknown[]) => {
      rec.ops.push(["limit", args])
      const answer = listAnswer(table)
      return { ...chain, then: (resolve: (v: unknown) => void) => resolve(answer) }
    }
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null })
    return chain
  })
  const rpc = vi.fn(async () => ({ data: null, error: null }))
  return {
    calls,
    state,
    from,
    rpc,
    deleteFromR2: vi.fn(async () => undefined),
    batchDeleteFromR2: vi.fn(async () => ({ deleted: 0, errors: 0 })),
    updateStorageUsage: vi.fn(async () => undefined),
  }
})

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: h.from, rpc: h.rpc, auth: { getUser: vi.fn() } } }))
vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    R2_PUBLIC_URL: "https://cdn.example.com",
    R2_ACCOUNT_ID: "test-account",
    R2_ACCESS_KEY_ID: "test-key",
    R2_SECRET_ACCESS_KEY: "test-secret",
    R2_BUCKET_NAME: "test-bucket",
  },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/surface-profile.js", () => ({
  runtimeSurfaceProfile: () => ({ billing: { payerAccount: h.state.payerAccount } }),
}))
vi.mock("@/lib/storage.js", () => ({ deleteFromR2: h.deleteFromR2, batchDeleteFromR2: h.batchDeleteFromR2 }))
vi.mock("@/utils/file-validation.js", () => ({ updateStorageUsage: h.updateStorageUsage }))
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { logTransaction: vi.fn(async () => true) } }))
vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: vi.fn() }))
vi.mock("@/ee/billing/balance-cache.js", () => ({ invalidateBalanceCache: vi.fn() }))

import { cleanupCanceledUserMedia, cleanupFreeUserMedia } from "../cleanup-service.js"
import { mediaKeptByDeploymentPayer } from "../payer-media-retention.js"
import { __resetDeploymentPayerForTests, __setDeploymentPayerForTests } from "@/lib/deployment-payer.js"

const PAYER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
const ZERO = { filesDeleted: 0, bytesFreed: 0, errors: 0 }

const SWEEPS = [
  ["the free-tier media sweep", cleanupFreeUserMedia],
  ["the canceled-subscription media sweep", cleanupCanceledUserMedia],
] as const

/** A payer account row as `profiles` stores it. */
function payerRow(tier: string, lifetimeTopups = 0): { data: unknown; error: null } {
  return { data: { tier, subscription_tier: tier, lifetime_topup_credits: lifetimeTopups }, error: null }
}

/** The tables the code under test opened, in order. */
const tablesOpened = (): string[] => h.calls.map((c) => c.table)

/** The one read the rule may make under a payer: the payer's own row, by id. */
function expectOnlyThePayerRowRead(): void {
  expect(tablesOpened()).toEqual(["profiles"])
  const ops = h.calls[0]!.ops
  expect(ops).toContainEqual(["eq", ["id", PAYER]])
  expect(ops.map(([name]) => name)).not.toContain("update")
}

/** Nothing reaped, cleared or written, by any path. */
function expectNothingTouched(): void {
  for (const table of ["assets", "jobs", "locations", "subscriptions", "usage_logs"]) {
    expect(tablesOpened(), table).not.toContain(table)
  }
  expect(h.deleteFromR2).not.toHaveBeenCalled()
  expect(h.batchDeleteFromR2).not.toHaveBeenCalled()
  expect(h.updateStorageUsage).not.toHaveBeenCalled()
  expect(h.rpc).not.toHaveBeenCalled()
  for (const c of h.calls) expect(c.ops.map(([name]) => name), c.table).not.toContain("update")
}

let warn: MockInstance<typeof console.warn>
let info: MockInstance<typeof console.info>
const logged = (spy: MockInstance<typeof console.warn>): string => spy.mock.calls.map((c) => c.join(" ")).join("\n")

beforeEach(() => {
  h.calls.length = 0
  h.from.mockClear()
  h.rpc.mockClear()
  h.deleteFromR2.mockClear()
  h.batchDeleteFromR2.mockClear()
  h.updateStorageUsage.mockClear()
  h.state.payerRow = payerRow("basic")
  h.state.payerAccount = undefined
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  info = vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  __resetDeploymentPayerForTests()
  vi.restoreAllMocks()
})

describe.each(SWEEPS)("%s under a deployment payer", (_name, sweep) => {
  beforeEach(() => {
    h.state.payerAccount = PAYER
    __setDeploymentPayerForTests(PAYER)
  })

  it("a payer on a paid plan: no user is read and nothing is reaped", async () => {
    h.state.payerRow = payerRow("basic")
    expect(await sweep()).toEqual(ZERO)
    expectOnlyThePayerRowRead()
    expectNothingTouched()
    expect(logged(info)).toMatch(/deployment payer is active/)
    expect(warn).not.toHaveBeenCalled()
  })

  it("a FREE payer: still nothing is reaped, and it is logged as a misconfiguration", async () => {
    h.state.payerRow = payerRow("free")
    expect(await sweep()).toEqual(ZERO)
    expectOnlyThePayerRowRead()
    expectNothingTouched()
    expect(logged(warn)).toMatch(/misconfiguration/i)
    expect(logged(warn)).toContain(PAYER)
  })

  it("a payg payer (free plan, prepaid credits): kept, and not a misconfiguration", async () => {
    h.state.payerRow = payerRow("free", 50_000)
    expect(await sweep()).toEqual(ZERO)
    expectNothingTouched()
    expect(warn).not.toHaveBeenCalled()
    expect(logged(info)).toMatch(/deployment payer is active/)
  })

  it("a payer row that cannot be read (an error): kept", async () => {
    h.state.payerRow = { data: null, error: { message: "connection reset" } }
    expect(await sweep()).toEqual(ZERO)
    expectNothingTouched()
    expect(logged(warn)).toMatch(/could not be read/)
  })

  it("a payer row that is missing: kept", async () => {
    h.state.payerRow = { data: null, error: null }
    expect(await sweep()).toEqual(ZERO)
    expectNothingTouched()
    expect(logged(warn)).toMatch(/could not be read/)
  })

  it("a payer row read that throws: kept, and the sweep does not throw", async () => {
    h.state.payerRow = new Error("socket hang up")
    expect(await sweep()).toEqual(ZERO)
    expectNothingTouched()
    expect(logged(warn)).toMatch(/could not be read/)
  })
})

describe.each(SWEEPS)("%s when the profile names a payer this process has not brought up", (_name, sweep) => {
  it("keeps media, reads nothing and says why", async () => {
    h.state.payerAccount = PAYER
    expect(await sweep()).toEqual(ZERO)
    expect(tablesOpened()).toEqual([])
    expectNothingTouched()
    expect(logged(warn)).toMatch(/has not brought it up/)
  })
})

describe("without a payer the rule is inert", () => {
  it("answers false with no query and no log", async () => {
    expect(await mediaKeptByDeploymentPayer("any sweep")).toBe(false)
    expect(h.from).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
  })

  it("the free-tier sweep still reads its free-tier user list (its previous path)", async () => {
    await cleanupFreeUserMedia()
    const userList = h.calls.find((c) => c.table === "profiles")
    expect(userList?.ops).toContainEqual(["or", ["tier.eq.free,tier.is.null"]])
    expect(logged(info)).not.toMatch(/deployment payer/)
  })

  it("the canceled-subscription sweep still reads its candidate list (its previous path)", async () => {
    await cleanupCanceledUserMedia()
    const userList = h.calls.find((c) => c.table === "profiles")
    expect(userList?.ops).toContainEqual(["neq", ["tier", "free"]])
    expect(logged(info)).not.toMatch(/deployment payer/)
  })
})
