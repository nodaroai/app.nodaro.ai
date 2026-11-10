// @test-watches backend/src/lib/tutorial-seed/templates/*.json backend/src/lib/tutorial-seed/__tests__/fixtures/template-listing-prices-rollback.json backend/src/ee/billing/docs-price-settings.json
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// A card is priced as the hosted deployment charges, where speech is priced by length
// (SPEECH_LENGTH_PRICING_ENABLED, on there since 2026-10-08: docs/deployment.md).
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, speechLengthPricingEnabled: () => true }
})
// A RUN estimate stops at a Preview only while the preview stop rule is on: set per case below,
// never read from the environment (a listing never asks it).
const stopRule = vi.hoisted(() => ({ on: false }))
vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => stopRule.on }))

import { renderFinalRunSet, renderRunOverrides, ugcChains } from "@nodaro/render-rules"
import { PREVIEW_RENDER_NODE_TYPES, REVIEW_HOLDING_USE_CASE_TYPES, rendersAsPreview, withRunOverrides } from "@nodaro/shared/nodes"
import { CreditsService, STATIC_CREDIT_COSTS, chargedCredits, chargedPriceTableFrom, type AppListingEstimate } from "../../../ee/billing/credits.js"
import { loadDocsPriceSettings } from "../../../ee/billing/docs-pricing.js"
import { cardPriceOf, pricedByTheUgcEstimate as holdsUgcVideoDoc, templateCardPrice, templateCardPrices, wholeCreditsUp } from "../../../ee/billing/template-card-prices.js"
import { statedPriceTable } from "../../../ee/billing/stated-prices.js"
import { templateForPreviewStopRule } from "../preview-gate.js"
import type { TutorialTemplateDoc } from "../types.js"
import { config, llmMeteredPricing } from "../../config.js"
import { setLlmMeteredSchemaReadyForTesting } from "../../llm-metered-schema-gate.js"
import rollbackFixture from "./fixtures/template-listing-prices-rollback.json"

/**
 * Every built-in template that stores a listing price stores the CHARGED
 * listing — never a hand-typed figure (decided 2026-10-06) and never the
 * price-table rows before the deployment's pricing settings apply (decided
 * 2026-11-10: every card lists what a run is charged, each step at its own
 * charge rounded up to a whole credit). The seeder writes `estimatedCredits` straight into
 * `workflow_templates.estimated_credits`, the price the Tutorials tab and the
 * marketplace card show, so a figure typed by hand drifts the moment a node's
 * price or the graph moves on. `backend/scripts/template-prices.ts --fix`
 * writes them; this suite fails one that differs.
 *
 * The enumeration is the seeder's own (`loadDocs` in ../index.ts): every
 * `*.json` in the templates directory, marketplace and tutorial alike.
 * Operator packs (NODARO_TUTORIAL_PACKS) are not in this repository and are
 * outside this guard.
 *
 * The price is the LISTING a published template stores (decided 2026-10-06:
 * the same function as an app's) — its preview part, every node at its saved
 * settings, plus its final part, each render set to Preview at Final and the
 * nodes after it — each node at the price the hosted deployment charges
 * (`template-card-prices.ts`: STATIC_CREDIT_COSTS charged at
 * docs-price-settings.json, what the doc can know without a database). A price
 * that follows an unknown recording's length is listed per minute of it
 * (decided 2026-10-07): `estimatedCredits` holds the fixed parts,
 * `estimatedPerMinuteCredits` the per-minute parts (absent = 0).
 *
 * What is stored is the doc the sync writes, which follows the preview stop
 * rule (decided 2026-10-08, `templateForPreviewStopRule`): a render set to
 * Preview is written at Final where the rule is off, with the listing of that
 * graph. Each state's stored figure is checked against its own graph.
 *
 * Metered LLM pricing (Task 12, R30) is the default (D6), so the stored figure
 * prices each LLM node at its model's typical-usage estimate — checked here
 * with metered pricing ON (the R33 schema gate pinned ready). Under the
 * tier-pricing rollback the same functions derive the tier figures: a
 * template holding an LLM node derives the figure in
 * `fixtures/template-listing-prices-rollback.json`, every other template its
 * stored figure.
 */
const here = dirname(fileURLToPath(import.meta.url))
const templatesDir = join(here, "..", "templates")
const files = readdirSync(templatesDir).filter((f) => f.endsWith(".json")).sort()

type Node = { id: string; type: string; data?: Record<string, unknown> }
type Edge = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; data?: Record<string, unknown> }

