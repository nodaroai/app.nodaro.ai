/**
 * An Apply EDL render's plan basis in the BROWSER engine (A3-1) — the editor
 * half of the cross-engine guard; the backend's apply-edl-clip-key and
 * apply-edl-plan-basis tests run the server on the same fixture and rule.
 *
 * The browser runs one node at a time (a node's ▶, its fan-out, auto-execute);
 * every multi-node run is the server's. So a browser render's run holds the
 * render alone: wired straight to the plan it is stamped with the plan value it
 * read, and behind Camera Switch it is never stamped — the switch did not run
 * with it, and its saved EDL can come from an older plan (the same-run rule).
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect, vi } from "vitest"
import { EDITED_EDL_VERSION, editPlanBasis, edlSpanKey, planFanOut, renderReadBasis } from "@nodaro/shared"

let storeNodes: unknown[] = []
let storeEdges: unknown[] = []

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({ characterDefinitions: [], nodes: storeNodes, edges: storeEdges }),
  },
}))

import { getListFanOutForNode } from "../node-input-resolver"
import { browserRenderPlanBasis, currentRenderPlanBasis } from "../apply-edl-stamps"
import fixture from "../../../../../../backend/src/services/workflow-engine/__tests__/fixtures/apply-edl-clip-key.json"

/* eslint-disable @typescript-eslint/no-explicit-any */
const asNode = (n: { id: string; type: string; data: Record<string, unknown> }): any => ({ ...n, position: { x: 0, y: 0 } })
const planClipOf = (key: string | undefined) => (fixture.plan.data.generatedJson as unknown[]).find((clip) => edlSpanKey(clip) === key)

/** The plan as a case's review leaves it: its `dropped` clips (the TA16 holes) applied as the plan's editedEdl. */
function planOf(c: (typeof fixture.cases)[number]) {
  const dropped = (c as { dropped?: number[] }).dropped
  if (!dropped) return fixture.plan
  const clips = fixture.plan.data.generatedJson as unknown[]
  const editedEdl = { v: EDITED_EDL_VERSION, kind: "clips", basis: editPlanBasis(clips), clips: clips.map((_, i) => ({ keep: !dropped.includes(i) })) }
  return { ...fixture.plan, data: { ...fixture.plan.data, editedEdl } }
}

function bases(c: (typeof fixture.cases)[number]) {
  const render = asNode(fixture.render)
  const nodes = [asNode(planOf(c)), ...c.nodes.map(asNode), render]
  const edges = c.edges as any[]
  storeNodes = nodes
  storeEdges = edges
  const plan = planFanOut(getListFanOutForNode(render, nodes, edges), render.type, render.data)
  const rows: Array<number | undefined> = plan ? plan.rows : [undefined]
  return rows.map((row, k) => ({ key: plan ? c.expected[k] : c.expected[0], planBasis: browserRenderPlanBasis(render.id, nodes, edges, row) }))
}

describe("the plan basis of a render the browser runs", () => {
  for (const c of fixture.cases) {
    const behindSwitch = c.nodes.some((n) => n.type === "camera-switch")
    it(`${c.name}: ${behindSwitch ? "none behind Camera Switch" : "the clip its key names"}`, () => {
      for (const { key, planBasis } of bases(c)) {
        if (behindSwitch) expect(planBasis).toBeUndefined()
        else expect(planBasis).toBe(renderReadBasis(planClipOf(key)))
      }
    })
  }

  it("a Tighten plan with the person's review: the plan as the review leaves it", () => {
    const tighten = {
      version: 1,
      clock: "master",
      sources: [{ id: "A", url: "https://media.test/a.mp4", kind: "video" }],
      segments: [{ id: "s0", inMs: 0, outMs: 1000, video: "A" }, { id: "s1", inMs: 2000, outMs: 3000, video: "A" }],
      meta: { title: "Episode" },
    }
    const edited = { v: 1, kind: "edl", basis: editPlanBasis(tighten), edl: { segments: [tighten.segments[1]], dropped: [] } }
    const plan = asNode({ id: "plan", type: "edit-plan", data: { mode: "tighten", generatedJson: tighten, editedEdl: edited } })
    const render = asNode({ id: "render", type: "apply-edl", data: {} })
    const nodes = [plan, render]
    const edges = [{ id: "e", source: "plan", sourceHandle: "edl", target: "render", targetHandle: "edl" }] as any[]
    storeNodes = nodes
    storeEdges = edges
    expect(browserRenderPlanBasis("render", nodes, edges, undefined)).toBe(
      renderReadBasis({ ...tighten, segments: [tighten.segments[1]], dropped: [] }),
    )
  })
})

describe("the plan basis a render would stamp now (A3-2: the review's freshness check)", () => {
  // The inspector asks what a run of the render WITH its pass-through nodes
  // (Render final, Update preview) would cut: the plan's current value, also
  // behind Camera Switch. A take whose planBasis equals it is fresh.
  for (const c of fixture.cases) {
    it(`${c.name}: the clip its key names`, () => {
      const render = asNode(fixture.render)
      const nodes = [asNode(planOf(c)), ...c.nodes.map(asNode), render]
      const edges = c.edges as any[]
      storeNodes = nodes
      storeEdges = edges
      const plan = planFanOut(getListFanOutForNode(render, nodes, edges), render.type, render.data)
      const rows: Array<number | undefined> = plan ? plan.rows : [undefined]
      rows.forEach((row, k) => {
        expect(currentRenderPlanBasis(render.id, nodes, edges, row)).toBe(renderReadBasis(planClipOf(plan ? c.expected[k] : c.expected[0])))
      })
    })
  }
})

describe("execute-node stamps through the helper, on the list row only", () => {
  it("passes the list row and sends the basis beside the clip key", () => {
    const src = readFileSync(join(__dirname, "../execute-node.ts"), "utf8")
    const block = src.slice(src.indexOf("const clipKey = renderPlanClipKey("), src.indexOf("if (node.type === \"edit-plan\") {"))
    expect(block).toMatch(/browserRenderPlanBasis\(\s*node\.id,\s*graphNodes,\s*graphEdges,\s*listRowIndex,?\s*\)/)
    expect(block).toContain("...(planBasis ? { planBasis } : {})")
  })
})
