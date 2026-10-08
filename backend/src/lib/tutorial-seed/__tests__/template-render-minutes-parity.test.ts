/**
 * The listing's half of the render-length parity (decided 2026-10-07): a
 * built-in template's stored price must assume the SAME Apply EDL render
 * length, and the same clip count, the editor's run estimate assumes once the
 * template is cloned. Both read one rule, `@nodaro/render-rules`
 * (`resolveApplyEdlEstimateMinutes` / `resolveApplyEdlEstimateLength` for the
 * minutes, `nodeFanOut` for the runs), and both halves read one
 * fixture; the editor's half is
 * frontend/src/lib/__tests__/template-render-minutes-parity.test.ts.
 *
 * The listing lists a render whose length follows the episode PER MINUTE of
 * it (decided 2026-10-07); at the 180-minute cap that is the editor's figure.
 *
 * The server's RUN estimate (`estimateWorkflowCredits`: the app runner's
 * seeded quote, the API and MCP quotes, `/v1/credits/estimate-workflow`, and
 * the Render final quote and balance check) reads the same rules (decided
 * 2026-10-07), pinned in the last block below.
 *
 * `template-listing-prices.test.ts` pins each stored price to the listing
 * function, so a listing that priced a render at any other length would move
 * the price it pins.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { nodeFanOut, renderFinalRunSet, renderRunOverrides, resolveApplyEdlEstimateLength } from "@nodaro/render-rules"
import { withRunOverrides } from "@nodaro/shared"
import { CreditsService, graphPricingUnits } from "../../../ee/billing/credits.js"
import { APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE } from "../../apply-edl-plan.js"
import { videoUtilityBaseCredits, videoUtilityEstimateBody } from "../../video-utility-credits.js"
import type { TutorialTemplateDoc } from "../types.js"

const here = dirname(fileURLToPath(import.meta.url))
const templatesDir = join(here, "..", "templates")

type Node = { id: string; type: string; data?: Record<string, unknown> }
type Edge = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }

const templates = readdirSync(templatesDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(templatesDir, f), "utf8")) as TutorialTemplateDoc)
const rendering = templates.filter((t) => (t.nodes as Node[]).some((n) => n.type === "apply-edl"))
const fixture = JSON.parse(readFileSync(join(here, "fixtures", "template-render-minutes.json"), "utf8")) as {
  minutes: Record<string, number>
  perEpisodeMinute: Record<string, number>
  fanOut: Record<string, number>
}
const expected = fixture.minutes
/** The steps priced by the length of the video they are given. */
const LENGTH_PRICED: ReadonlySet<string> = new Set(["trim-video", "loop-video", "combine-videos", "video-sfx"])

describe("template render minutes — the listing reads the shared fixture", () => {
  it("covers every built-in template that renders an EDL", () => {
    expect(rendering.map((t) => t.slug).sort()).toEqual(Object.keys(expected).sort())
  })

  it.each(rendering.map((t) => [t.slug, t] as const))("%s", (slug, t) => {
    const nodes = t.nodes as Node[]
    const edges = t.edges as Edge[]
    // A listing prices the whole graph: every node runs, so a plan re-plans.
    const everyNode = new Set(nodes.map((n) => n.id))
    for (const render of nodes.filter((n) => n.type === "apply-edl")) {
      expect(graphPricingUnits(render, nodes, edges, everyNode), `${slug} / ${render.id}`).toBe(expected[slug])
      // Listed per minute of the episode when the render follows it; the rest fixed.
      const length = resolveApplyEdlEstimateLength(render, nodes, edges, everyNode)
      expect(length.perEpisodeMinute, `${slug} / ${render.id} per episode minute`).toBe(fixture.perEpisodeMinute[slug] ?? 0)
      // The clip count, as the editor counts it.
      expect(nodeFanOut(render, nodes, edges, everyNode), `${slug} / ${render.id} fan-out`).toBe(fixture.fanOut[slug] ?? 1)
    }
  })
})