function load(file: string): TutorialTemplateDoc {
  return JSON.parse(readFileSync(join(templatesDir, file), "utf8")) as TutorialTemplateDoc
}

/**
 * A template holding a UGC video (a UGC Clip: the estimate seam's own test, `ugcPartOf`) is priced
 * by the UGC estimate, which plans the video with the private plugin (its clips and the models
 * that make them). This repository holds no such plan, and no app test may name one, so the
 * listing here has no UGC seam and cannot derive that figure. Such a template's stored figure is pinned
 * by its own test and re-derived from the live estimate before release; here it is checked that
 * nothing outside its video is priced, so the video's figure is the whole price.
 */
const holdsUgcVideo = (f: string) => holdsUgcVideoDoc(load(f))
const priced = files.filter((f) => load(f).estimatedCredits !== undefined && !holdsUgcVideo(f))
const pricedByTheUgcEstimate = files.filter((f) => load(f).estimatedCredits !== undefined && holdsUgcVideo(f))

/**
 * The built-in templates that store no price, each with why: their card lists
 * none (the Tutorials tab hides a 0). Each is a guided walkthrough that opens
 * as a finished run, and its guide (the editor's tutorial registry,
 * `tutorial-registry.ts`) headlines something other than a total. Every other
 * template stores one, so a new template cannot reach a card unpriced by
 * leaving the field out. The list only shrinks: a template here that gains a
 * price fails until it is removed.
 */
const UNPRICED: Readonly<Record<string, string>> = {
  "camera-coverage.json":
    "opens with its ten shots already generated from one frame; reading them costs nothing, so its guide counts the shots (10 shots) rather than quoting the fan-out a rerun would charge",
  "get-started-with-image-editing.json":
    "opens with all nine edits of one original already generated; reading them costs nothing, so its guide counts the edits (9 edits) instead of a price",
  "multi-reference-control.json":
    "opens with its one image already generated from five uploaded sources; the lesson is to swap a source and rerun that one image, which its Generate Image node prices on its Run button",
  "one-character-any-scene.json":
    "opens with its five results already generated from two sources; reading them costs nothing, so its guide counts the recipes (5 recipes)",
  "person-node-basics.json":
    "three finished runs to compare, one Person node up to a full stack; its guide says 3 runs, since a total of all three is not what anyone spends to read them",
  "social-media-autopilot.json":
    "opens with a carousel already made and posted; its guide shows that it runs unattended, and a total would include an Instagram post to the reader's own account that reading the run never makes",
  "suno-music-basics.json":
    "seven finished songs, each changing one option from the one before; its guide steps through them to hear the difference (7 runs), not to run all seven",
  "underwater-giants.json":
    "opens with its eight-scene reel already made (images, shots, music, edit); its guide counts the scenes (8 scenes), and a rerun is priced node by node",
  "welcome-demo.json":
    "a finished run whose total would read as a price on something free to look at; its guide quotes the one node a newcomer presses Run on (startCostModel) instead",
}

/** A doc's stored card in one stop-rule state. */
const storedCard = (file: string, rule: "on" | "off") => {
  const t = templateForPreviewStopRule(load(file), rule === "on")
  return { fixed: t.estimatedCredits, perMinute: t.estimatedPerMinuteCredits ?? 0 }
}
/** The charged card the pricing functions derive for that state. */
const chargedCard = (file: string, rule: "on" | "off") => {
  const p = templateCardPrices(load(file))
  const card = rule === "off" && p.withoutPreviewStopRule ? p.withoutPreviewStopRule : p.authored
  return { fixed: card.estimatedCredits, perMinute: card.estimatedPerMinuteCredits ?? 0, estimate: card.estimate }
}

type PricingMode = "metered" | "rollback"
const setMode = (mode: PricingMode) => {
  setLlmMeteredSchemaReadyForTesting(true)
  ;(config as { LLM_TIER_PRICING_ROLLBACK: boolean }).LLM_TIER_PRICING_ROLLBACK = mode === "rollback"
  expect(llmMeteredPricing(), `${mode}: the switch under test`).toBe(mode === "metered")
}
afterAll(() => {
  ;(config as { LLM_TIER_PRICING_ROLLBACK: boolean }).LLM_TIER_PRICING_ROLLBACK = false
  setLlmMeteredSchemaReadyForTesting(undefined)
})
const ROLLBACK_FIGURES: Readonly<Record<string, { estimatedCredits: number }>> = rollbackFixture.templates

