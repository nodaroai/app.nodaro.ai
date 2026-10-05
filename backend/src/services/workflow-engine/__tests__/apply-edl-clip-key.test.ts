/**
 * An Apply EDL render's clipKey on the SERVER, derived the way the orchestrator
 * runs it (A1b review round) — the half of the cross-engine guard that runs
 * here; the editor test of the same name reads the same fixture.
 *
 * The rows come from the real fan-out (`getListFanOutForNode` + `planFanOut`),
 * and each row's payload is built from that row's real inputs. A selector on
 * an `each` wire makes the rows rows of the SELECTED clips, so the key is
 * picked by every selector from the plan down — never row k of the full plan
 * (which stamped 0-1000 on the render of 4000-5000).
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"
import { edlSpanKey, planFanOut } from "@nodaro/shared"
import { buildPayload } from "../payload-builder.js"
import { getListFanOutForNode, resolveNodeInputs } from "../input-resolver.js"
import { extractSavedNodeOutput } from "../output-extractor.js"
import { seededFromSavedData } from "../saved-data.js"
import { resolveFanOutIterationInputs } from "../../../workers/fan-out-inputs.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"

const HERE = dirname(fileURLToPath(import.meta.url))
/** `expectedRows: null` — the render does not fan out (a wire that hands on one value): it runs once, on no row. */
interface Case { name: string; nodes: SimpleNode[]; edges: SimpleEdge[]; expectedRows: number[] | null; expected: string[]; direct: boolean }
const FIXTURE = JSON.parse(readFileSync(join(HERE, "fixtures", "apply-edl-clip-key.json"), "utf8")) as {
  plan: SimpleNode
  render: SimpleNode
  cases: Case[]
}

function run(render: SimpleNode, c: Case) {
  const nodes = [FIXTURE.plan, ...c.nodes, render]
  const nodeStates: Record<string, NodeExecutionState> = {}
  for (const n of [FIXTURE.plan, ...c.nodes]) nodeStates[n.id] = seededFromSavedData(extractSavedNodeOutput(n))
  const fanOut = getListFanOutForNode(render, c.edges, nodeStates, nodes)
  const plan = planFanOut(fanOut, render.type, render.data as Record<string, unknown>)
  if (!plan) {
    const inputs = resolveNodeInputs(render, c.edges, nodeStates, nodes)
    const { payload } = buildPayload(render, "job-once", inputs, "ul", { nodes, edges: c.edges, nodeStates, listRow: undefined })
    return { rows: null, iterations: [{ clipKey: payload.clipKey as string | undefined, edl: inputs.edl }] }
  }
  const iterations = plan.items.map((_, k) => {
    const inputs = resolveFanOutIterationInputs(render, plan, k, c.edges, nodeStates, nodes)
    const { payload } = buildPayload(render, `job-${k}`, inputs, "ul", {
      nodes, edges: c.edges, nodeStates, listRow: plan.rows[k],
    })
    return { clipKey: payload.clipKey as string | undefined, edl: inputs.edl }
  })
  return { rows: plan.rows as number[], iterations }
}

describe("the clipKey of a render whose clips a selector picks (server)", () => {
  for (const c of FIXTURE.cases) {
    it(c.name, () => {
      const { rows, iterations } = run(FIXTURE.render, c)
      expect(rows).toEqual(c.expectedRows)
      expect(iterations.map((i) => i.clipKey)).toEqual(c.expected)
    })
  }

  it("on a direct wire the key is the span of the very clip the render receives", () => {
    for (const c of FIXTURE.cases.filter((x) => x.direct)) {
      for (const { clipKey, edl } of run(FIXTURE.render, c).iterations) {
        expect(clipKey, c.name).toBe(edlSpanKey(JSON.parse(edl as string)))
      }
    }
  })

  it("a row another list drives past a one-clip plan reads that clip, as its input does", () => {
    const clip = (FIXTURE.plan.data.generatedJson as unknown[])[2]
    const one: SimpleNode = { ...FIXTURE.plan, data: { mode: "clips", generatedJson: [clip] } }
    const edges: SimpleEdge[] = [{ id: "e", source: "plan", sourceHandle: "edl", target: "render", targetHandle: "edl" }]
    const nodes = [one, FIXTURE.render]
    const nodeStates = { plan: seededFromSavedData(extractSavedNodeOutput(one)) }
    const { payload } = buildPayload(FIXTURE.render, "job", { edl: JSON.stringify(clip) }, "ul", { nodes, edges, nodeStates, listRow: 2 })
    expect(payload.clipKey).toBe("4000-5000")
  })
})
