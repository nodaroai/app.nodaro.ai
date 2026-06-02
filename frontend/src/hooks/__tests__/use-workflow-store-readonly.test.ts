import { describe, it, expect, beforeEach } from "vitest"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

const reset = () => useWorkflowStore.setState({ isReadOnly: false, nodes: [], edges: [], isDirty: false })

describe("workflow store read-only gate", () => {
  beforeEach(reset)

  it("addNode is a no-op when read-only", () => {
    useWorkflowStore.setState({ isReadOnly: true })
    const id = useWorkflowStore.getState().addNode("generate-image", { x: 0, y: 0 })
    expect(id).toBeUndefined()
    expect(useWorkflowStore.getState().nodes).toHaveLength(0)
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })

  it("updateNodeData / deleteNode / setWorkflowName are no-ops and never dirty", () => {
    useWorkflowStore.setState({
      isReadOnly: true,
      nodes: [{ id: "node_1", type: "generate-image", position: { x: 0, y: 0 }, data: { prompt: "x" } } as never],
    })
    useWorkflowStore.getState().updateNodeData("node_1", { prompt: "y" })
    useWorkflowStore.getState().setWorkflowName("renamed")
    useWorkflowStore.getState().deleteNode("node_1")
    const s = useWorkflowStore.getState()
    expect(s.nodes).toHaveLength(1)
    expect((s.nodes[0].data as { prompt: string }).prompt).toBe("x")
    expect(s.workflowName).not.toBe("renamed")
    expect(s.isDirty).toBe(false)
  })

  it("onNodesChange drops remove changes when read-only", () => {
    useWorkflowStore.setState({
      isReadOnly: true,
      nodes: [{ id: "node_1", type: "generate-image", position: { x: 0, y: 0 }, data: {} } as never],
    })
    useWorkflowStore.getState().onNodesChange([{ type: "remove", id: "node_1" } as never])
    expect(useWorkflowStore.getState().nodes).toHaveLength(1)
  })

  it("mutations work normally when not read-only", () => {
    const id = useWorkflowStore.getState().addNode("generate-image", { x: 1, y: 2 })
    expect(id).toBeDefined()
    expect(useWorkflowStore.getState().nodes).toHaveLength(1)
  })
})