describe("built-in template listing prices", () => {
  beforeEach(() => setMode("metered"))

  it("finds the templates the seeder reads, and the ones that store a price", () => {
    // A guard against an empty glob passing every case below vacuously.
    expect(files.length).toBeGreaterThan(40)
    expect(priced.length).toBeGreaterThan(30)
  })

  it("every template stores a price, or is listed as unpriced with its reason", () => {
    const unpriced = files.filter((f) => load(f).estimatedCredits === undefined)
    expect(unpriced, "a new template stores its card (scripts/template-prices.ts --fix), or names here why it has none").toEqual(Object.keys(UNPRICED).sort())
    for (const [file, why] of Object.entries(UNPRICED)) expect(why.trim().length, file).toBeGreaterThan(0)
    // Each says why THAT template has none: no reason shared between two.
    expect(new Set(Object.values(UNPRICED)).size).toBe(Object.keys(UNPRICED).length)
    expect(priced.length + pricedByTheUgcEstimate.length + unpriced.length).toBe(files.length)
  })

  it("prices a UGC video's template by the UGC estimate: only these, each priced for its video alone", () => {
    // A new one is a deliberate choice: its own test pins its figure against the live estimate
    // (ugc-templates.test.ts).
    expect(pricedByTheUgcEstimate).toEqual(["ugc-app-demo.json", "ugc-product-in-hand.json", "ugc-website-video-he.json", "ugc-website-video.json"])
    for (const file of pricedByTheUgcEstimate) {
      const t = load(file)
      const nodes = t.nodes as Node[]
      const edges = t.edges as Edge[]
      const inVideo = new Set(ugcChains(nodes, edges).flatMap((c) => c.members.map((m) => m.id)))
      const rest = nodes.filter((n) => !inVideo.has(n.id))
      const restEdges = edges.filter((e) => !inVideo.has(e.source) && !inVideo.has(e.target))
      const l = CreditsService.estimateWorkflowBaseListing(rest, restEdges, "template")
      expect([file, l.preview + l.final + l.previewPerMinute + l.finalPerMinute]).toEqual([file, 0])
      expect(t.estimatedPerMinuteCredits, file).toBeUndefined()
      // Its creator check runs through the host's metered Image to Text route: its listing is an
      // estimate (R58: the clips' frame readings are an estimate only in the plugin's metered mode).
      expect(t.estimatedCreditsIsEstimate, file).toBe(true)
    }
  })

  it.each(priced.flatMap((f) => [[f, "on"], [f, "off"]] as const))("%s, preview stop rule %s: stores the charged listing of the graph the sync writes", (file, rule) => {
    const t = templateForPreviewStopRule(load(file), rule === "on")
    const charged = chargedCard(file, rule)
    expect(charged.fixed).toBeGreaterThan(0)
    expect(storedCard(file, rule), "stale: cd backend && npx tsx scripts/template-prices.ts --fix").toEqual({ fixed: charged.fixed, perMinute: charged.perMinute })
    // R47: the doc says the figure is an estimate exactly when the listing holds a metered LLM call.
    expect(t.estimatedCreditsIsEstimate === true, "estimatedCreditsIsEstimate").toBe(charged.estimate)
  })

  it.each(priced.flatMap((f) => [[f, "on"], [f, "off"]] as const))("%s, preview stop rule %s: the card is never below the price-table rows of the same listing", (file, rule) => {
    // The charged price marks every row up (or leaves it): a card below its rows lists less than a run costs.
    const t = templateForPreviewStopRule(load(file), rule === "on")
    const rows = CreditsService.estimateWorkflowBaseListing(t.nodes as Node[], t.edges as Edge[], "template")
    const stored = storedCard(file, rule)
    expect(stored.fixed).toBeGreaterThanOrEqual(rows.preview + rows.final)
    expect(stored.perMinute).toBeGreaterThanOrEqual(rows.previewPerMinute + rows.finalPerMinute)
  })

  it.each(priced.flatMap((f) => [[f, "on"], [f, "off"]] as const))("rollback: %s, preview stop rule %s derives its tier figure", (file, rule) => {
    setMode("rollback")
    const charged = chargedCard(file, rule)
    const stored = storedCard(file, rule)
    const tier = ROLLBACK_FIGURES[file]
    // A template with no LLM node lists the same figure either way.
    expect({ fixed: charged.fixed, perMinute: charged.perMinute }).toEqual({ fixed: tier?.estimatedCredits ?? stored.fixed, perMinute: stored.perMinute })
    // Nothing is an estimate under the rollback.
    expect(charged.estimate).toBe(false)
  })

  it("the rollback fixture lists only templates whose figure the switch moves", () => {
    for (const file of Object.keys(ROLLBACK_FIGURES)) {
      expect(priced, file).toContain(file)
      expect(ROLLBACK_FIGURES[file]!.estimatedCredits, file).not.toBe(load(file).estimatedCredits)
    }
  })

  it("a template with no length-dependent part stores no per-minute figure", () => {
    for (const file of priced) {
      const t = load(file)
      if (t.estimatedPerMinuteCredits !== undefined) expect(t.estimatedPerMinuteCredits, file).toBeGreaterThan(0)
    }
  })
})

