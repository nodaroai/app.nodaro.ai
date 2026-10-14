// @vitest-environment node
import { describe, it, expect } from "vitest"
import { AUDIO_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES } from "@nodaro/shared"
import { classifyMergeSource, mergeSourcesOf } from "../merge-audio-classify"

describe("classifyMergeSource", () => {
  it("classifies voice-changer as an audio track (the reported bug)", () => {
    // voice-changer's default output is audio; it must be a controllable
    // audio track in the merge-video-audio config, not silently dropped.
    expect(classifyMergeSource("voice-changer")).toBe("audio")
  })

  it("routes a dual-output node's video lane by source handle", () => {
    // voice-changer in video mode emits on its `video` source handle.
    expect(classifyMergeSource("voice-changer", "video")).toBe("video")
  })

  it("routes a dual-output node's audio lane by source handle", () => {
    expect(classifyMergeSource("voice-changer", "audio")).toBe("audio")
  })

  it("classifies a video producer as the video source", () => {
    expect(classifyMergeSource("image-to-video")).toBe("video")
  })

  it("classifies an audio producer as an audio track", () => {
    expect(classifyMergeSource("generate-music")).toBe("audio")
  })

  it("resolves sub-workflow output ports pre-classified by the caller", () => {
    expect(classifyMergeSource("__audio__")).toBe("audio")
    expect(classifyMergeSource("__video__")).toBe("video")
  })

  it("preserves split-media as an audio track", () => {
    expect(classifyMergeSource("split-media")).toBe("audio")
  })

  it("returns null for non-media node types so they never render as tracks", () => {
    expect(classifyMergeSource("list")).toBeNull()
    expect(classifyMergeSource("reduce")).toBeNull()
    expect(classifyMergeSource("generate-script")).toBeNull()
  })

  // Invariant guards: the panel consumes the shared single source of truth,
  // so a node type can never again be accepted on the handle/executor but
  // dropped by this config panel (the drift that caused the voice-changer bug).
  it("classifies EVERY shared AUDIO_PRODUCER_TYPE as audio", () => {
    for (const t of AUDIO_PRODUCER_TYPES) {
      expect(classifyMergeSource(t), `${t} should classify as audio`).toBe("audio")
    }
  })

  it("classifies EVERY shared VIDEO_PRODUCER_TYPE as video", () => {
    for (const t of VIDEO_PRODUCER_TYPES) {
      expect(classifyMergeSource(t), `${t} should classify as video`).toBe("video")
    }
  })
})

describe("mergeSourcesOf", () => {
  function node(id: string, type: string, data: Record<string, unknown> = {}): any {
    return { id, type, data: { label: id, ...data }, position: { x: 0, y: 0 } }
  }
  function edge(source: string, sourceHandle: string, target: string, targetHandle: string, data?: Record<string, unknown>): any {
    return { id: `${source}->${target}`, source, sourceHandle, target, targetHandle, data }
  }
  /** `origin` → Send → Receive → `m` (the consumer). */
  function throughTeleport(origin: any, pip: string) {
    return {
      nodes: [origin, node("s", "teleport-send"), node("r", "teleport-receive"), node("m", "merge-video-audio")],
      edges: [
        edge(origin.id, pip, "s", "in"),
        edge("s", "out", "r", "in", { teleporter: true }),
        edge("r", "out", "m", "in"),
      ],
    }
  }

  it("lists direct audio and video wires", () => {
    const nodes = [node("v", "upload-video"), node("a", "upload-audio"), node("m", "merge-video-audio")]
    const edges = [edge("v", "video", "m", "in"), edge("a", "audio", "m", "in")]
    const { videoSource, audioSources } = mergeSourcesOf("m", edges, nodes)
    expect(videoSource).toMatchObject({ id: "v", type: "upload-video" })
    expect(audioSources.map((s) => s.id)).toEqual(["a"])
  })

  // The reported bug: audio → Teleport Send, Teleport Receive → Merge Video &
  // Audio showed no audio track, while the run merged it at default settings.
  it("lists audio sent through a Teleport pair as a track keyed by the Receive", () => {
    const { nodes, edges } = throughTeleport(node("a", "upload-audio", { label: "Song" }), "audio")
    const { videoSource, audioSources } = mergeSourcesOf("m", edges, nodes)
    expect(videoSource).toBeNull()
    expect(audioSources).toHaveLength(1)
    // Keyed by the Receive: trackSettings saved under it reach the run
    // (@nodaro/render-rules carriedNodeSettings maps it to the origin).
    expect(audioSources[0]).toMatchObject({ id: "r", type: "upload-audio" })
    expect(audioSources[0].data.label).toBe("Song")
  })

  it("takes video sent through a Teleport pair as the base video", () => {
    const { nodes, edges } = throughTeleport(node("v", "upload-video"), "video")
    const { videoSource, audioSources } = mergeSourcesOf("m", edges, nodes)
    expect(videoSource).toMatchObject({ id: "r", type: "upload-video" })
    expect(audioSources).toHaveLength(0)
  })

  it("names the lane by the origin's pip (a dual-output node through the pair)", () => {
    const { nodes, edges } = throughTeleport(node("vc", "voice-changer"), "video")
    expect(mergeSourcesOf("m", edges, nodes).videoSource).toMatchObject({ id: "r", type: "voice-changer" })
  })

  it("leaves a Receive whose Send is not fed out", () => {
    const nodes = [node("s", "teleport-send"), node("r", "teleport-receive"), node("m", "merge-video-audio")]
    const edges = [edge("s", "out", "r", "in", { teleporter: true }), edge("r", "out", "m", "in")]
    expect(mergeSourcesOf("m", edges, nodes)).toEqual({ videoSource: null, audioSources: [] })
  })
})
