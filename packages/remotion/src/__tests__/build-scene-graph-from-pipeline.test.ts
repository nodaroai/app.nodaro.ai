import { describe, it, expect } from "vitest"
import {
  buildSceneGraphFromPipeline,
  type PipelineTimelineInput,
} from "../lib/build-scene-graph-from-pipeline"

const base: PipelineTimelineInput = {
  fps: 30,
  width: 1280,
  height: 720,
  scenes: [
    { compositeUrl: "https://r2/scene-1.mp4", durationSeconds: 3 },
    { compositeUrl: "https://r2/scene-2.mp4", durationSeconds: 4 },
    { compositeUrl: "https://r2/scene-3.mp4", durationSeconds: 2 },
  ],
}

describe("buildSceneGraphFromPipeline", () => {
  it("lays scene clips end-to-end with frame-accurate timing", () => {
    const sg = buildSceneGraphFromPipeline(base)
    const media = sg.tracks[0]
    if (media.type !== "media") throw new Error("expected media track first")
    expect(media.segments.map((s) => s.durationInFrames)).toEqual([90, 120, 60])
    expect(media.segments.map((s) => s.startFrame)).toEqual([0, 90, 210])
    expect(media.segments.map((s) => s.src)).toEqual([
      "https://r2/scene-1.mp4",
      "https://r2/scene-2.mp4",
      "https://r2/scene-3.mp4",
    ])
    expect(media.segments.every((s) => s.mediaType === "video")).toBe(true)
    expect(media.segments.every((s) => s.layout.mode === "fullscreen")).toBe(true)
  })

  it("sets total durationInFrames to the sum of clip frames", () => {
    expect(buildSceneGraphFromPipeline(base).durationInFrames).toBe(270)
  })

  it("omits audio tracks when no URLs provided", () => {
    const sg = buildSceneGraphFromPipeline(base)
    expect(sg.tracks.filter((t) => t.type === "audio")).toHaveLength(0)
    expect(sg.tracks).toHaveLength(1)
  })

  it("adds music (0.5) + narration (1.0) audio tracks when provided", () => {
    const sg = buildSceneGraphFromPipeline({
      ...base,
      musicUrl: "https://r2/music.mp3",
      narrationUrl: "https://r2/narration.mp3",
    })
    const audio = sg.tracks.filter((t) => t.type === "audio")
    expect(audio).toHaveLength(2)
    const music = audio.find((t) => t.id === "music")
    const narration = audio.find((t) => t.id === "narration")
    if (music?.type !== "audio" || narration?.type !== "audio") {
      throw new Error("expected music + narration audio tracks")
    }
    expect(music.src).toBe("https://r2/music.mp3")
    expect(music.volume).toBe(0.5)
    expect(narration.src).toBe("https://r2/narration.mp3")
    expect(narration.volume).toBe(1)
  })

  it("falls back to a default duration for zero/missing clip durations", () => {
    const sg = buildSceneGraphFromPipeline({
      ...base,
      scenes: [{ compositeUrl: "https://r2/x.mp4", durationSeconds: 0 }],
    })
    const media = sg.tracks[0]
    if (media.type !== "media") throw new Error("expected media track")
    expect(media.segments[0]!.durationInFrames).toBe(90) // 3s default * 30fps
    expect(sg.durationInFrames).toBe(90)
  })

  it("handles empty scenes without producing 0 total frames", () => {
    const sg = buildSceneGraphFromPipeline({ ...base, scenes: [] })
    expect(sg.durationInFrames).toBeGreaterThanOrEqual(1)
    const media = sg.tracks[0]
    if (media.type !== "media") throw new Error("expected media track")
    expect(media.segments).toHaveLength(0)
  })

  it("falls back fps/width/height when given non-positive values", () => {
    const sg = buildSceneGraphFromPipeline({
      fps: 0,
      width: 0,
      height: 0,
      scenes: [{ compositeUrl: "https://r2/x.mp4", durationSeconds: 2 }],
    })
    expect(sg.fps).toBe(30)
    expect(sg.width).toBe(1280)
    expect(sg.height).toBe(720)
    const media = sg.tracks[0]
    if (media.type !== "media") throw new Error("expected media track")
    expect(media.segments[0]!.durationInFrames).toBe(60) // 2s * 30fps
  })
})