// One rule, no copies: the render-length assumptions are declared only in
// @nodaro/render-rules. A second declaration in either app is a second rule
// that can drift from the one the listing, the editor and the server's run
// estimate share.
describe("the render-length rule has one home", () => {
  const REPO = join(here, "..", "..", "..", "..", "..")
  const DECLARES = /\b(?:const|let|var|function)\s+(?:TRAILER_MAX_SEC|CLIP_LENGTH_HEADROOM|ASSUMED_CLIP_TARGET_SEC|resolveApplyEdlEstimateMinutes|editPlanRenderEstimateMinutes)\b/
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sources(path)
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
    })
  }

  it("declares them nowhere in the backend or the editor", () => {
    const offenders = [join(REPO, "backend", "src"), join(REPO, "frontend", "src")]
      .flatMap(sources)
      .filter((path) => DECLARES.test(readFileSync(path, "utf8")))
      .map((path) => path.slice(REPO.length + 1))
    // The editor's face wraps the shared rule under the same name.
    expect(offenders).toEqual(["frontend/src/lib/apply-edl-estimate.ts"])
    const face = readFileSync(join(REPO, "frontend", "src", "lib", "apply-edl-estimate.ts"), "utf8")
    expect(face).toMatch(/resolveApplyEdlEstimateMinutes as resolveMinutesWith,?\s*\} from "@nodaro\/render-rules"/)
    expect(face).toMatch(/return resolveMinutesWith\(node, nodes, edges, rerunIds, readPlan\)/)
  })

  it("is declared in @nodaro/render-rules", () => {
    const home = readFileSync(join(REPO, "packages", "render-rules", "src", "apply-edl-estimate.ts"), "utf8")
    expect(home).toMatch(/export function resolveApplyEdlEstimateMinutes\(/)
    expect(home).toMatch(/export const TRAILER_MAX_SEC = /)
  })
})

// The listing's FINAL part prices each Preview render's Render final. In an
// app run that final renders the plan the app user's Preview run just made,
// never the creator's saved one (review F1, decided 2026-10-07): with or
// without a saved plan, a tighten's final is per minute of the user's episode.
describe("a listing's Render final prices the render per minute of the user's episode", () => {
  const seg = (inMs: number, outMs: number) => ({ id: `s${inMs}`, inMs, outMs, video: "v" })
  const graph = (planData: Record<string, unknown>) => ({
    nodes: [
      { id: "rec", type: "upload-video", data: {} },
      { id: "plan", type: "edit-plan", data: { mode: "tighten", planTier: "standard", ...planData } },
      { id: "render", type: "apply-edl", data: { quality: "proxy" } },
    ],
    edges: [
      { source: "rec", target: "plan", targetHandle: "sources" },
      { source: "plan", target: "render", sourceHandle: "edl", targetHandle: "edl" },
    ],
  })

  it("with no saved plan: per minute, 180 minutes at the cap", () => {
    const { nodes, edges } = graph({})
    const { final, finalPerMinute } = CreditsService.estimateWorkflowBaseListing(nodes, edges, "app")
    expect({ final, finalPerMinute }).toEqual({ final: 0, finalPerMinute: APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE })
    expect(final + 180 * finalPerMinute).toBe(APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE * 180)
  })

  it("with a saved plan: still per minute, never the creator's 3-minute sample", () => {
    const edl = { version: 1, clock: "master", sources: [{ id: "v", url: "https://cdn/v.mp4", kind: "video" }], segments: [seg(0, 150_000)] }
    const { nodes, edges } = graph({ generatedJson: edl })
    const { final, finalPerMinute } = CreditsService.estimateWorkflowBaseListing(nodes, edges, "app")
    expect({ final, finalPerMinute }).toEqual({ final: 0, finalPerMinute: APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE })
  })
})

// The server's run estimate (`estimateWorkflowCredits`, here at base prices)
// reads the same rules (decided 2026-10-07): each render at the shared rule's
// minutes, every node times the runs it makes. So, for each built-in
// template, each part of the listing at the 180-minute cap (fixed + 180 × per
// minute) IS a run estimate: the preview part is a whole run's, and the final
// part, for a template whose render is set to Preview (decided 2026-10-08), is
// its Render final's (the render at Final and every node after it). The
// three-way parity, the editor included, is run-estimate-parity.test.ts.
describe("the server's run estimate prices a render as the listing does", () => {
  it.each(rendering.map((t) => [t.slug, t] as const))("%s", (slug, t) => {
    const nodes = t.nodes as Node[]
    const edges = t.edges as Edge[]
    const run = CreditsService.estimateWorkflowBaseCredits(nodes, edges, { scope: "whole-graph" })
    const finals = nodes
      .filter((n) => n.type === "apply-edl" && n.data?.quality === "proxy")
      .map((render) => {
        const set = renderFinalRunSet(render.id, nodes, edges)
        const priced = withRunOverrides(nodes, renderRunOverrides(render.id, "final", set))
        return CreditsService.estimateWorkflowBaseCredits(priced, edges, { runNodeIds: set })
      })
    const l = CreditsService.estimateWorkflowBaseListing(nodes, edges, "template")
    expect(l.preview + 180 * l.previewPerMinute - run, `${slug}: the preview part`).toBe(0)
    expect(l.final + 180 * l.finalPerMinute - finals.reduce((a, b) => a + b, 0), `${slug}: the final part`).toBe(0)
  })
})
