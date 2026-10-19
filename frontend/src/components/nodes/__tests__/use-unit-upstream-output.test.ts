import { describe, it, expect, afterEach } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useUnitUpstreamOutput } from "../use-unit-upstream-output"

const node = (id: string, type: string, data: Record<string, unknown>) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } })
const edge = (source: string, target: string, targetHandle: string, sourceHandle: string | null = null) => ({ id: `${source}-${target}-${targetHandle}`, source, target, sourceHandle, targetHandle })
const setGraph = (nodes: unknown[], edges: unknown[]) => act(() => { useWorkflowStore.setState({ nodes, edges } as never) })

afterEach(() => {
  cleanup()
  useWorkflowStore.setState({ nodes: [], edges: [] } as never)
})

describe("useUnitUpstreamOutput: what is wired into one pip of a node", () => {
  it("reads the upstream node's output (extractNodeOutput) on the pip its edge taps", () => {
    setGraph([node("u", "upload-image", { url: "https://u/a.gif" }), node("g", "gif-to-video", {})], [edge("u", "g", "image")])
    const { result } = renderHook(() => useUnitUpstreamOutput("g", "image"))
    expect(result.current).toBe("https://u/a.gif")
  })

  it("is undefined when nothing is wired into that pip (another pip, or no edge)", () => {
    setGraph([node("u", "upload-image", { url: "https://u/a.gif" }), node("g", "gif-to-video", {})], [edge("u", "g", "other")])
    expect(renderHook(() => useUnitUpstreamOutput("g", "image")).result.current).toBeUndefined()
  })

  it("re-reads when the upstream node's data changes", () => {
    setGraph([node("u", "upload-image", { url: "https://u/a.gif" }), node("g", "gif-to-video", {})], [edge("u", "g", "image")])
    const { result } = renderHook(() => useUnitUpstreamOutput("g", "image"))
    setGraph([node("u", "upload-image", { url: "https://u/b.gif" }), node("g", "gif-to-video", {})], [edge("u", "g", "image")])
    expect(result.current).toBe("https://u/b.gif")
  })
})
