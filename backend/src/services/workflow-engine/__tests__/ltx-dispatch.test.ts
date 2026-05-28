/**
 * LTX 2.3 task dispatch in the unified `generate-video` payload-builder case.
 *
 * The orchestrator dispatches one of three LTX tasks based on which input
 * handles are wired (start/end frame → image_to_video, audio → audio_to_video,
 * neither → text_to_video). The Fast variant doesn't support audio, so when
 * audio is wired against Fast we fall back to text_to_video.
 *
 * Camera-motion upstreams map their catalog ID through
 * `ltxCameraMotionFromUpstream`; entries that don't map emit `"none"`.
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge, ResolvedInputs } from "../types.js"

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data }
}

function edge(
  source: string,
  target: string,
  sourceHandle?: string | null,
  targetHandle?: string | null,
): SimpleEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    sourceHandle: sourceHandle ?? null,
    targetHandle: targetHandle ?? null,
  }
}

function gv(provider: string, data: Record<string, unknown> = {}): SimpleNode {
  return node("gv-1", "generate-video", {
    provider,
    prompt: "a cat dancing",
    duration: 6,
    resolution: "1080p",
    aspectRatio: "16:9",
    fps: 25,
    generateAudio: true,
    ...data,
  })
}

const JOB_ID = "job-1"

describe("LTX 2.3 task dispatch in generate-video", () => {
  it("dispatches text_to_video when only prompt is provided", () => {
    const n = gv("ltx-2.3-pro")
    const inputs: ResolvedInputs = {}
    const result = buildPayload(n, JOB_ID, inputs, undefined, { nodes: [n], edges: [], nodeStates: {} })
    expect(result.payload.task).toBe("text_to_video")
  })

  it("dispatches image_to_video when startFrame wired", () => {
    const n = gv("ltx-2.3-pro")
    const inputs: ResolvedInputs = { startFrameUrl: "https://cdn.example/img.png" }
    const result = buildPayload(n, JOB_ID, inputs, undefined, { nodes: [n], edges: [], nodeStates: {} })
    expect(result.payload.task).toBe("image_to_video")
    expect(result.payload.image).toBe("https://cdn.example/img.png")
    expect(result.payload.last_frame_image).toBeUndefined()
  })

  it("dispatches image_to_video with last_frame_image when both frames wired", () => {
    const n = gv("ltx-2.3-pro")
    const inputs: ResolvedInputs = {
      startFrameUrl: "https://cdn.example/a.png",
      endFrameUrl: "https://cdn.example/b.png",
    }
    const result = buildPayload(n, JOB_ID, inputs, undefined, { nodes: [n], edges: [], nodeStates: {} })
    expect(result.payload.task).toBe("image_to_video")
    expect(result.payload.last_frame_image).toBe("https://cdn.example/b.png")
  })

  it("dispatches audio_to_video when audio wired on Pro", () => {
    const n = gv("ltx-2.3-pro")
    const inputs: ResolvedInputs = { audioUrl: "https://cdn.example/a.mp3" }
    const result = buildPayload(n, JOB_ID, inputs, undefined, { nodes: [n], edges: [], nodeStates: {} })
    expect(result.payload.task).toBe("audio_to_video")
    expect(result.payload.audio).toBe("https://cdn.example/a.mp3")
  })

  it("falls back to text_to_video when Fast + audio wired (Fast doesn't support audio)", () => {
    const n = gv("ltx-2.3-fast")
    const inputs: ResolvedInputs = { audioUrl: "https://cdn.example/a.mp3" }
    const result = buildPayload(n, JOB_ID, inputs, undefined, { nodes: [n], edges: [], nodeStates: {} })
    expect(result.payload.task).toBe("text_to_video")
  })

  it("includes mapped camera_motion when camera-motion upstream maps to LTX enum", () => {
    const n = gv("ltx-2.3-pro")
    const camMotion = node("cm-1", "camera-motion", { cameraMotion: "dolly-in" })
    const inputs: ResolvedInputs = {}
    const result = buildPayload(
      n,
      JOB_ID,
      inputs,
      undefined,
      { nodes: [n, camMotion], edges: [edge("cm-1", "gv-1", null, "cinematography")], nodeStates: {} },
    )
    expect(result.payload.camera_motion).toBe("dolly_in")
  })

  it("emits camera_motion 'none' when catalog entry does not map", () => {
    const n = gv("ltx-2.3-pro")
    const camMotion = node("cm-1", "camera-motion", { cameraMotion: "orbit-cw" })
    const inputs: ResolvedInputs = {}
    const result = buildPayload(
      n,
      JOB_ID,
      inputs,
      undefined,
      { nodes: [n, camMotion], edges: [edge("cm-1", "gv-1", null, "cinematography")], nodeStates: {} },
    )
    expect(result.payload.camera_motion).toBe("none")
  })
})
