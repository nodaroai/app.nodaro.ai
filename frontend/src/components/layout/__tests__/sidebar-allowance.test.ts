import { describe, it, expect } from "vitest"
import { sidebarCreditFigures } from "../app-sidebar"

/**
 * Track A — the sidebar credit card under a deployment payer (spec §9.1).
 *
 * The card is hidden on SAI today (`billing.sidebarCard: "hidden"`) precisely
 * because un-hiding it would render `total`: the requester's frozen signup
 * grant, a number nothing debits. Teaching the card to prefer the allowance
 * comes FIRST; the overlay flips the card visible afterwards (rollout step 5).
 * Doing it the other way round puts a lie on screen for the length of a
 * deploy.
 */
/** `billingSurface().deploymentPayer` — the second argument, named. */
const MAINLINE = false
const PAYER = true

describe("sidebarCreditFigures", () => {
  it("prefers the allowance's remaining over the frozen grant", () => {
    const f = sidebarCreditFigures({ total: 1500, allowance: { granted: 400_000, remaining: 399_000 } }, PAYER)
    expect(f.headline).toBe(399_000)
    expect(f.allowance).toEqual({ granted: 400_000, remaining: 399_000 })
  })

  it("falls back to `total` when the server sent no allowance (mainline)", () => {
    const f = sidebarCreditFigures({ total: 1500 }, MAINLINE)
    expect(f.headline).toBe(1500)
    expect(f.allowance).toBeNull()
  })

  it("treats an explicit null as 'no allowance applies', never as remaining 0", () => {
    // The payer reading its own balance is the case that matters: answering 0
    // here would show the account that owns the pool an empty card.
    const f = sidebarCreditFigures({ total: 250_000, allowance: null }, PAYER)
    expect(f.headline).toBe(250_000)
    expect(f.allowance).toBeNull()
  })

  it("a genuinely exhausted allowance headlines 0, not the grant", () => {
    const f = sidebarCreditFigures({ total: 1500, allowance: { granted: 400_000, remaining: 0 } }, PAYER)
    expect(f.headline).toBe(0)
    expect(f.allowance?.granted).toBe(400_000)
  })

  it("stays in RAW credits — no display-unit conversion happens here", () => {
    const f = sidebarCreditFigures({ total: 1500, allowance: { granted: 200_000, remaining: 199_950 } }, PAYER)
    expect(f.headline).toBe(199_950) // not × 2000
  })

  it("shows the allowance whether or not the server is ENFORCING it yet", () => {
    // R-A: visible from the moment a payer exists, binding only after the
    // `billing.allowances` flip. The card is a display, so it renders the
    // allowance through both windows — the enforcement bit belongs to the run
    // gates alone. Showing `total` during step 5 would put the frozen signup
    // grant back on screen, which is the lie this card was taught to avoid.
    const off = sidebarCreditFigures({ total: 1500, allowance: { granted: 400_000, remaining: 399_000, enforced: false } }, PAYER)
    const on = sidebarCreditFigures({ total: 1500, allowance: { granted: 400_000, remaining: 399_000, enforced: true } }, PAYER)
    expect(off.headline).toBe(399_000)
    expect(on.headline).toBe(399_000)
  })

  it("shows `total` on a payer instance whose allowance could not be read", () => {
    // The card is a DISPLAY: the payer flag it now passes down decides whether
    // a RUN GATE may refuse, and this card never refuses. When the allowance is
    // unavailable there is nothing else to show, so `total` stays — an empty
    // card would be a worse lie than a stale one, and no run is blocked by it.
    const f = sidebarCreditFigures({ total: 1500, allowance: null }, PAYER)
    expect(f.headline).toBe(1500)
    expect(f.allowance).toBeNull()
  })
})
