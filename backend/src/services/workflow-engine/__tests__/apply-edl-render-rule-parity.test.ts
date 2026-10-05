/**
 * Apply EDL's render rule on the SERVER, from the canvas — one third of the
 * parity check for the editor's render badge (A2b).
 *
 * Decided 2026-10-04: the badge is split by surface, and whatever is anchored
 * at a render judges with the render's own rule (`@nodaro/render-rules`), with
 * the node's `output`, `crossfadeMs` and wired sources. The editor's Apply EDL
 * panel badge picks the EDL and the sources the node would render now and runs
 * that rule (frontend/src/lib/__tests__/apply-edl-render-rule-parity.test.ts);
 * the REST route refuses with it (backend/src/routes/__tests__/
 * apply-edl-render-rule-parity.test.ts); this file runs each canvas of
 * `fixtures/apply-edl-render-rule.json` the way a workflow run does when it
 * starts at the render (Run from here, Render final): every other node seeded
 * from its saved data, the fan-out planned, each iteration's inputs resolved,
 * the DAG payload builder run. All three must reach the fixture's verdicts.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"
import { planFanOut, withWiredSettings } from "@nodaro/shared"
import { buildPayload } from "../payload-builder.js"
import { getListFanOutForNode, resolveNodeInputs } from "../input-resolver.js"
import { extractSavedNodeOutput, extractSourceNodeOutput } from "../output-extractor.js"
import { isSourceNode } from "../execution-graph.js"
import { seededFromSavedData } from "../saved-data.js"
import { resolveFanOutIterationInputs } from "../../../workers/fan-out-inputs.js"
import type { NodeExecutionState, ResolvedInputs, SimpleEdge, SimpleNode } from "../types.js"

interface Render {
  /** The item of a clip list this render reads; absent for a single render. */
  readonly clip?: number
  readonly edl: unknown
  /** The media its Sources wires deliver, when it differs per render (a list
   *  wired into Sources fans the render out); else the case's `sources`. */
  readonly sources?: readonly string[]
  readonly issues: readonly string[]
}

interface Case {
  readonly nodes: readonly SimpleNode[]
  readonly edges: ReadonlyArray<Omit<SimpleEdge, "id">>
  readonly sources: readonly string[]
  readonly renders: readonly Render[]
}

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = JSON.parse(readFileSync(join(HERE, "fixtures", "apply-edl-render-rule.json"), "utf8")) as {
  readonly cases: Record<string, Case>
}

/** The canvas a run reads, edges given ids. */
function graphOf(c: Case): { nodes: SimpleNode[]; edges: SimpleEdge[]; render: SimpleNode } {
  const nodes = c.nodes.map((n) => ({ ...n, data: { ...n.data } }))
  const edges = c.edges.map((e, i) => ({ ...e, id: `e${i}` }))
  const render = nodes.find((n) => n.id === "render")
  if (!render) throw new Error("the fixture case has no `render` node")
  return { nodes, edges, render }
}

/** Every node but the render, seeded the way the orchestrator seeds a run that
 *  starts at the render: a source node from its own data, any other node from
 *  its saved results (orchestrator-worker.ts, the subset branch). */
function seededStates(nodes: readonly SimpleNode[], render: SimpleNode): Record<string, NodeExecutionState> {
  const states: Record<string, NodeExecutionState> = {}
  for (const node of nodes) {
    if (node.id === render.id) continue
    if (isSourceNode(node.type)) {
      const output = extractSourceNodeOutput(node)
      if (output) states[node.id] = seededFromSavedData(output)
    } else {
      states[node.id] = seededFromSavedData(extractSavedNodeOutput(node) ?? extractSourceNodeOutput(node))
    }
  }
  return states
}

interface ServerRender {
  readonly row: number | undefined
  readonly inputs: ResolvedInputs
}

/** The renders a run of `render` makes, with the inputs each one resolves. */
function serverRenders(c: Case): { render: SimpleNode; renders: ServerRender[] } {
  const { nodes, edges, render } = graphOf(c)
  const states = seededStates(nodes, render)
  const plan = planFanOut(
    getListFanOutForNode(render, edges, states, nodes),
    render.type,
    withWiredSettings(render, nodes, edges).data as Record<string, unknown>,
  )
  if (!plan) return { render, renders: [{ row: undefined, inputs: resolveNodeInputs(render, edges, states, nodes) }] }
  return {
    render,
    renders: plan.items.map((_, k) => ({
      row: plan.rows[k],
      inputs: resolveFanOutIterationInputs(render, plan, k, edges, states, nodes),
    })),
  }
}

/** The payload builder's refusal for `issues`: the first three, then a count. */
function refusalOf(issues: readonly string[]): string {
  const shown = issues.slice(0, 3)
  const more = issues.length - shown.length
  return `apply-edl: invalid EDL — ${shown.join("; ")}${more > 0 ? ` (+${more} more)` : ""}`
}

const parsed = (v: unknown): unknown => (typeof v === "string" ? JSON.parse(v) : v)

describe("Apply EDL's render rule on the server, from the canvas (A2b parity)", () => {
  for (const [name, c] of Object.entries(FIXTURE.cases)) {
    it(name, () => {
      const { render, renders } = serverRenders(c)

      // The run makes exactly the renders the fixture lists: one per clip of a
      // clip list (a blank item skipped), else one.
      expect(renders.map((r) => r.row)).toEqual(c.renders.map((r) => r.clip))

      renders.forEach((server, i) => {
        const expected = c.renders[i]!
        const where = `${name}, render ${i}`
        // What it reads: the fixture's EDL (wired, or the node's own), and the
        // Sources wires' media in slot order (this render's own, when a list
        // wired into Sources fans the render out).
        expect(parsed(server.inputs.edl ?? render.data.edl), where).toEqual(expected.edl)
        expect(server.inputs.sources ?? [], where).toEqual(expected.sources ?? c.sources)

        const build = () => buildPayload(render, "job-render-rule", server.inputs, "usage-render-rule")
        if (expected.issues.length === 0) {
          expect(build, where).not.toThrow()
        } else {
          expect(build, where).toThrow(refusalOf(expected.issues))
        }
      })
    })
  }

  it("covers what the editor's badge must agree on", () => {
    const issues = Object.values(FIXTURE.cases).flatMap((c) => c.renders.flatMap((r) => r.issues))
    for (const shape of [
      /layout mode "side-by-side"/,
      /over the 180-minute limit/,
      /unknown role/,
      /has no video source/,
      /begins at \d+ms \(offsetMs\)/,
      /^segments is empty$/,
      /region crops are not renderable/,
      /layout transition "xfade:fade"/,
    ]) {
      expect(issues.some((m) => shape.test(m)), String(shape)).toBe(true)
    }
    // Renders that pass, too: the badge must say "ready" where the server renders.
    expect(Object.values(FIXTURE.cases).some((c) => c.renders.some((r) => r.issues.length === 0))).toBe(true)
  })
})