// Each part of a card is whole credits (the per-minute column is an integer), and a card is never
// below what a run is charged (decided 2026-11-10): each step at its own charge, rounded up to a
// whole credit as the run charges it, the card the sum of them.
describe("a card's figures: each step's charge, rounded up, summed", () => {
  const table = chargedPriceTableFrom(new Map([["render", 15], ["preview", 3], ["final", 12]]), { cost_markup_percent: 10, service_margin_percent: {} })
  const listing = (parts: Partial<AppListingEstimate>): AppListingEstimate => ({ preview: 0, final: 0, previewPerMinute: 0, finalPerMinute: 0, ...parts })
  const perMinute = (...ids: string[]) => ids.reduce((sum, id) => sum + chargedCredits(table, id, 1)!, 0)

  it("a step charged 16.5 a minute lists 17", () => {
    // 15 a minute in the price table is charged 16.5 a minute: a whole credit up.
    expect(chargedCredits(table, "render", 1)).toBe(17)
    expect(cardPriceOf(listing({ preview: 74, previewPerMinute: perMinute("render") }))).toEqual({ estimatedCredits: 74, estimatedPerMinuteCredits: 17, estimate: false })
  })

  it("two steps are each rounded up before they are added (3.3 + 13.2 a minute lists 4 + 14 = 18)", () => {
    // A run charges its Preview and its Render final separately, each rounded up, so the card does too.
    expect([chargedCredits(table, "preview", 1), chargedCredits(table, "final", 1)]).toEqual([4, 14])
    expect(cardPriceOf(listing({ preview: 74, previewPerMinute: perMinute("preview"), finalPerMinute: perMinute("final") })).estimatedPerMinuteCredits).toBe(18)
  })

  it("the fixed parts of a run and its Render final add up; no per-minute part stores none", () => {
    expect(cardPriceOf(listing({ preview: 70, final: 4, previewPerMinute: 4, finalPerMinute: 14 }))).toEqual({ estimatedCredits: 74, estimatedPerMinuteCredits: 18, estimate: false })
    expect(cardPriceOf(listing({ preview: 12 })).estimatedPerMinuteCredits).toBeUndefined()
  })

  it("a part that is not a whole credit is rounded up, never down; a float's last digit never adds one", () => {
    expect(cardPriceOf(listing({ preview: 73.2, previewPerMinute: 16.5 }))).toEqual({ estimatedCredits: 74, estimatedPerMinuteCredits: 17, estimate: false })
    expect(wholeCreditsUp(0.1 + 0.2 + 15.7)).toBe(16)
    expect(wholeCreditsUp(16.000001)).toBe(17)
  })

  it("an id the deployment charges differently is listed at its snapshot figure, per unit", () => {
    // docs-price-settings.json's `charged` snapshot: an admin's runtime reprice, or a plugin's price.
    const snapshot = Object.entries(loadDocsPriceSettings().charged)
    expect(snapshot.length).toBeGreaterThan(0)
    const prices = statedPriceTable()
    for (const [id, figure] of snapshot) {
      expect(chargedCredits(prices, id), id).toBe(figure)
      expect(chargedCredits(prices, id, 2), id).toBe(2 * figure)
      expect(() => chargedCredits(prices, id, 0.5), id).toThrow(/charged snapshot/)
    }
  })
})

