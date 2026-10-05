/**
 * An Apply EDL render's clipKey in the BROWSER engine — the editor half of the
 * cross-engine guard (A1b review round); the backend test of the same name runs
 * the server on the same fixture.
 *
 * The rows come from the canvas fan-out, and the key from the ONE shared rule
 * execute-node calls (`renderPlanClipKey`) on the plan's clips as the canvas
 * reads them. A selector on an `each` wire makes the rows rows of the SELECTED
 * clips: the key is never row k of the full plan.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect, vi } from "vitest"
import { edlSpanKey, planFanOut, renderPlanClipKey } from "@nodaro/shared"

let storeNodes: unknown[] = []
let storeEdges: unknown[] = []

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({ characterDefinitions: [], nodes: storeNodes, edges: storeEdges }),
  },
}))

import { extractNodeOutputAsList, getListFanOutForNode, resolveNodeInputs } from "../node-input-resolver"
import fixture from "../../../../../../backend/src/services/workflow-engine/__tests__/fixtures/apply-edl-clip-key.json"

/* eslint-disable @typescript-eslint/no-explicit-any */
const asNode = (n: { id: string; type: string; data: Record<string, unknown> }): any => ({ ...n, position: { x: 0, y: 0 } })

function run(c: (typeof fixture.cases)[number]) {
  const render = asNode(fixture.render)
  const nodes = [asNode(fixture.plan), ...c.nodes.map(asNode), render]
  const edges = c.edges as any[]
  storeNodes = nodes
  storeEdges = edges
  const fanOut = getListFanOutForNode(render, nodes, edges)
  const plan = planFanOut(fanOut, render.type, render.data)
  const keyAt = (row: number | undefined) =>
    renderPlanClipKey(render.id, nodes, edges, (planNode) => extractNodeOutputAsList(planNode as any, "edl"), row)
  // No fan-out (a wire that hands on one value): the render runs once, on no row.
  if (!plan) return { rows: null, iterations: [{ clipKey: keyAt(undefined), edl: resolveNodeInputs(render, nodes, edges).edl }] }
  return {
    rows: plan.rows as number[],
    iterations: plan.items.map((_, k) => {
      const row = plan.rows[k]
      return { clipKey: keyAt(row), edl: resolveNodeInputs(render, nodes, edges, row).edl }
    }),
  }
}

describe("the clipKey of a render whose clips a selector picks (editor)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const { rows, iterations } = run(c)
      expect(rows).toEqual(c.expectedRows)
      expect(iterations.map((i) => i.clipKey)).toEqual(c.expected)
    })
  }

  it("on a direct wire the key is the span of the very clip the render receives", () => {
    for (const c of fixture.cases.filter((x) => x.direct)) {
      for (const { clipKey, edl } of run(c).iterations) {
        expect(clipKey, c.name).toBe(edlSpanKey(JSON.parse(edl as string)))
      }
    }
  })
})

describe("both engines stamp through the one rule, on the list row only", () => {
  const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8")

  it("execute-node calls renderPlanClipKey with the list row, never the iteration number", () => {
    const src = read("../execute-node.ts")
    const call = src.slice(src.indexOf("const clipKey = renderPlanClipKey("), src.indexOf("setUserPromptTemplate(undefined);\n    return runApplyEdl("))
    expect(call).toContain("listRowIndex,")
    expect(call).not.toContain("listIterationIndex")
  })

  it("the server's payload builder calls the same rule, and the orchestrator hands it the list row only", () => {
    const builder = read("../../../../../../backend/src/services/workflow-engine/payload-builder.ts")
    expect(builder).toMatch(/return renderPlanClipKey\(/)
    const orchestrator = read("../../../../../../backend/src/workers/orchestrator-worker.ts")
    expect(orchestrator).toMatch(/\n\s+i,\n(\s+\/\/[^\n]*\n)*\s+plan\.rows\[i\],\n\s+\)/)
    expect(orchestrator).not.toMatch(/plan\.rows\[i\] \?\? i,\n\s+\)/)
  })
})
