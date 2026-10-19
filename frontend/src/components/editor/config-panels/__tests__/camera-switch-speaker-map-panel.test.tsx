// @test-units-by-name looks up only the speaker-map unit it wires in
/**
 * Camera Switch's speaker table shows what the run will send — the ONE merge
 * the payload uses (cameraSwitchSpeakerMap): the person's choice, then a wired
 * Speaker Map, then the order. With nothing wired it shows what it always did.
 * And the camera list reads an EDL off the pip the wire leaves (Speaker Map's
 * `edl` output), not the producer's first output.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign((select: (s: unknown) => unknown) => select({ nodes: [], edges: [] }), { getState: () => ({ nodes: [], edges: [] }) }),
}))

import { CameraSwitchConfig, cameraChoices, wiredSpeakerMap } from "../camera-switch-config"
import type { CameraSwitchNodeData, WorkflowEdge, WorkflowNode } from "@/types/nodes"

const at = { x: 0, y: 0 }
const n = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: at, data: { label: id, ...data } }) as unknown as WorkflowNode
const e = (source: string, sourceHandle: string, target: string, targetHandle: string) => ({ id: `${source}-${targetHandle}`, source, sourceHandle, target, targetHandle }) as WorkflowEdge

const MAP = { version: 1, speakerMap: { s0: "camB", s1: "" }, confidence: {}, notes: [], edl: { version: 1, clock: "master", sources: [{ id: "camA", url: "https://m/a.mp4", kind: "video" }, { id: "camB", url: "https://m/b.mp4", kind: "video" }], segments: [{ id: "whole", inMs: 0, outMs: 900, video: "camA" }] } }
const TRANSCRIPT = { words: [{ text: "x", startMs: 0, endMs: 100, speaker: "s0" }, { text: "y", startMs: 200, endMs: 300, speaker: "s1" }] }

function graph(withMap: boolean) {
  const nodes = [
    n("camA", "upload-video", { label: "Cam A" }),
    n("camB", "upload-video", { label: "Cam B" }),
    n("plan", "edit-plan"),
    n("tx", "transcribe", { generatedJson: TRANSCRIPT }),
    n("map", "speaker-map", { generatedJson: MAP, generatedEdl: MAP.edl }),
    n("cs", "camera-switch"),
  ]
  const edges = [
    e("camA", "video", "plan", "sources"),
    e("camB", "video", "plan", "sources"),
    e("plan", "edl", "cs", "edl"),
    e("tx", "json", "cs", "transcript"),
    ...(withMap ? [e("map", "json", "cs", "speakerMap")] : []),
  ]
  return { nodes, edges }
}

function panel(data: Partial<CameraSwitchNodeData>, g: ReturnType<typeof graph>) {
  render(<CameraSwitchConfig data={{ label: "Camera Switch", fieldMappings: {}, ...data } as CameraSwitchNodeData} onUpdate={() => {}} sources={[]} fieldMappings={{}} onMapField={() => {}} nodes={g.nodes} edges={g.edges} nodeId="cs" />)
}
const cameraOf = (speaker: string) => screen.getByLabelText(`Camera for ${speaker}`).textContent

afterEach(() => cleanup())

describe("Camera Switch's panel with a wired Speaker Map", () => {
  it("nothing wired: the order default, as before", () => {
    panel({}, graph(false))
    expect([cameraOf("s0"), cameraOf("s1")]).toEqual(["Cam A", "Cam B"])
  })

  it("a wired Speaker Map fills the table (s0 → Cam B, s1 → no camera of their own)", () => {
    panel({}, graph(true))
    expect(cameraOf("s0")).toBe("Cam B")
    expect(cameraOf("s1")).toBe("No camera of their own")
    expect(screen.getByText("Pre-filled from the wired Speaker Map; a camera you pick here wins.")).toBeTruthy()
  })

  it("a camera the person picked beats the wired map", () => {
    panel({ speakerMap: { s0: "camA" } }, graph(true))
    expect(cameraOf("s0")).toBe("Cam A")
  })

  it("a wired Speaker Map that has not run: the panel says the run will be refused (the run's own verdict), and the table shows no map", () => {
    const g = graph(true)
    const nodes = g.nodes.map((x) => (x.id === "map" ? n("map", "speaker-map") : x))
    panel({}, { nodes, edges: g.edges })
    expect(screen.getByRole("alert").textContent).toBe("The wired Speaker Map has not run yet, so a run will be refused. Run it first, or disconnect it.")
    expect(wiredSpeakerMap("cs", nodes, g.edges)).toBe("")
  })

  it("something that is not a Speaker Map result on the wire: the panel says the run will be refused", () => {
    const g = graph(false)
    panel({}, { nodes: g.nodes, edges: [...g.edges, e("tx", "json", "cs", "speakerMap")] })
    expect(screen.getByRole("alert").textContent).toMatch(/is not a Speaker Map result, so a run will be refused/)
  })

  it("nothing wired, or a valid map: no warning", () => {
    panel({}, graph(false))
    expect(screen.queryByRole("alert")).toBeNull()
    cleanup()
    panel({}, graph(true))
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("wiredSpeakerMap reads the JSON the wire's pip carries", () => {
    const g = graph(true)
    expect(JSON.parse(wiredSpeakerMap("cs", g.nodes, g.edges)!)).toEqual(MAP)
    expect(wiredSpeakerMap("cs", graph(false).nodes, graph(false).edges)).toBeUndefined()
  })

  it("the camera list reads Speaker Map's `edl` pip when that is what is wired into `edl`", () => {
    const g = graph(false)
    const edges = g.edges.map((x) => (x.targetHandle === "edl" ? e("map", "edl", "cs", "edl") : x))
    expect(cameraChoices("cs", g.nodes, edges).map((c) => c.label)).toEqual(["Cam A", "Cam B"])
  })
})
