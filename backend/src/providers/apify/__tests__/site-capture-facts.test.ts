import { describe, expect, it } from "vitest"
import { extractPageFacts } from "../site-capture-facts.js"

describe("extractPageFacts", () => {
  it.each([
    ["Only $6/month for everything", "$6/month"],
    ["Pro is €9.99 per month", "€9.99 per month"],
    ["רק ₪49 לחודש לכל הצוות", "₪49 לחודש"],
    ["Rated 4.8/5 by our users", "4.8/5"],
    ["4.8 stars on the store", "4.8 stars"],
    ["★ 4.8 average", "★ 4.8"],
    ["Loved by 12,000 home cooks.", "12,000 home cooks"],
    ["Used by 10k+ teams worldwide", "10k+ teams worldwide"],
    ["Save 30% on yearly plans", "30%"],
    ["Start your 14-day free trial", "14-day free trial"],
  ])("finds the fact in %j", (text, fact) => {
    expect(extractPageFacts(text)).toContain(fact)
  })

  it("never extracts a phone number or a copyright year", () => {
    expect(extractPageFacts("Call +1 555 123 4567 · © 2024 Example Inc.")).toEqual([])
  })

  it("keeps the longer fact when one contains another", () => {
    const facts = extractPageFacts("Only ₪49 לחודש")
    expect(facts).toEqual(["₪49 לחודש"])
  })

  it("deduplicates repeated facts", () => {
    expect(extractPageFacts("$12/month. Again: $12/month.")).toEqual(["$12/month"])
  })

  it("keeps at most 30, in page order", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Plan ${i}: $${i + 10}`).join(". ")
    const facts = extractPageFacts(text)
    expect(facts).toHaveLength(30)
    expect(facts[0]).toBe("$10")
  })

  it("every fact is a verbatim substring of the text, at most 120 characters", () => {
    const text = "Join 12,000 home cooks. Rated 4.8/5. Only $6/month. Save 30%. 14-day free trial. ₪49 לחודש."
    for (const f of extractPageFacts(text)) {
      expect(text).toContain(f)
      expect(f.length).toBeLessThanOrEqual(120)
    }
  })

  it.each([
    ["Only 9,99 € per month", ["9,99 € per month"]],
    ["Only 49 ₪ לחודש", ["49 ₪ לחודש"]],
    ["Plan 1 $10", ["$10"]],
  ])("reads a sign written after the amount, never as the start of the next price: %j", (text, facts) => {
    expect(extractPageFacts(text)).toEqual(facts)
  })

  it("drops a count that a longer price contains", () => {
    expect(extractPageFacts("Teams pay 1,200 USD per month")).toEqual(["1,200 USD per month"])
  })
})
