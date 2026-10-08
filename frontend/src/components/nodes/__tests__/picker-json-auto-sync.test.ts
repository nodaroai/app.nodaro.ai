import { describe, it, expect, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { usePickerJsonConsumer } from "../use-picker-json-consumer"
import { jsonRunResultPatch } from "@/lib/json-run-result"

function seed(pickerData: Record<string, unknown>, pickerJson?: Record<string, unknown>) {
  const nodes = [
    { id: "d", type: "describe-to-picker", position: { x: 0, y: 0 }, data: { label: "D", generatedPickerJson: pickerJson } },
    { id: "p", type: "lens", position: { x: 0, y: 0 }, data: { label: "Lens", ...pickerData } },
  ] as unknown as WorkflowNode[]
  const edges = [
    { id: "e", source: "d", sourceHandle: "picker-json", target: "p", targetHandle: "picker-json" },
  ] as unknown as WorkflowEdge[]
  useWorkflowStore.setState({ nodes, edges })
}

const lensOf = () => (useWorkflowStore.getState().nodes.find((n) => n.id === "p")!.data as { lens?: string }).lens

function mount() {
  return renderHook(() => {
    const data = useWorkflowStore((s) => s.nodes.find((n) => n.id === "p")!.data)
    return usePickerJsonConsumer("lens", "p", data as Record<string, unknown>)
  })
}

function setUpstream(lens: string) {
  act(() => useWorkflowStore.getState().updateNodeData("d", { generatedPickerJson: { lens: { lens } } }))
}

describe("picker auto-sync (default on)", () => {
  beforeEach(() => useWorkflowStore.setState({ nodes: [], edges: [] }))

  it("applies the upstream when it changes, with no setting chosen", () => {
    seed({ lens: "normal-50mm" })
    const { result } = mount()
    setUpstream("portrait-85mm")
    expect(lensOf()).toBe("portrait-85mm")
    expect(result.current.showSyncButton).toBe(false)
  })

  it("keeps a hand edit, and offers the sync button for it", () => {
    seed({ lens: "normal-50mm" })
    const { result } = mount()
    setUpstream("portrait-85mm")
    act(() => useWorkflowStore.getState().updateNodeData("p", { lens: "fisheye" }))
    expect(lensOf()).toBe("fisheye")
    expect(result.current.hasPending).toBe(true)
    expect(result.current.showSyncButton).toBe(true)
    act(() => result.current.apply())
    expect(lensOf()).toBe("portrait-85mm")
    expect(result.current.showSyncButton).toBe(false)
  })

  it("syncs again on the next upstream change after a hand edit", () => {
    seed({ lens: "normal-50mm" })
    mount()
    setUpstream("portrait-85mm")
    act(() => useWorkflowStore.getState().updateNodeData("p", { lens: "fisheye" }))
    setUpstream("macro")
    expect(lensOf()).toBe("macro")
  })
})

describe("picker manual mode (auto-sync off)", () => {
  beforeEach(() => useWorkflowStore.setState({ nodes: [], edges: [] }))

  it("waits for the button, and flags a hand edit as out of date", () => {
    seed({ lens: "normal-50mm", autoApplyInjected: false })
    const { result } = mount()
    setUpstream("portrait-85mm")
    expect(lensOf()).toBe("normal-50mm")
    expect(result.current.hasPending).toBe(true)
    act(() => result.current.apply())
    expect(lensOf()).toBe("portrait-85mm")
    expect(result.current.hasPending).toBe(false)
    expect(result.current.showSyncButton).toBe(true)
    act(() => useWorkflowStore.getState().updateNodeData("p", { lens: "fisheye" }))
    expect(result.current.hasPending).toBe(true)
  })
})

describe("saved workflows from before auto-sync was the default", () => {
  beforeEach(() => useWorkflowStore.setState({ nodes: [], edges: [] }))

  it("opening one keeps a hand-set value next to an analysis it never applied", () => {
    seed({ lens: "fisheye" }, { lens: { lens: "portrait-85mm" } })
    const { result } = mount()
    expect(lensOf()).toBe("fisheye")
    // Nothing is written on open; the difference is offered, not forced.
    const data = useWorkflowStore.getState().nodes.find((n) => n.id === "p")!.data as Record<string, unknown>
    expect(data.lastAppliedPickerJson).toBeUndefined()
    expect(result.current.showSyncButton).toBe(true)
  })

  it("auto-syncs from the next analysis on", () => {
    seed({ lens: "fisheye" }, { lens: { lens: "portrait-85mm" } })
    mount()
    setUpstream("macro")
    expect(lensOf()).toBe("macro")
  })

  it("an already-open picker wired to an analyzed node syncs at once", () => {
    seed({ lens: "normal-50mm" })
    act(() => useWorkflowStore.setState({ edges: [] }))
    mount()
    act(() => useWorkflowStore.getState().updateNodeData("d", { generatedPickerJson: { lens: { lens: "portrait-85mm" } } }))
    act(() =>
      useWorkflowStore.setState({
        edges: [{ id: "e", source: "d", sourceHandle: "picker-json", target: "p", targetHandle: "picker-json" }] as unknown as WorkflowEdge[],
      }),
    )
    expect(lensOf()).toBe("portrait-85mm")
  })
})

describe("every analysis run re-syncs (a run id is an upstream change)", () => {
  beforeEach(() => useWorkflowStore.setState({ nodes: [], edges: [] }))

  function run(lens: string, runId: string) {
    act(() =>
      useWorkflowStore.getState().updateNodeData("d", {
        generatedPickerJson: { lens: { lens } },
        generatedPickerRunId: runId,
      }),
    )
  }

  it("a re-run that returns the same section still replaces a hand edit", () => {
    seed({ lens: "normal-50mm" })
    mount()
    run("portrait-85mm", "job-1")
    act(() => useWorkflowStore.getState().updateNodeData("p", { lens: "fisheye" }))
    run("portrait-85mm", "job-2")
    expect(lensOf()).toBe("portrait-85mm")
    const data = useWorkflowStore.getState().nodes.find((n) => n.id === "p")!.data as Record<string, unknown>
    expect(data.lastAppliedPickerRunId).toBe("job-2")
  })

  it("the same run seen again (a reload) does not re-apply over a hand edit", () => {
    seed({ lens: "fisheye", lastAppliedPickerJson: { lens: "portrait-85mm" }, lastAppliedPickerRunId: "job-1" })
    act(() =>
      useWorkflowStore.getState().updateNodeData("d", {
        generatedPickerJson: { lens: { lens: "portrait-85mm" } },
        generatedPickerRunId: "job-1",
      }),
    )
    const { result } = mount()
    expect(lensOf()).toBe("fisheye")
    expect(result.current.showSyncButton).toBe(true)
  })

  it("a picker synced before runs had ids takes the first run that has one", () => {
    seed({ lens: "fisheye", lastAppliedPickerJson: { lens: "portrait-85mm" } }, { lens: { lens: "portrait-85mm" } })
    mount()
    expect(lensOf()).toBe("fisheye")
    run("portrait-85mm", "job-9")
    expect(lensOf()).toBe("portrait-85mm")
  })

  it("manual mode offers the new run on the button", () => {
    seed({ lens: "portrait-85mm", autoApplyInjected: false, lastAppliedPickerJson: { lens: "portrait-85mm" }, lastAppliedPickerRunId: "job-1" })
    const { result } = mount()
    run("portrait-85mm", "job-2")
    expect(result.current.hasPending).toBe(true)
    act(() => result.current.apply())
    expect(result.current.hasPending).toBe(false)
  })
})

describe("a server run lands with its run id", () => {
  it("the result patch carries the job id, so a server re-run re-syncs too", () => {
    expect(jsonRunResultPatch("describe-to-picker", { json: { lens: { lens: "macro" } } }, { jobId: "job-7" })).toEqual({
      generatedPickerJson: { lens: { lens: "macro" } },
      generatedPickerRunId: "job-7",
      generatedGaps: undefined,
    })
  })
})
