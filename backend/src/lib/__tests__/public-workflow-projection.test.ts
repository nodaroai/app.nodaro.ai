import { describe, expect, it, vi } from "vitest"
import { publicWorkflowProjection } from "../public-workflow-projection.js"

const input = { id: "film", name: "Film", nodes: [], edges: [], settings: { studio: { shared: true, keyframes: [] } } }
describe("public workflow extension boundary", () => {
  it.each([
    { ...input, settings: { studio: { shared: true, keyframes: [] } } },
    { ...input, settings: { studio: { shared: true, sequences: [] } } },
    { ...input, settings: { studio: { shared: true, settledJobIds: [] } } },
    { ...input, settings: { studio: { requiredCapabilities: ["studio-dependent-frames-v1"] } } },
    { ...input, settings: {}, nodes: [{ data: { keyframeId: null } }] },
    { ...input, settings: {}, nodes: [{ data: { sequenceBinding: null } }] },
    { ...input, settings: {}, nodes: [{ data: { requiredCapabilities: ["studio-dependent-frames-v1"] } }] },
  ])("never exposes raw extension state without a projector: %j", (document) => {
    expect(publicWorkflowProjection(document, {})).toBeNull()
  })
  it("passes only the projected graph and refuses unsupported documents", () => {
    const safe = { nodes: [], edges: [], settings: { studio: { publicView: {} } } }
    const project = vi.fn().mockReturnValueOnce(safe).mockReturnValueOnce(null)
    expect(publicWorkflowProjection(input, { publicWorkflow: { project } })).toEqual(safe)
    expect(project).toHaveBeenCalledWith(input)
    expect(publicWorkflowProjection(input, { publicWorkflow: { project } })).toBeNull()
  })
  it("preserves ordinary public reads and their existing transient stripping", () => {
    const project = vi.fn()
    const ordinary = { ...input, settings: { studio: { shared: true, trash: [{ secret: "deleted" }], shots: [{ id: "a", pendingClips: ["job"] }] } } }
    expect(publicWorkflowProjection(ordinary, { publicWorkflow: { project } })).toEqual({ nodes: [], edges: [],
      settings: { studio: { shared: true, shots: [{ id: "a" }] } } })
    expect(project).not.toHaveBeenCalled()
    expect(ordinary.settings.studio.trash).toHaveLength(1)
  })
  it("strips a finished take's voice record off an ordinary public read's nodes (T42), and only that", () => {
    const voiced = { ...input, settings: { studio: { shared: true } }, nodes: [
      { id: "generate-video-s1", data: { prompt: "Abi speaks", generatedResults: [
        { url: "https://r2/a.mp4", prompt: "Abi speaks", revoiceTo: { orderedVoices: [{ voiceId: "voice-owner-abi" }] }, voiceMode: "character" },
      ] } },
    ] }
    const out = publicWorkflowProjection(voiced, {})!
    expect(out.nodes).toEqual([{ id: "generate-video-s1", data: { prompt: "Abi speaks",
      generatedResults: [{ url: "https://r2/a.mp4", prompt: "Abi speaks" }] } }])
    // Copy-on-write: the stored row keeps it.
    expect(JSON.stringify(voiced.nodes)).toContain("voice-owner-abi")
  })
})
