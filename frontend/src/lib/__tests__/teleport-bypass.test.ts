import { describe, expect, it } from "vitest"
import { bypassTeleports, drawnSourceId, resolveTeleportOrigin } from "@nodaro/render-rules"

type N = { id: string; type: string }
type E = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; data?: Record<string, unknown> }

const typeIn = (nodes: N[]) => (id: string) => nodes.find((n) => n.id === id)?.type

/** list(`col_a`) → send ⇢ receive → generate-image(`prompt`, each). */
function pair(): { nodes: N[]; edges: E[] } {
  return {
    nodes: [
      { id: "list", type: "list" },
      { id: "send", type: "teleport-send" },
      { id: "recv", type: "teleport-receive" },
      { id: "gi", type: "generate-image" },
    ],
    edges: [
      { id: "e1", source: "list", sourceHandle: "col_a", target: "send", targetHandle: "in", data: { outputMode: "all" } },
      { id: "tp", source: "send", sourceHandle: "out", target: "recv", targetHandle: "in", data: { teleporter: true } },
      { id: "e2", source: "recv", sourceHandle: "out", target: "gi", targetHandle: "prompt", data: { outputMode: "each" } },
    ],
  }
}

describe("resolveTeleportOrigin", () => {
  it("walks Receive → Send → the node wired into the Send, with that wire's pip", () => {
    const g = pair()
    expect(resolveTeleportOrigin("recv", typeIn(g.nodes), g.edges)).toEqual({ nodeId: "list", sourceHandle: "col_a" })
    expect(resolveTeleportOrigin("send", typeIn(g.nodes), g.edges)).toEqual({ nodeId: "list", sourceHandle: "col_a" })
  })

  it("follows chained pairs (a Send fed by another Receive)", () => {
    const nodes: N[] = [
      { id: "o", type: "upload-audio" },
      { id: "s1", type: "teleport-send" },
      { id: "r1", type: "teleport-receive" },
      { id: "s2", type: "teleport-send" },
      { id: "r2", type: "teleport-receive" },
    ]
    const edges: E[] = [
      { id: "a", source: "o", sourceHandle: "audio", target: "s1" },
      { id: "b", source: "s1", sourceHandle: "out", target: "r1" },
      { id: "c", source: "r1", sourceHandle: "out", target: "s2" },
      { id: "d", source: "s2", sourceHandle: "out", target: "r2" },
    ]
    expect(resolveTeleportOrigin("r2", typeIn(nodes), edges)).toEqual({ nodeId: "o", sourceHandle: "audio" })
  })

  it("is null for a non-teleport, for a Send with nothing wired in, and on a teleport cycle", () => {
    const g = pair()
    expect(resolveTeleportOrigin("list", typeIn(g.nodes), g.edges)).toBeNull()
    expect(resolveTeleportOrigin("recv", typeIn(g.nodes), g.edges.filter((e) => e.id !== "e1"))).toBeNull()
    const nodes: N[] = [{ id: "s", type: "teleport-send" }, { id: "r", type: "teleport-receive" }]
    const cycle: E[] = [
      { id: "a", source: "s", target: "r" },
      { id: "b", source: "r", target: "s" },
    ]
    expect(resolveTeleportOrigin("r", typeIn(nodes), cycle)).toBeNull()
  })
})

describe("bypassTeleports", () => {
  it("re-points a wire leaving a Receive at the origin's node and pip, keeping its own id, target and data", () => {
    const g = pair()
    const out = bypassTeleports(g.nodes, g.edges)
    const e2 = out.find((e) => e.id === "e2")!
    expect(e2).toEqual({
      id: "e2", source: "list", sourceHandle: "col_a", target: "gi", targetHandle: "prompt", data: { outputMode: "each" },
      teleportedFrom: { source: "recv", sourceHandle: "out" },
    })
    // Settings saved per wire are keyed by the node the wire was drawn from.
    expect(drawnSourceId(e2)).toBe("recv")
    expect(drawnSourceId(g.edges[0])).toBe("list")
  })

  it("a skipped Send or Receive cuts the wire: it is not bypassed, so the skip still reaches the consumer", () => {
    for (const skippedId of ["send", "recv"]) {
      const g = pair()
      const nodes = g.nodes.map((n) => (n.id === skippedId ? { ...n, data: { skipped: true } } : n))
      expect(bypassTeleports(nodes, g.edges)).toBe(g.edges)
    }
  })

  it("keeps the wires into and between teleports", () => {
    const g = pair()
    const out = bypassTeleports(g.nodes, g.edges)
    expect(out.find((e) => e.id === "e1")).toBe(g.edges[0])
    expect(out.find((e) => e.id === "tp")).toBe(g.edges[1])
  })

  it("leaves a Receive with no origin as it is, and returns the same array when nothing changes", () => {
    const g = pair()
    const unfed = g.edges.filter((e) => e.id !== "e1")
    expect(bypassTeleports(g.nodes, unfed)).toBe(unfed)
    const plain = [{ id: "x", source: "list", target: "gi" }]
    expect(bypassTeleports(g.nodes, plain)).toBe(plain)
  })

  it("never mutates its input", () => {
    const g = pair()
    const before = JSON.stringify(g.edges)
    bypassTeleports(g.nodes, g.edges)
    expect(JSON.stringify(g.edges)).toBe(before)
  })
})
