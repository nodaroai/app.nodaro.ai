/**
 * An Edit Plan holding a person's review, read by the SERVER — the half of the
 * cross-engine check that runs here (A5.2; TA13, TA16, TA17).
 *
 * `fixtures/edit-plan-review.json` holds plan nodes with an `editedEdl` beside
 * the planner's output. A run that passes the plan through (Render final, a Run
 * from here at the render) must hand the render what the person kept: a clip
 * set on the PLAN's indices with "" at every dropped clip (so dropped clips
 * never run, and a scalar read is the first kept clip), and a Tighten plan's
 * edited cut. The clip cases also hold the planner's clips on a persisted
 * `__listResults`, which no read may take. The frontend test runs the canvas
 * readers on the same data.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"
import { extractSavedNodeOutput, getPrimaryOutput } from "../output-extractor.js"
import { getListFanOutForNode, resolveNodeInputs } from "../input-resolver.js"
import { listFor, seededFromSavedData } from "../saved-data.js"
import { executeExtractField, executeJsonProcess } from "../inline-executor.js"
import { resolveEditPlanOutput } from "@nodaro/shared"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"

const HERE = dirname(fileURLToPath(import.meta.url))

interface Case {
  status: string
  plan: SimpleNode
  expected: {
    scalar: string | null
    list: string[] | null
    fanOut: { items: string[]; rowIndices: number[] } | null
  }
}
const FIXTURE = JSON.parse(readFileSync(join(HERE, "fixtures", "edit-plan-review.json"), "utf8")) as {
  cases: Record<string, Case>
  consumers: {
    case: string
    extractField: { field: string; text: string }
    jsonProcess: { expression: string; processedResult: unknown }
  }
  picks: {
    case: string
    edges: Array<{ name: string; edge: Record<string, unknown>; edl: string | null; runs: number | null }>
  }
}

const render: SimpleNode = { id: "render-clip", type: "apply-edl", data: { label: "Render Clip", output: "video", quality: "proxy" } }

function wire(plan: SimpleNode, outputMode?: "each" | "last"): SimpleEdge[] {
  return [{
    id: "e-edl", source: plan.id, sourceHandle: "edl", target: render.id, targetHandle: "edl",
    ...(outputMode ? { data: { outputMode } } : {}),
  }]
}

/** The plan as a run that passes it through holds it: seeded from its saved data. */
const seeded = (plan: SimpleNode): Record<string, NodeExecutionState> => ({
  [plan.id]: seededFromSavedData(extractSavedNodeOutput(plan)),
})

describe.each(Object.entries(FIXTURE.cases))("a reviewed Edit Plan on the server: %s", (_name, c) => {
  it("the seed is the resolved plan", () => {
    const out = extractSavedNodeOutput(c.plan)
    expect(out?.listResults ?? null).toEqual(c.expected.list)
    expect(getPrimaryOutput(out ?? {}, "edit-plan", "edl") ?? null).toEqual(c.expected.scalar)
  })

  it("an each edge fans out over the kept clips only, on the plan's rows", () => {
    for (const states of [seeded(c.plan), {}]) {
      const fanOut = getListFanOutForNode(render, wire(c.plan), states, [c.plan, render])
      expect(fanOut ? { items: fanOut.items, rowIndices: fanOut.rowIndices } : null).toEqual(c.expected.fanOut)
    }
  })

  it("the list a pass-through plan holds is the resolved one, seeded or not", () => {
    expect(listFor(c.plan, seeded(c.plan)[c.plan.id]) ?? null).toEqual(c.expected.list)
    expect(listFor(c.plan, undefined) ?? null).toEqual(c.expected.list)
  })

  it("a scalar edge hands the render the first kept clip, or the edited cut", () => {
    const inputs = resolveNodeInputs(render, wire(c.plan, "last"), seeded(c.plan), [c.plan, render])
    expect(inputs.edl ?? null).toEqual(c.expected.scalar)
  })

  it("a fan-out iteration reads its own row's clip", () => {
    if (!c.expected.fanOut) return
    c.expected.fanOut.rowIndices.forEach((row, i) => {
      const inputs = resolveNodeInputs(render, wire(c.plan), seeded(c.plan), [c.plan, render], undefined, row)
      expect(inputs.edl).toBe(c.expected.fanOut!.items[i])
    })
  })
})

describe("the fixture says what was decided", () => {
  it("each case's status is what the resolver makes of its plan and edit", () => {
    for (const [name, c] of Object.entries(FIXTURE.cases)) {
      expect(resolveEditPlanOutput(c.plan.data.generatedJson, c.plan.data.editedEdl).status, name).toBe(c.status)
    }
  })

  it("one of four kept, none kept, both Tighten edits and a Trailer edit are applied; a stale edit is not", () => {
    const status = Object.fromEntries(Object.entries(FIXTURE.cases).map(([k, c]) => [k, c.status]))
    expect(status).toEqual({
      oneKept: "applied", twoKept: "applied", noneKept: "applied", stale: "stale",
      tighten: "applied", trailer: "applied", tightenMalformed: "applied",
    })
    expect(FIXTURE.cases.oneKept!.expected.fanOut).toBeNull()
    expect(FIXTURE.cases.noneKept!.expected.scalar).toBeNull()
    expect(JSON.parse(FIXTURE.cases.oneKept!.expected.scalar!).meta.hook).toBe("Half price, double trouble")
  })
})

describe("a JSON consumer of a reviewed clip set on the server (Extract Field, JSON Process)", () => {
  const plan = FIXTURE.cases[FIXTURE.consumers.case]!.plan
  const consumer = (type: string, data: Record<string, unknown>): { node: SimpleNode; edges: SimpleEdge[] } => {
    const node: SimpleNode = { id: "consumer", type, data: { label: type, ...data } }
    return { node, edges: [{ id: "e-in", source: plan.id, sourceHandle: "edl", target: node.id, targetHandle: "in" }] }
  }

  it("Extract Field reads the kept clips' hooks, the edited one included", () => {
    const { field, text } = FIXTURE.consumers.extractField
    const { node, edges } = consumer("extract-field", { field, outputType: "text" })
    expect(executeExtractField(node, edges, [plan, node], seeded(plan)).extractedText).toBe(text)
  })

  it("JSON Process reads the kept clips, the edited hook included", () => {
    const { expression, processedResult } = FIXTURE.consumers.jsonProcess
    const { node, edges } = consumer("json-process", { mode: "advanced", expression })
    expect(executeJsonProcess(node, edges, [plan, node], seeded(plan)).processedResult).toEqual(processedResult)
  })
})

describe.each(FIXTURE.picks.edges)("an edge that picks rows of a reviewed clip set, on the server: $name", (pick) => {
  const plan = FIXTURE.cases[FIXTURE.picks.case]!.plan
  const edges: SimpleEdge[] = [{ ...wire(plan)[0]!, data: pick.edge }]

  it("does not fan out", () => {
    for (const states of [seeded(plan), {}]) expect(getListFanOutForNode(render, edges, states, [plan, render]) ?? null).toBeNull()
  })

  it("hands the render the kept clip it selects, or nothing — never the plan's first kept clip", () => {
    for (const states of [seeded(plan), {}]) {
      expect(resolveNodeInputs(render, edges, states, [plan, render]).edl ?? null).toEqual(pick.edl)
    }
  })
})
