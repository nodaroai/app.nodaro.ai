import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { assembleVideoOverlayRequest, videoOverlayPassThrough } from "@nodaro/shared"
import { completeAsPassThrough } from "../pass-through"

describe("canvas pass-through (R14)", () => {
  beforeEach(() => {
    useWorkflowStore.setState({ nodes: [{ id: "join", type: "combine-videos", position: { x: 0, y: 0 }, data: { label: "Join" } }] } as never)
  })
  it("writes the input as the result and makes no API call", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    expect(completeAsPassThrough("join", { videoUrl: "https://cdn.example/a.mp4", warning: "single_input" })).toBe("https://cdn.example/a.mp4")
    const d = useWorkflowStore.getState().nodes[0]!.data as Record<string, unknown>
    expect(d.generatedVideoUrl).toBe("https://cdn.example/a.mp4")
    expect(d.passThroughWarning).toBe("single_input")
    expect(d.executionStatus).toBe("completed")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("Video Overlay: an empty wired plan with no other layer completes as no_layers; a plan with a layer does not", () => {
    // The inputs the execute-node block builds, the way it builds them.
    const baseUrl = "https://cdn.example/v.mp4"
    const run = (layerPlan: string | undefined, layers: unknown[] = []) => {
      const request = assembleVideoOverlayRequest({ videoUrl: baseUrl, data: { layers: layers as never }, wiredImageUrls: [], planLayers: layerPlan })
      return { request, pass: videoOverlayPassThrough({ videoUrl: baseUrl, planWired: layerPlan !== undefined, layerCount: request.layers.length }) }
    }
    useWorkflowStore.setState({ nodes: [{ id: "ov", type: "video-overlay", position: { x: 0, y: 0 }, data: { label: "Overlay", layers: [] } }] } as never)
    const empty = run("[]")
    expect(empty.request.planError).toBeUndefined()
    expect(empty.pass).toEqual({ videoUrl: baseUrl, warning: "no_layers" })
    expect(completeAsPassThrough("ov", empty.pass!)).toBe(baseUrl)
    const d = useWorkflowStore.getState().nodes[0]!.data as Record<string, unknown>
    expect(d.generatedVideoUrl).toBe(baseUrl)
    expect(d.passThroughWarning).toBe("no_layers")
    expect(run(JSON.stringify([{ imageUrl: "https://cdn.example/s.png", start: 1 }])).pass).toBeNull()
    // No plan wired: an empty overlay is still the validator's no_layers error.
    expect(run(undefined).pass).toBeNull()
    // An unreadable plan carries planError (the block never passes it through).
    expect(run("not json").request.planError).toBe("invalid_layer_plan")
  })
})
