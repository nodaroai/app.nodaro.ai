/**
 * Apply EDL's render rule in the EDITOR — one third of the parity check for the
 * Apply EDL panel badge (A2b).
 *
 * Decided 2026-10-04: whatever is anchored at a render judges with the render's
 * own rule, with the node's `output`, `crossfadeMs` and wired sources. Decided
 * 2026-10-05: the panel badge judges every render the node's Run would make
 * (`resolveApplyEdlRenders`: the fan-out the browser engine plans, each render's
 * EDL and Sources as it resolves them), with the node's settings
 * (`applyEdlRenderSettings`), through `applyEdlRendersValidity`. This file runs
 * exactly that on every canvas of
 * backend/src/services/workflow-engine/__tests__/fixtures/apply-edl-render-rule.json
 * and requires the server's verdicts: the same issues, render by render, and
 * "ready" exactly where the server renders. It also runs the editor's own Run
 * on each canvas (the fan-out planned as a Run does, then `resolveNodeInputs`
 * per render) and requires the renders, EDLs and sources the fixture lists, and
 * that the badge judged those same renders. The server halves run the same
 * canvases through a workflow run (services/workflow-engine/__tests__/
 * apply-edl-render-rule-parity.test.ts) and through POST /v1/apply-edl
 * (routes/__tests__/apply-edl-render-rule-parity.test.ts).
 */
import { describe, it, expect } from "vitest"
import { planFanOut, withWiredSettings } from "@nodaro/shared"
import fixture from "../../../../backend/src/services/workflow-engine/__tests__/fixtures/apply-edl-render-rule.json"
import { applyEdlRenderSettings, resolveApplyEdlRenders } from "../apply-edl-render-input"
import { applyEdlRendersValidity } from "../edl-validity"
import type { GraphEdge, GraphNode } from "../edit-plan-estimate"
import { getListFanOutForNode, resolveNodeInputs } from "@/components/editor/workflow-editor/node-input-resolver"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

interface Case {
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
  readonly sources: readonly string[]
  readonly renders: ReadonlyArray<{
    readonly clip?: number
    readonly edl: unknown
    /** This render's own Sources media, when a list wired into Sources fans the render out. */
    readonly sources?: readonly string[]
    readonly issues: readonly string[]
    /** This render's issues as the badge words them, where it words the server's refusal differently. */
    readonly badgeIssues?: readonly string[]
  }>
  readonly badgeIssues?: readonly string[]
}

const CASES = (fixture as unknown as { readonly cases: Record<string, Case> }).cases

/** One render's issues as the badge words them. */
const badgeIssuesOf = (r: Case["renders"][number]): readonly string[] => r.badgeIssues ?? r.issues

/** What the badge lists for the server's verdicts: one render's issues as they
 *  are; several renders' issues each named by its render, numbered from 1 by
 *  the row it reads. */
function expectedBadgeIssues(c: Case): readonly string[] {
  if (c.badgeIssues) return c.badgeIssues
  return c.renders.length === 1
    ? badgeIssuesOf(c.renders[0]!)
    : c.renders.flatMap((r) => badgeIssuesOf(r).map((issue) => `render ${r.clip! + 1}: ${issue}`))
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
        expect(inputs.sources ?? [], where).toEqual(c.renders[i]!.sources ?? c.sources)
      })
    })
  }
})

describe("the Apply EDL panel badge reaches the server's verdicts (A2b parity)", () => {
  for (const [name, c] of Object.entries(CASES)) {
    it(name, () => {
      const node = c.nodes.find((n) => n.id === "render")!
      const renders = resolveApplyEdlRenders(node, c.nodes, c.edges)
      // The renders it judges are the ones the run makes: each one's row, the
      // EDL it reads, and the Sources media in the slots both engines put them in.
      expect(renders.map((r) => r.row)).toEqual(c.renders.map((r) => r.clip))
      renders.forEach((r, i) => {
        const where = `${name}, render ${i}`
        expect(parsed(r.edl), where).toEqual(c.renders[i]!.edl)
        expect(r.sources, where).toEqual(c.renders[i]!.sources ?? c.sources)
      })

      const verdict = applyEdlRendersValidity(renders, applyEdlRenderSettings(node.data as Record<string, unknown>))
      expect(verdict).not.toBeNull()
      expect(verdict!.issues).toEqual(expectedBadgeIssues(c))
      // "Ready to render" exactly where every render the run makes renders.
      expect(verdict!.ok).toBe(c.renders.every((r) => r.issues.length === 0))
      if (c.renders.length > 1) {
        expect(verdict!.kind).toBe("renders")
        expect(verdict!.renders).toEqual({
          total: c.renders.length,
          failing: c.renders.filter((r) => r.issues.length > 0).map((r) => ({ row: r.clip, issues: badgeIssuesOf(r) })),
        })
      } else {
        expect(verdict!.kind).toBe("edl")
      }
    })
  }
})
