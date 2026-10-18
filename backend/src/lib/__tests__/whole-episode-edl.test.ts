import { describe, it, expect } from "vitest"
import { validateEdl } from "@nodaro/shared/edl"
import { wholeEpisodeEdl } from "@nodaro/render-rules"

describe("wholeEpisodeEdl (decided 2026-10-17)", () => {
  const sources = [
    { id: "m", url: "https://r2/m.wav", kind: "audio" as const, durationMs: 3_600_000 },
    { id: "a", url: "https://r2/a.mp4", kind: "video" as const, durationMs: 3_590_000, offsetMs: 4000 },
    { id: "w", url: "https://r2/w.mp4", kind: "video" as const, durationMs: 3_600_000, offsetMs: -1200 },
  ]
  it("one valid master-clock edit: the master's length, roles set, offsets kept, picture on the wide", () => {
    const r = wholeEpisodeEdl({ sources, masterSourceId: "m", wideSourceId: "w" })
    if (!("edl" in r)) throw new Error(r.problem)
    expect(validateEdl(r.edl).issues).toEqual([])
    expect(r.edl.clock).toBe("master")
    expect(r.edl.sources.map((s) => [s.id, s.role, s.offsetMs ?? 0])).toEqual([["m", "master-audio", 0], ["a", "camera", 4000], ["w", "wide", -1200]])
    expect(r.edl.segments).toEqual([{ id: "whole", inMs: 0, outMs: 3_600_000, video: "w" }])
  })
  it("no master: the first source's clock; no wide: the first camera's picture", () => {
    const r = wholeEpisodeEdl({ sources: sources.slice(1) })
    if (!("edl" in r)) throw new Error(r.problem)
    expect(validateEdl(r.edl).issues).toEqual([])
    expect(r.edl.segments[0]).toMatchObject({ inMs: 0, outMs: 3_590_000, video: "a" })
  })
  it("no video source is a problem, never an edit", () => {
    expect(wholeEpisodeEdl({ sources: sources.slice(0, 1), masterSourceId: "m" })).toHaveProperty("problem")
  })
})
