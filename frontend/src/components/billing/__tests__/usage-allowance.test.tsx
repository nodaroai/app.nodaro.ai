import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { BillingAccountSummary } from "../billing-account-summary"
import type { BillingAccount } from "@/lib/billing-surface"

/**
 * Track A — the allowance card on /usage (spec §9.1).
 *
 * `deploymentConsumptionAccount` used to answer `balance: null` because no
 * balance existed at user grain. It does now: `balance` is what the requester
 * has LEFT of their allowance and `allocated` is what they were GRANTED, both
 * already in the display unit (the seam converted them — this component must
 * NOT convert again).
 *
 * Three rules this file holds, each with a scar behind it:
 *  - `null` renders as an em dash. A fabricated 0 turns "we could not read
 *    your allowance" into "you have nothing left", which reads as a refusal.
 *  - The remaining/granted pair is never a bare `X / Y` string: under RTL the
 *    two numbers swap sides and the sentence lies. One interpolated key, so
 *    the translator owns the order.
 *  - Logical properties only in the new card (`ms-*`/`me-*`), never `ml-*`.
 *    The instance is Hebrew-default and the `rtl:` variant is banned here.
 */

const consumption: BillingAccount = {
  plan: "", balance: 199_950, allocated: 200_000, dailyAllowance: null, unit: "קרדיטים",
  periodStart: "2026-09-01T00:00:00.000Z", generations: 3,
  byCategory: [{ category: "image", count: 3, amount: 50, spent: null }],
}

function allowanceCard(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>("[data-testid='allowance-card']")
  if (!el) throw new Error("no allowance card rendered")
  return el
}

describe("the /usage allowance card", () => {
  it("renders remaining as the headline and granted in a labelled second line", () => {
    const { container } = render(<BillingAccountSummary account={consumption} consumptionOnly />)
    const card = allowanceCard(container)
    expect(card.textContent).toContain("199,950")
    expect(card.textContent).toContain("200,000")
    // The unit rides with the figures — the seam already converted them, so
    // this is the SERVER's label, not a client-side re-derivation.
    expect(card.textContent).toContain("קרדיטים")
  })

  it("never renders the pair as a bare `X / Y`", () => {
    const { container } = render(<BillingAccountSummary account={consumption} consumptionOnly />)
    expect(allowanceCard(container).textContent ?? "").not.toMatch(/\d\s*\/\s*\d/)
  })

  it("uses logical properties only — no ml-/mr-/pl-/pr- anywhere in the card", () => {
    const { container } = render(<BillingAccountSummary account={consumption} consumptionOnly />)
    expect(allowanceCard(container).outerHTML).not.toMatch(/\b(ml|mr|pl|pr)-/)
  })

  it("an unavailable allowance is an em dash, never 0", () => {
    const unavailable: BillingAccount = { ...consumption, balance: null, allocated: null }
    const { container } = render(<BillingAccountSummary account={unavailable} consumptionOnly />)
    const card = allowanceCard(container)
    expect(card.textContent).toContain("—")
    expect(card.textContent).not.toMatch(/\b0\b/)
  })

  it("a real 0 remaining is rendered as 0 (exhausted is not unavailable)", () => {
    const spent: BillingAccount = { ...consumption, balance: 0, allocated: 200_000 }
    const { container } = render(<BillingAccountSummary account={spent} consumptionOnly />)
    const card = allowanceCard(container)
    // The HEADLINE specifically: "200,000" in the second line also contains a
    // zero, so the assertion has to name the figure under test.
    expect(card.querySelector(".text-3xl")?.textContent?.trim()).toMatch(/^0\b/)
    expect(card.textContent).not.toContain("—")
  })

  it("renders nothing when the provider has no allowance concept (key absent)", () => {
    const noConcept: BillingAccount = { plan: "", balance: null, dailyAllowance: null, unit: "credits", generations: 1 }
    const { container } = render(<BillingAccountSummary account={noConcept} consumptionOnly />)
    expect(container.querySelector("[data-testid='allowance-card']")).toBeNull()
  })

  it("mainline (not consumption-only) never grows the card", () => {
    const mainline: BillingAccount = { plan: "pro", balance: 42, allocated: 100, dailyAllowance: null, unit: "credits" }
    const { container } = render(<BillingAccountSummary account={mainline} />)
    expect(container.querySelector("[data-testid='allowance-card']")).toBeNull()
  })

  it("keeps the period-spend card beside it (the allowance did not replace it)", () => {
    render(<BillingAccountSummary account={consumption} consumptionOnly />)
    expect(screen.getByText("Spent this period")).toBeInTheDocument()
  })
})
