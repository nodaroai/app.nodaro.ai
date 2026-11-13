// @test-watches packages/shared/src/__tests__/fixtures/video-utility-quote-parity.json
/**
 * Trim Video, Loop Video and Combine Videos are charged the length their run
 * measures, so the editor quotes them at the units the server's workflow
 * estimate quotes: both read the one measured walk (`measuredWireLengthSec`,
 * @nodaro/render-rules). A node that runs is read at its planned length (plus
 * the slack once on each clip a node makes), a node that does not run at the
 * take it hands on, a frozen node never as running, and a clip nothing can
 * size at the 8-second fallback. For a whole run the editor passes its own
 * whole-run set (`wholeRunExecutable`, which keeps frozen nodes); for the step
 * alone, its own Run (`{t}`) and its pill (no run set) quote the same. The
 * server half is backend/src/ee/billing/__tests__/video-utility-quote-parity.test.ts,
 * over the same fixture.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { videoUtilityPricingUnits } from "@/lib/video-utility-estimate"
import { wholeRunExecutable } from "@/components/editor/workflow-editor/estimate-run-credits"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

type StepKey = "trim" | "loop" | "combine"

interface ParityCase {
  readonly name: string
  readonly step: StepKey
  readonly stepData?: Record<string, unknown>
  readonly nodes: ReadonlyArray<{ id: string; type: string; data: Record<string, unknown> }>
  readonly edges: ReadonlyArray<{ source: string; target: string; targetHandle: string }>
  readonly expectedUnits: { readonly whole: number; readonly alone: number }
  readonly partial?: { readonly runSet: readonly string[]; readonly expectedUnits: number }
}

const F = JSON.parse(
  readFileSync(join(__dirname, "../../../../packages/shared/src/__tests__/fixtures/video-utility-quote-parity.json"), "utf8"),
) as { steps: Record<StepKey, { type: string; data: Record<string, unknown> }>; cases: ParityCase[] }

function graph(c: ParityCase): { node: WorkflowNode; nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const step = F.steps[c.step]
  const node = { id: "t", type: step.type, position: { x: 0, y: 0 }, data: { label: "t", ...(c.stepData ?? step.data) } } as unknown as WorkflowNode
  const nodes = [...c.nodes.map((n) => ({ ...n, position: { x: 0, y: 0 }, data: { label: n.id, ...n.data } })), node] as unknown as WorkflowNode[]
  const edges = c.edges.map((e, i) => ({ id: `e${i}`, source: e.source, target: e.target, targetHandle: e.targetHandle })) as WorkflowEdge[]
  return { node, nodes, edges }
}

const rows = F.cases.map((c) => [c.name, c] as const)

describe("the editor's Trim, Loop and Combine Videos quotes equal the server's workflow estimate, read from the measured walk", () => {
  it("covers each step and the cases the measured charge was written for", () => {
    expect(new Set(F.cases.map((c) => c.step))).toEqual(new Set(["trim", "loop", "combine"]))
    expect(F.cases.length).toBeGreaterThanOrEqual(30)
    expect(F.cases.some((c) => c.partial)).toBe(true)
  })

  it.each(rows)("%s — a whole run", (_name, c) => {
    const { node, nodes, edges } = graph(c)
    const whole = new Set(wholeRunExecutable(nodes).map((n) => n.id))
    expect(whole.has("t")).toBe(true)
    expect(videoUtilityPricingUnits(node, nodes, edges, whole)).toBe(c.expectedUnits.whole)
  })

  it.each(rows)("%s — the step alone: its Run and its pill", (_name, c) => {
    const { node, nodes, edges } = graph(c)
    expect(videoUtilityPricingUnits(node, nodes, edges, new Set(["t"]))).toBe(c.expectedUnits.alone)
    expect(videoUtilityPricingUnits(node, nodes, edges)).toBe(c.expectedUnits.alone)
  })

  it.each(rows.filter(([, c]) => c.partial))("%s — a partial run", (_name, c) => {
    const { node, nodes, edges } = graph(c)
    expect(videoUtilityPricingUnits(node, nodes, edges, new Set(c.partial!.runSet))).toBe(c.partial!.expectedUnits)
  })
})
