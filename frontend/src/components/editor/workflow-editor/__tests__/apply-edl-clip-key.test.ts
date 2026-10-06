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
import { EDITED_EDL_VERSION, editPlanBasis, edlSpanKey, planFanOut, renderPlanClipKey, renderPlanPath } from "@nodaro/shared"

let storeNodes: unknown[] = []
let storeEdges: unknown[] = []

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({ characterDefinitions: [], nodes: storeNodes, edges: storeEdges }),
  },
}))

import { extractNodeOutputAsList, getListFanOutForNode, resolveNodeInputs } from "../node-input-resolver"
import { browserRenderRowSentStamps } from "../apply-edl-stamps"
import { fanOutRowStamps } from "../fan-out-row-stamps"
import { buildClipCards } from "@/lib/edl-review/build-clip-cards"
import fixture from "../../../../../../backend/src/services/workflow-engine/__tests__/fixtures/apply-edl-clip-key.json"

/* eslint-disable @typescript-eslint/no-explicit-any */
const asNode = (n: { id: string; type: string; data: Record<string, unknown> }): any => ({ ...n, position: { x: 0, y: 0 } })

/** The plan as a case's review leaves it: its `dropped` clips (the TA16 holes) applied as the plan's editedEdl. */
type FixtureCase = (typeof fixture.cases)[number] | typeof fixture.staleSwitchBatch

function planOf(c: FixtureCase) {
  const dropped = (c as { dropped?: number[] }).dropped
  if (!dropped) return fixture.plan
  const clips = fixture.plan.data.generatedJson as unknown[]
  const editedEdl = { v: EDITED_EDL_VERSION, kind: "clips", basis: editPlanBasis(clips), clips: clips.map((_, i) => ({ keep: !dropped.includes(i) })) }
  return { ...fixture.plan, data: { ...fixture.plan.data, editedEdl } }
}

