import { describe, it, expect } from "vitest"
import { reduceTimeline } from "../_freecut-timeline.js"
import { serializeFreecut } from "../freecut-serialize.js"

const scenes = [
  { sceneEntityId: "s1", compositeUrl: "https://cdn/clip1.mp4", shots: [{ shot_id: "s1", duration_seconds: 5 }] },
  { sceneEntityId: "s2", compositeUrl: "https://cdn/clip2.mp4", shots: [{ shot_id: "s2", duration_seconds: 4 }] },
]
const opts = { musicAssetUrl: "https://cdn/music.mp3", generatedAt: "2026-01-01T00:00:00.000Z", source: "studio-freecut-export" as const }

describe("serializeFreecut", () => {
  it("renders deterministic freecut-v1 JSON (concatenation, one music track)", () => {
    const reduced = reduceTimeline(scenes)
    const out = serializeFreecut(reduced, "json", opts)
    expect(out.mimeType).toBe("application/json"); expect(out.fileExtension).toBe("json"); expect(out.formatTag).toBe("freecut-v1")
    const doc = JSON.parse(out.content)
    expect(doc.format).toBe("freecut-v1")
    expect(doc.tracks[0].type).toBe("video")
    expect(doc.tracks[0].clips.map((c: { asset_url: string }) => c.asset_url)).toEqual(["https://cdn/clip1.mp4", "https://cdn/clip2.mp4"])
    expect(doc.tracks[0].clips[1].timeline_position_sec).toBe(5)     // cumulative, no overlap
    expect(doc.tracks.some((t: { type: string }) => t.type === "audio")).toBe(true)
    expect(doc.metadata.generated_at).toBe("2026-01-01T00:00:00.000Z")
  })

  it("renders well-formed FCPXML", () => {
    const out = serializeFreecut(reduceTimeline(scenes), "fcpxml", opts)
    expect(out.mimeType).toBe("application/xml"); expect(out.fileExtension).toBe("fcpxml")
    expect(out.content.startsWith("<?xml")).toBe(true)
    expect(out.content).toContain("</fcpxml>")
  })
})
