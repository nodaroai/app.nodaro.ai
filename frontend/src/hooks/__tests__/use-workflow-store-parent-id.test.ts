/**
 * Regression test for React Flow's `parentId` field — the canonical marker
 * that ties a child node to its parent Group node.
 *
 * This is a prerequisite verification gate for the group/collect node feature
 ***REDACTED-OSS-SCRUB***
 *
 * Verifies React Flow's `parentId` field is preserved through `loadWorkflow`'s
 * migration helpers (`migrateImageNodes`, `filterCloneNodes`). Save-path
 * serialization is covered manually in spec §10 verification gates.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes, nodes) => nodes),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [
    ...edges,
    { ...connection, id: connection.id ?? `edge_mock` },
  ]),
}))

import { useWorkflowStore } from "../use-workflow-store"
import type { WorkflowNode } from "@/types/nodes"

function resetStore() {
  useWorkflowStore.setState({
    workflowId: null,
    workflowName: "Untitled Workflow",
    nodes: [],
    edges: [],
    selectedNodeId: null,
    isDirty: false,
  })
}

describe("workflow store parentId round-trip", () => {
  beforeEach(() => {
    resetStore()
  })

  it("loadWorkflow preserves parentId on child nodes (in-memory copy)", () => {
    const { loadWorkflow } = useWorkflowStore.getState()
    const groupNode = {
      id: "g1",
      type: "group" as const,
      position: { x: 0, y: 0 },
      data: { label: "G" },
    } as unknown as WorkflowNode
    const childNode = {
      id: "c1",
      type: "text-prompt" as const,
      position: { x: 10, y: 10 },
      data: { text: "hi" },
      parentId: "g1",
    } as unknown as WorkflowNode

    loadWorkflow("test-wf", "Test", [groupNode, childNode], [])

    const state = useWorkflowStore.getState()
    const child = state.nodes.find((n) => n.id === "c1")
    expect(child).toBeDefined()
    expect(child?.parentId).toBe("g1")
  })

  it("preserves parentId on multiple children sharing the same parent", () => {
    const { loadWorkflow } = useWorkflowStore.getState()
    const nodes = [
      { id: "g1", type: "group" as const, position: { x: 0, y: 0 }, data: { label: "G" } },
      { id: "c1", type: "text-prompt" as const, position: { x: 10, y: 10 }, data: { text: "a" }, parentId: "g1" },
      { id: "c2", type: "text-prompt" as const, position: { x: 20, y: 20 }, data: { text: "b" }, parentId: "g1" },
      { id: "c3", type: "generate-image" as const, position: { x: 30, y: 30 }, data: { label: "Img" }, parentId: "g1" },
    ] as unknown as WorkflowNode[]

    loadWorkflow("test-wf", "Test", nodes, [])

    const state = useWorkflowStore.getState()
    for (const id of ["c1", "c2", "c3"]) {
      const child = state.nodes.find((n) => n.id === id)
      expect(child?.parentId).toBe("g1")
    }
  })

  // Spec §4.4 — copy/paste of a child WITHOUT its group must clear parentId
  // and convert the child's stored local position into world coords so the
  // duplicate is rendered next to (not on top of, and not invisibly inside)
  // the original group.
  it("duplicateNode on a group child clears parentId and converts local→world coords", () => {
    const { loadWorkflow, duplicateNode } = useWorkflowStore.getState()
    loadWorkflow(
      "wf",
      "Test",
      [
        { id: "g1", type: "group", position: { x: 100, y: 50 }, data: { label: "G" } },
        { id: "c1", type: "text-prompt", position: { x: 10, y: 10 }, data: { text: "x" }, parentId: "g1" },
      ] as unknown as WorkflowNode[],
      [],
    )

    duplicateNode("c1")

    const after = useWorkflowStore.getState().nodes
    const copy = after.find((n) => n.id !== "c1" && n.id !== "g1" && n.type === "text-prompt")
    expect(copy).toBeDefined()
    // parentId cleared
    expect(copy?.parentId).toBeUndefined()
    // local (10,10) + parent (100,50) = world (110,60), then +50,+50 offset
    expect(copy?.position).toEqual({ x: 160, y: 110 })
  })

  // Duplicating a group node (no children) — no parentId to remap, position
  // gets the standard +50/+50 offset. Sanity check: nothing breaks for the
  // simple case.
  it("duplicateNode on a standalone group leaves parentId undefined and offsets position", () => {
    const { loadWorkflow, duplicateNode } = useWorkflowStore.getState()
    loadWorkflow(
      "wf",
      "Test",
      [
        { id: "g1", type: "group", position: { x: 100, y: 50 }, data: { label: "G" } },
      ] as unknown as WorkflowNode[],
      [],
    )

    duplicateNode("g1")

    const after = useWorkflowStore.getState().nodes
    expect(after).toHaveLength(2)
    const copy = after.find((n) => n.id !== "g1")
    expect(copy?.type).toBe("group")
    expect(copy?.parentId).toBeUndefined()
    expect(copy?.position).toEqual({ x: 150, y: 100 })
  })
})
