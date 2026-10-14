import { describe, expect, it } from "vitest"
import { bypassTeleports } from "@nodaro/render-rules"
import { cameraChoices } from "../camera-switch-config"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const n = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode

describe("cameraChoices through a Teleport pair", () => {
  // camA is wired into Edit Plan directly, camB through a pair (its Receive is
  // `r`). Edit Plan's panel saved sourceConfig/sourceOrder under the DRAWN ids;
  // the camera id offered is the node the wire carries — what the EDL names.
  const nodes = [
    n("camA", "upload-video"),
    n("camB", "upload-video"),
    n("wide", "upload-video"),
    n("s", "teleport-send"),
    n("r", "teleport-receive"),
    n("plan", "edit-plan", { sourceOrder: ["r", "camA"], sourceConfig: { wide: { role: "wide" } } }),
    n("cs", "camera-switch"),
  ]
  const raw = [
    { id: "a", source: "camA", sourceHandle: "video", target: "plan", targetHandle: "sources" },
    { id: "w", source: "wide", sourceHandle: "video", target: "plan", targetHandle: "sources" },
    { id: "b1", source: "camB", sourceHandle: "video", target: "s", targetHandle: "in" },
    { id: "b2", source: "s", sourceHandle: "out", target: "r", targetHandle: "in" },
    { id: "b3", source: "r", sourceHandle: "out", target: "plan", targetHandle: "sources" },
    { id: "e", source: "plan", sourceHandle: "edl", target: "cs", targetHandle: "edl" },
  ] as WorkflowEdge[]

  it("orders by the saved (drawn) keys and offers the carried camera ids", () => {
    expect(cameraChoices("cs", nodes, bypassTeleports(nodes, raw)).map((c) => c.id)).toEqual(["camB", "camA"])
  })

  it("reads a role saved under the Receive's id", () => {
    const withRole = nodes.map((x) => (x.id === "plan" ? n("plan", "edit-plan", { sourceConfig: { r: { role: "wide" } } }) : x))
    expect(cameraChoices("cs", withRole, bypassTeleports(withRole, raw)).map((c) => c.id)).toEqual(["camA", "wide"])
  })
})