// A card is never below what a run of its graph is charged (decided 2026-11-10), checked against
// the run itself: each built-in card with a per-minute part, in both states of the preview stop
// rule, against the run of its graph on a recording 1 to 180 minutes long — its run (stopping at a
// Preview where the rule is on) and each Render final — every step priced by the run estimate at
// the same charged table the card is priced at, on a server that charges Edit Plan per started
// minute: each length-priced step its rate times its started minutes, rounded up once, charged,
// as its route reserves it (`speaker-view-plan.ts`, `apply-edl-plan.ts`, Edit Plan's
// `edit-plan:<mode>:<tier>:<N>m`).
//
// The steps the card lists per minute are checked on their own: the card's per-minute figure
// times the minutes, plus what those steps list as fixed, against those steps' charge. The whole
// card is checked too, but its fixed part lists steps such as Transcribe and Speaker Frames at
// their 180-minute ceilings, which can hide a short run's per-step rounding. (Rounding the summed
// per-minute rates once instead fails five of these cases, the Vertical speaker clip's at one
// minute: its steps list 17, a run charges 18.)
describe("a card is never below what a run of its graph is charged, at any recording length", () => {
  const RECORDINGS = new Set(["upload-video", "upload-audio", "reference-audio", "youtube-video"])
  /** The graph with every recording the cloner drops in `minutes` long. */
  const withRecordingOf = (nodes: Node[], minutes: number): Node[] =>
    nodes.map((n) => {
      if (!RECORDINGS.has(n.type)) return n
      const metadata = { ...((n.data?.metadata as Record<string, unknown> | undefined) ?? {}), durationSeconds: minutes * 60 }
      return { ...n, data: { ...n.data, duration: minutes * 60, metadata } }
    })
  /** What each step of a run of `nodes` is charged, by node id: the run, then each Render final. */
  const runCharges = (nodes: Node[], edges: Edge[]): Map<string, number> => {
    const prices = { ...statedPriceTable(), editPlanPerMinute: true }
    const charged = new Map<string, number>()
    const onNode = (id: string, credits: number) => charged.set(id, (charged.get(id) ?? 0) + credits)
    CreditsService.estimateWorkflowCreditsAt(prices, nodes, edges, undefined, onNode)
    for (const render of nodes.filter((n) => PREVIEW_RENDER_NODE_TYPES.has(n.type) && rendersAsPreview(n))) {
      const set = renderFinalRunSet(render.id, nodes, edges)
      CreditsService.estimateWorkflowCreditsAt(prices, withRunOverrides(nodes, renderRunOverrides(render.id, "final", set)), edges, { runNodeIds: set }, onNode)
    }
    for (const node of nodes.filter((n) => REVIEW_HOLDING_USE_CASE_TYPES.has(n.type) && n.data?.reviewBeforeRender === true)) {
      const finalOf = nodes.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, useCaseContinue: { mode: "render-final", jobId: "job-1" } } } : n))
      CreditsService.estimateWorkflowCreditsAt(prices, finalOf, edges, { runNodeIds: new Set([node.id]) }, onNode)
    }
    return charged
  }
  const perMinuteCards = priced.filter((f) => load(f).estimatedPerMinuteCredits !== undefined)

  it("covers every card with a per-minute part, the podcast cards among them", () => {
    expect(perMinuteCards).toEqual(expect.arrayContaining(["podcast-vertical-speaker-clip.json", "podcast-tighten-episode.json", "podcast-tighten-episode-one-node.json", "podcast-multicam-cut.json"]))
  })

  it.each(perMinuteCards.flatMap((f) => [[f, "on"], [f, "off"]] as const))("%s, preview stop rule %s", (file, rule) => {
    stopRule.on = rule === "on"
    try {
      const t = templateForPreviewStopRule(load(file), rule === "on")
      const nodes = t.nodes as Node[]
      const edges = t.edges as Edge[]
      const card = templateCardPrice(nodes, edges)
      // The steps the card lists per minute, and what each lists as fixed beside its rate.
      const listed = new Map<string, { fixed: number; perMinute: number }>()
      CreditsService.estimateWorkflowListingAt(statedPriceTable(), nodes, edges, "template", undefined, (id, _part, fixed, perMinute) => {
        const was = listed.get(id) ?? { fixed: 0, perMinute: 0 }
        listed.set(id, { fixed: was.fixed + fixed, perMinute: was.perMinute + perMinute })
      })
      const lengthSteps = [...listed].filter(([, p]) => p.perMinute > 0).map(([id]) => id)
      expect(lengthSteps.length, "a step listed per minute").toBeGreaterThan(0)
      const listedFixed = lengthSteps.reduce((sum, id) => sum + listed.get(id)!.fixed, 0)
      const below: string[] = []
      for (let minutes = 1; minutes <= 180; minutes++) {
        const charged = runCharges(withRecordingOf(nodes, minutes), edges)
        // Every step the card lists per minute runs (a step the run never prices would pass vacuously).
        for (const id of lengthSteps) expect(charged.get(id) ?? 0, `${id} at ${minutes} min`).toBeGreaterThan(0)
        const steps = lengthSteps.reduce((sum, id) => sum + charged.get(id)!, 0)
        const stepsListed = listedFixed + (card.estimatedPerMinuteCredits ?? 0) * minutes
        if (stepsListed < steps) below.push(`${minutes} min: its length-priced steps list ${stepsListed}, a run charges ${steps}`)
        const run = [...charged.values()].reduce((a, b) => a + b, 0)
        const whole = card.estimatedCredits + (card.estimatedPerMinuteCredits ?? 0) * minutes
        if (whole < run) below.push(`${minutes} min: the card lists ${whole}, a run charges ${run}`)
      }
      expect(below).toEqual([])
    } finally {
      stopRule.on = false
    }
  })
})

