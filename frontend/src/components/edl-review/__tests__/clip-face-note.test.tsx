import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup } from "@testing-library/react"

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes, nodes) => nodes),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, connection]),
}))

import { editPlanBasis } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { editedSincePreview } from "@/lib/edl-review/face-staleness"
import { CLIPS, loadClipCanvas, patchNode, take } from "./clip-canvas"

/**
 * "Edited since this preview" belongs to the cut review (§2.7, U1): a clip
 * set's Keep and hook choices change no clip's cut, and the render's node face
 * shows ONE take of a batch, so comparing it with the first clip's basis would
 * flag every clip render the moment a clip is dropped.
 */
beforeEach(() => loadClipCanvas())
afterEach(cleanup)

const state = () => useWorkflowStore.getState()
const dropClip = (row: number) =>
  patchNode("plan", { editedEdl: { v: 1, kind: "clips", basis: editPlanBasis(CLIPS), clips: CLIPS.map((_, i) => ({ keep: i !== row })) } })

describe("EditedSincePreviewNote on a clip set's render", () => {
  it("stays quiet when a clip is dropped and the take on show is another clip's current preview", () => {
    patchNode("cut", { __listResults: [take(1, "proxy").url, take(2, "proxy").url], generatedResults: [take(1, "proxy"), take(2, "proxy")] })
    dropClip(3)
    expect(editedSincePreview("cut", state().nodes, state().edges)).toBe(false)
  })

  it("stays quiet when a hook is edited", () => {
    patchNode("cut", { generatedResults: [take(2, "proxy")] })
    patchNode("plan", { editedEdl: { v: 1, kind: "clips", basis: editPlanBasis(CLIPS), clips: CLIPS.map((_, i) => (i === 2 ? { keep: true, hook: "new" } : { keep: true })) } })
    expect(editedSincePreview("cut", state().nodes, state().edges)).toBe(false)
  })
})
