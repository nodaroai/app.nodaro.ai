import { describe, expect, it } from "vitest"
import {
  buildAdjacency,
  collectTargetCandidates,
  isValidWorkflowConnection,
  workflowConnectionProblem,
} from "../connection-validation"
import { NODE_DEF_MAP } from "@/types/nodes"

// A Teleport pair is one wire with a jump in it: what leaves the Receive is
// whatever entered the Send on its channel. The connection rules must judge
// the Receive's output by that origin, not by the Receive's own node type —
// before this, every typed input (audio, image, video) refused a Receive.

type N = { id: string; type: string }
type E = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }

/** origin → send (`in`) ⇢ receive (hidden teleporter edge, as the store keeps it). */
function graphThrough(originType: string, originHandle: string): { nodes: N[]; edges: E[] } {
  return {
    nodes: [
      { id: "origin", type: originType },
      { id: "send", type: "teleport-send" },
      { id: "recv", type: "teleport-receive" },
      { id: "lip", type: "lip-sync" },
      { id: "mix", type: "mix-audio" },
      { id: "gi", type: "generate-image" },
    ],
    edges: [
      { source: "origin", sourceHandle: originHandle, target: "send", targetHandle: "in" },
      { source: "send", sourceHandle: "out", target: "recv", targetHandle: "in" },
    ],
  }
}

function canConnect(g: { nodes: N[]; edges: E[] }, target: string, targetHandle: string): boolean {
  const typeOf = (id: string) => g.nodes.find((n) => n.id === id)?.type
  return isValidWorkflowConnection(
    { source: "recv", sourceHandle: "out", target, targetHandle },
    typeOf,
    buildAdjacency(g.edges),
    g.edges,
  )
}

describe("isValidWorkflowConnection through a Teleport pair", () => {
  it("accepts an audio-fed Receive into audio inputs (the reported bug)", () => {
    const g = graphThrough("upload-audio", "audio")
    expect(canConnect(g, "lip", "audio")).toBe(true)
    expect(canConnect(g, "mix", "in")).toBe(true)
  })

  it("accepts an image-fed Receive into image inputs", () => {
    const g = graphThrough("upload-image", "image")
    expect(canConnect(g, "gi", "references")).toBe(true)
    expect(canConnect(g, "lip", "image")).toBe(true)
  })

  it("still refuses a type mismatch: an image-fed Receive into an audio input", () => {
    const g = graphThrough("upload-image", "image")
    expect(canConnect(g, "lip", "audio")).toBe(false)
    expect(canConnect(g, "mix", "in")).toBe(false)
  })

  it("judges the cycle on the real Receive, not on the origin", () => {
    // recv → origin would close origin → send ⇢ recv → origin.
    const g = graphThrough("trim-audio", "out")
    const typeOf = (id: string) => g.nodes.find((n) => n.id === id)?.type
    expect(
      isValidWorkflowConnection(
        { source: "recv", sourceHandle: "out", target: "origin", targetHandle: "in" },
        typeOf,
        buildAdjacency(g.edges),
        g.edges,
      ),
    ).toBe(false)
  })

  it("names no JSON-kind problem for a media Receive", () => {
    const g = graphThrough("upload-audio", "audio")
    const typeOf = (id: string) => g.nodes.find((n) => n.id === id)?.type
    expect(
      workflowConnectionProblem({ source: "recv", sourceHandle: "out", target: "mix", targetHandle: "in" }, typeOf, undefined, g.edges),
    ).toBeNull()
  })
})

describe("collectTargetCandidates offers a Receive by what it carries", () => {
  it("lists an audio-fed Receive for an audio input, wired from its own `out` pip", () => {
    const g = graphThrough("upload-audio", "audio")
    const typeOf = (id: string) => g.nodes.find((n) => n.id === id)?.type
    const { candidates } = collectTargetCandidates({
      nodes: g.nodes,
      edges: g.edges,
      consumerId: "mix",
      consumerHandleId: "in",
      alreadyConnectedIds: new Set(),
      accepts: (t) => t === "upload-audio",
      nodeTypeById: typeOf,
      outputsOf: (t) => NODE_DEF_MAP.get(t)?.outputs,
    })
    expect(candidates).toContainEqual({ nodeId: "recv", nodeType: "teleport-receive", sourceHandle: "out" })
  })
})
