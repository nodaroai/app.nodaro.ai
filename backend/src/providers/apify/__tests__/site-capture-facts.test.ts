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

// Probe run 1, T8: recall against the frozen truth was 40 % strict. Each case below is a shape the extractor
// returned wrong or not at all on a tuning page (nodaro.ai, linear, allbirds, personio, notion, greeninvoice).
describe("extractPageFacts — whole figures (probe run 1, T8)", () => {
  it("reads a price split over two lines as one figure with its period, on one line", () => {
    expect(extractPageFacts("Basic\n$10\n/mo\nBilled yearly")).toEqual(["$10 /mo"])
  })

  it("an old price above a new one is two facts, the period on the new one", () => {
    expect(extractPageFacts("$29\n$24\n/mo")).toEqual(["$29", "$24 /mo"])
  })

  it("never returns a fact with a line break in it", () => {
    for (const f of extractPageFacts("$10\n/mo\n10 GB storage\nAll features\n4,500 CREDITS\n/ MO")) expect(f).not.toMatch(/[\r\n]/)
  })

  it("a count's noun phrase stops at the end of the line", () => {
    expect(extractPageFacts("10 GB storage\nAll your files")).toEqual(["10 GB storage"])
  })

  it("keeps a credits-style period: 4,500 CREDITS / MO", () => {
    expect(extractPageFacts("4,500 CREDITS / MO")).toEqual(["4,500 CREDITS / MO"])
    expect(extractPageFacts("11,000 CREDITS\n/ MO")).toEqual(["11,000 CREDITS / MO"])
  })

  it("the same figure in two spellings is one fact: the page text's first (DOM text, then the section text's leaf-joined copy)", () => {
    expect(extractPageFacts("$10\n/mo\n10 $ /mo")).toEqual(["$10 /mo"])
    expect(extractPageFacts("1,500 free credits\n1,500 FREE CREDITS")).toEqual(["1,500 free credits"])
  })

  it("reads a sign written after the amount with its period: 10 $ /mo", () => {
    expect(extractPageFacts("Only 10 $ /mo")).toEqual(["10 $ /mo"])
  })

  it.each([
    ["650.000 Titel im Hörbuch-Katalog", "650.000 Titel"],
    ["Individual 12,99 € pro Monat", "12,99 € pro Monat"],
    ["Student 6,99 €/Monat", "6,99 €/Monat"],
    ["Bereits 1.200,50 Kunden", "1.200,50 Kunden"],
    ["Over 1.200,50 Kunden", "Over 1.200,50 Kunden"],
  ])("European number formats: %j", (text, fact) => {
    expect(extractPageFacts(text)).toContain(fact)
  })

  it.each([
    ["Spare 21 % weniger Zeitaufwand pro Woche", "21 % weniger Zeitaufwand"],
    ["Over 50% of YC companies use it", "Over 50% of YC companies"],
    ["30% höhere HR-Produktivität", "30% höhere HR-Produktivität"],
    ["Up to 40% off", "Up to 40% off"],
  ])("a percentage keeps the words that say what it is a percentage of: %j", (text, fact) => {
    expect(extractPageFacts(text)).toContain(fact)
  })

  it("a count and a second count in one phrase: 100M users in over 50 countries", () => {
    expect(extractPageFacts("Trusted by 100M users in over 50 countries.")).toContain("100M users in over 50 countries")
  })

  it("a qualifier before a count stays with it, and a closing infinitive: up to 30 days to ship", () => {
    expect(extractPageFacts("Orders can take up to 30 days to ship, sorry")).toContain("up to 30 days to ship")
    expect(extractPageFacts("Orders can take up to 30 days")).toContain("up to 30 days")
  })

  it("a percentage 'of' phrase may carry a number: 62% of Fortune 100", () => {
    expect(extractPageFacts("62% of Fortune 100 use Notion")).toContain("62% of Fortune 100")
  })

  it.each([
    ["Enforced from 1 ביוני 2026 onwards", "1 ביוני 2026"],
    ["Effective 1 June 2026.", "1 June 2026"],
    ["Effective June 1, 2026.", "June 1, 2026"],
    ["Ab dem 1. Juni 2026 gilt", "1. Juni 2026"],
    ["Since 2012", "Since 2012"],
    ["Est. 1998", "Est. 1998"],
  ])("dates and founding years: %j", (text, fact) => {
    expect(extractPageFacts(text)).toContain(fact)
  })

  it("a bare year and a copyright year are still not facts", () => {
    expect(extractPageFacts("© 2024 Example Inc. All rights reserved. 2025")).toEqual([])
  })

  it.each([
    ["Watch the 0:36 video", "0:36"],
    ["Runs 12:05 end to end", "12:05"],
    ["10:45 AM Has anyone seen this", "10:45 AM"],
  ])("clock times and durations: %j", (text, fact) => {
    expect(extractPageFacts(text)).toContain(fact)
  })

  it("a clock time is not read as a count with the next word", () => {
    expect(extractPageFacts("10:45 AM Has anyone seen this")).toEqual(["10:45 AM"])
  })

  it("every fact is a substring of the whitespace-collapsed text, at most 120 characters", () => {
    const text = "Basic\n$10\n/mo\n4,500 CREDITS\n/ MO\nOver 50% of YC companies\n1 June 2026\n10 GB storage\nAll"
    const collapsed = text.replace(/\s+/g, " ")
    for (const f of extractPageFacts(text)) {
      expect(collapsed).toContain(f)
      expect(f.length).toBeLessThanOrEqual(120)
    }
  })

  it("the 30-fact cap keeps price, rating, percentage and date facts ahead of loose counts", () => {
    const counts = Array.from({ length: 40 }, (_, i) => `${i + 11} widgets`).join(". ")
    const facts = extractPageFacts(`${counts}. Pro costs $49/month. Rated 4.8/5. Save 30%. Since 2012.`)
    expect(facts).toHaveLength(30)
    expect(facts).toEqual(expect.arrayContaining(["$49/month", "4.8/5", "30%", "Since 2012"]))
  })
})

