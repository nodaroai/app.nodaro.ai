/**
 * A saved Apply EDL render on the SERVER — the half of the cross-engine check
 * that runs here (A1b; TA6, TA8).
 *
 * `fixtures/apply-edl-latest-batch.json` holds a render with a final batch and
 * then a preview batch of the same clips, its selected result toggled back to a
 * final take. A run that passes the render through (a Run from here below it)
 * must hand a scalar consumer the SELECTED take and an each consumer the
 * LATEST batch only — not all six results of its history, which captioned (and
 * billed) every clip twice. The frontend test runs the canvas readers on the
 * same data.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"
import { extractSavedNodeOutput } from "../output-extractor.js"
import { getListFanOutForNode, resolveNodeInputs } from "../input-resolver.js"
import { seededFromSavedData } from "../saved-data.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = JSON.parse(readFileSync(join(HERE, "fixtures", "apply-edl-latest-batch.json"), "utf8")) as {
  render: SimpleNode
  expected: { scalar: { url: string; quality: string; clipKey: string }; batch: string[] }
  legacyPick: { render: SimpleNode; expected: string }
}

const captions: SimpleNode = { id: "caption-clip", type: "add-captions", data: {} }

function wire(render: SimpleNode, outputMode?: "each" | "last"): { edges: SimpleEdge[]; nodeStates: Record<string, NodeExecutionState> } {
  return {
    edges: [{
      id: "e-media", source: render.id, sourceHandle: "media", target: captions.id, targetHandle: "video",
      ...(outputMode ? { data: { outputMode } } : {}),
    }],
    nodeStates: { [render.id]: seededFromSavedData(extractSavedNodeOutput(render)) },
  }
}

describe("a saved Apply EDL render on the server (A1b)", () => {
  it("a scalar edge hands on the SELECTED take, with its stamps", () => {
    const out = extractSavedNodeOutput(FIXTURE.render)
    expect(out).toMatchObject({ videoUrl: FIXTURE.expected.scalar.url, quality: "final", clipKey: FIXTURE.expected.scalar.clipKey })
    const { edges, nodeStates } = wire(FIXTURE.render, "last")
    const inputs = resolveNodeInputs(captions, edges, nodeStates, [FIXTURE.render, captions])
    expect(inputs.videoUrl).toBe(FIXTURE.expected.scalar.url)
  })

  it("an each edge iterates the LATEST batch only, never the result history", () => {
    const { edges, nodeStates } = wire(FIXTURE.render, "each")
    const fanOut = getListFanOutForNode(captions, edges, nodeStates, [FIXTURE.render, captions])
    expect(fanOut?.items).toEqual(FIXTURE.expected.batch)
  })

  it("a pick saved before #1804 converges: the picked take, not the newest", () => {
    expect(extractSavedNodeOutput(FIXTURE.legacyPick.render)?.videoUrl).toBe(FIXTURE.legacyPick.expected)
  })
})