// The four podcast templates (decided 2026-10-07). At the 180-minute cap a
// per-minute listing is the figure the ceiling listing quoted before
// (Tighten 2602, Multicam 2582), so splitting it dropped nothing; Trailer is
// its plan, its render and its Combine Videos at 40 seconds, the longest trailer
// the plan cuts (decided 2026-10-18; 1102 at the 2-minute headroom before): 932;
// Clip Pack its old 832 plus 4 more renders
// of 2 minutes and 4 more caption runs (1112).
//
// Each now renders a Preview first (decided 2026-10-08), so its listing is in
// two parts. The preview part is that old price with the render at the
// Preview rate; the final part is its Render final: the render again at
// Final, and every node after it (Camera Switch first, in Multicam).
//
// These pin the listing's SHAPE, at the price-table rows (the figures above
// are rows); the card each template stores is that listing charged, held by
// the suite above.
describe("the podcast templates per minute", () => {
  beforeEach(() => setMode("metered"))
  const CAP = 180
  const FINAL = STATIC_CREDIT_COSTS["apply-edl"]!
  const PREVIEW = STATIC_CREDIT_COSTS["apply-edl:proxy"]!
  const rowsListing = (file: string) => {
    const t = load(file)
    return CreditsService.estimateWorkflowBaseListing(t.nodes as Node[], t.edges as Edge[], "template")
  }
  const parts = (file: string) => {
    const l = rowsListing(file)
    return { preview: l.preview + CAP * l.previewPerMinute, final: l.final + CAP * l.finalPerMinute }
  }
  /** The listing at the rows, read as its two figures (fixed + per minute), at the cap. */
  const atCap = (file: string) => {
    const l = rowsListing(file)
    return l.preview + l.final + CAP * (l.previewPerMinute + l.finalPerMinute)
  }
  /** What the nodes after the render (and Camera Switch) add to a final. */
  const tail = (file: string, ids: string[]) => {
    const t = load(file)
    return CreditsService.estimateWorkflowBaseCredits(t.nodes as Node[], t.edges as Edge[], { runNodeIds: new Set(ids) })
  }

  it("the rates: a Preview is billed below a Final", () => {
    expect(PREVIEW).toBeGreaterThan(0)
    expect(PREVIEW).toBeLessThan(FINAL)
  })

  // [file, the old Final-only price at the cap, the render's minutes across all its runs, the nodes after it]
  it.each([
    ["podcast-tighten-episode.json", 2602, 180, ["tighten-captions"]],
    ["podcast-multicam-cut.json", 2582, 180, ["multicam-switch"]],
    ["podcast-trailer-formats.json", 932, 1, ["trailer-combine", "trailer-format-story", "trailer-format-square", "trailer-format-portrait"]],
    ["podcast-clip-pack.json", 1112, 5 * 2, ["clips-captions"]],
  ] as const)("%s: its old price with the render at Preview (%i before), plus its Render final", (file, before, minutes, after) => {
    const { preview, final } = parts(file)
    expect(preview).toBe(before - minutes * (FINAL - PREVIEW))
    expect(final).toBe(minutes * FINAL + tail(file, [...after]))
    expect(atCap(file)).toBe(preview + final)
  })

  it("pins the four at the cap, at the price-table rows", () => {
    expect({
      tighten: atCap("podcast-tighten-episode.json"),
      multicam: atCap("podcast-multicam-cut.json"),
      trailer: atCap("podcast-trailer-formats.json"),
      clipPack: atCap("podcast-clip-pack.json"),
    }).toEqual({ tighten: 2832, multicam: 2772, trailer: 1093, clipPack: 1372 })
  })
})
