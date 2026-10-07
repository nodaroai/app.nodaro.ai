import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { planSections, STILL_ASPECT, type PageSummary } from "../site-capture-page.js"
import { LANDING, summaryOf, VW, words, type SectionSpec } from "./fixtures/site-capture-summaries.js"

const OPTS = { stillAspect: STILL_ASPECT, maxStills: 8 }
const HERO = LANDING[0]!

describe("planSections — finding the sections", () => {
  it("a heading split across spans reads as one label", () => {
    const plan = planSections(summaryOf([{ ...HERO, title: "Ship\n   videos   faster" }, LANDING[1]!]), OPTS)
    expect(plan.sections[0]!.label).toBe("Ship videos faster")
  })

  it("drops a heading under 12 CSS px tall", () => {
    const plan = planSections(summaryOf([...LANDING, { title: "Tiny", y: 4400, height: 400, anchorHeight: 4, words: 30, landmark: false }]), OPTS)
    expect(plan.sections.map((s) => s.label)).not.toContain("Tiny")
  })

  it("drops navigation, footer and cookie headings", () => {
    const plan = planSections(
      summaryOf([
        ...LANDING,
        { title: "Menu", y: 4400, height: 300, words: 30, inChrome: true },
        { title: "We use cookies", y: 4800, height: 300, words: 30 },
      ]),
      OPTS,
    )
    const labels = plan.sections.map((s) => s.label)
    expect(labels).not.toContain("Menu")
    expect(labels).not.toContain("We use cookies")
  })

  it("two headings in one landmark merge, keeping the larger font", () => {
    const base = summaryOf(LANDING)
    const extra = { text: "Small print heading", rect: { x: 16, y: 1300, width: 380, height: 24 }, fontSize: 20, inChrome: false, landmarks: [1] }
    const plan = planSections({ ...base, anchors: [...base.anchors, extra] }, OPTS)
    const labels = plan.sections.map((s) => s.label)
    expect(labels).toContain("Make it yours")
    expect(labels).not.toContain("Small print heading")
  })

  it("the hero is always section 0, labelled by its largest heading", () => {
    const plan = planSections(summaryOf(LANDING), OPTS)
    expect(plan.sections[0]).toMatchObject({ order: 0, label: "Ship videos faster", category: "hero", kind: "key" })
    expect(plan.sections[0]!.rect.y).toBe(0)
  })

  it("an empty top of the page has no hero", () => {
    const plan = planSections(summaryOf([{ title: "Make it yours", y: 1000, height: 700, words: 30 }]), OPTS)
    expect(plan.sections[0]!.category).toBe("feature")
  })

  it("a page with no headings yields the hero alone (Review Focus 3)", () => {
    const leaves = [{ kind: "text" as const, text: "Welcome to our app", rect: { x: 16, y: 100, width: 380, height: 40 }, inDetails: false, inBlockquote: false }]
    const plan = planSections(summaryOf([], { anchors: [], blocks: [], leaves, pageHeight: 1500 }), OPTS)
    expect(plan.sections).toHaveLength(1)
    expect(plan.sections[0]).toMatchObject({ category: "hero", stillIndex: 0 })
    expect(plan.stills).toHaveLength(1)
    expect(plan.stills[0]!.rect).toEqual({ x: 0, y: 0, width: VW, height: 490 })
  })
})

