/**
 * How many speaker changes a Crossfade can apply to (SV21 c, C3.3). The plugin
 * writes an `xfade:*` only where the master clock JUMPS (a stretch of the
 * recording was cut out), never over contiguous speech, so the panel counts the
 * speaker changes where the next segment does not start where the previous one
 * ended — the very test the plugin's `continuous()` makes.
 */
import { describe, it, expect } from "vitest"
import { speakerViewContext } from "@nodaro/render-rules"

const src = (id: string) => ({ id, url: `https://x/${id}.mp4`, kind: "video" as const })
const seg = (id: string, inMs: number, outMs: number, video: string, speaker?: string) => ({ id, inMs, outMs, video, ...(speaker ? { speaker } : {}) })
const edl = (segments: unknown[]) => ({ version: 1, clock: "master", sources: [src("a"), src("b")], segments })

describe("speakerViewContext: speaker changes across a clock jump", () => {
  it("counts a change whose next segment starts later than the last one ended", () => {
    const clip = speakerViewContext(edl([seg("s0", 0, 5000, "a", "Host"), seg("s1", 8000, 12000, "b", "Guest"), seg("s2", 12000, 15000, "a", "Host")]))!.clips[0]!
    expect(clip.changes).toBe(2)
    expect(clip.jumpChanges).toBe(1)
  })

  it("a change over contiguous speech is not a jump", () => {
    const clip = speakerViewContext(edl([seg("s0", 0, 5000, "a", "Host"), seg("s1", 5000, 9000, "b", "Guest")]))!.clips[0]!
    expect(clip.changes).toBe(1)
    expect(clip.jumpChanges).toBe(0)
  })

  it("a jump inside one speaker's turn is not a speaker change", () => {
    const clip = speakerViewContext(edl([seg("s0", 0, 5000, "a", "Host"), seg("s1", 9000, 12000, "a", "Host")]))!.clips[0]!
    expect(clip.changes).toBe(0)
    expect(clip.jumpChanges).toBe(0)
  })

  it("is zero when no segment names a speaker (the plugin names them from the transcript)", () => {
    const clip = speakerViewContext(edl([seg("s0", 0, 5000, "a"), seg("s1", 9000, 12000, "b")]))!.clips[0]!
    expect(clip.changesKnown).toBe(false)
    expect(clip.jumpChanges).toBe(0)
  })

  it("counts per clip in a pack", () => {
    const ctx = speakerViewContext([
      edl([seg("s0", 0, 5000, "a", "H"), seg("s1", 6000, 9000, "b", "G")]),
      edl([seg("s0", 0, 5000, "a", "H"), seg("s1", 5000, 9000, "b", "G")]),
    ])!
    expect(ctx.clips.map((c) => c.jumpChanges)).toEqual([1, 0])
  })

  describe("only boundaries the plugin will write a switch at", () => {
    const withT = (id: string, inMs: number, outMs: number, video: string, speaker: string, extra: Record<string, unknown>) => ({ ...seg(id, inMs, outMs, video, speaker), ...extra })

    it("skips a boundary whose incoming segment already carries a crossfade (Edit Plan)", () => {
      const clip = speakerViewContext(edl([seg("s0", 0, 5000, "a", "A"), withT("s1", 9000, 12000, "a", "B", { transition: { type: "crossfade", durationMs: 300 } })]))!.clips[0]!
      expect(clip.changes).toBe(1)
      expect(clip.jumpChanges).toBe(0)
      expect(clip.sameCameraChanges).toBe(0)
    })

    it("skips a boundary whose incoming segment carries a layout transition", () => {
      const clip = speakerViewContext(edl([seg("s0", 0, 5000, "a", "A"), withT("s1", 9000, 12000, "a", "B", { layout: { transition: { type: "xfade:fade", durationMs: 300 } } })]))!.clips[0]!
      expect(clip.jumpChanges).toBe(0)
      expect(clip.sameCameraChanges).toBe(0)
    })

    it("still counts a boundary carrying a bare cut", () => {
      const clip = speakerViewContext(edl([seg("s0", 0, 5000, "a", "A"), withT("s1", 9000, 12000, "a", "B", { transition: { type: "cut" } })]))!.clips[0]!
      expect(clip.jumpChanges).toBe(1)
      expect(clip.sameCameraChanges).toBe(1)
    })
  })
})