function run(c: FixtureCase) {
  const render = asNode(fixture.render)
  const nodes = [asNode(planOf(c)), ...c.nodes.map(asNode), render]
  const edges = c.edges as any[]
  storeNodes = nodes
  storeEdges = edges
  const fanOut = getListFanOutForNode(render, nodes, edges)
  const plan = planFanOut(fanOut, render.type, render.data)
  const keyAt = (row: number | undefined) =>
    renderPlanClipKey(render.id, nodes, edges, (planNode) => extractNodeOutputAsList(planNode as any, "edl"), row)
  // No fan-out (a wire that hands on one value): the render runs once, on no row.
  if (!plan) return { rows: null, rowSent: null, rowKeys: null, iterations: [{ clipKey: keyAt(undefined), edl: resolveNodeInputs(render, nodes, edges).edl }] }
  // What the list execution stamps on every row of the batch, before any iteration runs.
  const rowSent = browserRenderRowSentStamps(render, nodes, edges, plan.rows)!
  return {
    rows: plan.rows as number[],
    rowSent,
    rowKeys: rowSent.map((stamp) => stamp.clipKey),
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

// The engine-parity half the server test of the same fixture mirrors: every
// row of the batch names its clip, a FAILED row included (decided 2026-10-06).
describe("every row of the batch names its clip (editor)", () => {
  const behindSwitch = (c: FixtureCase) => c.nodes.some((n) => n.type === "camera-switch")

  it("the row keys are the keys each iteration stamps, on every fan-out case wired to the plan", () => {
    for (const c of fixture.cases.filter((x) => x.expectedRows !== null && !behindSwitch(x))) {
      const { rowSent, rowKeys, iterations } = run(c)
      expect(rowKeys, c.name).toEqual(c.expected)
      expect(rowKeys, c.name).toEqual(iterations.map((i) => i.clipKey))
      expect(rowSent!.map((stamp) => stamp.quality), c.name).toEqual(c.expected.map(() => "proxy"))
    }
  })

  // The browser runs the render alone (every run of several nodes is the
  // server's), so a Camera Switch never ran with it: the render iterates the
  // switch's SAVED batch, and the same-run rule keys no row.
  it("behind Camera Switch no row is keyed, the run's quality still stamped", () => {
    for (const c of [...fixture.cases.filter((x) => x.expectedRows !== null && behindSwitch(x)), fixture.staleSwitchBatch]) {
      const { rows, rowSent } = run(c)
      expect(rows, c.name).toEqual(c.expectedRows)
      expect(rowSent, c.name).toEqual(rows!.map(() => ({ quality: "proxy" })))
    }
  })

  it("a switch batch saved under an older review, one row failed: no card but its own clip's reads Preview failed", () => {
    const c = fixture.staleSwitchBatch
    const { rowSent, iterations } = run(c)
    const results = iterations.map((_, k) => (k === c.failedIteration ? "" : `https://cdn.test/render-${k}.mp4`))
    // Each landed take as the poll lane wrote it, with the key its iteration stamped.
    const landed = new Map(
      iterations.flatMap(({ clipKey }, k) =>
        k === c.failedIteration ? [] : [[results[k]!, { url: results[k]!, quality: "proxy", clipKey }] as const],
      ),
    )
    const stamps = fanOutRowStamps("apply-edl", results, landed, rowSent!)
    expect(stamps[c.failedIteration]).toEqual(c.expectedFailedStamp)
    const plan = planOf(c)
    const nodes = [plan, ...c.nodes, fixture.render]
    const cards = buildClipCards({
      plan: plan.data.generatedJson,
      editedEdl: (plan.data as { editedEdl?: unknown }).editedEdl,
      renderData: { ...fixture.render.data, __listResults: results, __listResultStamps: stamps, generatedResults: [...landed.values()] },
      hops: renderPlanPath("render", nodes, c.edges)!.hops,
    })!
    const trueClip = edlSpanKey((fixture.plan.data.generatedJson as unknown[])[1])
    for (const card of cards.cards) {
      if (card.clipKey !== trueClip) expect(card.state, card.clipKey).not.toBe("preview-failed")
    }
  })

  it("a row the batch never ran is marked cancelled, its clip kept; a failed one is not", () => {
    const c = fixture.cases.find((x) => (x as { expectedStamps?: unknown }).expectedStamps)!
    const { rowSent } = run(c)
    const stamps = fanOutRowStamps("apply-edl", ["", "", ""], new Map(), rowSent!, new Set([2]))
    expect(stamps).toEqual([
      { quality: "proxy", clipKey: "0-1000" },
      { quality: "proxy", clipKey: "4000-5000" },
      { quality: "proxy", clipKey: "6000-7000", cancelled: true },
    ])
    // Not a render: nothing was sent for, so a stopped row is `{}` as before.
    expect(fanOutRowStamps("generate-image", [""], new Map(), undefined, new Set([0]))).toEqual([{}])
  })

  it("a failed iteration's row still names its clip: the same stamps the server assembles", () => {
    const cases = fixture.cases.filter((x) => (x as { expectedStamps?: unknown }).expectedStamps)
    expect(cases.length).toBeGreaterThan(0)
    for (const c of cases) {
      const { failedIteration, expectedStamps } = c as unknown as { failedIteration: number; expectedStamps: unknown[] }
      const { rowSent, iterations } = run(c)
      const results = iterations.map((_, k) => (k === failedIteration ? "" : `https://cdn.test/render-${k}.mp4`))
      // Each landed take as the poll lane wrote it: its URL and its render's stamps.
      const landed = new Map(
        iterations.flatMap(({ clipKey }, k) =>
          k === failedIteration ? [] : [[results[k]!, { url: results[k]!, quality: "proxy", clipKey }] as const],
        ),
      )
      expect(fanOutRowStamps("apply-edl", results, landed, rowSent!), c.name).toEqual(expectedStamps)
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

  it("both fan-outs key every batch row up front, on the list rows, and the batch assembly stamps them", () => {
    const orchestrator = read("../../../../../../backend/src/workers/orchestrator-worker.ts")
    expect(orchestrator).toMatch(/applyEdlRowSentStamps\(node, allNodes, edges, nodeStates, plan\.rows\)/)
    expect(orchestrator).toMatch(/assembleFanOutResult\(settled, items\.length, node\.type, rowSent\)/)
    const list = read("../list-execution.ts")
    expect(list).toMatch(/browserRenderRowSentStamps\([^)]*fanOut\.rows\)/)
    expect(list).toMatch(/fanOutRowStamps\(node\.type, results, landed, rowSent, cancelledRows\)/)
  })
})