describe("planSections — a scroll-linked story and a row of plan cards (probe 2026-10-06, T1)", () => {
  // The nodaro.ai mobile story: one 5,800 px block whose eight chapters are laid out in the page,
  // each faded out until the visitor scrolls to it. Every heading is its own section; none is a still.
  const chapter = (title: string, i: number): SectionSpec => ({ title, y: 1400 + i * 550, height: 550, words: 30, font: 24, landmark: false, hidden: true })
  const CHAPTERS = ["A closer look at AI.", "One prompt. Every model.", "One prompt. Endless directions.", "Same character. Every shot.", "Edit. Enhance. Publish."].map(chapter)
  const story = (): PageSummary => summaryOf([{ ...HERO, height: 1400 }, ...CHAPTERS, { title: "Open your terminal", y: 4300, height: 700, words: 30 }])

  it("every chapter heading of a tall block is its own section", () => {
    const plan = planSections(story(), OPTS)
    expect(plan.sections.map((s) => s.label)).toEqual(["Ship videos faster", ...CHAPTERS.map((c) => c.title), "Open your terminal"])
  })

  it("a chapter that is faded out at rest keeps its place in the map but never gets a still", () => {
    const plan = planSections(story(), OPTS)
    const chapters = plan.sections.filter((s) => CHAPTERS.some((c) => c.title === s.label))
    expect(chapters).toHaveLength(5)
    for (const c of chapters) expect(c.stillIndex).toBeNull()
    expect(plan.stills.map((s) => s.label)).toEqual(["Ship videos faster", "Open your terminal"])
  })

  it("a faded-out chapter does not use up the still budget", () => {
    const plan = planSections(summaryOf([HERO, ...CHAPTERS, ...LANDING.slice(2, 4).map((s) => ({ ...s, y: s.y + 4000 }))]), { ...OPTS, maxStills: 3 })
    expect(plan.stills.map((s) => s.category)).toEqual(["hero", "pricing", "proof"])
  })

  // Plan cards: the heading is large, each card's name is smaller and the same size as its siblings.
  const CARD = (title: string, i: number): SectionSpec => ({ title, y: 1300 + i * 560, height: 550, font: 22, landmark: false, text: "$24 per month, billed yearly" })
  const PLANS = ["Basic", "Standard", "Pro", "Business"].map(CARD)
  const pricingPage = (cards: readonly SectionSpec[]) =>
    summaryOf([HERO, { title: "Simple, credit-based pricing", y: 1000, height: 300, font: 36, landmark: false, text: "Pay for what you use. Pricing for every team." }, ...cards])

  it("a row of plan cards under one pricing heading is one pricing section", () => {
    const plan = planSections(pricingPage(PLANS), OPTS)
    expect(plan.sections.map((s) => [s.label, s.category])).toEqual([["Ship videos faster", "hero"], ["Simple, credit-based pricing", "pricing"]])
    expect(plan.sections[1]!.rect).toMatchObject({ y: 1040, height: 1300 + 3 * 560 + 550 - 1040 })
  })

  it("the folded pricing section takes one still, so the budget goes to distinct sections", () => {
    const plan = planSections(summaryOf([HERO, { title: "Simple pricing", y: 1000, height: 300, font: 36, landmark: false, text: "Pricing for every team" }, ...PLANS, { title: "Loved by creators", y: 3700, height: 500, text: "Rated 4.8/5 from 2,000 reviews" }]), OPTS)
    expect(plan.stills.map((s) => s.category)).toEqual(["hero", "pricing", "proof"])
  })

  it("two cards are enough when a larger heading leads them", () => {
    expect(planSections(pricingPage(PLANS.slice(0, 2)), OPTS).sections.map((s) => s.label)).toEqual(["Ship videos faster", "Simple, credit-based pricing"])
  })

  it("three equal cards with no heading above them still fold into the first", () => {
    const plan = planSections(summaryOf([HERO, ...PLANS.slice(0, 3)]), OPTS)
    expect(plan.sections.map((s) => s.label)).toEqual(["Ship videos faster", "Basic"])
    expect(plan.sections[1]).toMatchObject({ category: "pricing" })
  })

  it("two pricing sections whose second heading is larger are separate sections", () => {
    const plan = planSections(
      summaryOf([
        HERO,
        { title: "Notice: new limits from June", y: 1000, height: 300, font: 22, landmark: false, text: "Plans from $10 per month" },
        { title: "All the tools for your business", y: 1300, height: 600, font: 32, landmark: false, text: "Plans from $10 per month" },
      ]),
      OPTS,
    )
    expect(plan.sections.map((s) => s.label)).toEqual(["Ship videos faster", "Notice: new limits from June", "All the tools for your business"])
  })

  it("pricing sections with a gap between them are separate sections", () => {
    const plan = planSections(
      summaryOf([HERO, { title: "Pricing", y: 1000, height: 300, font: 36, text: "Plans" }, { title: "Plan A", y: 1700, height: 300, font: 22, text: "$5 /mo" }, { title: "Plan B", y: 2100, height: 300, font: 22, text: "$9 /mo" }]),
      OPTS,
    )
    expect(plan.sections.map((s) => s.label)).toEqual(["Ship videos faster", "Pricing", "Plan A", "Plan B"])
  })

  it("a lone pricing section is untouched", () => {
    expect(planSections(summaryOf(LANDING), OPTS).sections.map((s) => s.label)).toEqual(["Ship videos faster", "Make it yours", "Simple pricing", "Loved by creators", "Questions", "Start today"])
  })
})

