/**
 * A saved Apply EDL render in the BROWSER engine — the editor half of the
 * cross-engine check (A1b; TA6, TA8).
 *
 * The fixture (shared with backend apply-edl-latest-batch.test.ts) is a render
 * with a final batch and then a preview batch of the same clips, its selected
 * result toggled back to a final take. The canvas must hand a scalar consumer
 * the SELECTED take and an each consumer the LATEST batch only — never the six
 * results of its history (a Run from here on Caption Clip captioned, and
 * billed, every clip twice). A pick saved before #1804 converges with the
 * server on the picked take.
 */
import { describe, it, expect, vi } from "vitest"

let storeNodes: unknown[] = []
let storeEdges: unknown[] = []

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({ characterDefinitions: [], nodes: storeNodes, edges: storeEdges }),
  },
}))

import { extractNodeOutput } from "../execution-graph"
import { extractNodeOutputAsList, getListFanOutForNode, resolveNodeInputs } from "../node-input-resolver"
import fixture from "../../../../../../backend/src/services/workflow-engine/__tests__/fixtures/apply-edl-latest-batch.json"

/* eslint-disable @typescript-eslint/no-explicit-any */
const asNode = (n: { id: string; type: string; data: Record<string, unknown> }): any => ({ ...n, position: { x: 0, y: 0 } })
const render = asNode(fixture.render)
const captions = asNode({ id: "caption-clip", type: "add-captions", data: { label: "Caption Clip" } })
const wire = (outputMode?: "each" | "last"): any => ({
  id: "e-media", source: render.id, sourceHandle: "media", target: captions.id, targetHandle: "video",
  ...(outputMode ? { data: { outputMode } } : {}),
})

describe("a saved Apply EDL render in the browser (A1b)", () => {
  it("a scalar edge hands on the SELECTED take", () => {
    expect(extractNodeOutput(render, "media")).toBe(fixture.expected.scalar.url)
    storeNodes = [render, captions]
    storeEdges = [wire("last")]
    const inputs = resolveNodeInputs(captions, storeNodes as any, storeEdges as any)
    expect(inputs.videoUrl).toBe(fixture.expected.scalar.url)
  })

  it("an each edge iterates the LATEST batch only, never the result history", () => {
    expect(extractNodeOutputAsList(render, "media")).toEqual(fixture.expected.batch)
    const fanOut = getListFanOutForNode(captions, [render, captions], [wire("each")])
    expect(fanOut?.items).toEqual(fixture.expected.batch)
  })

  it("a render that ran once lists nothing: an each edge reads its one result", () => {
    const once = asNode({ ...fixture.render, data: { ...fixture.render.data, __listResults: undefined } })
    expect(extractNodeOutputAsList(once, "media")).toBeUndefined()
    expect(getListFanOutForNode(captions, [once, captions], [wire("each")])).toBeUndefined()
  })

  it("a pick saved before #1804 converges with the server: the picked take", () => {
    expect(extractNodeOutput(asNode(fixture.legacyPick.render), "media")).toBe(fixture.legacyPick.expected)
  })
})
