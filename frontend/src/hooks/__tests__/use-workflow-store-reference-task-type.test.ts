import { describe, it, expect, afterEach } from "vitest"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { generateVideoModelSwitchPatch } from "@/components/nodes/use-generate-video-strip-model"
import type { WorkflowNode } from "@/types/nodes"

/**
 * A stored reference task type in a graph the editor LOADS (decided
 * 2026-11-13). Every write holds the rule, but a row stored before it did can
 * still carry, say, Kling + `edit`. The store removes such a value as it loads
 * the graph (`withListedReferenceTaskTypes`, the rule every write runs), and
 * as it adopts another tab's or writer's graph, so a later switch to
 * Seedance 2.5 — from the node's run strip, where the panel's fail-safe never
 * runs — cannot bring the Edit back.
 */

const at = { x: 0, y: 0 }
const KLING = { id: "kling", type: "generate-video", position: at, data: { label: "Kling", provider: "kling-3.0", prompt: "a cat", referenceTaskType: "edit" } } as unknown as WorkflowNode
const SD25 = { id: "sd25", type: "generate-video", position: at, data: { label: "Seedance", provider: "seedance-2-5", prompt: "a cat", referenceTaskType: "edit" } } as unknown as WorkflowNode

const dataOf = (id: string) => useWorkflowStore.getState().nodes.find((n) => n.id === id)!.data as Record<string, unknown>

afterEach(() => {
  useWorkflowStore.getState().clearWorkflow?.()
})

describe("a stored reference task type on load", () => {
  it("the failing flow: Kling + edit loaded, switched to Seedance 2.5 from the run strip — no Edit", () => {
    // The hazard the load closes: the strip's switch keeps a value the NEW model takes.
    expect(generateVideoModelSwitchPatch({ provider: "kling-3.0", referenceTaskType: "edit" }, "seedance-2-5")).not.toHaveProperty("referenceTaskType")
    expect({ provider: "kling-3.0", referenceTaskType: "edit", ...generateVideoModelSwitchPatch({ provider: "kling-3.0", referenceTaskType: "edit" }, "seedance-2-5") })
      .toHaveProperty("referenceTaskType", "edit")

    useWorkflowStore.getState().loadWorkflow("wf-1", "Flow", [KLING, SD25], [])
    expect(dataOf("kling")).not.toHaveProperty("referenceTaskType")
    useWorkflowStore.getState().updateNodeData("kling", generateVideoModelSwitchPatch(dataOf("kling"), "seedance-2-5"))
    expect(dataOf("kling").provider).toBe("seedance-2-5")
    expect(dataOf("kling")).not.toHaveProperty("referenceTaskType")
    // A model that lists the value keeps it, loaded as stored.
    expect(dataOf("sd25").referenceTaskType).toBe("edit")
  })

  it("a graph adopted from another writer is held to the same rule", () => {
    useWorkflowStore.getState().loadWorkflow("wf-1", "Flow", [SD25], [])
    useWorkflowStore.getState().reconcileFromRemote({ nodes: [KLING, SD25], edges: [], updatedAt: "2026-11-13T00:00:00Z", version: null, settings: null } as never)
    expect(dataOf("kling")).not.toHaveProperty("referenceTaskType")
    expect(dataOf("sd25").referenceTaskType).toBe("edit")
  })
})