describe("planSections — categories", () => {
  const categoryOf = (spec: Omit<SectionSpec, "y" | "height">) =>
    planSections(summaryOf([HERO, { y: 1000, height: 600, ...spec }]), OPTS).sections[1]!.category

  it.each([
    ["$", "Pro $12 per month"],
    ["€", "Only €9.99"],
    ["₪", "רק ₪49 לחודש"],
  ])("pricing from a %s amount", (_c, text) => {
    expect(categoryOf({ title: "Our offer", text })).toBe("pricing")
  })
  it("proof from a rating", () => expect(categoryOf({ title: "What people say", text: "4.8 stars on average" })).toBe("proof"))
  it("proof from a blockquote", () => expect(categoryOf({ title: "What people say", text: "lorem ipsum dolor", blockquote: true })).toBe("proof"))
  it("a logo wall is other", () => expect(categoryOf({ title: "Trusted by teams", words: 3, images: 6 })).toBe("other"))
  it("faq from details", () => expect(categoryOf({ title: "Good to know", words: 30, details: true })).toBe("faq"))
  it("a short band with a button is a call to action", () => expect(categoryOf({ title: "Start today", words: 4, button: true })).toBe("cta"))
  it("a heading with enough words is a feature", () => expect(categoryOf({ title: "Make it yours", words: 30 })).toBe("feature"))
  it("anything else is other", () => expect(categoryOf({ title: "Our story", words: 5 })).toBe("other"))

  it("hero, proof, pricing and feature are key; the rest are filler", () => {
    const plan = planSections(summaryOf(LANDING), OPTS)
    expect(plan.sections.map((s) => [s.category, s.kind])).toEqual([
      ["hero", "key"], ["feature", "key"], ["pricing", "key"], ["proof", "key"], ["faq", "filler"], ["cta", "filler"],
    ])
  })
})

describe("planSections — choosing the stills", () => {
  it("takes key sections in page order, each a phone-card rectangle", () => {
    const plan = planSections(summaryOf(LANDING), OPTS)
    expect(plan.stills.map((s) => s.category)).toEqual(["hero", "feature", "pricing", "proof"])
    expect(plan.stills.map((s) => s.index)).toEqual([0, 1, 2, 3])
    expect(plan.stills[1]!.rect).toEqual({ x: 0, y: 1040 - 24, width: VW, height: Math.round(VW / STILL_ASPECT) })
    expect(plan.sections.map((s) => s.stillIndex)).toEqual([0, 1, 2, 3, null, null])
  })

  it("respects maxStills", () => {
    expect(planSections(summaryOf(LANDING), { ...OPTS, maxStills: 3 }).stills.map((s) => s.category)).toEqual(["hero", "feature", "pricing"])
  })

  it("adds filler (non-FAQ first) until there are three", () => {
    const plan = planSections(
      summaryOf([
        HERO,
        { title: "Questions", y: 1000, height: 600, details: true, words: 30 },
        { title: "Start today", y: 1700, height: 300, words: 4, button: true },
        { title: "Our story", y: 2100, height: 400, words: 5 },
      ]),
      OPTS,
    )
    expect(plan.stills.map((s) => s.category)).toEqual(["hero", "cta", "other"])
  })

  it("skips a still that overlaps a chosen one by more than 40 %", () => {
    const plan = planSections(
      summaryOf([
        HERO,
        { title: "Alpha", y: 1000, height: 200, words: 30, landmark: false },
        { title: "Beta", y: 1200, height: 600, words: 30, landmark: false },
      ]),
      OPTS,
    )
    expect(plan.stills.map((s) => s.label)).toEqual(["Ship videos faster", "Alpha"])
    expect(plan.sections.find((s) => s.label === "Beta")!.stillIndex).toBeNull()
  })

  it("clamps the still rectangle at the bottom of the page", () => {
    const plan = planSections(summaryOf([HERO, { title: "Last words", y: 4000, height: 300, words: 30 }]), OPTS)
    expect(plan.stills[1]!.rect).toEqual({ x: 0, y: 4300 - 490, width: VW, height: 490 })
  })
})

