import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * WS0 — the READ half of the one module that may touch the allowance tables.
 *
 * The rule these tests exist to pin is D7's: a user with NO allowance row
 * answers `granted = remaining = default_allowance_credits`, never 0 and never
 * null. Provisioning happens at the first ENFORCED reserve, so every brand-new
 * user is a no-row user — get this wrong and the guard 402s the first Generate
 * anyone ever presses, invisibly, until a real new user arrives.
 */

const from = vi.fn()
vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))

import { config } from "../../../lib/config.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"
import { __setDeploymentPayerForTests, __resetDeploymentPayerForTests } from "../../../lib/deployment-payer.js"
import {
  allowanceFor,
  allowancesFor,
  defaultAllowanceCredits,
  __resetDeploymentAllowanceCacheForTests,
} from "../deployment-allowance-service.js"

const PAYER = "00000000-0000-4000-8000-000000000001"
const U1 = "00000000-0000-4000-8000-000000000101"
const U2 = "00000000-0000-4000-8000-000000000102"

const REAL_EDITION = config.EDITION
const REAL_ENV = process.env.NODARO_SURFACE_PROFILE

type Result = { data: unknown; error: { message: string } | null }
let settings: Result
let single: Result
let batch: Result
let inIds: string[] | null

/** Drive the REAL predicate (profile + payer), not a mock of it. */
function surface(allowances?: "off" | "enforce"): void {
  config.EDITION = "business"
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({
    billing: { unitLabel: "קרדיטים", unitRate: 2000, selfServe: false, ...(allowances ? { allowances } : {}) },
  })
  __resetSurfaceProfileCacheForTests()
}

/** The hosted shape: a payer AND enforcement on. */
function enforcing(): void {
  surface("enforce")
  __setDeploymentPayerForTests(PAYER)
}

beforeEach(() => {
  settings = { data: { default_allowance_credits: 200 }, error: null }
  single = { data: null, error: null }
  batch = { data: [], error: null }
  inIds = null
  from.mockReset()
  from.mockImplementation((table: string) => {
    if (table === "deployment_payer_settings") {
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(settings) }) }) }
    }
    if (table === "deployment_user_allowances") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve(single) }),
          in: (_col: string, ids: string[]) => {
            inIds = ids
            return Promise.resolve(batch)
          },
        }),
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
  __resetDeploymentAllowanceCacheForTests()
  __resetDeploymentPayerForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
  __resetDeploymentPayerForTests()
  __resetDeploymentAllowanceCacheForTests()
  config.EDITION = REAL_EDITION
  if (REAL_ENV === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = REAL_ENV
  __resetSurfaceProfileCacheForTests()
})

describe("allowanceFor — inert without a payer, VISIBLE with one (the display/enforcement ruling)", () => {
  it("mainline (no payer) answers null and issues ZERO queries", async () => {
    surface("enforce") // even a profile that asks for it: no payer ⇒ nothing
    expect(await allowanceFor(U1)).toBeNull()
    expect(from).not.toHaveBeenCalled()
  })

  it("a payer with enforcement off (absent, and explicit \"off\") still ANSWERS — the allowance is visible before the flip", async () => {
    // THE RULING (spec §9.1 vs D12, resolved by the orchestrator): an
    // allowance is VISIBLE whenever a payer is active and ENFORCED only when
    // `billing.allowances === "enforce"`. Rollout steps 5-7 turn the sidebar
    // card on while enforcement is still off; a null here would send every
    // surface back to `total` — the frozen signup grant §9.1 calls a lie.
    // Refusing is a separate gate the credit guard consults on its own.
    surface(undefined)
    __setDeploymentPayerForTests(PAYER)
    expect(await allowanceFor(U1)).toEqual({ granted: 200, remaining: 200, spent: 0 })
    surface("off")
    expect(await allowanceFor(U1)).toEqual({ granted: 200, remaining: 200, spent: 0 })
  })

  it("the payer itself has no allowance (D13) — it holds the REAL credits", async () => {
    enforcing()
    expect(await allowanceFor(PAYER)).toBeNull()
    expect(from).not.toHaveBeenCalled()
  })
})

