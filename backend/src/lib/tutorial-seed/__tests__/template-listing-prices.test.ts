import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { ugcChains } from "@nodaro/render-rules"
import { CreditsService, STATIC_CREDIT_COSTS } from "../../../ee/billing/credits.js"
import { templateForPreviewStopRule } from "../preview-gate.js"
import type { TutorialTemplateDoc } from "../types.js"
import { config, llmMeteredPricing } from "../../config.js"
import { setLlmMeteredSchemaReadyForTesting } from "../../llm-metered-schema-gate.js"
import rollbackFixture from "./fixtures/template-listing-prices-rollback.json"

/**
 * Every built-in template that stores a listing price stores the estimator's
 * figure — never a hand-typed one (decided 2026-10-06). The seeder writes
 * `estimatedCredits` straight into `workflow_templates.estimated_credits`, the
 * price the Tutorials tab and the marketplace card show, so a figure typed by
 * hand drifts the moment a node's price or the graph moves on.
 *
 * The enumeration is the seeder's own (`loadDocs` in ../index.ts): every
 * `*.json` in the templates directory, marketplace and tutorial alike.
 * Operator packs (NODARO_TUTORIAL_PACKS) are not in this repository and are
 * outside this guard.
 *
 * The price is the LISTING a published template stores (decided 2026-10-06:
 * the same function as an app's) — its preview part, every node at its saved
 * settings, plus its final part, each render set to Preview at Final and the
 * nodes after it — at STATIC_CREDIT_COSTS' base prices, what the doc can know
 * without a database. A price that follows an unknown recording's length is
 * listed per minute of it (decided 2026-10-07): `estimatedCredits` holds the
 * fixed parts, `estimatedPerMinuteCredits` the per-minute parts (absent = 0).
 *
 * What is stored is the doc the sync writes, which follows the preview stop
 * rule (decided 2026-10-08, `templateForPreviewStopRule`): a render set to
 * Preview is written at Final where the rule is off, with the listing of that
 * graph. Each state's stored figure is checked against its own graph.
 *
 * Metered LLM pricing (Task 12, R30) is the default (D6), so the stored figure
 * prices each LLM node at its model's typical-usage estimate — checked here
 * with metered pricing ON (the R33 schema gate pinned ready). Under the
 * tier-pricing rollback the same functions derive today's tier figures, byte
 * for byte: a template holding an LLM node derives the figure in
 * `fixtures/template-listing-prices-rollback.json` (the one it stored before
 * metered pricing), every other template its stored figure.
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
 * that make them). This repository holds no such plan, and no app test may name one, so the base
 * listing has no UGC seam and cannot derive that figure. Such a template's stored figure is pinned
 * by its own test and re-derived from the live estimate before release; here it is checked that
 * nothing outside its video is priced, so the video's figure is the whole price.
 */
const holdsUgcVideo = (f: string) => (load(f).nodes as Node[]).some((n) => n.type === "ugc-clip")
const priced = files.filter((f) => load(f).estimatedCredits !== undefined && !holdsUgcVideo(f))
const pricedByTheUgcEstimate = files.filter((f) => load(f).estimatedCredits !== undefined && holdsUgcVideo(f))

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

  it.each(priced.flatMap((f) => [[f, "on"], [f, "off"]] as const))("%s, preview stop rule %s: stores the listing the pricing functions derive for the graph the sync writes", (file, rule) => {
    const t = templateForPreviewStopRule(load(file), rule === "on")
    const l = CreditsService.estimateWorkflowBaseListing(t.nodes as Node[], t.edges as Edge[], "template")
    expect(l.preview).toBeGreaterThan(0)
    expect({ fixed: t.estimatedCredits, perMinute: t.estimatedPerMinuteCredits ?? 0 }).toEqual({
      fixed: l.preview + l.final,
      perMinute: l.previewPerMinute + l.finalPerMinute,
    })
    // R47: the doc says the figure is an estimate exactly when the listing holds a metered LLM call.
    expect(t.estimatedCreditsIsEstimate === true, "estimatedCreditsIsEstimate").toBe(l.estimate === true)
  })

  it.each(priced.flatMap((f) => [[f, "on"], [f, "off"]] as const))("rollback: %s, preview stop rule %s derives today's tier figure", (file, rule) => {
    setMode("rollback")
    const t = templateForPreviewStopRule(load(file), rule === "on")
    const l = CreditsService.estimateWorkflowBaseListing(t.nodes as Node[], t.edges as Edge[], "template")
    const tier = ROLLBACK_FIGURES[file]
    // A template with no LLM node lists the same figure either way.
    expect({ fixed: l.preview + l.final, perMinute: l.previewPerMinute + l.finalPerMinute }).toEqual({
      fixed: tier?.estimatedCredits ?? t.estimatedCredits,
      perMinute: t.estimatedPerMinuteCredits ?? 0,
    })
    // Nothing is an estimate under the rollback.
    expect(l.estimate).toBeUndefined()
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
describe("the podcast templates per minute", () => {
  beforeEach(() => setMode("metered"))
  const CAP = 180
  const FINAL = STATIC_CREDIT_COSTS["apply-edl"]!
  const PREVIEW = STATIC_CREDIT_COSTS["apply-edl:proxy"]!
  const parts = (file: string) => {
    const t = load(file)
    const l = CreditsService.estimateWorkflowBaseListing(t.nodes as Node[], t.edges as Edge[], "template")
    return { preview: l.preview + CAP * l.previewPerMinute, final: l.final + CAP * l.finalPerMinute }
  }
  const atCap = (file: string) => {
    const t = load(file)
    return t.estimatedCredits! + CAP * (t.estimatedPerMinuteCredits ?? 0)
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

  it("pins the four at the cap", () => {
    expect({
      tighten: atCap("podcast-tighten-episode.json"),
      multicam: atCap("podcast-multicam-cut.json"),
      trailer: atCap("podcast-trailer-formats.json"),
      clipPack: atCap("podcast-clip-pack.json"),
    }).toEqual({ tighten: 2832, multicam: 2772, trailer: 1093, clipPack: 1372 })
  })
})