describe("planSections — the section map", () => {
  it("lists at most 30 sections, each with at most 300 characters of text", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ title: `Section ${i}`, y: 1000 + i * 300, height: 300, text: words(400) }))
    const plan = planSections(summaryOf([HERO, ...many]), OPTS)
    expect(plan.sections).toHaveLength(30)
    for (const s of plan.sections) expect(Array.from(s.text).length).toBeLessThanOrEqual(300)
    expect(plan.sections.map((s) => s.order)).toEqual(Array.from({ length: 30 }, (_, i) => i))
  })

  it("labels are at most 60 characters", () => {
    const plan = planSections(summaryOf([{ ...HERO, title: "x".repeat(90) }, LANDING[1]!]), OPTS)
    expect(Array.from(plan.sections[0]!.label)).toHaveLength(60)
  })
})

describe("planSections — our own site (a summary captured during the spike)", () => {
  const summary = JSON.parse(
    readFileSync(new URL("./fixtures/nodaro-ai-summary.json", import.meta.url), "utf8"),
  ) as PageSummary
  it("finds the hero first and 3–8 stills, every section labelled", () => {
    const plan = planSections(summary, OPTS)
    expect(plan.sections[0]!.category).toBe("hero")
    expect(plan.stills.length).toBeGreaterThanOrEqual(3)
    expect(plan.stills.length).toBeLessThanOrEqual(8)
    for (const s of plan.sections) expect(s.label.trim().length).toBeGreaterThan(0)
  })
})

describe("planSections — our own site after probe 1 (a summary captured locally on 2026-10-06, tuning round 1)", () => {
  const summary = JSON.parse(readFileSync(new URL("./fixtures/nodaro-ai-summary-r2.json", import.meta.url), "utf8")) as PageSummary
  // The twelve headings frozen in the probe registration (site-capture-probe.md, "Ground truth"), T1 = 10 of 12.
  const TRUTH = [
    "Every AI model. One canvas.", "A closer look at AI.", "One prompt. Every model.", "One prompt. Endless directions.",
    "Same character. Every shot.", "Edit. Enhance. Publish.", "Turn any workflow into an app.", "Open source. Your way.",
    "From idea to everything.", "$ git clone nodaroai/app.nodaro.ai", "Simple, credit-based pricing", "Now shoot yours.",
  ]
  const norm = (t: string): string => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim()
  const plan = planSections(summary, OPTS)

  it("returns at least 10 of the 12 frozen headings in the section map", () => {
    const labels = plan.sections.map((s) => norm(s.label))
    const found = TRUTH.filter((t) => labels.some((l) => l === norm(t) || l.includes(norm(t))))
    expect(found.length).toBeGreaterThanOrEqual(10)
  })

  it("the four plan cards are one pricing section, not four", () => {
    expect(plan.sections.filter((s) => s.category === "pricing").map((s) => s.label)).toEqual(["Simple, credit-based pricing"])
    for (const card of ["Basic", "Standard", "Pro", "Business"]) expect(plan.sections.map((s) => s.label)).not.toContain(card)
  })

  it("no still is a faded-out chapter, and there are still at least three", () => {
    expect(plan.stills.length).toBeGreaterThanOrEqual(3)
    expect(plan.stills.length).toBeLessThanOrEqual(8)
    const hidden = summary.anchors.filter((a) => a.hidden === true).map((a) => a.text)
    expect(hidden.length).toBeGreaterThanOrEqual(7)
    for (const still of plan.stills) expect(hidden).not.toContain(still.label)
  })
})
