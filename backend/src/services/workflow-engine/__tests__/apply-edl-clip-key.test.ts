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
import { EDITED_EDL_VERSION, editPlanBasis, edlSpanKey, planFanOut, renderReadBasis } from "@nodaro/shared"
import { buildPayload } from "../payload-builder.js"
import { getListFanOutForNode, resolveNodeInputs } from "../input-resolver.js"
import { extractSavedNodeOutput } from "../output-extractor.js"
import { seededFromSavedData } from "../saved-data.js"
import { resolveFanOutIterationInputs } from "../../../workers/fan-out-inputs.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"

const HERE = dirname(fileURLToPath(import.meta.url))
/** `expectedRows: null` — the render does not fan out (a wire that hands on one value): it runs once, on no row. */
/** `dropped`: the plan clips the person dropped in review (the TA16 holes). */
interface Case { name: string; nodes: SimpleNode[]; edges: SimpleEdge[]; expectedRows: number[] | null; expected: string[]; direct: boolean; dropped?: number[] }
const FIXTURE = JSON.parse(readFileSync(join(HERE, "fixtures", "apply-edl-clip-key.json"), "utf8")) as {
  plan: SimpleNode
  render: SimpleNode
  cases: Case[]
}

/** The plan as the case's review leaves it: `dropped` applied as its editedEdl. */
function planOf(c: Case): SimpleNode {
  if (!c.dropped) return FIXTURE.plan
  const clips = FIXTURE.plan.data.generatedJson as unknown[]
  const editedEdl = {
    v: EDITED_EDL_VERSION,
    kind: "clips",
    basis: editPlanBasis(clips),
    clips: clips.map((_, i) => ({ keep: !c.dropped!.includes(i) })),
  }
  return { ...FIXTURE.plan, data: { ...FIXTURE.plan.data, editedEdl } }
}

/** `ran`: the nodes this run executed before the render (their states are the
 *  run's own); every other node is seeded from its saved data. */
function run(render: SimpleNode, c: Case, ran: ReadonlySet<string> = new Set()) {
  const nodes = [planOf(c), ...c.nodes, render]
  const nodeStates: Record<string, NodeExecutionState> = {}
  for (const n of [planOf(c), ...c.nodes]) {
    const output = extractSavedNodeOutput(n)
    // A switch that ran holds its batch as this run's list, as the orchestrator leaves it.
    const batch = (n.data as { __listResults?: string[] }).__listResults
    nodeStates[n.id] = ran.has(n.id)
      ? { status: "completed", output: { ...output, ...(batch ? { listResults: batch } : {}) } }
      : seededFromSavedData(output)
  }
  const fanOut = getListFanOutForNode(render, c.edges, nodeStates, nodes)
  const plan = planFanOut(fanOut, render.type, render.data as Record<string, unknown>)
  if (!plan) {
    const inputs = resolveNodeInputs(render, c.edges, nodeStates, nodes)
    const { payload } = buildPayload(render, "job-once", inputs, "ul", { nodes, edges: c.edges, nodeStates, listRow: undefined })
    return { rows: null, iterations: [{ clipKey: payload.clipKey as string | undefined, planBasis: payload.planBasis as string | undefined, edl: inputs.edl }] }
  }
  const iterations = plan.items.map((_, k) => {
    const inputs = resolveFanOutIterationInputs(render, plan, k, c.edges, nodeStates, nodes)
    const { payload } = buildPayload(render, `job-${k}`, inputs, "ul", {
      nodes, edges: c.edges, nodeStates, listRow: plan.rows[k],
    })
    return { clipKey: payload.clipKey as string | undefined, planBasis: payload.planBasis as string | undefined, edl: inputs.edl }
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

  // A3-1: the plan basis names the same clip the key does — the plan's clip,
  // its hook aside — and only when nothing between them served an older value.
  const planClipOf = (key: string | undefined) =>
    (FIXTURE.plan.data.generatedJson as unknown[]).find((clip) => edlSpanKey(clip) === key)

  it("a render wired to the plan stamps the basis of the clip its key names; behind a SAVED Camera Switch, none", () => {
    for (const c of FIXTURE.cases) {
      const behindSwitch = c.nodes.some((n) => n.type === "camera-switch")
      for (const { clipKey, planBasis } of run(FIXTURE.render, c).iterations) {
        if (behindSwitch) expect(planBasis, c.name).toBeUndefined()
        else expect(planBasis, c.name).toBe(renderReadBasis(planClipOf(clipKey)))
      }
    }
  })

  it("behind a Camera Switch that ran in the render's run, the basis of the clip its key names", () => {
    for (const c of FIXTURE.cases.filter((x) => x.nodes.some((n) => n.type === "camera-switch"))) {
      for (const { clipKey, planBasis } of run(FIXTURE.render, c, new Set(["switch"])).iterations) {
        expect(planBasis, c.name).toBe(renderReadBasis(planClipOf(clipKey)))
        expect(planBasis, c.name).toMatch(/^[0-9a-f]{16}$/)
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
