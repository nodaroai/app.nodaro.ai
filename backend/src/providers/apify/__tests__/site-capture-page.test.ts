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
