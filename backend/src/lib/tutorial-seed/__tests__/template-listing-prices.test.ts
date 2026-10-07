import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { CreditsService } from "../../../ee/billing/credits.js"
import { videoUtilityBaseCredits, videoUtilityEstimateBody } from "../../video-utility-credits.js"
import type { TutorialTemplateDoc } from "../types.js"

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
 */
const here = dirname(fileURLToPath(import.meta.url))
const templatesDir = join(here, "..", "templates")
const files = readdirSync(templatesDir).filter((f) => f.endsWith(".json")).sort()

type Node = { id: string; type: string; data?: Record<string, unknown> }
type Edge = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; data?: Record<string, unknown> }

function load(file: string): TutorialTemplateDoc {
  return JSON.parse(readFileSync(join(templatesDir, file), "utf8")) as TutorialTemplateDoc
}

const priced = files.filter((f) => load(f).estimatedCredits !== undefined)

describe("built-in template listing prices", () => {
  it("finds the templates the seeder reads, and the ones that store a price", () => {
    // A guard against an empty glob passing every case below vacuously.
    expect(files.length).toBeGreaterThan(40)
    expect(priced.length).toBeGreaterThan(30)
  })

  it.each(priced)("%s stores the listing the pricing functions derive for it", (file) => {
    const t = load(file)
    const l = CreditsService.estimateWorkflowBaseListing(t.nodes as Node[], t.edges as Edge[], "template")
    expect(l.preview).toBeGreaterThan(0)
    expect({ fixed: t.estimatedCredits, perMinute: t.estimatedPerMinuteCredits ?? 0 }).toEqual({
      fixed: l.preview + l.final,
      perMinute: l.previewPerMinute + l.finalPerMinute,
    })
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
// above its old 882 by its Combine Videos alone, which now counts the
// trailer render's 2 minutes rather than the 8-second fallback (decided
// 2026-10-07); Clip Pack is above its old 832 by its fan-out alone: 4 more
// renders of 2 minutes and 4 more caption runs.
describe("the podcast templates per minute", () => {
  const CAP = 180
  const atCap = (file: string) => {
    const t = load(file)
    return t.estimatedCredits! + CAP * (t.estimatedPerMinuteCredits ?? 0)
  }

  it.each([
    ["podcast-tighten-episode.json", 2602],
    ["podcast-multicam-cut.json", 2582],
  ])("%s at the cap is its old ceiling price (%i)", (file, before) => {
    expect(atCap(file)).toBe(before)
  })

  it("podcast-trailer-formats.json at the cap is its old 882 plus its Combine on the render's 2 minutes", () => {
    const t = load("podcast-trailer-formats.json")
    const combine = (t.nodes as Node[]).find((n) => n.type === "combine-videos")!
    const body = videoUtilityEstimateBody(combine, t.edges as Edge[])!
    // The intro card stays at the fallback (undefined); the render is 2 minutes.
    const atRender = videoUtilityBaseCredits("combine-videos", { ...body, upstreamDurations: [undefined, 2 * 60] })!
    const atFallback = videoUtilityBaseCredits("combine-videos", { ...body, upstreamDurations: [undefined, undefined] })!
    expect(atCap("podcast-trailer-formats.json")).toBe(882 + atRender - atFallback)
  })

  it("podcast-clip-pack.json at the cap is its old price plus 4 more clips (render + captions)", () => {
    const t = load("podcast-clip-pack.json")
    // One clip's render (2 minutes) and caption run: the run estimate of each
    // node counts all 5 clips, as the listing does (decided 2026-10-07).
    const perClip = (id: string) => CreditsService.estimateWorkflowBaseCredits(t.nodes as Node[], t.edges as Edge[], { runNodeIds: new Set([id]) }) / 5
    expect(atCap("podcast-clip-pack.json")).toBe(832 + 4 * (perClip("clips-apply") + perClip("clips-captions")))
  })
})
