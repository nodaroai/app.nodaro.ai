// @test-watches packages/shared/src/__tests__/fixtures/planned-length-quote-parity.json
/**
 * When what reaches a Mask Composite or a Video Overlay is made by another node
 * — a generation, an Extend Video, a step that re-runs — the editor quotes the
 * step at the units the server's workflow estimate quotes: both read the one
 * measured walk (`measuredWireLengthSec`, @nodaro/render-rules). A node that
 * runs is read at its planned length (plus the step's slack once on each clip
 * a node makes on the way), a node that does not run at the take it hands on, a frozen
 * node never as running, and anything unknown at the cap. For a whole run the
 * editor passes its own whole-run set (`wholeRunExecutable`, which keeps frozen
 * nodes); for the step alone, its own Run (`{c}`) and its pill (no run set)
 * quote the same. The server half is
 * backend/src/ee/billing/__tests__/planned-length-quote-parity.test.ts, over
 * the same fixture.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { maskCompositePricingUnits, videoOverlayPricingUnits, videoOverlayQuotesVideoOf } from "@/lib/video-utility-estimate"
import { wholeRunExecutable } from "@/components/editor/workflow-editor/estimate-run-credits"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

type Step = "maskComposite" | "videoOverlay"
type Units = Readonly<Record<Step, number>>

interface ParityCase {
  readonly name: string
  readonly nodes: ReadonlyArray<{ id: string; type: string; data: Record<string, unknown> }>
  readonly edges: ReadonlyArray<{ source: string; target?: string; targetHandle: string }>
  readonly expectedUnits: { readonly whole: Units; readonly alone: Units }
  /** A partial run: exactly these nodes run (the editor's run set for Run selected / Run up to here). */
  readonly partial?: { readonly runSet: readonly string[]; readonly expectedUnits: Units }
}

const F = JSON.parse(
  readFileSync(join(__dirname, "../../../../packages/shared/src/__tests__/fixtures/planned-length-quote-parity.json"), "utf8"),
) as { cases: ParityCase[] }

/** The step `c` each case wires into: a default Mask Composite, or a Video Overlay with one stored video layer. */
const STEP_DATA: Readonly<Record<Step, Record<string, unknown>>> = {
  maskComposite: {},
  videoOverlay: { layers: [{ videoUrl: "https://cdn.example/layer.mp4", start: 0 }] },
}
const STEP_TYPE: Readonly<Record<Step, string>> = { maskComposite: "mask-composite", videoOverlay: "video-overlay" }

function graph(c: ParityCase, step: Step): { node: WorkflowNode; nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const node = { id: "c", type: STEP_TYPE[step], position: { x: 0, y: 0 }, data: { label: "c", ...STEP_DATA[step] } } as unknown as WorkflowNode
  const nodes = [...c.nodes.map((n) => ({ ...n, position: { x: 0, y: 0 }, data: { label: n.id, ...n.data } })), node] as unknown as WorkflowNode[]
  const edges = c.edges.map((e, i) => ({ id: `e${i}`, source: e.source, target: e.target ?? "c", targetHandle: e.targetHandle })) as WorkflowEdge[]
  return { node, nodes, edges }
}

const unitsOf = (step: Step, node: WorkflowNode, nodes: WorkflowNode[], edges: WorkflowEdge[], rerunIds?: ReadonlySet<string>): number =>
  step === "maskComposite" ? maskCompositePricingUnits(node, nodes, edges, rerunIds) : videoOverlayPricingUnits(node, nodes, edges, rerunIds)

const rows = F.cases.flatMap((c) => (["maskComposite", "videoOverlay"] as const).map((step) => [`${c.name} — ${step}`, c, step] as const))

describe("the editor's Mask Composite and Video Overlay quotes equal the server's workflow estimate on a video another node makes", () => {
  it("covers the cases the shared rule was written for", () => {
    expect(F.cases.length).toBeGreaterThanOrEqual(33)
    expect(F.cases.some((c) => c.partial)).toBe(true)
  })

  it.each(rows)("%s — a whole run", (_name, c, step) => {
    const { node, nodes, edges } = graph(c, step)
    if (step === "videoOverlay") expect(videoOverlayQuotesVideoOf(node, nodes, edges)).toBe(true)
    const whole = new Set(wholeRunExecutable(nodes).map((n) => n.id))
    expect(whole.has("c")).toBe(true)
    expect(unitsOf(step, node, nodes, edges, whole)).toBe(c.expectedUnits.whole[step])
  })

  it.each(rows)("%s — the step alone: its Run and its pill", (_name, c, step) => {
    const { node, nodes, edges } = graph(c, step)
    expect(unitsOf(step, node, nodes, edges, new Set(["c"]))).toBe(c.expectedUnits.alone[step])
    expect(unitsOf(step, node, nodes, edges)).toBe(c.expectedUnits.alone[step])
  })

  it.each(rows.filter(([, c]) => c.partial))("%s — a partial run", (_name, c, step) => {
    const { node, nodes, edges } = graph(c, step)
    expect(unitsOf(step, node, nodes, edges, new Set(c.partial!.runSet))).toBe(c.partial!.expectedUnits[step])
  })
})
