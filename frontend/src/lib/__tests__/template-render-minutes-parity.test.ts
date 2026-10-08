/**
 * The editor's half of the render-length parity (decided 2026-10-07): once a
 * built-in template is cloned, the editor's run estimate (Execute-All, every
 * executable node re-running) prices each Apply EDL render at the length the
 * template's stored listing assumed. Both read `@nodaro/render-rules`'
 * `resolveApplyEdlEstimateMinutes` and one fixture; the listing's half is
 * backend/src/lib/tutorial-seed/__tests__/template-render-minutes-parity.test.ts.
 *
 * It reads BOTH cost factors the editor prices a render with, and both must
 * match the listing's: the minutes (the listing lists a render that follows
 * the episode per minute of it, which at the 180-minute cap is this figure)
 * and the fan-out, the runs both count through `@nodaro/render-rules`'
 * `nodeFanOut` (decided 2026-10-07; the fixture's `fanOut`, 1 when absent).
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { nodeFanOut } from "@nodaro/render-rules"
import { getCostFactors, isExecutableNode } from "@/components/editor/workflow-editor/types"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = join(HERE, "../../../../backend/src/lib/tutorial-seed/templates")
const FIXTURE = join(HERE, "../../../../backend/src/lib/tutorial-seed/__tests__/fixtures/template-render-minutes.json")

const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as { minutes: Record<string, number>; fanOut: Record<string, number> }
const expected = fixture.minutes
const fanOut = fixture.fanOut

type Template = { slug: string; nodes: WorkflowNode[]; edges: WorkflowEdge[] }
const rendering = readdirSync(TEMPLATES_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(TEMPLATES_DIR, f), "utf8")) as Template)
  .filter((t) => t.nodes.some((n) => n.type === "apply-edl"))

describe("template render minutes — the editor reads the shared fixture", () => {
  it("covers every built-in template that renders an EDL", () => {
    expect(rendering.map((t) => t.slug).sort()).toEqual(Object.keys(expected).sort())
  })

  it.each(rendering.map((t) => [t.slug, t] as const))("%s", (slug, t) => {
    // A whole-workflow run: every executable node re-runs, as Execute-All prices it.
    const rerunIds = new Set(t.nodes.filter(isExecutableNode).map((n) => n.id))
    for (const render of t.nodes.filter((n) => n.type === "apply-edl")) {
      const factors = getCostFactors(render, t.nodes, t.edges, rerunIds)
      expect(factors.units, `${slug} / ${render.id} minutes`).toBe(expected[slug])
      expect(factors.fanOut, `${slug} / ${render.id} fan-out (the listing's too)`).toBe(fanOut[slug] ?? 1)
    }
  })
})

// Every node, not only the render: the listing multiplies each node by the
// shared fan-out (`nodeFanOut`), and so does the editor's estimate: for
// these templates the two agree node for node (Clip Pack's Caption Clip
// runs once per clip in both).
describe("template fan-out — the editor and the listing count the same runs", () => {
  it.each(rendering.map((t) => [t.slug, t] as const))("%s", (_slug, t) => {
    const rerunIds = new Set(t.nodes.filter(isExecutableNode).map((n) => n.id))
    for (const node of t.nodes.filter(isExecutableNode)) {
      expect(getCostFactors(node, t.nodes, t.edges, rerunIds).fanOut, node.id).toBe(nodeFanOut(node, t.nodes, t.edges, rerunIds))
    }
  })
})