describe("allowanceFor — the D7 no-row rule", () => {
  it("a user with NO row answers granted = remaining = the default, never 0", async () => {
    enforcing()
    single = { data: null, error: null }
    // `spent: 0` is a TRUTH for a no-row user, not a placeholder: they have
    // settled nothing. An absent field would render as an em dash where a real
    // zero belongs.
    expect(await allowanceFor(U1)).toEqual({ granted: 200, remaining: 200, spent: 0 })
  })

  it("an existing row answers granted − reserved − spent, in RAW credits", async () => {
    enforcing()
    single = { data: { granted_credits: 200, reserved_credits: 30, spent_credits: 50 }, error: null }
    expect(await allowanceFor(U1)).toEqual({ granted: 200, remaining: 120, spent: 50 })
  })

  it("remaining never goes negative (a metered overrun the clamp absorbed shows 0, not −5)", async () => {
    enforcing()
    single = { data: { granted_credits: 200, reserved_credits: 0, spent_credits: 205 }, error: null }
    // `spent` is the SETTLED figure, never `granted − remaining` (which also
    // holds a running job’s reservation) — 205 survives the clamp that floors
    // `remaining` at 0.
    expect(await allowanceFor(U1)).toEqual({ granted: 200, remaining: 0, spent: 205 })
  })

  it("a read error answers null — unavailable, never zeros", async () => {
    enforcing()
    single = { data: null, error: { message: "boom" } }
    expect(await allowanceFor(U1)).toBeNull()
  })

  it("no row AND no readable default answers null — 0 is never manufactured for \"not provisioned\"", async () => {
    enforcing()
    single = { data: null, error: null }
    settings = { data: null, error: null }
    expect(await allowanceFor(U1)).toBeNull()
    settings = { data: null, error: { message: "boom" } }
    __resetDeploymentAllowanceCacheForTests()
    expect(await allowanceFor(U1)).toBeNull()
  })

  it("a default of 0 is a real value and survives (an instance that grants nothing by default)", async () => {
    enforcing()
    settings = { data: { default_allowance_credits: 0 }, error: null }
    expect(await allowanceFor(U1)).toEqual({ granted: 0, remaining: 0, spent: 0 })
  })
})

describe("defaultAllowanceCredits — the settings row, cached on a short TTL", () => {
  it("reads the singleton and answers RAW credits", async () => {
    enforcing()
    expect(await defaultAllowanceCredits()).toBe(200)
  })

  it("is null without a payer, without a query", async () => {
    surface("enforce")
    expect(await defaultAllowanceCredits()).toBeNull()
    expect(from).not.toHaveBeenCalled()
  })

  it("caches: many callers, ONE settings read, and the invalidator re-reads", async () => {
    enforcing()
    expect(await defaultAllowanceCredits()).toBe(200)
    expect(await defaultAllowanceCredits()).toBe(200)
    await allowanceFor(U1)
    const reads = from.mock.calls.filter((c) => c[0] === "deployment_payer_settings").length
    expect(reads).toBe(1)
    settings = { data: { default_allowance_credits: 999 }, error: null }
    __resetDeploymentAllowanceCacheForTests()
    expect(await defaultAllowanceCredits()).toBe(999)
  })
})

describe("allowancesFor — the batch form keeps the no-row rule PER ID", () => {
  it("mixes rows and no-rows, one query, defaults for the ids Postgres did not return", async () => {
    enforcing()
    batch = { data: [{ user_id: U1, granted_credits: 400, reserved_credits: 100, spent_credits: 100 }], error: null }
    const m = await allowancesFor([U1, U2])
    expect(m?.get(U1)).toEqual({ granted: 400, remaining: 200, spent: 100 })
    expect(m?.get(U2)).toEqual({ granted: 200, remaining: 200, spent: 0 }) // D7, not 0
    expect(from.mock.calls.filter((c) => c[0] === "deployment_user_allowances").length).toBe(1)
  })

  it("dedupes ids and never asks about the payer (D13 — it has no allowance)", async () => {
    enforcing()
    await allowancesFor([U1, U1, PAYER, U2])
    expect(inIds).toEqual([U1, U2])
    const m = await allowancesFor([PAYER])
    expect(m?.size).toBe(0)
  })

  it("empty input answers an empty map with zero queries", async () => {
    enforcing()
    expect((await allowancesFor([]))?.size).toBe(0)
    expect(from).not.toHaveBeenCalled()
  })

  it("a read error answers null for the WHOLE batch — never a map of zeros", async () => {
    enforcing()
    batch = { data: null, error: { message: "boom" } }
    expect(await allowancesFor([U1, U2])).toBeNull()
  })

  it("no payer answers null, with zero queries", async () => {
    surface("enforce")
    expect(await allowancesFor([U1])).toBeNull()
    expect(from).not.toHaveBeenCalled()
  })

  it("a payer with enforcement off answers the defaults map, not null (the ruling, batch twin)", async () => {
    // The admin list and the billing account's table render this map at
    // rollout steps 5-7. Null there is an em dash in every cell on a
    // deployment that already knows every figure.
    surface("off")
    __setDeploymentPayerForTests(PAYER)
    const m = await allowancesFor([U1, U2])
    expect(m?.get(U1)).toEqual({ granted: 200, remaining: 200, spent: 0 })
    expect(m?.get(U2)).toEqual({ granted: 200, remaining: 200, spent: 0 })
  })
})
