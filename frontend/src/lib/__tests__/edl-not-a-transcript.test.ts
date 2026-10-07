/**
 * An EDL-shaped JSON output must not connect to a Transcript input (decided
 * 2026-10-07). Every JSON pip is the same "look" data colour, so the canvas
 * used to accept Edit Plan -> Add Captions' Transcript and only fail (or caption
 * nothing) at run time. The rule is read from the output kinds in
 * `@nodaro/shared` (`jsonOutputKind`), not from a list of node names.
 */
import { describe, expect, it } from "vitest"
import { jsonOutputKind } from "@nodaro/shared"
import { collectTargetCandidates, isValidWorkflowConnection, workflowConnectionProblem } from "../connection-validation"
import { NODE_DEF_MAP } from "@/types/nodes"

const types: Record<string, string> = {
  plan: "edit-plan",
  cam: "camera-switch",
  render: "apply-edl",
  tx: "transcribe",
  caps: "add-captions",
  render2: "apply-edl",
  plan2: "edit-plan",
}
const typeOf = (id: string): string | undefined => types[id]
const labelOf = (t: string): string | undefined => NODE_DEF_MAP.get(t)?.label
const ok = (source: string, sourceHandle: string | undefined, target: string, targetHandle: string): boolean =>
  isValidWorkflowConnection({ source, sourceHandle, target, targetHandle }, typeOf)

describe("an EDL output cannot feed a Transcript input", () => {
  it("refuses Edit Plan's and Camera Switch's edl on every Transcript input", () => {
    for (const [src, handle] of [["plan", "edl"], ["cam", "edl"]] as const) {
      expect(ok(src, handle, "caps", "transcript"), `${src}.${handle} -> add-captions`).toBe(false)
      expect(ok(src, handle, "render2", "transcript"), `${src}.${handle} -> apply-edl`).toBe(false)
      expect(ok(src, handle, "cam", "transcript"), `${src}.${handle} -> camera-switch`).toBe(false)
      expect(ok(src, handle, "plan2", "transcript"), `${src}.${handle} -> edit-plan`).toBe(false)
    }
  })

  it("also when the edge names no source pip (the node's primary output is read)", () => {
    expect(ok("plan", undefined, "caps", "transcript")).toBe(false)
  })

  it("still accepts a real Transcript on those inputs", () => {
    expect(ok("tx", "json", "caps", "transcript")).toBe(true)
    expect(ok("render", "json", "caps", "transcript")).toBe(true)
    expect(ok("cam", "transcript", "caps", "transcript")).toBe(true)
    expect(ok("tx", "json", "plan", "transcript")).toBe(true)
  })

  it("leaves EDL -> EDL and the other json inputs alone", () => {
    expect(ok("plan", "edl", "render", "edl")).toBe(true)
    expect(ok("plan", "edl", "cam", "edl")).toBe(true)
    expect(ok("cam", "edl", "render", "edl")).toBe(true)
    expect(ok("plan", "edl", "caps", "captionPlan")).toBe(true)
  })

  it("explains the refusal, naming both nodes", () => {
    const problem = workflowConnectionProblem(
      { source: "plan", sourceHandle: "edl", target: "caps", targetHandle: "transcript" },
      typeOf,
      labelOf,
    )
    expect(problem).toContain(NODE_DEF_MAP.get("edit-plan")!.label)
    expect(problem).toContain(NODE_DEF_MAP.get("add-captions")!.label)
    expect(problem).toMatch(/not a transcript/i)
    expect(workflowConnectionProblem({ source: "tx", sourceHandle: "json", target: "caps", targetHandle: "transcript" }, typeOf)).toBeNull()
  })

  it("the Transcript input's popover never offers an EDL output, and offers Camera Switch's transcript pip", () => {
    const nodes = [
      { id: "plan", type: "edit-plan" },
      { id: "cam", type: "camera-switch" },
      { id: "caps", type: "add-captions" },
    ]
    const { candidates } = collectTargetCandidates({
      nodes,
      edges: [],
      consumerId: "caps",
      consumerHandleId: "transcript",
      alreadyConnectedIds: new Set(),
      accepts: () => true,
      nodeTypeById: (id) => nodes.find((n) => n.id === id)?.type,
      outputsOf: (t) => NODE_DEF_MAP.get(t)?.outputs,
    })
    expect(candidates.map((c) => c.nodeId)).not.toContain("plan")
    expect(candidates).toContainEqual({ nodeId: "cam", nodeType: "camera-switch", sourceHandle: "transcript" })
  })
})

describe("a Transcript output cannot feed an EDL input (decided 2026-10-08)", () => {
  it("refuses Transcribe's json, Camera Switch's transcript and Apply EDL's json on every EDL input", () => {
    for (const [src, handle] of [["tx", "json"], ["cam", "transcript"], ["render", "json"]] as const) {
      expect(ok(src, handle, "render2", "edl"), `${src}.${handle} -> apply-edl.edl`).toBe(false)
      expect(ok(src, handle, "cam2", "edl"), `${src}.${handle} -> camera-switch.edl`).toBe(false)
    }
  })

  it("explains it, naming both nodes", () => {
    const problem = workflowConnectionProblem(
      { source: "tx", sourceHandle: "json", target: "render2", targetHandle: "edl" },
      typeOf,
      labelOf,
    )
    expect(problem).toContain(NODE_DEF_MAP.get("transcribe")!.label)
    expect(problem).toContain(NODE_DEF_MAP.get("apply-edl")!.label)
    expect(problem).toMatch(/not an edit list/i)
  })

  it("still accepts an EDL on an EDL input", () => {
    expect(ok("plan", "edl", "render2", "edl")).toBe(true)
    expect(ok("cam", "edl", "cam2", "edl")).toBe(true)
  })

  it("the EDL input's popover never offers a Transcript output, and offers Edit Plan's edl", () => {
    const nodes = [
      { id: "tx", type: "transcribe" },
      { id: "plan", type: "edit-plan" },
      { id: "render2", type: "apply-edl" },
    ]
    const { candidates } = collectTargetCandidates({
      nodes,
      edges: [],
      consumerId: "render2",
      consumerHandleId: "edl",
      alreadyConnectedIds: new Set(),
      accepts: () => true,
      nodeTypeById: (id) => nodes.find((n) => n.id === id)?.type,
      outputsOf: (t) => NODE_DEF_MAP.get(t)?.outputs,
    })
    // `accepts: () => true` lets Transcribe's plain `text` pip through; it is the json pip (the Transcript) that must be refused.
    expect(candidates.find((c) => c.nodeId === "tx")?.sourceHandle).not.toBe("json")
    expect(candidates).toContainEqual({ nodeId: "plan", nodeType: "edit-plan", sourceHandle: "edl" })
  })
})

describe("the output kinds name pips the nodes really declare", () => {
  it("edit-plan and camera-switch declare the json pips the shared kinds describe", () => {
    expect(NODE_DEF_MAP.get("edit-plan")!.outputs).toContain("edl")
    expect(NODE_DEF_MAP.get("camera-switch")!.outputs).toEqual(expect.arrayContaining(["edl", "transcript"]))
    expect(jsonOutputKind("edit-plan", "edl")).toBe("edl")
  })
})
