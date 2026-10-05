/**
 * Apply EDL's render rule in the EDITOR — one third of the parity check for the
 * Apply EDL panel badge (A2b).
 *
 * Decided 2026-10-04: whatever is anchored at a render judges with the render's
 * own rule, with the node's `output`, `crossfadeMs` and wired sources. The panel
 * badge picks the EDL the node would render now (`resolveApplyEdlRenderEdl`),
 * the Sources wires' media (`resolveApplyEdlRenderSources`) and the node's
 * settings (`applyEdlRenderContext`), and judges them with `edlValidityOf` in
 * render mode. This file runs exactly that on every canvas of
 * backend/src/services/workflow-engine/__tests__/fixtures/apply-edl-render-rule.json
 * and requires the server's verdicts: the same issues, render by render, and
 * "ready" exactly where the server renders. It also runs the editor's own Run
 * on each canvas (the fan-out planned as a Run does, then `resolveNodeInputs`
 * per render) and requires the renders, EDLs and sources the fixture lists, and
 * that the badge picked those same EDLs. The server halves run the same
 * canvases through a workflow run (services/workflow-engine/__tests__/
 * apply-edl-render-rule-parity.test.ts) and through POST /v1/apply-edl
 * (routes/__tests__/apply-edl-render-rule-parity.test.ts).
 */
import { describe, it, expect } from "vitest"
import { planFanOut, withWiredSettings } from "@nodaro/shared"
import fixture from "../../../../backend/src/services/workflow-engine/__tests__/fixtures/apply-edl-render-rule.json"
import {
  applyEdlRenderContext,
  resolveApplyEdlRenderEdl,
  resolveApplyEdlRenderSources,
} from "../apply-edl-render-input"
import { edlValidityOf } from "../edl-validity"
import type { GraphEdge, GraphNode } from "../edit-plan-estimate"
import { getListFanOutForNode, resolveNodeInputs } from "@/components/editor/workflow-editor/node-input-resolver"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

interface Case {
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
  readonly sources: readonly string[]
  readonly renders: ReadonlyArray<{ readonly clip?: number; readonly edl: unknown; readonly issues: readonly string[] }>
  readonly badgeIssues?: readonly string[]
}

const CASES = (fixture as unknown as { readonly cases: Record<string, Case> }).cases

/** What the badge lists for the server's verdicts: a clip list's issues named
 *  by clip, as `validateEdlClipSet` names them. */
function expectedBadgeIssues(c: Case): readonly string[] {
  if (c.badgeIssues) return c.badgeIssues
  const clipList = c.renders.some((r) => r.clip !== undefined)
  return clipList
    ? c.renders.flatMap((r) => r.issues.map((issue) => `clip[${r.clip}]: ${issue}`))
    : c.renders[0]!.issues
}

const parsed = (v: unknown): unknown => (typeof v === "string" ? JSON.parse(v) : v)

/** The renders the editor's own Run of `render` makes (run-handlers.ts: the
 *  fan-out planned on the node as it runs, then `executeNode` resolving each
 *  render's inputs on its ROW), with the inputs each one reads. */
function editorRenders(c: Case) {
  const nodes = c.nodes.map((n) => ({ ...n, data: { ...(n.data as Record<string, unknown>) } })) as unknown as WorkflowNode[]
  const edges = c.edges.map((e, i) => ({ ...e, id: `e${i}` })) as unknown as WorkflowEdge[]
  const render = nodes.find((n) => n.id === "render")!
  const plan = planFanOut(
    getListFanOutForNode(render, nodes, edges),
    render.type ?? "",
    withWiredSettings(render, nodes, edges).data as Record<string, unknown>,
  )
  const rows = plan ? plan.rows : [undefined]
  return { render, renders: rows.map((row) => ({ row, inputs: resolveNodeInputs(render, nodes, edges, row) })) }
}

describe("the editor's own Run reads what the fixture lists (A2b parity)", () => {
  for (const [name, c] of Object.entries(CASES)) {
    it(name, () => {
      const { render, renders } = editorRenders(c)
      expect(renders.map((r) => r.row)).toEqual(c.renders.map((r) => r.clip))
      renders.forEach(({ inputs }, i) => {
        const where = `${name}, render ${i}`
        expect(parsed(inputs.edl ?? (render.data as Record<string, unknown>).edl), where).toEqual(c.renders[i]!.edl)
        expect(inputs.sources ?? [], where).toEqual(c.sources)
      })
    })
  }
})

describe("the Apply EDL panel badge reaches the server's verdicts (A2b parity)", () => {
  for (const [name, c] of Object.entries(CASES)) {
    it(name, () => {
      const node = c.nodes.find((n) => n.id === "render")!
      const edl = resolveApplyEdlRenderEdl(node, c.nodes, c.edges)
      const sources = resolveApplyEdlRenderSources(node, c.nodes, c.edges)
      // The Sources wires' media, in the slots both engines put them in.
      expect(sources).toEqual(c.sources)
      // The EDLs it judges are the ones the run renders: a clip list's item per
      // render (blank items keep their slot), else the one value.
      if (c.renders.some((r) => r.clip !== undefined)) {
        const held = edl.value as readonly unknown[]
        expect(Array.isArray(held)).toBe(true)
        expect(held.filter((item) => item !== undefined && item !== null && item !== "").length).toBe(c.renders.length)
        for (const r of c.renders) expect(parsed(held[r.clip!]), `clip ${r.clip}`).toEqual(r.edl)
      } else {
        expect(parsed(edl.value)).toEqual(c.renders[0]!.edl)
      }

      const verdict = edlValidityOf(edl.value, {
        render: applyEdlRenderContext(node.data as Record<string, unknown>, { source: edl.source, sources }),
      })
      expect(verdict).not.toBeNull()
      expect(verdict!.issues).toEqual(expectedBadgeIssues(c))
      // "Ready to render" exactly where every render the run makes renders.
      expect(verdict!.ok).toBe(c.renders.every((r) => r.issues.length === 0))
      expect(verdict!.kind).toBe(c.renders.some((r) => r.clip !== undefined) ? "clips" : "edl")
    })
  }
})
